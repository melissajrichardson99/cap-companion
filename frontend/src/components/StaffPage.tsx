import { useEffect, useState } from 'react'
import { api, type PhotoSubmission, type StaffRequest } from '../api'
import { clearStaffToken, getStaffToken } from '../staffAuth'
import { ClearShortlistModal } from './ClearShortlistModal'
import { ClipboardIcon } from './NavIcons'
import { StaffLoginScreen } from './StaffLoginScreen'
import './StaffPage.css'

// Simple polling refresh rather than websockets -- fine for a POC-scale
// single staff view; a real-time push would be the upgrade if this becomes
// more than a POC.
const POLL_INTERVAL_MS = 12_000

type Tab = 'photos' | 'requests'

const TYPE_LABEL: Record<StaffRequest['type'], string> = {
  question: 'Question',
  emergency: 'Emergency',
}

const STATUS_LABEL: Record<StaffRequest['status'], string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
}

export function StaffPage() {
  // null while the stored token (if any) is still being validated against
  // the server -- the client-side guard is a convenience, not the real
  // enforcement (that's require_staff on the backend), but we still don't
  // want to flash staff data before confirming the token is actually valid.
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    const token = getStaffToken()
    if (!token) {
      setAuthed(false)
      return
    }
    api.staffCheckSession().then((ok) => {
      if (!ok) clearStaffToken()
      setAuthed(ok)
    })
  }, [])

  if (authed === null) {
    return <div className="staff-page staff-page-loading">Checking session…</div>
  }

  if (!authed) {
    return <StaffLoginScreen onLoggedIn={() => setAuthed(true)} />
  }

  return <StaffPageContent onLoggedOut={() => setAuthed(false)} />
}

