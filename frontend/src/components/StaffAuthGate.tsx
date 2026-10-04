import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { clearStaffToken, getStaffToken } from '../staffAuth'
import { StaffLoginScreen } from './StaffLoginScreen'
import './StaffPage.css'

// Shared staff-only route guard (extracted from StaffPage.tsx) -- /staff and
// /staff/heatmap both render through this. The client-side guard is a
// convenience, not the real enforcement (that's require_staff on every staff
// backend route), but we still don't want to flash staff data before
// confirming the stored token is actually valid.
export function StaffAuthGate({ children }: { children: (onLoggedOut: () => void) => ReactNode }) {
  // null while the stored token (if any) is still being validated.
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    const token = getStaffToken()
    if (!token) {
      setAuthed(false)
      return
    }
    api.staffCheckSession().then((ok) => {
      if (!ok) clearStaffToken()
      setAuthed(ok)
    })
  }, [])

  if (authed === null) {
    return <div className="staff-page staff-page-loading">Checking session…</div>
  }

  if (!authed) {
    return <StaffLoginScreen onLoggedIn={() => setAuthed(true)} />
  }

  return <>{children(() => setAuthed(false))}</>
}
