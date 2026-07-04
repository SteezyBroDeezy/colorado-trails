import { db } from '../db.js'
import { getTile, deleteTile } from './tileCache.js'
import {
  REGION_MIN_ZOOM,
  REGION_MAX_ZOOM,
  lonLatToTile,
  tileListForBbox,
  estimateRegionBytes,
} from './tileMath.js'

export { lonLatToTile, tileListForBbox, estimateRegionBytes }

// statewide base pack: low-zoom vector tiles + map assets, tiny (~2 MB)
const BASE_BBOX = [-109.5, 36.5, -101.5, 41.5]
const BASE_MAX_ZOOM = 8
const NE2_MAX_ZOOM = 6

const SPRITE_BASE = 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm'
const GLYPH_BASE = 'https://tiles.openfreemap.org/fonts'
const FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic']
const GLYPH_RANGES = ['0-255', '256-511']

async function prefetchTiles(tiles, { onProgress, signal, concurrency = 6 }) {
  let done = 0
  let bytes = 0
  let next = 0
  async function worker() {
    while (next < tiles.length) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const [z, x, y] = tiles[next++]
      try {
        const { buffer } = await getTile(z, x, y)
        bytes += buffer.byteLength
      } catch (err) {
        if (signal?.aborted || !navigator.onLine) throw err
        // an isolated failed tile shouldn't kill a 1000-tile download
        console.warn(`tile ${z}/${x}/${y} failed`, err)
      }
      done++
      onProgress?.(done / tiles.length)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tiles.length) }, worker),
  )
  return bytes
}

// Sprite, glyphs, ne2 raster: stable URLs, cached by the service
// worker's runtime CacheFirst route — warming them is just fetching.
async function warmMapAssets() {
  const urls = [
    `${SPRITE_BASE}.json`,
    `${SPRITE_BASE}.png`,
    `${SPRITE_BASE}@2x.json`,
    `${SPRITE_BASE}@2x.png`,
  ]
  for (const font of FONTS) {
    for (const range of GLYPH_RANGES) {
      urls.push(`${GLYPH_BASE}/${encodeURIComponent(font)}/${range}.pbf`)
    }
  }
  for (const [z, x, y] of tileListForBbox(BASE_BBOX, 0, NE2_MAX_ZOOM)) {
    urls.push(`https://tiles.openfreemap.org/natural_earth/ne2sr/${z}/${x}/${y}.png`)
  }
  await Promise.allSettled(urls.map((u) => fetch(u)))
}

async function ensureBasePack(onProgress, signal) {
  const existing = await db.meta.get('offline:base')
  if (existing) return
  await warmMapAssets()
  const tiles = tileListForBbox(BASE_BBOX, 0, BASE_MAX_ZOOM)
  const bytes = await prefetchTiles(tiles, { onProgress, signal })
  await db.meta.put({
    key: 'offline:base',
    value: { tiles: tiles.length, bytes, downloadedAt: new Date().toISOString() },
  })
}

export async function downloadRegion(region, onProgress, signal) {
  // ask the browser not to evict our caches under storage pressure
  navigator.storage?.persist?.().catch(() => {})

  await ensureBasePack((pct) => onProgress?.(pct * 0.05), signal)
  const tiles = tileListForBbox(region.bbox, REGION_MIN_ZOOM, REGION_MAX_ZOOM)
  const bytes = await prefetchTiles(tiles, {
    onProgress: (pct) => onProgress?.(0.05 + pct * 0.95),
    signal,
  })
  await db.meta.put({
    key: `offline:${region.id}`,
    value: {
      tiles: tiles.length,
      bytes,
      bbox: region.bbox,
      downloadedAt: new Date().toISOString(),
    },
  })
}

export async function deleteRegion(regionId) {
  const entry = await db.meta.get(`offline:${regionId}`)
  const bbox = entry?.value?.bbox
  if (bbox) {
    // note: a few boundary tiles shared with an adjacent downloaded
    // region may be evicted too; the base pack (z0-8) is never touched
    for (const [z, x, y] of tileListForBbox(bbox, REGION_MIN_ZOOM, REGION_MAX_ZOOM)) {
      await deleteTile(z, x, y)
    }
  }
  await db.meta.delete(`offline:${regionId}`)
}

export async function getOfflineState() {
  const entries = await db.meta
    .where('key')
    .startsWith('offline:')
    .toArray()
  const regions = {}
  for (const e of entries) regions[e.key.slice('offline:'.length)] = e.value
  let storage = null
  try {
    const est = await navigator.storage?.estimate?.()
    if (est) storage = { usage: est.usage, quota: est.quota }
  } catch {
    // unsupported browser; UI just hides the storage line
  }
  return { regions, storage }
}
