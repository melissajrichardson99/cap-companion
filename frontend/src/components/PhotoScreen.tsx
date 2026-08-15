import { useRef, useState, type FormEvent } from 'react'
import { api, type PhotoSubmission } from '../api'
import { getVoterSessionId } from '../voterSession'
import { CameraIcon } from './NavIcons'
import './PhotoScreen.css'

interface PhotoScreenProps {
  gallery: PhotoSubmission[] | null
  error: string | null
  onReload: () => void
}

// Favorite Photo (Plan.md 2.14), POC scope: a single ongoing voting period,
// no day/week/month cycling yet. Submissions go to staff review first
// (StaffRequestsScreen's Pending Photos queue) -- this screen never shows
// raw guest uploads, only the staff-shortlisted gallery, so there's no
// submitted-photo preview here beyond a "thanks, it's in review" message.
export function PhotoScreen({ gallery, error, onReload }: PhotoScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [guestLabel, setGuestLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [justSubmitted, setJustSubmitted] = useState(false)
  const [votingId, setVotingId] = useState<string | null>(null)
  const [voteError, setVoteError] = useState<string | null>(null)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!file) return
    setSubmitting(true)
    setSubmitError(null)
    api
      .submitPhoto(file, guestLabel.trim() || null)
      .then(() => {
        setJustSubmitted(true)
        setFile(null)
        setGuestLabel('')
        if (fileInputRef.current) fileInputRef.current.value = ''
      })
      .catch((err) => setSubmitError(String(err)))
      .finally(() => setSubmitting(false))
  }

  const handleVote = (submissionId: string) => {
    setVotingId(submissionId)
    setVoteError(null)
    api
      .votePhoto(submissionId, getVoterSessionId())
      .then(onReload)
      .catch((err) => setVoteError(String(err)))
      .finally(() => setVotingId(null))
  }

  return (
    <div className="photo-screen">
      <div className="photo-foliage photo-foliage-bottom-left-lower" aria-hidden="true" />
      <div className="photo-foliage photo-foliage-bottom-center" aria-hidden="true" />
      <div className="photo-foliage photo-foliage-bottom-right" aria-hidden="true" />
      <h1 className="cap-sign-board">
        <CameraIcon className="cap-sign-board-icon" />
        Favorite Photo
      </h1>

      <section className="photo-submit cap-parchment-card">
        <h2 className="photo-section-title">Submit Your Favorite Photo</h2>
        <p className="photo-section-desc">
          Share a favorite moment from your visit. A staff member reviews every photo before it goes up for voting.
        </p>
        {justSubmitted && <p className="photo-submitted-msg">Thanks! Your photo is in for staff review.</p>}
        {submitError && <p className="screen-error">{submitError}</p>}
        <form className="photo-submit-form" onSubmit={handleSubmit}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setJustSubmitted(false)
            }}
            disabled={submitting}
          />
          <input
            type="text"
            className="photo-guest-label-input"
            placeholder="Your name (optional)"
            value={guestLabel}
            onChange={(e) => setGuestLabel(e.target.value)}
            disabled={submitting}
            maxLength={80}
          />
          <button type="submit" className="btn btn-primary" disabled={!file || submitting}>
            {submitting ? 'Uploading…' : 'Submit Photo'}
          </button>
        </form>
      </section>

      <section className="photo-gallery">
        <h2 className="photo-section-title">Vote for Your Favorite</h2>
        {error && <p className="screen-error">{error}</p>}
        {voteError && <p className="screen-error">{voteError}</p>}
        {gallery === null ? (
          <p className="photo-gallery-loading">Loading gallery…</p>
        ) : gallery.length === 0 ? (
          <p className="photo-gallery-empty">No photos are up for voting yet — check back soon!</p>
        ) : (
          <div className="photo-gallery-grid">
            {gallery.map((photo) => (
              <div key={photo.id} className="photo-card cap-parchment-card">
                <img
                  src={photo.photo_url}
                  alt={photo.guest_label ?? 'Guest submitted park photo'}
                  className="photo-card-image"
                />
                <div className="photo-card-footer">
                  <span className="photo-card-label">{photo.guest_label ?? 'A guest'}</span>
                  <button
                    type="button"
                    className="btn btn-secondary photo-card-vote"
                    disabled={photo.voted_by_me || votingId === photo.id}
                    onClick={() => handleVote(photo.id)}
                  >
                    {photo.voted_by_me
                      ? `✓ Voted (${photo.vote_count})`
                      : votingId === photo.id
                        ? 'Voting…'
                        : `Vote (${photo.vote_count})`}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
