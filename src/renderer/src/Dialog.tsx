import { useRef, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLayer } from './layers'

// A form over the whole window. Escape, the scrim and the close button all go through onClose; the
// form takes the focus when nothing in it has it, and gives it back on closing
export function DialogForm({
  label,
  className = '',
  onClose,
  onSubmit,
  children,
}: {
  label: string
  className?: string
  onClose(): void
  onSubmit(event: FormEvent<HTMLFormElement>): void
  children: ReactNode
}) {
  const form = useRef<HTMLFormElement>(null)
  useLayer(true, onClose, { root: form, focus: true })

  return createPortal(
    <div className="scrim" onClick={onClose}>
      <form
        ref={form}
        className={`settings glass-dark ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-layer
        onSubmit={onSubmit}
        onClick={event => event.stopPropagation()}
      >
        {children}
      </form>
    </div>,
    document.body,
  )
}
