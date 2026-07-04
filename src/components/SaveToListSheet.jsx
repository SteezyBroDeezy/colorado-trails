import { useEffect, useState } from 'react'
import {
  createList,
  getLists,
  listIdsContaining,
  toggleTrailInList,
} from '../lib/lists'

function SaveToListSheet({ trail, onClose, onChanged }) {
  const [lists, setLists] = useState([])
  const [memberOf, setMemberOf] = useState(new Set())
  const [newName, setNewName] = useState('')

  async function refresh() {
    const [all, member] = await Promise.all([
      getLists(),
      listIdsContaining(trail.id),
    ])
    setLists(all)
    setMemberOf(member)
  }

  useEffect(() => {
    refresh()
  }, [trail.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleToggle(listId) {
    await toggleTrailInList(listId, trail.id)
    onChanged?.()
    refresh()
  }

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    const row = await createList(name)
    setNewName('')
    await toggleTrailInList(row.id, trail.id)
    onChanged?.()
    refresh()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/30" onClick={onClose}>
      <div
        className="max-h-[70%] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">
            Save “{trail.name}”
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-600"
          >
            ✕
          </button>
        </div>

        <ul className="mt-3 divide-y divide-gray-100">
          {lists.map((l) => (
            <li key={l.id}>
              <label className="flex cursor-pointer items-center gap-3 py-2.5">
                <input
                  type="checkbox"
                  checked={memberOf.has(l.id)}
                  onChange={() => handleToggle(l.id)}
                  className="h-5 w-5 accent-emerald-700"
                />
                <span className="flex-1 text-gray-900">{l.name}</span>
                <span className="text-sm text-gray-400">{l.trailIds.length}</span>
              </label>
            </li>
          ))}
          {!lists.length && (
            <li className="py-2.5 text-sm text-gray-500">
              No lists yet — create one below.
            </li>
          )}
        </ul>

        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="New list name…"
            className="min-w-0 flex-1 rounded-xl bg-gray-100 px-4 py-2.5 text-[16px] outline-none focus:ring-2 focus:ring-emerald-600"
          />
          <button
            type="button"
            onClick={handleCreate}
            className="shrink-0 rounded-xl bg-emerald-700 px-4 py-2.5 font-medium text-white active:bg-emerald-800"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

export default SaveToListSheet
