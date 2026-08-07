import { useRef, useState, type FormEvent } from 'react'
import { api, type PassportSession } from '../api'
import { Modal } from './Modal'
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
export function PassportModal({ onClose }: PassportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [familyLabel, setFamilyLabel] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<PassportSession | null>(null)

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

  if (session) {
    const { stats } = session
    const milestoneNote = stats.bingo_milestones.blackout
      ? ' — Blackout!'
      : stats.bingo_milestones.x
        ? ' — X marks the spot!'
        : stats.bingo_milestones.lines.length > 0
          ? ` — ${stats.bingo_milestones.lines.length} line(s)!`
          : ''

    return (
      <Modal onClose={onClose} labelledBy="passport-card-title">
        <div className="passport-card">
          {session.photo_url && (
            <img src={session.photo_url} alt={`${session.family_label} group photo`} className="passport-card-photo" />
          )}
          <p className="passport-card-eyebrow">Family Passport</p>
          <h2 id="passport-card-title" className="passport-card-title">
            {stats.title}
          </h2>
          <p className="passport-card-family-label">{session.family_label}</p>
          <ul className="passport-card-stats">
            <li>
              🐨 Scavenger Hunt: {stats.scavenger_hunt_characters_completed} / {stats.scavenger_hunt_characters_total}{' '}
              characters
            </li>
            <li>
              🎯 Bingo: {stats.bingo_tiles_completed} / {stats.bingo_tiles_total} tiles
              {milestoneNote}
            </li>
            <li>🏆 Scoring Sheet: {stats.scoring_sheet_games_won} game(s) won</li>
            <li>🧩 Puzzles: {stats.puzzle_challenges_completed} challenge(s) completed</li>
            <li>🪙 Cobb Coins: {stats.total_cobb_coins}</li>
          </ul>
          <p className="passport-card-timestamp">Generated {new Date(session.generated_at).toLocaleString()}</p>
          <button type="button" className="btn btn-primary passport-card-close" onClick={onClose}>
            Close
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} labelledBy="passport-title">
      <h2 id="passport-title" className="passport-title">
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
    </Modal>
  )
}
