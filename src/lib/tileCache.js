import maplibregl from 'maplibre-gl'

// Vector tiles are cached under synthetic z/x/y keys, NOT their real
// URLs: OpenFreeMap tile URLs embed a weekly-changing planet-snapshot
// path, so real URLs as keys would orphan the whole cache every week.
export const TILE_CACHE = 'map-tiles'
const TILEJSON_URL = 'https://tiles.openfreemap.org/planet'

export function tileKey(z, x, y) {
  return `https://tiles.offline/${z}/${x}/${y}.pbf`
}

let templatePromise = null

function getTileTemplate() {
  templatePromise ??= (async () => {
    const res = await fetch(TILEJSON_URL)
    if (!res.ok) throw new Error(`TileJSON fetch failed: ${res.status}`)
    const tilejson = await res.json()
    const template = tilejson.tiles?.[0]
    if (!template) throw new Error('TileJSON has no tiles template')
    return template
  })()
  // let a transient failure retry on the next tile request
  templatePromise.catch(() => {
    templatePromise = null
  })
  return templatePromise
}

// Cache-first tile fetch. Every online miss lands in Cache Storage, so
// ordinary browsing accumulates offline coverage; region downloads are
// just bulk prefetches through this same path.
export async function getTile(z, x, y) {
  const cache = await caches.open(TILE_CACHE)
  const key = tileKey(z, x, y)
  const hit = await cache.match(key)
  if (hit) return { buffer: await hit.arrayBuffer(), fromCache: true }

  const template = await getTileTemplate()
  const url = template
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y)
  const res = await fetch(url)
  if (res.status === 204) return { buffer: new ArrayBuffer(0), fromCache: false }
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: HTTP ${res.status}`)
  const buffer = await res.arrayBuffer()
  await cache.put(
    key,
    new Response(buffer.slice(0), {
      headers: { 'Content-Type': 'application/x-protobuf' },
    }),
  )
  return { buffer, fromCache: false }
}

export async function hasTile(z, x, y) {
  const cache = await caches.open(TILE_CACHE)
  return Boolean(await cache.match(tileKey(z, x, y)))
}

export async function deleteTile(z, x, y) {
  const cache = await caches.open(TILE_CACHE)
  return cache.delete(tileKey(z, x, y))
}

let registered = false

export function registerOfmProtocol() {
  if (registered) return
  registered = true
  maplibregl.addProtocol('ofm', async ({ url }) => {
    const [z, x, y] = url
      .replace('ofm://', '')
      .split('/')
      .map(Number)
    const { buffer } = await getTile(z, x, y)
    return { data: buffer }
  })
}
