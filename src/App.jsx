import TrailMap from './components/TrailMap'

function App() {
  return (
    <div className="flex h-dvh flex-col">
      <header className="z-10 flex items-center gap-2 bg-emerald-950 px-4 py-3 text-white shadow-md">
        <img src="/favicon.svg" alt="" className="h-6 w-6" />
        <h1 className="text-lg font-semibold tracking-tight">
          Colorado Trails
        </h1>
      </header>
      <main className="relative flex-1">
        <TrailMap />
      </main>
    </div>
  )
}

export default App
