import Dexie from 'dexie'

export const db = new Dexie('colorado-trails')

db.version(1).stores({
  // geometry and detail fields ride along unindexed
  trails: 'id, name, region, difficulty, lengthMi',
  meta: 'key',
})
