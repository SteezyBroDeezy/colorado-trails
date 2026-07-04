import { useEffect, useState } from 'react'
import { db } from '../db'
import { downloadTrails, fetchManifest } from '../lib/trails'

// Checks once per launch (online only) whether the published trail data
// is newer than what's in IndexedDB, and offers a one-tap update.
function DataUpdateBanner({ onUpdated }) {
  const [available, setAvailable] = useState(false)
  const [progress, setProgress] = useState(null) // null | 0..1
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!navigator.onLine) return
    let cancelled = false
    Promise.all([fetchManifest(), db.meta.get('dataVersion')]).then(
      ([manifest, meta]) => {
        if (cancelled) return
        if (meta?.value && manifest.generated !== meta.value) setAvailable(true)
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [])

  if (!available) return null

  async function handleUpdate() {
    setError(null)
    setProgress(0)
    try {
      const count = await downloadTrails((pct) => setProgress(pct))
      setAvailable(false)
      onUpdated(count)
    } catch (err) {
      setError(err.message)
      setProgress(null)
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center px-3">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl bg-gray-900/95 px-4 py-3 text-sm text-white shadow-xl">
        <span className="flex-1">
          {error
            ? `Update failed: ${error}`
            : progress != null
              ? `Updating trail data… ${Math.round(progress * 100)}%`
              : 'Updated trail data is available.'}
        </span>
        {progress == null && (
          <>
            <button
              type="button"
              onClick={handleUpdate}
              className="font-semibold text-emerald-400 active:text-emerald-300"
            >
              Update
            </button>
            <button
              type="button"
              onClick={() => setAvailable(false)}
              aria-label="Dismiss"
              className="text-gray-400 active:text-gray-200"
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default DataUpdateBanner
