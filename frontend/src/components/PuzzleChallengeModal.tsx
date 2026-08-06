import { useEffect, useRef, useState } from 'react'
import { api, type Puzzle, type PuzzleAttempt, type PuzzleChallenge } from '../api'
import { Modal } from './Modal'
import { formatSeconds } from './PuzzleScreen'
import './PuzzleChallengeModal.css'

type TimerState = 'idle' | 'running' | 'confirming' | 'result'

interface PuzzleChallengeModalProps {
  puzzle: Puzzle
  challenge: PuzzleChallenge
  onClose: () => void
}

const HINT_TIERS = ['hint_tier_1', 'hint_tier_2', 'hint_tier_3'] as const

function compareToStaffTime(elapsedSeconds: number, staffTimeSeconds: number): string {
  const diff = staffTimeSeconds - elapsedSeconds
  if (diff === 0) return 'Matched the staff time exactly.'
  const abs = Math.abs(diff)
  const unit = abs === 1 ? 'second' : 'seconds'
  return `${abs} ${unit} ${diff > 0 ? 'faster' : 'slower'} than staff time.`
}

export function PuzzleChallengeModal({ puzzle, challenge, onClose }: PuzzleChallengeModalProps) {
  const [timerState, setTimerState] = useState<TimerState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [finalElapsedSeconds, setFinalElapsedSeconds] = useState(0)
  const startedAtRef = useRef(0)

  const [hintsRevealed, setHintsRevealed] = useState(0)
  const [attemptError, setAttemptError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [resultAttempt, setResultAttempt] = useState<PuzzleAttempt | null>(null)

  useEffect(() => {
    if (timerState !== 'running') return
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200)
    return () => clearInterval(id)
  }, [timerState])

  const start = () => {
    startedAtRef.current = Date.now()
    setElapsedMs(0)
    setHintsRevealed(0)
    setAttemptError(null)
    setTimerState('running')
  }

  const stop = () => {
    setFinalElapsedSeconds(Math.max(1, Math.round(elapsedMs / 1000)))
    setTimerState('confirming')
  }

  const backToStart = () => {
    setTimerState('idle')
    setElapsedMs(0)
    setHintsRevealed(0)
    setAttemptError(null)
    setResultAttempt(null)
  }

  const answerCompleted = async (didComplete: boolean) => {
    if (!didComplete) {
      backToStart()
      return
    }
    setRecording(true)
    setAttemptError(null)
    try {
      const attempt = await api.recordPuzzleAttempt(challenge.id, finalElapsedSeconds, hintsRevealed)
      setResultAttempt(attempt)
      setTimerState('result')
    } catch (err) {
      setAttemptError(String(err))
    } finally {
      setRecording(false)
    }
  }

  const hintText = (tier: (typeof HINT_TIERS)[number]) => challenge[tier]
  const hasHints = challenge.solution_type !== 'none'
  const finalTierLabel = challenge.solution_type === 'exact' ? 'Full Solution' : 'Full Strategy'

  if (timerState === 'confirming') {
    return (
      <Modal onClose={onClose} labelledBy="puzzle-challenge-title">
        <h2 id="puzzle-challenge-title" className="puzzle-modal-title">
          {puzzle.name} — {challenge.label}
        </h2>
        <p className="puzzle-confirm-question">Did you complete the puzzle?</p>
        <div className="puzzle-modal-actions">
          <button type="button" className="btn btn-secondary" disabled={recording} onClick={() => answerCompleted(false)}>
            No
          </button>
          <button type="button" className="btn btn-primary" disabled={recording} onClick={() => answerCompleted(true)}>
            Yes
          </button>
        </div>
        {recording && <p className="puzzle-timer-status">Saving…</p>}
        {attemptError && <p className="screen-error">Couldn't save that attempt: {attemptError}</p>}
      </Modal>
    )
  }

  if (timerState === 'result' && resultAttempt) {
    const staffTime = challenge.staff_time_seconds
    return (
      <Modal onClose={onClose} labelledBy="puzzle-challenge-title">
        <h2 id="puzzle-challenge-title" className="puzzle-modal-title">
          {puzzle.name} — {challenge.label}
        </h2>
        <div className="puzzle-result">
          <span className="puzzle-result-time">{formatSeconds(resultAttempt.elapsed_seconds)}</span>
          {staffTime !== null ? (
            <p className="puzzle-result-comparison">{compareToStaffTime(resultAttempt.elapsed_seconds, staffTime)}</p>
          ) : (
            <p className="puzzle-result-no-staff-time">No staff time set for this one yet.</p>
          )}
          <p className="puzzle-result-hints">Hints used: {resultAttempt.hints_used}/3</p>
        </div>
        <div className="puzzle-modal-actions">
          <button type="button" className="btn btn-primary" onClick={backToStart}>
            Try Again
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} labelledBy="puzzle-challenge-title">
      <h2 id="puzzle-challenge-title" className="puzzle-modal-title">
        {puzzle.name} — {challenge.label}
      </h2>
      <p className="puzzle-modal-rules">{puzzle.rules_text}</p>
      {timerState === 'idle' && <p className="puzzle-modal-description">{challenge.description}</p>}

      <div className="puzzle-timer">
        <span className="puzzle-timer-display">{formatSeconds(Math.round(elapsedMs / 1000))}</span>
        <div className="puzzle-timer-controls">
          {timerState !== 'running' ? (
            <button type="button" className="btn btn-primary" onClick={start}>
              Start
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={stop}>
              Stop
            </button>
          )}
        </div>
      </div>

      {hasHints && timerState === 'running' && (
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
    </Modal>
  )
}
