import { useState } from 'react'
import { api, type Guest, type ResetSessionResult } from '../api'
import { Modal } from './Modal'
import { GridIcon } from './NavIcons'
import './ResetSessionModal.css'

interface ResetSessionModalProps {
  // Guest Accounts Phase 1 -- null when no guest is logged in on this
  // device. Only changes the confirmation copy below; the backend decides
  // the actual logout behavior off its own device_sessions.guest_id, not
  // this prop.
  guest: Guest | null
  onClose: () => void
  onReset: (result: ResetSessionResult) => void
}

// Narrower, guest-facing counterpart to backend/scripts/reset_demo_data.py
// (dev-only, clears far more). This clears Bingo tiles and Scavenger Hunt
// progress (global), this device's Map visited status (Per-Device Sessions
// Phase 3), the Cobb Coins balance, every purchased Collectible Card, this
// device's Puzzle Timer attempts, and this device's Scoring Sheet sessions
// -- while photos are untouched -- so it's safe to expose in the nav
// dropdown, but it's still destructive and irreversible, hence the confirm
// step. Guest Accounts Phase 1: for a logged-in guest, Coins/Collectibles
// are their lifetime account totals, not this device's -- resetting logs
// them out here (App.tsx's handleResetSession reacts to
// ResetSessionResult.guest_logged_out) but never touches that saved total.
export function ResetSessionModal({ guest, onClose, onReset }: ResetSessionModalProps) {
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmReset = async () => {
    setResetting(true)
    setError(null)
    try {
      const result = await api.resetSession()
      onReset(result)
      onClose()
    } catch (err) {
      setError(String(err))
      setResetting(false)
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="reset-session-title" className="reset-session-modal-frame">
      <div className="reset-session-modal-inner">
        <h2 id="reset-session-title" className="reset-session-title">
          <span className="reset-session-icon-badge" aria-hidden="true">
            <GridIcon />
          </span>
          Reset Session
        </h2>
        <p className="reset-session-body">
          This clears every Bingo tile and Scavenger Hunt challenge back to not-started, resets your Map visit
          progress and Cobb Coins to 0, clears your Collectible Cards gallery, and clears your Puzzle Timer attempts
          and Scoring Sheet sessions. Photos are not affected.
        </p>
        {guest && (
          <p className="reset-session-body">
            You&rsquo;re logged in as {guest.email} -- this will also log you out on this device. Your account&rsquo;s
            saved Cobb Coins and Collectible Cards are safe and will be here next time you log in.
          </p>
        )}
        <p className="reset-session-warning">Are you sure? This can&rsquo;t be undone.</p>
        {error && <p className="screen-error">Couldn&rsquo;t reset: {error}</p>}
        <div className="reset-session-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={resetting}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={confirmReset} disabled={resetting}>
            {resetting ? 'Resetting…' : 'Reset Session'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
