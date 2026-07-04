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

console.log(
  `OK: ${stored} trails stored, shapes valid, search index + backfill + queries work, trailheads sane, re-put idempotent`,
)
process.exit(0)
