import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

function UpdateBanner() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  // "ready to work offline" is a one-time FYI — auto-dismiss
  useEffect(() => {
    if (!offlineReady) return
    const t = setTimeout(() => setOfflineReady(false), 5000)
    return () => clearTimeout(t)
  }, [offlineReady, setOfflineReady])

  if (!offlineReady && !needRefresh) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center px-3">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl bg-gray-900/95 px-4 py-3 text-sm text-white shadow-xl">
        {needRefresh ? (
          <>
            <span className="flex-1">A new version is available.</span>
            <button
              type="button"
              onClick={() => updateServiceWorker(true)}
              className="font-semibold text-emerald-400 active:text-emerald-300"
            >
              Update
            </button>
            <button
              type="button"
              onClick={() => setNeedRefresh(false)}
              aria-label="Dismiss"
              className="text-gray-400 active:text-gray-200"
            >
              ✕
            </button>
          </>
        ) : (
          <>
            <span className="flex-1">Ready to work offline.</span>
            <button
              type="button"
              onClick={() => setOfflineReady(false)}
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

export default UpdateBanner
