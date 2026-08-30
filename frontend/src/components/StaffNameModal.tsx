import { useState, type FormEvent } from 'react'
import { setStaffName } from '../staffName'
import { Modal } from './Modal'
import './StaffNameModal.css'

interface StaffNameModalProps {
  currentName: string | null
  onClose: () => void
  onSaved: (name: string) => void
}

// Shown once per device the first time a staff member reaches the Staff
// Page with no display name stored yet (StaffPage.tsx), and reopened on
// demand via the "Change" control in the header for anyone who wants to
// update it later. Purely a self-reported label for attribution (see
// staffName.ts) -- not a second auth mechanism, so there's no validation
// beyond "non-empty".
export function StaffNameModal({ currentName, onClose, onSaved }: StaffNameModalProps) {
  const [name, setName] = useState(currentName ?? '')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setStaffName(trimmed)
    onSaved(trimmed)
  }

  return (
    <Modal onClose={onClose} labelledBy="staff-name-modal-title" className="staff-name-modal-frame">
      <form className="staff-name-modal-inner" onSubmit={submit}>
        <h2 id="staff-name-modal-title" className="staff-name-modal-title">
          What&rsquo;s your name?
        </h2>
        <p className="staff-name-modal-body">
          Shown on actions you take here (like acknowledging a Contact Staff request) so guests and other staff know
          who helped. This device will remember it.
        </p>
        <label className="staff-name-modal-label" htmlFor="staff-name-modal-input">
          Your name
        </label>
        <input
          id="staff-name-modal-input"
          type="text"
          className="staff-name-modal-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
        <div className="staff-name-modal-actions">
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}
