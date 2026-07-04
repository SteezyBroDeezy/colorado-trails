import { useEffect, useState } from 'react'
import { REGION_NAMES } from '../lib/trails'
import { formatAge, getAlertsNear, getConditionsState, OUTDATED_AFTER_MS } from '../lib/conditions'
import SaveToListSheet from './SaveToListSheet'

const BADGE = {
  easy: 'bg-emerald-100 text-emerald-800',
  moderate: 'bg-amber-100 text-amber-800',
  hard: 'bg-red-100 text-red-800',
}

// Directions go to the matched COTREX trailhead when we have one,
// otherwise to the start of the trail line
function destination(trail) {
  if (trail.trailhead) return [trail.trailhead.lat, trail.trailhead.lon]
  const g = trail.geometry
  const first = g.type === 'LineString' ? g.coordinates[0] : g.coordinates[0][0]
  return [first[1], first[0]]
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-gray-50 p-2 text-center">
      <div className="text-sm font-semibold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  )
}

function trailBbox(geometry) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const lines =
    geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates
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

function TrailDetail({ trail, onClose }) {
  const [lat, lng] = destination(trail)
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
  const cotrexUrl = `https://trails.colorado.gov/search?q=${encodeURIComponent(trail.name)}`
  const [nearby, setNearby] = useState(null) // {alerts, syncedAt}
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([getAlertsNear(trailBbox(trail.geometry)), getConditionsState()]).then(
      ([alerts, state]) => {
        if (!cancelled) setNearby({ alerts, syncedAt: state.syncedAt })
      },
    )
    return () => {
      cancelled = true
    }
  }, [trail])

  const facts = [
    ['Dogs', trail.dogs],
    ['Season', trail.seasonality],
    ['Managed by', trail.manager],
    ['Region', REGION_NAMES[trail.region] ?? trail.region],
  ].filter(([, v]) => v)

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 max-h-[60%] overflow-y-auto rounded-t-2xl bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(0,0,0,0.2)]">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold leading-tight text-gray-900">
              {trail.name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${BADGE[trail.difficulty]}`}>
                {trail.difficulty}
              </span>
              {trail.trailNum && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  #{trail.trailNum}
                </span>
              )}
              {trail.surface && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">
                  {trail.surface}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={() => setSaving(true)}
              aria-label="Save to list"
              title="Save to list"
              className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800 active:bg-emerald-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="inline" aria-hidden="true">
                <path d="M6 2h12a1 1 0 0 1 1 1v19l-7-4.5L5 22V3a1 1 0 0 1 1-1z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-600 active:bg-gray-200"
            >
              ✕
            </button>
          </div>
        </div>
        {saving && (
          <SaveToListSheet trail={trail} onClose={() => setSaving(false)} />
        )}

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="miles" value={trail.lengthMi} />
          <Stat
            label="ft gain"
            value={trail.gainFt != null ? trail.gainFt.toLocaleString() : '—'}
          />
          <Stat
            label="elevation"
            value={
              trail.minElevFt
                ? `${trail.minElevFt.toLocaleString()}–${trail.maxElevFt.toLocaleString()}`
                : '—'
            }
          />
        </div>

        {facts.length > 0 && (
          <dl className="mt-3 space-y-1 text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="w-24 shrink-0 text-gray-500">{label}</dt>
                <dd className="text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm">
          {trail.trailhead ? (
            <>
              <div className="font-medium text-emerald-900">
                {trail.trailhead.name ?? 'Trailhead'}
              </div>
              <div className="mt-0.5 text-emerald-800">
                Restrooms: {trail.trailhead.bathrooms ?? '?'} · Fee:{' '}
                {trail.trailhead.fee ?? '?'} · Water: {trail.trailhead.water ?? '?'}
              </div>
            </>
          ) : (
            <div className="text-emerald-900">
              No mapped trailhead — directions lead to the start of the trail.
            </div>
          )}
        </div>

        {nearby?.syncedAt != null && (
          <div
            className={`mt-3 rounded-xl p-3 text-sm ${
              nearby.alerts.length ? 'bg-red-50' : 'bg-gray-50'
            }`}
          >
            {nearby.alerts.length ? (
              <>
                <div className="font-medium text-red-900">
                  🔥 Wildfire activity nearby
                </div>
                <ul className="mt-1 space-y-0.5 text-red-800">
                  {nearby.alerts.slice(0, 3).map((a) => (
                    <li key={a.id}>
                      {a.name}
                      {a.distanceMi ? ` · ~${a.distanceMi} mi away` : ' · overlaps this area'}
                      {a.sizeAcres ? ` · ${Math.round(a.sizeAcres).toLocaleString()} ac` : ''}
                      {a.contained != null ? ` · ${a.contained}% contained` : ''}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="text-gray-600">No wildfire activity nearby.</div>
            )}
            <div
              className={`mt-1 text-xs ${
                Date.now() - nearby.syncedAt > OUTDATED_AFTER_MS
                  ? 'font-medium text-amber-700'
                  : 'text-gray-400'
              }`}
            >
              Wildfire data {formatAge(nearby.syncedAt)}
              {Date.now() - nearby.syncedAt > OUTDATED_AFTER_MS
                ? ' — outdated, sync when online'
                : ''}
            </div>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-xl bg-emerald-700 py-2.5 text-center font-medium text-white active:bg-emerald-800"
          >
            Directions
          </a>
          {trail.url && (
            <a
              href={trail.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 rounded-xl bg-gray-100 py-2.5 text-center font-medium text-gray-800 active:bg-gray-200"
            >
              Trail info
            </a>
          )}
        </div>
        <a
          href={cotrexUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block text-center text-sm text-emerald-700 underline underline-offset-2"
        >
          Community reports &amp; closures on COTREX ↗
        </a>
      </div>
    </div>
  )
}

export default TrailDetail
