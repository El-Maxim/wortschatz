import type { SyncTable } from '../types'
import { db, getMeta, setMeta } from '../db/dexie'
import { client, currentSession } from './supabase'

/**
 * Last-write-wins sync, per row, on `updated_at`.
 *
 * Push: everything in the Dexie `syncQueue` is upserted, then the queue entry
 * is dropped. Pull: every row changed remotely since the last successful sync
 * is written locally, but only when it is strictly newer than the local copy.
 *
 * Runs on focus, on regaining network, and every five minutes while open.
 * Conflicts are near-impossible with one user on two devices; when they do
 * happen the newer edit wins and the older one is lost — documented in
 * DECISIONS.md as an accepted trade-off.
 */

export type SyncState = 'offline' | 'signed-out' | 'idle' | 'syncing' | 'error'

interface Mapping {
  table: SyncTable
  remote: string
  /** local field -> remote column, for fields that are not plain snake_case. */
  columns: Record<string, string>
  /**
   * Natural-key columns to resolve an upsert against, for tables that carry a
   * unique constraint besides the primary key.
   *
   * Without this, a device pushes a curated topic under its own id while the
   * server holds the same slug under a different one, and the insert dies on
   * `grammar_topics_user_id_slug_key` — permanently, since every retry repeats
   * it. Resolving on (user_id, slug) merges the two into one row instead.
   */
  conflictTarget?: string
}

/** camelCase -> snake_case for everything not listed explicitly. */
function snake(field: string): string {
  return field.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
}

const TABLES: Mapping[] = [
  { table: 'words', remote: 'words', columns: {} },
  { table: 'cards', remote: 'cards', columns: {} },
  { table: 'reviewLog', remote: 'review_log', columns: {} },
  { table: 'grammarTopics', remote: 'grammar_topics', columns: {}, conflictTarget: 'user_id,slug' },
  { table: 'exercises', remote: 'exercises', columns: {} },
  { table: 'exerciseAttempts', remote: 'exercise_attempts', columns: {} },
  { table: 'coachRequests', remote: 'coach_requests', columns: {} },
  { table: 'suggestions', remote: 'suggestions', columns: {} },
  { table: 'exams', remote: 'exams', columns: {}, conflictTarget: 'user_id,iso_week' },
]

const BY_TABLE = new Map(TABLES.map(m => [m.table, m]))

/**
 * Content that ships inside the app: the curated topics and their exercises.
 *
 * Every device seeds an identical copy locally, so these rows are deliberately
 * excluded from sync in both directions. Uploading them would duplicate the
 * pool (exercises have no natural key to merge on) and collide on
 * `unique (user_id, slug)`. Anything the coach wrote — `generated` topics and
 * `coach` exercises — is real data and syncs normally.
 */
function isBundled(table: SyncTable, row: Record<string, unknown>): boolean {
  if (table === 'grammarTopics') return row.status === 'curated'
  if (table === 'exercises') return row.source === 'template'
  return false
}

function toRemote(row: Record<string, unknown>, mapping: Mapping): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue
    out[mapping.columns[key] ?? snake(key)] = value
  }
  return out
}

function toLocal(row: Record<string, unknown>, mapping: Mapping): Record<string, unknown> {
  const reverse = new Map(Object.entries(mapping.columns).map(([local, remote]) => [remote, local]))
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (key === 'user_id') continue // server-owned; never mirrored locally
    const local = reverse.get(key) ?? key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    out[local] = value
  }
  return out
}

/** Timestamps round-trip through Postgres as `+00:00`; compare as instants. */
function newer(a: unknown, b: unknown): boolean {
  const ta = Date.parse(String(a ?? ''))
  const tb = Date.parse(String(b ?? ''))
  if (Number.isNaN(ta)) return false
  if (Number.isNaN(tb)) return true
  return ta > tb
}

let running = false
const listeners = new Set<(state: SyncState, detail?: string) => void>()

export function onSyncState(fn: (state: SyncState, detail?: string) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(state: SyncState, detail?: string) {
  for (const fn of listeners) fn(state, detail)
}

export async function syncNow(): Promise<SyncState> {
  if (!client) { emit('signed-out'); return 'signed-out' }
  if (!navigator.onLine) { emit('offline'); return 'offline' }
  const session = await currentSession()
  if (!session) { emit('signed-out'); return 'signed-out' }
  if (running) return 'syncing'

  running = true
  emit('syncing')
  try {
    await push()
    await pull()
    await setMeta('lastSyncAt', new Date().toISOString())
    emit('idle')
    return 'idle'
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error))
    return 'error'
  } finally {
    running = false
  }
}

