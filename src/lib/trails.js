import { db } from '../db.js'

export async function fetchManifest() {
  const res = await fetch('/data/regions.json')
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`)
  return res.json()
}

export async function downloadTrails(onProgress) {
  const manifest = await fetchManifest()
  let done = 0
  for (const region of manifest.regions) {
    const res = await fetch(`/data/${region.file}`)
    if (!res.ok) throw new Error(`${region.file} fetch failed: ${res.status}`)
    const fc = await res.json()
    const rows = fc.features.map((f) => ({
      ...f.properties,
      geometry: f.geometry,
    }))
    await db.trails.bulkPut(rows)
    done++
    onProgress?.(done / manifest.regions.length, region.name)
  }
  await db.meta.bulkPut([
    { key: 'downloadedAt', value: new Date().toISOString() },
    { key: 'dataVersion', value: manifest.generated },
  ])
  return db.trails.count()
}

export function getTrailCount() {
  return db.trails.count()
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
        name: t.name,
        difficulty: t.difficulty,
        lengthMi: t.lengthMi,
      },
    })),
  }
}
