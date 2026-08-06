import { useEffect, useState } from 'react'
import { api, type StaffRequest } from '../api'
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

  const reload = () => {
    api
      .listStaffRequests()
      .then((rows) => {
        setRequests(rows)
        setError(null)
      })
      .catch((err) => setError(String(err)))
  }

  useEffect(() => {
    reload()
    const interval = setInterval(reload, POLL_INTERVAL_MS)
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
        <button type="button" className="btn btn-secondary" onClick={reload}>
          Refresh
        </button>
      </div>

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
