import type { CoachRequest, DictEntry, Pos, Uuid, Word } from '../types'
import { db, save, uuid } from './dexie'
import { articleForGender, fold } from '../lib/normalize'
import { newCard, nowIso, SIBLING_DELAY_DAYS } from '../lib/scheduler'

/** Map the compact dictionary POS onto our own (they already align). */
function posOf(entry: DictEntry): Pos {
  return entry.p ?? 'other'
}

export interface CaptureInput {
  lemma: string
  entry: DictEntry | null
  contextSentence?: string
  sourceNote?: string
  tags?: string[]
}

/**
 * The one path that creates a word. Always succeeds, dictionary hit or not:
 * an unmatched word is saved as `unresolved` and a `word_research` request is
 * queued for the coach, so capture is never blocked by a lookup miss.
 */
export async function captureWord(input: CaptureInput): Promise<Word> {
  const lemma = input.lemma.trim()
  const entry = input.entry
  const gender = entry?.g ?? null

  const word: Word = {
    id: uuid(),
    lemma: entry?.l ?? lemma,
    pos: entry ? posOf(entry) : 'other',
    gender,
    article: articleForGender(gender),
    plural: entry?.pl ?? null,
    translations: entry?.t?.slice(0, 4) ?? [],
    verbProps: entry?.v
      ? {
          praeteritum: entry.v.pt ?? null,
          partizip2: entry.v.p2 ?? null,
          aux: entry.v.a ?? 'haben',
          separable: entry.v.s ?? false,
        }
      : null,
    contextSentence: input.contextSentence?.trim() || null,
    sourceNote: input.sourceNote?.trim() || null,
    freqRank: entry?.f ?? null,
    tags: input.tags ?? [],
    unresolved: !entry,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deleted: false,
  }

  await save('words', word)
  await createCardsFor(word.id)

  if (word.unresolved) await requestCoach('word_research', { lemma: word.lemma, wordId: word.id })
  return word
}

/**
 * One DE→EN card now, and its EN→DE sibling scheduled to appear
 * SIBLING_DELAY_DAYS later — recognition before production.
 */
export async function createCardsFor(wordId: Uuid): Promise<void> {
  const existing = await db.cards.where('wordId').equals(wordId).count()
  if (existing) return

  const forward = newCard(uuid(), wordId, 'de-en')
  const siblingDue = new Date(Date.now() + SIBLING_DELAY_DAYS * 86400_000)
  forward.siblingDueAt = siblingDue.toISOString()
  await save('cards', forward)

  const backward = newCard(uuid(), wordId, 'en-de', siblingDue)
  await save('cards', backward)
}

/** Queue work for the `/coach` command. De-duplicated per (kind, payload). */
export async function requestCoach(
  kind: CoachRequest['kind'],
  payload: Record<string, unknown>,
): Promise<CoachRequest> {
  const key = JSON.stringify(payload)
  const dupe = await db.coachRequests
    .where('kind').equals(kind)
    .filter(r => r.status === 'pending' && !r.deleted && JSON.stringify(r.payload) === key)
    .first()
  if (dupe) return dupe

  const request: CoachRequest = {
    id: uuid(),
    kind,
    payload,
    status: 'pending',
    result: null,
    createdAt: nowIso(),
    resolvedAt: null,
    updatedAt: nowIso(),
    deleted: false,
  }
  await save('coachRequests', request)
  return request
}

/** True when the user already has this lemma (so capture can warn instead of duplicating). */
export async function findExisting(lemma: string): Promise<Word | undefined> {
  const target = fold(lemma)
  return db.words.filter(w => !w.deleted && fold(w.lemma) === target).first()
}

export async function allWords(): Promise<Word[]> {
  return db.words.filter(w => !w.deleted).toArray()
}
