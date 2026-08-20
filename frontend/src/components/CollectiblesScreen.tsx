import type { CoinsSummary } from '../api'
import { PAGE_SUBHEADERS } from '../pageSubheaderContent'
import { PawIcon } from './NavIcons'
import './CollectiblesScreen.css'

interface CollectiblesScreenProps {
  summary: CoinsSummary | null
  error: string | null
  onReload: () => void
}

export function CollectiblesScreen({ summary, error, onReload }: CollectiblesScreenProps) {
  if (error) {
    return (
      <div className="collectibles-screen">
        <p className="screen-error">Couldn't load collectibles: {error}</p>
        <button type="button" className="btn btn-secondary" onClick={onReload}>
          Retry
        </button>
      </div>
    )
  }

  if (!summary) {
    return <div className="collectibles-screen collectibles-loading">Loading collectibles…</div>
  }

  return (
    <div className="collectibles-screen">
      <h1 className="cap-sign-board">
        <PawIcon className="cap-sign-board-icon" />
        Collectibles
      </h1>
      <p className="cap-page-subheader">{PAGE_SUBHEADERS.collectibles}</p>

      <p className="collectibles-intro">
        Earn Cobb Coins by finishing Scavenger Hunt characters, Puzzle Timer challenges, Scoring Sheet wins, and
        Bingo tiles. Collect every badge!
      </p>
      <div className="collectibles-total">🪙 {summary.total} Cobb Coins earned</div>
      <div className="collectibles-grid">
        {summary.collectibles.map((collectible) => (
          <div
            key={collectible.id}
            className={`collectible-card cap-parchment-card ${collectible.unlocked ? 'collectible-unlocked' : 'collectible-locked'}`}
          >
            <span className="collectible-icon" aria-hidden="true">
              {collectible.unlocked ? collectible.icon : '🔒'}
            </span>
            <span className="collectible-name">{collectible.name}</span>
            <span className="collectible-status">
              {collectible.unlocked ? 'Unlocked' : `Unlock at ${collectible.unlock_threshold} coins`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
