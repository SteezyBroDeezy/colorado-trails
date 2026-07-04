// Elevation sampling from AWS terrarium terrain tiles (USGS/SRTM-derived,
// public, no key). COTREX's own min/max elevation fields are too sparse
// to compute gain from — see fetch-trails.mjs where this replaces them.
//
// Usage: register every [lon,lat] you need via collect(), then call
// resolve() once — it downloads each touched tile once (disk-cached in
// scripts/.terrain-cache/), decodes it once, and returns a lookup fn.
import sharp from 'sharp'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const Z = 12 // ~30 m/px in Colorado — plenty for gain estimates
const TILE = 256
const CACHE_DIR = 'scripts/.terrain-cache'
const URL_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const M_TO_FT = 3.28084

function worldPx(lon, lat) {
  const n = TILE * 2 ** Z
  const x = ((lon + 180) / 360) * n
  const r = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
  return [x, y]
}

const byTile = new Map() // "x/y" -> [{px, py, key}]
const elevations = new Map() // "lon|lat" -> ft

export function coordKey(lon, lat) {
  return `${lon}|${lat}`
}

export function collect(lon, lat) {
  const key = coordKey(lon, lat)
  if (elevations.has(key)) return
  elevations.set(key, null) // placeholder, deduped
  const [x, y] = worldPx(lon, lat)
  const tx = Math.floor(x / TILE)
  const ty = Math.floor(y / TILE)
  const tileKey = `${tx}/${ty}`
  if (!byTile.has(tileKey)) byTile.set(tileKey, [])
  byTile.get(tileKey).push({
    px: Math.min(TILE - 1, Math.floor(x - tx * TILE)),
    py: Math.min(TILE - 1, Math.floor(y - ty * TILE)),
    key,
  })
}

async function tilePng(tileKey) {
  const path = `${CACHE_DIR}/${Z}-${tileKey.replace('/', '-')}.png`
  try {
    return await readFile(path)
  } catch {
    // not cached yet
  }
  const url = `${URL_BASE}/${Z}/${tileKey}.png`
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url)
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      await writeFile(path, buf)
      return buf
    }
    if (attempt >= 3) throw new Error(`terrain tile ${tileKey}: HTTP ${res.status}`)
    await new Promise((r) => setTimeout(r, 1500 * attempt))
  }
}

export async function resolve(onProgress) {
  await mkdir(CACHE_DIR, { recursive: true })
  const tiles = [...byTile.keys()]
  let done = 0
  let failed = 0
  const CONCURRENCY = 8
  let next = 0
  async function worker() {
    while (next < tiles.length) {
      const tileKey = tiles[next++]
      try {
        const png = await tilePng(tileKey)
        const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
        for (const { px, py, key } of byTile.get(tileKey)) {
          const i = (py * info.width + px) * info.channels
          const meters = data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768
          elevations.set(key, meters * M_TO_FT)
        }
      } catch {
        failed++ // points on this tile keep their null -> caller falls back
      }
      done++
      if (done % 250 === 0 || done === tiles.length) onProgress?.(done, tiles.length)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  if (failed) console.warn(`terrain: ${failed}/${tiles.length} tiles failed`)
  return (lon, lat) => elevations.get(coordKey(lon, lat)) ?? null
}

export function tileCount() {
  return byTile.size
}
