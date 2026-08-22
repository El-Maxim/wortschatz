#!/usr/bin/env node
/**
 * Regression test for the sync high-water mark.
 *
 *   npm run build && npm run preview &
 *   node scripts/e2e-clockskew.mjs [baseUrl]
 *
 * Rows are stamped with `updated_at` by whichever device wrote them, so a
 * watermark taken from the *local* clock hides anything written by a device
 * running slightly behind — permanently, since the watermark only moves
 * forward. This reproduces that: device B's watermark is pushed into the
 * future, then device A writes a word, and B must still receive it.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:4173/wortschatz/'

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const URL_ = env.VITE_SUPABASE_URL.replace(/\/$/, '')
const ANON = env.VITE_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
const REF = URL_.match(/https:\/\/([^.]+)\./)[1]
const admin = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }

const EMAIL = 'clockskew2@example.com'
const PW = 'Clock-Skew-Test-1!'

let failures = 0
const say = (n, ok, d = '') => { if (!ok) failures++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }

const user = await (await fetch(`${URL_}/auth/v1/admin/users`, {
  method: 'POST', headers: admin,
  body: JSON.stringify({ email: EMAIL, password: PW, email_confirm: true }),
})).json()
const sess = await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PW }),
})).json()

const browser = await chromium.launch({ channel: 'chrome' })
const device = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await ctx.addInitScript(([ref, s]) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + s.expires_in,
      expires_in: s.expires_in, token_type: 'bearer', user: s.user,
    }))
  }, [REF, sess])
  return ctx
}

const sync = async (p) => {
  await p.evaluate(() => dispatchEvent(new Event('focus')))
  await p.waitForTimeout(4000)
  return p.locator('.topbar button').first().getAttribute('title')
}

const capture = async (p, term) => {
  await p.click('.fab')
  await p.fill('.sheet input.input', term)
  await p.waitForTimeout(800)
  await p.click('.sheet button:has-text("Speichern")')
  await p.waitForTimeout(1200)
}

// --- device B: sync once, then force its watermark into the future, which is
//     exactly the state the local-clock watermark used to leave behind.
const ctxB = await device()
const pageB = await ctxB.newPage()
await pageB.goto(BASE, { waitUntil: 'networkidle' })
await pageB.waitForTimeout(2500)
say('device B syncs', (await sync(pageB)) === 'Synced')

// Reproduce what the previous build left behind: a watermark taken from the
// local clock, and no version marker (that key did not exist yet).
await pageB.evaluate(async () => {
  const open = indexedDB.open('wortschatz')
  const db = await new Promise(res => { open.onsuccess = () => res(open.result) })
  const future = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const store = db.transaction('meta', 'readwrite').objectStore('meta')
  await new Promise(res => { store.put({ key: 'lastSyncAt', value: future }).onsuccess = res })
  await new Promise(res => { store.delete('syncWatermarkVersion').onsuccess = res })
})
const skewed = await pageB.evaluate(async () => {
  const open = indexedDB.open('wortschatz')
  const db = await new Promise(res => { open.onsuccess = () => res(open.result) })
  const req = db.transaction('meta').objectStore('meta').get('lastSyncAt')
  return new Promise(res => { req.onsuccess = () => res(req.result?.value) })
})
say('device B watermark pushed 10 min into the future', !!skewed, skewed)

// --- device A writes a word, stamped with its own (earlier) clock
const ctxA = await device()
const pageA = await ctxA.newPage()
await pageA.goto(BASE, { waitUntil: 'networkidle' })
await pageA.waitForTimeout(2500)
await capture(pageA, 'Meinungsfreiheit')
say('device A syncs the new word up', (await sync(pageA)) === 'Synced')

const remote = await (await fetch(`${URL_}/rest/v1/words?select=lemma&user_id=eq.${user.id}`, { headers: admin })).json()
say('word is on the server', Array.isArray(remote) && remote.some(w => w.lemma === 'Meinungsfreiheit'),
  JSON.stringify(remote))

// --- device B must receive it despite the future watermark
say('device B syncs again', (await sync(pageB)) === 'Synced')
await pageB.goto(BASE, { waitUntil: 'networkidle' })
await pageB.waitForTimeout(2000)
const listB = await pageB.textContent('.main')
say('device B now shows the word (the reported bug)', /Meinungsfreiheit/.test(listB),
  listB.replace(/\s+/g, ' ').slice(0, 80))

const wmB = await pageB.evaluate(async () => {
  const open = indexedDB.open('wortschatz')
  const db = await new Promise(res => { open.onsuccess = () => res(open.result) })
  const req = db.transaction('meta').objectStore('meta').get('lastSyncAt')
  return new Promise(res => { req.onsuccess = () => res(req.result?.value) })
})
say('watermark now tracks server data, not the clock', Date.parse(wmB) < Date.now() + 60_000, wmB)

await browser.close()
await fetch(`${URL_}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: admin })
console.log('  test account removed')

if (failures) process.exitCode = 1
