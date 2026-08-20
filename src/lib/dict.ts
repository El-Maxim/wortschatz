import type { DictEntry } from '../types'
import { BASE } from './router'
import { fold, shardKey } from './normalize'

/**
 * Dictionary access. Shards live in `public/dict/<xx>.json`, keyed by the first
 * two folded letters of the lemma. A shard is fetched at most once per session
 * and then kept in memory; the service worker keeps it on disk (cache-first),
 * so any word the user has looked up once stays available offline.
 */

interface DictIndex {
  shards: string[]
  /** Folded lemma keys, sorted — lets us answer "is this a word at all?"
   *  without downloading the shard. */
  keys?: string[]
  count: number
  builtAt: string
}

const memory = new Map<string, Map<string, DictEntry[]>>()
const inflight = new Map<string, Promise<Map<string, DictEntry[]>>>()
let indexPromise: Promise<DictIndex | null> | null = null

async function loadIndex(): Promise<DictIndex | null> {
  indexPromise ??= fetch(`${BASE}dict/index.json`)
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
  return indexPromise
}

async function loadShard(key: string): Promise<Map<string, DictEntry[]>> {
  const cached = memory.get(key)
  if (cached) return cached

  let pending = inflight.get(key)
  if (!pending) {
    pending = fetch(`${BASE}dict/${key}.json`)
      .then(async (r) => {
        if (!r.ok) return new Map<string, DictEntry[]>()
        const raw = (await r.json()) as DictEntry[]
        const byKey = new Map<string, DictEntry[]>()
        for (const entry of raw) {
          const k = fold(entry.l)
          const bucket = byKey.get(k)
          if (bucket) bucket.push(entry)
          else byKey.set(k, [entry])
        }
        return byKey
      })
      .catch(() => new Map<string, DictEntry[]>())
      .then((m) => { memory.set(key, m); inflight.delete(key); return m })
    inflight.set(key, pending)
  }
  return pending
}

/** All dictionary senses for a lemma, best first (nouns before rarer POS). */
export async function lookup(input: string): Promise<DictEntry[]> {
  const term = input.trim()
  if (!term) return []
  const shard = await loadShard(shardKey(term))
  const hits = shard.get(fold(term)) ?? []
  return [...hits].sort((a, b) => (a.f ?? 1e9) - (b.f ?? 1e9))
}

/** The single best entry for a lemma, or null. */
export async function lookupBest(input: string): Promise<DictEntry | null> {
  const hits = await lookup(input)
  if (!hits.length) return null
  // Prefer an entry that actually carries gender/verb data over a bare gloss.
  return hits.find(e => e.g || e.v) ?? hits[0]
}

/** Prefix suggestions for the capture field, from the already-loaded shard. */
export async function suggest(input: string, limit = 6): Promise<DictEntry[]> {
  const term = fold(input.trim())
  if (term.length < 2) return []
  const shard = await loadShard(shardKey(input.trim()))
  const out: DictEntry[] = []
  for (const [key, entries] of shard) {
    if (!key.startsWith(term)) continue
    const best = entries.find(e => e.g || e.v) ?? entries[0]
    out.push(best)
    if (out.length > 400) break
  }
  return out
    .sort((a, b) => {
      const exact = Number(fold(b.l) === term) - Number(fold(a.l) === term)
      return exact || (a.f ?? 1e9) - (b.f ?? 1e9)
    })
    .slice(0, limit)
}

export async function dictStats(): Promise<{ count: number; builtAt: string } | null> {
  const idx = await loadIndex()
  return idx ? { count: idx.count, builtAt: idx.builtAt } : null
}

/** Warm the shard for a term so the next keystroke resolves instantly. */
export function prefetch(input: string): void {
  if (input.trim().length >= 2) void loadShard(shardKey(input.trim()))
}
