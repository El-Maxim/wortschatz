import type { ReactNode } from 'react'
import { href, navigate, type Route } from '../lib/router'

export interface NavItem {
  name: Route['name']
  label: string
  glyph: string
  badge?: number
}

const NAV: NavItem[] = [
  { name: 'woerter', label: 'Wörter', glyph: '📖' },
  { name: 'ueben', label: 'Üben', glyph: '🔁' },
  { name: 'grammatik', label: 'Grammatik', glyph: '🧩' },
  { name: 'pruefung', label: 'Prüfung', glyph: '🏁' },
  { name: 'coach', label: 'Coach', glyph: '✨' },
]

/** A section's own route plus its detail routes highlight the same tab. */
function sectionOf(route: Route): Route['name'] {
  if (route.name === 'word') return 'woerter'
  if (route.name === 'topic') return 'grammatik'
  return route.name
}

interface Props {
  route: Route
  badges: Partial<Record<Route['name'], number>>
  title: string
  headerRight?: ReactNode
  children: ReactNode
  onCapture: () => void
}

export function Shell({ route, badges, title, headerRight, children, onCapture }: Props) {
  const active = sectionOf(route)

  const link = (item: NavItem) => {
    const count = badges[item.name] ?? 0
    return (
      <a
        key={item.name}
        className="tab"
        href={href({ name: item.name } as Route)}
        aria-current={active === item.name ? 'page' : undefined}
        onClick={(e) => {
          // Let cmd/ctrl-click open a real new tab.
          if (e.metaKey || e.ctrlKey) return
          e.preventDefault()
          navigate({ name: item.name } as Route)
        }}
      >
        <span className="glyph" aria-hidden="true">{item.glyph}</span>
        <span>{item.label}</span>
        {count > 0 && <span className="pip">{count > 99 ? '99+' : count}</span>}
      </a>
    )
  }

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Sections">
        <div className="brand"><span aria-hidden="true">🇩🇪</span> Wortschatz</div>
        {NAV.map(link)}
        <div style={{ flex: 1 }} />
        <a
          className="tab"
          href={href({ name: 'about' })}
          aria-current={active === 'about' ? 'page' : undefined}
          onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate({ name: 'about' }) }}
        >
          <span className="glyph" aria-hidden="true">ℹ️</span><span>Über</span>
        </a>
      </nav>

      <div className="content">
        <header className="topbar">
          <h1>{title}</h1>
          {headerRight}
        </header>
        <main className="main">{children}</main>
      </div>

      <nav className="tabs" aria-label="Sections">{NAV.map(link)}</nav>

      <button className="fab" onClick={onCapture} aria-label="Add a word" title="Add a word (n)">+</button>
    </div>
  )
}
