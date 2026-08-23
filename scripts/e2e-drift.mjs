#!/usr/bin/env node
/**
 * A device that has drifted out of step must fix itself when it is opened.
 *
 * The watermark is an optimisation, and any bug in it hides rows while sync
 * still reports success — which is exactly the failure the user cannot see. So
 * the guarantee under test is not "the watermark is correct" but the weaker,
 * far more durable one: whatever state a device is in, a cold start re-reads
 * everything and converges.
 *
 * This puts a device in the worst honest state — watermark in the future, a
 * current version marker, a fresh full-pull stamp, so nothing would trigger a
 * re-read — writes a word elsewhere, and requires a reload to surface it.
 *
 *   npm run build && npm run preview &
 *   node scripts/e2e-drift.mjs [baseUrl]
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

const EMAIL = 'drifttest@example.com'
const PW = 'Drift-Test-1!'

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
  const ctx = await browser.newContext()
  await ctx.addInitScript(([ref, s]) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + s.expires_in,
      expires_in: s.expires_in, token_type: 'bearer', user: s.user,
    }))
  }, [REF, sess])
  const p = await ctx.newPage()
  await p.goto(BASE, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2500)
  return p
}
const sync = async p => {
  await p.evaluate(() => dispatchEvent(new Event('focus')))
  await p.waitForTimeout(4000)
  return p.locator('.topbar button').first().getAttribute('title')
}
const meta = async (p, patch) => p.evaluate(async patch => {
  const open = indexedDB.open('wortschatz')
  const db = await new Promise(r => { open.onsuccess = () => r(open.result) })
  const store = db.transaction('meta', 'readwrite').objectStore('meta')
  const put = (key, value) => new Promise(r => { store.put({ key, value }).onsuccess = r })
  const get = key => new Promise(r => { const q = store.get(key); q.onsuccess = () => r(q.result?.value) })
  for (const [k, v] of Object.entries(patch ?? {})) await put(k, v)
  return { lastSyncAt: await get('lastSyncAt'), ver: await get('syncWatermarkVersion'),
           lastFullPullAt: await get('lastFullPullAt') }
}, patch)

const B = await device()
say('device B syncs', (await sync(B)) === 'Synced')

// The worst honest state: nothing here asks for a re-read.
const now = new Date()
const state = await meta(B, {
  lastSyncAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
  syncWatermarkVersion: 2,
  lastFullPullAt: now.toISOString(),
})
say('B put into a drifted state that triggers no repair', state.ver === 2, JSON.stringify(state))

const A = await device()
await A.click('.fab')
await A.fill('.sheet input.input', 'Meinungsfreiheit')
await A.waitForTimeout(1000)
await A.click('.sheet button:has-text("Speichern")')
await A.waitForTimeout(1200)
say('device A pushes a new word', (await sync(A)) === 'Synced')

const remote = await (await fetch(`${URL_}/rest/v1/words?select=lemma&user_id=eq.${user.id}`, { headers: admin })).json()
say('word reached the server', remote.some(w => w.lemma === 'Meinungsfreiheit'), JSON.stringify(remote))

// An in-place sync legitimately misses it — the watermark says it is ahead.
await sync(B)
const beforeReload = await B.textContent('.main')
say('an incremental sync alone does not find it (expected)', !/Meinungsfreiheit/.test(beforeReload))

// Opening the app must repair that, with no user action and no hard refresh.
await B.goto(BASE, { waitUntil: 'networkidle' })
await B.waitForTimeout(4000)
const afterReload = await B.textContent('.main')
say('opening the app recovers the missing word', /Meinungsfreiheit/.test(afterReload),
  afterReload.replace(/\s+/g, ' ').slice(0, 90))

const healed = await meta(B)
say('watermark is back on real server data', Date.parse(healed.lastSyncAt) < Date.now() + 60_000,
  JSON.stringify(healed))

await browser.close()
await fetch(`${URL_}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: admin })
console.log('  test account removed')
if (failures) process.exitCode = 1
