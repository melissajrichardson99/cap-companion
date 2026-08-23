import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Announcement } from '../api'
import { dismissAnnouncement, getDismissedAnnouncementKeys, isAnnouncementDismissed } from '../dismissedAnnouncements'
import './AnnouncementPopup.css'

interface AnnouncementPopupProps {
  announcements: Announcement[] | null
  // Bumped by App.tsx's handleResetSession whenever Reset Session runs, so
  // this component re-reads localStorage even though it never unmounts
  // across a reset (Reset Session doesn't reload the page).
  resetSignal: number
}

// App-wide "new announcement" popup (guest-facing). Portal-rendered straight
// to document.body -- screen roots (MapScreen, BingoScreen, etc.) use
// isolation:isolate for their foliage decorations, which would otherwise trap
// this popup's stacking context if it rendered inline on one of them (known
// app gotcha, see CLAUDE.md). Dismissal is tracked per-announcement id +
// updated_at (dismissedAnnouncements.ts), not id alone, so dismissing one
// announcement never suppresses a different, still-new one -- and editing an
// announcement's text (which bumps updated_at) makes it reappear for guests
// who already dismissed the prior text.
export function AnnouncementPopup({ announcements, resetSignal }: AnnouncementPopupProps) {
  const [dismissedKeys, setDismissedKeys] = useState<string[]>(() => getDismissedAnnouncementKeys())

  // Reset Session clears the shared kiosk's dismissed-ids localStorage entry
  // (App.tsx) -- re-read it here so previously-dismissed announcements
  // reappear without requiring a full page reload.
  useEffect(() => {
    setDismissedKeys(getDismissedAnnouncementKeys())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])

  if (!announcements) return null

  // Newest first -- defensive re-sort even though the API already orders
  // this way, so display order never silently depends on fetch order.
  const undismissed = announcements
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .filter((a) => !isAnnouncementDismissed(dismissedKeys, a.id, a.updated_at))

  if (undismissed.length === 0) return null

  const current = undismissed[0]

  const dismiss = () => setDismissedKeys(dismissAnnouncement(current.id, current.updated_at))

  return createPortal(
    <div className="announcement-popup-backdrop" onClick={dismiss}>
      <div
        className="announcement-popup-frame"
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-popup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="announcement-popup-inner">
          <h2 id="announcement-popup-title" className="announcement-popup-title">
            <span className="announcement-popup-icon-badge" aria-hidden="true">
              📣
            </span>
            Announcement
            {undismissed.length > 1 && (
              <span className="announcement-popup-counter">
                1 of {undismissed.length}
              </span>
            )}
          </h2>
          <p className="announcement-popup-text">{current.text}</p>
          <button type="button" className="btn btn-primary announcement-popup-dismiss" onClick={dismiss}>
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
