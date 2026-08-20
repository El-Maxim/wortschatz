#!/usr/bin/env node
/**
 * Builds the bundled offline dictionary.
 *
 *   node scripts/build-dictionary.mjs
 *
 * Sources (both CC BY-SA, attributed in the app's About screen and the README):
 *   - kaikki.org Wiktextract extract of German entries from English Wiktionary
 *     (~1 GB JSONL — streamed line by line, never held in memory whole)
 *   - hermitdave/FrequencyWords, OpenSubtitles-derived German frequency list
 *
 * Output: `public/dict/<xx>.json` shards keyed by the first two folded letters
 * of the lemma, plus `public/dict/index.json`. Only the output is committed.
 *
 * Downloads are cached outside the repo (override with WORTSCHATZ_CACHE) so
 * re-runs are cheap; nothing large ever lands in the project folder.
 */
import {
  createWriteStream, createReadStream, existsSync, mkdirSync, readdirSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'dict')
const CACHE = process.env.WORTSCHATZ_CACHE ?? join(tmpdir(), 'wortschatz-dict-cache')

const KAIKKI_URL = 'https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl'
const FREQ_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_full.txt'

/** Frequency cut-off: everything commoner than this is kept regardless of POS. */
const FREQ_KEEP = 45_000
/** Hard budget for the emitted shards. */
const SIZE_BUDGET_MB = 15

// ------------------------------------------------------------------ helpers

/** Must match `fold()` in src/lib/normalize.ts — shard keys depend on it. */
function fold(input) {
  return input
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function shardKey(lemma) {
  const f = fold(lemma).replace(/\s/g, '')
  if (!f) return 'zz'
  return f.length === 1 ? f + '_' : f.slice(0, 2)
}

async function download(url, dest, label) {
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`  ${label}: cached (${(statSync(dest).size / 1e6).toFixed(0)} MB)`)
    return dest
  }
  mkdirSync(dirname(dest), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let seen = 0
  let lastLogged = 0
  const source = Readable.fromWeb(res.body)
  source.on('data', (chunk) => {
    seen += chunk.length
    if (total && seen - lastLogged > 50e6) {
      lastLogged = seen
      process.stdout.write(`\r  ${label}: ${(seen / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`)
    }
  })
  const tmp = dest + '.part'
  await pipeline(source, createWriteStream(tmp))
  renameSync(tmp, dest)
  process.stdout.write(`\r  ${label}: ${(seen / 1e6).toFixed(0)} MB done            \n`)
  return dest
}

/**
 * Wiktionary glosses arrive mostly clean; strip the markup that survives.
 *
 * Long glosses are shortened by dropping the trailing parenthetical rather than
 * discarded — Wiktionary's primary sense is often the most verbose one
 * ("to get up (move from a sitting or lying position…)"), and dropping it would
 * leave the entry showing only marginal senses.
 */
