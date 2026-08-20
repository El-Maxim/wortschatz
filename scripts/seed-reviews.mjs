#!/usr/bin/env node
/**
 * Scheduler simulation — Phase 3 acceptance.
 *
 *   npm run sim
 *
 * Drives the real `src/lib/scheduler.ts` (loaded through Vite's SSR loader, so
 * there is no second copy of the logic to drift) with an injected clock, and
 * asserts the properties the spec asks for:
 *
 *   - repeated "Good" makes intervals grow
 *   - "Again" collapses the interval and moves the card to relearning
 *   - the EN->DE article rule grades der/die/das correctly
 *
 * Nothing here touches IndexedDB; it is pure scheduling maths over 30+ days.
 */
import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const { newCard, grade, gradeTyped, setClock, intervalPreview } =
  await server.ssrLoadModule('/src/lib/scheduler.ts')

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// ------------------------------------------------------------ fake clock

let today = new Date('2026-01-01T09:00:00.000Z')
setClock(() => today)
const advanceTo = (iso) => { today = new Date(iso) }
const days = (a, b) => (new Date(a) - new Date(b)) / 86400000

// ------------------------------------------------- 1. always "Good", 30 days

console.log('\n30 days of "Good" on one card')
let card = newCard('c1', 'w1', 'de-en')
const intervals = []
const start = new Date(today)

for (let i = 0; i < 12; i++) {
  advanceTo(card.due)                    // review exactly when it falls due
  const before = card.due
  card = grade(card, 3, today)           // 3 = Good
  intervals.push(Number(days(card.due, before).toFixed(3)))
  if (days(card.due, start) > 400) break
}

console.log(`  intervals (days): ${intervals.map(d => (d < 1 ? `${Math.round(d * 1440)}min` : `${d.toFixed(1)}d`)).join(' -> ')}`)

const daily = intervals.filter(d => d >= 1)
const growing = daily.every((d, i) => i === 0 || d >= daily[i - 1])
check('intervals grow monotonically under Good', growing, `${daily.length} graduated steps`)
check('reaches a multi-week interval within 30 days of study', Math.max(...intervals) > 14,
  `max ${Math.max(...intervals).toFixed(1)} d`)
check('card ends in Review state', card.state === 2, `state ${card.state}`)
check('reps counted', card.reps === intervals.length, `${card.reps} reps`)

// ------------------------------------------------------ 2. "Again" resets

console.log('\n"Again" on a mature card')
const matureStability = card.stability
advanceTo(card.due)
const lapsed = grade(card, 1, today)     // 1 = Again
// What the same card would have earned for a correct answer at this moment —
// the honest baseline for "how much did forgetting cost me?".
const ifRecalled = grade(card, 3, today)

check('interval collapses to under a day', days(lapsed.due, today) < 1,
  `${(days(lapsed.due, today) * 1440).toFixed(0)} min`)
check('moves to relearning', lapsed.state === 3, `state ${lapsed.state}`)
check('lapse counted', lapsed.lapses === card.lapses + 1)
check('stability drops', lapsed.stability < matureStability,
  `${matureStability.toFixed(1)} -> ${lapsed.stability.toFixed(1)}`)
check('Again schedules far sooner than Good would have',
  days(lapsed.due, today) < days(ifRecalled.due, today) / 100,
  `${(days(lapsed.due, today) * 1440).toFixed(0)} min vs ${days(ifRecalled.due, today).toFixed(0)} d`)

// recovery
advanceTo(lapsed.due)
const recovered = grade(lapsed, 3, today)
check('Good after a lapse schedules forward again', new Date(recovered.due) > new Date(today))

// ------------------------------------------------------ 3. button previews

console.log('\nInterval previews')
const fresh = newCard('c2', 'w2', 'de-en')
const preview = intervalPreview(fresh, today)
check('every button offers a preview', [1, 2, 3, 4].every(r => typeof preview[r] === 'string'),
  `Again ${preview[1]} · Hard ${preview[2]} · Good ${preview[3]} · Easy ${preview[4]}`)

// ------------------------------------------- 4. EN->DE typed answer grading

console.log('\nEN->DE typed answers (article rule)')
const noun = (lemma, article) => ({
  lemma, pos: 'noun', article, gender: article === 'der' ? 'm' : article === 'die' ? 'f' : 'n',
  translations: ['x'], verbProps: null,
})
const verb = (lemma) => ({ lemma, pos: 'verb', article: null, gender: null, translations: ['x'], verbProps: null })

const cases = [
  [noun('Haus', 'das'), 'das Haus', 3, 'exact match with article -> Good'],
  [noun('Haus', 'das'), 'Haus', 2, 'missing article -> Hard'],
  [noun('Haus', 'das'), 'der Haus', 2, 'wrong article -> Hard'],
  [noun('Haus', 'das'), 'das haus', 3, 'case-insensitive -> Good'],
  [noun('Ausrede', 'die'), 'die Ausrede', 3, 'feminine exact -> Good'],
  [noun('Ausrede', 'die'), 'das Ausrede', 2, 'feminine with wrong article -> Hard'],
  [noun('Tisch', 'der'), 'der Tisch', 3, 'masculine exact -> Good'],
  [noun('Tisch', 'der'), 'die Tisch', 2, 'masculine with wrong article -> Hard'],
  [noun('Mädchen', 'das'), 'das Madchen', 2, 'umlaut slip -> Hard'],
  [noun('Haus', 'das'), 'das Auto', 1, 'wrong word -> Again'],
  [noun('Haus', 'das'), '', 1, 'empty -> Again'],
  [verb('laufen'), 'laufen', 3, 'verb needs no article -> Good'],
  [verb('laufen'), 'laufeu', 2, 'one letter off -> Hard'],
  [verb('laufen'), 'gehen', 1, 'wrong verb -> Again'],
]

for (const [word, typed, expected, label] of cases) {
  const result = gradeTyped(word, typed)
  check(label, result.rating === expected, `got ${result.rating} ("${result.note}")`)
}

const missing = gradeTyped(noun('Haus', 'das'), 'Haus')
check('missing article is flagged and the right one shown',
  missing.articleMissed === true && missing.note.includes('das'), missing.note)

await server.close()

console.log(`\n${failures === 0 ? 'All simulation checks passed.' : `${failures} check(s) failed.`}`)
process.exitCode = failures ? 1 : 0
