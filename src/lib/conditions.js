import { db } from '../db.js'

// NIFC WFIGS public services — current wildfire perimeters + incident
// points. There is no clean public feed for USFS/BLM closure orders or
// COTREX community reports; per-trail links to COTREX cover those.
const NIFC =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services'
const PERIMETERS_URL = `${NIFC}/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query`
const INCIDENTS_URL = `${NIFC}/WFIGS_Incident_Locations_Current/FeatureServer/0/query`

export const STALE_AFTER_MS = 24 * 3600 * 1000 // auto-refresh threshold
export const OUTDATED_AFTER_MS = 7 * 24 * 3600 * 1000 // loud warning

function geomBbox(geometry) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < w) w = c[0]
      if (c[0] > e) e = c[0]
      if (c[1] < s) s = c[1]
      if (c[1] > n) n = c[1]
    } else {
      for (const child of c) walk(child)
    }
  }
  walk(geometry.coordinates)
  return [w, s, e, n]
}

async function fetchAll(url, params) {
  const features = []
  for (let offset = 0; ; ) {
    const qs = new URLSearchParams({
      ...params,
      geometryPrecision: '4',
      outSR: '4326',
      resultOffset: String(offset),
      f: 'geojson',
    })
    const res = await fetch(`${url}?${qs}`)
    if (!res.ok) throw new Error(`conditions fetch failed: ${res.status}`)
    const body = await res.json()
    features.push(...(body.features ?? []))
    if (!body.properties?.exceededTransferLimit || !body.features?.length) break
    offset += body.features.length
  }
  return features
}

export async function syncConditions() {
  const [perimeters, incidents] = await Promise.all([
    fetchAll(PERIMETERS_URL, {
      where: "attr_POOState='US-CO'",
      outFields:
        'OBJECTID,attr_IncidentName,attr_IncidentSize,attr_PercentContained,attr_FireDiscoveryDateTime',
    }),
    fetchAll(INCIDENTS_URL, {
      where: "POOState='US-CO'",
      outFields:
        'OBJECTID,IncidentName,IncidentSize,PercentContained,FireDiscoveryDateTime,IncidentTypeCategory',
    }),
  ])

  const rows = []
  for (const f of perimeters) {
    if (!f.geometry) continue
    const a = f.properties
    rows.push({
      id: `peri-${a.OBJECTID}`,
      kind: 'perimeter',
      name: a.attr_IncidentName?.trim() || 'Unnamed fire',
      sizeAcres: a.attr_IncidentSize ?? null,
      contained: a.attr_PercentContained ?? null,
      discovered: a.attr_FireDiscoveryDateTime ?? null,
      bbox: geomBbox(f.geometry),
      geometry: f.geometry,
    })
  }
  for (const f of incidents) {
    if (!f.geometry) continue
    const a = f.properties
    rows.push({
      id: `pt-${a.OBJECTID}`,
      kind: 'incident',
      name: a.IncidentName?.trim() || 'Unnamed incident',
      sizeAcres: a.IncidentSize ?? null,
      contained: a.PercentContained ?? null,
      discovered: a.FireDiscoveryDateTime ?? null,
      category: a.IncidentTypeCategory ?? null,
      bbox: geomBbox(f.geometry),
      geometry: f.geometry,
    })
  }

  await db.transaction('rw', db.alerts, db.meta, async () => {
    await db.alerts.clear()
    await db.alerts.bulkPut(rows)
    await db.meta.put({ key: 'conditionsSyncedAt', value: Date.now() })
  })
  return { fires: perimeters.length, incidents: incidents.length }
}

export async function getConditionsState() {
  const [meta, count] = await Promise.all([
    db.meta.get('conditionsSyncedAt'),
    db.alerts.count(),
  ])
  return { syncedAt: meta?.value ?? null, count }
}

// If the overlay is on, we're online, and data is stale — refresh quietly.
export async function autoRefreshIfStale() {
  const { syncedAt } = await getConditionsState()
  if (!navigator.onLine) return false
  if (syncedAt && Date.now() - syncedAt < STALE_AFTER_MS) return false
  await syncConditions()
  return true
}

export async function conditionsGeoJSON() {
  const alerts = await db.alerts.toArray()
  const toFC = (kind) => ({
    type: 'FeatureCollection',
    features: alerts
      .filter((a) => a.kind === kind)
      .map((a) => ({
        type: 'Feature',
        geometry: a.geometry,
        properties: { name: a.name, sizeAcres: a.sizeAcres, contained: a.contained },
      })),
  })
  return { perimeters: toFC('perimeter'), incidents: toFC('incident') }
}

const NEAR_DEG = 0.15 // ~10 mi search halo around a trail's bbox

export async function getAlertsNear(trailBbox) {
  const [w, s, e, n] = trailBbox
  const alerts = await db.alerts.toArray()
  const near = []
  for (const a of alerts) {
    const [aw, as_, ae, an] = a.bbox
    const dx = Math.max(aw - e, w - ae, 0)
    const dy = Math.max(as_ - n, s - an, 0)
    const gap = Math.hypot(dx, dy)
    if (gap <= NEAR_DEG) near.push({ ...a, distanceMi: Math.round(gap * 69) })
  }
  // dedupe fires that appear as both perimeter and point: keep perimeter
  const seen = new Set()
  return near
    .sort((a, b) => (a.kind === 'perimeter' ? -1 : 1) - (b.kind === 'perimeter' ? -1 : 1) || a.distanceMi - b.distanceMi)
    .filter((a) => {
      const key = a.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.distanceMi - b.distanceMi)
}

export function formatAge(syncedAt) {
  if (!syncedAt) return 'never synced'
  const mins = Math.round((Date.now() - syncedAt) / 60000)
  if (mins < 60) return `synced ${mins}m ago`
  if (mins < 48 * 60) return `synced ${Math.round(mins / 60)}h ago`
  return `synced ${Math.round(mins / 1440)}d ago`
}
