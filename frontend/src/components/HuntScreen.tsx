import { useState } from 'react'
import type { HuntCharacter } from '../api'
import { HuntChallengeModal } from './HuntChallengeModal'
import './HuntScreen.css'

interface HuntScreenProps {
  characters: HuntCharacter[] | null
  error: string | null
  onReload: () => void
  onCompleteChallenge: (challengeId: string) => Promise<HuntCharacter>
  onPlayMinigame: (challengeId: string, minigameSlug: string) => void
}

const SPECIES_LABEL: Record<HuntCharacter['species_category'], string> = {
  marsupial: 'Marsupial',
  rodent: 'Rodent',
  other: 'Animal',
}

export function HuntScreen({ characters, error, onReload, onCompleteChallenge, onPlayMinigame }: HuntScreenProps) {
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null)

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

  return (
    <div className="hunt-screen">
      <p className="hunt-intro">Find all 5 animals and complete their challenges.</p>
      <div className="hunt-character-grid">
        {characters.map((character) => {
          const isComplete = character.challenges_completed.length >= 3
          return (
            <button
              type="button"
              key={character.id}
              className={`hunt-character-card ${isComplete ? 'hunt-character-complete' : ''}`}
              onClick={() => setActiveCharacterId(character.id)}
            >
              <span className="hunt-character-name">{character.name}</span>
              <span className="hunt-character-species">{SPECIES_LABEL[character.species_category]}</span>
              <span className="hunt-character-status">
                {isComplete ? 'Found! ✓' : `${character.challenges_completed.length}/3 challenges`}
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
    </div>
  )
}
