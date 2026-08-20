import { useCallback, useEffect, useRef, useState } from 'react'
import type { Rating } from '../types'
import { buildQueue, recordReview, stats, type QueueItem, type Stats } from '../db/review'
import { gradeTyped, intervalPreview, RATING_LABELS, type GradeResult } from '../lib/scheduler'
import { speak, speechAvailable } from '../lib/tts'
import { navigate } from '../lib/router'

export function Ueben() {
  const [queue, setQueue] = useState<QueueItem[] | null>(null)
  const [index, setIndex] = useState(0)
  const [summary, setSummary] = useState<Stats | null>(null)
  const [done, setDone] = useState(0)

  const load = useCallback(async () => {
    const [q, s] = await Promise.all([buildQueue(), stats()])
    setQueue(q); setSummary(s); setIndex(0); setDone(0)
  }, [])

  useEffect(() => { void load() }, [load])

  const advance = useCallback(async () => {
    setIndex(i => i + 1)
    setDone(d => d + 1)
    setSummary(await stats())
  }, [])

  if (queue === null) return <div className="empty">Loading…</div>

  const item = queue[index]

  if (!item) {
    return (
      <>
        <div className="empty">
          <span className="glyph">{done > 0 ? '🎉' : '☕'}</span>
          <p><strong>{done > 0 ? `${done} reviews done.` : 'Nothing due right now.'}</strong></p>
          <p className="small">
            {done > 0 ? 'Come back tomorrow — FSRS has scheduled the next round.' : 'Add words with + and they will show up here.'}
          </p>
          <button className="btn" style={{ marginTop: 10 }} onClick={() => void load()}>Refresh</button>
        </div>
        {summary && <StatsPanel s={summary} />}
      </>
    )
  }

  return (
    <>
      <div className="spread" style={{ margin: '12px 0 4px' }}>
        <span className="small dim">{index + 1} / {queue.length}</span>
        <span className="badge">{item.card.direction === 'de-en' ? 'DE → EN' : 'EN → DE'}</span>
      </div>
      <div className="progress"><i style={{ width: `${(index / queue.length) * 100}%` }} /></div>

      {item.card.direction === 'de-en'
        ? <RecallCard key={item.card.id} item={item} onDone={advance} />
        : <ProduceCard key={item.card.id} item={item} onDone={advance} />}

      {summary && <StatsPanel s={summary} />}
    </>
  )
}

/** DE → EN: show the German, user recalls the meaning, then self-grades. */
function RecallCard({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const [revealed, setRevealed] = useState(false)
  const started = useRef(Date.now())
  const display = item.word.article ? `${item.word.article} ${item.word.lemma}` : item.word.lemma
  const previews = intervalPreview(item.card)

  const answer = useCallback(async (rating: Rating) => {
    await recordReview(item, rating, Date.now() - started.current)
    onDone()
  }, [item, onDone])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); setRevealed(true); return }
      if (revealed && ['1', '2', '3', '4'].includes(e.key)) void answer(Number(e.key) as Rating)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [revealed, answer])

  return (
    <div className="card" style={{ textAlign: 'center', padding: '28px 16px' }}>
      <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>
        {item.word.article && <span className={item.word.article}>{item.word.article} </span>}
        {item.word.lemma}
      </div>
      {speechAvailable() && (
        <button className="btn ghost" style={{ marginTop: 6 }} onClick={() => speak(display)} aria-label="Pronounce">🔊</button>
      )}

      {!revealed ? (
        <button className="btn primary wide" style={{ marginTop: 22 }} onClick={() => setRevealed(true)}>
          Umdrehen
        </button>
      ) : (
        <>
          <div style={{ fontSize: 20, marginTop: 16 }}>
            {item.word.translations.length ? item.word.translations.join(' · ') : <span className="dim">no translation yet</span>}
          </div>
          {item.word.plural && <div className="small dim" style={{ marginTop: 4 }}>Plural: die {item.word.plural}</div>}
          {item.word.verbProps?.partizip2 && (
            <div className="small dim" style={{ marginTop: 4 }}>
              {item.word.lemma} · {item.word.verbProps.praeteritum} · {item.word.verbProps.aux === 'sein' ? 'ist' : 'hat'} {item.word.verbProps.partizip2}
            </div>
          )}
          {item.word.contextSentence && (
            <div className="muted-box small" style={{ marginTop: 14, fontStyle: 'italic', textAlign: 'left' }}>
              „{item.word.contextSentence}“
            </div>
          )}
          <div className="wrap" style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {([1, 2, 3, 4] as Rating[]).map(r => (
              <button key={r} className={`btn ${r === 3 ? 'primary' : ''}`} style={{ flexDirection: 'column', gap: 2, padding: '6px 4px', minHeight: 56 }}
                onClick={() => void answer(r)}>
                <span style={{ fontSize: 14 }}>{RATING_LABELS[r]}</span>
                <span className="small" style={{ opacity: .75, fontWeight: 400 }}>{previews[r]}</span>
              </button>
            ))}
          </div>
          <div className="small dim" style={{ marginTop: 8 }}>Keys 1–4</div>
        </>
      )}
    </div>
  )
}

