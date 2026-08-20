import { useEffect, useMemo, useRef, useState } from 'react'
import type { RuntimeExercise } from '../lib/exercises'
import { save, uuid } from '../db/dexie'
import { nowIso } from '../lib/scheduler'
import { fold, loose } from '../lib/normalize'
import { speak, speechAvailable } from '../lib/tts'

function isCorrect(ex: RuntimeExercise, answer: string): boolean {
  const given = answer.trim()
  if (!given) return false
  return ex.payload.answers.some(a => loose(a) === loose(given) || fold(a) === fold(given))
}

async function logAttempt(ex: RuntimeExercise, correct: boolean) {
  // Generated exercises have synthetic ids; attempts still count for progress.
  await save('exerciseAttempts', {
    id: uuid(),
    exerciseId: ex.id,
    topicSlug: ex.topicSlug,
    correct,
    answeredAt: nowIso(),
    updatedAt: nowIso(),
    deleted: false,
  })
}

export function ExerciseRunner({ pool, onExit }: { pool: RuntimeExercise[]; onExit: () => void }) {
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [checked, setChecked] = useState<boolean | null>(null)
  const [score, setScore] = useState({ right: 0, total: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const ex = pool[index]

  useEffect(() => { setAnswer(''); setChecked(null); inputRef.current?.focus() }, [index])

  const choices = useMemo(() => {
    if (!ex?.payload.distractors?.length) return null
    const all = [...ex.payload.answers.slice(0, 1), ...ex.payload.distractors]
    return all.sort((a, b) => a.localeCompare(b, 'de'))
  }, [ex])

  if (!ex) {
    const pct = score.total ? Math.round((score.right / score.total) * 100) : 0
    return (
      <div className="empty">
        <span className="glyph">{pct >= 80 ? '🎉' : '💪'}</span>
        <p><strong>{score.right} / {score.total} correct ({pct}%)</strong></p>
        <button className="btn primary" style={{ marginTop: 10 }} onClick={onExit}>Fertig</button>
      </div>
    )
  }

  async function submit(given: string) {
    if (checked !== null) return
    const ok = isCorrect(ex, given)
    setAnswer(given)
    setChecked(ok)
    setScore(s => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1 }))
    await logAttempt(ex, ok)
  }

  return (
    <>
      <div className="spread" style={{ margin: '12px 0 4px' }}>
        <span className="small dim">{index + 1} / {pool.length}</span>
        <div className="wrap">
          <span className="badge">{ex.type.replace('_', ' ')}</span>
          {ex.source === 'generated' && <span className="badge">from your words</span>}
        </div>
      </div>
      <div className="progress"><i style={{ width: `${(index / pool.length) * 100}%` }} /></div>

      <div className="card" style={{ padding: '22px 16px' }}>
        {ex.payload.hint && <div className="small dim" style={{ marginBottom: 8 }}>{ex.payload.hint}</div>}
        <div style={{ fontSize: 19, lineHeight: 1.5 }}>{ex.payload.prompt}</div>

        {choices ? (
          <div className="wrap" style={{ marginTop: 16 }}>
            {choices.map(c => {
              const isAnswer = ex.payload.answers.some(a => loose(a) === loose(c))
              const picked = loose(answer) === loose(c)
              const style = checked === null ? {} : isAnswer
                ? { background: 'var(--ok-soft)', borderColor: 'var(--ok)', color: 'var(--ok)' }
                : picked ? { background: 'var(--bad-soft)', borderColor: 'var(--bad)', color: 'var(--bad)' } : {}
              return (
                <button key={c} className="btn" style={{ flex: '1 1 100px', ...style }}
                  disabled={checked !== null} onClick={() => void submit(c)}>
                  {c}
                </button>
              )
            })}
          </div>
        ) : (
          <input
            ref={inputRef}
            className="input"
            style={{ marginTop: 16, fontSize: 17 }}
            value={answer}
            disabled={checked !== null}
            autoCapitalize="off" autoCorrect="off" spellCheck={false}
            placeholder="Your answer…"
            onChange={e => setAnswer(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void submit(answer) }}
          />
        )}

        {checked === null ? (
          !choices && (
            <button className="btn primary wide" style={{ marginTop: 14 }} disabled={!answer.trim()}
              onClick={() => void submit(answer)}>Prüfen</button>
          )
        ) : (
          <>
            <div className="muted-box" style={{
              marginTop: 14,
              background: checked ? 'var(--ok-soft)' : 'var(--bad-soft)',
              color: checked ? 'var(--ok)' : 'var(--bad)',
            }}>
              <strong>{checked ? 'Richtig!' : `Answer: ${ex.payload.answers[0]}`}</strong>
              {ex.payload.explanation && (
                <div className="small" style={{ marginTop: 5, color: 'var(--text)' }}>{ex.payload.explanation}</div>
              )}
              {speechAvailable() && (
                <button className="btn ghost small" style={{ minHeight: 30, marginTop: 4 }}
                  onClick={() => speak(ex.payload.answers[0])}>🔊 hören</button>
              )}
            </div>
            <button className="btn primary wide" style={{ marginTop: 12 }} onClick={() => setIndex(i => i + 1)}>
              {index + 1 === pool.length ? 'Ergebnis' : 'Weiter'}
            </button>
          </>
        )}
      </div>

      <button className="btn ghost wide small" style={{ minHeight: 38 }} onClick={onExit}>Abbrechen</button>
    </>
  )
}

export { isCorrect }
