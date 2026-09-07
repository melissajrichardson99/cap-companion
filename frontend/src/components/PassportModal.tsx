import { useRef, useState, type FormEvent } from 'react'
import { api, type PassportSession } from '../api'
import { Modal } from './Modal'
import { PassportCard } from './PassportCard'
import { PassportIcon } from './NavIcons'
import { PassportReviewModal } from './PassportReviewModal'
import './PassportModal.css'

interface PassportModalProps {
  onClose: () => void
}

// Family Passport (Plan.md 2.8): a one-time end-of-visit rollup. Reuses the
// Favorite Photo upload pattern (optional file input, multipart submit) --
// the group photo prompt here is likewise optional, a family can generate a
// passport with no photo at all. The result card is the frozen stats
// snapshot the backend just computed and stored, not a live view -- closing
// and reopening this modal always starts a fresh "form" step rather than
// remembering the last passport.
//
// A successful generation inserts one more step before the result card:
// PassportReviewModal, the review-prompt popup. reviewPromptDismissed lives
// in this component's own state (not anywhere persistent), so it resets
// every time PassportModal remounts -- the prompt reappears after every
// passport a family generates in the session, not just the first.
export function PassportModal({ onClose }: PassportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [familyLabel, setFamilyLabel] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<PassportSession | null>(null)
  const [reviewPromptDismissed, setReviewPromptDismissed] = useState(false)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const label = familyLabel.trim()
    if (!label) return
    setSubmitting(true)
    setError(null)
    api
      .generatePassport(label, file)
      .then(setSession)
      .catch((err) => setError(String(err)))
      .finally(() => setSubmitting(false))
  }

  if (session && !reviewPromptDismissed) {
    return <PassportReviewModal onDismiss={() => setReviewPromptDismissed(true)} />
  }

  if (session) {
    return (
      <Modal onClose={onClose} labelledBy="passport-card-title" className="passport-modal-frame">
        <div className="passport-modal-inner">
          <PassportCard session={session} />
          <button type="button" className="btn btn-primary passport-card-close" onClick={onClose}>
            Close
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} labelledBy="passport-title" className="passport-modal-frame">
      <div className="passport-modal-inner">
        <h2 id="passport-title" className="passport-title">
          <span className="passport-icon-badge" aria-hidden="true">
            <PassportIcon />
          </span>
          Generate Family Passport
        </h2>
        <p className="passport-subtitle">
          Wrap up your visit with a summary card of everything your family completed today.
        </p>
        {error && <p className="screen-error">{error}</p>}
        <form className="passport-form" onSubmit={handleSubmit}>
          <input
            type="text"
            className="passport-family-label-input"
            placeholder="Family name (e.g. The Smiths)"
            value={familyLabel}
            onChange={(e) => setFamilyLabel(e.target.value)}
            disabled={submitting}
            maxLength={80}
          />
          <label className="passport-photo-label">
            Group photo (optional)
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={submitting}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!familyLabel.trim() || submitting}>
            {submitting ? 'Generating…' : 'Generate Passport'}
          </button>
        </form>
        <button type="button" className="btn btn-secondary passport-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
