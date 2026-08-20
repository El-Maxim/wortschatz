import type { Exercise, ExercisePayload, ExerciseType, Word } from '../types'
import { db } from '../db/dexie'

/**
 * Two sources of exercises:
 *   1. stored ones — the six curated topic pools and anything the coach wrote
 *   2. generated ones — built on the fly from the user's OWN saved words, so
 *      the pool never runs dry and costs nothing
 *
 * Generated exercises are deliberately NOT persisted: they are cheap to rebuild
 * and would otherwise bloat sync.
 */

export interface RuntimeExercise {
  id: string
  topicSlug: string | null
  type: ExerciseType
  payload: ExercisePayload
  source: 'template' | 'coach' | 'generated'
}

/** Deterministic shuffle so a session is stable across re-renders. */
function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let s = seed || 1
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const ARTICLES = ['der', 'die', 'das']

/** der/die/das drill over the user's own nouns. */
function articleDrills(words: Word[]): RuntimeExercise[] {
  return words
    .filter(w => w.pos === 'noun' && w.article && !w.unresolved)
    .map(w => ({
      id: `gen-article-${w.id}`,
      topicSlug: 'der-die-das',
      type: 'article' as const,
      payload: {
        prompt: `___ ${w.lemma}`,
        answers: [w.article!],
        distractors: ARTICLES.filter(a => a !== w.article),
        hint: w.translations[0] ? `(${w.translations[0]})` : undefined,
        explanation: w.plural
          ? `${w.article} ${w.lemma}, Plural: die ${w.plural}.`
          : `${w.article} ${w.lemma}.`,
      },
      source: 'generated' as const,
    }))
}

/** Blank the saved word out of the sentence the user met it in. */
function clozeDrills(words: Word[]): RuntimeExercise[] {
  const out: RuntimeExercise[] = []
  for (const w of words) {
    const sentence = w.contextSentence
    if (!sentence) continue
    // Match the lemma, or a plausible inflected form sharing its stem.
    const stem = w.lemma.length > 5 ? w.lemma.slice(0, Math.ceil(w.lemma.length * 0.7)) : w.lemma
    const re = new RegExp(`\\b${escapeRe(stem)}\\p{Letter}*\\b`, 'iu')
    const match = sentence.match(re)
    if (!match) continue
    out.push({
      id: `gen-cloze-${w.id}`,
      topicSlug: null,
      type: 'cloze',
      payload: {
        prompt: sentence.replace(re, '_____'),
        answers: [match[0], w.lemma],
        hint: w.translations[0] ? `Meaning: ${w.translations[0]}` : undefined,
        explanation: `The full sentence: „${sentence}“`,
      },
      source: 'generated',
    })
  }
  return out
}

const PRONOUNS = ['ich', 'du', 'er/sie/es', 'wir', 'ihr', 'sie/Sie'] as const

/** Regular present-tense endings — good enough for drilling; irregular stems
 *  are skipped rather than taught wrong. */
function conjugate(lemma: string, person: number): string | null {
  if (!lemma.endsWith('en') && !lemma.endsWith('ern') && !lemma.endsWith('eln')) return null
  const stem = lemma.slice(0, -2)
  if (!stem) return null
  const needsE = /[dtmn]$/.test(stem)
  switch (person) {
    case 0: return stem + 'e'
    case 1: return stem + (needsE ? 'est' : 'st')
    case 2: return stem + (needsE ? 'et' : 't')
    case 3: return lemma
    case 4: return stem + (needsE ? 'et' : 't')
    case 5: return lemma
    default: return null
  }
}

