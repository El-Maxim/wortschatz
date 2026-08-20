import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, save } from '../db/dexie'
import type { Exam, ExamItem } from '../types'
import { isoWeek } from '../lib/week'
import { requestCoach } from '../db/words'
import { fold, loose } from '../lib/normalize'
import { nowIso } from '../lib/scheduler'
import { CoachHelp } from '../ui/CoachHelp'

export function Pruefung() {
  const week = isoWeek()
  const exams = useLiveQuery(
    async () => (await db.exams.filter(e => !e.deleted).toArray()).sort((a, b) => b.isoWeek.localeCompare(a.isoWeek)),
    [], undefined,
  )
  const pending = useLiveQuery(
    async () => db.coachRequests.filter(r => !r.deleted && r.kind === 'weekly_exam' && r.status === 'pending').count(),
    [], 0,
  )
  const [taking, setTaking] = useState<Exam | null>(null)

  if (exams === undefined) return <div className="empty">Loading…</div>

  const current = exams.find(e => e.isoWeek === week)
  const history = exams.filter(e => e.takenAt && e.score !== null)

  if (taking) return <ExamRunner exam={taking} onExit={() => setTaking(null)} />

  return (
    <>
      <div className="card">
        <div className="spread">
          <strong>Woche {week}</strong>
          {current?.takenAt
            ? <span className="badge ok">{current.score}%</span>
            : current ? <span className="badge">ready</span> : <span className="badge warn">no exam</span>}
        </div>

        {current ? (
          current.takenAt ? (
            <>
              <div className="small dim" style={{ marginTop: 6 }}>
                Taken {new Date(current.takenAt).toLocaleDateString()} · {current.items.filter(i => i.correct).length}/{current.items.length} correct
              </div>
              <button className="btn wide" style={{ marginTop: 10 }} onClick={() => setTaking(current)}>Review answers</button>
            </>
          ) : (
            <>
              <div className="small dim" style={{ marginTop: 6 }}>{current.items.length} items · vocabulary, grammar and translation.</div>
              <button className="btn primary wide" style={{ marginTop: 10 }} onClick={() => setTaking(current)}>Prüfung starten</button>
            </>
          )
        ) : pending ? (
          <div className="small dim" style={{ marginTop: 6 }}>Requested — run <code>/coach</code> to generate it.</div>
        ) : (
          <button className="btn primary wide" style={{ marginTop: 10 }}
            onClick={() => requestCoach('weekly_exam', { isoWeek: week })}>
            Request exam
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div className="card">
          <strong className="small">Score history</strong>
          <ScoreChart exams={history.slice(0, 12).reverse()} />
          <table className="grid" style={{ marginTop: 8 }}>
            <tbody>
              {history.slice(0, 8).map(e => (
                <tr key={e.id}>
                  <td>{e.isoWeek}</td>
                  <td><span className={`badge ${(e.score ?? 0) >= 80 ? 'ok' : (e.score ?? 0) >= 60 ? 'warn' : 'bad'}`}>{e.score}%</span></td>
                  <td className="dim small">{e.takenAt ? new Date(e.takenAt).toLocaleDateString() : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!current && <CoachHelp />}
    </>
  )
}

function ScoreChart({ exams }: { exams: Exam[] }) {
  const w = 100, h = 34
  const step = exams.length > 1 ? w / (exams.length - 1) : 0
  const points = exams.map((e, i) => `${i * step},${h - ((e.score ?? 0) / 100) * h}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 60, marginTop: 10 }} aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {exams.map((e, i) => (
        <circle key={e.id} cx={i * step} cy={h - ((e.score ?? 0) / 100) * h} r="1.6" fill="var(--accent)" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}

/** Walks the 20 items; auto-grades what it can, self-grade for translations. */
function ExamRunner({ exam, onExit }: { exam: Exam; onExit: () => void }) {
  const done = exam.takenAt !== null
  const [items, setItems] = useState<ExamItem[]>(exam.items)
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [checked, setChecked] = useState(false)

  const item = items[index]

  if (!item) {
    const right = items.filter(i => i.correct).length
    const score = Math.round((right / items.length) * 100)
    return (
      <div className="empty">
        <span className="glyph">{score >= 80 ? '🏆' : score >= 60 ? '👍' : '📚'}</span>
        <p><strong>{right} / {items.length} — {score}%</strong></p>
        <button className="btn primary" style={{ marginTop: 10 }}
          onClick={async () => {
            if (!done) {
              await save('exams', { ...exam, items, score, takenAt: nowIso() })
            }
            onExit()
          }}>Fertig</button>
      </div>
    )
  }

  function record(correct: boolean, given: string) {
    setItems(list => list.map((it, i) => (i === index ? { ...it, userAnswer: given, correct } : it)))
    setChecked(true)
  }

  function autoGrade() {
    const ok = item.answers.some(a => loose(a) === loose(answer) || fold(a) === fold(answer))
    record(ok, answer)
  }

  const selfGraded = item.kind === 'translate'

  return (
    <>
      <div className="spread" style={{ margin: '12px 0 4px' }}>
        <span className="small dim">{index + 1} / {items.length}</span>
        <span className="badge">{item.kind}</span>
      </div>
      <div className="progress"><i style={{ width: `${(index / items.length) * 100}%` }} /></div>

      <div className="card" style={{ padding: '22px 16px' }}>
        <div style={{ fontSize: 18, lineHeight: 1.5 }}>{item.prompt}</div>

        {item.distractors?.length ? (
          <div className="wrap" style={{ marginTop: 14 }}>
            {[...item.answers.slice(0, 1), ...item.distractors].sort((a, b) => a.localeCompare(b, 'de')).map(c => (
              <button key={c} className="btn" style={{ flex: '1 1 110px' }} disabled={checked}
                onClick={() => record(item.answers.some(a => loose(a) === loose(c)), c)}>{c}</button>
            ))}
          </div>
        ) : (
          <input className="input" style={{ marginTop: 14 }} value={answer} disabled={checked}
            autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="Your answer…"
            onChange={e => setAnswer(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !selfGraded) autoGrade() }} />
        )}

        {!checked ? (
          !item.distractors?.length && (
            selfGraded
              ? <button className="btn primary wide" style={{ marginTop: 12 }} disabled={!answer.trim()}
                  onClick={() => record(true, answer)}>Antwort zeigen</button>
              : <button className="btn primary wide" style={{ marginTop: 12 }} disabled={!answer.trim()}
                  onClick={autoGrade}>Prüfen</button>
          )
        ) : (
          <>
            <div className="muted-box" style={{ marginTop: 12 }}>
              <strong>Model answer:</strong> {item.answers[0]}
              {item.explanation && <div className="small dim" style={{ marginTop: 4 }}>{item.explanation}</div>}
            </div>
            {selfGraded && (
              <div className="wrap" style={{ marginTop: 10 }}>
                <button className="btn" style={{ flex: 1, background: 'var(--ok-soft)', color: 'var(--ok)' }}
                  onClick={() => { record(true, answer); setIndex(i => i + 1); setAnswer(''); setChecked(false) }}>
                  I got it right
                </button>
                <button className="btn" style={{ flex: 1, background: 'var(--bad-soft)', color: 'var(--bad)' }}
                  onClick={() => { record(false, answer); setIndex(i => i + 1); setAnswer(''); setChecked(false) }}>
                  I got it wrong
                </button>
              </div>
            )}
            {!selfGraded && (
              <button className="btn primary wide" style={{ marginTop: 12 }}
                onClick={() => { setIndex(i => i + 1); setAnswer(''); setChecked(false) }}>
                {index + 1 === items.length ? 'Ergebnis' : 'Weiter'}
              </button>
            )}
          </>
        )}
      </div>

      <button className="btn ghost wide small" style={{ minHeight: 38 }} onClick={onExit}>Abbrechen</button>
    </>
  )
}
