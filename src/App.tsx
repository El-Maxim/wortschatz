import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db/dexie'
import { useRoute } from './lib/router'
import { Shell } from './ui/Shell'
import { Woerter } from './screens/Woerter'
import { WordDetail } from './screens/WordDetail'
import { Ueben } from './screens/Ueben'
import { Grammatik } from './screens/Grammatik'
import { TopicPage } from './screens/TopicPage'
import { Pruefung } from './screens/Pruefung'
import { Coach } from './screens/Coach'
import { About } from './screens/About'
import { Capture } from './ui/Capture'

const TITLES: Record<string, string> = {
  woerter: 'Wörter', word: 'Wort', ueben: 'Üben', grammatik: 'Grammatik',
  topic: 'Grammatik', pruefung: 'Prüfung', coach: 'Coach', about: 'Über',
}

export default function App() {
  const route = useRoute()
  const [capture, setCapture] = useState<{ open: boolean; prefill: string }>({ open: false, prefill: '' })

  const openCapture = useCallback((prefill = '') => setCapture({ open: true, prefill }), [])
  const closeCapture = useCallback(() => setCapture({ open: false, prefill: '' }), [])

  // `?add=WORD` (iOS Shortcut) and the Android share target both land here.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const shared = params.get('add') ?? params.get('text') ?? params.get('title')
    if (shared?.trim()) {
      openCapture(shared.trim().split(/\s+/).slice(0, 6).join(' '))
      history.replaceState({}, '', location.pathname)
    }
  }, [openCapture])

  // Keyboard shortcut on desktop: "n" for a new word.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
      if (!typing && !e.metaKey && !e.ctrlKey && e.key === 'n') { e.preventDefault(); openCapture() }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [openCapture])

  const dueCount = useLiveQuery(
    async () => db.cards.where('due').belowOrEqual(new Date().toISOString()).filter(c => !c.deleted).count(),
    [], 0,
  )
  const coachCount = useLiveQuery(
    async () => {
      const pending = await db.coachRequests.where('status').equals('pending').filter(r => !r.deleted).count()
      const fresh = await db.suggestions.where('status').equals('new').filter(s => !s.deleted).count()
      return pending + fresh
    }, [], 0,
  )

  const body = (() => {
    switch (route.name) {
      case 'woerter': return <Woerter onCapture={openCapture} />
      case 'word': return <WordDetail id={route.id} />
      case 'ueben': return <Ueben />
      case 'grammatik': return <Grammatik />
      case 'topic': return <TopicPage slug={route.slug} />
      case 'pruefung': return <Pruefung />
      case 'coach': return <Coach />
      case 'about': return <About />
    }
  })()

  return (
    <>
      <Shell
        route={route}
        title={TITLES[route.name] ?? 'Wortschatz'}
        badges={{ ueben: dueCount ?? 0, coach: coachCount ?? 0 }}
        headerRight={<SyncBadge />}
        onCapture={() => openCapture()}
      >
        {body}
      </Shell>
      {capture.open && <Capture prefill={capture.prefill} onClose={closeCapture} />}
    </>
  )
}

/** Placeholder until Phase 4 wires real sync state. */
function SyncBadge() {
  return <span className="sync-dot off" title="Not signed in — working offline" aria-label="Sync status" />
}
