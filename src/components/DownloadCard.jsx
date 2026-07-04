import { useEffect, useState } from 'react'
import { downloadTrails, fetchManifest } from '../lib/trails'

function DownloadCard({ onDownloaded }) {
  const [manifest, setManifest] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [regionName, setRegionName] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchManifest().then(setManifest).catch(() => {})
  }, [])

  const totalMb = manifest
    ? Math.round(manifest.regions.reduce((sum, r) => sum + r.bytes, 0) / 1e6)
    : null
  const totalCount = manifest
    ? manifest.regions.reduce((sum, r) => sum + r.count, 0)
    : null

  async function handleDownload() {
    setDownloading(true)
    setError(null)
    try {
      const count = await downloadTrails((pct, name) => {
        setProgress(pct)
        setRegionName(name)
      })
      onDownloaded(count)
    } catch (err) {
      setError(err.message)
      setDownloading(false)
    }
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-4 shadow-xl">
        <h2 className="font-semibold text-gray-900">Get trail data</h2>
        <p className="mt-1 text-sm text-gray-600">
          Download{' '}
          {totalCount ? `${totalCount.toLocaleString()} Colorado trails` : 'all Colorado trails'}
          {totalMb ? ` (~${totalMb} MB, less over the wire)` : ''} for offline
          use. One time — after this, browsing and search work without signal.
        </p>
        {error && (
          <p className="mt-2 text-sm text-red-600">
            Download failed: {error}. Check your connection and try again.
          </p>
        )}
        {downloading ? (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-emerald-600 transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">{regionName}…</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleDownload}
            className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 font-medium text-white active:bg-emerald-800"
          >
            Download Trails
          </button>
        )}
      </div>
    </div>
  )
}

export default DownloadCard
