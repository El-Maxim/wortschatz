import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { client, currentSession, isConfigured, signIn, signOut } from '../lib/supabase'
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
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The queue drains in the background; re-read it so the panel does not show a
  // count left over from before the last sync finished.
  useEffect(onOpened, [onOpened])

  async function submit() {
    if (!email.trim()) return
    setBusy(true)
    const { error: err } = await signIn(email.trim())
    setBusy(false)
    if (err) setError(err)
    else { setSent(true); setError(null) }
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
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void submit() }}
            />
            {error && <div className="small" style={{ color: 'var(--bad)', marginTop: 8 }}>{error}</div>}
            <button className="btn primary wide" style={{ marginTop: 10 }} disabled={busy || !email.trim()} onClick={submit}>
              {busy ? 'Sending…' : 'Send magic link'}
            </button>
          </>
        )}
      </>
    </Sheet>
  )
}
