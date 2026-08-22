#!/usr/bin/env node
/**
 * Phase 4 acceptance — sync against the real Supabase project.
 *
 *   npm run build && npm run preview &
 *   node scripts/e2e-sync.mjs [baseUrl]
 *
 * Proves the three things the spec asks for:
 *   1. a word created locally appears in Supabase
 *   2. a row made newer in Supabase wins locally on the next sync
 *   3. changes made offline queue, then flush when the network returns
 *
 * Signs in with a password grant and injects the session, because the app's own
 * magic-link flow needs a mailbox. The session is a normal end-user JWT, so
 * everything below still runs as `authenticated` under RLS.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:4173/wortschatz/'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const URL_ = env.VITE_SUPABASE_URL.replace(/\/$/, '')
const ANON = env.VITE_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
const REF = URL_.match(/https:\/\/([^.]+)\./)[1]

const EMAIL = 'wortschatz-test@example.com'
const PASSWORD = 'Test-Passw0rd-9x!'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function rest(path, { method = 'GET', body, service = false } = {}) {
  const key = service ? SERVICE : ANON
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${service ? SERVICE : token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

// ---------------------------------------------------------------- sign in

async function signIn() {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  return res.json()
}

// The suite provisions its own throwaway account and removes it at the end, so
// it can be re-run against a project that holds only the real user's data.
let session = await signIn()
let createdUser = false
if (!session.access_token) {
  const created = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  }).then(r => r.json())
  if (!created.id) { console.error('Could not create the test user:', created); process.exit(1) }
  createdUser = true
  session = await signIn()
}
const token = session.access_token
if (!token) { console.error('Could not sign in:', session); process.exit(1) }
console.log(`  test account: ${EMAIL}${createdUser ? ' (created for this run)' : ''}`)

// Start from a clean slate so counts are unambiguous.
await rest('words?id=not.is.null', { method: 'DELETE' })
await rest('cards?id=not.is.null', { method: 'DELETE' })

// ---------------------------------------------------------------- browser

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const page = await context.newPage()

// Hand the app the session before any script runs, exactly as the magic link would.
await page.addInitScript(([ref, sess]) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
    access_token: sess.access_token,
    refresh_token: sess.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + sess.expires_in,
    expires_in: sess.expires_in,
    token_type: 'bearer',
    user: sess.user,
  }))
}, [REF, session])

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const signedIn = await page.evaluate(ref =>
  !!localStorage.getItem(`sb-${ref}-auth-token`), REF)
check('app picked up the session', signedIn)

// --------------------------------------------------- 1. local -> Supabase

console.log('\n1. A word created locally reaches Supabase')
await page.click('.fab')
await page.fill('.sheet input.input', 'Ausrede')
await page.waitForTimeout(800)
await page.click('.sheet button:has-text("Speichern")')
await page.waitForTimeout(1200)

// Sync runs on focus; nudge it rather than waiting out the 5-minute timer.
await page.evaluate(() => dispatchEvent(new Event('focus')))
await page.waitForTimeout(3000)

const remote = await rest('words?select=id,lemma,article,translations,updated_at&lemma=eq.Ausrede')
check('word present in Supabase', remote.json?.length === 1, JSON.stringify(remote.json?.[0]?.lemma))
check('gender/article survived the round trip', remote.json?.[0]?.article === 'die')

const remoteCards = await rest('cards?select=id,direction')
check('both cards pushed too', remoteCards.json?.length === 2,
  remoteCards.json?.map(c => c.direction).join(', '))

// --------------------------------------------------- 2. Supabase -> local

console.log('\n2. A newer remote edit wins locally (last-write-wins)')
const wordId = remote.json[0].id
const future = new Date(Date.now() + 60_000).toISOString()
await rest(`words?id=eq.${wordId}`, {
  method: 'PATCH',
  service: true,
  body: { translations: ['excuse', 'pretext', 'EDITED-REMOTELY'], updated_at: future },
})

await page.evaluate(() => dispatchEvent(new Event('focus')))
await page.waitForTimeout(3500)

const localAfter = await page.evaluate(async () => {
  const open = indexedDB.open('wortschatz')
  const db = await new Promise(res => { open.onsuccess = () => res(open.result) })
  const req = db.transaction('words').objectStore('words').getAll()
  return new Promise(res => { req.onsuccess = () => res(req.result) })
})
const edited = localAfter.find(w => w.lemma === 'Ausrede')
check('remote edit applied locally', edited?.translations?.includes('EDITED-REMOTELY'),
  JSON.stringify(edited?.translations))

// --------------------------------------------------- 3. offline queue

console.log('\n3. Offline changes queue, then flush on reconnect')
await context.setOffline(true)
await page.waitForTimeout(300)

await page.click('.fab')
await page.fill('.sheet input.input', 'Haus')
await page.waitForTimeout(700)
await page.click('.sheet button:has-text("Speichern")')
await page.waitForTimeout(1200)

const queued = await page.evaluate(async () => {
  const open = indexedDB.open('wortschatz')
  const db = await new Promise(res => { open.onsuccess = () => res(open.result) })
  const req = db.transaction('syncQueue').objectStore('syncQueue').getAll()
  return new Promise(res => { req.onsuccess = () => res(req.result.length) })
})
check('change queued while offline', queued > 0, `${queued} rows queued`)

const remoteDuringOffline = await rest('words?select=lemma&lemma=eq.Haus')
check('nothing reached the server while offline', remoteDuringOffline.json?.length === 0)

await context.setOffline(false)
await page.evaluate(() => dispatchEvent(new Event('online')))
await page.waitForTimeout(4000)

const remoteAfter = await rest('words?select=lemma&lemma=eq.Haus')
check('queue flushed after reconnect', remoteAfter.json?.length === 1)

const drained = await page.evaluate(async () => {
  const open = indexedDB.open('wortschatz')
  const db = await new Promise(res => { open.onsuccess = () => res(open.result) })
  const req = db.transaction('syncQueue').objectStore('syncQueue').getAll()
  return new Promise(res => { req.onsuccess = () => res(req.result.length) })
})
check('sync queue drained', drained === 0, `${drained} left`)

await browser.close()

// Leave the project exactly as it was found.
await rest('words?id=not.is.null', { method: 'DELETE' })
await rest('cards?id=not.is.null', { method: 'DELETE' })
await rest('grammar_topics?id=not.is.null', { method: 'DELETE' })
await rest('exercises?id=not.is.null', { method: 'DELETE' })
if (createdUser) {
  // Deleting the account cascades to any row this run left behind.
  await fetch(`${URL_}/auth/v1/admin/users/${session.user.id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  })
  console.log('  test account removed')
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) { console.log('Failed: ' + failed.map(f => f.name).join(', ')); process.exitCode = 1 }
