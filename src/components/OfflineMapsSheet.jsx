import { useEffect, useRef, useState } from 'react'
import { fetchManifest } from '../lib/trails'
import {
  downloadRegion,
  deleteRegion,
  estimateRegionBytes,
  getOfflineState,
} from '../lib/offlineMaps'

function fmtMb(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`
}

function OfflineMapsSheet({ onClose }) {
  const [manifest, setManifest] = useState(null)
  const [state, setState] = useState({ regions: {}, storage: null })
  const [busy, setBusy] = useState(null) // { id, pct }
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  useEffect(() => {
    fetchManifest().then(setManifest).catch(() => setError('Region list needs network once.'))
    getOfflineState().then(setState)
    return () => abortRef.current?.abort()
  }, [])

  async function handleDownload(region) {
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    setBusy({ id: region.id, pct: 0 })
    try {
      await downloadRegion(
        region,
        (pct) => setBusy({ id: region.id, pct }),
        controller.signal,
      )
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setError(`Download failed: ${err.message}`)
      }
    } finally {
      setBusy(null)
      setState(await getOfflineState())
    }
  }

  async function handleDelete(regionId) {
    setBusy({ id: regionId, pct: null })
    await deleteRegion(regionId)
    setBusy(null)
    setState(await getOfflineState())
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 max-h-[75%] overflow-y-auto rounded-t-2xl bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(0,0,0,0.2)]">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Offline maps</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-600 active:bg-gray-200"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          Download map tiles by region so the basemap works without signal.
          Areas you browse online are saved automatically too.
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <ul className="mt-3 divide-y divide-gray-100">
          {(manifest?.regions ?? []).map((region) => {
            const dl = state.regions[region.id]
            const isBusy = busy?.id === region.id
            return (
              <li key={region.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900">{region.name}</div>
                  <div className="text-sm text-gray-500">
                    {region.count.toLocaleString()} trails ·{' '}
                    {dl
                      ? `downloaded · ${fmtMb(dl.bytes)}`
                      : `~${Math.round(estimateRegionBytes(region.bbox) / 1e6)} MB`}
                  </div>
                  {isBusy && busy.pct != null && (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-emerald-600 transition-all"
                        style={{ width: `${Math.round(busy.pct * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
                {isBusy ? (
                  busy.pct != null ? (
                    <button
                      type="button"
                      onClick={() => abortRef.current?.abort()}
                      className="shrink-0 rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700"
                    >
                      Cancel
                    </button>
                  ) : (
                    <span className="text-sm text-gray-400">…</span>
                  )
                ) : dl ? (
                  <button
                    type="button"
                    onClick={() => handleDelete(region.id)}
                    className="shrink-0 rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-red-600 active:bg-gray-200"
                  >
                    Delete
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleDownload(region)}
                    disabled={busy != null}
                    className="shrink-0 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white active:bg-emerald-800 disabled:opacity-40"
                  >
                    Download
                  </button>
                )}
              </li>
            )
          })}
        </ul>

        {state.storage?.usage != null && (
          <p className="mt-2 text-xs text-gray-400">
            Storage used: {fmtMb(state.storage.usage)}
            {state.storage.quota ? ` of ${Math.round(state.storage.quota / 1e9)} GB available` : ''}
          </p>
        )}
      </div>
    </div>
  )
}

export default OfflineMapsSheet
