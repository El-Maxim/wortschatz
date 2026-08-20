import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie'
import { navigate } from '../lib/router'
import { poolFor } from '../lib/exercises'
import { requestCoach } from '../db/words'

export function Grammatik() {
  const topics = useLiveQuery(
    async () => (await db.grammarTopics.filter(t => !t.deleted).toArray())
      .sort((a, b) => a.level.localeCompare(b.level) || a.title.localeCompare(b.title)),
    [], undefined,
  )
  const attempts = useLiveQuery(async () => db.exerciseAttempts.filter(a => !a.deleted).toArray(), [], [])
  const pending = useLiveQuery(
    async () => db.coachRequests.filter(r => !r.deleted && r.kind === 'grammar_topic' && r.status === 'pending').toArray(),
    [], [],
  )

  const [sizes, setSizes] = useState<Record<string, number>>({})
  const [asking, setAsking] = useState(false)
  const [topicName, setTopicName] = useState('')

  useEffect(() => {
    if (!topics) return
    void (async () => {
      const out: Record<string, number> = {}
      for (const t of topics) out[t.slug] = (await poolFor(t.slug)).length
      setSizes(out)
    })()
  }, [topics])

  if (topics === undefined) return <div className="empty">Loading…</div>

  return (
    <>
      {topics.map(t => {
        const mine = attempts.filter(a => a.topicSlug === t.slug)
        const right = mine.filter(a => a.correct).length
        const pct = mine.length ? Math.round((right / mine.length) * 100) : 0
        return (
          <button key={t.slug} className="card" style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }}
            onClick={() => navigate({ name: 'topic', slug: t.slug })}>
            <div className="spread">
              <strong style={{ fontSize: 16 }}>{t.title}</strong>
              <div className="wrap">
                <span className="badge">{t.level}</span>
                {t.status === 'generated' && <span className="badge ok">coach</span>}
              </div>
            </div>
            <div className="small dim" style={{ marginTop: 6 }}>
              {sizes[t.slug] ?? '…'} exercises · {mine.length ? `${right}/${mine.length} correct (${pct}%)` : 'not started'}
            </div>
            {mine.length > 0 && <div className="progress" style={{ marginTop: 8 }}><i style={{ width: `${pct}%` }} /></div>}
          </button>
        )
      })}

      {pending.map(r => (
        <div key={r.id} className="card">
          <div className="spread">
            <strong>{String((r.payload as { topic?: string }).topic ?? 'New topic')}</strong>
            <span className="badge warn">waiting for coach</span>
          </div>
          <div className="small dim" style={{ marginTop: 4 }}>Run <code>/coach</code> in Claude Code to write it.</div>
        </div>
      ))}

      <div className="card">
        {asking ? (
          <>
            <strong className="small">Which topic?</strong>
            <input className="input" style={{ marginTop: 8 }} autoFocus value={topicName}
              placeholder="e.g. Konjunktiv II"
              onChange={e => setTopicName(e.target.value)}
              onKeyDown={async e => {
                if (e.key === 'Enter' && topicName.trim()) {
                  await requestCoach('grammar_topic', { topic: topicName.trim() })
                  setTopicName(''); setAsking(false)
                }
              }} />
            <div className="wrap" style={{ marginTop: 8 }}>
              <button className="btn primary small" style={{ minHeight: 36 }} disabled={!topicName.trim()}
                onClick={async () => { await requestCoach('grammar_topic', { topic: topicName.trim() }); setTopicName(''); setAsking(false) }}>
                Anfragen
              </button>
              <button className="btn ghost small" style={{ minHeight: 36 }} onClick={() => setAsking(false)}>Cancel</button>
            </div>
          </>
        ) : (
          <button className="btn wide" onClick={() => setAsking(true)}>+ Request new topic</button>
        )}
      </div>
    </>
  )
}
