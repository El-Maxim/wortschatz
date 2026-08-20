import type { Exercise, ExercisePayload, ExerciseType, GrammarTopic, Level } from '../types'
import { db, save, uuid } from './dexie'
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
      id: uuid(),
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

    for (const item of seed.exercises) {
      const exercise: Exercise = {
        id: uuid(),
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
