import { useEffect, type ReactNode } from 'react'
import './Modal.css'

interface ModalProps {
  onClose: () => void
  children: ReactNode
  labelledBy?: string
  className?: string
}

// Generic accessible popup shell — backdrop click + Escape both close it.
// Replaces the browser confirm()/alert() dialogs from the smoke-test build.
export function Modal({ onClose, children, labelledBy, className }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={className ? `modal-panel ${className}` : 'modal-panel'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
