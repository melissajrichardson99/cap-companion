import { useState } from 'react'
import { api, type GameScoreEvent, type ScoreSheetSession, type ScoringGame } from '../api'
import { Modal } from './Modal'
import './ScoringSessionModal.css'

type ModalState = 'setup' | 'playing' | 'finished'

interface ScoringSessionModalProps {
  game: ScoringGame
  onClose: () => void
}

function buildSummaryText(game: ScoringGame, session: ScoreSheetSession): string {
  const lines: string[] = []
  lines.push(`Cobb's Adventure Park — ${game.name}`)
  lines.push(`Players: ${session.players.join(', ')}`)
  lines.push(`Started: ${new Date(session.created_at).toLocaleString()}`)
  if (session.completed_at) {
    lines.push(`Finished: ${new Date(session.completed_at).toLocaleString()}`)
  }
  lines.push('')
  lines.push('Final Score:')
  for (const player of session.players) {
    lines.push(`  ${player}: ${session.totals[player] ?? 0}`)
  }
  lines.push('')
  lines.push(session.winner ? `Winner: ${session.winner}` : 'No winner yet.')
  if (session.entries.length > 0) {
    lines.push('')
    lines.push('Score Log:')
    for (const entry of session.entries) {
      const time = new Date(entry.created_at).toLocaleTimeString()
      lines.push(`  ${time}  ${entry.player_name} — ${entry.label} (+${entry.point_value})`)
    }
  }
  return lines.join('\n')
}

function downloadSummary(game: ScoringGame, session: ScoreSheetSession) {
  const text = buildSummaryText(game, session)
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${game.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-score-sheet.txt`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
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

export function ScoringSessionModal({ game, onClose }: ScoringSessionModalProps) {
  const [modalState, setModalState] = useState<ModalState>('setup')
  const [playerInputs, setPlayerInputs] = useState<string[]>(['', ''])
  const [session, setSession] = useState<ScoreSheetSession | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [entryError, setEntryError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [recordingKey, setRecordingKey] = useState<string | null>(null)
  const [lastEntryMessage, setLastEntryMessage] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)

  const updatePlayerField = (index: number, value: string) => {
    setPlayerInputs((prev) => prev.map((v, i) => (i === index ? value : v)))
  }

  const addPlayerField = () => setPlayerInputs((prev) => [...prev, ''])

  const removePlayerField = (index: number) => {
    setPlayerInputs((prev) => prev.filter((_, i) => i !== index))
  }

  const startSession = async () => {
    const players = playerInputs.map((p) => p.trim()).filter((p) => p.length > 0)
    if (players.length === 0) {
      setSetupError('Enter at least one player name.')
      return
    }
    if (new Set(players).size !== players.length) {
      setSetupError('Player names must be unique.')
      return
    }
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

  const recordScore = async (playerName: string, event: GameScoreEvent) => {
    if (!session) return
    const key = `${playerName}::${event.id}`
    setRecordingKey(key)
    setEntryError(null)
    try {
      const updated = await api.recordScoreEntry(session.id, playerName, event.id)
      setSession(updated)
      setLastEntryMessage(`+${event.point_value} for ${playerName} — ${event.label}`)
      if (updated.status === 'won' && autoFinishesOnWin(game)) setModalState('finished')
    } catch (err) {
      setEntryError(String(err))
    } finally {
      setRecordingKey(null)
    }
  }

  const finishGame = async () => {
    if (!session) return
    setFinishing(true)
    setEntryError(null)
    try {
      const finished = await api.finishScoreSheetSession(session.id)
      setSession(finished)
      setModalState('finished')
    } catch (err) {
      setEntryError(String(err))
    } finally {
      setFinishing(false)
    }
  }

  const startNewSession = () => {
    setSession(null)
    setPlayerInputs(['', ''])
    setSetupError(null)
    setEntryError(null)
    setLastEntryMessage(null)
    setModalState('setup')
  }

  if (modalState === 'setup') {
    return (
      <Modal onClose={onClose} labelledBy="scoring-modal-title">
        <h2 id="scoring-modal-title" className="scoring-modal-title">
          {game.name}
        </h2>
        <p className="scoring-modal-rules">{game.rules_text}</p>
        <p className="scoring-modal-win-condition">{game.win_condition_text}</p>

        <div className="scoring-setup">
          <h3 className="scoring-section-title">Players</h3>
          {playerInputs.map((value, i) => (
            <div className="scoring-player-input-row" key={i}>
              <input
                type="text"
                className="scoring-player-input"
                placeholder={`Player ${i + 1} name`}
                value={value}
                onChange={(e) => updatePlayerField(i, e.target.value)}
              />
              {playerInputs.length > 1 && (
                <button
                  type="button"
                  className="btn btn-secondary scoring-remove-player-btn"
                  aria-label={`Remove player ${i + 1}`}
                  onClick={() => removePlayerField(i)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={addPlayerField}>
            Add Player
          </button>
        </div>

        {setupError && <p className="screen-error">{setupError}</p>}

        <div className="scoring-modal-actions">
          <button type="button" className="btn btn-primary" disabled={creating} onClick={startSession}>
            {creating ? 'Starting…' : 'Begin Session'}
          </button>
        </div>
      </Modal>
    )
  }

  if (!session) return null

  if (modalState === 'finished') {
    return (
      <Modal onClose={onClose} labelledBy="scoring-modal-title">
        <h2 id="scoring-modal-title" className="scoring-modal-title">
          {game.name}
        </h2>
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
      </Modal>
    )
  }

  const tieMessage = tieBannerText(session)
  const provisionalWin = !autoFinishesOnWin(game) && session.status === 'won'

  return (
    <Modal onClose={onClose} labelledBy="scoring-modal-title">
      <h2 id="scoring-modal-title" className="scoring-modal-title">
        {game.name}
      </h2>

      {tieMessage && <p className="scoring-tie-banner">{tieMessage}</p>}
      {provisionalWin && (
        <div className="scoring-provisional-win-banner">
          <p className="scoring-provisional-win-text">🏆 {session.winner} leads with {session.totals[session.winner ?? '']}!</p>
          <button type="button" className="btn btn-primary" disabled={finishing} onClick={finishGame}>
            {finishing ? 'Finishing…' : 'Finish Game'}
          </button>
        </div>
      )}
      {game.throws_per_round && !tieMessage && (
        <p className="scoring-round-status">Round {(session.round_number ?? 0) + 1} in progress</p>
      )}

      <div className="scoring-players">
        {session.players.map((player) => (
          <div className="scoring-player-row" key={player}>
            <div className="scoring-player-header">
              <span className="scoring-player-name">{player}</span>
              <span className="scoring-player-total">{session.totals[player] ?? 0}</span>
            </div>
            <div className="scoring-event-buttons">
              {game.score_events.map((event) => {
                const key = `${player}::${event.id}`
                return (
                  <button
                    type="button"
                    key={event.id}
                    className="btn scoring-event-btn"
                    disabled={recordingKey !== null}
                    onClick={() => recordScore(player, event)}
                  >
                    {recordingKey === key ? '…' : `${event.label} (+${event.point_value})`}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {lastEntryMessage && <p className="scoring-last-entry">Last: {lastEntryMessage}</p>}
      {entryError && <p className="screen-error">{entryError}</p>}
    </Modal>
  )
}
