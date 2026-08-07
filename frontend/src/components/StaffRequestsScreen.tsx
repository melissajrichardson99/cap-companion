import { useEffect, useState } from 'react'
import { api, type PhotoSubmission, type StaffRequest } from '../api'
import './StaffRequestsScreen.css'

// Simple polling refresh rather than websockets -- fine for a POC-scale
// single staff view; a real-time push would be the upgrade if this becomes
// more than a POC.
const POLL_INTERVAL_MS = 12_000

const TYPE_LABEL: Record<StaffRequest['type'], string> = {
  question: 'Question',
  emergency: 'Emergency',
}

const STATUS_LABEL: Record<StaffRequest['status'], string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
}

export function StaffRequestsScreen() {
  const [requests, setRequests] = useState<StaffRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)

  const [pendingPhotos, setPendingPhotos] = useState<PhotoSubmission[] | null>(null)
  const [photosError, setPhotosError] = useState<string | null>(null)
  const [pendingPhotoActionId, setPendingPhotoActionId] = useState<string | null>(null)

  const reload = () => {
    api
      .listStaffRequests()
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

  const reloadAll = () => {
    reload()
    reloadPhotos()
  }

  useEffect(() => {
    reloadAll()
    const interval = setInterval(reloadAll, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runAction = (requestId: string, action: (id: string) => Promise<StaffRequest>) => {
    setPendingActionId(requestId)
    action(requestId)
      .then(reload)
      .catch((err) => setError(String(err)))
      .finally(() => setPendingActionId(null))
  }

  const runPhotoAction = (submissionId: string, action: (id: string) => Promise<PhotoSubmission>) => {
    setPendingPhotoActionId(submissionId)
    action(submissionId)
      .then(reloadPhotos)
      .catch((err) => setPhotosError(String(err)))
      .finally(() => setPendingPhotoActionId(null))
  }

  if (error) {
    return (
      <div className="staff-requests-screen">
        <p className="screen-error">Couldn't load staff requests: {error}</p>
        <button type="button" className="btn btn-secondary" onClick={reload}>
          Retry
        </button>
      </div>
    )
  }

  if (!requests) {
    return <div className="staff-requests-screen staff-requests-loading">Loading requests…</div>
  }

  return (
    <div className="staff-requests-screen">
      <div className="staff-requests-header">
        <h1 className="staff-requests-title">Staff Requests</h1>
        <button type="button" className="btn btn-secondary" onClick={reloadAll}>
          Refresh
        </button>
      </div>

      <section className="staff-photos-section">
        <h2 className="staff-photos-title">Pending Photo Submissions</h2>
        {photosError && <p className="screen-error">Couldn't load photo submissions: {photosError}</p>}
        {pendingPhotos === null ? (
          <p className="staff-photos-loading">Loading submissions…</p>
        ) : pendingPhotos.length === 0 ? (
          <p className="staff-photos-empty">No photos waiting for review.</p>
        ) : (
          <ul className="staff-photos-list">
            {pendingPhotos.map((photo) => (
              <li key={photo.id} className="staff-photo-row">
                <img src={photo.photo_url} alt={photo.guest_label ?? 'Guest submitted photo'} className="staff-photo-thumb" />
                <span className="staff-photo-label">{photo.guest_label ?? 'A guest'}</span>
                <div className="staff-photo-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={pendingPhotoActionId === photo.id}
                    onClick={() => runPhotoAction(photo.id, api.shortlistPhoto)}
                  >
                    Shortlist
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={pendingPhotoActionId === photo.id}
                    onClick={() => runPhotoAction(photo.id, api.rejectPhoto)}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {requests.length === 0 ? (
        <p className="staff-requests-empty">No open requests right now.</p>
      ) : (
        <ul className="staff-requests-list">
          {requests.map((r) => (
            <li key={r.id} className={`staff-request-row staff-request-${r.type}`}>
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
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pendingActionId === r.id}
                  onClick={() => runAction(r.id, api.resolveStaffRequest)}
                >
                  Resolve
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
