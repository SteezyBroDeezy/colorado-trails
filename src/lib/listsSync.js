// Firebase list sync. The firebase SDK is imported dynamically so it
// lands in a separate lazy chunk — users who never sign in never load
// it. Merge strategy: last-write-wins per list on updatedAt, tombstones
// (deletedAt) propagate deletes; the pure merge lives in lists.js.
import { db } from '../db.js'
import { mergeListRows } from './lists.js'
import { firebaseConfig } from './firebaseConfig.js'

export function syncConfigured() {
  return firebaseConfig != null
}

let servicesPromise = null

async function services() {
  if (!syncConfigured()) throw new Error('Sync is not configured')
  servicesPromise ??= (async () => {
    const [{ initializeApp }, authMod, fsMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ])
    const app = initializeApp(firebaseConfig)
    return { auth: authMod.getAuth(app), authMod, dbFs: fsMod.getFirestore(app), fsMod }
  })()
  return servicesPromise
}

export async function getCurrentUser() {
  if (!syncConfigured()) return null
  const { auth, authMod } = await services()
  await authMod.setPersistence(auth, authMod.browserLocalPersistence)
  return new Promise((resolve) => {
    const stop = authMod.onAuthStateChanged(auth, (user) => {
      stop()
      resolve(user)
    })
  })
}

export async function signIn(email, password) {
  const { auth, authMod } = await services()
  const cred = await authMod.signInWithEmailAndPassword(auth, email, password)
  return cred.user
}

export async function signUp(email, password) {
  const { auth, authMod } = await services()
  const cred = await authMod.createUserWithEmailAndPassword(auth, email, password)
  return cred.user
}

export async function signOutUser() {
  const { auth, authMod } = await services()
  await authMod.signOut(auth)
}

export async function syncLists() {
  const user = await getCurrentUser()
  if (!user) throw new Error('Not signed in')
  const { dbFs, fsMod } = await services()
  const col = fsMod.collection(dbFs, 'users', user.uid, 'lists')

  const [localRows, snapshot] = await Promise.all([
    db.lists.toArray(),
    fsMod.getDocs(col),
  ])
  const remoteRows = snapshot.docs.map((d) => d.data())

  const { writeLocal, pushIds } = mergeListRows(localRows, remoteRows)

  if (writeLocal.length) await db.lists.bulkPut(writeLocal)
  const byId = new Map(localRows.map((l) => [l.id, l]))
  for (const id of pushIds) {
    const row = byId.get(id)
    await fsMod.setDoc(fsMod.doc(col, id), row)
  }

  await db.meta.put({ key: 'listsSyncedAt', value: Date.now() })
  return { pulled: writeLocal.length, pushed: pushIds.length }
}

export async function getListsSyncedAt() {
  const meta = await db.meta.get('listsSyncedAt')
  return meta?.value ?? null
}
