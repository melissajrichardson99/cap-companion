import { useState } from 'react'
import { api, type MapNode, type StaffRequestType } from '../api'
import { PAGE_SUBHEADERS } from '../pageSubheaderContent'
import { Modal } from './Modal'
import { MessageIcon } from './NavIcons'
import './ContactStaffModal.css'

type Step = 'menu' | 'question-location' | 'emergency-location' | 'submitted'

interface ContactStaffModalProps {
  nodes: MapNode[] | null
  onClose: () => void
}

// Two clearly separate flows (Plan.md 2.10) so a genuine emergency never
// gets lost behind a "just a question" flow, or vice versa. No GPS in this
// POC -- the guest picks their nearest node from the map list instead of an
// auto-detected location. The emergency path is deliberately one tap
// shorter than the question path: tapping a location submits immediately,
// with no separate confirm step in the way.
export function ContactStaffModal({ nodes, onClose }: ContactStaffModalProps) {
  const [step, setStep] = useState<Step>('menu')
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [submittedType, setSubmittedType] = useState<StaffRequestType | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      .createStaffRequest(type, locationNodeId)
      .then(() => {
        setSubmittedType(type)
        setStep('submitted')
      })
      .catch((err) => setError(String(err)))
      .finally(() => setSubmitting(false))
  }

  const renderTitle = (text: string) => (
    <h2 id="contact-staff-title" className="contact-staff-title">
      <span className="contact-staff-icon-badge" aria-hidden="true">
        <MessageIcon />
      </span>
      {text}
    </h2>
  )

  if (step === 'menu') {
    return (
      <Modal onClose={onClose} labelledBy="contact-staff-title" className="contact-staff-modal-frame">
        <div className="contact-staff-modal-inner">
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
      </Modal>
    )
  }

  if (step === 'question-location' || step === 'emergency-location') {
    const isEmergency = step === 'emergency-location'
    return (
      <Modal onClose={onClose} labelledBy="contact-staff-title" className="contact-staff-modal-frame">
        <div className="contact-staff-modal-inner">
          {renderTitle('Where are you?')}
          <p className="contact-staff-subtitle">
            {isEmergency
              ? 'Tap your nearest location to notify staff right away.'
              : 'Pick your nearest location, then send your question.'}
          </p>
          {error && <p className="screen-error">{error}</p>}
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
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} labelledBy="contact-staff-title" className="contact-staff-modal-frame">
      <div className="contact-staff-modal-inner">
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
    </Modal>
  )
}
