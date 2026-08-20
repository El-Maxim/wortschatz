import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie'
import type { Word } from '../types'
import { fold } from '../lib/normalize'
import { navigate } from '../lib/router'
import { speak, speechAvailable } from '../lib/tts'

type Sort = 'recent' | 'alpha' | 'freq' | 'due'

export function WordRow({ word, due }: { word: Word; due?: string }) {
  return (
    <button
      className="card"
      style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }}
      onClick={() => navigate({ name: 'word', id: word.id })}
    >
      <div className="spread">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 650 }}>
            {word.article && <span className={word.article}>{word.article} </span>}
            {word.lemma}
          </div>
          <div className="small dim" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {word.translations.length ? word.translations.join(', ') : '—'}
          </div>
        </div>
        <div className="wrap" style={{ justifyContent: 'flex-end', flex: '0 0 auto' }}>
          {word.unresolved && <span className="badge warn">unresolved</span>}
          {word.pos !== 'noun' && word.pos !== 'other' && <span className="badge">{word.pos}</span>}
          {due && <span className="badge ok">{due}</span>}
        </div>
      </div>
    </button>
  )
}

export function Woerter({ onCapture }: { onCapture: (prefill?: string) => void }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recent')

  const words = useLiveQuery(async () => db.words.filter(w => !w.deleted).toArray(), [], undefined)
  const cards = useLiveQuery(async () => db.cards.filter(c => !c.deleted).toArray(), [], undefined)

  const nextDue = useMemo(() => {
    const map = new Map<string, string>()
    for (const card of cards ?? []) {
      const prev = map.get(card.wordId)
      if (!prev || card.due < prev) map.set(card.wordId, card.due)
    }
    return map
  }, [cards])

  const shown = useMemo(() => {
    const q = fold(query)
    const list = (words ?? []).filter(w =>
      !q || fold(w.lemma).includes(q) || w.translations.some(t => fold(t).includes(q)),
    )
    const byDue = (w: Word) => nextDue.get(w.id) ?? '9999'
    switch (sort) {
      case 'alpha': return list.sort((a, b) => a.lemma.localeCompare(b.lemma, 'de'))
      case 'freq': return list.sort((a, b) => (a.freqRank ?? 1e9) - (b.freqRank ?? 1e9))
      case 'due': return list.sort((a, b) => byDue(a).localeCompare(byDue(b)))
      default: return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }
  }, [words, query, sort, nextDue])

  if (words === undefined) return <div className="empty">Loading…</div>

  if (!words.length) {
    return (
      <div className="empty">
        <span className="glyph">📖</span>
        <p><strong>No words yet.</strong></p>
        <p className="small">Tap <strong>+</strong> and type a German word you met today.</p>
        <button className="btn primary" style={{ marginTop: 8 }} onClick={() => onCapture()}>Erstes Wort hinzufügen</button>
      </div>
    )
  }

  const today = new Date().toISOString()
  const dueNow = (words ?? []).filter(w => (nextDue.get(w.id) ?? '9999') <= today).length

  return (
    <>
      <input
        className="input"
        style={{ marginTop: 12 }}
        placeholder={`Search ${words.length} words…`}
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div className="spread" style={{ marginTop: 10 }}>
        <div className="wrap">
          {(['recent', 'alpha', 'freq', 'due'] as Sort[]).map(s => (
            <button
              key={s}
              className={`btn small ${sort === s ? 'primary' : 'ghost'}`}
              style={{ minHeight: 32, padding: '0 11px', fontSize: 13 }}
              onClick={() => setSort(s)}
            >
              {s === 'recent' ? 'Newest' : s === 'alpha' ? 'A–Z' : s === 'freq' ? 'Common' : 'Due'}
            </button>
          ))}
        </div>
        <span className="small dim">{dueNow} due</span>
      </div>

      {shown.map(w => (
        <WordRow key={w.id} word={w} due={(nextDue.get(w.id) ?? '9999') <= today ? 'due' : undefined} />
      ))}
      {!shown.length && <div className="empty small">Nothing matches “{query}”.</div>}
      {speechAvailable() && shown.length > 0 && (
        <div className="small dim" style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          Tap a word for details, forms and 🔊
        </div>
      )}
      <span className="visually-hidden" onClick={() => speak('')} />
    </>
  )
}
