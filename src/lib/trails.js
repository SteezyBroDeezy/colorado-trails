import { db } from '../db.js'

export const REGION_NAMES = {
  'front-range': 'Front Range',
  'san-juans': 'San Juans',
  'western-slope': 'Western Slope',
  'central-mountains': 'Central Mountains',
  northwest: 'Northwest',
  southeast: 'Southeast',
  'eastern-plains': 'Eastern Plains',
  other: 'Other',
}

function toIndexRow(t) {
  return {
    id: t.id,
    name: t.name,
    lengthMi: t.lengthMi,
    gainFt: t.gainFt,
    difficulty: t.difficulty,
    region: t.region,
    manager: t.manager,
    surface: t.surface,
    routeType: t.routeType ?? null,
    summits: t.summits ?? null,
    is14er: t.is14er ?? false,
  }
}

// app may be served from a sub-path (e.g. GitHub Pages project site)
const BASE = import.meta.env?.BASE_URL ?? '/'

export async function fetchManifest() {
  const res = await fetch(`${BASE}data/regions.json`)
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`)
  return res.json()
}

export async function downloadTrails(onProgress) {
  const manifest = await fetchManifest()
  let done = 0
  const newIds = new Set()
  for (const region of manifest.regions) {
    const res = await fetch(`${BASE}data/${region.file}`)
    if (!res.ok) throw new Error(`${region.file} fetch failed: ${res.status}`)
    const fc = await res.json()
    const rows = fc.features.map((f) => ({
      ...f.properties,
      geometry: f.geometry,
    }))
    for (const r of rows) newIds.add(r.id)
    await db.trails.bulkPut(rows)
    await db.trailIndex.bulkPut(rows.map(toIndexRow))
    done++
    onProgress?.(done / manifest.regions.length, region.name)
  }
  // drop trails that no longer exist in the source data
  const staleIds = (await db.trails.toCollection().primaryKeys()).filter(
    (id) => !newIds.has(id),
  )
  if (staleIds.length) {
    await db.trails.bulkDelete(staleIds)
    await db.trailIndex.bulkDelete(staleIds)
  }
  await db.meta.bulkPut([
    { key: 'downloadedAt', value: new Date().toISOString() },
    { key: 'dataVersion', value: manifest.generated },
  ])
  invalidateIndexCache()
  return db.trails.count()
}

// Backfill trailIndex for data downloaded before the v2 schema
export async function ensureTrailIndex() {
  const [idxCount, trailCount] = await Promise.all([
    db.trailIndex.count(),
    db.trails.count(),
  ])
  if (idxCount === 0 && trailCount > 0) {
    const rows = []
    await db.trails.each((t) => rows.push(toIndexRow(t)))
    await db.trailIndex.bulkPut(rows)
    invalidateIndexCache()
  }
  return trailCount
}

export function getTrailCount() {
  return db.trails.count()
}

export function getTrail(id) {
  return db.trails.get(id)
}

let indexCache = null

function invalidateIndexCache() {
  indexCache = null
}

export async function getTrailIndex() {
  if (!indexCache) indexCache = await db.trailIndex.toArray()
  return indexCache
}

export async function loadTrailsGeoJSON() {
  const trails = await db.trails.toArray()
  return {
    type: 'FeatureCollection',
    features: trails.map((t) => ({
      type: 'Feature',
      id: t.id,
      geometry: t.geometry,
      properties: {
        id: t.id,
        name: t.name,
        difficulty: t.difficulty,
        lengthMi: t.lengthMi,
        is14er: t.is14er ?? false,
      },
    })),
  }
}
