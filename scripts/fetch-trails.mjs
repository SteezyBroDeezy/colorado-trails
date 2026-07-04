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
import { FOURTEENERS } from './fourteeners.mjs'
import * as terrain from './terrain.mjs'

const BASE =
  'https://gis.colorado.gov/public/rest/services/OIT/Colorado_State_Basemap/MapServer/40/query'

const TRAILHEADS_BASE =
  'https://gis.colorado.gov/public/rest/services/OIT/Colorado_State_Basemap/MapServer/29/query'

// USGS GNIS named landforms — Summit class points for Colorado
const GNIS_BASE =
  'https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer/5/query'
const GNIS_WHERE = "state_alpha='CO' AND gaz_featureclass='Summit'"

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

// ----------------------------------------------------------------- summits

const SUMMIT_MATCH_MI = 0.0932 // 150 m: trail passes essentially over the top
const FOURTEENER_MATCH_MI = 0.1864 // 300 m: GNIS point <-> embedded 14er list

let summitGrid = new Map()

function buildSummitGrid(features) {
  summitGrid = new Map()
  const seen = new Set()
  for (const f of features) {
    const coord =
      f.geometry?.type === 'MultiPoint'
        ? f.geometry.coordinates[0]
        : f.geometry?.coordinates
    if (!coord) continue
    const name = clean(f.properties.gaz_name)
    if (!name) continue
    // GNIS carries duplicate rows for many summits
    const dupeKey = `${name}|${coord[0].toFixed(4)}|${coord[1].toFixed(4)}`
    if (seen.has(dupeKey)) continue
    seen.add(dupeKey)
    // pre-associate with a fourteener so trail tagging is a lookup
    let fourteener = null
    for (const p of FOURTEENERS) {
      if (haversineMi(coord, [p.lon, p.lat]) <= FOURTEENER_MATCH_MI) {
        fourteener = p
        break
      }
    }
    const key = gridKey(...coord)
    if (!summitGrid.has(key)) summitGrid.set(key, [])
    summitGrid.get(key).push({ coord, name, fourteener })
  }
}

function validateFourteeners() {
  const missing = FOURTEENERS.filter(
    (p) =>
      ![...summitGrid.values()]
        .flat()
        .some((s) => s.fourteener?.name === p.name),
  )
  for (const p of missing) {
    console.warn(`WARNING: no GNIS summit within 300 m of 14er "${p.name}"`)
  }
  return missing.length
}

// summits within SUMMIT_MATCH_MI of any vertex (loops crest mid-line,
// so endpoints alone are not enough)
function summitsFor(lines) {
  const found = new Map()
  for (const line of lines) {
    for (const point of line) {
      const cx = Math.floor(point[0] / CELL)
      const cy = Math.floor(point[1] / CELL)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const s of summitGrid.get(`${cx + dx}|${cy + dy}`) ?? []) {
            if (found.has(s.name)) continue
            if (haversineMi(point, s.coord) <= SUMMIT_MATCH_MI) {
              found.set(s.name, s)
            }
          }
        }
      }
    }
  }
  return [...found.values()]
}

// -------------------------------------------------------------- elevation

// Hysteresis threshold: ignore vertical wiggles under ~5 m (terrain
// raster noise), accumulate everything bigger as real climbing.
const GAIN_NOISE_FT = 16.4

let elevAt = () => null // set after terrain.resolve()

function elevationStats(lines) {
  let minFt = Infinity
  let maxFt = -Infinity
  const lineGains = []
  for (const line of lines) {
    let gain = 0
    let ref = null
    for (const [lon, lat] of line) {
      const e = elevAt(lon, lat)
      if (e == null) return null // tile failed -> caller falls back
      if (e < minFt) minFt = e
      if (e > maxFt) maxFt = e
      if (ref == null) {
        ref = e
      } else if (e > ref + GAIN_NOISE_FT) {
        gain += e - ref
        ref = e
      } else if (e < ref - GAIN_NOISE_FT) {
        ref = e
      }
    }
    lineGains.push(gain)
  }
  // linear/loop: climb along the path. Networks: path-sums overstate
  // (you don't hike every branch), so use the larger of elevation span
  // and the biggest single branch climb.
  const gain =
    lines.length === 1
      ? lineGains[0]
      : Math.max(maxFt - minFt, ...lineGains)
  return {
    gainFt: Math.round(gain),
    minElevFt: Math.round(minFt),
    maxElevFt: Math.round(maxFt),
  }
}

// ------------------------------------------------------------- route type

