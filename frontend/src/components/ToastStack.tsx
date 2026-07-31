import { useEffect } from 'react'
import './ToastStack.css'

export interface ToastItem {
  id: string
  text: string
}

const AUTO_DISMISS_MS = 4000

interface ToastStackProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

// Most minigames aren't built yet (Phase 2+ per CLAUDE.md build priority) —
// this surfaces a tile-completion minigame draw as a lightweight stub notice
// for any game without a playable build, rather than silently dropping it.
// Games with a build (see MinigameOverlay's GAME_SLUGS) skip this entirely.
export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div className="toast" onClick={() => onDismiss(toast.id)}>
      {toast.text}
    </div>
  )
}
