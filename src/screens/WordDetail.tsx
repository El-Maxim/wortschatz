import { useLiveQuery } from 'dexie-react-hooks'
import { db, save, softDelete } from '../db/dexie'
import { navigate } from '../lib/router'
import { speak, speechAvailable } from '../lib/tts'
import { RATING_LABELS } from '../lib/scheduler'
import { requestCoach } from '../db/words'
import { useState } from 'react'

const STATE_LABEL = ['New', 'Learning', 'Review', 'Relearning']

export function WordDetail({ id }: { id: string }) {
  const word = useLiveQuery(async () => db.words.get(id), [id], undefined)
  const cards = useLiveQuery(async () => db.cards.where('wordId').equals(id).toArray(), [id], [])
  const logs = useLiveQuery(
    async () => (await db.reviewLog.where('wordId').equals(id).toArray())
      .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt)).slice(0, 20),
    [id], [],
  )
  const [context, setContext] = useState<string | null>(null)

  if (word === undefined) return <div className="empty">Loading…</div>
  if (!word || word.deleted) return <div className="empty">This word is gone.</div>

  const display = word.article ? `${word.article} ${word.lemma}` : word.lemma

  async function saveContext() {
    if (!word || context === null) return
    await save('words', { ...word, contextSentence: context.trim() || null })
    setContext(null)
  }

  return (
    <>
      <button className="btn ghost small" style={{ marginTop: 10, minHeight: 34 }}
        onClick={() => navigate({ name: 'woerter' })}>← Wörter</button>

      <div className="card">
        <div className="spread">
          <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {word.article && <span className={word.article}>{word.article} </span>}
            {word.lemma}
          </div>
          {speechAvailable() && (
            <button className="btn ghost" onClick={() => speak(display)} aria-label="Pronounce">🔊</button>
          )}
        </div>

        {word.translations.length > 0
          ? <div style={{ marginTop: 6, fontSize: 17 }}>{word.translations.join(' · ')}</div>
          : <div className="small dim" style={{ marginTop: 6 }}>No translation yet.</div>}

        <div className="wrap small" style={{ marginTop: 10 }}>
          <span className="badge">{word.pos}</span>
          {word.plural && <span className="badge">pl. die {word.plural}</span>}
          {word.freqRank && <span className="badge">rank #{word.freqRank}</span>}
          {word.unresolved && <span className="badge warn">unresolved</span>}
          {word.tags.map(t => <span key={t} className="badge">{t}</span>)}
        </div>

        {word.verbProps && (
          <table className="grid" style={{ marginTop: 12 }}>
            <tbody>
              <tr><th>Präteritum</th><td>{word.verbProps.praeteritum ?? '—'}</td></tr>
              <tr><th>Partizip II</th><td>{word.verbProps.aux === 'sein' ? 'ist ' : 'hat '}{word.verbProps.partizip2 ?? '—'}</td></tr>
              <tr><th>Hilfsverb</th><td>{word.verbProps.aux}</td></tr>
              <tr><th>Trennbar</th><td>{word.verbProps.separable ? 'ja' : 'nein'}</td></tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <strong className="small">Where you met it</strong>
        {context === null ? (
          <>
            <p style={{ fontStyle: word.contextSentence ? 'italic' : undefined, margin: '8px 0 0' }}>
              {word.contextSentence ? `„${word.contextSentence}“` : <span className="dim small">Nothing saved. Adding a sentence unlocks cloze exercises for this word.</span>}
            </p>
            {word.sourceNote && <div className="small dim" style={{ marginTop: 4 }}>{word.sourceNote}</div>}
            <button className="btn ghost small" style={{ marginTop: 8, minHeight: 34 }}
              onClick={() => setContext(word.contextSentence ?? '')}>
              {word.contextSentence ? 'Edit' : 'Add sentence'}
            </button>
          </>
        ) : (
          <>
            <textarea className="input" style={{ marginTop: 8, minHeight: 72 }} value={context}
              onChange={e => setContext(e.target.value)} autoFocus />
            <div className="wrap" style={{ marginTop: 8 }}>
              <button className="btn primary small" style={{ minHeight: 36 }} onClick={saveContext}>Save</button>
              <button className="btn ghost small" style={{ minHeight: 36 }} onClick={() => setContext(null)}>Cancel</button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <strong className="small">Cards</strong>
        <table className="grid" style={{ marginTop: 8 }}>
          <thead><tr><th>Direction</th><th>State</th><th>Due</th><th>Reps</th><th>Lapses</th></tr></thead>
          <tbody>
            {cards.filter(c => !c.deleted).map(c => (
              <tr key={c.id}>
                <td>{c.direction === 'de-en' ? 'DE → EN' : 'EN → DE'}</td>
                <td>{STATE_LABEL[c.state]}</td>
                <td>{new Date(c.due).toLocaleDateString()}</td>
                <td>{c.reps}</td>
                <td>{c.lapses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {logs.length > 0 && (
        <div className="card">
          <strong className="small">Review history</strong>
          <table className="grid" style={{ marginTop: 8 }}>
            <tbody>
              {logs.map(l => (
                <tr key={l.id}>
                  <td>{new Date(l.reviewedAt).toLocaleString()}</td>
                  <td><span className={`badge ${l.rating === 1 ? 'bad' : l.rating >= 3 ? 'ok' : 'warn'}`}>{RATING_LABELS[l.rating]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="wrap" style={{ margin: '18px 0 8px' }}>
        {word.unresolved && (
          <button className="btn small" style={{ minHeight: 38 }}
            onClick={() => requestCoach('word_research', { lemma: word.lemma, wordId: word.id })}>
            Ask coach to research
          </button>
        )}
        <button className="btn ghost small" style={{ minHeight: 38, color: 'var(--bad)' }}
          onClick={async () => {
            if (!confirm(`Delete “${display}” and its cards?`)) return
            for (const c of cards) await softDelete('cards', c.id)
            await softDelete('words', word.id)
            navigate({ name: 'woerter' })
          }}>
          Löschen
        </button>
      </div>
    </>
  )
}
