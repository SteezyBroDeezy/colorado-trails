// Data-flow smoke test without a browser: node scripts/smoke-test.mjs
// Runs downloadTrails() against fake-indexeddb with fetch() mapped to
// public/, then checks counts and row shapes. Uses sampled reads —
// fake-indexeddb is far too slow for full 30k-row scans (a real browser
// IndexedDB is not).
import 'fake-indexeddb/auto'
import { readFile } from 'node:fs/promises'

globalThis.fetch = async (url) => {
  try {
    const body = await readFile(`public${url}`, 'utf8')
    return { ok: true, status: 200, json: async () => JSON.parse(body) }
  } catch {
    return { ok: false, status: 404 }
  }
}

const { downloadTrails, getTrailCount, ensureTrailIndex, getTrailIndex, getTrail } =
  await import('../src/lib/trails.js')
const { db } = await import('../src/db.js')

const manifest = JSON.parse(await readFile('public/data/regions.json', 'utf8'))
const expected = manifest.regions.reduce((sum, r) => sum + r.count, 0)

const count = await downloadTrails((pct, name) =>
  console.log(`  ${Math.round(pct * 100)}% ${name}`),
)
const stored = await getTrailCount()
if (count !== expected || stored !== expected) {
  throw new Error(
    `count mismatch: manifest ${expected}, returned ${count}, stored ${stored}`,
  )
}

// row shape the map/search code relies on
const sample = await db.trails.limit(50).toArray()
for (const t of sample) {
  for (const key of ['id', 'name', 'difficulty', 'lengthMi', 'region']) {
    if (t[key] == null) throw new Error(`row ${t.id}: missing ${key}`)
  }
  if (!['LineString', 'MultiLineString'].includes(t.geometry?.type)) {
    throw new Error(`row ${t.id}: unexpected geometry ${t.geometry?.type}`)
  }
}

// indexes actually work
const easyCount = await db.trails.where('difficulty').equals('easy').count()
const byName = await db.trails.where('name').startsWith('Bear').limit(5).toArray()
console.log(`easy trails: ${easyCount}, name lookup sample: ${byName.length}`)
if (easyCount === 0 || byName.length === 0) {
  throw new Error('index queries returned nothing')
}

// re-putting the same rows must not duplicate (bulkPut keyed on id)
const smallest = manifest.regions.at(-1)
const fc = JSON.parse(await readFile(`public/data/${smallest.file}`, 'utf8'))
await db.trails.bulkPut(
  fc.features.map((f) => ({ ...f.properties, geometry: f.geometry })),
)
const after = await getTrailCount()
if (after !== stored) {
  throw new Error(`re-put changed count: ${stored} -> ${after}`)
}

// search index: populated by download, geometry-free, backfillable
const idxCount = await db.trailIndex.count()
if (idxCount !== stored) {
  throw new Error(`trailIndex count ${idxCount} != trails ${stored}`)
}
const idxSample = await db.trailIndex.limit(20).toArray()
for (const row of idxSample) {
  if ('geometry' in row) throw new Error(`index row ${row.id} carries geometry`)
  if (row.name == null || row.lengthMi == null || row.difficulty == null) {
    throw new Error(`index row ${row.id} missing search fields`)
  }
}
await db.trailIndex.clear()
await ensureTrailIndex()
const backfilled = await db.trailIndex.count()
if (backfilled !== stored) {
  throw new Error(`backfill produced ${backfilled}, expected ${stored}`)
}

// a search the panel would run: substring + difficulty + length filters
const index = await getTrailIndex()
const hits = index.filter(
  (t) =>
    t.name.toLowerCase().includes('lake') &&
    t.difficulty === 'moderate' &&
    t.lengthMi >= 2 &&
    t.lengthMi <= 5,
)
console.log(`search "lake" moderate 2-5mi: ${hits.length} hits`)
if (!hits.length) throw new Error('search over index returned nothing')
const full = await getTrail(hits[0].id)
if (!full?.geometry) throw new Error('getTrail missing geometry for search hit')

// trailhead matching: some trails carry one, coords must be sane, and
// the directions fallback (first vertex) must work for the rest
const withTh = await db.trails.filter((t) => t.trailhead != null).limit(20).toArray()
if (!withTh.length) throw new Error('no trails matched to a trailhead')
for (const t of withTh) {
  const { lat, lon } = t.trailhead
  if (!(lat > 36 && lat < 42 && lon > -110 && lon < -102)) {
    throw new Error(`trail ${t.id}: trailhead outside Colorado (${lat}, ${lon})`)
  }
}
const noTh = await db.trails.filter((t) => t.trailhead == null).first()
const g = noTh.geometry
const first = g.type === 'LineString' ? g.coordinates[0] : g.coordinates[0][0]
if (!Number.isFinite(first[0]) || !Number.isFinite(first[1])) {
  throw new Error('fallback destination vertex is not numeric')
}

// ---- offline map tiles: pure math + generated artifacts ----
const { lonLatToTile, tileListForBbox } = await import('../src/lib/tileMath.js')

