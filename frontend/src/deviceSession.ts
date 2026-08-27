// App-wide per-device session id (Per-Device Sessions Phase 0 -- foundational
// plumbing only, no real feature reads this yet). Generalizes the old
// Favorite-Photo-only voterSession.ts pattern (retired in Phase 5) to every
// feature: generated once client-side via crypto.randomUUID(), persisted in
// localStorage, sent as the X-Device-Session header on every API request
// (see api.ts's request()). Synchronous and requires no network round-trip --
// the backend upsert-on-first-use's whatever token it's handed, there's no
// "create session" call.
const STORAGE_KEY = 'cap-device-session-id'

export function getDeviceSessionId(): string {
  let id = localStorage.getItem(STORAGE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, id)
  }
  return id
}
