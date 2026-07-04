import { REGION_NAMES } from '../lib/trails'

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

function TrailDetail({ trail, onClose }) {
  const [lat, lng] = destination(trail)
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`

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
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-gray-600 active:bg-gray-200"
          >
            ✕
          </button>
        </div>

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
      </div>
    </div>
  )
}

export default TrailDetail
