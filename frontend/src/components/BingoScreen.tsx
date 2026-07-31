import { useState } from 'react'
import { api, type BingoCard, type MilestoneEvent, type TileCompletionResult } from '../api'
import { MilestoneBanner } from './MilestoneBanner'
import './BingoScreen.css'

interface BingoScreenProps {
  card: BingoCard | null
  error: string | null
  onReload: () => void
  onTileResult: (result: TileCompletionResult) => void
  milestoneQueue: MilestoneEvent[]
  onMilestoneShown: () => void
}

export function BingoScreen({
  card,
  error,
  onReload,
  onTileResult,
  milestoneQueue,
  onMilestoneShown,
}: BingoScreenProps) {
  const [pendingTileIds, setPendingTileIds] = useState<Set<string>>(new Set())

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

  const completeTile = async (tileId: string) => {
    if (pendingTileIds.has(tileId)) return
    setPendingTileIds((prev) => new Set(prev).add(tileId))
    try {
      const result = await api.completeTile(tileId)
      onTileResult(result)
    } catch (err) {
      console.error(err)
    } finally {
      setPendingTileIds((prev) => {
        const next = new Set(prev)
        next.delete(tileId)
        return next
      })
    }
  }

  return (
    <div className="bingo-screen">
      <div className="bingo-header">
        <h2 className="bingo-owner">{card.owner_label}'s Card</h2>
        <div className="bingo-milestone-summary">
          {card.milestones_achieved.lines.map((lineIdx) => (
            <span key={lineIdx} className="milestone-chip milestone-chip-line">
              BINGO
            </span>
          ))}
          {card.milestones_achieved.x && <span className="milestone-chip milestone-chip-x">X</span>}
          {card.milestones_achieved.blackout && (
            <span className="milestone-chip milestone-chip-blackout">BLACKOUT</span>
          )}
        </div>
      </div>

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
              disabled={tile.completed || pendingTileIds.has(tile.id)}
              onClick={() => completeTile(tile.id)}
            >
              {tile.completed && <span className="bingo-tile-stamp" aria-hidden="true">✓</span>}
              <span className="bingo-tile-label">{tile.label}</span>
            </button>
          )
        })}
      </div>

      {activeMilestone && <MilestoneBanner event={activeMilestone} onDone={onMilestoneShown} />}
    </div>
  )
}
