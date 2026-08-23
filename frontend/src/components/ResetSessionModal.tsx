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
// (dev-only, clears far more). This clears Bingo tiles, Map visited state,
// Scavenger Hunt progress, the Cobb Coins balance, and every purchased
// Collectible Card -- all tied to this shared kiosk session, not persistent
// identity -- while photos/puzzle times are untouched -- so it's safe to
// expose in the nav dropdown, but it's still destructive and irreversible,
// hence the confirm step.
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
          This clears every Bingo tile, Map visit, and Scavenger Hunt challenge back to not-started, resets Cobb
          Coins to 0, and clears your Collectible Cards gallery. Photos and puzzle times are not affected.
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
