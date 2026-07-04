import { useEffect, useState } from 'react'
import TrailMap from './components/TrailMap'
import DownloadCard from './components/DownloadCard'
import { getTrailCount } from './lib/trails'

function App() {
  // null = still checking IndexedDB, 0 = no data yet
  const [trailCount, setTrailCount] = useState(null)
  // bumped whenever the trail set in Dexie changes, so the map redraws
  const [trailsVersion, setTrailsVersion] = useState(0)

  useEffect(() => {
    getTrailCount().then((count) => {
      setTrailCount(count)
      if (count > 0) setTrailsVersion(1)
    })
  }, [])

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
      <main className="relative flex-1">
        <TrailMap trailsVersion={trailsVersion} />
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
