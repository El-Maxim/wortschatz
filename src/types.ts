/**
 * Canonical data shapes for Wortschatz.
 *
 * These types are the contract shared by three places:
 *   - Dexie (local IndexedDB)  — camelCase, exactly as written here
 *   - Supabase (Postgres)      — same fields, snake_case
 *   - the /coach command       — validates every JSON payload it inserts against this file
 *
 * Every synced row carries `id`, `updatedAt` and `deleted` so last-write-wins
 * sync and soft deletes work without extra bookkeeping.
 */

export type Uuid = string
/** ISO-8601 string, always UTC (`new Date().toISOString()`). */
export type Iso = string

export interface SyncMeta {
  id: Uuid
  updatedAt: Iso
  deleted: boolean
}

// ---------------------------------------------------------------- words

export type Pos = 'noun' | 'verb' | 'adj' | 'adv' | 'phrase' | 'other'
export type Gender = 'm' | 'f' | 'n' | null
export type Article = 'der' | 'die' | 'das' | null

export interface VerbProps {
  praeteritum: string | null
  partizip2: string | null
  aux: 'haben' | 'sein'
  separable: boolean
}

export interface Word extends SyncMeta {
  lemma: string
  pos: Pos
  gender: Gender
  /** Derived from gender; kept denormalised so the UI never recomputes it. */
  article: Article
  plural: string | null
  translations: string[]
  verbProps: VerbProps | null
  /** The sentence the user actually met the word in. Powers cloze exercises. */
  contextSentence: string | null
  sourceNote: string | null
  /** Rank in the OpenSubtitles frequency list; lower = commoner. */
  freqRank: number | null
  tags: string[]
  /** True when the dictionary had no entry — the coach fills these in. */
  unresolved: boolean
  createdAt: Iso
}

// ---------------------------------------------------------------- cards

export type CardDirection = 'de-en' | 'en-de'
/** Mirrors ts-fsrs `State`: 0 New, 1 Learning, 2 Review, 3 Relearning. */
export type FsrsState = 0 | 1 | 2 | 3
/** Mirrors ts-fsrs `Rating`: 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type Rating = 1 | 2 | 3 | 4

export interface Card extends SyncMeta {
  wordId: Uuid
  direction: CardDirection
  due: Iso
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  state: FsrsState
  lastReview: Iso | null
  /** Set on the DE→EN card; the EN→DE sibling is created 3 days later. */
  siblingDueAt: Iso | null
}

export interface ReviewLog extends SyncMeta {
  cardId: Uuid
  wordId: Uuid
  rating: Rating
  reviewedAt: Iso
  stateBefore: FsrsState
  stateAfter: FsrsState
  /** Milliseconds spent on the card; used by coach analytics. */
  durationMs: number | null
}

// ---------------------------------------------------------------- grammar

export type Level = 'A1' | 'A2' | 'B1' | 'B2' | 'C1'

export interface GrammarTopic extends SyncMeta {
  slug: string
  title: string
  level: Level
  theoryMd: string
  status: 'curated' | 'generated'
  createdAt: Iso
}

export type ExerciseType =
  | 'cloze'
  | 'article'
  | 'word_order'
  | 'conjugation'
  | 'translate'
  | 'multiple_choice'

/**
 * One payload shape per exercise type. `answers` is always an array so that
 * several spellings can be accepted; `explanation` is shown after grading.
 */
export interface ExercisePayload {
  prompt: string
  answers: string[]
  distractors?: string[]
  explanation?: string
  /** Shown above the prompt, e.g. the full sentence a cloze came from. */
  hint?: string
}

export interface Exercise extends SyncMeta {
  topicSlug: string | null
  type: ExerciseType
  payload: ExercisePayload
  source: 'template' | 'coach'
  createdAt: Iso
}

export interface ExerciseAttempt extends SyncMeta {
  exerciseId: string
  topicSlug: string | null
  correct: boolean
  answeredAt: Iso
}

// ---------------------------------------------------------------- coach

export type CoachKind = 'grammar_topic' | 'suggestions' | 'weekly_exam' | 'word_research'

export interface CoachRequest extends SyncMeta {
  kind: CoachKind
  payload: Record<string, unknown>
  status: 'pending' | 'done' | 'failed'
  result: Record<string, unknown> | null
  createdAt: Iso
  resolvedAt: Iso | null
}

export interface Suggestion extends SyncMeta {
  lemma: string
  gender: Gender
  translations: string[]
  /** One sentence tying the suggestion to the user's own data. */
  reason: string
  relatedTo: string[]
  status: 'new' | 'accepted' | 'dismissed'
  createdAt: Iso
}

// ---------------------------------------------------------------- exams

export interface ExamItem {
  kind: 'vocab' | 'grammar' | 'translate'
  prompt: string
  answers: string[]
  /** Present for auto-gradable multiple-choice items. */
  distractors?: string[]
  explanation?: string
  /** Filled in as the user takes the exam. */
  userAnswer?: string
  correct?: boolean
}

export interface Exam extends SyncMeta {
  isoWeek: string
  items: ExamItem[]
  score: number | null
  takenAt: Iso | null
  createdAt: Iso
}

// ---------------------------------------------------------------- sync

export interface SyncQueueEntry {
  /** Auto-incremented by Dexie. */
  seq?: number
  table: SyncTable
  rowId: Uuid
  queuedAt: Iso
}

export type SyncTable =
  | 'words'
  | 'cards'
  | 'reviewLog'
  | 'grammarTopics'
  | 'exercises'
  | 'exerciseAttempts'
  | 'coachRequests'
  | 'suggestions'
  | 'exams'

// ---------------------------------------------------------------- dictionary

/** A single entry inside a `public/dict/xx.json` shard. */
export interface DictEntry {
  l: string            // lemma
  p: Pos               // part of speech
  g?: 'm' | 'f' | 'n'  // gender (nouns)
  t: string[]          // English glosses
  pl?: string          // plural
  v?: {                // verb forms
    pt?: string        // Präteritum
    p2?: string        // Partizip II
    a?: 'haben' | 'sein'
    s?: boolean        // separable
  }
  ipa?: string
  ex?: string          // example sentence
  f?: number           // frequency rank
}