const LOOP_CLOSE_MI = 0.0373 // 60 m

function routeTypeOf(lines) {
  if (lines.length > 1) return 'network'
  const line = lines[0]
  return haversineMi(line[0], line[line.length - 1]) <= LOOP_CLOSE_MI
    ? 'loop'
    : 'out-and-back'
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

  // real elevation from terrain tiles; COTREX's own elevation fields
  // are too sparse (statewide, ZERO trails showed >=2500 ft gain from
  // them). Fall back to those fields only if terrain sampling failed.
  let stats = elevationStats(lines)
  if (!stats) {
    const minVals = segments.map((s) => s.attrs.min_elevat).filter((v) => v > 0)
    const maxVals = segments.map((s) => s.attrs.max_elevat).filter((v) => v > 0)
    const minElev = minVals.length ? Math.round(Math.min(...minVals)) : null
    const maxElev = maxVals.length ? Math.round(Math.max(...maxVals)) : null
    stats = {
      minElevFt: minElev,
      maxElevFt: maxElev,
      gainFt: minElev != null && maxElev != null ? Math.max(0, maxElev - minElev) : null,
    }
  }
  const { minElevFt: minElev, maxElevFt: maxElev, gainFt } = stats

  const geometry =
    lines.length === 1
      ? { type: 'LineString', coordinates: lines[0] }
      : { type: 'MultiLineString', coordinates: lines }

  const th = nearestTrailhead(lines)
  const summits = summitsFor(lines)

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
      routeType: routeTypeOf(lines),
      summits: summits.length
        ? summits.map((s) => s.fourteener?.name ?? s.name)
        : null,
      is14er: summits.some((s) => s.fourteener),
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

const summitFeatures = []
for (let offset = 0; ; offset += PAGE_SIZE) {
  const page = await fetchPage(GNIS_BASE, GNIS_WHERE, 'OBJECTID,gaz_name', offset)
  summitFeatures.push(...page.features)
  if (!page.features.length || page.features.length < PAGE_SIZE) break
}
buildSummitGrid(summitFeatures)
const missing14ers = validateFourteeners()
console.log(
  `fetched ${summitFeatures.length} GNIS summit rows (${missing14ers} 14ers unmatched)`,
)

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

// sample real elevation for every vertex (each terrain tile fetched and
// decoded exactly once; disk-cached in scripts/.terrain-cache)
for (const segments of groups.values()) {
  for (const seg of segments) {
    for (const line of seg.lines) {
      for (const [lon, lat] of line) terrain.collect(lon, lat)
    }
  }
}
console.log(`sampling elevation from ${terrain.tileCount()} terrain tiles...`)
elevAt = await terrain.resolve((done, total) =>
  console.log(`  terrain ${done}/${total}`),
)

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
  // full timestamp: the app detects data updates by exact string
  // compare, and date-only granularity hid same-day regenerations
  generated: new Date().toISOString(),
  source: 'COTREX (Colorado Parks & Wildlife / gis.colorado.gov)',
  regions: [],
}

const BBOX_PAD = 0.05

for (const r of [...REGIONS, { id: 'other', name: 'Other' }]) {
  const features = byRegion.get(r.id) ?? []
  if (!features.length) continue
  features.sort((a, b) => a.properties.id - b.properties.id)
  const file = `trails-${r.id}.json`
  const body = JSON.stringify({ type: 'FeatureCollection', features })
  await writeFile(`public/data/${file}`, body)
  // data bbox (padded) — used by the app for offline tile downloads
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const f of features) {
    const coords =
      f.geometry.type === 'LineString'
        ? [f.geometry.coordinates]
        : f.geometry.coordinates
    const [fw, fs, fe, fn] = lineBbox(coords)
    if (fw < w) w = fw
    if (fs < s) s = fs
    if (fe > e) e = fe
    if (fn > n) n = fn
  }
  const round = (v) => Math.round(v * 100) / 100
  manifest.regions.push({
    id: r.id,
    name: r.name,
    file,
    count: features.length,
    bytes: Buffer.byteLength(body),
    bbox: [
      round(w - BBOX_PAD),
      round(s - BBOX_PAD),
      round(e + BBOX_PAD),
      round(n + BBOX_PAD),
    ],
  })
  console.log(`wrote public/data/${file} (${features.length} trails, ${(Buffer.byteLength(body) / 1e6).toFixed(1)} MB)`)
}

await writeFile('public/data/regions.json', JSON.stringify(manifest, null, 2))
console.log('done')