function cleanGloss(text) {
  let out = text
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')  // [[link|label]] -> label
    .replace(/'''?/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/[\u{E0000}-\u{E01EF}]/gu, '')          // wiktextract private-use markers
    .replace(/\s+/g, ' ')
    .trim()
  if (out.length > 90) {
    const head = out.split(' (')[0].trim()
    if (head.length >= 3) out = head
  }
  return out.length > 90 ? out.slice(0, 88).trim() + '…' : out
}

const GENDER_TAG = { masculine: 'm', feminine: 'f', neuter: 'n' }

/** A sense that merely points at another form is not a lemma sense. */
function isLemmaSense(sense) {
  if (sense.form_of || sense.alt_of) return false
  const tags = sense.tags ?? []
  if (tags.some(t => ['form-of', 'alt-of', 'inflection-of', 'participle', 'obsolete', 'archaic'].includes(t))) return false
  const first = sense.glosses?.[0] ?? ''
  if (!first) return false
  return !/^(inflection|plural|singular|genitive|dative|accusative|nominative|past|present|superlative|comparative|imperative|alternative (form|spelling)|abbreviation|initialism|acronym|misspelling|obsolete (form|spelling))\b/i.test(first)
}

function extractGender(entry) {
  for (const sense of entry.senses ?? []) {
    for (const tag of sense.tags ?? []) if (GENDER_TAG[tag]) return GENDER_TAG[tag]
  }
  // Fall back to the head template's first positional arg ("n,-:s,-:s").
  const arg = entry.head_templates?.[0]?.args?.['1']
  if (typeof arg === 'string') {
    const head = arg.split(',')[0].trim()
    if (['m', 'f', 'n'].includes(head)) return head
  }
  return undefined
}

function extractPlural(entry) {
  const forms = (entry.forms ?? []).filter(f => !f.source && (f.tags ?? []).includes('plural'))
  const plural = forms.find(f => f.form && f.form !== '-' && f.form.length > 1)
  return plural?.form
}

function extractVerb(entry) {
  const forms = (entry.forms ?? []).filter(f => !f.source)
  const isPast = f => (f.tags ?? []).includes('past')
  const past = forms.find(f => isPast(f) && !(f.tags ?? []).includes('participle') && !(f.tags ?? []).includes('subjunctive'))?.form
  const participle = forms.find(f => (f.tags ?? []).includes('participle') && isPast(f))?.form
  const auxForms = forms.filter(f => (f.tags ?? []).includes('auxiliary')).map(f => f.form)

  /**
   * Separability is marked in the head template's argument as a dot at the
   * prefix boundary — `auf.stehen<…>` is separable, `erheben<…>` is not.
   * The third-person present ("steht auf") corroborates it: a space means the
   * prefix has moved to the end of the clause.
   */
  const headArg = entry.head_templates?.[0]?.args?.['1']
  const stem = typeof headArg === 'string' ? headArg.split('<')[0] : ''
  const thirdPerson = forms.find(f => (f.tags ?? []).includes('third-person') && (f.tags ?? []).includes('present'))?.form
  const separable = stem.includes('.')
    || (!!thirdPerson && thirdPerson.includes(' '))
    || /\bseparable\b/i.test(entry.head_templates?.[0]?.expansion ?? '')

  const out = {}
  if (past) out.pt = past
  if (participle) out.p2 = participle
  // Wiktionary lists both auxiliaries for verbs like `aufstehen` ("haben or
  // sein"). Prefer `sein`: it is the marked case a learner has to remember,
  // and it is the everyday reading for the motion/change-of-state senses.
  if (auxForms.includes('sein')) out.a = 'sein'
  else if (auxForms.includes('haben')) out.a = 'haben'
  if (separable) out.s = true
  return Object.keys(out).length ? out : undefined
}

const POS_MAP = {
  noun: 'noun', name: 'noun', verb: 'verb', adj: 'adj', adv: 'adv',
  phrase: 'phrase', prep: 'other', pron: 'other', conj: 'other',
  num: 'other', intj: 'other', article: 'other', det: 'other', particle: 'other',
}

// ------------------------------------------------------------------ 1. freq

console.log('Wortschatz dictionary build\n')
console.log('Downloading sources...')
const freqFile = await download(FREQ_URL, join(CACHE, 'de_full.txt'), 'frequency list')
const kaikkiFile = await download(KAIKKI_URL, join(CACHE, 'de-wiktextract.jsonl'), 'kaikki German')

console.log('\nReading frequency list...')
const rank = new Map()
{
  const rl = createInterface({ input: createReadStream(freqFile), crlfDelay: Infinity })
  let n = 0
  for await (const line of rl) {
    const word = line.split(' ')[0]
    if (!word) continue
    n++
    if (n > 300_000) break
    const key = fold(word)
    if (key && !rank.has(key)) rank.set(key, n)
  }
  console.log(`  ${rank.size.toLocaleString()} ranked forms`)
}

// ------------------------------------------------------------------ 2. parse

console.log('\nStreaming Wiktextract...')
/** key `lemma pos` -> compact entry */
const entries = new Map()
let read = 0, kept = 0

{
  const rl = createInterface({ input: createReadStream(kaikkiFile), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line) continue
    read++
    if (read % 250_000 === 0) {
      process.stdout.write(`\r  ${read.toLocaleString()} lines - ${kept.toLocaleString()} kept`)
    }
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    if (entry.lang_code !== 'de' || !entry.word) continue

    const pos = POS_MAP[entry.pos]
    if (!pos) continue

    const word = entry.word.trim()
    if (!word || word.length > 40 || /\d/.test(word)) continue

    const senses = (entry.senses ?? []).filter(isLemmaSense)
    if (!senses.length) continue

    const freqRank = rank.get(fold(word))
    const isNoun = pos === 'noun'
    // Spec: top ~45k by frequency, plus ALL nouns so gender lookup rarely misses.
    if (!isNoun && !(freqRank && freqRank <= FREQ_KEEP)) continue

    const glosses = []
    for (const sense of senses) {
      const g = cleanGloss(sense.glosses[0])
      if (g && g.length <= 90 && !glosses.includes(g)) glosses.push(g)
      if (glosses.length >= 4) break
    }
    if (!glosses.length) continue

    const key = `${word} ${pos}`
    const existing = entries.get(key)
    if (existing) {
      for (const g of glosses) if (existing.t.length < 4 && !existing.t.includes(g)) existing.t.push(g)
      continue
    }

    const compact = { l: word, p: pos, t: glosses }
    if (freqRank) compact.f = freqRank

    if (isNoun) {
      const gender = extractGender(entry)
      if (gender) compact.g = gender
      const plural = extractPlural(entry)
      if (plural) compact.pl = plural
    }
    if (pos === 'verb') {
      const verb = extractVerb(entry)
      if (verb) compact.v = verb
    }

    const ipa = (entry.sounds ?? []).find(s => s.ipa)?.ipa
    if (ipa && ipa.length <= 40) compact.ipa = ipa

    const example = senses.flatMap(s => s.examples ?? []).find(e => e.text && e.text.length <= 110)?.text
    if (example) compact.ex = example.replace(/[\u{E0000}-\u{E01EF}]/gu, '').trim()

    entries.set(key, compact)
    kept++
  }
  process.stdout.write(`\r  ${read.toLocaleString()} lines - ${kept.toLocaleString()} kept            \n`)
}

// ------------------------------------------------------------------ 3. emit

function emit(list, { maxGlosses, keepIpa, keepExamples }) {
  const shards = new Map()
  for (const entry of list) {
    const trimmed = { ...entry, t: entry.t.slice(0, maxGlosses) }
    if (!keepIpa) delete trimmed.ipa
    if (!keepExamples) delete trimmed.ex
    const key = shardKey(trimmed.l)
    const bucket = shards.get(key)
    if (bucket) bucket.push(trimmed)
    else shards.set(key, [trimmed])
  }
  return shards
}

const all = [...entries.values()].sort((a, b) => (a.f ?? 1e9) - (b.f ?? 1e9) || a.l.localeCompare(b.l, 'de'))

// Degrade in the order the spec prescribes until the budget is met.
const attempts = [
  { maxGlosses: 4, keepIpa: true, keepExamples: true },
  { maxGlosses: 4, keepIpa: true, keepExamples: false },
  { maxGlosses: 2, keepIpa: false, keepExamples: false },
  { maxGlosses: 1, keepIpa: false, keepExamples: false },
]

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

let chosen = null
for (const opts of attempts) {
  const shards = emit(all, opts)
  let bytes = 0
  for (const [, list] of shards) bytes += Buffer.byteLength(JSON.stringify(list))
  const mb = bytes / 1e6
  console.log(`\nTrying glosses=${opts.maxGlosses} ipa=${opts.keepIpa} examples=${opts.keepExamples}: ${mb.toFixed(1)} MB`)
  chosen = { shards, opts, mb }
  if (mb <= SIZE_BUDGET_MB) break
}

const { shards, opts } = chosen
for (const [key, list] of shards) {
  writeFileSync(join(OUT, `${key}.json`), JSON.stringify(list))
}

writeFileSync(join(OUT, 'index.json'), JSON.stringify({
  shards: [...shards.keys()].sort(),
  count: all.length,
  builtAt: new Date().toISOString().slice(0, 10),
  source: 'kaikki.org Wiktextract (English Wiktionary, CC BY-SA) + hermitdave/FrequencyWords',
  options: opts,
}))

const totalBytes = readdirSync(OUT).reduce((sum, f) => sum + statSync(join(OUT, f)).size, 0)
console.log(`\nWrote ${shards.size} shards + index.json`)
console.log(`  entries : ${all.length.toLocaleString()}`)
console.log(`  nouns   : ${all.filter(e => e.p === 'noun').length.toLocaleString()} (${all.filter(e => e.g).length.toLocaleString()} with gender)`)
console.log(`  verbs   : ${all.filter(e => e.p === 'verb').length.toLocaleString()} (${all.filter(e => e.v).length.toLocaleString()} with forms)`)
console.log(`  size    : ${(totalBytes / 1e6).toFixed(1)} MB  (budget ${SIZE_BUDGET_MB} MB)`)
if (totalBytes / 1e6 > SIZE_BUDGET_MB) {
  console.log('  WARNING: over budget even at minimum detail.')
  process.exitCode = 1
}
