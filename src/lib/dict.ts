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

/**
 * All dictionary senses for a lemma, best first.
 *
 * German capitalisation is meaningful, so an exact-case match ranks first:
 * typing `schön` must give the adjective, not the surname `Schön`. Only when
 * nothing matches the typed casing (the user typed `haus`) do entries carrying
 * gender or verb data win, then frequency breaks the tie.
 */
export async function lookup(input: string): Promise<DictEntry[]> {
  const term = input.trim()
  if (!term) return []
  const shard = await loadShard(shardKey(term))
  const hits = shard.get(fold(term)) ?? []
  const score = (e: DictEntry) => (e.l === term ? 2 : 0) + (e.g || e.v ? 1 : 0)
  return [...hits].sort((a, b) => score(b) - score(a) || (a.f ?? 1e9) - (b.f ?? 1e9))
}

/** The single best entry for a lemma (see `lookup` for the ranking), or null. */
export async function lookupBest(input: string): Promise<DictEntry | null> {
  return (await lookup(input))[0] ?? null
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
