import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { MapNode, VisitNodeResponse } from '../api'
import { NodeDetailPopup } from './NodeDetailPopup'
import { MapPinIcon } from './NavIcons'
import './MapScreen.css'

// Matches MapScreen.css's mobile pin-shrink breakpoint -- the declutter pass
// below is tuned against that smaller pin/badge size, so it only needs to
// run where that size is actually in effect.
const MOBILE_BREAKPOINT_QUERY = '(max-width: 640px)'

// Minimum on-screen center-to-center clearance (px) between two pins before
// the declutter pass starts nudging them apart -- sized to comfortably clear
// a mobile-shrunk pin (20px) plus its badge's reach (~11px past the pin
// edge), not just the bare pin diameter, so badges clear neighbors too.
// The badge sits off-center (top-right of the pin, MapScreen.css), so its
// farthest corner from the pin's own center can be ~4px past a naive
// pin-radius-only estimate -- padded in here rather than modeled precisely,
// since a center-to-center minimum can't account for the badge's
// asymmetric reach in every direction.
const MIN_PIN_GAP_PX = 40
// Cap on how far any single pin may be nudged from its true x_pct/y_pct
// position -- keeps every pin recognizably near its real map location even
// in the densest clusters, instead of letting the declutter pass drag it
// arbitrarily far to satisfy spacing.
const MAX_NUDGE_PX = 28

interface Nudge {
  dx: number
  dy: number
}

// Pure pixel-space repulsion pass: pushes any pin pair closer than
// MIN_PIN_GAP_PX apart symmetrically along the line between them, a few
// iterations so a chain of >2 crowded pins (e.g. the Critter Cafe / Granny
// Ann's Kitchen / Sugar Shack food cluster) all settle apart from each
// other, not just their nearest neighbor. Operates purely on rendered pixel
// positions computed from the live container size -- never touches the
// underlying x_pct/y_pct data, so it's a no-op wherever pins already have
// room (e.g. this same map at desktop width).
function computeNudges(
  nodes: MapNode[],
  containerSize: { width: number; height: number }
): Map<string, Nudge> {
  const points = nodes.map((n) => ({
    id: n.id,
    x: (n.x_pct! / 100) * containerSize.width,
    y: (n.y_pct! / 100) * containerSize.height,
    dx: 0,
    dy: 0,
  }))

  for (let iter = 0; iter < 4; iter++) {
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]
        const b = points[j]
        const ax = a.x + a.dx
        const ay = a.y + a.dy
        const bx = b.x + b.dx
        const by = b.y + b.dy
        let vx = bx - ax
        let vy = by - ay
        let dist = Math.hypot(vx, vy)
        if (dist < MIN_PIN_GAP_PX) {
          // Coincident points have no natural push direction -- fall back to
          // a fixed diagonal so they don't divide by zero and stay stuck.
          if (dist < 0.01) {
            vx = 1
            vy = 1
            dist = Math.SQRT2
          }
          const push = (MIN_PIN_GAP_PX - dist) / 2
          const ux = vx / dist
          const uy = vy / dist
          a.dx -= ux * push
          a.dy -= uy * push
          b.dx += ux * push
          b.dy += uy * push
        }
      }
    }
  }

  const result = new Map<string, Nudge>()
  for (const p of points) {
    result.set(p.id, {
      dx: Math.max(-MAX_NUDGE_PX, Math.min(MAX_NUDGE_PX, p.dx)),
      dy: Math.max(-MAX_NUDGE_PX, Math.min(MAX_NUDGE_PX, p.dy)),
    })
  }
  return result
}

const CATEGORY_LABEL: Record<MapNode['category'], string> = {
  attraction: 'Attraction',
  animal: 'Animal Habitat',
  service: 'Service',
  food: 'Food & Store',
  seasonal: 'Seasonal',
}

