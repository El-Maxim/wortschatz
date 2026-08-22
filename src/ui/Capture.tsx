import { useEffect, useRef, useState } from 'react'
import type { DictEntry, Word } from '../types'
import { lookup, prefetch, suggest } from '../lib/dict'
import { speak, speechAvailable } from '../lib/tts'
import { articleForGender } from '../lib/normalize'
import { captureWord, findExisting } from '../db/words'
import { Sheet } from './Sheet'

interface Props {
  prefill?: string
  onClose: () => void
}

/**
 * Capture sheet. Typing debounces a shard lookup; the first exact hit is shown
 * with article, glosses, plural and verb parts. Save is always available —
 * a miss stores the word as unresolved and queues coach research.
 */
export function Capture({ prefill = '', onClose }: Props) {
  const [term, setTerm] = useState(prefill)
  const [hits, setHits] = useState<DictEntry[]>([])
  const [alternatives, setAlternatives] = useState<DictEntry[]>([])
  const [chosen, setChosen] = useState<DictEntry | null>(null)
  const [searching, setSearching] = useState(false)
  const [context, setContext] = useState('')
  const [showContext, setShowContext] = useState(false)
  const [duplicate, setDuplicate] = useState<Word | null>(null)
  const [saved, setSaved] = useState<Word | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Debounced live lookup while typing.
  useEffect(() => {
    const q = term.trim()
    setChosen(null)
    if (q.length < 2) { setHits([]); setAlternatives([]); setDuplicate(null); return }
    prefetch(q)
    setSearching(true)
    const timer = setTimeout(async () => {
      const [exact, near, existing] = await Promise.all([lookup(q), suggest(q), findExisting(q)])
      setHits(exact)
      setAlternatives(near.filter(e => e.l.toLowerCase() !== q.toLowerCase()))
      setDuplicate(existing ?? null)
      setSearching(false)
    }, 180)
    return () => { clearTimeout(timer); setSearching(false) }
  }, [term])

  const entry = chosen ?? hits[0] ?? null
  const article = articleForGender(entry?.g ?? null)
  const display = entry ? (article ? `${article} ${entry.l}` : entry.l) : term.trim()

  async function onSave() {
    const lemma = entry?.l ?? term.trim()
    if (!lemma) return
    const word = await captureWord({ lemma, entry, contextSentence: context })
    setSaved(word)
    setTimeout(onClose, 900)
  }

  if (saved) {
    return (
      <Sheet label="Word saved" onClose={onClose}>
        <div className="empty">
            <span className="glyph">{saved.unresolved ? '📮' : '✅'}</span>
            <strong>{saved.article ? `${saved.article} ` : ''}{saved.lemma}</strong> saved
            <div className="small dim" style={{ marginTop: 6 }}>
              {saved.unresolved
                ? 'Not in the dictionary — queued for the coach to research.'
                : 'Card created. It is due in your next Üben session.'}
          </div>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet label="Add a word" onClose={onClose}>
      <>
        <div className="spread" style={{ marginBottom: 10 }}>
          <strong>Neues Wort</strong>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <input
          ref={inputRef}
          className="input"
          value={term}
          placeholder="Type a German word…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={e => setTerm(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && term.trim()) void onSave() }}
        />

        {duplicate && (
          <div className="muted-box small" style={{ marginTop: 10 }}>
            ⚠️ You already saved <strong>{duplicate.article ? `${duplicate.article} ` : ''}{duplicate.lemma}</strong>.
            Saving again creates a second entry.
          </div>
        )}

        {entry ? (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="spread">
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {article && <span className={article}>{article} </span>}
                {entry.l}
              </div>
              {speechAvailable() && (
                <button className="btn ghost" onClick={() => speak(display)} aria-label="Pronounce" title="Pronounce">🔊</button>
              )}
            </div>

            {entry.t?.length > 0 && <div style={{ marginTop: 4 }}>{entry.t.join(' · ')}</div>}

            <div className="wrap small dim" style={{ marginTop: 8 }}>
              <span className="badge">{entry.p}</span>
              {entry.pl && <span className="badge">pl. die {entry.pl}</span>}
              {entry.v?.pt && <span className="badge">Prät. {entry.v.pt}</span>}
              {entry.v?.p2 && <span className="badge">Part. II {entry.v.a === 'sein' ? 'ist ' : 'hat '}{entry.v.p2}</span>}
              {entry.v?.s && <span className="badge warn">trennbar</span>}
              {entry.ipa && <span className="badge">{entry.ipa}</span>}
              {entry.f && <span className="badge">#{entry.f}</span>}
            </div>

            {entry.ex && <div className="small dim" style={{ marginTop: 8, fontStyle: 'italic' }}>„{entry.ex}“</div>}
          </div>
        ) : term.trim().length >= 2 && !searching ? (
          <div className="muted-box small" style={{ marginTop: 12 }}>
            No dictionary entry for <strong>{term.trim()}</strong>. Save it anyway — the coach will
            fill in the article, translation and forms next time you run <code>/coach</code>.
          </div>
        ) : null}

        {alternatives.length > 0 && !chosen && (
          <div className="wrap" style={{ marginTop: 10 }}>
            {alternatives.map(alt => (
              <button key={alt.l + alt.p} className="btn small" style={{ minHeight: 34, padding: '0 10px' }}
                onClick={() => { setTerm(alt.l); setChosen(alt) }}>
                {articleForGender(alt.g ?? null) ?? ''} {alt.l}
              </button>
            ))}
          </div>
        )}

        {showContext ? (
          <textarea
            className="input"
            style={{ marginTop: 12, minHeight: 76, resize: 'vertical' }}
            placeholder="Where did you see it? Paste the sentence."
            value={context}
            onChange={e => setContext(e.target.value)}
          />
        ) : (
          <button className="btn ghost small" style={{ marginTop: 10, minHeight: 36 }}
            onClick={() => setShowContext(true)}>
            + Where did you see it?
          </button>
        )}

        <button className="btn primary wide" style={{ marginTop: 14 }} disabled={!term.trim()} onClick={onSave}>
          Speichern
        </button>
        <div className="small dim" style={{ textAlign: 'center', marginTop: 8 }}>
          Enter saves · Esc closes
        </div>
      </>
    </Sheet>
  )
}