async function push(): Promise<void> {
  const queued = await db.syncQueue.toArray()
  if (!queued.length) return

  // Group by table so each table is one round trip, not one per row.
  const grouped = new Map<SyncTable, string[]>()
  for (const entry of queued) {
    const list = grouped.get(entry.table)
    if (list) list.push(entry.rowId)
    else grouped.set(entry.table, [entry.rowId])
  }

  for (const [table, ids] of grouped) {
    const mapping = BY_TABLE.get(table)
    if (!mapping) continue
    const store = (db as unknown as Record<SyncTable, { bulkGet(ids: string[]): Promise<unknown[]> }>)[table]
    const all = (await store.bulkGet(ids)).filter(Boolean) as Record<string, unknown>[]
    const rows = all.filter(r => !isBundled(table, r))
    // Bundled rows may still be queued from a build that synced them; drop the
    // queue entries so they do not retry forever.
    const skipped = all.filter(r => isBundled(table, r)).map(r => String(r.id))
    if (skipped.length) {
      await db.syncQueue.bulkDelete(
        queued.filter(q => q.table === table && skipped.includes(q.rowId)).map(q => q.seq!),
      )
    }
    if (!rows.length) continue

    const payload = rows.map(r => toRemote(r, mapping))
    const { error } = mapping.conflictTarget
      ? await client!.from(mapping.remote).upsert(payload, { onConflict: mapping.conflictTarget })
      : await client!.from(mapping.remote).upsert(payload)
    if (error) throw new Error(`push ${mapping.remote}: ${error.message}`)

    // Only clear what we actually sent; anything queued meanwhile survives.
    const sent = new Set(rows.map(r => String(r.id)))
    await db.syncQueue.bulkDelete(
      queued.filter(q => q.table === table && sent.has(q.rowId)).map(q => q.seq!),
    )
  }
}

async function pull(): Promise<void> {
  const since = await getMeta<string>('lastSyncAt', '1970-01-01T00:00:00.000Z')

  for (const mapping of TABLES) {
    const { data, error } = await client!
      .from(mapping.remote)
      .select('*')
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(2000)
    if (error) throw new Error(`pull ${mapping.remote}: ${error.message}`)
    if (!data?.length) continue

    const store = (db as unknown as Record<SyncTable, {
      get(id: string): Promise<Record<string, unknown> | undefined>
      put(row: Record<string, unknown>): Promise<unknown>
    }>)[mapping.table]

    for (const remoteRow of data as Record<string, unknown>[]) {
      const local = toLocal(remoteRow, mapping)
      // A copy uploaded by an older build; the local seed is authoritative.
      if (isBundled(mapping.table, local)) continue
      const existing = await store.get(String(local.id))
      // LWW: a remote row only wins if it is strictly newer than what we hold.
      if (existing && !newer(local.updatedAt, existing.updatedAt)) continue
      try {
        // A row pulled from the server must not be pushed straight back.
        await store.put(local)
      } catch (error) {
        // Dexie enforces unique indexes on `slug` and `isoWeek`. An incoming row
        // can legitimately carry a different id for the same logical record —
        // an install that seeded its curated topics before ids were derived from
        // the slug. Drop the stale local row and take the server's version;
        // anything else leaves that device unable to sync at all.
        if (!(error instanceof Error) || error.name !== 'ConstraintError') throw error
        const healed = await healConflict(mapping.table, local)
        if (!healed) throw error
      }
    }
  }
}

/** The unique (non-primary-key) index each table carries, if any. */
const UNIQUE_KEY: Partial<Record<SyncTable, string>> = {
  grammarTopics: 'slug',
  exams: 'isoWeek',
}

/**
 * Resolves a unique-index clash by deleting the local row that squats on the
 * key under a different id, then storing the server's version. Returns false if
 * the clash was something else, so the caller can surface the real error.
 */
async function healConflict(table: SyncTable, incoming: Record<string, unknown>): Promise<boolean> {
  const field = UNIQUE_KEY[table]
  if (!field) return false
  const value = incoming[field]
  if (value === undefined) return false

  const store = (db as unknown as Record<SyncTable, {
    where(f: string): { equals(v: unknown): { first(): Promise<Record<string, unknown> | undefined> } }
    delete(id: string): Promise<void>
    put(row: Record<string, unknown>): Promise<unknown>
  }>)[table]

  const squatter = await store.where(field).equals(value).first()
  if (!squatter || squatter.id === incoming.id) return false

  await store.delete(String(squatter.id))
  await db.syncQueue.where('[table+rowId]').equals([table, String(squatter.id)]).delete()
  await store.put(incoming)
  return true
}

let timer: ReturnType<typeof setInterval> | null = null

/** Wire the triggers the spec asks for: focus, network regain, every 5 minutes. */
export function startSync(): () => void {
  const kick = () => { void syncNow() }

  addEventListener('focus', kick)
  addEventListener('online', kick)
  addEventListener('offline', () => emit('offline'))
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick() })
  timer = setInterval(kick, 5 * 60 * 1000)
  kick()

  return () => {
    removeEventListener('focus', kick)
    removeEventListener('online', kick)
    if (timer) clearInterval(timer)
  }
}

export async function pendingCount(): Promise<number> {
  return db.syncQueue.count()
}
