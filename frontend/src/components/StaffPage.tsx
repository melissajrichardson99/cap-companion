import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, type AnimalPhoto, type Announcement, type MapNode, type PhotoSubmission, type StaffRequest } from '../api'
import { ANIMALS } from '../animalContent'
import { clearStaffToken } from '../staffAuth'
import { getStaffName } from '../staffName'
import { useVisibleInterval } from '../useVisibleInterval'
import { ClearShortlistModal } from './ClearShortlistModal'
import { ClipboardIcon } from './NavIcons'
import { StaffAnalytics } from './StaffAnalytics'
import { StaffAuthGate } from './StaffAuthGate'
import { StaffNameModal } from './StaffNameModal'
import { StaffQrDirectory } from './StaffQrDirectory'
import { isStaffTab, StaffSidebar, type StaffNavState, type StaffTab } from './StaffSidebar'
import './StaffPage.css'

// Simple polling refresh rather than websockets -- fine for a POC-scale
// single staff view; a real-time push would be the upgrade if this becomes
// more than a POC.
const POLL_INTERVAL_MS = 12_000

type Tab = StaffTab

const TYPE_LABEL: Record<StaffRequest['type'], string> = {
  question: 'Question',
  emergency: 'Emergency',
}

const STATUS_LABEL: Record<StaffRequest['status'], string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
}

const NODE_CATEGORY_LABEL: Record<MapNode['category'], string> = {
  attraction: 'Attraction',
  animal: 'Animal Habitat',
  service: 'Service',
  food: 'Food & Store',
  seasonal: 'Seasonal',
}

export function StaffPage() {
  return <StaffAuthGate>{(onLoggedOut) => <StaffPageContent onLoggedOut={onLoggedOut} />}</StaffAuthGate>
}

