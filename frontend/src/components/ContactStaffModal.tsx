import { useEffect, useState } from 'react'
import { api, STAFF_REQUEST_DESCRIPTION_MAX_LENGTH, type MapNode, type StaffRequest, type StaffRequestType } from '../api'
import { PAGE_SUBHEADERS } from '../pageSubheaderContent'
import { Modal } from './Modal'
import { MessageIcon } from './NavIcons'
import './ContactStaffModal.css'

type Step = 'menu' | 'question-location' | 'emergency-location' | 'submitted'

const ACTIVE_STATUS_COPY: Record<'open' | 'acknowledged', string> = {
  open: "A staff member has been notified and will come find you when they're free.",
  acknowledged: 'A staff member has seen your request and is heading your way.',
}

interface ContactStaffModalProps {
  nodes: MapNode[] | null
  // undefined = still loading (App.tsx hasn't resolved its first fetch yet);
  // null = confirmed no active request; otherwise the session's own active
  // (open/acknowledged) request.
  myRequestStatus: StaffRequest | null | undefined
  // Called after a successful submit AND after a successful cancel, so
  // App.tsx's badge/toast state updates immediately rather than waiting for
  // its next poll tick -- and, after a submit, so App.tsx sees the new
  // active request and starts polling at all (it doesn't poll while there's
  // no active request). Also fired on mount, so reopening this modal
  // always shows a freshly-checked status -- the "check anytime" half of
  // this feature, and what lets e2e force a poll tick without sleeping.
  onRequestChanged: () => void
  onClose: () => void
}