function conjugationDrills(words: Word[]): RuntimeExercise[] {
  const out: RuntimeExercise[] = []
  for (const w of words) {
    if (w.pos !== 'verb' || w.unresolved) continue
    // Präteritum/Partizip II drills are safe for any verb we have forms for.
    if (w.verbProps?.partizip2) {
      out.push({
        id: `gen-p2-${w.id}`,
        topicSlug: 'perfekt-praeteritum',
        type: 'conjugation',
        payload: {
          prompt: `Perfekt: Ich ___ ___ . (${w.lemma})`,
          answers: [
            `${w.verbProps.aux === 'sein' ? 'bin' : 'habe'} ${w.verbProps.partizip2}`,
            w.verbProps.partizip2,
          ],
          hint: 'auxiliary + Partizip II',
          explanation: `${w.lemma} → ${w.verbProps.aux === 'sein' ? 'ist' : 'hat'} ${w.verbProps.partizip2}. It takes ${w.verbProps.aux}.`,
        },
        source: 'generated',
      })
    }
    const person = 1 // "du" is the most error-prone regular ending
    const form = conjugate(w.lemma, person)
    if (form && !w.verbProps?.separable) {
      out.push({
        id: `gen-conj-${w.id}`,
        topicSlug: 'trennbare-verben',
        type: 'conjugation',
        payload: {
          prompt: `${PRONOUNS[person]} ___ (${w.lemma})`,
          answers: [form],
          explanation: `Regular present tense: ${PRONOUNS[person]} ${form}.`,
        },
        source: 'generated',
      })
    }
    if (w.verbProps?.separable) {
      out.push({
        id: `gen-sep-${w.id}`,
        topicSlug: 'trennbare-verben',
        type: 'multiple_choice',
        payload: {
          prompt: `Is “${w.lemma}” separable in a main clause?`,
          answers: ['ja'],
          distractors: ['nein'],
          explanation: `Yes — the prefix moves to the end: “Ich ${conjugate(w.lemma.replace(/^(ab|an|auf|aus|bei|ein|mit|nach|vor|zu|zurück|weg)/, ''), 0) ?? '…'} … ${w.lemma.match(/^(ab|an|auf|aus|bei|ein|mit|nach|vor|zu|zurück|weg)/)?.[0] ?? ''}.”`,
        },
        source: 'generated',
      })
    }
  }
  return out
}

/** Rebuild the user's own sentence from shuffled chunks. */
function wordOrderDrills(words: Word[]): RuntimeExercise[] {
  const out: RuntimeExercise[] = []
  for (const w of words) {
    const s = w.contextSentence?.trim()
    if (!s) continue
    const tokens = s.replace(/[.!?]+$/, '').split(/\s+/)
    if (tokens.length < 4 || tokens.length > 12) continue
    out.push({
      id: `gen-order-${w.id}`,
      topicSlug: 'wortstellung',
      type: 'word_order',
      payload: {
        prompt: shuffle(tokens, w.id.charCodeAt(0) + tokens.length).join(' / '),
        answers: [s.replace(/[.!?]+$/, ''), s],
        hint: 'Put the conjugated verb in second position.',
        explanation: `„${s}“`,
      },
      source: 'generated',
    })
  }
  return out
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toRuntime(e: Exercise): RuntimeExercise {
  return { id: e.id, topicSlug: e.topicSlug, type: e.type, payload: e.payload, source: e.source }
}

/**
 * The pool for a topic: its stored exercises plus anything generatable from the
 * user's words that belongs to that topic. `null` slug means "everything".
 */
export async function poolFor(topicSlug: string | null, seed = 1): Promise<RuntimeExercise[]> {
  const words = await db.words.filter(w => !w.deleted).toArray()
  const stored = await db.exercises
    .filter(e => !e.deleted && (topicSlug === null || e.topicSlug === topicSlug))
    .toArray()

  const generated = [
    ...articleDrills(words),
    ...clozeDrills(words),
    ...conjugationDrills(words),
    ...wordOrderDrills(words),
  ].filter(e => topicSlug === null || e.topicSlug === topicSlug)

  return shuffle([...stored.map(toRuntime), ...generated], seed)
}

/** Counts used by the Grammatik topic list. */
export async function poolSize(topicSlug: string): Promise<number> {
  return (await poolFor(topicSlug)).length
}