// slippy-math fixtures
const eq = (a, b) => a[0] === b[0] && a[1] === b[1]
if (!eq(lonLatToTile(0, 0, 0), [0, 0])) throw new Error('tile math: z0 origin')
if (!eq(lonLatToTile(0.1, -0.1, 1), [1, 1])) throw new Error('tile math: z1 SE quadrant')
// Denver (105W 39.75N): x=(75/360)*4096=853.3, y=(1-ln(tan+sec)/pi)/2*4096=1554.4
if (!eq(lonLatToTile(-105.0, 39.75, 12), [853, 1554])) {
  throw new Error(`tile math: Denver z12 got ${lonLatToTile(-105.0, 39.75, 12)}`)
}
// bbox list: dedupe-free, in-range, plausible count for front-range
const frBbox = manifest.regions.find((r) => r.id === 'front-range').bbox
const frTiles = tileListForBbox(frBbox, 9, 12)
if (frTiles.length < 800 || frTiles.length > 1600) {
  throw new Error(`front-range tile count implausible: ${frTiles.length}`)
}
if (new Set(frTiles.map((t) => t.join('/'))).size !== frTiles.length) {
  throw new Error('tile list contains duplicates')
}
for (const [z, x, y] of frTiles) {
  if (x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    throw new Error(`tile out of range: ${z}/${x}/${y}`)
  }
}

// every region has a bbox that contains its trails
for (const region of manifest.regions) {
  const [w, s, e, n] = region.bbox
  if (!(w < e && s < n)) throw new Error(`${region.id}: degenerate bbox`)
  const fc = JSON.parse(await readFile(`public/data/${region.file}`, 'utf8'))
  for (const f of fc.features.slice(0, 200)) {
    const g = f.geometry
    const [lon, lat] = g.type === 'LineString' ? g.coordinates[0] : g.coordinates[0][0]
    if (lon < w || lon > e || lat < s || lat > n) {
      throw new Error(`${region.id}: trail ${f.properties.id} outside bbox`)
    }
  }
}

// local style snapshot: ofm:// vector source clamped to z12, assets intact
const style = JSON.parse(await readFile('public/map-style/liberty.json', 'utf8'))
const vector = Object.values(style.sources).find((s) => s.type === 'vector')
if (vector.tiles?.[0] !== 'ofm://{z}/{x}/{y}') {
  throw new Error(`style vector tiles: ${vector.tiles?.[0]}`)
}
if (vector.maxzoom !== 12) throw new Error(`style maxzoom: ${vector.maxzoom}`)
if (!style.glyphs?.startsWith('https://tiles.openfreemap.org/fonts/')) {
  throw new Error(`style glyphs: ${style.glyphs}`)
}
if (!style.sprite?.startsWith('https://tiles.openfreemap.org/sprites/')) {
  throw new Error(`style sprite: ${style.sprite}`)
}

// ---- summits, 14ers, route types ----
const idx = await getTrailIndex()
const rtCounts = { loop: 0, 'out-and-back': 0, network: 0 }
let n14 = 0
let nSummit = 0
for (const t of idx) {
  if (t.routeType in rtCounts) rtCounts[t.routeType]++
  if (t.is14er) n14++
  if (t.summits?.length) nSummit++
}
if (!rtCounts.loop || !rtCounts['out-and-back'] || !rtCounts.network) {
  throw new Error(`routeType classes missing: ${JSON.stringify(rtCounts)}`)
}
if (rtCounts.loop > rtCounts['out-and-back']) {
  throw new Error('implausible: more loops than out-and-back trails')
}
if (n14 < 10 || n14 > 500) throw new Error(`implausible 14er trail count: ${n14}`)
if (nSummit < n14) throw new Error('summit trails must include all 14er trails')
const quandary = idx.find((t) => t.name === 'Quandary Trail')
if (!quandary?.is14er || !quandary.summits?.includes('Quandary Peak')) {
  throw new Error(`Quandary Trail not tagged as 14er: ${JSON.stringify(quandary)}`)
}
console.log(
  `route types ${JSON.stringify(rtCounts)}, ${nSummit} summit trails, ${n14} 14er trails`,
)

// ---- saved lists: CRUD + pure merge ----
const { createList, deleteList, getLists, toggleTrailInList, mergeListRows } =
  await import('../src/lib/lists.js')

const list = await createList('Smoke Test List')
await toggleTrailInList(list.id, quandary.id)
let lists = await getLists()
if (!lists.some((l) => l.id === list.id && l.trailIds.includes(quandary.id))) {
  throw new Error('list create/toggle failed')
}
await toggleTrailInList(list.id, quandary.id)
lists = await getLists()
if (lists.find((l) => l.id === list.id).trailIds.length !== 0) {
  throw new Error('toggle did not remove trail')
}
await deleteList(list.id)
if ((await getLists()).some((l) => l.id === list.id)) {
  throw new Error('soft delete still visible')
}

// merge: LWW both directions, tombstones, one-sided rows
const mk = (id, updatedAt, extra = {}) => ({
  id, name: `L${id}`, trailIds: [], createdAt: 1, updatedAt, deletedAt: null, ...extra,
})
const merged = mergeListRows(
  [mk('a', 5), mk('b', 1), mk('localonly', 3)],
  [mk('a', 2), mk('b', 9, { deletedAt: 9 }), mk('remoteonly', 4)],
)
const byId = new Map(merged.resolved.map((r) => [r.id, r]))
if (byId.get('a').updatedAt !== 5) throw new Error('merge: local newer must win')
if (byId.get('b').deletedAt !== 9) throw new Error('merge: remote tombstone must win')
if (!merged.pushIds.includes('a') || !merged.pushIds.includes('localonly')) {
  throw new Error(`merge: pushIds wrong: ${merged.pushIds}`)
}
if (!merged.writeLocal.some((r) => r.id === 'remoteonly') ||
    !merged.writeLocal.some((r) => r.id === 'b')) {
  throw new Error('merge: writeLocal wrong')
}

console.log(
  `OK: ${stored} trails stored, shapes valid, search index + backfill + queries work, ` +
    `trailheads sane, tile math + style + region bboxes valid, summits/14ers/route types ` +
    `tagged, lists CRUD + merge correct, re-put idempotent`,
)
process.exit(0)