// The four shape/color categories the printed map's legend covers -- excludes
// 'seasonal' (no dedicated legend key on the physical map either).
const LEGEND_CATEGORIES: MapNode['category'][] = ['attraction', 'animal', 'service', 'food']

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
  const [openLegendCategories, setOpenLegendCategories] = useState<Set<MapNode['category']>>(new Set())
  const imageWrapRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null)
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches
  )

  // Tracks the mobile-shrink breakpoint (see MapScreen.css) so the declutter
  // pass below only runs where its tuning (MIN_PIN_GAP_PX etc.) actually
  // applies -- desktop keeps its current, already-adequate pin spacing.
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY)
    const update = () => setIsMobile(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  // The map image scales fluidly with its container (width: 100% in CSS), so
  // node pixel positions have to be measured live rather than assumed --
  // re-observes whenever the wrap element (re)mounts, e.g. once loading
  // finishes and it first appears.
  useEffect(() => {
    const el = imageWrapRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setContainerSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [nodes])

  const positioned = useMemo(
    () => (nodes ?? []).filter((n) => n.parent_node_id == null && n.x_pct != null && n.y_pct != null),
    [nodes]
  )

  const nudges = useMemo(() => {
    if (!isMobile || !containerSize) return new Map<string, Nudge>()
    return computeNudges(positioned, containerSize)
  }, [isMobile, containerSize, positioned])

  const toggleLegendCategory = (category: MapNode['category']) => {
    setOpenLegendCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

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
  // (`positioned` -- the same topLevel + placed filter -- is computed above
  // via useMemo, since the declutter pass needs it before this null check.)
  const topLevel = nodes.filter((n) => n.parent_node_id == null)
  const unplaced = topLevel.filter((n) => n.x_pct == null || n.y_pct == null)

  // selectedNode can go stale after a reload (state/linked_tiles changed) —
  // always resolve the popup's content off the fresh nodes list.
  const freshSelectedNode = selectedNode ? nodes.find((n) => n.id === selectedNode.id) ?? null : null

  // Legend groups pull straight from the live nodes list (same topLevel used
  // for pins/fallback cards) so it can never drift into a hardcoded
  // duplicate -- add/rename/remove a node in the backend and the legend
  // follows automatically. Sorted by the physical map's legend number (same
  // LEGEND_NUMBER table the pin shapes use), not alphabetically, so the
  // in-app order matches the printed map; nodes missing from the table sort
  // last instead of throwing off the rest.
  const legendGroups = LEGEND_CATEGORIES.map((category) => ({
    category,
    nodes: topLevel
      .filter((n) => n.category === category)
      .sort((a, b) => (LEGEND_NUMBER[a.name] ?? Infinity) - (LEGEND_NUMBER[b.name] ?? Infinity)),
  }))
  const legendTotal = legendGroups.reduce((sum, group) => sum + group.nodes.length, 0)

  return (
    <div className="map-screen">
      <h1 className="cap-sign-board">
        <MapPinIcon className="cap-sign-board-icon" />
        Park Map
      </h1>

      <div className="map-scene">
        <div className="map-frame">
          <div className="map-image-wrap" ref={imageWrapRef}>
            <img src="/park-map.png" alt="Cobb's Adventure Park map" className="map-image" />
            {positioned.map((node) => {
              const uncompletedCount = node.linked_tiles.filter((t) => !t.completed).length
              const stateNote = node.state !== 'not_visited' ? `, ${node.state.replace('_', ' ')}` : ''
              const nudge = nudges.get(node.id)
              const pinStyle = {
                left: `${node.x_pct}%`,
                top: `${node.y_pct}%`,
                '--nudge-x': `${nudge?.dx ?? 0}px`,
                '--nudge-y': `${nudge?.dy ?? 0}px`,
              } as CSSProperties
              return (
                <button
                  type="button"
                  key={node.id}
                  className={`map-pin map-pin-${node.category} map-pin-${node.state}`}
                  style={pinStyle}
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

      <div className="map-legend-frame">
        <section className="map-legend cap-parchment-card">
          <div className="map-legend-header">
            <span className="map-legend-header-title">Map Legend</span>
            <span className="map-legend-header-count">{legendTotal} locations</span>
          </div>

          <div className="map-legend-body">
            {legendGroups.map(({ category, nodes: categoryNodes }) => {
              const isOpen = openLegendCategories.has(category)
              return (
                <div className="map-legend-category" key={category}>
                  <button
                    type="button"
                    className="map-legend-category-toggle"
                    aria-expanded={isOpen}
                    aria-controls={`map-legend-list-${category}`}
                    onClick={() => toggleLegendCategory(category)}
                  >
                    <span className={`map-legend-swatch map-pin-${category}`} aria-hidden="true">
                      <svg className="map-pin-shape" viewBox="0 0 30 30" width="18" height="18">
                        <PinShapeVector category={category} />
                      </svg>
                    </span>
                    <span className="map-legend-category-name">{CATEGORY_LABEL[category]}</span>
                    <span className="map-legend-category-count">{categoryNodes.length}</span>
                    <span className="map-legend-toggle-icon" aria-hidden="true">
                      {isOpen ? '▾' : '▸'}
                    </span>
                  </button>

                  {isOpen && (
                    <ul id={`map-legend-list-${category}`} className="map-legend-list">
                      {categoryNodes.map((node) => (
                        <li key={node.id}>
                          {LEGEND_NUMBER[node.name] != null && (
                            <span className="map-legend-item-number">{LEGEND_NUMBER[node.name]}</span>
                          )}
                          {node.name}
                          {node.children.length > 0 && (
                            <ul className="map-legend-children">
                              {node.children.map((child) => (
                                <li key={child.id}>{child.name}</li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {freshSelectedNode && (
        <NodeDetailPopup node={freshSelectedNode} onClose={() => setSelectedNode(null)} onVisitResult={onVisitResult} />
      )}
    </div>
  )
}