function StaffPageContent({ onLoggedOut }: { onLoggedOut: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  // A tab picked from the sidebar on a standalone staff page (e.g. the
  // heatmap) arrives as router state; a plain visit to /staff has none and
  // opens Photo Queue as always.
  const [tab, setTab] = useState<Tab>(() => {
    const requested = (location.state as StaffNavState | null)?.staffTab
    return isStaffTab(requested) ? requested : 'photos'
  })

  // Consume that state once, so a later reload of /staff (after switching
  // tabs in place) doesn't jump back to the tab it was opened on.
  useEffect(() => {
    if ((location.state as StaffNavState | null)?.staffTab !== undefined) {
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.state, location.pathname, navigate])

  // Prompted once per device -- see StaffNameModal.tsx. Lazily initialized
  // from localStorage so a fresh session (no name stored yet) opens straight
  // into the prompt instead of flashing the rest of the page first.
  const [staffName, setStaffNameState] = useState<string | null>(() => getStaffName())
  const [nameModalOpen, setNameModalOpen] = useState(() => !getStaffName())

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

  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null)
  const [announcementsError, setAnnouncementsError] = useState<string | null>(null)
  const [pendingAnnouncementActionId, setPendingAnnouncementActionId] = useState<string | null>(null)
  const [newAnnouncementText, setNewAnnouncementText] = useState('')
  const [creatingAnnouncement, setCreatingAnnouncement] = useState(false)
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null)
  const [editingAnnouncementText, setEditingAnnouncementText] = useState('')

  const [attractionNodes, setAttractionNodes] = useState<MapNode[] | null>(null)
  const [attractionsError, setAttractionsError] = useState<string | null>(null)
  const [pendingAttractionActionId, setPendingAttractionActionId] = useState<string | null>(null)

  const [animalPhotos, setAnimalPhotos] = useState<AnimalPhoto[] | null>(null)
  const [animalPhotosError, setAnimalPhotosError] = useState<string | null>(null)
  const [pendingAnimalPhotoActionId, setPendingAnimalPhotoActionId] = useState<string | null>(null)
  const [selectedAnimalSlug, setSelectedAnimalSlug] = useState(ANIMALS[0].slug)
  const [animalPhotoUploadFile, setAnimalPhotoUploadFile] = useState<File | null>(null)
  const [uploadingAnimalPhoto, setUploadingAnimalPhoto] = useState(false)
  const animalPhotoFileInputRef = useRef<HTMLInputElement>(null)

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

  const reloadAnnouncements = () => {
    api
      .listAnnouncements()
      .then((rows) => {
        setAnnouncements(rows)
        setAnnouncementsError(null)
      })
      .catch((err) => setAnnouncementsError(String(err)))
  }

  // Parented sub-games (e.g. Cornhole under Arcade Pad) don't get their own
  // map pin/card -- they're not independently toggleable, so this list
  // matches exactly what MapScreen.tsx's positioned/unplaced filters show.
  const reloadAttractionNodes = () => {
    api
      .listMapNodes()
      .then((rows) => {
        setAttractionNodes(rows.filter((n) => n.parent_node_id == null))
        setAttractionsError(null)
      })
      .catch((err) => setAttractionsError(String(err)))
  }

  const reloadAnimalPhotos = () => {
    api
      .listAnimalPhotos()
      .then((rows) => {
        setAnimalPhotos(rows)
        setAnimalPhotosError(null)
      })
      .catch((err) => setAnimalPhotosError(String(err)))
  }

  const reloadEverything = () => {
    reload()
    reloadAllPhotos()
    reloadAnimalPhotos()
    reloadAnnouncements()
    reloadAttractionNodes()
  }

  // Loads everything on mount, and reloads whenever showResolved changes so
  // toggling it doesn't wait up to POLL_INTERVAL_MS for the next tick.
  useEffect(() => {
    reloadEverything()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResolved])

  // The poll itself pauses in a hidden tab and reloads everything at once
  // when the tab is shown again (useVisibleInterval). It always calls the
  // latest reloadEverything, so it picks up showResolved without restarting.
  useVisibleInterval(reloadEverything, POLL_INTERVAL_MS, true)

  const toggleNodeOpen = (node: MapNode) => {
    setPendingAttractionActionId(node.id)
    api
      .setNodeOpenStatus(node.id, !node.is_open)
      .then(reloadAttractionNodes)
      .catch((err) => setAttractionsError(String(err)))
      .finally(() => setPendingAttractionActionId(null))
  }

  const deleteAnimalPhoto = (photoId: string) => {
    if (!window.confirm('Permanently delete this photo? This cannot be undone.')) return
    setPendingAnimalPhotoActionId(photoId)
    api
      .deleteAnimalPhoto(photoId)
      .then(reloadAnimalPhotos)
      .catch((err) => setAnimalPhotosError(String(err)))
      .finally(() => setPendingAnimalPhotoActionId(null))
  }

  // Swaps `photo` with its neighbor in `direction` and persists the whole
  // animal's new order -- the reorder endpoint takes a full ordered id list,
  // not a single-item move, matching how few photos per animal there
  // realistically are (a handful at most).
  const moveAnimalPhoto = (photosForAnimal: AnimalPhoto[], photo: AnimalPhoto, direction: -1 | 1) => {
    const index = photosForAnimal.indexOf(photo)
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= photosForAnimal.length) return
    const reordered = [...photosForAnimal]
    ;[reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]]

    setPendingAnimalPhotoActionId(photo.id)
    api
      .reorderAnimalPhotos(selectedAnimalSlug, reordered.map((p) => p.id))
      .then(reloadAnimalPhotos)
      .catch((err) => setAnimalPhotosError(String(err)))
      .finally(() => setPendingAnimalPhotoActionId(null))
  }

  const uploadAnimalPhoto = (e: FormEvent) => {
    e.preventDefault()
    if (!animalPhotoUploadFile) return
    setUploadingAnimalPhoto(true)
    api
      .uploadAnimalPhoto(selectedAnimalSlug, animalPhotoUploadFile)
      .then(() => {
        setAnimalPhotoUploadFile(null)
        if (animalPhotoFileInputRef.current) animalPhotoFileInputRef.current.value = ''
        reloadAnimalPhotos()
      })
      .catch((err) => setAnimalPhotosError(String(err)))
      .finally(() => setUploadingAnimalPhoto(false))
  }

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

  const createAnnouncement = (e: React.FormEvent) => {
    e.preventDefault()
    const text = newAnnouncementText.trim()
    if (!text) return
    setCreatingAnnouncement(true)
    api
      .createAnnouncement(text)
      .then(() => {
        setNewAnnouncementText('')
        reloadAnnouncements()
      })
      .catch((err) => setAnnouncementsError(String(err)))
      .finally(() => setCreatingAnnouncement(false))
  }

  const startEditingAnnouncement = (a: Announcement) => {
    setEditingAnnouncementId(a.id)
    setEditingAnnouncementText(a.text)
  }

  const saveEditingAnnouncement = (announcementId: string) => {
    const text = editingAnnouncementText.trim()
    if (!text) return
    setPendingAnnouncementActionId(announcementId)
    api
      .updateAnnouncement(announcementId, text)
      .then(() => {
        setEditingAnnouncementId(null)
        reloadAnnouncements()
      })
      .catch((err) => setAnnouncementsError(String(err)))
      .finally(() => setPendingAnnouncementActionId(null))
  }

  const deleteAnnouncement = (announcementId: string) => {
    if (!window.confirm('Permanently delete this announcement? This cannot be undone.')) return
    setPendingAnnouncementActionId(announcementId)
    api
      .deleteAnnouncement(announcementId)
      .then(reloadAnnouncements)
      .catch((err) => setAnnouncementsError(String(err)))
      .finally(() => setPendingAnnouncementActionId(null))
  }

  return (
    <div className="staff-page">
      <div className="staff-page-header">
        <span className="staff-mode-badge">
          <ClipboardIcon className="staff-mode-badge-icon" />
          Staff Mode
        </span>
        <div className="staff-page-header-actions">
          <span className="staff-name-badge">
            <span className="staff-name-badge-label">{staffName ?? 'No name set'}</span>
            <button type="button" className="btn btn-secondary staff-name-edit-btn" onClick={() => setNameModalOpen(true)}>
              {staffName ? 'Change' : 'Set Name'}
            </button>
          </span>
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

      <div className="staff-page-body">
        <StaffSidebar
          tab={tab}
          onSelectTab={setTab}
          pendingPhotosCount={pendingPhotos?.length ?? 0}
          openRequestsCount={requests?.filter((r) => r.status === 'open').length ?? 0}
        />

        <div className="staff-page-content">
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
                    width={56}
                    height={56}
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="staff-photo-identity">
                    <span className="staff-photo-label">{photo.guest_label ?? 'A guest'}</span>
                    {photo.email && <span className="staff-photo-email">{photo.email}</span>}
                  </div>
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
                    width={56}
                    height={56}
                    loading="lazy"
                    decoding="async"
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
            Show Resolved &amp; Cancelled
          </label>
          {requests === null ? (
            <p className="staff-requests-loading">Loading requests…</p>
          ) : requests.length === 0 ? (
            <p className="staff-requests-empty">No requests to show.</p>
          ) : (
            <ul className="staff-requests-list">
              {requests.map((r) => (
                <li
                  key={r.id}
                  className={`staff-request-row cap-parchment-card staff-request-${r.type} ${
                    r.status === 'cancelled' ? 'staff-request-row-cancelled' : ''
                  }`}
                >
                  <div className="staff-request-content">
                    <div className="staff-request-main">
                      <span className={`staff-request-type-badge staff-request-type-badge-${r.type}`}>
                        {TYPE_LABEL[r.type]}
                      </span>
                      <span className="staff-request-location">{r.location_name ?? 'Location not specified'}</span>
                      {r.name && <span className="staff-request-name">from {r.name}</span>}
                      <span className="staff-request-time">{new Date(r.created_at).toLocaleTimeString()}</span>
                      <span className={`staff-request-status-badge staff-request-status-badge-${r.status}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </div>
                    {r.description && <p className="staff-request-description">{r.description}</p>}
                    {r.acknowledged_by && (
                      <p className="staff-request-attribution">Acknowledged by {r.acknowledged_by}</p>
                    )}
                    {r.resolved_by && <p className="staff-request-attribution">Resolved by {r.resolved_by}</p>}
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
                    {(r.status === 'open' || r.status === 'acknowledged') && (
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

      {tab === 'announcements' && (
        <section className="staff-announcements-section">
          {announcementsError && (
            <p className="screen-error">Couldn't load announcements: {announcementsError}</p>
          )}
          <form className="staff-announcement-create-form" onSubmit={createAnnouncement}>
            <label className="staff-announcement-create-label" htmlFor="staff-new-announcement">
              New Announcement
            </label>
            <textarea
              id="staff-new-announcement"
              className="staff-announcement-textarea"
              value={newAnnouncementText}
              onChange={(e) => setNewAnnouncementText(e.target.value)}
              rows={3}
              required
            />
            <button
              type="submit"
              className="btn btn-primary staff-announcement-post-btn"
              disabled={creatingAnnouncement || !newAnnouncementText.trim()}
            >
              {creatingAnnouncement ? 'Posting…' : 'Post Announcement'}
            </button>
          </form>

          <h2 className="staff-photos-subheading">Current Announcements</h2>
          {announcements === null ? (
            <p className="staff-photos-loading">Loading announcements…</p>
          ) : announcements.length === 0 ? (
            <p className="staff-photos-empty">No announcements yet.</p>
          ) : (
            <ul className="staff-announcements-list">
              {announcements.map((a) => (
                <li key={a.id} className="staff-announcement-row cap-parchment-card" data-announcement-id={a.id}>
                  {editingAnnouncementId === a.id ? (
                    <div className="staff-announcement-edit">
                      <textarea
                        className="staff-announcement-textarea"
                        value={editingAnnouncementText}
                        onChange={(e) => setEditingAnnouncementText(e.target.value)}
                        rows={3}
                        autoFocus
                      />
                      <div className="staff-announcement-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={pendingAnnouncementActionId === a.id}
                          onClick={() => setEditingAnnouncementId(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-approve"
                          disabled={pendingAnnouncementActionId === a.id || !editingAnnouncementText.trim()}
                          onClick={() => saveEditingAnnouncement(a.id)}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="staff-announcement-text">{a.text}</span>
                      <div className="staff-announcement-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={pendingAnnouncementActionId === a.id}
                          onClick={() => startEditingAnnouncement(a)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-delete"
                          disabled={pendingAnnouncementActionId === a.id}
                          onClick={() => deleteAnnouncement(a.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'attractions' && (
        <section className="staff-attractions-section">
          <p className="staff-attractions-hint">
            Closing an attraction only changes how it looks on the Map (grey pin, lock icon, "(Closed)" in the
            legend) -- it stays fully scannable and completable for Scavenger Hunt and Bingo.
          </p>
          {attractionsError && <p className="screen-error">Couldn't load attractions: {attractionsError}</p>}
          {attractionNodes === null ? (
            <p className="staff-photos-loading">Loading attractions…</p>
          ) : (
            <ul className="staff-attractions-list">
              {[...attractionNodes]
                .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
                .map((node) => (
                  <li key={node.id} className="staff-attraction-row cap-parchment-card" data-node-id={node.id}>
                    <div className="staff-attraction-main">
                      <span className="staff-attraction-name">{node.name}</span>
                      <span className="staff-attraction-category">{NODE_CATEGORY_LABEL[node.category]}</span>
                      <span
                        className={`staff-attraction-status-badge staff-attraction-status-badge-${node.is_open ? 'open' : 'closed'}`}
                      >
                        {node.is_open ? 'Open' : node.coming_soon ? 'Coming soon' : 'Closed'}
                      </span>
                    </div>
                    <div className="staff-attraction-actions">
                      <button
                        type="button"
                        className={node.is_open ? 'btn btn-delete' : 'btn btn-approve'}
                        disabled={pendingAttractionActionId === node.id}
                        onClick={() => toggleNodeOpen(node)}
                      >
                        {/* Opening a coming-soon node also clears coming_soon (set_node_open_status). */}
                        {node.is_open ? 'Close' : node.coming_soon ? 'Open' : 'Reopen'}
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'animal-photos' && (
        <section className="staff-animal-photos-section">
          <div className="staff-animal-picker" role="tablist" aria-label="Choose an animal">
            {ANIMALS.map((animal) => (
              <button
                type="button"
                key={animal.slug}
                role="tab"
                aria-selected={selectedAnimalSlug === animal.slug}
                className={`staff-animal-picker-btn ${selectedAnimalSlug === animal.slug ? 'staff-animal-picker-btn-active' : ''}`}
                onClick={() => setSelectedAnimalSlug(animal.slug)}
              >
                {animal.name}
              </button>
            ))}
          </div>

          {animalPhotosError && <p className="screen-error">Couldn't load animal photos: {animalPhotosError}</p>}

          {animalPhotos === null ? (
            <p className="staff-photos-loading">Loading animal photos…</p>
          ) : animalPhotos.filter((p) => p.animal_slug === selectedAnimalSlug).length === 0 ? (
            <p className="staff-photos-empty">No photos uploaded for this animal yet.</p>
          ) : (
            <ul className="staff-photos-list">
              {animalPhotos
                .filter((p) => p.animal_slug === selectedAnimalSlug)
                .sort((a, b) => a.display_order - b.display_order)
                .map((photo, i, photosForAnimal) => (
                  <li key={photo.id} className="staff-photo-row cap-parchment-card" data-photo-id={photo.id}>
                    <img
                      src={photo.photo_url}
                      alt=""
                      className="staff-photo-thumb"
                      width={56}
                      height={56}
                      loading="lazy"
                      decoding="async"
                    />
                    <span className="staff-photo-label">Photo {i + 1}</span>
                    <div className="staff-photo-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={pendingAnimalPhotoActionId !== null || i === 0}
                        onClick={() => moveAnimalPhoto(photosForAnimal, photo, -1)}
                        aria-label="Move photo up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={pendingAnimalPhotoActionId !== null || i === photosForAnimal.length - 1}
                        onClick={() => moveAnimalPhoto(photosForAnimal, photo, 1)}
                        aria-label="Move photo down"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn btn-delete"
                        disabled={pendingAnimalPhotoActionId !== null}
                        onClick={() => deleteAnimalPhoto(photo.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          )}

          <form className="staff-animal-photo-upload-form" onSubmit={uploadAnimalPhoto}>
            <input
              ref={animalPhotoFileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => setAnimalPhotoUploadFile(e.target.files?.[0] ?? null)}
              disabled={uploadingAnimalPhoto}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!animalPhotoUploadFile || uploadingAnimalPhoto}
            >
              {uploadingAnimalPhoto ? 'Uploading…' : 'Upload Photo'}
            </button>
          </form>
        </section>
      )}

      {tab === 'analytics' && <StaffAnalytics />}

      {tab === 'qr-codes' && <StaffQrDirectory />}
        </div>
      </div>

      {nameModalOpen && (
        <StaffNameModal
          currentName={staffName}
          onClose={() => setNameModalOpen(false)}
          onSaved={(name) => {
            setStaffNameState(name)
            setNameModalOpen(false)
          }}
        />
      )}
    </div>
  )
}
