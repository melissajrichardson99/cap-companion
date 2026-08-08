import type { BingoTile } from '../api'
import { Modal } from './Modal'
import { GridIcon } from './NavIcons'
import './BingoTileModal.css'

interface BingoTileModalProps {
  tile: BingoTile
  pending: boolean
  onClose: () => void
  onCompleteChallenge: () => void
}

// Step 1 of the redesigned tap flow (tech spec 4.1): tapping an open tile
// shows its challenge here without marking it complete -- only tapping
// "Completed Challenge" does that (and draws the base minigame).
export function BingoTileModal({ tile, pending, onClose, onCompleteChallenge }: BingoTileModalProps) {
  return (
    <Modal onClose={onClose} labelledBy="bingo-tile-modal-title" className="bingo-tile-modal-frame">
      <div className="bingo-tile-modal-inner">
        <h2 id="bingo-tile-modal-title" className="bingo-tile-modal-title">
          <span className="bingo-tile-modal-icon-badge" aria-hidden="true">
            <GridIcon />
          </span>
          Bingo Challenge
        </h2>
        <p className="bingo-tile-modal-description">{tile.label}</p>
        <div className="bingo-tile-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>
            Not Yet
          </button>
          <button type="button" className="btn btn-primary" onClick={onCompleteChallenge} disabled={pending}>
            {pending ? 'Saving…' : 'Completed Challenge'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
