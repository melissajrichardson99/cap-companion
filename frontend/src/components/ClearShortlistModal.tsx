import { useState } from 'react'
import { api } from '../api'
import { Modal } from './Modal'
import './ClearShortlistModal.css'

interface ClearShortlistModalProps {
  count: number
  onClose: () => void
  onCleared: () => void
}

// Deliberately a real modal stating the exact count, not a generic
// window.confirm() -- this wipes the entire live voting pool at once
// (end-of-day reset), so it needs a harder-to-misclick confirmation than
// the per-photo Remove button.
export function ClearShortlistModal({ count, onClose, onCleared }: ClearShortlistModalProps) {
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmClear = async () => {
    setClearing(true)
    setError(null)
    try {
      await api.clearShortlistedPhotos()
      onCleared()
      onClose()
    } catch (err) {
      setError(String(err))
      setClearing(false)
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="clear-shortlist-title" className="clear-shortlist-modal-frame">
      <div className="clear-shortlist-modal-inner">
        <h2 id="clear-shortlist-title" className="clear-shortlist-title">
          Clear All Shortlisted Photos
        </h2>
        <p className="clear-shortlist-body">
          This permanently removes all <strong>{count}</strong> photo{count === 1 ? '' : 's'} currently in the
          voting gallery. Guests will see an empty gallery until new photos are approved.
        </p>
        <p className="clear-shortlist-warning">Are you sure? This can&rsquo;t be undone.</p>
        {error && <p className="screen-error">Couldn&rsquo;t clear: {error}</p>}
        <div className="clear-shortlist-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={clearing}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={confirmClear} disabled={clearing}>
            {clearing ? 'Clearing…' : `Remove All ${count} Photos`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
