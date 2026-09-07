// Guest account auth token storage (Guest Accounts Phase 0). Deliberately
// separate from and independent of deviceSession.ts -- the anonymous
// per-device token keeps working exactly as it does today, entirely
// unaffected by whether a guest is also logged in via this. Unlike
// deviceSession.ts, the backend issues this token (signup/login); this
// module never mints one itself.
const STORAGE_KEY = 'cap-guest-auth-token'

export function getGuestAuthToken(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setGuestAuthToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token)
}

export function clearGuestAuthToken(): void {
  localStorage.removeItem(STORAGE_KEY)
}
