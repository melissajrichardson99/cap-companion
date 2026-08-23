import { useEffect, useMemo } from 'react'
import type { MilestoneEvent } from '../api'
import './MilestoneBanner.css'

const AUTO_DISMISS_MS = 2800

const CONFETTI_COLORS = ['#eab308', '#3b82f6', '#ea580c', '#1fa172', '#d946ef']

interface MilestoneBannerProps {
  event: MilestoneEvent
  onDone: () => void
}

// The demo centerpiece (tech spec 4.2 / plan 2.6): a full-shape tile
// highlight is driven separately by BingoScreen's grid classes — this piece
// is just the celebratory message overlay on top of it.
export function MilestoneBanner({ event, onDone }: MilestoneBannerProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [event, onDone])

  const confetti = useMemo(() => {
    if (event.type !== 'blackout') return []
    return Array.from({ length: 32 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 1.8 + Math.random() * 1.2,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    }))
  }, [event])

  return (
    <div className={`milestone-banner milestone-banner-${event.type}`} onClick={onDone}>
      {confetti.map((c) => (
        <span
          key={c.id}
          className="confetti-piece"
          style={{
            left: `${c.left}%`,
            animationDelay: `${c.delay}s`,
            animationDuration: `${c.duration}s`,
            background: c.color,
          }}
        />
      ))}
      <span className="milestone-banner-text">{event.message}</span>
      {event.coins_awarded > 0 && (
        <span className="milestone-banner-coins">{`🪙 +${event.coins_awarded} Cobb Coins`}</span>
      )}
    </div>
  )
}
