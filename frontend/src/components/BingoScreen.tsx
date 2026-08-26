import { useState } from 'react'
import { api, type BingoCard, type BingoTile, type MilestoneEvent, type Minigame, type TileCompletionResult } from '../api'
import { BINGO_MILESTONE_EXAMPLES, bingoMilestoneRewardLines } from '../bingoMilestoneContent'
import { PAGE_SUBHEADERS } from '../pageSubheaderContent'
import { BingoTileModal } from './BingoTileModal'
import { MilestoneBanner } from './MilestoneBanner'
import { GridIcon } from './NavIcons'
import './BingoScreen.css'

interface BingoScreenProps {
  card: BingoCard | null
  error: string | null
  onReload: () => void
  onTileResult: (result: TileCompletionResult) => void
  milestoneQueue: MilestoneEvent[]
  onMilestoneShown: () => void
  pendingMilestoneMinigame: Minigame | null
  onPlayMilestoneMinigame: () => void
}

export function BingoScreen({
  card,
  error,
  onReload,
  onTileResult,
  milestoneQueue,
  onMilestoneShown,
  pendingMilestoneMinigame,
  onPlayMilestoneMinigame,
}: BingoScreenProps) {
  const [selectedTile, setSelectedTile] = useState<BingoTile | null>(null)
  const [completingTileId, setCompletingTileId] = useState<string | null>(null)

  if (error) {
    return (
      <div className="bingo-screen">
        <p className="screen-error">Couldn't load the Bingo card: {error}</p>
        <button type="button" className="btn btn-secondary" onClick={onReload}>
          Retry
        </button>
      </div>
    )
  }

  if (!card) {
    return <div className="bingo-screen bingo-loading">Loading Bingo card…</div>
  }

  const activeMilestone = milestoneQueue[0] ?? null
  const highlightIndex = new Map<string, number>()
  activeMilestone?.tile_ids.forEach((id, i) => highlightIndex.set(id, i))

  const tiles = [...card.tiles].sort((a, b) => a.row * 5 + a.col - (b.row * 5 + b.col))

  const completeChallenge = async (tileId: string) => {
    if (completingTileId) return
    setCompletingTileId(tileId)
    try {
      const result = await api.completeTile(tileId)
      onTileResult(result)
      setSelectedTile(null)
    } catch (err) {
      console.error(err)
    } finally {
      setCompletingTileId(null)
    }
  }

  return (
    <div className="bingo-screen">
      <div className="bingo-foliage bingo-foliage-bottom-left-lower" aria-hidden="true" />
      <div className="bingo-foliage bingo-foliage-bottom-center" aria-hidden="true" />
      <div className="bingo-foliage bingo-foliage-bottom-right" aria-hidden="true" />
      <h1 className="cap-sign-board">
        <GridIcon className="cap-sign-board-icon" />
        Bingo Card
      </h1>
      <p className="cap-page-subheader">{PAGE_SUBHEADERS.bingo}</p>

      <div className="bingo-content">
        <div className="bingo-grid">
          {tiles.map((tile) => {
            const shapeIndex = highlightIndex.get(tile.id)
            const isHighlighted = shapeIndex !== undefined
            const classes = ['bingo-tile']
            classes.push(tile.completed ? 'bingo-tile-completed' : 'bingo-tile-open')
            if (isHighlighted && activeMilestone) classes.push(`bingo-tile-milestone-${activeMilestone.type}`)

            return (
              <button
                type="button"
                key={tile.id}
                className={classes.join(' ')}
                style={isHighlighted ? { animationDelay: `${shapeIndex! * 0.05}s` } : undefined}
                disabled={completingTileId !== null}
                onClick={() => setSelectedTile(tile)}
                aria-label={tile.label}
              >
                <span className="bingo-tile-icon" aria-hidden="true">
                  {tile.completed && <span className="bingo-tile-stamp" aria-hidden="true">✓</span>}
                </span>
                <span className="bingo-tile-label">{tile.label}</span>
              </button>
            )
          })}
        </div>

        {/* Only offered once no milestone banner is showing -- the banner
            (below) always takes precedence, so this never competes with it. */}
        {!activeMilestone && pendingMilestoneMinigame && (
          <div className="bingo-milestone-prompt">
            <p className="bingo-milestone-prompt-text">Celebrate your milestone with a bonus minigame!</p>
            <button type="button" className="btn btn-primary" onClick={onPlayMilestoneMinigame}>
              Play Bonus Minigame
            </button>
          </div>
        )}
      </div>

      <section className="bingo-milestones-card cap-parchment-card">
        <h2 className="cap-section-title">Bingo Milestones</h2>
        <p className="bingo-milestones-subtitle">Complete these milestones to earn extra rewards!</p>
        <div className="bingo-milestones-grid">
          {BINGO_MILESTONE_EXAMPLES.map((example) => (
            <div className="bingo-milestone-example" key={example.type}>
              <div className={`bingo-milestone-diagram bingo-milestone-diagram-${example.type}`} aria-hidden="true">
                {Array.from({ length: 25 }, (_, i) => (
                  <span
                    key={i}
                    className={
                      example.filledTiles.has(i)
                        ? 'bingo-milestone-diagram-dot bingo-milestone-diagram-dot-filled'
                        : 'bingo-milestone-diagram-dot'
                    }
                  />
                ))}
              </div>
              <h3 className="bingo-milestone-example-label">{example.label}</h3>
              <p className="bingo-milestone-example-desc">{example.description}</p>
              <span className="bingo-milestone-example-reward">
                {bingoMilestoneRewardLines(example.type).map((line) => (
                  <span key={line} className="bingo-milestone-example-reward-line">
                    {line}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </section>

      {selectedTile && (
        <BingoTileModal
          tile={selectedTile}
          pending={completingTileId === selectedTile.id}
          onClose={() => setSelectedTile(null)}
          onCompleteChallenge={() => completeChallenge(selectedTile.id)}
        />
      )}

      {activeMilestone && <MilestoneBanner event={activeMilestone} onDone={onMilestoneShown} />}
    </div>
  )
}
