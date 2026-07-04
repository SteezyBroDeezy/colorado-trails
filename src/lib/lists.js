import { db } from '../db.js'

// Lists are local-first. Deletes are soft (deletedAt tombstone) so a
// later sync can propagate them instead of resurrecting the list.

export async function getLists() {
  const rows = await db.lists.toArray()
  return rows
    .filter((l) => !l.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function createList(name) {
  const now = Date.now()
  const row = {
    id: crypto.randomUUID(),
    name: name.trim(),
    trailIds: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
  await db.lists.put(row)
  return row
}

export async function deleteList(id) {
  const row = await db.lists.get(id)
  if (!row) return
  await db.lists.put({ ...row, deletedAt: Date.now(), updatedAt: Date.now() })
}

export async function toggleTrailInList(listId, trailId) {
  const row = await db.lists.get(listId)
  if (!row || row.deletedAt) return null
  const has = row.trailIds.includes(trailId)
  const trailIds = has
    ? row.trailIds.filter((t) => t !== trailId)
    : [...row.trailIds, trailId]
  const next = { ...row, trailIds, updatedAt: Date.now() }
  await db.lists.put(next)
  return next
}

export async function listIdsContaining(trailId) {
  const lists = await getLists()
  return new Set(lists.filter((l) => l.trailIds.includes(trailId)).map((l) => l.id))
}

// Pure last-write-wins merge, shared by Firebase sync and tests.
// Returns rows to write locally, and ids whose local copy must be pushed.
export function mergeListRows(localRows, remoteRows) {
  const byId = new Map(localRows.map((l) => [l.id, { local: l }]))
  for (const r of remoteRows) {
    byId.set(r.id, { ...byId.get(r.id), remote: r })
  }
  const writeLocal = []
  const pushIds = []
  const resolved = []
  for (const [id, { local, remote }] of byId) {
    if (local && !remote) {
      pushIds.push(id)
      resolved.push(local)
    } else if (remote && !local) {
      writeLocal.push(remote)
      resolved.push(remote)
    } else if (remote.updatedAt > local.updatedAt) {
      writeLocal.push(remote)
      resolved.push(remote)
    } else {
      if (remote.updatedAt < local.updatedAt) pushIds.push(id)
      resolved.push(local)
    }
  }
  return { resolved, writeLocal, pushIds }
}
