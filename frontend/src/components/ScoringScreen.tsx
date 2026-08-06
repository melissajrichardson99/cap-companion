import { useState } from 'react'
import type { ScoringGame } from '../api'
import { ScoringSessionModal } from './ScoringSessionModal'
import './ScoringScreen.css'

interface ScoringScreenProps {
  games: ScoringGame[] | null
  error: string | null
  onReload: () => void
}

export function ScoringScreen({ games, error, onReload }: ScoringScreenProps) {
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
      <div className="scoring-game-list">
        {games.map((game) => (
          <div className="scoring-game-card" key={game.id}>
            <h2 className="scoring-game-name">{game.name}</h2>
            <p className="scoring-game-rules">{game.rules_text}</p>
            <p className="scoring-game-win-condition">{game.win_condition_text}</p>
            <button type="button" className="btn btn-primary" onClick={() => setActiveGame(game)}>
              Start Scoring
            </button>
          </div>
        ))}
      </div>

      {activeGame && <ScoringSessionModal game={activeGame} onClose={() => setActiveGame(null)} />}
    </div>
  )
}
