/**
 * German-aware normalisation shared by dictionary lookup and answer grading.
 *
 * `fold` is the aggressive form used for indexing and "did they basically get
 * it right" checks: lowercased, umlauts expanded the way a German keyboard-less
 * typist would write them (ä→ae, ß→ss), punctuation stripped.
 */
export function fold(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Lighter form: keeps umlauts, drops case and punctuation. Used to tell an
 *  exact answer from a merely-close one (diacritic slips grade as Hard). */
export function loose(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** First two folded letters of a lemma — the dictionary shard key. */
export function shardKey(lemma: string): string {
  const f = fold(lemma).replace(/\s/g, '')
  if (!f) return 'zz'
  return (f.length === 1 ? f + '_' : f.slice(0, 2))
}

const ARTICLES = ['der', 'die', 'das']

/** Splits a typed answer like "die Ausrede" into its article and the noun. */
export function splitArticle(input: string): { article: string | null; rest: string } {
  const trimmed = input.trim().replace(/\s+/g, ' ')
  const [first, ...others] = trimmed.split(' ')
  if (others.length && ARTICLES.includes(first.toLowerCase())) {
    return { article: first.toLowerCase(), rest: others.join(' ') }
  }
  return { article: null, rest: trimmed }
}

export function articleForGender(gender: 'm' | 'f' | 'n' | null): 'der' | 'die' | 'das' | null {
  if (gender === 'm') return 'der'
  if (gender === 'f') return 'die'
  if (gender === 'n') return 'das'
  return null
}

/** Levenshtein distance, capped — used to spot near-miss typing. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  const cur = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur.slice()
  }
  return prev[n]
}
