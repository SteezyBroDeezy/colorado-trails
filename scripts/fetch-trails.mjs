// Build-time trail data pipeline: node scripts/fetch-trails.mjs
//
// Downloads hiking-allowed, named trails from the COTREX layer on the
// state's public ArcGIS server (paged, 2000 records/request), then:
//   1. simplifies geometry (Douglas-Peucker on top of server rounding)
//   2. merges trail segments into whole trails — COTREX splits trails
//      into many short segments (median 0.4 mi), useless for a guide.
//      Segments group by name+manager, then spatially cluster so
//      same-named trails in different places stay separate records.
//   3. derives difficulty from merged length + elevation gain
//   4. assigns a region and writes chunked GeoJSON to public/data/
import { mkdir, writeFile } from 'node:fs/promises'

const BASE =
  'https://gis.colorado.gov/public/rest/services/OIT/Colorado_State_Basemap/MapServer/40/query'

const TRAILHEADS_BASE =
  'https://gis.colorado.gov/public/rest/services/OIT/Colorado_State_Basemap/MapServer/29/query'

const WHERE =
  "hiking IS NOT NULL AND hiking NOT IN ('no','No',' ') AND name IS NOT NULL AND name <> ''"

const OUT_FIELDS = [
  'OBJECTID',
  'name',
  'trail_num',
  'surface',
  'type',
  'length_mi_',
  'min_elevat',
  'max_elevat',
  'manager',
  'dogs',
  'seasonalit',
  'url',
].join(',')

const PAGE_SIZE = 2000

// [minLon, minLat, maxLon, maxLat] — first match on a trail's first vertex
// wins, so order matters where boxes overlap. Coarse on purpose: regions
// exist to group downloads, not to be cartographically exact.
const REGIONS = [
  { id: 'front-range', name: 'Front Range', bbox: [-105.95, 38.5, -104.35, 41.01] },
  { id: 'san-juans', name: 'San Juans', bbox: [-109.07, 36.98, -106.4, 38.55] },
  { id: 'western-slope', name: 'Western Slope', bbox: [-109.07, 38.2, -107.3, 39.5] },
  { id: 'central-mountains', name: 'Central Mountains', bbox: [-107.6, 38.3, -105.6, 39.95] },
  { id: 'northwest', name: 'Northwest', bbox: [-109.07, 39.3, -105.95, 41.01] },
  { id: 'southeast', name: 'Southeast', bbox: [-106.6, 36.98, -102.03, 38.6] },
  { id: 'eastern-plains', name: 'Eastern Plains', bbox: [-104.4, 36.98, -102.03, 41.01] },
]

function regionOf([lon, lat]) {
  for (const r of REGIONS) {
    const [w, s, e, n] = r.bbox
    if (lon >= w && lon <= e && lat >= s && lat <= n) return r.id
  }
  return 'other'
}

// ---------------------------------------------------------------- simplify

// Douglas-Peucker in degrees; ~0.00003° ≈ 3 m. Server already rounds
// coords to 5 decimals, this drops redundant vertices on top of that.
const TOLERANCE = 0.00003

function perpDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function simplify(points) {
  if (points.length <= 2) return points
  let maxDist = 0
  let index = 0
  const last = points.length - 1
  for (let i = 1; i < last; i++) {
    const d = perpDist(points[i], points[0], points[last])
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }
  if (maxDist <= TOLERANCE) return [points[0], points[last]]
  return [
    ...simplify(points.slice(0, index + 1)).slice(0, -1),
    ...simplify(points.slice(index)),
  ]
}

function toLines(geom) {
  const coords = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates
  return coords.map(simplify).filter((line) => line.length >= 2)
}

// ------------------------------------------------------------------ length

const R_MI = 3958.8

function haversineMi([lon1, lat1], [lon2, lat2]) {
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R_MI * Math.asin(Math.sqrt(a))
}

function geomLengthMi(lines) {
  let total = 0
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) total += haversineMi(line[i - 1], line[i])
  }
  return total
}

// ----------------------------------------------------------------- cluster

function lineBbox(lines) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const line of lines) {
    for (const [x, y] of line) {
      if (x < w) w = x
      if (x > e) e = x
      if (y < s) s = y
      if (y > n) n = y
    }
  }
  return [w, s, e, n]
}

