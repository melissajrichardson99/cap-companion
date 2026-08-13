import type { HuntCharacter } from '../api'
import { HUNT_CHARACTER_CONTENT } from '../huntCharacterContent'
import { Modal } from './Modal'
import './HuntCharacterFoundModal.css'

interface HuntCharacterFoundModalProps {
  character: HuntCharacter
  onStartChallenges: () => void
  onClose: () => void
}

// Shown once, immediately after a fresh scan unlocks a character -- replaces
// the old "scan drops you straight into Challenge 1" behavior with a beat
// that actually acknowledges what was just found before challenges start.
// Only rendered by ScanScreen on a genuine locked->unlocked transition (see
// its wasLocked check) -- re-scanning an already-unlocked character skips
// this and goes straight to HuntChallengeModal, unchanged from today.
export function HuntCharacterFoundModal({ character, onStartChallenges, onClose }: HuntCharacterFoundModalProps) {
  const content = HUNT_CHARACTER_CONTENT[character.name]

  return (
    <Modal onClose={onClose} labelledBy="hunt-found-title" className="hunt-modal-frame">
      <div className="hunt-modal-inner hunt-found-modal" data-hunt-character={content.slug}>
        <span className="hunt-found-emoji" aria-hidden="true">
          {content.emoji}
        </span>
        <p className="hunt-found-eyebrow">You found</p>
        <h2 id="hunt-found-title" className="hunt-found-name">
          {character.name}
        </h2>
        <p className="hunt-found-description">{content.description}</p>
        <div className="hunt-modal-actions hunt-found-actions">
          <button type="button" className="btn btn-primary" onClick={onStartChallenges}>
            Start Challenges
          </button>
        </div>
      </div>
    </Modal>
  )
}
