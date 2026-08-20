import {
  createEmptyCard, fsrs, generatorParameters,
  type Card as TsCard, type FSRS, type Grade, type RecordLogItem,
} from 'ts-fsrs'
import type { Card, CardDirection, FsrsState, Rating, Uuid, Word } from '../types'
import { fold, loose, splitArticle, editDistance } from './normalize'

/**
 * All scheduling goes through ts-fsrs with default parameters and 0.9 desired
 * retention. The clock is injectable so the 30-day simulation script (and
 * tests) can run years of reviews without waiting.
 */
let clock: () => Date = () => new Date()

export function setClock(fn: () => Date): void { clock = fn }
export function resetClock(): void { clock = () => new Date() }
export function nowDate(): Date { return clock() }
export function nowIso(): string { return clock().toISOString() }

const engine: FSRS = fsrs(generatorParameters({
  request_retention: 0.9,
  enable_fuzz: true,
}))

/** Days after the DE→EN card is introduced before its EN→DE sibling appears. */
export const SIBLING_DELAY_DAYS = 3
/** Cap on brand-new cards introduced per day. */
export const NEW_PER_DAY = 10

function toTs(card: Card): TsCard {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as unknown as TsCard['state'],
    last_review: card.lastReview ? new Date(card.lastReview) : undefined,
  }
}

function merge(card: Card, next: TsCard): Card {
  return {
    ...card,
    due: next.due.toISOString(),
    stability: next.stability,
    difficulty: next.difficulty,
    elapsedDays: next.elapsed_days,
    scheduledDays: next.scheduled_days,
    learningSteps: next.learning_steps,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state as unknown as FsrsState,
    lastReview: next.last_review ? new Date(next.last_review).toISOString() : null,
  }
}

export function newCard(id: Uuid, wordId: Uuid, direction: CardDirection, dueAt?: Date): Card {
  const base = createEmptyCard(dueAt ?? clock())
  return {
    id,
    wordId,
    direction,
    due: base.due.toISOString(),
    stability: base.stability,
    difficulty: base.difficulty,
    elapsedDays: base.elapsed_days,
    scheduledDays: base.scheduled_days,
    learningSteps: base.learning_steps,
    reps: base.reps,
    lapses: base.lapses,
    state: base.state as unknown as FsrsState,
    lastReview: null,
    siblingDueAt: null,
    updatedAt: nowIso(),
    deleted: false,
  }
}

/** Apply a rating and return the rescheduled card. Pure — caller persists. */
export function grade(card: Card, rating: Rating, at: Date = clock()): Card {
  const result = engine.next(toTs(card), at, rating as unknown as Grade)
  return merge(card, result.card)
}

/** Human-readable preview of each button's next interval, for the review UI. */
export function intervalPreview(card: Card, at: Date = clock()): Record<Rating, string> {
  const scheduled = engine.repeat(toTs(card), at) as unknown as Record<number, RecordLogItem>
  const out = {} as Record<Rating, string>
  for (const rating of [1, 2, 3, 4] as Rating[]) {
    const next = scheduled[rating].card
    out[rating] = formatGap(next.due.getTime() - at.getTime())
  }
  return out
}

function formatGap(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.round(hours / 24)
  if (days < 31) return `${days} d`
  const months = Math.round(days / 30.4)
  if (months < 12) return `${months} mo`
  return `${(days / 365).toFixed(days < 730 ? 1 : 0)} y`
}

// ------------------------------------------------------- typed-answer grading

export interface GradeResult {
  rating: Rating
  /** Why this rating — shown in the feedback line. */
  note: string
  expected: string
  articleMissed: boolean
}

/**
 * Grades an EN→DE typed answer.
 *
 *   exact match                              → Good
 *   right word, wrong/missing article (nouns) → Hard  (article shown back)
 *   right word, diacritic or case slip        → Hard
 *   anything else                             → Again
 *
 * The user can always override to "actually correct" in the UI.
 */
export function gradeTyped(word: Word, typed: string): GradeResult {
  const expected = word.article ? `${word.article} ${word.lemma}` : word.lemma
  const answer = typed.trim()
  if (!answer) return { rating: 1, note: 'No answer', expected, articleMissed: false }

  const isNoun = word.pos === 'noun' && word.article !== null
  const got = splitArticle(answer)
  const wantLemma = word.lemma

  const lemmaExact = loose(got.rest) === loose(wantLemma)
  const lemmaFolded = fold(got.rest) === fold(wantLemma)
  const lemmaClose = !lemmaFolded && editDistance(fold(got.rest), fold(wantLemma)) <= 1 && fold(wantLemma).length > 3

  if (isNoun) {
    const articleRight = got.article === word.article
    if (lemmaExact && articleRight) return { rating: 3, note: 'Correct', expected, articleMissed: false }
    if (lemmaExact || lemmaFolded) {
      if (!got.article) {
        return { rating: 2, note: `Right word — but the article is ${word.article}`, expected, articleMissed: true }
      }
      if (!articleRight) {
        return { rating: 2, note: `It is ${word.article} ${word.lemma}, not ${got.article}`, expected, articleMissed: true }
      }
      // article right, spelling only loosely right (umlaut/ß slip)
      return { rating: 2, note: 'Nearly — check the spelling', expected, articleMissed: false }
    }
    if (lemmaClose) {
      return { rating: 2, note: 'Close — one letter off', expected, articleMissed: !articleRight }
    }
    return { rating: 1, note: 'Not quite', expected, articleMissed: false }
  }

  if (lemmaExact) return { rating: 3, note: 'Correct', expected, articleMissed: false }
  if (lemmaFolded) return { rating: 2, note: 'Nearly — check the umlauts', expected, articleMissed: false }
  if (lemmaClose) return { rating: 2, note: 'Close — one letter off', expected, articleMissed: false }
  return { rating: 1, note: 'Not quite', expected, articleMissed: false }
}

export const RATING_LABELS: Record<Rating, string> = {
  1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy',
}
