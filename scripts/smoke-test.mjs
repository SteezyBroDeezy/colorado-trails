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

const { downloadTrails, getTrailCount } = await import('../src/lib/trails.js')
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

console.log(`OK: ${stored} trails stored, shapes valid, indexes work, re-put idempotent`)
process.exit(0)
