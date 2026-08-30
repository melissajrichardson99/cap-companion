// Lightweight per-device "who am I" layer for staff attribution -- separate
// from staffAuth.ts's shared session token (staff auth stays one shared
// password, no per-staff accounts; see CLAUDE.md scope). Same
// localStorage-per-device persistence pattern as staffAuth.ts.
const STORAGE_KEY = 'cap-staff-display-name'

export function getStaffName(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setStaffName(name: string): void {
  localStorage.setItem(STORAGE_KEY, name)
}

export function clearStaffName(): void {
  localStorage.removeItem(STORAGE_KEY)
}
