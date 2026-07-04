import { useEffect, useState } from 'react'
import TrailMap from './components/TrailMap'
import DownloadCard from './components/DownloadCard'
import SearchPanel from './components/SearchPanel'
import TrailDetail from './components/TrailDetail'
import OfflineMapsSheet from './components/OfflineMapsSheet'
import UpdateBanner from './components/UpdateBanner'
import ConditionsControl from './components/ConditionsControl'
import ListsPanel from './components/ListsPanel'
import DataUpdateBanner from './components/DataUpdateBanner'
import { ensureTrailIndex, getTrail } from './lib/trails'

function App() {
  // null = still checking IndexedDB, 0 = no data yet
  const [trailCount, setTrailCount] = useState(null)
  // bumped whenever the trail set in Dexie changes, so the map redraws
  const [trailsVersion, setTrailsVersion] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [offlineOpen, setOfflineOpen] = useState(false)
  const [listsOpen, setListsOpen] = useState(false)
  const [selected, setSelected] = useState(null) // full trail row (with geometry)
  // wildfire overlay: opt-in, remembered across sessions
  const [conditionsOn, setConditionsOn] = useState(
    () => localStorage.getItem('conditionsOn') === '1',
  )
  const [conditionsVersion, setConditionsVersion] = useState(0)

  function toggleConditions(on) {
    setConditionsOn(on)
    localStorage.setItem('conditionsOn', on ? '1' : '0')
  }

  useEffect(() => {
    // also backfills the search index for pre-v2 downloads
    ensureTrailIndex().then((count) => {
      setTrailCount(count)
      if (count > 0) setTrailsVersion(1)
    })
  }, [])

  // toggle=true (map taps): tapping the selected trail again deselects it
  async function handleSelectId(id, toggle = false) {
    if (toggle && selected?.id === id) {
      setSelected(null)
      return
    }
    const trail = await getTrail(id)
    setSelected(trail)
    setSearchOpen(false)
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="z-10 flex items-center gap-2 bg-emerald-950 px-4 py-3 text-white shadow-md">
        <img
          src={`${import.meta.env?.BASE_URL ?? '/'}favicon.svg`}
          alt=""
          className="h-6 w-6"
        />
        <h1 className="text-lg font-semibold tracking-tight">
          Colorado Trails
        </h1>
        {trailCount > 0 && (
          <span className="ml-auto rounded-full bg-emerald-800 px-2.5 py-0.5 text-xs text-emerald-100">
            {trailCount.toLocaleString()} trails offline
          </span>
        )}
        {trailCount > 0 && (
          <button
            type="button"
            onClick={() => {
              setListsOpen(true)
              setSearchOpen(false)
              setOfflineOpen(false)
            }}
            aria-label="My lists"
            title="My lists"
            className="rounded-full bg-emerald-800 p-1.5 text-emerald-100 active:bg-emerald-700"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 2h12a1 1 0 0 1 1 1v19l-7-4.5L5 22V3a1 1 0 0 1 1-1z" />
            </svg>
          </button>
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
        <UpdateBanner />
        {trailCount > 0 && (
          <DataUpdateBanner
            onUpdated={(count) => {
              setTrailCount(count)
              setTrailsVersion((v) => v + 1)
            }}
          />
        )}
        <TrailMap
          trailsVersion={trailsVersion}
          selected={selected}
          onSelectId={(id) => handleSelectId(id, true)}
          conditionsOn={conditionsOn}
          conditionsVersion={conditionsVersion}
        />
        {trailCount > 0 && !searchOpen && !offlineOpen && (
          <ConditionsControl
            on={conditionsOn}
            onToggle={toggleConditions}
            onDataChanged={() => setConditionsVersion((v) => v + 1)}
          />
        )}
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
          <OfflineMapsSheet
            onClose={() => setOfflineOpen(false)}
            onTrailsUpdated={(count) => {
              setTrailCount(count)
              setTrailsVersion((v) => v + 1)
            }}
          />
        )}
        {searchOpen && (
          <SearchPanel
            onSelect={(row) => handleSelectId(row.id)}
            onClose={() => setSearchOpen(false)}
          />
        )}
        {listsOpen && (
          <ListsPanel
            onSelectTrail={(id) => {
              setListsOpen(false)
              handleSelectId(id)
            }}
            onClose={() => setListsOpen(false)}
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
