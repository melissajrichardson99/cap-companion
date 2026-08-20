import { useState } from 'react'
import type { ScoringGame } from '../api'
import { PAGE_SUBHEADERS } from '../pageSubheaderContent'
import { ScoringSessionModal } from './ScoringSessionModal'
import { ClipboardIcon } from './NavIcons'
import './ScoringScreen.css'

interface ScoringScreenProps {
  games: ScoringGame[] | null
  error: string | null
  onReload: () => void
  onCoinsChanged: () => void
}

export function ScoringScreen({ games, error, onReload, onCoinsChanged }: ScoringScreenProps) {
  const [activeGame, setActiveGame] = useState<ScoringGame | null>(null)

  if (error) {
    return (
      <div className="scoring-screen">
        <p className="screen-error">Couldn't load the scoring games: {error}</p>
        <button type="button" className="btn btn-secondary" onClick={onReload}>
          Retry
        </button>
      </div>
    )
  }

  if (!games) {
    return <div className="scoring-screen scoring-loading">Loading games…</div>
  }

  return (
    <div className="scoring-screen">
      <div className="scoring-foliage scoring-foliage-bottom-left-lower" aria-hidden="true" />
      <div className="scoring-foliage scoring-foliage-bottom-center" aria-hidden="true" />
      <div className="scoring-foliage scoring-foliage-bottom-right" aria-hidden="true" />
      <h1 className="cap-sign-board">
        <ClipboardIcon className="cap-sign-board-icon" />
        Scoring Sheet
      </h1>
      <p className="cap-page-subheader">{PAGE_SUBHEADERS.scoring}</p>

      <div className="scoring-game-list">
        {games.map((game) => (
          <div className="scoring-game-card cap-parchment-card" key={game.id}>
            <div className="scoring-game-header">
              <span className="scoring-icon-badge" aria-hidden="true">
                <ClipboardIcon />
              </span>
              <h2 className="scoring-game-name">{game.name}</h2>
            </div>
            <p className="scoring-game-rules">{game.rules_text}</p>
            <p className="scoring-game-win-condition">{game.win_condition_text}</p>
            <button type="button" className="btn scoring-start-btn" onClick={() => setActiveGame(game)}>
              Start Scoring
            </button>
          </div>
        ))}
      </div>

      {activeGame && (
        <ScoringSessionModal game={activeGame} onClose={() => setActiveGame(null)} onCoinsChanged={onCoinsChanged} />
      )}
    </div>
  )
}
