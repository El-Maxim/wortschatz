import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie'
import { navigate } from '../lib/router'
import { poolFor, type RuntimeExercise } from '../lib/exercises'
import { Markdown } from '../ui/Markdown'
import { ExerciseRunner } from '../ui/ExerciseRunner'

export function TopicPage({ slug }: { slug: string }) {
  const topic = useLiveQuery(async () => db.grammarTopics.where('slug').equals(slug).first(), [slug], undefined)
  const [pool, setPool] = useState<RuntimeExercise[] | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => { void poolFor(slug, slug.length).then(setPool) }, [slug, running])

  if (topic === undefined) return <div className="empty">Loading…</div>
  if (!topic) return <div className="empty">Unknown topic.</div>

  if (running && pool) {
    return <ExerciseRunner pool={pool} onExit={() => setRunning(false)} />
  }

  return (
    <>
      <button className="btn ghost small" style={{ marginTop: 10, minHeight: 34 }}
        onClick={() => navigate({ name: 'grammatik' })}>← Grammatik</button>

      <div className="spread" style={{ marginTop: 6 }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>{topic.title}</h2>
        <span className="badge">{topic.level}</span>
      </div>

      <button className="btn primary wide" style={{ margin: '14px 0' }} disabled={!pool?.length}
        onClick={() => setRunning(true)}>
        Üben {pool ? `(${pool.length})` : ''}
      </button>
      {pool && !pool.length && (
        <div className="small dim" style={{ textAlign: 'center', marginBottom: 12 }}>
          No exercises yet — save a few words and they will appear here.
        </div>
      )}

      <Markdown source={topic.theoryMd} />
    </>
  )
}