// gap between bboxes in degrees (0 when they touch/overlap)
function bboxGap(a, b) {
  const dx = Math.max(a[0] - b[2], b[0] - a[2], 0)
  const dy = Math.max(a[1] - b[3], b[1] - a[3], 0)
  return Math.hypot(dx, dy)
}

// ~1 km: contiguous segments touch, this tolerates small data gaps and
// road crossings without gluing together same-named trails miles apart
const CLUSTER_GAP = 0.01

function clusterSegments(segments) {
  const parent = segments.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      if (bboxGap(segments[i].bbox, segments[j].bbox) <= CLUSTER_GAP) {
        parent[find(i)] = find(j)
      }
    }
  }
  const clusters = new Map()
  segments.forEach((seg, i) => {
    const root = find(i)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root).push(seg)
  })
  return [...clusters.values()]
}

// -------------------------------------------------------------- trailheads

// grid cell ~500 m; a 3x3 neighborhood search covers the 250 m match radius
const CELL = 0.005
const MATCH_MI = 0.155 // 250 m

let trailheadGrid = new Map()

function gridKey(lon, lat) {
  return `${Math.floor(lon / CELL)}|${Math.floor(lat / CELL)}`
}

function buildTrailheadGrid(features) {
  trailheadGrid = new Map()
  for (const f of features) {
    if (f.geometry?.type !== 'Point') continue
    const coord = f.geometry.coordinates
    const key = gridKey(...coord)
    if (!trailheadGrid.has(key)) trailheadGrid.set(key, [])
    trailheadGrid.get(key).push({ coord, attrs: f.properties })
  }
}

// nearest trailhead within MATCH_MI of any endpoint of the trail's lines
function nearestTrailhead(lines) {
  let best = null
  let bestD = MATCH_MI
  for (const line of lines) {
    for (const point of [line[0], line[line.length - 1]]) {
      const cx = Math.floor(point[0] / CELL)
      const cy = Math.floor(point[1] / CELL)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const th of trailheadGrid.get(`${cx + dx}|${cy + dy}`) ?? []) {
            const d = haversineMi(point, th.coord)
            if (d < bestD) {
              bestD = d
              best = th
            }
          }
        }
      }
    }
  }
  return best
}

// ------------------------------------------------------------------- merge

// COTREX elevations are in feet
function difficultyOf(lengthMi, gainFt) {
  if (lengthMi <= 2 && gainFt <= 500) return 'easy'
  if (lengthMi <= 7 && gainFt <= 2000) return 'moderate'
  return 'hard'
}

function clean(s) {
  const v = typeof s === 'string' ? s.trim() : s
  return v || null
}

function pickAttr(segments, key) {
  for (const seg of segments) {
    const v = clean(seg.attrs[key])
    if (v) return v
  }
  return null
}

function mergeCluster(segments) {
  segments.sort((a, b) => a.attrs.OBJECTID - b.attrs.OBJECTID)
  const lines = segments.flatMap((s) => s.lines)
  const geomMi = geomLengthMi(lines)
  // source lengths where present are usually better than simplified
  // geometry, but plenty of segments have 0/null — fall back per segment
  let lengthMi = 0
  for (const s of segments) {
    lengthMi += s.attrs.length_mi_ > 0 ? s.attrs.length_mi_ : geomLengthMi(s.lines)
  }
  lengthMi = Math.round(Math.max(lengthMi, geomMi) * 10) / 10

  const minVals = segments.map((s) => s.attrs.min_elevat).filter((v) => v > 0)
  const maxVals = segments.map((s) => s.attrs.max_elevat).filter((v) => v > 0)
  const minElev = minVals.length ? Math.round(Math.min(...minVals)) : null
  const maxElev = maxVals.length ? Math.round(Math.max(...maxVals)) : null
  const gainFt = minElev != null && maxElev != null ? Math.max(0, maxElev - minElev) : null

  const geometry =
    lines.length === 1
      ? { type: 'LineString', coordinates: lines[0] }
      : { type: 'MultiLineString', coordinates: lines }

  const th = nearestTrailhead(lines)

  return {
    type: 'Feature',
    geometry,
    properties: {
      id: segments[0].attrs.OBJECTID,
      name: clean(segments[0].attrs.name),
      trailNum: pickAttr(segments, 'trail_num'),
      surface: pickAttr(segments, 'surface'),
      type: pickAttr(segments, 'type'),
      lengthMi,
      minElevFt: minElev,
      maxElevFt: maxElev,
      gainFt,
      difficulty: difficultyOf(lengthMi, gainFt ?? 0),
      region: regionOf(lines[0][0]),
      manager: pickAttr(segments, 'manager'),
      dogs: pickAttr(segments, 'dogs'),
      seasonality: pickAttr(segments, 'seasonalit'),
      url: pickAttr(segments, 'url'),
      segments: segments.length,
      trailhead: th
        ? {
            name: clean(th.attrs.name),
            lon: th.coord[0],
            lat: th.coord[1],
            bathrooms: clean(th.attrs.bathrooms),
            fee: clean(th.attrs.fee),
            water: clean(th.attrs.water),
          }
        : null,
    },
  }
}

