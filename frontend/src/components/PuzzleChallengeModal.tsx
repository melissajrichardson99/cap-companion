import { useEffect, useRef, useState } from 'react'
import { api, type LeaderboardEntry, type LeaderboardScope, type Puzzle, type PuzzleChallenge } from '../api'
import { Modal } from './Modal'
import { formatSeconds } from './PuzzleScreen'
import './PuzzleChallengeModal.css'

type TimerState = 'idle' | 'running' | 'stopped'

interface PuzzleChallengeModalProps {
  puzzle: Puzzle
  challenge: PuzzleChallenge
  onClose: () => void
}

const HINT_TIERS = ['hint_tier_1', 'hint_tier_2', 'hint_tier_3'] as const

export function PuzzleChallengeModal({ puzzle, challenge, onClose }: PuzzleChallengeModalProps) {
  const [timerState, setTimerState] = useState<TimerState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedAtRef = useRef(0)

  const [hintsRevealed, setHintsRevealed] = useState(0)
  const [attemptError, setAttemptError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)

  const [scope, setScope] = useState<LeaderboardScope>('all_time')
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null)
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (timerState !== 'running') return
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200)
    return () => clearInterval(id)
  }, [timerState])

  useEffect(() => {
    setLeaderboardError(null)
    api
      .getPuzzleLeaderboard(challenge.id, scope)
      .then(setLeaderboard)
      .catch((err) => setLeaderboardError(String(err)))
  }, [challenge.id, scope, refreshTick])

  const start = () => {
    startedAtRef.current = Date.now()
    setElapsedMs(0)
    setAttemptError(null)
    setTimerState('running')
  }

  const stop = async () => {
    setTimerState('stopped')
    const elapsedSeconds = Math.max(1, Math.round(elapsedMs / 1000))
    setRecording(true)
    try {
      await api.recordPuzzleAttempt(challenge.id, elapsedSeconds)
      setRefreshTick((t) => t + 1)
    } catch (err) {
      setAttemptError(String(err))
    } finally {
      setRecording(false)
    }
  }

  const reset = () => {
    setTimerState('idle')
    setElapsedMs(0)
    setAttemptError(null)
  }

  const hintText = (tier: (typeof HINT_TIERS)[number]) => challenge[tier]
  const hasHints = challenge.solution_type !== 'none'
  const finalTierLabel = challenge.solution_type === 'exact' ? 'Full Solution' : 'Full Strategy'

  return (
    <Modal onClose={onClose} labelledBy="puzzle-challenge-title">
      <h2 id="puzzle-challenge-title" className="puzzle-modal-title">
        {puzzle.name} — {challenge.label}
      </h2>
      <p className="puzzle-modal-rules">{puzzle.rules_text}</p>
      {challenge.target_time_seconds !== null && (
        <p className="puzzle-modal-target">Target time: {formatSeconds(challenge.target_time_seconds)}</p>
      )}

      <div className="puzzle-timer">
        <span className="puzzle-timer-display">{formatSeconds(Math.round(elapsedMs / 1000))}</span>
        <div className="puzzle-timer-controls">
          {timerState !== 'running' ? (
            <button type="button" className="btn btn-primary" onClick={start}>
              {timerState === 'stopped' ? 'Restart' : 'Start'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={stop}>
              Stop
            </button>
          )}
          {timerState === 'stopped' && (
            <button type="button" className="btn btn-secondary" onClick={reset}>
              Reset
            </button>
          )}
        </div>
        {recording && <p className="puzzle-timer-status">Saving time…</p>}
        {attemptError && <p className="screen-error">Couldn't save that attempt: {attemptError}</p>}
      </div>

      {hasHints && (
        <div className="puzzle-hints">
          <h3 className="puzzle-section-title">Hints</h3>
          {HINT_TIERS.slice(0, hintsRevealed).map((tier, i) => (
            <p key={tier} className="puzzle-hint-text">
              <strong>{i === 2 ? finalTierLabel : `Hint ${i + 1}`}:</strong> {hintText(tier)}
            </p>
          ))}
          {hintsRevealed < 3 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setHintsRevealed((n) => n + 1)}
            >
              {hintsRevealed === 2 ? `Show ${finalTierLabel}` : `Show Hint (${hintsRevealed + 1}/3)`}
            </button>
          )}
        </div>
      )}

      <div className="puzzle-leaderboard">
        <div className="puzzle-leaderboard-header">
          <h3 className="puzzle-section-title">Leaderboard</h3>
          <div className="puzzle-leaderboard-toggle">
            <button
              type="button"
              className={`btn puzzle-scope-btn ${scope === 'daily' ? 'puzzle-scope-btn-active' : ''}`}
              onClick={() => setScope('daily')}
            >
              Today
            </button>
            <button
              type="button"
              className={`btn puzzle-scope-btn ${scope === 'all_time' ? 'puzzle-scope-btn-active' : ''}`}
              onClick={() => setScope('all_time')}
            >
              All-Time
            </button>
          </div>
        </div>

        {leaderboardError && <p className="screen-error">Couldn't load the leaderboard: {leaderboardError}</p>}
        {!leaderboardError && leaderboard === null && <p className="puzzle-leaderboard-empty">Loading…</p>}
        {leaderboard && leaderboard.length === 0 && (
          <p className="puzzle-leaderboard-empty">No times recorded yet — be the first!</p>
        )}
        {leaderboard && leaderboard.length > 0 && (
          <ol className="puzzle-leaderboard-list">
            {leaderboard.map((entry) => (
              <li key={`${entry.rank}-${entry.created_at}`} className="puzzle-leaderboard-entry">
                <span className="puzzle-leaderboard-rank">#{entry.rank}</span>
                <span className="puzzle-leaderboard-time">{formatSeconds(entry.elapsed_seconds)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  )
}
