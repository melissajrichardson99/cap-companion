import { useState } from 'react'
import { api } from '../api'
import { setStaffToken } from '../staffAuth'
import { ClipboardIcon } from './NavIcons'
import './StaffLoginScreen.css'

interface StaffLoginScreenProps {
  onLoggedIn: () => void
}

export function StaffLoginScreen({ onLoggedIn }: StaffLoginScreenProps) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    api
      .staffLogin(password)
      .then(({ token }) => {
        setStaffToken(token)
        onLoggedIn()
      })
      .catch(() => setError('Incorrect password.'))
      .finally(() => setSubmitting(false))
  }

  return (
    <div className="staff-login-screen">
      <div className="staff-login-frame">
        <form className="staff-login-inner" onSubmit={submit}>
          <h1 className="cap-sign-board staff-login-title">
            <ClipboardIcon className="cap-sign-board-icon" />
            Staff Login
          </h1>
          <label className="staff-login-label" htmlFor="staff-login-password">
            Password
          </label>
          <input
            id="staff-login-password"
            type="password"
            className="staff-login-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
          {error && <p className="screen-error">{error}</p>}
          <button type="submit" className="btn btn-primary staff-login-submit" disabled={submitting || !password}>
            {submitting ? 'Checking…' : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  )
}
