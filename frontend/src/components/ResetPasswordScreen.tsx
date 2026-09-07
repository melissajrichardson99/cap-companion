import { useState } from 'react'
import { api } from '../api'
import './AccountModal.css'
import './ResetPasswordScreen.css'

interface ResetPasswordScreenProps {
  token: string
  onDone: () => void
}

function friendlyError(err: unknown): string {
  const raw = String(err)
  const match = raw.match(/-> \d+: (.*)$/s)
  if (match) {
    try {
      const parsed = JSON.parse(match[1])
      if (typeof parsed.detail === 'string') return parsed.detail
    } catch {
      // Not JSON -- fall through to the raw message below.
    }
  }
  return raw
}

// Reached from the password reset email's link (/reset-password?token=...)
// -- a real page, not a modal, since it's the destination of a cold-load
// deep link rather than something opened from within the app. See
// backend/app/routers/account.py's POST /account/password-reset/confirm.
export function ResetPasswordScreen({ token, onDone }: ResetPasswordScreenProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = () => {
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setSubmitting(true)
    setError(null)
    api
      .confirmPasswordReset(token, password)
      .then(() => setDone(true))
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setSubmitting(false))
  }

  return (
    <div className="reset-password-screen">
      <div className="account-modal-frame reset-password-card">
        <div className="account-modal-inner">
          <h2 className="account-modal-title">Reset Your Password</h2>
          {done ? (
            <>
              <p className="account-modal-subtitle">
                Your password has been updated. You've been logged out everywhere and will need to log in again.
              </p>
              <div className="account-modal-actions">
                <button type="button" className="btn btn-primary" onClick={onDone}>
                  Back to the App
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="account-modal-subtitle">Choose a new password (8+ characters).</p>
              {error && <p className="screen-error">{error}</p>}
              <div className="account-modal-field">
                <input
                  type="password"
                  className="account-modal-input"
                  placeholder="New password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  className="account-modal-input"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={submitting}
                  autoComplete="new-password"
                />
              </div>
              <div className="account-modal-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={submit}
                  disabled={submitting || password.length < 8 || !confirmPassword}
                >
                  {submitting ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