function StaffPageContent({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [tab, setTab] = useState<Tab>('photos')

  const [requests, setRequests] = useState<StaffRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  const [pendingPhotos, setPendingPhotos] = useState<PhotoSubmission[] | null>(null)
  const [photosError, setPhotosError] = useState<string | null>(null)
  const [pendingPhotoActionId, setPendingPhotoActionId] = useState<string | null>(null)

  const [shortlistedPhotos, setShortlistedPhotos] = useState<PhotoSubmission[] | null>(null)
  const [shortlistedError, setShortlistedError] = useState<string | null>(null)
  const [clearModalOpen, setClearModalOpen] = useState(false)

  const reload = () => {
    api
      .listStaffRequests(showResolved)
      .then((rows) => {
        setRequests(rows)
        setError(null)
      })
      .catch((err) => setError(String(err)))
  }

  const reloadPhotos = () => {
    api
      .listPendingPhotos()
      .then((rows) => {
        setPendingPhotos(rows)
        setPhotosError(null)
      })
      .catch((err) => setPhotosError(String(err)))
  }

  const reloadShortlisted = () => {
    api
      .listShortlistedPhotos()
      .then((rows) => {
        setShortlistedPhotos(rows)
        setShortlistedError(null)
      })
      .catch((err) => setShortlistedError(String(err)))
  }

  // Approve moves a row from pending into shortlisted, so any photo-queue
  // action refreshes both lists rather than just the one it appears to act on.
  const reloadAllPhotos = () => {
    reloadPhotos()
    reloadShortlisted()
  }

  // Re-runs (and restarts the poll interval) whenever showResolved changes,
  // so toggling it doesn't wait up to POLL_INTERVAL_MS for a stale closure
  // to pick up the new value.
  useEffect(() => {
    reload()
    reloadAllPhotos()
    const interval = setInterval(() => {
      reload()
      reloadAllPhotos()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResolved])

  const runAction = (requestId: string, action: (id: string) => Promise<StaffRequest>) => {
    setPendingActionId(requestId)
    action(requestId)
      .then(reload)
      .catch((err) => setError(String(err)))
      .finally(() => setPendingActionId(null))
  }

  const runPhotoAction = (submissionId: string, action: (id: string) => Promise<unknown>) => {
    setPendingPhotoActionId(submissionId)
    action(submissionId)
      .then(reloadAllPhotos)
      .catch((err) => setPhotosError(String(err)))
      .finally(() => setPendingPhotoActionId(null))
  }

  const deletePhoto = (submissionId: string) => {
    if (!window.confirm('Permanently delete this photo? This cannot be undone.')) return
    runPhotoAction(submissionId, api.deletePhoto)
  }

  const removeShortlistedPhoto = (submissionId: string) => {
    if (!window.confirm('Permanently remove this photo from the voting gallery? This cannot be undone.')) return
    setPendingPhotoActionId(submissionId)
    api
      .deletePhoto(submissionId)
      .then(reloadAllPhotos)
      .catch((err) => setShortlistedError(String(err)))
      .finally(() => setPendingPhotoActionId(null))
  }

  return (
    <div className="staff-page">
      <div className="staff-page-header">
        <h1 className="cap-sign-board">
          <ClipboardIcon className="cap-sign-board-icon" />
          Staff
        </h1>
        <div className="staff-page-header-actions">
          <span className="staff-mode-badge">Staff Mode</span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              reload()
              reloadAllPhotos()
            }}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              clearStaffToken()
              onLoggedOut()
            }}
          >
            Log Out
          </button>
        </div>
      </div>

      <div className="staff-page-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'photos'}
          className={`staff-page-tab ${tab === 'photos' ? 'staff-page-tab-active' : ''}`}
          onClick={() => setTab('photos')}
        >
          Photo Queue
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'requests'}
          className={`staff-page-tab ${tab === 'requests' ? 'staff-page-tab-active' : ''}`}
          onClick={() => setTab('requests')}
        >
          Contact Requests
        </button>
      </div>

      {tab === 'photos' && (
        <section className="staff-photos-section">
          <h2 className="staff-photos-subheading">Pending Review</h2>
          {photosError && <p className="screen-error">Couldn't load photo submissions: {photosError}</p>}
          {pendingPhotos === null ? (
            <p className="staff-photos-loading">Loading submissions…</p>
          ) : pendingPhotos.length === 0 ? (
            <p className="staff-photos-empty">No photos waiting for review.</p>
          ) : (
            <ul className="staff-photos-list">
              {pendingPhotos.map((photo) => (
                <li key={photo.id} className="staff-photo-row cap-parchment-card" data-submission-id={photo.id}>
                  <img
                    src={photo.photo_url}
                    alt={photo.guest_label ?? 'Guest submitted photo'}
                    className="staff-photo-thumb"
                  />
                  <span className="staff-photo-label">{photo.guest_label ?? 'A guest'}</span>
                  <div className="staff-photo-actions">
                    <button
                      type="button"
                      className="btn btn-approve"
                      disabled={pendingPhotoActionId === photo.id}
                      onClick={() => runPhotoAction(photo.id, api.shortlistPhoto)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn btn-reject"
                      disabled={pendingPhotoActionId === photo.id}
                      onClick={() => runPhotoAction(photo.id, api.rejectPhoto)}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="btn btn-delete"
                      disabled={pendingPhotoActionId === photo.id}
                      onClick={() => deletePhoto(photo.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="staff-shortlisted-header">
            <h2 className="staff-photos-subheading">Shortlisted (Live in Voting Gallery)</h2>
            {shortlistedPhotos !== null && shortlistedPhotos.length > 0 && (
              <button type="button" className="btn btn-delete" onClick={() => setClearModalOpen(true)}>
                Clear All ({shortlistedPhotos.length})
              </button>
            )}
          </div>
          {shortlistedError && <p className="screen-error">Couldn't load shortlisted photos: {shortlistedError}</p>}
          {shortlistedPhotos === null ? (
            <p className="staff-photos-loading">Loading shortlisted photos…</p>
          ) : shortlistedPhotos.length === 0 ? (
            <p className="staff-photos-empty">No photos are currently live in the voting gallery.</p>
          ) : (
            <ul className="staff-photos-list">
              {shortlistedPhotos.map((photo) => (
                <li key={photo.id} className="staff-shortlisted-row cap-parchment-card" data-submission-id={photo.id}>
                  <img
                    src={photo.photo_url}
                    alt={photo.guest_label ?? 'Guest submitted photo'}
                    className="staff-photo-thumb"
                  />
                  <span className="staff-photo-label">{photo.guest_label ?? 'A guest'}</span>
                  <span className="staff-photo-vote-count">
                    {photo.vote_count} vote{photo.vote_count === 1 ? '' : 's'}
                  </span>
                  <div className="staff-photo-actions">
                    <button
                      type="button"
                      className="btn btn-delete"
                      disabled={pendingPhotoActionId === photo.id}
                      onClick={() => removeShortlistedPhoto(photo.id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {clearModalOpen && shortlistedPhotos && (
        <ClearShortlistModal
          count={shortlistedPhotos.length}
          onClose={() => setClearModalOpen(false)}
          onCleared={reloadAllPhotos}
        />
      )}

      {tab === 'requests' && (
        <section className="staff-requests-section">
          {error && <p className="screen-error">Couldn't load staff requests: {error}</p>}
          <label className="staff-resolved-toggle">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            Show Resolved
          </label>
          {requests === null ? (
            <p className="staff-requests-loading">Loading requests…</p>
          ) : requests.length === 0 ? (
            <p className="staff-requests-empty">No requests to show.</p>
          ) : (
            <ul className="staff-requests-list">
              {requests.map((r) => (
                <li key={r.id} className={`staff-request-row cap-parchment-card staff-request-${r.type}`}>
                  <div className="staff-request-main">
                    <span className={`staff-request-type-badge staff-request-type-badge-${r.type}`}>
                      {TYPE_LABEL[r.type]}
                    </span>
                    <span className="staff-request-location">{r.location_name ?? 'Location not specified'}</span>
                    <span className="staff-request-time">{new Date(r.created_at).toLocaleTimeString()}</span>
                    <span className={`staff-request-status-badge staff-request-status-badge-${r.status}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  <div className="staff-request-actions">
                    {r.status === 'open' && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={pendingActionId === r.id}
                        onClick={() => runAction(r.id, api.acknowledgeStaffRequest)}
                      >
                        Acknowledge
                      </button>
                    )}
                    {r.status !== 'resolved' && (
                      <button
                        type="button"
                        className="btn btn-approve"
                        disabled={pendingActionId === r.id}
                        onClick={() => runAction(r.id, api.resolveStaffRequest)}
                      >
                        Mark Resolved
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