// ------------------------------------------------------------------- fetch

async function fetchPage(base, where, outFields, offset) {
  const params = new URLSearchParams({
    where,
    outFields,
    geometryPrecision: '5',
    outSR: '4326',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: 'OBJECTID',
    f: 'geojson',
  })
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${base}?${params}`)
    if (res.ok) {
      const body = await res.json()
      if (!body.error) return body
      if (attempt >= 3) throw new Error(`ArcGIS error: ${JSON.stringify(body.error)}`)
    } else if (attempt >= 3) {
      throw new Error(`HTTP ${res.status} at offset ${offset}`)
    }
    console.log(`  retry ${attempt} at offset ${offset}...`)
    await new Promise((r) => setTimeout(r, 2000 * attempt))
  }
}

const trailheadFeatures = []
for (let offset = 0; ; offset += PAGE_SIZE) {
  const page = await fetchPage(
    TRAILHEADS_BASE,
    '1=1',
    'OBJECTID,name,bathrooms,fee,water',
    offset,
  )
  trailheadFeatures.push(...page.features)
  if (!page.features.length || page.features.length < PAGE_SIZE) break
}
buildTrailheadGrid(trailheadFeatures)
console.log(`fetched ${trailheadFeatures.length} trailheads`)

const groups = new Map() // "name|manager" -> [{attrs, lines, bbox}]
let segmentCount = 0

for (let offset = 0; ; offset += PAGE_SIZE) {
  const page = await fetchPage(BASE, WHERE, OUT_FIELDS, offset)
  for (const f of page.features) {
    if (!f.geometry?.coordinates?.length) continue
    const lines = toLines(f.geometry)
    if (!lines.length) continue
    const key = `${clean(f.properties.name)?.toLowerCase()}|${clean(f.properties.manager)?.toLowerCase() ?? ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ attrs: f.properties, lines, bbox: lineBbox(lines) })
    segmentCount++
  }
  console.log(`fetched ${segmentCount} segments...`)
  if (!page.features.length || page.features.length < PAGE_SIZE) break
}

const byRegion = new Map()
let trailCount = 0
for (const segments of groups.values()) {
  for (const cluster of clusterSegments(segments)) {
    const feature = mergeCluster(cluster)
    const region = feature.properties.region
    if (!byRegion.has(region)) byRegion.set(region, [])
    byRegion.get(region).push(feature)
    trailCount++
  }
}
console.log(`merged ${segmentCount} segments -> ${trailCount} trails`)

await mkdir('public/data', { recursive: true })
const manifest = {
  generated: new Date().toISOString().slice(0, 10),
  source: 'COTREX (Colorado Parks & Wildlife / gis.colorado.gov)',
  regions: [],
}

for (const r of [...REGIONS, { id: 'other', name: 'Other' }]) {
  const features = byRegion.get(r.id) ?? []
  if (!features.length) continue
  features.sort((a, b) => a.properties.id - b.properties.id)
  const file = `trails-${r.id}.json`
  const body = JSON.stringify({ type: 'FeatureCollection', features })
  await writeFile(`public/data/${file}`, body)
  manifest.regions.push({
    id: r.id,
    name: r.name,
    file,
    count: features.length,
    bytes: Buffer.byteLength(body),
  })
  console.log(`wrote public/data/${file} (${features.length} trails, ${(Buffer.byteLength(body) / 1e6).toFixed(1)} MB)`)
}

await writeFile('public/data/regions.json', JSON.stringify(manifest, null, 2))
console.log('done')
