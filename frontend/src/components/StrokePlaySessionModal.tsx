import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type MilestoneEvent, type ScoreSheetSession, type ScoringGame } from '../api'
import { MilestoneBanner } from './MilestoneBanner'
import { Modal } from './Modal'
import { ClipboardIcon } from './NavIcons'
import { ScoringPlayerSetup, validatePlayerInputs } from './ScoringPlayerSetup'
import { downloadSummary } from './scoringSummaryHtml'
import { StrokeScorecard } from './StrokeScorecard'
import { canSubmit, HIGH_STROKE_WARNING_ABOVE, pressDelete, pressDigit, strokesLabel } from './strokeKeypad'
import './ScoringSessionModal.css'
import './StrokePlaySessionModal.css'

// Stroke-play Scoring Sheet (mini golf, migration 043): a second mode next
// to the turn-based ScoringSessionModal, not a variant of it. Guided entry
// (hole by hole, each player in turn) on a keypad, a confirm step on every
// score, a scorecard grid for corrections, and lowest-total-wins results.
//
// Persistence: the round lives on the backend (score_sheet_sessions +
// stroke_play_scores, per device session). Opening the sheet asks for this
// device's unfinished round of the game and resumes at the next empty cell,
// so a reload, phone lock or app switch mid-round loses nothing.

type Phase = 'loading' | 'setup' | 'playing' | 'finished'
type View = 'entry' | 'scorecard'

// The cell being entered when it isn't simply the next empty one: a
// correction from the scorecard, or a step Back. returnTo is where to go
// once it's confirmed.
interface Target {
  hole: number
  player: string
  returnTo: View
}

// Confirm stays disabled this long after the confirm step appears, so a
// double tap on Enter can't confirm a score nobody has looked at.
const CONFIRM_ARM_DELAY_MS = 600

// Per-course accent within the shared wood/parchment chrome (same idea as
// the Hunt characters' data-hunt-character theming). Courses without an
// entry use the standard sunset-orange look.
const ACCENT_BY_SLUG: Record<string, string> = {
  'blacklight-mini-golf': 'blacklight',
}

interface StrokePlaySessionModalProps {
  game: ScoringGame
  onClose: () => void
  onCoinsChanged: () => void
}

function strokesAt(session: ScoreSheetSession, hole: number, player: string): number | null {
  return session.hole_scores.find((s) => s.hole_number === hole && s.player_name === player)?.strokes ?? null
}

// The cell before (hole, player) in guided order, or null on the very first.
function previousCell(players: string[], hole: number, player: string): { hole: number; player: string } | null {
  const index = (hole - 1) * players.length + players.indexOf(player)
  if (index <= 0) return null
  const prev = index - 1
  return { hole: Math.floor(prev / players.length) + 1, player: players[prev % players.length] }
}

