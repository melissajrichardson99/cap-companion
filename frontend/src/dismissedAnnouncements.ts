// Per-announcement dismissal tracking for the app-wide announcement popup.
// Deliberately a plain array under one shared-kiosk-scoped key, NOT an
// extension of voterSession.ts's per-device id pattern -- that precedent is
// reserved for photo-vote dedup only. This app has no per-device session
// model; localStorage here is just the shared kiosk device's own state,
// which is why clearDismissedAnnouncements() below is wired into the
// existing guest-facing Reset Session flow (App.tsx's handleResetSession)
// rather than anything per-device.
//
// Keyed off `${id}:${updated_at}`, not id alone -- editing an announcement's
// text bumps updated_at server-side, which changes the key and makes it no
// longer match a guest's prior dismissal, so an edited announcement is
// treated as undismissed again without creating a new announcement row or
// duplicating it anywhere.
const STORAGE_KEY = 'cap-dismissed-announcement-ids'

function dismissalKey(id: string, updatedAt: string): string {
  return `${id}:${updatedAt}`
}

export function getDismissedAnnouncementKeys(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function isAnnouncementDismissed(dismissedKeys: string[], id: string, updatedAt: string): boolean {
  return dismissedKeys.includes(dismissalKey(id, updatedAt))
}

export function dismissAnnouncement(id: string, updatedAt: string): string[] {
  const key = dismissalKey(id, updatedAt)
  const current = getDismissedAnnouncementKeys()
  if (current.includes(key)) return current
  const next = [...current, key]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function clearDismissedAnnouncements(): void {
  localStorage.removeItem(STORAGE_KEY)
}
