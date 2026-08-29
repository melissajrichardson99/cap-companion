import { useEffect, useState } from 'react'
import type { Puzzle, PuzzleChallenge } from '../api'
import { PAGE_SUBHEADERS } from '../pageSubheaderContent'
import { PuzzleChallengeModal } from './PuzzleChallengeModal'
import { PuzzlePieceIcon } from './NavIcons'
import './PuzzleScreen.css'

interface PuzzleScreenProps {
  puzzles: Puzzle[] | null
  error: string | null
  onReload: () => void
  onCoinsChanged: () => void
  // Set only when landing via a QR deep link (/puzzles/:challengeSlug) --
  // matched against the loaded puzzles' challenges to auto-open that
  // challenge's popup, same pattern as ScoringScreen's gameSlug.
  challengeSlug?: string
  onBrowsePuzzles?: () => void
}

export function formatSeconds(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function findChallengeBySlug(
  puzzles: Puzzle[],
  slug: string,
): { puzzle: Puzzle; challenge: PuzzleChallenge } | null {
  for (const puzzle of puzzles) {
    const challenge = puzzle.challenges.find((c) => c.slug === slug)
    if (challenge) return { puzzle, challenge }
  }
  return null
}

export function PuzzleScreen({ puzzles, error, onReload, onCoinsChanged, challengeSlug, onBrowsePuzzles }: PuzzleScreenProps) {
  const [active, setActive] = useState<{ puzzle: Puzzle; challenge: PuzzleChallenge } | null>(null)

  // Runs once per distinct (challengeSlug, puzzles) pair, not on every
  // render -- see ScoringScreen's matching effect for why.
  useEffect(() => {
    if (!challengeSlug || !puzzles) return
    const match = findChallengeBySlug(puzzles, challengeSlug)
    if (match) setActive(match)
  }, [challengeSlug, puzzles])

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

  if (challengeSlug && !findChallengeBySlug(puzzles, challengeSlug)) {
    return (
      <div className="puzzle-screen">
        <h1 className="cap-sign-board">
          <PuzzlePieceIcon className="cap-sign-board-icon" />
          Floor Puzzles
        </h1>
        <p className="puzzle-not-found">
          We couldn't find that puzzle challenge ("{challengeSlug}"). It may have moved or the sign's QR code is out
          of date.
        </p>
        <button type="button" className="btn btn-primary" onClick={onBrowsePuzzles}>
          Browse Puzzles
        </button>
      </div>
    )
  }

  return (
    <div className="puzzle-screen">
      <div className="puzzle-foliage puzzle-foliage-bottom-left-lower" aria-hidden="true" />
      <div className="puzzle-foliage puzzle-foliage-bottom-center" aria-hidden="true" />
      <div className="puzzle-foliage puzzle-foliage-bottom-right" aria-hidden="true" />
      <h1 className="cap-sign-board">
        <PuzzlePieceIcon className="cap-sign-board-icon" />
        Floor Puzzles
      </h1>
      <p className="cap-page-subheader">{PAGE_SUBHEADERS.puzzles}</p>

      <div className="puzzle-list">
        {puzzles.map((puzzle) => (
          <div className="puzzle-card cap-parchment-card" key={puzzle.id}>
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
