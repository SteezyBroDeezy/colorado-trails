import { useEffect, useState } from 'react'
import TrailMap from './components/TrailMap'
import DownloadCard from './components/DownloadCard'
import SearchPanel from './components/SearchPanel'
import TrailDetail from './components/TrailDetail'
import OfflineMapsSheet from './components/OfflineMapsSheet'
import { ensureTrailIndex, getTrail } from './lib/trails'

function App() {
  // null = still checking IndexedDB, 0 = no data yet
  const [trailCount, setTrailCount] = useState(null)
  // bumped whenever the trail set in Dexie changes, so the map redraws
  const [trailsVersion, setTrailsVersion] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [offlineOpen, setOfflineOpen] = useState(false)
  const [selected, setSelected] = useState(null) // full trail row (with geometry)

  useEffect(() => {
    // also backfills the search index for pre-v2 downloads
    ensureTrailIndex().then((count) => {
      setTrailCount(count)
      if (count > 0) setTrailsVersion(1)
    })
  }, [])

  async function handleSelectId(id) {
    const trail = await getTrail(id)
    setSelected(trail)
    setSearchOpen(false)
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="z-10 flex items-center gap-2 bg-emerald-950 px-4 py-3 text-white shadow-md">
        <img src="/favicon.svg" alt="" className="h-6 w-6" />
        <h1 className="text-lg font-semibold tracking-tight">
          Colorado Trails
        </h1>
        {trailCount > 0 && (
          <span className="ml-auto rounded-full bg-emerald-800 px-2.5 py-0.5 text-xs text-emerald-100">
            {trailCount.toLocaleString()} trails offline
          </span>
        )}
      </header>

      {trailCount > 0 && (
        <div className="z-10 bg-emerald-950 px-3 pb-3">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="w-full rounded-xl bg-emerald-900 px-4 py-2.5 text-left text-emerald-200/90"
          >
            {selected ? selected.name : 'Search trails by name…'}
          </button>
        </div>
      )}

      <main className="relative flex-1">
        <TrailMap
          trailsVersion={trailsVersion}
          selected={selected}
          onSelectId={handleSelectId}
        />
        {trailCount > 0 && !selected && !searchOpen && !offlineOpen && (
          <button
            type="button"
            onClick={() => setOfflineOpen(true)}
            aria-label="Offline maps"
            title="Offline maps"
            className="absolute bottom-6 left-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white text-emerald-800 shadow-lg active:bg-gray-100"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v10" />
              <path d="m8 9 4 4 4-4" />
              <path d="M4 17h16" />
              <path d="M4 21h16" />
            </svg>
          </button>
        )}
        {selected && !searchOpen && !offlineOpen && (
          <TrailDetail trail={selected} onClose={() => setSelected(null)} />
        )}
        {offlineOpen && (
          <OfflineMapsSheet onClose={() => setOfflineOpen(false)} />
        )}
        {searchOpen && (
          <SearchPanel
            onSelect={(row) => handleSelectId(row.id)}
            onClose={() => setSearchOpen(false)}
          />
        )}
        {trailCount === 0 && (
          <DownloadCard
            onDownloaded={(count) => {
              setTrailCount(count)
              setTrailsVersion((v) => v + 1)
            }}
          />
        )}
      </main>
    </div>
  )
}

export default App
