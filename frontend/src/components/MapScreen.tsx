import { useState } from 'react'
import type { MapNode, NodeCategory, VisitNodeResponse } from '../api'
import { NodeDetailPopup } from './NodeDetailPopup'
import './MapScreen.css'

const CATEGORY_ORDER: NodeCategory[] = ['attraction', 'animal', 'food', 'service', 'seasonal']

const CATEGORY_META: Record<NodeCategory, { label: string; icon: string }> = {
  attraction: { label: 'Attractions', icon: '\u{1F3A1}' },
  animal: { label: 'Animals', icon: '\u{1F43E}' },
  service: { label: 'Services', icon: '\u{1F6CE}\u{FE0F}' },
  food: { label: 'Food & Store', icon: '\u{1F354}' },
  seasonal: { label: 'Seasonal', icon: '\u{1F383}' },
}

const STATE_ICON: Record<MapNode['state'], string> = {
  not_visited: '',
  visited: '✓',
  closed: '\u{1F512}',
}

interface MapScreenProps {
  nodes: MapNode[] | null
  error: string | null
  onReload: () => void
  onVisitResult: (result: VisitNodeResponse) => void
}

export function MapScreen({ nodes, error, onReload, onVisitResult }: MapScreenProps) {
  const [selectedNode, setSelectedNode] = useState<MapNode | null>(null)

  if (error) {
    return (
      <div className="map-screen">
        <p className="screen-error">Couldn't load the park map: {error}</p>
        <button type="button" className="btn btn-secondary" onClick={onReload}>
          Retry
        </button>
      </div>
    )
  }

  if (!nodes) {
    return <div className="map-screen map-loading">Loading park map…</div>
  }

  const byCategory = new Map<NodeCategory, MapNode[]>()
  for (const node of nodes) {
    const list = byCategory.get(node.category) ?? []
    list.push(node)
    byCategory.set(node.category, list)
  }

  // selectedNode can go stale after a reload (state/linked_tiles changed) —
  // always resolve the popup's content off the fresh nodes list.
  const freshSelectedNode = selectedNode ? nodes.find((n) => n.id === selectedNode.id) ?? null : null

  return (
    <div className="map-screen">
      {CATEGORY_ORDER.filter((cat) => byCategory.has(cat)).map((category) => (
        <section key={category} className="map-category">
          <h2 className="map-category-heading">
            <span aria-hidden="true">{CATEGORY_META[category].icon}</span> {CATEGORY_META[category].label}
          </h2>
          <div className="node-grid">
            {byCategory.get(category)!.map((node) => {
              const uncompletedCount = node.linked_tiles.filter((t) => !t.completed).length
              return (
                <button
                  type="button"
                  key={node.id}
                  className={`node-card node-card-${node.state}`}
                  onClick={() => setSelectedNode(node)}
                >
                  <span className="node-card-top">
                    <span className="node-card-name">{node.name}</span>
                    {STATE_ICON[node.state] && (
                      <span className={`node-card-state-icon node-card-state-icon-${node.state}`} aria-hidden="true">
                        {STATE_ICON[node.state]}
                      </span>
                    )}
                  </span>
                  {uncompletedCount > 0 && (
                    <span className="node-card-tile-badge">
                      {uncompletedCount} Bingo tile{uncompletedCount === 1 ? '' : 's'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      ))}

      {freshSelectedNode && (
        <NodeDetailPopup node={freshSelectedNode} onClose={() => setSelectedNode(null)} onVisitResult={onVisitResult} />
      )}
    </div>
  )
}
