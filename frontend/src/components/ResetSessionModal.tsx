import { useState } from 'react'
import { api } from '../api'
import { Modal } from './Modal'
import { GridIcon } from './NavIcons'
import './ResetSessionModal.css'

interface ResetSessionModalProps {
  onClose: () => void
  onReset: () => void
}

// Narrower, guest-facing counterpart to backend/scripts/reset_demo_data.py
// (dev-only, clears far more). This clears Bingo tiles and Scavenger Hunt
// progress (global), this device's Map visited status (Per-Device Sessions
// Phase 3), the Cobb Coins balance, every purchased Collectible Card, this
// device's Puzzle Timer attempts, and this device's Scoring Sheet sessions
// -- while photos are untouched -- so it's safe to expose in the nav
// dropdown, but it's still destructive and irreversible, hence the confirm
// step.
export function ResetSessionModal({ onClose, onReset }: ResetSessionModalProps) {
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmReset = async () => {
    setResetting(true)
    setError(null)
    try {
      await api.resetSession()
      onReset()
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
