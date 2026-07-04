import { useEffect, useMemo, useRef, useState } from 'react'
import { getTrailIndex, REGION_NAMES } from '../lib/trails'

const MAX_RESULTS = 100

const LENGTH_OPTIONS = [
  { id: 'any', label: 'Any length', test: () => true },
  { id: 'short', label: '< 2 mi', test: (mi) => mi < 2 },
  { id: 'medium', label: '2–5 mi', test: (mi) => mi >= 2 && mi <= 5 },
  { id: 'long', label: '5–10 mi', test: (mi) => mi > 5 && mi <= 10 },
  { id: 'epic', label: '10+ mi', test: (mi) => mi > 10 },
]

const DIFFICULTIES = ['easy', 'moderate', 'hard']

const BADGE = {
  easy: 'bg-emerald-100 text-emerald-800',
  moderate: 'bg-amber-100 text-amber-800',
  hard: 'bg-red-100 text-red-800',
}

const CHIP_ACTIVE = {
  easy: 'bg-emerald-600 text-white',
  moderate: 'bg-amber-600 text-white',
  hard: 'bg-red-600 text-white',
}

function SearchPanel({ onSelect, onClose }) {
  const [index, setIndex] = useState(null)
  const [query, setQuery] = useState('')
  const [difficulties, setDifficulties] = useState(new Set())
  const [lengthId, setLengthId] = useState('any')
  const inputRef = useRef(null)

  useEffect(() => {
    getTrailIndex().then(setIndex)
    inputRef.current?.focus()
  }, [])

  const results = useMemo(() => {
    if (!index) return []
    const q = query.trim().toLowerCase()
    const lengthTest = LENGTH_OPTIONS.find((o) => o.id === lengthId).test
    const starts = []
    const contains = []
    for (const t of index) {
      if (difficulties.size && !difficulties.has(t.difficulty)) continue
      if (!lengthTest(t.lengthMi)) continue
      if (q) {
        const name = t.name.toLowerCase()
        const at = name.indexOf(q)
        if (at === -1) continue
        ;(at === 0 ? starts : contains).push(t)
      } else {
        starts.push(t)
      }
    }
    const byName = (a, b) => a.name.localeCompare(b.name) || b.lengthMi - a.lengthMi
    starts.sort(byName)
    contains.sort(byName)
    return [...starts, ...contains]
  }, [index, query, difficulties, lengthId])

  function toggleDifficulty(d) {
    setDifficulties((prev) => {
      const next = new Set(prev)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-gray-200 p-3">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search trails by name…"
          className="min-w-0 flex-1 rounded-xl bg-gray-100 px-4 py-2.5 text-[16px] outline-none focus:ring-2 focus:ring-emerald-600"
        />
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 px-1 font-medium text-emerald-700"
        >
          Map
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-200 px-3 py-2">
        {DIFFICULTIES.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => toggleDifficulty(d)}
            className={`rounded-full px-3 py-1 text-sm capitalize ${
              difficulties.has(d) ? CHIP_ACTIVE[d] : 'bg-gray-100 text-gray-700'
            }`}
          >
            {d}
          </button>
        ))}
        <span className="mx-1 w-px self-stretch bg-gray-200" />
        {LENGTH_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setLengthId(o.id)}
            className={`rounded-full px-3 py-1 text-sm ${
              lengthId === o.id ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <p className="px-4 pt-2 text-xs text-gray-500">
        {index === null
          ? 'Loading…'
          : `${results.length.toLocaleString()} trails` +
            (results.length > MAX_RESULTS ? ` — showing first ${MAX_RESULTS}` : '')}
      </p>

      <ul className="flex-1 divide-y divide-gray-100 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {results.slice(0, MAX_RESULTS).map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSelect(t)}
              className="w-full px-4 py-3 text-left active:bg-gray-50"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium text-gray-900">{t.name}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs capitalize ${BADGE[t.difficulty]}`}>
                  {t.difficulty}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-gray-500">
                {t.lengthMi} mi
                {t.gainFt ? ` · ${t.gainFt.toLocaleString()} ft gain` : ''}
                {' · '}
                {REGION_NAMES[t.region] ?? t.region}
                {t.manager ? ` · ${t.manager}` : ''}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default SearchPanel
