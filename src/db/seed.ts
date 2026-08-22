import type { Exercise, ExercisePayload, ExerciseType, GrammarTopic, Level } from '../types'
import { db } from './dexie'
import { nowIso } from '../lib/scheduler'

// The six curated topics, written at build time and bundled with the app.
// Vite inlines these JSON files, so first run works offline with no fetch.
import derDieDas from '../../data/grammar/der-die-das.json'
import akkusativDativ from '../../data/grammar/akkusativ-dativ.json'
import wortstellung from '../../data/grammar/wortstellung.json'
import trennbareVerben from '../../data/grammar/trennbare-verben.json'
import perfektPraeteritum from '../../data/grammar/perfekt-praeteritum.json'
import adjektivendungen from '../../data/grammar/adjektivendungen.json'

interface SeedTopic {
  slug: string
  title: string
  level: string
  theoryMd: string
  exercises: { type: string; payload: ExercisePayload }[]
}

/** Fixed namespace so ids stay stable across releases. */
const SEED_NAMESPACE = '6f9b1d2c-7a3e-4c15-9b8f-2e5a4d0c1b73'

/**
 * A deterministic (RFC 4122 v5) id for seeded content.
 *
 * Curated topics are created independently on every device, so a random uuid
 * would give the same topic a different id on the phone and the laptop. Sync
 * would then try to store two rows with one slug and hit the unique index —
 * locally in Dexie, and `unique (user_id, slug)` on Postgres. Deriving the id
 * from the slug makes both devices agree, so the rows merge instead of colliding.
 */
async function stableId(name: string): Promise<string> {
  const ns = SEED_NAMESPACE.replace(/-/g, '')
  const nsBytes = Uint8Array.from(ns.match(/../g)!.map(h => parseInt(h, 16)))
  const nameBytes = new TextEncoder().encode(name)
  const input = new Uint8Array(nsBytes.length + nameBytes.length)
  input.set(nsBytes)
  input.set(nameBytes, nsBytes.length)

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input))
  digest[6] = (digest[6] & 0x0f) | 0x50 // version 5
  digest[8] = (digest[8] & 0x3f) | 0x80 // RFC 4122 variant

  const hex = [...digest.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const SEEDS = [
  derDieDas, akkusativDativ, wortstellung,
  trennbareVerben, perfektPraeteritum, adjektivendungen,
] as SeedTopic[]

/**
 * Loads the curated topics on first run.
 *
 * Idempotent and additive: a topic already present is left alone (the user may
 * have practised it, and the coach may have added exercises to it), and a topic
 * added to the bundle in a later release is inserted on next launch.
 */
/**
 * Bundled content is stored locally and never queued for sync.
 *
 * The six curated topics and their 72 exercises ship inside the app, so every
 * device already has an identical copy — uploading them adds no information.
 * Worse, it cannot be made to converge: topics collide on
 * `unique (user_id, slug)`, and exercises have no natural key at all, so each
 * device's copy inserts alongside the others and the pool doubles. Keeping them
 * out of sync entirely removes the whole class of problem.
 *
 * Their ids are still derived from the slug, because `exercise_attempts` do
 * sync and reference an exercise by id — a drill answered on the phone has to
 * mean the same thing on the laptop.
 */
async function putLocal<T extends { id: string }>(
  table: 'grammarTopics' | 'exercises',
  row: T,
): Promise<void> {
  await (db[table] as unknown as { put(r: T): Promise<unknown> }).put(row)
  await db.syncQueue.where('[table+rowId]').equals([table, row.id]).delete()
}

/**
 * Renumbers seeded rows that were created before ids were derived from the slug.
 *
 * Those installs hold the six curated topics — and their 72 exercises — under
 * ids generated randomly on that device. Pushing them would insert a second
 * copy of every exercise alongside the set another device already uploaded, and
 * the topics would collide on `unique (user_id, slug)`. Rewriting them to the
 * deterministic ids makes every device agree on one identity per row, so the
 * upserts merge instead of multiplying.
 *
 * Safe to run on every launch: bundled content carries no user state, and once
 * the ids match it does nothing.
 */
async function repairSeedIds(): Promise<void> {
  for (const seed of SEEDS) {
    const wantedId = await stableId(`topic:${seed.slug}`)
    const topic = await db.grammarTopics.where('slug').equals(seed.slug).first()
    if (!topic || topic.id === wantedId || topic.status !== 'curated') continue

    await db.grammarTopics.delete(topic.id)
    await db.syncQueue.where('[table+rowId]').equals(['grammarTopics', topic.id]).delete()
    await putLocal('grammarTopics', { ...topic, id: wantedId })

    // The topic's bundled exercises are re-keyed the same way. Only `template`
    // rows are touched; anything the coach wrote keeps its own id.
    const stale = await db.exercises
      .filter(e => e.topicSlug === seed.slug && e.source === 'template')
      .toArray()
    for (const exercise of stale) {
      await db.exercises.delete(exercise.id)
      await db.syncQueue.where('[table+rowId]').equals(['exercises', exercise.id]).delete()
    }
    for (const [index, item] of seed.exercises.entries()) {
      await putLocal('exercises', {
        id: await stableId(`exercise:${seed.slug}:${index}`),
        topicSlug: seed.slug,
        type: item.type as ExerciseType,
        payload: item.payload,
        source: 'template',
        createdAt: topic.createdAt,
        updatedAt: nowIso(),
        deleted: false,
      })
    }
  }
}

export async function seedGrammar(): Promise<void> {
  await repairSeedIds()

  for (const seed of SEEDS) {
    const existing = await db.grammarTopics.where('slug').equals(seed.slug).first()
    if (existing) continue

    const topic: GrammarTopic = {
      id: await stableId(`topic:${seed.slug}`),
      slug: seed.slug,
      title: seed.title,
      level: seed.level as Level,
      theoryMd: seed.theoryMd,
      status: 'curated',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deleted: false,
    }
    await putLocal('grammarTopics', topic)

    for (const [index, item] of seed.exercises.entries()) {
      const exercise: Exercise = {
        id: await stableId(`exercise:${seed.slug}:${index}`),
        topicSlug: seed.slug,
        type: item.type as ExerciseType,
        payload: item.payload,
        source: 'template',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        deleted: false,
      }
      await putLocal('exercises', exercise)
    }
  }
}
