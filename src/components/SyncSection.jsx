import { useEffect, useState } from 'react'
import {
  getCurrentUser,
  getListsSyncedAt,
  signIn,
  signOutUser,
  signUp,
  syncConfigured,
  syncLists,
} from '../lib/listsSync'
import { formatAge } from '../lib/conditions'

function SyncSection({ onSynced }) {
  const [user, setUser] = useState(null)
  const [checked, setChecked] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [syncedAt, setSyncedAt] = useState(null)

  useEffect(() => {
    if (!syncConfigured()) {
      setChecked(true)
      return
    }
    getListsSyncedAt().then(setSyncedAt)
    getCurrentUser()
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecked(true))
  }, [])

  async function handleSync() {
    setBusy(true)
    setError(null)
    try {
      await syncLists()
      setSyncedAt(await getListsSyncedAt())
      onSynced?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleAuth() {
    setBusy(true)
    setError(null)
    try {
      const u =
        mode === 'signin'
          ? await signIn(email.trim(), password)
          : await signUp(email.trim(), password)
      setUser(u)
      setPassword('')
      await handleSync()
    } catch (err) {
      setError(err.code?.replace('auth/', '').replaceAll('-', ' ') ?? err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleSignOut() {
    await signOutUser()
    setUser(null)
  }

  if (!syncConfigured()) {
    return (
      <div className="border-t border-gray-200 px-4 py-4 text-sm text-gray-500">
        <div className="font-medium text-gray-700">Sync across devices</div>
        Sync isn’t configured yet — lists are saved on this device only.
      </div>
    )
  }

  return (
    <div className="border-t border-gray-200 px-4 py-4 text-sm">
      <div className="font-medium text-gray-700">Sync across devices</div>
      {!checked ? null : user ? (
        <div className="mt-2 space-y-2">
          <div className="text-gray-600">
            Signed in as <span className="font-medium">{user.email}</span>
            {syncedAt ? ` · ${formatAge(syncedAt)}` : ''}
          </div>
          {error && <div className="text-red-600">{error}</div>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSync}
              disabled={busy}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 font-medium text-white disabled:opacity-40"
            >
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-lg bg-gray-100 px-3 py-1.5 text-gray-700"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-gray-500">
            Sign in to back up your lists and see them on other devices.
          </p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
            className="w-full rounded-xl bg-gray-100 px-4 py-2.5 text-[16px] outline-none focus:ring-2 focus:ring-emerald-600"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            className="w-full rounded-xl bg-gray-100 px-4 py-2.5 text-[16px] outline-none focus:ring-2 focus:ring-emerald-600"
          />
          {error && <div className="text-red-600">{error}</div>}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleAuth}
              disabled={busy || !email || !password}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 font-medium text-white disabled:opacity-40"
            >
              {busy ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
            <button
              type="button"
              onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
              className="text-emerald-700"
            >
              {mode === 'signin' ? 'New? Create account' : 'Have an account? Sign in'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default SyncSection
