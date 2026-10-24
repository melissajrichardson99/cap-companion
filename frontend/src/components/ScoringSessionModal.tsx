import { useEffect, useRef, useState } from 'react'
import { api, type GameScoreEvent, type MilestoneEvent, type ScoreSheetSession, type ScoringGame } from '../api'
import { MilestoneBanner } from './MilestoneBanner'
import { Modal } from './Modal'
import { ClipboardIcon } from './NavIcons'
import { ScoringPlayerSetup, validatePlayerInputs } from './ScoringPlayerSetup'
import { downloadSummary } from './scoringSummaryHtml'
import './ScoringSessionModal.css'

type ModalState = 'loading' | 'setup' | 'playing' | 'finished'

interface ScoringSessionModalProps {
  game: ScoringGame
  onClose: () => void
  onCoinsChanged: () => void
}

// Short, clearly-perceptible pause between a score button being tapped and
// the turn actually advancing -- long enough to register as confirmation,
// short enough not to slow the game down.
const TURN_ADVANCE_DELAY_MS = 700

// Current player plus the next `count` in the fixed turn order, wrapping
// (and repeating names, if there are fewer players than `count`) so the
// strip always shows a full queue.
function upcomingTurnOrder(players: string[], currentPlayer: string | null, count = 4): string[] {
  if (!currentPlayer || players.length === 0) return []
  const startIndex = players.indexOf(currentPlayer)
  if (startIndex === -1) return []
  return Array.from({ length: count }, (_, i) => players[(startIndex + i) % players.length])
}

// Every win type except first_to_bonus_round is monotonically final -- once
// the pure win check says "won", nothing that happens next can undo it, so
// the modal can jump straight to the finished screen. first_to_bonus_round
// (Horse Hoops) can't auto-finish: a "won" reading there is provisional,
// since only one player's total changes per entry, so whoever crosses the
// threshold first always looks like a sole leader for an instant even when
// the other team is about to tie it. That game type stays in the 'playing'
// view with a "Finish Game" button so a genuinely tying score still has a
// chance to arrive (see the matching comment in scoring_sheet.py).
function autoFinishesOnWin(game: ScoringGame): boolean {
  return game.win_condition_type !== 'first_to_bonus_round'
}

function tieBannerText(session: ScoreSheetSession): string | null {
  if (session.status === 'tie_bonus_round') {
    const total = session.totals[session.tied_players[0]] ?? 0
    return `Tied at ${total} — ${session.tied_players.join(' & ')} head to a bonus round. Next point wins it.`
  }
  if (session.status === 'tie_round_pending') {
    return `Tied after round ${session.round_number} — ${session.tied_players.join(' & ')} play another round to settle it.`
  }
  return null
}

