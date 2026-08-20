#!/usr/bin/env node
/**
 * End-to-end checks against the built app, driving the installed Chrome.
 *
 *   npm run build && npm run preview &
 *   node scripts/e2e.mjs [baseUrl]
 *
 * Covers the acceptance criteria that only a real browser can prove: dictionary
 * lookup during capture, unresolved-word fallback, review scheduling, grammar
 * exercises, and full offline operation once shards are cached.
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:4173/wortschatz/'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const page = await context.newPage()

const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text()) })

/** Capture a word through the real UI and return what the app stored. */
async function capture(term, { context: sentence } = {}) {
  await page.click('.fab')
  await page.fill('.sheet input.input', term)
  await page.waitForTimeout(700) // debounce + shard fetch
  const preview = await page.locator('.sheet .card').first().textContent().catch(() => null)
  if (sentence) {
    await page.click('text=Where did you see it?')
    await page.fill('.sheet textarea', sentence)
  }
  await page.click('.sheet button:has-text("Speichern")')
  await page.waitForTimeout(1200)
  return preview
}

async function dbDump() {
  return page.evaluate(async () => {
    const open = indexedDB.open('wortschatz')
    const db = await new Promise(res => { open.onsuccess = () => res(open.result) })
    const read = (store) => new Promise(res => {
      const req = db.transaction(store).objectStore(store).getAll()
      req.onsuccess = () => res(req.result)
    })
    return {
      words: await read('words'),
      cards: await read('cards'),
      coachRequests: await read('coachRequests'),
      reviewLog: await read('reviewLog'),
    }
  })
}

console.log('\nPhase 2 — capture and dictionary')
await page.goto(BASE, { waitUntil: 'networkidle' })

const housePreview = await capture('Haus', { context: 'In dem Haus wohnt eine Familie.' })
check('dictionary resolves "Haus" with article', /das\s*Haus/.test(housePreview ?? ''), housePreview?.slice(0, 40))

await capture('laufen')
await capture('Ausrede')
const nonsense = await capture('Blorptzweckl')

let db = await dbDump()
const byLemma = Object.fromEntries(db.words.map(w => [w.lemma, w]))

check('Haus stored as neuter noun', byLemma.Haus?.article === 'das' && byLemma.Haus?.pos === 'noun')
check('Haus kept its context sentence', !!byLemma.Haus?.contextSentence)
check('laufen stored with verb forms',
  byLemma.laufen?.verbProps?.partizip2 === 'gelaufen' && byLemma.laufen?.verbProps?.aux === 'sein',
  JSON.stringify(byLemma.laufen?.verbProps))
check('Ausrede stored as feminine', byLemma.Ausrede?.article === 'die')
check('unknown word saved as unresolved', byLemma.Blorptzweckl?.unresolved === true, nonsense?.slice(0, 40))
check('unknown word enqueued a coach request',
  db.coachRequests.some(r => r.kind === 'word_research' && r.status === 'pending' && r.payload.lemma === 'Blorptzweckl'))
check('two cards per word (DE→EN + EN→DE)', db.cards.length === db.words.length * 2,
  `${db.cards.length} cards / ${db.words.length} words`)
check('EN→DE sibling scheduled ~3 days later', (() => {
  const w = byLemma.Haus
  const fwd = db.cards.find(c => c.wordId === w.id && c.direction === 'de-en')
  const back = db.cards.find(c => c.wordId === w.id && c.direction === 'en-de')
  const gap = (new Date(back.due) - new Date(fwd.due)) / 86400000
  return gap > 2.9 && gap < 3.1
})())

const speech = await page.evaluate(() => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined')
check('Web Speech API available for TTS', speech)

console.log('\nPhase 3 — review')
await page.goto(BASE + 'ueben', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const dueText = await page.textContent('.main')
check('due cards appear in Üben', /Umdrehen|\/\s*\d/.test(dueText ?? ''))

await page.click('button:has-text("Umdrehen")')
await page.waitForTimeout(200)
const grades = await page.locator('.card button:has-text("Good")').count()
check('self-grade buttons shown after flip', grades === 1)
await page.click('.card button:has-text("Good")')
await page.waitForTimeout(600)

db = await dbDump()
check('review written to review_log', db.reviewLog.length === 1, `rating ${db.reviewLog[0]?.rating}`)
check('card rescheduled into the future', (() => {
  const log = db.reviewLog[0]
  const card = db.cards.find(c => c.id === log.cardId)
  return new Date(card.due) > new Date() && card.reps === 1
})())

console.log('\nPhase 5 — grammar')
await page.goto(BASE + 'grammatik', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const topicCount = await page.locator('.card').count()
check('curated topics listed', topicCount >= 6, `${topicCount} cards`)

await page.goto(BASE + 'grammatik/der-die-das', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const theory = await page.locator('.theory').textContent().catch(() => '')
check('topic theory renders', (theory ?? '').length > 400, `${(theory ?? '').length} chars`)
const uebenBtn = await page.locator('button:has-text("Üben")').first().textContent().catch(() => '')
check('article drill pool built from own nouns', /\(\d+\)/.test(uebenBtn ?? ''), uebenBtn ?? '')

console.log('\nPhase 7 — offline')
// The service worker caches a dictionary shard the first time it is requested
// through the worker, so warm it with one online lookup before cutting the
// network — this mirrors real use, where you look a word up before losing signal.
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => navigator.serviceWorker.ready)
await page.waitForTimeout(500)
await capture('Haus')
await page.waitForTimeout(600)

const offlineFrom = errors.length // network failures below are expected
await context.setOffline(true)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

const offlineLoaded = await page.locator('.tabs').count()
check('app shell loads offline', offlineLoaded === 1)

const offlinePreview = await capture('Haus')
check('dictionary lookup works offline', /das\s*Haus/.test(offlinePreview ?? ''), offlinePreview?.slice(0, 30))

await page.goto(BASE + 'ueben', { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(700)
const offlineUeben = await page.textContent('.main').catch(() => '')
check('review works offline', /Umdrehen|reviews done|Nothing due|\d+\s*\/\s*\d+/.test(offlineUeben ?? ''))

db = await dbDump()
// One Haus at the start, one to warm the SW cache, one captured while offline.
check('offline capture persisted locally', db.words.filter(w => w.lemma === 'Haus').length === 3,
  `${db.words.filter(w => w.lemma === 'Haus').length} copies`)

await context.setOffline(false)

console.log('\n' + '-'.repeat(56))
// Errors raised while the network was cut are expected (failed fetches); only
// judge the online portion of the run.
const onlineErrors = errors.slice(0, offlineFrom)
check('no uncaught page errors', onlineErrors.length === 0, onlineErrors.slice(0, 2).join(' | '))

await browser.close()

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('Failed: ' + failed.map(f => f.name).join(', '))
  process.exitCode = 1
}
