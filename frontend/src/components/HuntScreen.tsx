import { useState } from 'react'
import type { HuntCharacter } from '../api'
import { HuntChallengeModal } from './HuntChallengeModal'
import { Modal } from './Modal'
import { LockIcon, SearchIcon } from './NavIcons'
import './HuntScreen.css'

interface HuntScreenProps {
  characters: HuntCharacter[] | null
  error: string | null
  onReload: () => void
  onCompleteChallenge: (challengeId: string) => Promise<HuntCharacter>
  onPlayMinigame: (challengeId: string, minigameSlug: string) => void
  onScanQr: () => void
}

const SPECIES_LABEL: Record<HuntCharacter['species_category'], string> = {
  marsupial: 'Marsupial',
  rodent: 'Rodent',
  other: 'Animal',
}

export function HuntScreen({ characters, error, onReload, onCompleteChallenge, onPlayMinigame, onScanQr }: HuntScreenProps) {
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null)
  const [lockedCharacterId, setLockedCharacterId] = useState<string | null>(null)

  if (error) {
    return (
      <div className="hunt-screen">
        <p className="screen-error">Couldn't load the scavenger hunt: {error}</p>
        <button type="button" className="btn btn-secondary" onClick={onReload}>
          Retry
        </button>
      </div>
    )
  }

  if (!characters) {
    return <div className="hunt-screen hunt-loading">Loading scavenger hunt…</div>
  }

  // Looked up fresh from the characters prop (not a snapshot taken on open)
  // so the modal re-renders reactively once a minigame launched from
  // Challenge 3 completes and App.tsx's reload lands.
  const activeCharacter = characters.find((c) => c.id === activeCharacterId) ?? null
  const lockedCharacter = characters.find((c) => c.id === lockedCharacterId) ?? null

  return (
    <div className="hunt-screen">
      <h1 className="cap-sign-board">
        <SearchIcon className="cap-sign-board-icon" />
        Scavenger Hunt
      </h1>

      <p className="hunt-intro">Find all 5 animals and complete their challenges.</p>
      <div className="hunt-character-grid">
        {characters.map((character) => {
          const isComplete = character.challenges_completed.length >= 3
          return (
            <button
              type="button"
              key={character.id}
              className={`hunt-character-card cap-parchment-card ${isComplete ? 'hunt-character-complete' : ''} ${
                character.unlocked ? '' : 'hunt-character-locked'
              }`}
              onClick={() => (character.unlocked ? setActiveCharacterId(character.id) : setLockedCharacterId(character.id))}
            >
              <span className="hunt-character-name">{character.name}</span>
              <span className="hunt-character-species">{SPECIES_LABEL[character.species_category]}</span>
              <span className="hunt-character-status">
                {!character.unlocked ? (
                  <>
                    <LockIcon className="hunt-character-lock-icon" /> Scan to unlock
                  </>
                ) : isComplete ? (
                  'Found! ✓'
                ) : (
                  `${character.challenges_completed.length}/3 challenges`
                )}
              </span>
            </button>
          )
        })}
      </div>

      {activeCharacter && (
        <HuntChallengeModal
          character={activeCharacter}
          onClose={() => setActiveCharacterId(null)}
          onCompleteChallenge={onCompleteChallenge}
          onPlayMinigame={onPlayMinigame}
        />
      )}

      {lockedCharacter && (
        <Modal onClose={() => setLockedCharacterId(null)} labelledBy="hunt-locked-title" className="hunt-modal-frame">
          <div className="hunt-modal-inner hunt-locked-prompt">
            <h2 id="hunt-locked-title" className="hunt-modal-title">
              <span className="hunt-modal-icon-badge" aria-hidden="true">
                <LockIcon />
              </span>
              {lockedCharacter.name} is locked
            </h2>
            <p>Find {lockedCharacter.name}'s sign in the park and scan its QR code (or enter the code printed on it) to unlock this challenge.</p>
            <div className="hunt-modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setLockedCharacterId(null)
                  onScanQr()
                }}
              >
                Scan Now
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setLockedCharacterId(null)}>
                Not Yet
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
