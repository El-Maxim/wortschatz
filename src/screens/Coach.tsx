import { useLiveQuery } from 'dexie-react-hooks'
import { db, save, softDelete, uuid } from '../db/dexie'
import type { Suggestion } from '../types'
import { CoachHelp } from '../ui/CoachHelp'
import { articleForGender } from '../lib/normalize'
import { nowIso } from '../lib/scheduler'
import { createCardsFor, requestCoach } from '../db/words'
import { speak, speechAvailable } from '../lib/tts'

const KIND_LABEL: Record<string, string> = {
  word_research: 'Word research',
  grammar_topic: 'New grammar topic',
  suggestions: 'Vocabulary suggestions',
  weekly_exam: 'Weekly exam',
}

export function Coach() {
  const requests = useLiveQuery(
    async () => (await db.coachRequests.filter(r => !r.deleted).toArray())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [], undefined,
  )
  const suggestions = useLiveQuery(
    async () => (await db.suggestions.filter(s => !s.deleted && s.status === 'new').toArray())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [], [],
  )

  if (requests === undefined) return <div className="empty">Loading…</div>

  const pending = requests.filter(r => r.status === 'pending')
  const recent = requests.filter(r => r.status !== 'pending').slice(0, 6)

  async function accept(s: Suggestion) {
    const article = articleForGender(s.gender)
    const id = uuid()
    await save('words', {
      id,
      lemma: s.lemma,
      pos: s.gender ? 'noun' : 'other',
      gender: s.gender,
      article,
      plural: null,
      translations: s.translations,
      verbProps: null,
      contextSentence: null,
      sourceNote: 'Coach suggestion',
      freqRank: null,
      tags: ['suggested'],
      unresolved: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deleted: false,
    })
    await createCardsFor(id)
    await save('suggestions', { ...s, status: 'accepted' })
  }

  return (
    <>
      {pending.length > 0 && (
        <div className="card">
          <div className="spread"><strong>Pending ({pending.length})</strong><span className="badge warn">needs /coach</span></div>
          <table className="grid" style={{ marginTop: 8 }}>
            <tbody>
              {pending.map(r => (
                <tr key={r.id}>
                  <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="dim small">{describe(r.payload)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn ghost small" style={{ minHeight: 28, padding: '0 8px' }}
                      onClick={() => softDelete('coachRequests', r.id)} aria-label="Cancel">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {suggestions.length > 0 && (
        <>
          <div className="spread" style={{ margin: '16px 2px 0' }}>
            <strong>Suggested words</strong>
            <span className="small dim">{suggestions.length}</span>
          </div>
          {suggestions.map(s => {
            const article = articleForGender(s.gender)
            return (
              <div key={s.id} className="card">
                <div className="spread">
                  <div style={{ fontSize: 18, fontWeight: 650 }}>
                    {article && <span className={article}>{article} </span>}{s.lemma}
                  </div>
                  {speechAvailable() && (
                    <button className="btn ghost" style={{ minHeight: 32 }}
                      onClick={() => speak(article ? `${article} ${s.lemma}` : s.lemma)} aria-label="Pronounce">🔊</button>
                  )}
                </div>
                <div className="small">{s.translations.join(' · ')}</div>
                <div className="small dim" style={{ marginTop: 6 }}>{s.reason}</div>
                {s.relatedTo.length > 0 && (
                  <div className="wrap" style={{ marginTop: 6 }}>
                    {s.relatedTo.map(r => <span key={r} className="badge">{r}</span>)}
                  </div>
                )}
                <div className="wrap" style={{ marginTop: 10 }}>
                  <button className="btn primary small" style={{ minHeight: 36, flex: 1 }} onClick={() => accept(s)}>Hinzufügen</button>
                  <button className="btn ghost small" style={{ minHeight: 36 }}
                    onClick={() => save('suggestions', { ...s, status: 'dismissed' })}>Dismiss</button>
                </div>
              </div>
            )
          })}
        </>
      )}

      {!pending.length && !suggestions.length && (
        <div className="empty">
          <span className="glyph">✨</span>
          <p><strong>Nothing waiting.</strong></p>
          <p className="small">Run <code>/coach</code> for fresh suggestions and a weekly exam.</p>
        </div>
      )}

      <div className="wrap" style={{ marginTop: 12 }}>
        <button className="btn" style={{ flex: 1 }} onClick={() => requestCoach('suggestions', {})}>
          Ask for new suggestions
        </button>
      </div>

      {recent.length > 0 && (
        <div className="card">
          <strong className="small">Recently completed</strong>
          <table className="grid" style={{ marginTop: 8 }}>
            <tbody>
              {recent.map(r => (
                <tr key={r.id}>
                  <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="dim small">{describe(r.payload)}</td>
                  <td><span className={`badge ${r.status === 'done' ? 'ok' : 'bad'}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CoachHelp />
    </>
  )
}

function describe(payload: Record<string, unknown>): string {
  const v = payload.lemma ?? payload.topic ?? payload.isoWeek
  return typeof v === 'string' ? v : ''
}
