#!/usr/bin/env node
/**
 * Screenshot pass over every section at phone and desktop widths.
 * Drives the locally installed Chrome (channel: 'chrome') so no browser
 * download is needed. Run against `npm run preview`.
 *
 *   node scripts/shots.mjs [baseUrl] [outDir]
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:4173/wortschatz/'
const OUT = process.argv[3] ?? 'screenshots'
mkdirSync(OUT, { recursive: true })

const ROUTES = ['', 'ueben', 'grammatik', 'pruefung', 'coach', 'about']
const VIEWPORTS = [
  { tag: 'mobile', width: 390, height: 844, isMobile: true },
  { tag: 'desktop', width: 1280, height: 900, isMobile: false },
]

const browser = await chromium.launch({ channel: 'chrome' })
const problems = []

/** A few words so the screens show real content rather than empty states. */
const SEED = [
  ['Haus', 'In dem Haus wohnt eine große Familie.'],
  ['Ausrede', 'Das ist doch nur eine Ausrede!'],
  ['laufen', null],
  ['aufstehen', 'Ich muss morgen früh aufstehen.'],
  ['Mädchen', null],
]

async function seed(page, base) {
  await page.goto(base, { waitUntil: 'networkidle' })
  for (const [term, sentence] of SEED) {
    await page.click('.fab')
    await page.fill('.sheet input.input', term)
    await page.waitForTimeout(600)
    if (sentence) {
      await page.click('text=Where did you see it?')
      await page.fill('.sheet textarea', sentence)
    }
    await page.click('.sheet button:has-text("Speichern")')
    await page.waitForTimeout(1100)
  }
}

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    hasTouch: vp.isMobile,
    isMobile: vp.isMobile,
  })
  const page = await context.newPage()
  await seed(page, BASE)
  page.on('pageerror', e => problems.push(`[${vp.tag}] page error: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') problems.push(`[${vp.tag}] console: ${m.text()}`) })

  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(350)

    // Horizontal overflow is the classic responsive bug — assert it directly.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 1) problems.push(`[${vp.tag}] /${route || 'woerter'} overflows by ${overflow}px`)

    const name = `${OUT}/${vp.tag}-${route || 'woerter'}.png`
    await page.screenshot({ path: name, fullPage: false })
    console.log(`  ${name}`)
  }
  await context.close()
}

await browser.close()

if (problems.length) {
  console.log('\nPROBLEMS:')
  for (const p of problems) console.log('  ' + p)
  process.exitCode = 1
} else {
  console.log('\nNo layout overflow or console errors.')
}