export function ScoringSessionModal({ game, onClose, onCoinsChanged }: ScoringSessionModalProps) {
  const [modalState, setModalState] = useState<ModalState>('loading')
  const [playerInputs, setPlayerInputs] = useState<string[]>(['', ''])
  const [session, setSession] = useState<ScoreSheetSession | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [entryError, setEntryError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // True during the brief confirmation beat between a tap and the turn
  // actually advancing -- disables every button in the current player's
  // panel so a second tap can't land mid-transition.
  const [advancing, setAdvancing] = useState(false)
  // Set for the same beat as `advancing` -- while non-null, it replaces the
  // action buttons entirely with a "significant moment" message instead of
  // showing a small confirmation line alongside them.
  const [turnResult, setTurnResult] = useState<{ playerName: string; event: GameScoreEvent } | null>(null)
  const [finishing, setFinishing] = useState(false)
  // Dramatic win/tie moment (reuses Bingo's MilestoneBanner) shown once the
  // game has actually ended, before the result screen. modalState stays
  // 'playing' while this is up -- see recordScore/finishGame below.
  const [resultAnimation, setResultAnimation] = useState<MilestoneEvent | null>(null)
  const advanceTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (advanceTimeoutRef.current !== null) window.clearTimeout(advanceTimeoutRef.current)
    }
  }, [])

  // Resume: the session lives on the backend per device, but this modal
  // used to hold its id only in React state, so a reload dropped back to
  // player setup and orphaned the game in progress. Ask for this device's
  // unfinished session of the game first (same lookup as stroke play).
  // A provisional Horse Hoops win isn't completed yet, so it resumes into
  // 'playing' with its Finish Game button, as before the reload.
  useEffect(() => {
    let cancelled = false
    api
      .getActiveScoreSheetSession(game.id)
      .then((active) => {
        if (cancelled) return
        if (active) {
          setSession(active)
          setModalState('playing')
        } else {
          setModalState('setup')
        }
      })
      .catch((err) => {
        if (cancelled) return
        setSetupError(`Couldn't check for a game in progress: ${String(err)}`)
        setModalState('setup')
      })
    return () => {
      cancelled = true
    }
  }, [game.id])

  const startSession = async () => {
    const validated = validatePlayerInputs(playerInputs)
    if ('error' in validated) {
      setSetupError(validated.error)
      return
    }
    const { players } = validated
    setCreating(true)
    setSetupError(null)
    try {
      const created = await api.createScoreSheetSession(game.id, players)
      setSession(created)
      setModalState(created.status === 'won' && autoFinishesOnWin(game) ? 'finished' : 'playing')
    } catch (err) {
      setSetupError(String(err))
    } finally {
      setCreating(false)
    }
  }

  const recordScore = async (event: GameScoreEvent) => {
    if (!session || advancing || !session.current_player) return
    const playerName = session.current_player
    setAdvancing(true)
    setEntryError(null)
    try {
      const updated = await api.recordScoreEntry(session.id, playerName, event.id)
      setTurnResult({ playerName, event })
      advanceTimeoutRef.current = window.setTimeout(() => {
        setSession(updated)
        setAdvancing(false)
        setTurnResult(null)
        if (updated.status === 'won' && autoFinishesOnWin(game)) {
          setResultAnimation({ type: 'blackout', message: `🏆 ${updated.winner} wins!`, tile_ids: [], coins_awarded: 0 })
          onCoinsChanged()
        }
      }, TURN_ADVANCE_DELAY_MS)
    } catch (err) {
      setEntryError(String(err))
      setAdvancing(false)
    }
  }

  const finishGame = async () => {
    if (!session) return
    setFinishing(true)
    setEntryError(null)
    try {
      const finished = await api.finishScoreSheetSession(session.id)
      setSession(finished)
      setResultAnimation({ type: 'blackout', message: `🏆 ${finished.winner} wins!`, tile_ids: [], coins_awarded: 0 })
      onCoinsChanged()
    } catch (err) {
      setEntryError(String(err))
    } finally {
      setFinishing(false)
    }
  }

  const handleResultAnimationDone = () => {
    setResultAnimation(null)
    setModalState('finished')
  }

  const startNewSession = () => {
    setSession(null)
    setPlayerInputs(['', ''])
    setSetupError(null)
    setEntryError(null)
    setTurnResult(null)
    setResultAnimation(null)
    setModalState('setup')
  }

  const title = (
    <h2 id="scoring-modal-title" className="scoring-modal-title">
      <span className="scoring-modal-icon-badge" aria-hidden="true">
        <ClipboardIcon />
      </span>
      {game.name}
    </h2>
  )

  if (modalState === 'loading') {
    return (
      <Modal onClose={onClose} labelledBy="scoring-modal-title" className="scoring-modal-frame">
        <div className="scoring-modal-inner">
          <div className="scoring-modal-scroll">
            {title}
            <p className="scoring-modal-rules">Checking for a game in progress…</p>
          </div>
        </div>
      </Modal>
    )
  }

  if (modalState === 'setup') {
    return (
      <Modal onClose={onClose} labelledBy="scoring-modal-title" className="scoring-modal-frame">
        <div className="scoring-modal-inner">
          <div className="scoring-modal-scroll">
            {title}
            <p className="scoring-modal-rules">{game.rules_text}</p>
            <p className="scoring-modal-win-condition">{game.win_condition_text}</p>

            <ScoringPlayerSetup
              playerInputs={playerInputs}
              onChange={setPlayerInputs}
              hint="Players take turns in the order entered below."
            />

            {setupError && <p className="screen-error">{setupError}</p>}

            <div className="scoring-modal-actions">
              <button type="button" className="btn btn-primary" disabled={creating} onClick={startSession}>
                {creating ? 'Starting…' : 'Begin Session'}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    )
  }

  if (!session) return null

  if (modalState === 'finished') {
    return (
      <Modal onClose={onClose} labelledBy="scoring-modal-title" className="scoring-modal-frame">
        <div className="scoring-modal-inner">
          <div className="scoring-modal-scroll">
            {title}
            <div className="scoring-win-banner">
              <span className="scoring-win-headline">🏆 {session.winner} wins!</span>
            </div>

            <table className="scoring-final-totals">
              <tbody>
                {session.players.map((player) => (
                  <tr key={player} className={player === session.winner ? 'scoring-final-totals-winner-row' : ''}>
                    <td>{player}</td>
                    <td className="scoring-final-totals-score">{session.totals[player] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="scoring-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => downloadSummary(game, session)}>
                Download Summary
              </button>
              <button type="button" className="btn btn-primary" onClick={startNewSession}>
                New Session
              </button>
            </div>
          </div>
        </div>
      </Modal>
    )
  }

  const tieMessage = tieBannerText(session)
  // current_player is null once the session has actually completed
  // (auto-finished or Finish Game already called) -- while resultAnimation
  // is up, modalState is still 'playing' but there's no live turn left to
  // show, so this also gates the turn-strip/action-panel/provisional-win
  // banner below from rendering stale "null's turn" content underneath it.
  const stillPlaying = session.current_player !== null
  const provisionalWin = !autoFinishesOnWin(game) && session.status === 'won' && stillPlaying
  const turnOrder = upcomingTurnOrder(session.players, session.current_player)
  const normalEvents = game.score_events.filter((event) => !event.is_miss)
  const missEvent = game.score_events.find((event) => event.is_miss)

  return (
    <Modal onClose={onClose} labelledBy="scoring-modal-title" className="scoring-modal-frame">
      <div className="scoring-modal-inner">
        <div className="scoring-modal-scroll">
          {title}

          {tieMessage && <p className="scoring-tie-banner">{tieMessage}</p>}
          {provisionalWin && (
            <div className="scoring-provisional-win-banner">
              <p className="scoring-provisional-win-text">🏆 {session.winner} leads with {session.totals[session.winner ?? '']}!</p>
              <button type="button" className="btn btn-primary" disabled={finishing} onClick={finishGame}>
                {finishing ? 'Finishing…' : 'Finish Game'}
              </button>
            </div>
          )}
          {game.throws_per_round && !tieMessage && stillPlaying && (
            <p className="scoring-round-status">Round {(session.round_number ?? 0) + 1} in progress</p>
          )}

          {stillPlaying && (
            <>
              <div className="scoring-turn-strip">
                {turnOrder.flatMap((player, i) => [
                  i > 0 && (
                    <span key={`arrow-${i}`} className="scoring-turn-arrow" aria-hidden="true">
                      →
                    </span>
                  ),
                  <span
                    key={`${player}-${i}`}
                    className={`scoring-turn-chip ${i === 0 ? 'scoring-turn-chip-current' : 'scoring-turn-chip-queued'}`}
                  >
                    {player}
                  </span>,
                ])}
              </div>

              <div className="scoring-current-player-panel">
                <div className="scoring-player-header">
                  <span className="scoring-player-name">{session.current_player}'s turn</span>
                  <span className="scoring-player-total">{session.totals[session.current_player ?? ''] ?? 0}</span>
                </div>
                {turnResult ? (
                  <div className="scoring-turn-result" role="status">
                    <p
                      className={`scoring-turn-result-text${turnResult.event.is_miss ? ' scoring-turn-result-miss' : ''}`}
                    >
                      {turnResult.event.is_miss
                        ? `Maybe next shot, ${turnResult.playerName}!`
                        : `${turnResult.playerName} scored ${turnResult.event.point_value} point${turnResult.event.point_value === 1 ? '' : 's'}!`}
                    </p>
                  </div>
                ) : (
                  <div className="scoring-event-buttons" data-game-slug={game.slug}>
                    {normalEvents.map((event) => (
                      <button
                        type="button"
                        key={event.id}
                        className="btn scoring-event-btn"
                        disabled={advancing}
                        onClick={() => recordScore(event)}
                      >
                        {event.label} (+{event.point_value})
                      </button>
                    ))}
                    {missEvent && (
                      <button
                        type="button"
                        key={missEvent.id}
                        className="btn scoring-event-btn scoring-miss-btn"
                        disabled={advancing}
                        onClick={() => recordScore(missEvent)}
                      >
                        Miss
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          <table className="scoring-running-scores">
            <tbody>
              {session.players.map((player) => (
                <tr key={player} className={player === session.current_player ? 'scoring-running-scores-current-row' : ''}>
                  <td>{player}</td>
                  <td className="scoring-final-totals-score">{session.totals[player] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {entryError && <p className="screen-error">{entryError}</p>}
        </div>
      </div>
      {resultAnimation && <MilestoneBanner event={resultAnimation} onDone={handleResultAnimationDone} />}
    </Modal>
  )
}
