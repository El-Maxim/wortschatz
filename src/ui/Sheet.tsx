import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A bottom sheet (centred dialog on desktop).
 *
 * Always rendered through a portal into <body>. This is not a detail: the
 * header has `backdrop-filter`, which makes it a containing block for
 * `position: fixed` descendants, so a sheet rendered inside it would be
 * clipped to the height of the header and pushed off-screen. Portalling makes
 * the sheet independent of wherever it happens to be mounted from.
 */
export function Sheet({ label, onClose, children }: {
  label: string
  onClose: () => void
  children: ReactNode
}) {
  // Escape closes; the page behind must not scroll while the sheet is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  )
}
