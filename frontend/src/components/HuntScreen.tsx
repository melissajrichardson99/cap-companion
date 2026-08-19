import { useState } from 'react'
import type { HuntCharacter } from '../api'
import { HUNT_CHARACTER_CONTENT } from '../huntCharacterContent'
import { HuntChallengeModal } from './HuntChallengeModal'
import { Modal } from './Modal'
import { CameraIcon, LockIcon, SearchIcon } from './NavIcons'
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
  const [hintCharacterId, setHintCharacterId] = useState<string | null>(null)

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
  const hintCharacter = characters.find((c) => c.id === hintCharacterId) ?? null

  const unlockedCount = characters.filter((c) => c.unlocked).length

  return (
    <div className="hunt-screen">
      <h1 className="cap-sign-board">
        <SearchIcon className="cap-sign-board-icon" />
        Scavenger Hunt
      </h1>

      <p className="hunt-intro">Find all 5 animals and complete their challenges.</p>

      <div className="hunt-overall-progress cap-parchment-card">
        <div className="hunt-overall-progress-label">
          <span>Animals Found</span>
          <span>
            {unlockedCount} of {characters.length}
          </span>
        </div>
        <div
          className="hunt-overall-progress-track"
          role="progressbar"
          aria-valuenow={unlockedCount}
          aria-valuemin={0}
          aria-valuemax={characters.length}
          aria-label="Overall scavenger hunt progress"
        >
          <div
            className="hunt-overall-progress-fill"
            style={{ width: `${(unlockedCount / characters.length) * 100}%` }}
          />
        </div>
        <button type="button" className="hunt-scan-cta btn btn-primary" onClick={onScanQr}>
          <CameraIcon className="hunt-scan-cta-icon" />
          Scan QR Code
        </button>
      </div>

      <div className="hunt-character-grid">
        {characters.map((character) => {
          const content = HUNT_CHARACTER_CONTENT[character.name]
          const isComplete = character.challenges_completed.length >= 3
          return (
            <button
              type="button"
              key={character.id}
              data-hunt-character={content.slug}
              className={`hunt-character-card cap-parchment-card ${isComplete ? 'hunt-character-complete' : ''} ${
                character.unlocked ? '' : 'hunt-character-locked'
              }`}
              onClick={() => (character.unlocked ? setActiveCharacterId(character.id) : setHintCharacterId(character.id))}
            >
              {character.unlocked ? (
                <>
                  <span className="hunt-character-emoji" aria-hidden="true">
                    {content.emoji}
                  </span>
                  <span className="hunt-character-name">{character.name}</span>
                  <span className="hunt-character-species">{SPECIES_LABEL[character.species_category]}</span>
                  <span className="hunt-character-status">
                    {isComplete ? 'Found! ✓' : `${character.challenges_completed.length}/3 challenges completed`}
                  </span>
                </>
              ) : (
                <>
                  <span className="hunt-character-locked-mark" aria-hidden="true">
                    ???
                  </span>
                  <span className="hunt-character-status">
                    <LockIcon className="hunt-character-lock-icon" /> Locked
                  </span>
                </>
              )}
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

      {hintCharacter && (
        <Modal onClose={() => setHintCharacterId(null)} labelledBy="hunt-hint-title" className="hunt-modal-frame">
          <div className="hunt-modal-inner hunt-locked-hint-prompt">
            <h2 id="hunt-hint-title" className="hunt-modal-title">
              <span className="hunt-modal-icon-badge" aria-hidden="true">
                <LockIcon />
              </span>
              Something's Hiding Here
            </h2>
            <p className="hunt-locked-hint-text">{HUNT_CHARACTER_CONTENT[hintCharacter.name].hint}</p>
            <p>Find the sign at that spot and scan its QR code (or enter the code printed on it) to discover who's hiding — and unlock their challenges.</p>
            <div className="hunt-modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setHintCharacterId(null)
                  onScanQr()
                }}
              >
                Scan Now
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setHintCharacterId(null)}>
                Not Yet
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