// Two clearly separate flows (Plan.md 2.10) so a genuine emergency never
// gets lost behind a "just a question" flow, or vice versa. No GPS in this
// POC -- the guest picks their nearest node from the map list instead of an
// auto-detected location. The emergency path is deliberately one tap
// shorter than the question path: tapping a location submits immediately,
// with no separate confirm step in the way.
export function ContactStaffModal({ nodes, myRequestStatus, onRequestChanged, onClose }: ContactStaffModalProps) {
  const [step, setStep] = useState<Step>('menu')
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submittedType, setSubmittedType] = useState<StaffRequestType | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onRequestChanged(), [])

  // Sub-games (e.g. Cornhole under Arcade Pad) aren't their own physical
  // location -- only top-level nodes make sense as a "where are you?" pick.
  const locations = (nodes ?? [])
    .filter((n) => n.parent_node_id == null)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))

  const submit = (type: StaffRequestType, locationNodeId: string | null) => {
    setSubmitting(true)
    setError(null)
    api
      .createStaffRequest(type, locationNodeId, name.trim() || null, description.trim() || null)
      .then(() => {
        setSubmittedType(type)
        setStep('submitted')
        onRequestChanged()
      })
      .catch((err) => setError(String(err)))
      .finally(() => setSubmitting(false))
  }

  const cancelRequest = () => {
    setCancelling(true)
    setCancelError(null)
    api
      .cancelMyStaffRequest()
      .then(() => onRequestChanged())
      .catch((err) => setCancelError(String(err)))
      .finally(() => setCancelling(false))
  }

  const renderTitle = (text: string) => (
    <h2 id="contact-staff-title" className="contact-staff-title">
      <span className="contact-staff-icon-badge" aria-hidden="true">
        <MessageIcon />
      </span>
      {text}
    </h2>
  )

  if (myRequestStatus === undefined) {
    return (
      <Modal onClose={onClose} labelledBy="contact-staff-title" className="contact-staff-modal-frame">
        <div className="contact-staff-modal-inner">
          <div className="contact-staff-modal-scroll">
            {renderTitle('Contact Staff')}
            <p className="contact-staff-loading">Checking your request status…</p>
          </div>
        </div>
      </Modal>
    )
  }

  // A guest with an active (open/acknowledged) request can't start a second
  // one -- checking step === 'menu' (not just "no active request") is what
  // keeps this from clobbering the "submitted"/confirmation screen: right
  // after a fresh submit, onRequestChanged()'s background refetch resolves
  // and updates myRequestStatus while step is already 'submitted', so this
  // branch is skipped and the confirmation the guest is looking at stays put.
  if (step === 'menu' && myRequestStatus) {
    const req = myRequestStatus
    return (
      <Modal onClose={onClose} labelledBy="contact-staff-title" className="contact-staff-modal-frame">
        <div className="contact-staff-modal-inner">
          <div className="contact-staff-modal-scroll">
            {renderTitle(req.type === 'emergency' ? 'Help is on the way' : 'Your Request')}
            <p className="contact-staff-subtitle">{ACTIVE_STATUS_COPY[req.status as 'open' | 'acknowledged']}</p>
            {cancelError && <p className="screen-error">{cancelError}</p>}
            <div className="contact-staff-active-details">
              <span className={`contact-staff-status-badge contact-staff-status-badge-${req.status}`}>
                {req.status === 'acknowledged' ? 'Acknowledged' : 'Open'}
              </span>
              {req.location_name && <p className="contact-staff-active-location">Location: {req.location_name}</p>}
              {req.description && <p className="contact-staff-active-description">{req.description}</p>}
            </div>
            <button type="button" className="btn btn-secondary contact-staff-cancel" disabled={cancelling} onClick={cancelRequest}>
              {cancelling ? 'Cancelling…' : 'Cancel Request'}
            </button>
            <button type="button" className="btn btn-danger" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  if (step === 'menu') {
    return (
      <Modal onClose={onClose} labelledBy="contact-staff-title" className="contact-staff-modal-frame">
        <div className="contact-staff-modal-inner">
          <div className="contact-staff-modal-scroll">
            {renderTitle('Contact Staff')}
            <p className="cap-page-subheader contact-staff-page-subheader">{PAGE_SUBHEADERS.contactStaff}</p>
            <div className="contact-staff-menu">
              <button
                type="button"
                className="contact-staff-option"
                onClick={() => setStep('question-location')}
              >
                <span className="contact-staff-option-title">I have a question</span>
                <span className="contact-staff-option-desc">A staff member will come find you — not urgent.</span>
              </button>
              <button
                type="button"
                className="contact-staff-option contact-staff-option-emergency"
                onClick={() => setStep('emergency-location')}
              >
                <span className="contact-staff-option-title">I need help now</span>
                <span className="contact-staff-option-desc">Emergency — notifies staff immediately.</span>
              </button>
            </div>
          </div>
        </div>
      </Modal>
    )
  }

  if (step === 'question-location' || step === 'emergency-location') {
    const isEmergency = step === 'emergency-location'
    return (
      <Modal onClose={onClose} labelledBy="contact-staff-title" className="contact-staff-modal-frame">
        <div className="contact-staff-modal-inner">
          <div className="contact-staff-modal-scroll">
            {renderTitle('Where are you?')}
            <p className="contact-staff-subtitle">
              {isEmergency
                ? 'Tap your nearest location to notify staff right away.'
                : 'Pick your nearest location, then send your question.'}
            </p>
            {error && <p className="screen-error">{error}</p>}
            <div className="contact-staff-details">
              <input
                type="text"
                className="contact-staff-name-input"
                placeholder="Your name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                maxLength={100}
              />
              <textarea
                className="contact-staff-description-input"
                placeholder="What's going on? (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
                maxLength={STAFF_REQUEST_DESCRIPTION_MAX_LENGTH}
                rows={2}
              />
            </div>
            {nodes === null ? (
              <p className="contact-staff-loading">Loading locations…</p>
            ) : (
              <div className="contact-staff-locations">
                {locations.map((node) => (
                  <button
                    type="button"
                    key={node.id}
                    className={`contact-staff-location ${
                      !isEmergency && selectedLocationId === node.id ? 'contact-staff-location-selected' : ''
                    }`}
                    disabled={submitting}
                    onClick={() => (isEmergency ? submit('emergency', node.id) : setSelectedLocationId(node.id))}
                  >
                    {node.name}
                  </button>
                ))}
              </div>
            )}
            {!isEmergency && (
              <button
                type="button"
                className="btn btn-danger contact-staff-submit"
                disabled={!selectedLocationId || submitting}
                onClick={() => selectedLocationId && submit('question', selectedLocationId)}
              >
                {submitting ? 'Sending…' : 'Submit Question'}
              </button>
            )}
            <button type="button" className="btn btn-secondary contact-staff-back" onClick={() => setStep('menu')}>
              Back
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} labelledBy="contact-staff-title" className="contact-staff-modal-frame">
      <div className="contact-staff-modal-inner">
        <div className="contact-staff-modal-scroll">
          {renderTitle(submittedType === 'emergency' ? 'Help is on the way' : 'Question sent')}
          <p className="contact-staff-subtitle">
            {submittedType === 'emergency'
              ? 'A staff member has been notified and is heading your way now.'
              : "A staff member has been notified and will come find you when they're free."}
          </p>
          <button type="button" className="btn btn-danger" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
