import { useEffect, useState } from 'react'
import {
  autoRefreshIfStale,
  formatAge,
  getConditionsState,
  syncConditions,
  OUTDATED_AFTER_MS,
} from '../lib/conditions'

// Wildfire overlay control: strictly opt-in. The overlay never draws
// unless toggled on, and the chip always shows how old the data is so
// stale offline data can't masquerade as current.
function ConditionsControl({ on, onToggle, onDataChanged }) {
  const [state, setState] = useState({ syncedAt: null, count: 0 })
  const [syncing, setSyncing] = useState(false)

  async function refreshState() {
    setState(await getConditionsState())
  }

  useEffect(() => {
    refreshState()
  }, [])

  useEffect(() => {
    if (!on) return
    autoRefreshIfStale()
      .then((refreshed) => {
        if (refreshed) onDataChanged()
      })
      .catch(() => {})
      .finally(refreshState)
  }, [on]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSync() {
    if (syncing || !navigator.onLine) return
    setSyncing(true)
    try {
      await syncConditions()
      onDataChanged()
    } catch {
      // offline or feed down — chip keeps showing the honest age
    } finally {
      setSyncing(false)
      refreshState()
    }
  }

  const outdated = state.syncedAt && Date.now() - state.syncedAt > OUTDATED_AFTER_MS

  return (
    <>
      <button
        type="button"
        onClick={() => onToggle(!on)}
        aria-label="Wildfire overlay"
        title="Wildfire overlay"
        className={`absolute bottom-20 left-3 z-10 flex h-11 w-11 items-center justify-center rounded-full shadow-lg active:opacity-80 ${
          on ? 'bg-red-600 text-white' : 'bg-white text-red-600'
        }`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2c.7 3.4-.8 5.1-2.3 6.7C8.2 10.3 7 11.9 7 14a5 5 0 0 0 10 0c0-1.3-.4-2.4-1-3.4-.9 1-2 1.4-2 1.4.7-2.6-.2-6.4-2-10z" />
        </svg>
      </button>
      {on && (
        <button
          type="button"
          onClick={handleSync}
          className={`absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg ${
            outdated
              ? 'bg-amber-500 text-amber-950'
              : 'bg-gray-900/90 text-white'
          }`}
        >
          {syncing
            ? 'Syncing…'
            : `🔥 ${state.count} wildfire features · ${formatAge(state.syncedAt)}` +
              (outdated ? ' — outdated, tap to sync' : navigator.onLine ? ' · tap to sync' : ' · offline')}
        </button>
      )}
    </>
  )
}

export default ConditionsControl
