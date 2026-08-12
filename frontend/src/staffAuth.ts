// Staff session token storage for the /staff page (single shared password,
// no per-staff accounts -- see CLAUDE.md scope). The token itself is a
// signed, timestamped opaque string from the backend (app/staff_auth.py);
// this module never inspects it, just persists it across reloads.
const STORAGE_KEY = 'cap-staff-session-token'

export function getStaffToken(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setStaffToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token)
}

export function clearStaffToken(): void {
  localStorage.removeItem(STORAGE_KEY)
}
