import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie'
import { dictStats } from '../lib/dict'
import { speechAvailable } from '../lib/tts'

export function About() {
  const [dict, setDict] = useState<{ count: number; builtAt: string } | null>(null)
  useEffect(() => { void dictStats().then(setDict) }, [])

  const counts = useLiveQuery(async () => ({
    words: await db.words.filter(w => !w.deleted).count(),
    cards: await db.cards.filter(c => !c.deleted).count(),
    reviews: await db.reviewLog.filter(r => !r.deleted).count(),
    topics: await db.grammarTopics.filter(t => !t.deleted).count(),
  }), [], undefined)

  return (
    <>
      <div className="card">
        <strong>Wortschatz</strong>
        <p className="small dim" style={{ marginTop: 4 }}>
          A personal German vocabulary and grammar trainer. Everything lives on this device;
          Supabase only mirrors it so your phone and computer agree. No paid service is involved.
        </p>
      </div>

      {counts && (
        <div className="card">
          <strong className="small">Your data</strong>
          <table className="grid" style={{ marginTop: 8 }}>
            <tbody>
              <tr><th>Words</th><td>{counts.words}</td></tr>
              <tr><th>Cards</th><td>{counts.cards}</td></tr>
              <tr><th>Reviews</th><td>{counts.reviews}</td></tr>
              <tr><th>Grammar topics</th><td>{counts.topics}</td></tr>
              <tr><th>Dictionary</th><td>{dict ? `${dict.count.toLocaleString()} entries` : 'not loaded'}</td></tr>
              <tr><th>Speech</th><td>{speechAvailable() ? 'available' : 'unavailable on this browser'}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <strong className="small">Data sources &amp; licences</strong>
        <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.8 }}>
          <li>
            Dictionary data extracted from{' '}
            <a href="https://en.wiktionary.org/" target="_blank" rel="noreferrer">English Wiktionary</a>{' '}
            via <a href="https://kaikki.org/dictionary/German/" target="_blank" rel="noreferrer">kaikki.org</a>{' '}
            (Wiktextract). Licensed{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.
          </li>
          <li>
            Frequency ranks from{' '}
            <a href="https://github.com/hermitdave/FrequencyWords" target="_blank" rel="noreferrer">hermitdave/FrequencyWords</a>{' '}
            (OpenSubtitles-derived, CC BY-SA 4.0).
          </li>
          <li>
            Scheduling by <a href="https://github.com/open-spaced-repetition/ts-fsrs" target="_blank" rel="noreferrer">ts-fsrs</a> (FSRS, MIT).
          </li>
          <li>Pronunciation uses your browser&apos;s built-in Web Speech voices.</li>
        </ul>
      </div>

      <div className="card">
        <strong className="small">Coach</strong>
        <p className="small dim" style={{ marginTop: 4 }}>
          AI work runs through Claude Code on your computer via the <code>/coach</code> command,
          covered by your Claude subscription. The app holds no API keys and never calls a model.
        </p>
      </div>
    </>
  )
}
