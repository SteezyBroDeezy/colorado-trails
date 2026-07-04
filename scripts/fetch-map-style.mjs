// Snapshot the OpenFreeMap liberty style for local serving:
//   node scripts/fetch-map-style.mjs
//
// Transforms the vector source to our custom `ofm://` protocol (handled
// in src/lib/tileCache.js with z/x/y-normalized Cache Storage keys —
// OpenFreeMap's real tile URLs contain a weekly-changing snapshot path,
// so they must never be used as cache keys) and clamps maxzoom to 12 to
// keep offline region downloads small; MapLibre overzooms beyond it.
import { mkdir, writeFile } from 'node:fs/promises'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const TILEJSON_URL = 'https://tiles.openfreemap.org/planet'
export const MAX_TILE_ZOOM = 12

const [style, tilejson] = await Promise.all(
  [STYLE_URL, TILEJSON_URL].map(async (url) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    return res.json()
  }),
)

const vectorNames = Object.entries(style.sources)
  .filter(([, s]) => s.type === 'vector')
  .map(([name]) => name)
if (vectorNames.length !== 1) {
  throw new Error(`expected 1 vector source, found: ${vectorNames.join(', ')}`)
}
style.sources[vectorNames[0]] = {
  type: 'vector',
  tiles: ['ofm://{z}/{x}/{y}'],
  minzoom: 0,
  maxzoom: MAX_TILE_ZOOM,
  attribution: tilejson.attribution ?? 'OpenFreeMap © OpenMapTiles © OpenStreetMap',
}

await mkdir('public/map-style', { recursive: true })
await writeFile('public/map-style/liberty.json', JSON.stringify(style))
console.log(
  `wrote public/map-style/liberty.json (vector source "${vectorNames[0]}" -> ofm://, maxzoom ${MAX_TILE_ZOOM})`,
)
