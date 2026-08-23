import { useState } from 'react'
import { api, type LinkedTile, type MapNode, type VisitNodeResponse } from '../api'
import { Modal } from './Modal'
import { MapPinIcon } from './NavIcons'
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

  // A node with no uncompleted linked tiles skips straight from 'detail' to
  // submit()'s 'submitting' step (see startMarkVisited) without ever
  // populating queue -- guard on an actual tile existing, not just the step,
  // so that fast path doesn't crash reading .label off an empty queue.
  const tile = queue[queueIndex]
  if ((step === 'confirming' || step === 'submitting') && tile) {
    return (
      <Modal onClose={onClose} labelledBy="tile-confirm-heading" className="node-detail-modal-frame">
        <div className="node-detail-modal-inner">
          <h2 id="tile-confirm-heading" className="node-detail-title">
            <span className="node-detail-icon-badge" aria-hidden="true">
              <MapPinIcon />
            </span>
            {node.name}
          </h2>
          <p className="tile-confirm-progress">
            Tile {queueIndex + 1} of {queue.length}
          </p>
          <p className="tile-confirm-question">Did you complete &ldquo;{tile.label}&rdquo; here?</p>
          <div className="node-detail-actions">
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
          {step === 'submitting' && <p className="node-detail-status">Saving…</p>}
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} labelledBy="node-detail-heading" className="node-detail-modal-frame">
      <div className="node-detail-modal-inner">
        <div className="node-detail-header-row">
          <h2 id="node-detail-heading" className="node-detail-title">
            <span className="node-detail-icon-badge" aria-hidden="true">
              <MapPinIcon />
            </span>
            {node.name}
          </h2>
          <span className={`state-pill state-pill-${node.state}`}>{STATE_LABEL[node.state]}</span>
        </div>
        <p className="node-detail-category">{CATEGORY_LABEL[node.category]}</p>
        <p className="node-detail-description">{node.description}</p>

        {node.children.length > 0 && (
          <p className="node-detail-children">Games here: {node.children.map((c) => c.name).join(', ')}</p>
        )}

        {node.linked_tiles.length > 0 && (
          <p className="node-detail-tile-count">
            {uncompletedTiles.length > 0
              ? `${uncompletedTiles.length} uncompleted Bingo tile${uncompletedTiles.length === 1 ? '' : 's'} linked here`
              : 'All linked Bingo tiles already completed'}
          </p>
        )}

        {/* Staff-managed operational status (map_nodes.is_open) -- purely
            informational, additive to whatever else this popup already
            shows. Does not gate Mark Visited below: closed attractions stay
            fully scannable/completable. */}
        {!node.is_open && (
          <p className="node-detail-closed-info">This attraction is currently closed.</p>
        )}

        {error && <p className="screen-error">{error}</p>}

        <div className="node-detail-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={step === 'submitting'}>
            Close
          </button>
          {node.state === 'not_visited' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={startMarkVisited}
              disabled={step === 'submitting'}
            >
              Mark Visited
            </button>
          )}
          {node.state === 'closed' && <span className="node-detail-closed-note">Currently closed by park staff.</span>}
        </div>
        {/* Only reachable here when there was nothing to confirm (queue stayed
            empty) -- startMarkVisited went straight to submit(). */}
        {step === 'submitting' && <p className="node-detail-status">Saving…</p>}
      </div>
    </Modal>
  )
}
