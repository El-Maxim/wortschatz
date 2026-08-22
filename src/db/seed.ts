import type { Exercise, ExercisePayload, ExerciseType, GrammarTopic, Level } from '../types'
import { db, save } from './dexie'
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
export async function seedGrammar(): Promise<void> {
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
    await save('grammarTopics', topic)

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
      await save('exercises', exercise)
    }
  }
}