/** EN → DE: user must type the German (with the article for nouns). */
function ProduceCard({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const [typed, setTyped] = useState('')
  const [result, setResult] = useState<GradeResult | null>(null)
  const started = useRef(Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const prompt = item.word.translations[0] ?? item.word.lemma

  useEffect(() => { inputRef.current?.focus() }, [])

  async function check() {
    if (!typed.trim() || result) return
    setResult(gradeTyped(item.word, typed))
  }

  async function commit(rating: Rating) {
    await recordReview(item, rating, Date.now() - started.current)
    onDone()
  }

  const expected = item.word.article ? `${item.word.article} ${item.word.lemma}` : item.word.lemma

  return (
    <div className="card" style={{ padding: '24px 16px' }}>
      <div className="small dim" style={{ textAlign: 'center' }}>Wie heißt das auf Deutsch?</div>
      <div style={{ fontSize: 26, fontWeight: 700, textAlign: 'center', marginTop: 6 }}>{prompt}</div>
      {item.word.translations.length > 1 && (
        <div className="small dim" style={{ textAlign: 'center' }}>({item.word.translations.slice(1).join(', ')})</div>
      )}
      {item.word.pos === 'noun' && (
        <div className="small dim" style={{ textAlign: 'center', marginTop: 6 }}>Include the article.</div>
      )}

      <input
        ref={inputRef}
        className="input"
        style={{ marginTop: 16, fontSize: 18, textAlign: 'center' }}
        value={typed}
        disabled={!!result}
        placeholder={item.word.pos === 'noun' ? 'der/die/das …' : '…'}
        autoCapitalize="off" autoCorrect="off" spellCheck={false}
        onChange={e => setTyped(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') void check() }}
      />

      {!result ? (
        <button className="btn primary wide" style={{ marginTop: 14 }} disabled={!typed.trim()} onClick={check}>
          Prüfen
        </button>
      ) : (
        <>
          <div className={`muted-box`} style={{
            marginTop: 14,
            background: result.rating === 3 ? 'var(--ok-soft)' : result.rating === 2 ? 'var(--warn-soft)' : 'var(--bad-soft)',
            color: result.rating === 3 ? 'var(--ok)' : result.rating === 2 ? 'var(--warn)' : 'var(--bad)',
          }}>
            <strong>{result.note}</strong>
            <div style={{ marginTop: 4, color: 'var(--text)' }}>
              {expected}
              {speechAvailable() && (
                <button className="btn ghost" style={{ minHeight: 28, padding: '0 8px' }} onClick={() => speak(expected)} aria-label="Pronounce">🔊</button>
              )}
            </div>
          </div>

          {item.word.contextSentence && (
            <div className="muted-box small" style={{ marginTop: 10, fontStyle: 'italic' }}>„{item.word.contextSentence}“</div>
          )}

          <button className="btn primary wide" style={{ marginTop: 14 }} onClick={() => void commit(result.rating)}>
            Weiter ({RATING_LABELS[result.rating]})
          </button>
          {result.rating < 3 && (
            <button className="btn ghost wide small" style={{ marginTop: 8, minHeight: 38 }} onClick={() => void commit(3)}>
              I was actually right → count as Good
            </button>
          )}
        </>
      )}
    </div>
  )
}

function StatsPanel({ s }: { s: Stats }) {
  return (
    <div className="card">
      <div className="spread" style={{ flexWrap: 'wrap', gap: 14 }}>
        <Stat label="Today" value={String(s.doneToday)} />
        <Stat label="Due" value={String(s.dueNow)} />
        <Stat label="Streak" value={s.streak ? `${s.streak} d` : '—'} />
        <Stat label="Retention 30d" value={s.retention30 === null ? '—' : `${Math.round(s.retention30 * 100)}%`} />
      </div>
      <div className="small dim" style={{ marginTop: 10 }}>
        {s.reviews30} reviews in the last 30 days ·{' '}
        <a href="#" onClick={e => { e.preventDefault(); navigate({ name: 'woerter' }) }}>see words</a>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div className="small dim">{label}</div>
    </div>
  )
}
