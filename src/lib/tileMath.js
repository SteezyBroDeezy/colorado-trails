// Pure slippy-map tile math — no browser/maplibre imports so the node
// smoke test can exercise it directly.
export const REGION_MIN_ZOOM = 9
export const REGION_MAX_ZOOM = 12
export const AVG_TILE_BYTES = 13000 // measured across Colorado at z12

export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const r = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  )
  const clamp = (v) => Math.max(0, Math.min(n - 1, v))
  return [clamp(x), clamp(y)]
}

export function tileListForBbox([w, s, e, n], zMin, zMax) {
  const tiles = []
  for (let z = zMin; z <= zMax; z++) {
    const [x0, y0] = lonLatToTile(w, n, z) // top-left
    const [x1, y1] = lonLatToTile(e, s, z) // bottom-right
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) tiles.push([z, x, y])
    }
  }
  return tiles
}

export function estimateRegionBytes(bbox) {
  return (
    tileListForBbox(bbox, REGION_MIN_ZOOM, REGION_MAX_ZOOM).length * AVG_TILE_BYTES
  )
}