export function StrokePlaySessionModal({ game, onClose, onCoinsChanged }: StrokePlaySessionModalProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [session, setSession] = useState<ScoreSheetSession | null>(null)
  const [playerInputs, setPlayerInputs] = useState<string[]>(['', ''])
  const [setupError, setSetupError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [entryError, setEntryError] = useState<string | null>(null)
  const [view, setView] = useState<View>('entry')
  const [target, setTarget] = useState<Target | null>(null)
  const [digits, setDigits] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [confirmArmed, setConfirmArmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resultAnimation, setResultAnimation] = useState<MilestoneEvent | null>(null)
  const armTimeoutRef = useRef<number | null>(null)

  const accent = ACCENT_BY_SLUG[game.slug]

  useEffect(() => {
    let cancelled = false
    api
      .getActiveScoreSheetSession(game.id)
      .then((active) => {
        if (cancelled) return
        if (active) {
          setSession(active)
          setPhase('playing')
        } else {
          setPhase('setup')
        }
      })
      .catch((err) => {
        if (cancelled) return
        setSetupError(`Couldn't check for a round in progress: ${String(err)}`)
        setPhase('setup')
      })
    return () => {
      cancelled = true
    }
  }, [game.id])

  useEffect(() => {
    return () => {
      if (armTimeoutRef.current !== null) window.clearTimeout(armTimeoutRef.current)
    }
  }, [])

  const startRound = async () => {
    const validated = validatePlayerInputs(playerInputs)
    if ('error' in validated) {
      setSetupError(validated.error)
      return
    }
    setCreating(true)
    setSetupError(null)
    try {
      const created = await api.createScoreSheetSession(game.id, validated.players)
      setSession(created)
      setTarget(null)
      setDigits('')
      setView('entry')
      setPhase('playing')
    } catch (err) {
      setSetupError(String(err))
    } finally {
      setCreating(false)
    }
  }

  const openCell = (hole: number, player: string, returnTo: View) => {
    if (!session) return
    const existing = strokesAt(session, hole, player)
    setTarget({ hole, player, returnTo })
    setDigits(existing === null ? '' : String(existing))
    setConfirming(false)
    setEntryError(null)
    setView('entry')
  }

  const enter = () => {
    if (!canSubmit(digits)) return
    setConfirming(true)
    setConfirmArmed(false)
    if (armTimeoutRef.current !== null) window.clearTimeout(armTimeoutRef.current)
    armTimeoutRef.current = window.setTimeout(() => setConfirmArmed(true), CONFIRM_ARM_DELAY_MS)
  }

  const change = () => {
    setConfirming(false)
    setConfirmArmed(false)
  }

  const confirm = async (hole: number, player: string) => {
    if (!session || !confirmArmed || saving) return
    setSaving(true)
    setEntryError(null)
    try {
      const updated = await api.recordHoleScore(session.id, player, hole, Number(digits))
      const returnTo = target?.returnTo ?? 'entry'
      setSession(updated)
      setTarget(null)
      setDigits('')
      setConfirming(false)
      setConfirmArmed(false)
      setView(returnTo)
      if (updated.completed_at) {
        const message =
          updated.winners.length > 1 ? `🏆 It's a tie! ${updated.winner} share the win!` : `🏆 ${updated.winner} wins!`
        setResultAnimation({ type: 'blackout', message, tile_ids: [], coins_awarded: 0 })
        onCoinsChanged()
      }
    } catch (err) {
      setEntryError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleResultAnimationDone = useCallback(() => {
    setResultAnimation(null)
    setPhase('finished')
  }, [])

  const startNewRound = () => {
    setSession(null)
    setPlayerInputs(['', ''])
    setSetupError(null)
    setEntryError(null)
    setTarget(null)
    setDigits('')
    setView('entry')
    setPhase('setup')
  }

  const title = (
    <h2 id="scoring-modal-title" className="scoring-modal-title">
      <span className="scoring-modal-icon-badge" aria-hidden="true">
        <ClipboardIcon />
      </span>
      {game.name}
    </h2>
  )

  const frame = (children: ReactNode, overlay?: ReactNode) => (
    <Modal onClose={onClose} labelledBy="scoring-modal-title" className="scoring-modal-frame">
      <div className="scoring-modal-inner stroke-play" data-scoring-accent={accent}>
        <div className="scoring-modal-scroll">
          {title}
          {children}
        </div>
      </div>
      {overlay}
    </Modal>
  )

  if (phase === 'loading') {
    return frame(<p className="stroke-loading">Checking for a round in progress…</p>)
  }

  if (phase === 'setup') {
    return frame(
      <>
        <p className="scoring-modal-rules">{game.rules_text}</p>
        <p className="scoring-modal-win-condition">
          {game.hole_count} holes. {game.win_condition_text}
        </p>
        <ScoringPlayerSetup
          playerInputs={playerInputs}
          onChange={setPlayerInputs}
          hint="Players enter their strokes in the order below, hole by hole."
        />
        {setupError && <p className="screen-error">{setupError}</p>}
        <div className="scoring-modal-actions">
          <button type="button" className="btn btn-primary" disabled={creating} onClick={startRound}>
            {creating ? 'Starting…' : 'Begin Round'}
          </button>
        </div>
      </>,
    )
  }

  if (!session) return null

  if (phase === 'finished') {
    const tie = session.winners.length > 1
    return frame(
      <>
        <div className="scoring-win-banner">
          <span className="scoring-win-headline">
            {tie ? `🏆 Tie! ${session.winner} share the win` : `🏆 ${session.winner} wins!`}
          </span>
        </div>
        <p className="stroke-result-note">
          Lowest total wins{tie ? ` — tied at ${session.totals[session.winners[0]]} strokes.` : '.'}
        </p>
        <StrokeScorecard session={session} />
        <div className="scoring-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={() => downloadSummary(game, session)}>
            Download Summary
          </button>
          <button type="button" className="btn btn-primary" onClick={startNewRound}>
            New Round
          </button>
        </div>
      </>,
    )
  }

  const overlay = resultAnimation && <MilestoneBanner event={resultAnimation} onDone={handleResultAnimationDone} />
  const holeCount = session.hole_count ?? 0

  // Locked (finished) but the result animation is still up: nothing left to enter.
  if (session.completed_at) {
    return frame(<StrokeScorecard session={session} />, overlay)
  }

  const cell = target ?? { hole: session.current_hole ?? 1, player: session.current_player ?? session.players[0] }
  const prev = previousCell(session.players, cell.hole, cell.player)
  const isCorrection = strokesAt(session, cell.hole, cell.player) !== null
  const value = Number(digits)
  // Holes every player has finished -- what the Leader badge is judged on
  // (the backend's leaders), so a mid-hole total doesn't look misleading.
  const holesEveryoneFinished = Array.from({ length: holeCount }, (_, i) => i + 1).filter((h) =>
    session.players.every((p) => strokesAt(session, h, p) !== null),
  ).length

  const runningTotals = (
    <table className="scoring-running-scores stroke-running-totals">
      {session.leaders.length > 0 && (
        <caption className="stroke-leader-caption">
          Leader after hole {holesEveryoneFinished}
          {session.leaders.length > 1 ? ' (tied)' : ''}
        </caption>
      )}
      <tbody>
        {session.players.map((player) => (
          <tr key={player} className={player === cell.player ? 'scoring-running-scores-current-row' : ''}>
            <td>
              {player}
              {session.leaders.includes(player) && <span className="stroke-leader-badge">Leader</span>}
            </td>
            <td className="scoring-final-totals-score">{session.totals[player] ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  if (view === 'scorecard') {
    return frame(
      <>
        <p className="stroke-scorecard-hint">Tap a score to correct it.</p>
        <StrokeScorecard
          session={session}
          currentHole={session.current_hole}
          onCellTap={(hole, player) => openCell(hole, player, 'scorecard')}
        />
        <div className="scoring-modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setTarget(null)
              setDigits('')
              setConfirming(false)
              setView('entry')
            }}
          >
            Back to Entry
          </button>
        </div>
        {entryError && <p className="screen-error">{entryError}</p>}
      </>,
      overlay,
    )
  }

  return frame(
    <>
      <div className="stroke-entry-header">
        <p className="stroke-hole-label">
          Hole {cell.hole} of {holeCount}
        </p>
        <p className="stroke-player-label">{cell.player}</p>
        {isCorrection && <p className="stroke-correction-note">Correcting an earlier score</p>}
      </div>

      {confirming ? (
        <div className="stroke-confirm" role="group" aria-label="Confirm score">
          <p className="stroke-confirm-text">
            {/* Reads "Alex, hole 3: 4 strokes. Correct?" -- only the number is
                set large, on its own line. */}
            {cell.player}, hole {cell.hole}: <span className="stroke-confirm-value">{value}</span>{' '}
            {strokesLabel(value).replace(/^\d+ /, '')}. Correct?
          </p>
          {value > HIGH_STROKE_WARNING_ABOVE && (
            <p className="stroke-confirm-warning">That's a lot of strokes, is that right?</p>
          )}
          <div className="stroke-confirm-actions">
            <button type="button" className="btn btn-secondary stroke-big-btn" disabled={saving} onClick={change}>
              Change
            </button>
            <button
              type="button"
              className="btn btn-primary stroke-big-btn stroke-confirm-btn"
              disabled={!confirmArmed || saving}
              onClick={() => confirm(cell.hole, cell.player)}
            >
              {saving ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="stroke-display" aria-live="polite" aria-label="Strokes entered">
            {digits === '' ? <span className="stroke-display-empty">–</span> : digits}
          </div>
          <div className="stroke-keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} type="button" className="btn stroke-key" onClick={() => setDigits((cur) => pressDigit(cur, d))}>
                {d}
              </button>
            ))}
            <button
              type="button"
              className="btn stroke-key stroke-key-delete"
              aria-label="Delete"
              disabled={digits === ''}
              onClick={() => setDigits(pressDelete)}
            >
              ⌫
            </button>
            <button type="button" className="btn stroke-key" onClick={() => setDigits((cur) => pressDigit(cur, '0'))}>
              0
            </button>
            <button
              type="button"
              className="btn stroke-key stroke-key-enter"
              disabled={!canSubmit(digits)}
              onClick={enter}
            >
              Enter
            </button>
          </div>
        </>
      )}

      <div className="stroke-nav">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!prev || saving}
          onClick={() => prev && openCell(prev.hole, prev.player, 'entry')}
        >
          ← Back
        </button>
        {target && target.returnTo === 'entry' && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setTarget(null)
              setDigits('')
              setConfirming(false)
            }}
          >
            Resume
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => setView('scorecard')}>
          Scorecard
        </button>
      </div>

      {entryError && <p className="screen-error">{entryError}</p>}
      {runningTotals}
    </>,
    overlay,
  )
}
