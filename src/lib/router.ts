import { useEffect, useState } from 'react'

/** Vite injects the configured base ('/wortschatz/'). */
export const BASE = import.meta.env.BASE_URL

export type Route =
  | { name: 'woerter' }
  | { name: 'word'; id: string }
  | { name: 'ueben' }
  | { name: 'grammatik' }
  | { name: 'topic'; slug: string }
  | { name: 'pruefung' }
  | { name: 'coach' }
  | { name: 'about' }

function parse(pathname: string): Route {
  const rel = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, '')
  const [head, tail] = rel.split('/')
  switch (head) {
    case '': case 'woerter': return tail ? { name: 'word', id: tail } : { name: 'woerter' }
    case 'ueben': return { name: 'ueben' }
    case 'grammatik': return tail ? { name: 'topic', slug: tail } : { name: 'grammatik' }
    case 'pruefung': return { name: 'pruefung' }
    case 'coach': return { name: 'coach' }
    case 'about': return { name: 'about' }
    // Android share target lands here; App reads ?text= and opens capture.
    case 'share-target': return { name: 'woerter' }
    default: return { name: 'woerter' }
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'woerter': return BASE
    case 'word': return `${BASE}woerter/${route.id}`
    case 'topic': return `${BASE}grammatik/${route.slug}`
    default: return `${BASE}${route.name}`
  }
}

export function navigate(route: Route): void {
  history.pushState({}, '', href(route))
  dispatchEvent(new PopStateEvent('popstate'))
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(location.pathname))
  useEffect(() => {
    const onPop = () => setRoute(parse(location.pathname))
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])
  return route
}
