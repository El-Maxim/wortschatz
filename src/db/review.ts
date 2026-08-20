import type { Card, Rating, ReviewLog, Word } from '../types'
import { db, save, uuid } from './dexie'
import { grade, NEW_PER_DAY, nowDate, nowIso } from '../lib/scheduler'

export interface QueueItem { card: Card; word: Word }

function startOfDay(d: Date): string {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy.toISOString()
}

/** How many brand-new cards were introduced today (counts against NEW_PER_DAY). */
export async function newIntroducedToday(at: Date = nowDate()): Promise<number> {
  const since = startOfDay(at)
  const logs = await db.reviewLog.where('reviewedAt').aboveOrEqual(since).toArray()
  const firstReps = logs.filter(l => l.stateBefore === 0)
  return new Set(firstReps.map(l => l.cardId)).size
}

/**
 * Builds today's queue: everything already due, plus up to NEW_PER_DAY new
 * cards chosen commonest-first so the highest-value vocabulary lands earliest.
 * Due cards come first; new ones are appended.
 */
export async function buildQueue(at: Date = nowDate()): Promise<QueueItem[]> {
  const nowStr = at.toISOString()
  const cards = (await db.cards.filter(c => !c.deleted).toArray()).filter(c => c.due <= nowStr)
  const words = new Map((await db.words.filter(w => !w.deleted).toArray()).map(w => [w.id, w]))

  const due: Card[] = []
  const fresh: Card[] = []
  for (const card of cards) {
    if (!words.has(card.wordId)) continue
    ;(card.state === 0 ? fresh : due).push(card)
  }

  const budget = Math.max(0, NEW_PER_DAY - (await newIntroducedToday(at)))
  fresh.sort((a, b) => {
    const fa = words.get(a.wordId)?.freqRank ?? 1e9
    const fb = words.get(b.wordId)?.freqRank ?? 1e9
    return fa - fb || a.due.localeCompare(b.due)
  })
  due.sort((a, b) => a.due.localeCompare(b.due))

  return [...due, ...fresh.slice(0, budget)].map(card => ({ card, word: words.get(card.wordId)! }))
}

/** Applies a rating: reschedules the card and writes the review log entry. */
export async function recordReview(
  item: QueueItem,
  rating: Rating,
  durationMs: number | null = null,
  at: Date = nowDate(),
): Promise<Card> {
  const before = item.card.state
  const next = grade(item.card, rating, at)
  await save('cards', next)

  const log: ReviewLog = {
    id: uuid(),
    cardId: item.card.id,
    wordId: item.card.wordId,
    rating,
    reviewedAt: at.toISOString(),
    stateBefore: before,
    stateAfter: next.state,
    durationMs,
    updatedAt: nowIso(),
    deleted: false,
  }
  await save('reviewLog', log)
  return next
}

export interface Stats {
  doneToday: number
  dueNow: number
  streak: number
  retention30: number | null
  reviews30: number
}

export async function stats(at: Date = nowDate()): Promise<Stats> {
  const logs = await db.reviewLog.filter(l => !l.deleted).toArray()
  const todayKey = startOfDay(at).slice(0, 10)
  const doneToday = logs.filter(l => l.reviewedAt.slice(0, 10) === todayKey).length

  const dueNow = (await db.cards.filter(c => !c.deleted).toArray())
    .filter(c => c.due <= at.toISOString()).length

  // Streak: consecutive days back from today with at least one review.
  const days = new Set(logs.map(l => l.reviewedAt.slice(0, 10)))
  let streak = 0
  const cursor = new Date(at)
  if (!days.has(todayKey)) cursor.setDate(cursor.getDate() - 1) // today not done yet doesn't break it
  for (;;) {
    const key = startOfDay(cursor).slice(0, 10)
    if (!days.has(key)) break
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  // Retention: of reviews on cards that were already in Review state, how many
  // were recalled (rating > Again)?
  const cutoff = new Date(at.getTime() - 30 * 86400_000).toISOString()
  const mature = logs.filter(l => l.reviewedAt >= cutoff && l.stateBefore === 2)
  const retention30 = mature.length ? mature.filter(l => l.rating > 1).length / mature.length : null

  return {
    doneToday,
    dueNow,
    streak,
    retention30,
    reviews30: logs.filter(l => l.reviewedAt >= cutoff).length,
  }
}
