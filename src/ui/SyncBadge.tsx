import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { client, currentSession, isConfigured, setPassword, signIn, signInWithPassword, signOut } from '../lib/supabase'
import { Sheet } from './Sheet'
import { onSyncState, pendingCount, startSync, syncNow, type SyncState } from '../lib/sync'

const DOT: Record<SyncState, { cls: string; label: string }> = {
  idle: { cls: 'ok', label: 'Synced' },
  syncing: { cls: 'busy', label: 'Syncing…' },
  offline: { cls: 'off', label: 'Offline — changes are queued' },
  'signed-out': { cls: 'off', label: 'Not signed in — working locally' },
  error: { cls: 'err', label: 'Sync failed' },
}

/**
 * The header's sync dot. Doubles as the entry point to sign-in, because sync is
 * the only reason this app has auth at all.
 */
export function SyncBadge() {
  const [state, setState] = useState<SyncState>('signed-out')
  const [detail, setDetail] = useState<string>()
  const [session, setSession] = useState<Session | null>(null)
  const [pending, setPending] = useState(0)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const off = onSyncState((s, d) => {
      setState(s)
      setDetail(d)
      void pendingCount().then(setPending)
    })
    void currentSession().then(setSession)
    const { data } = client?.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (next) void syncNow()
    }) ?? { data: null }
    const stop = startSync()
    void pendingCount().then(setPending)
    return () => { off(); stop(); data?.subscription.unsubscribe() }
  }, [])

  const dot = DOT[state]
  const title = detail ? `${dot.label} — ${detail}` : dot.label

  return (
    <>
      <button
        className="btn ghost"
        style={{ minHeight: 32, padding: '0 8px', gap: 6 }}
        onClick={() => setOpen(true)}
        title={title}
        aria-label={`Sync status: ${dot.label}`}
      >
        <span className={`sync-dot ${dot.cls}`} />
        {/* The queue depth only means something once there is somewhere to sync
            to — signed out, every row is "pending" forever and the number is noise. */}
        {pending > 0 && state !== 'signed-out' && (
          <span className="small dim">{pending > 99 ? '99+' : pending}</span>
        )}
      </button>
      {open && (
        <AccountSheet
          onOpened={() => void pendingCount().then(setPending)}
          session={session}
          state={state}
          detail={detail}
          pending={pending}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function AccountSheet({ session, state, detail, pending, onClose, onOpened }: {
  session: Session | null
  state: SyncState
  detail?: string
  pending: number
  onClose: () => void
  onOpened: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPasswordValue] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPasswordSetup, setShowPasswordSetup] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)

  // The queue drains in the background; re-read it so the panel does not show a
  // count left over from before the last sync finished.
  useEffect(onOpened, [onOpened])

  async function submitPassword() {
    if (!email.trim() || !password) return
    setBusy(true)
    const { error: err } = await signInWithPassword(email.trim(), password)
    setBusy(false)
    setError(err)
  }

  async function submitMagicLink() {
    if (!email.trim()) return
    setBusy(true)
    const { error: err } = await signIn(email.trim())
    setBusy(false)
    if (err) setError(err)
    else { setSent(true); setError(null) }
  }

  async function savePassword() {
    if (newPassword.length < 8) { setError('Use at least 8 characters.'); return }
    setBusy(true)
    const { error: err } = await setPassword(newPassword)
    setBusy(false)
    if (err) setError(err)
    else { setPasswordSaved(true); setError(null); setNewPassword('') }
  }

  return (
    <Sheet label="Sync and account" onClose={onClose}>
      <>
        <div className="spread" style={{ marginBottom: 12 }}>
          <strong>Sync</strong>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="muted-box small">
          <div className="row">
            <span className={`sync-dot ${DOT[state].cls}`} />
            <span>{DOT[state].label}</span>
          </div>
          {detail && <div className="dim" style={{ marginTop: 6 }}>{detail}</div>}
          {/* "waiting to upload" is only meaningful if there is somewhere to
              upload to — an unconfigured build queues rows that go nowhere. */}
          {pending > 0 && isConfigured && (
            <div className="dim" style={{ marginTop: 6 }}>
              {pending} change{pending === 1 ? '' : 's'} waiting to upload.
            </div>
          )}
        </div>

        {!isConfigured ? (
          <p className="small dim" style={{ marginTop: 12 }}>
            This build has no Supabase credentials, so it runs purely locally. Everything
            works — your words simply stay on this device.
          </p>
        ) : session ? (
          <>
            <p className="small" style={{ marginTop: 12 }}>
              Signed in as <strong>{session.user.email}</strong>. Your phone and computer
              share this account.
            </p>
            <div className="wrap" style={{ marginTop: 10 }}>
              <button className="btn primary" style={{ flex: 1 }} onClick={() => void syncNow()}>Sync now</button>
              <button className="btn ghost" onClick={async () => { await signOut(); onClose() }}>Sign out</button>
            </div>

            {passwordSaved ? (
              <div className="muted-box small" style={{ marginTop: 12, background: 'var(--ok-soft)', color: 'var(--ok)' }}>
                Password saved. You can now sign in with it directly — including inside the
                app on your home screen.
              </div>
            ) : showPasswordSetup ? (
              <div className="muted-box" style={{ marginTop: 12 }}>
                <strong className="small">Set a password</strong>
                <p className="small dim" style={{ marginTop: 4 }}>
                  An app added to the home screen has its own storage and cannot see a
                  session created in the browser, so a sign-in link can never reach it.
                  A password can.
                </p>
                <input
                  className="input"
                  style={{ marginTop: 8 }}
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void savePassword() }}
                />
                <div className="wrap" style={{ marginTop: 8 }}>
                  <button className="btn primary small" style={{ flex: 1, minHeight: 38 }}
                    disabled={busy || newPassword.length < 8} onClick={savePassword}>
                    {busy ? 'Saving…' : 'Save password'}
                  </button>
                  <button className="btn ghost small" style={{ minHeight: 38 }}
                    onClick={() => { setShowPasswordSetup(false); setError(null) }}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="btn ghost wide small" style={{ marginTop: 10, minHeight: 38 }}
                onClick={() => setShowPasswordSetup(true)}>
                Set a password (needed for the home-screen app)
              </button>
            )}
            {error && <div className="small" style={{ color: 'var(--bad)', marginTop: 8 }}>{error}</div>}
          </>
        ) : sent ? (
          <p className="small" style={{ marginTop: 12 }}>
            Check <strong>{email}</strong> for a sign-in link. Open it on this device.
          </p>
        ) : (
          <>
            <p className="small dim" style={{ marginTop: 12 }}>
              Sign in to mirror your words between phone and computer. The app works fully
              without it — signing in only adds sync.
            </p>
            <input
              className="input"
              style={{ marginTop: 10 }}
              type="email"
              inputMode="email"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="username"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            <input
              className="input"
              style={{ marginTop: 8 }}
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={e => setPasswordValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void submitPassword() }}
            />
            {error && <div className="small" style={{ color: 'var(--bad)', marginTop: 8 }}>{error}</div>}
            <button className="btn primary wide" style={{ marginTop: 10 }}
              disabled={busy || !email.trim() || !password} onClick={submitPassword}>
              {busy ? 'Signing in…' : 'Anmelden'}
            </button>
            <button className="btn ghost wide small" style={{ marginTop: 8, minHeight: 38 }}
              disabled={busy || !email.trim()} onClick={submitMagicLink}>
              Email me a sign-in link instead
            </button>
            <div className="small dim" style={{ textAlign: 'center', marginTop: 8 }}>
              No password yet? Sign in by email once, then set one from this panel.
            </div>
          </>
        )}
      </>
    </Sheet>
  )
}
