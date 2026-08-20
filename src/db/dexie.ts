import Dexie, { type Table } from 'dexie'
import type {
  Card, CoachRequest, Exam, Exercise, ExerciseAttempt, GrammarTopic,
  ReviewLog, Suggestion, SyncQueueEntry, SyncTable, Word,
} from '../types'

/**
 * Local-first store. Every table here mirrors a Supabase table 1:1; writes go
 * through the `put*` helpers below so nothing can be saved without also being
 * queued for sync.
 */
export class WortschatzDB extends Dexie {
  words!: Table<Word, string>
  cards!: Table<Card, string>
  reviewLog!: Table<ReviewLog, string>
  grammarTopics!: Table<GrammarTopic, string>
  exercises!: Table<Exercise, string>
  exerciseAttempts!: Table<ExerciseAttempt, string>
  coachRequests!: Table<CoachRequest, string>
  suggestions!: Table<Suggestion, string>
  exams!: Table<Exam, string>
  syncQueue!: Table<SyncQueueEntry, number>
  meta!: Table<{ key: string; value: unknown }, string>

  constructor() {
    super('wortschatz')
    this.version(1).stores({
      words: 'id, lemma, pos, createdAt, freqRank, unresolved, updatedAt, deleted',
      cards: 'id, wordId, due, state, direction, updatedAt, [wordId+direction]',
      reviewLog: 'id, cardId, wordId, reviewedAt, updatedAt',
      grammarTopics: 'id, &slug, status, updatedAt',
      exercises: 'id, topicSlug, type, source, updatedAt',
      exerciseAttempts: 'id, exerciseId, topicSlug, answeredAt, updatedAt',
      coachRequests: 'id, kind, status, createdAt, updatedAt',
      suggestions: 'id, lemma, status, updatedAt',
      exams: 'id, &isoWeek, takenAt, updatedAt',
      syncQueue: '++seq, table, rowId, [table+rowId]',
      meta: 'key',
    })
  }
}

export const db = new WortschatzDB()

export function uuid(): string {
  return crypto.randomUUID()
}

export function now(): string {
  return new Date().toISOString()
}

/** Mark a row dirty. De-duplicated on (table,row) so a hot row queues once. */
export async function enqueue(table: SyncTable, rowId: string): Promise<void> {
  const existing = await db.syncQueue.where('[table+rowId]').equals([table, rowId]).first()
  if (existing) return
  await db.syncQueue.add({ table, rowId, queuedAt: now() })
}

type Synced = { id: string; updatedAt: string; deleted: boolean }

/**
 * The only sanctioned write path: stamps `updatedAt`, persists, and queues.
 * Using `db.words.put()` directly would silently skip sync.
 */
export async function save<T extends Synced>(table: SyncTable, row: T): Promise<T> {
  const stamped = { ...row, updatedAt: now() }
  await (db as unknown as Record<SyncTable, Table<T, string>>)[table].put(stamped)
  await enqueue(table, row.id)
  return stamped
}

/** Soft delete — the row stays so the tombstone can propagate to other devices. */
export async function softDelete(table: SyncTable, id: string): Promise<void> {
  const t = (db as unknown as Record<SyncTable, Table<Synced, string>>)[table]
  const row = await t.get(id)
  if (!row) return
  await t.put({ ...row, deleted: true, updatedAt: now() })
  await enqueue(table, id)
}

/** Small key/value store for things that are not synced (last sync time, flags). */
export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}
