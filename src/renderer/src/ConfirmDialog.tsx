import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLayer } from './layers'

// Asks before an action that cannot be taken back from Flux. Over the whole window, whatever opens
// it: Escape, the scrim and "Annuler" leave everything as it was
export function ConfirmDialog({
  title,
  children,
  action,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string
  children: ReactNode
  action: string
  busy?: boolean
  onConfirm(): void
  onCancel(): void
}) {
  const root = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useLayer(true, onCancel, { root, focus: true })

  return createPortal(
    <div className="scrim confirm-scrim" onClick={onCancel}>
      <div
        ref={root}
        className="settings glass-dark confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-layer
        onClick={event => event.stopPropagation()}
      >
        <h1 id={titleId}>{title}</h1>
        <div className="confirm-body">{children}</div>
        <div className="confirm-actions">
          <button type="button" className="pill glass small" onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="pill small confirm-danger" disabled={busy} onClick={onConfirm}>
            {action}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
