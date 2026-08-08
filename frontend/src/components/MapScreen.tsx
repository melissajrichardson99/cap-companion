import { useState } from 'react'
import type { MapNode, VisitNodeResponse } from '../api'
import { NodeDetailPopup } from './NodeDetailPopup'
import './MapScreen.css'

const FRAME_CORNERS = ['tl', 'tr', 'bl', 'br'] as const

const CATEGORY_LABEL: Record<MapNode['category'], string> = {
  attraction: 'Attraction',
  animal: 'Animal Habitat',
  service: 'Service',
  food: 'Food & Store',
  seasonal: 'Seasonal',
}

const STATE_ICON: Record<MapNode['state'], string> = {
  not_visited: '',
  visited: '✓',
  closed: '\u{1F512}',
}

// Per-category number matching the physical park map's legend, so a
// not-visited pin's shape shows the same number as the printed map (prep for
// a future in-app legend popup). Derived from frontend/public/park-map.png:
// each category's markers are numbered 1..N in the exact order the map
// nodes' x_pct/y_pct were given in, verified against the source image.
const LEGEND_NUMBER: Record<string, number> = {
  // Attractions (star)
  'Arcade Pad': 1,
  'Pedal Karts': 2,
  'Tractor Ride': 3,
  'Mini-Golf': 4,
  Archery: 5,
  'Tether Ball': 6,
  'Chicken Bowl': 7,
  'Axe Throwing': 8,
  'Farm Toss': 9,
  'Fort Slide': 10,
  Playground: 11,
  'Mystery Maze': 12,
  'Blaster Balls': 13,
  'Ground Games': 14,
  'Climbing Wall': 15,
  'Slide Tower': 16,
  'Rope Maze': 17,
  'Soccer Game': 18,
  // Services (square)
  'Ticket Booth': 1,
  Restrooms: 2,
  'Party Tents': 3,
  'Main Stage': 4,
  'Admin Offices': 5,
  'Animal Stage': 6,
  // Food & Stores (diamond)
  'Critter Cafe': 1,
  "Granny Ann's Kitchen": 2,
  'Sugar Shack': 3,
  'General Store': 4,
  // Animals (circle)
  'Small Animals': 1,
  'Kangaroos/Wallaroos': 2,
  Goats: 3,
  'Alpacas/Sheep/Pigs': 4,
  'Capybaras & Emus': 5,
  'Wallaroos (viewing only)': 6,
  'Private Event Animal Space': 7,
}

function pinShapeContent(node: MapNode): string {
  if (node.state !== 'not_visited') return STATE_ICON[node.state]
  const number = LEGEND_NUMBER[node.name]
  return number != null ? String(number) : ''
}

// Real SVG shapes (not CSS clip-path/rotate) so stroke traces the actual
// path outline in one continuous line -- a CSS border on a clip-path'd or
// rotated box only ever draws fragments of the ORIGINAL rectangle's edges,
// which is what caused the diamond's border-skew/leak bugs. All four share
// a 30x30 viewBox so they line up with the badge-offset math (which assumes
// each pin occupies a 30x30 box).
function PinShapeVector({ category }: { category: MapNode['category'] }) {
  switch (category) {
    case 'attraction':
      return (
        <polygon
          className="map-pin-shape-fill"
          points="15,0 18.3,10.5 29.4,10.5 20.4,17.1 23.7,27.3 15,21 6.3,27.3 9.6,17.1 0.6,10.5 11.7,10.5"
          strokeLinejoin="round"
        />
      )
    case 'service':
      return <rect className="map-pin-shape-fill" x="2" y="2" width="26" height="26" rx="4" />
    case 'food':
      return <polygon className="map-pin-shape-fill" points="15,0 30,15 15,30 0,15" strokeLinejoin="round" />
    case 'animal':
    case 'seasonal':
    default:
      return <circle className="map-pin-shape-fill" cx="15" cy="15" r="13" />
  }
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

  // Parented nodes (e.g. Cornhole -> Arcade Pad) are sub-games of their
  // parent, not their own map location — they never get a pin or a
  // fallback-list entry; the parent's popup lists them instead.
  const topLevel = nodes.filter((n) => n.parent_node_id == null)
  const positioned = topLevel.filter((n) => n.x_pct != null && n.y_pct != null)
  const unplaced = topLevel.filter((n) => n.x_pct == null || n.y_pct == null)

  // selectedNode can go stale after a reload (state/linked_tiles changed) —
  // always resolve the popup's content off the fresh nodes list.
  const freshSelectedNode = selectedNode ? nodes.find((n) => n.id === selectedNode.id) ?? null : null

  return (
    <div className="map-screen">
      <div className="map-scene">
        <div className="map-frame">
          {FRAME_CORNERS.map((corner) => (
            <span key={corner} className={`map-frame-bolt map-frame-bolt-${corner}`} aria-hidden="true" />
          ))}
          <div className="map-image-wrap">
            <img src="/park-map.png" alt="Cobb's Adventure Park map" className="map-image" />
            {positioned.map((node) => {
              const uncompletedCount = node.linked_tiles.filter((t) => !t.completed).length
              const stateNote = node.state !== 'not_visited' ? `, ${node.state.replace('_', ' ')}` : ''
              return (
                <button
                  type="button"
                  key={node.id}
                  className={`map-pin map-pin-${node.category} map-pin-${node.state}`}
                  style={{ left: `${node.x_pct}%`, top: `${node.y_pct}%` }}
                  onClick={() => setSelectedNode(node)}
                  aria-label={`${node.name} (${CATEGORY_LABEL[node.category]}${stateNote})`}
                >
                  {uncompletedCount > 0 && (
                    <span className="map-pin-tile-badge" aria-hidden="true">
                      {uncompletedCount}
                    </span>
                  )}
                  <svg className="map-pin-shape" viewBox="0 0 30 30" width="30" height="30" aria-hidden="true">
                    <PinShapeVector category={node.category} />
                    <text className="map-pin-shape-text" x="15" y="15" textAnchor="middle" dominantBaseline="central">
                      {pinShapeContent(node)}
                    </text>
                  </svg>
                  <span className="map-pin-label" aria-hidden="true">
                    {node.name}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {unplaced.length > 0 && (
        <section className="map-unplaced">
          <h2 className="map-unplaced-heading">More Locations</h2>
          <div className="node-grid">
            {unplaced.map((node) => {
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
      )}

      {freshSelectedNode && (
        <NodeDetailPopup node={freshSelectedNode} onClose={() => setSelectedNode(null)} onVisitResult={onVisitResult} />
      )}
    </div>
  )
}
