import Dexie from 'dexie'

export const db = new Dexie('colorado-trails')

db.version(1).stores({
  // geometry and detail fields ride along unindexed
  trails: 'id, name, region, difficulty, lengthMi',
  meta: 'key',
})

// v2: trailIndex = geometry-free copy of search/list fields, so search
// never has to deserialize 26 MB of coordinates
db.version(2).stores({
  trails: 'id, name, region, difficulty, lengthMi',
  trailIndex: 'id, name',
  meta: 'key',
})

// v3: alerts = synced wildfire/conditions features; lists = saved trail
// lists (soft-deleted via deletedAt so removals can sync)
db.version(3).stores({
  trails: 'id, name, region, difficulty, lengthMi',
  trailIndex: 'id, name',
  alerts: 'id, kind',
  lists: 'id, name, updatedAt',
  meta: 'key',
})
