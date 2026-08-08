import { useState } from 'react'
import type { Puzzle, PuzzleChallenge } from '../api'
import { PuzzleChallengeModal } from './PuzzleChallengeModal'
import { PuzzlePieceIcon } from './NavIcons'
import './PuzzleScreen.css'

interface PuzzleScreenProps {
  puzzles: Puzzle[] | null
  error: string | null
  onReload: () => void
  onCoinsChanged: () => void
}

export function formatSeconds(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function PuzzleScreen({ puzzles, error, onReload, onCoinsChanged }: PuzzleScreenProps) {
  const [active, setActive] = useState<{ puzzle: Puzzle; challenge: PuzzleChallenge } | null>(null)

  if (error) {
    return (
      <div className="puzzle-screen">
        <p className="screen-error">Couldn't load the puzzles: {error}</p>
        <button type="button" className="btn btn-secondary" onClick={onReload}>
          Retry
        </button>
      </div>
    )
  }

  if (!puzzles) {
    return <div className="puzzle-screen puzzle-loading">Loading puzzles…</div>
  }

  return (
    <div className="puzzle-screen">
      <h1 className="cap-sign-board">
        <PuzzlePieceIcon className="cap-sign-board-icon" />
        Floor Puzzles
      </h1>

      <div className="puzzle-list">
        {puzzles.map((puzzle) => (
          <div className="puzzle-card-frame" key={puzzle.id}>
            <div className="puzzle-card cap-parchment-card">
              <div className="puzzle-card-header">
                <span className="puzzle-icon-badge" aria-hidden="true">
                  <PuzzlePieceIcon />
                </span>
                <h2 className="puzzle-name">{puzzle.name}</h2>
              </div>
              <p className="puzzle-rules">{puzzle.rules_text}</p>
              <div className="puzzle-challenge-list">
                {puzzle.challenges.map((challenge) => (
                  <button
                    type="button"
                    key={challenge.id}
                    className="btn puzzle-challenge-btn"
                    onClick={() => setActive({ puzzle, challenge })}
                  >
                    <span className="puzzle-challenge-label">{challenge.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {active && (
        <PuzzleChallengeModal
          puzzle={active.puzzle}
          challenge={active.challenge}
          onClose={() => setActive(null)}
          onCoinsChanged={onCoinsChanged}
        />
      )}
    </div>
  )
}
