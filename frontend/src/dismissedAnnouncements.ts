// Per-announcement dismissal tracking for the app-wide announcement popup.
// Deliberately a plain array under one shared-kiosk-scoped key, NOT an
// extension of voterSession.ts's per-device id pattern -- that precedent is
// reserved for photo-vote dedup only. This app has no per-device session
// model; localStorage here is just the shared kiosk device's own state,
// which is why clearDismissedAnnouncements() below is wired into the
// existing guest-facing Reset Session flow (App.tsx's handleResetSession)
// rather than anything per-device.
const STORAGE_KEY = 'cap-dismissed-announcement-ids'

export function getDismissedAnnouncementIds(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function dismissAnnouncement(id: string): string[] {
  const current = getDismissedAnnouncementIds()
  if (current.includes(id)) return current
  const next = [...current, id]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function clearDismissedAnnouncements(): void {
  localStorage.removeItem(STORAGE_KEY)
}
