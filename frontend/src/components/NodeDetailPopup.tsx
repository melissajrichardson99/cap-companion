import { useState } from 'react'
import { api, type LinkedTile, type MapNode, type VisitNodeResponse } from '../api'
import { Modal } from './Modal'
import './NodeDetailPopup.css'

const CATEGORY_LABEL: Record<MapNode['category'], string> = {
  attraction: 'Attraction',
  animal: 'Animal Habitat',
  service: 'Service',
  food: 'Food & Store',
  seasonal: 'Seasonal',
}

const STATE_LABEL: Record<MapNode['state'], string> = {
  not_visited: 'Not Visited',
  visited: 'Visited',
  closed: 'Closed',
}

interface NodeDetailPopupProps {
  node: MapNode
  onClose: () => void
  onVisitResult: (result: VisitNodeResponse) => void
}

// Drives tech spec 4.3: tapping a node shows detail + uncompleted-linked-tile
// count; marking it visited walks each uncompleted linked tile one at a time
// ("did you complete X here?") before finalizing the visited state. Replaces
// the old confirm()-loop with a real step-through popup.
export function NodeDetailPopup({ node, onClose, onVisitResult }: NodeDetailPopupProps) {
  const [step, setStep] = useState<'detail' | 'confirming' | 'submitting'>('detail')
  const [queue, setQueue] = useState<LinkedTile[]>([])
  const [queueIndex, setQueueIndex] = useState(0)
  const [confirmedIds, setConfirmedIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const uncompletedTiles = node.linked_tiles.filter((t) => !t.completed)

  const submit = async (finalConfirmedIds: string[]) => {
    setStep('submitting')
    setError(null)
    try {
      const result = await api.visitNode(node.id, finalConfirmedIds)
      onVisitResult(result)
      onClose()
    } catch (err) {
      setError(String(err))
      setStep('detail')
    }
  }

  const startMarkVisited = () => {
    if (uncompletedTiles.length === 0) {
      void submit([])
      return
    }
    setQueue(uncompletedTiles)
    setQueueIndex(0)
    setConfirmedIds([])
    setStep('confirming')
  }

  const answerTile = (didComplete: boolean) => {
    const nextConfirmed = didComplete ? [...confirmedIds, queue[queueIndex].id] : confirmedIds
    const nextIndex = queueIndex + 1
    if (nextIndex >= queue.length) {
      setConfirmedIds(nextConfirmed)
      void submit(nextConfirmed)
      return
    }
    setConfirmedIds(nextConfirmed)
    setQueueIndex(nextIndex)
  }

  if (step === 'confirming' || step === 'submitting') {
    const tile = queue[queueIndex]
    return (
      <Modal onClose={onClose} labelledBy="tile-confirm-heading">
        <h2 id="tile-confirm-heading" className="popup-heading">
          {node.name}
        </h2>
        <p className="tile-confirm-progress">
          Tile {queueIndex + 1} of {queue.length}
        </p>
        <p className="tile-confirm-question">Did you complete &ldquo;{tile.label}&rdquo; here?</p>
        <div className="popup-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={step === 'submitting'}
            onClick={() => answerTile(false)}
          >
            No
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={step === 'submitting'}
            onClick={() => answerTile(true)}
          >
            Yes
          </button>
        </div>
        {step === 'submitting' && <p className="popup-status">Saving…</p>}
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} labelledBy="node-detail-heading">
      <div className="popup-header-row">
        <h2 id="node-detail-heading" className="popup-heading">
          {node.name}
        </h2>
        <span className={`state-pill state-pill-${node.state}`}>{STATE_LABEL[node.state]}</span>
      </div>
      <p className="popup-category">{CATEGORY_LABEL[node.category]}</p>
      <p className="popup-description">{node.description}</p>

      {node.linked_tiles.length > 0 && (
        <p className="popup-tile-count">
          {uncompletedTiles.length > 0
            ? `${uncompletedTiles.length} uncompleted Bingo tile${uncompletedTiles.length === 1 ? '' : 's'} linked here`
            : 'All linked Bingo tiles already completed'}
        </p>
      )}

      {error && <p className="popup-error">{error}</p>}

      <div className="popup-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
        {node.state === 'not_visited' && (
          <button type="button" className="btn btn-primary" onClick={startMarkVisited}>
            Mark Visited
          </button>
        )}
        {node.state === 'closed' && <span className="popup-closed-note">Currently closed by park staff.</span>}
      </div>
    </Modal>
  )
}
