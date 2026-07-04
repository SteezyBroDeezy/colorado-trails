import { useEffect, useState } from 'react'
import { deleteList, getLists } from '../lib/lists'
import { getTrailIndex, REGION_NAMES } from '../lib/trails'
import SyncSection from './SyncSection'

const BADGE = {
  easy: 'bg-emerald-100 text-emerald-800',
  moderate: 'bg-amber-100 text-amber-800',
  hard: 'bg-red-100 text-red-800',
}

function ListsPanel({ onSelectTrail, onClose }) {
  const [lists, setLists] = useState(null)
  const [open, setOpen] = useState(null) // list row being viewed
  const [rows, setRows] = useState([])

  async function refresh() {
    const all = await getLists()
    setLists(all)
    if (open) {
      const current = all.find((l) => l.id === open.id)
      setOpen(current ?? null)
    }
  }

  useEffect(() => {
    refresh()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) {
      setRows([])
      return
    }
    getTrailIndex().then((index) => {
      const byId = new Map(index.map((t) => [t.id, t]))
      setRows(open.trailIds.map((id) => byId.get(id)).filter(Boolean))
    })
  }, [open])

  async function handleDelete(id) {
    await deleteList(id)
    setOpen(null)
    refresh()
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-gray-200 p-3">
        {open ? (
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="shrink-0 px-1 font-medium text-emerald-700"
          >
            ‹ Lists
          </button>
        ) : (
          <h2 className="flex-1 px-1 text-lg font-semibold text-gray-900">
            My lists
          </h2>
        )}
        {open && (
          <span className="flex-1 truncate font-semibold text-gray-900">
            {open.name}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 px-1 font-medium text-emerald-700"
        >
          Map
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {!open ? (
          <>
            <ul className="divide-y divide-gray-100">
              {(lists ?? []).map((l) => (
                <li key={l.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setOpen(l)}
                    className="min-w-0 flex-1 px-4 py-3 text-left active:bg-gray-50"
                  >
                    <div className="truncate font-medium text-gray-900">{l.name}</div>
                    <div className="text-sm text-gray-500">
                      {l.trailIds.length} trail{l.trailIds.length === 1 ? '' : 's'}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(l.id)}
                    className="shrink-0 px-4 py-3 text-sm text-red-600"
                  >
                    Delete
                  </button>
                </li>
              ))}
              {lists?.length === 0 && (
                <li className="px-4 py-6 text-sm text-gray-500">
                  No lists yet. Open a trail and tap Save to start one.
                </li>
              )}
            </ul>
            <SyncSection onSynced={refresh} />
          </>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onSelectTrail(t.id)}
                  className="w-full px-4 py-3 text-left active:bg-gray-50"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium text-gray-900">{t.name}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {t.is14er && (
                        <span className="rounded-full bg-yellow-400 px-2 py-0.5 text-xs font-semibold text-yellow-950">
                          14er
                        </span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${BADGE[t.difficulty]}`}>
                        {t.difficulty}
                      </span>
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {t.lengthMi} mi
                    {t.gainFt ? ` · ${t.gainFt.toLocaleString()} ft gain` : ''}
                    {' · '}
                    {REGION_NAMES[t.region] ?? t.region}
                  </p>
                </button>
              </li>
            ))}
            {!rows.length && (
              <li className="px-4 py-6 text-sm text-gray-500">
                This list is empty. (Trails appear after trail data is downloaded.)
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

export default ListsPanel
