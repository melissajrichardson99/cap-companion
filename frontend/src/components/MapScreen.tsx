import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { deriveNodeDisplayState, type MapNode, type NodeDisplayState, type VisitNodeResponse } from '../api'
import { PAGE_SUBHEADERS } from '../pageSubheaderContent'
import { KEY_SPOT_CATEGORIES } from '../keySpotCategories'
import { NodeDetailPopup } from './NodeDetailPopup'
import { MapPinIcon } from './NavIcons'
import './MapScreen.css'

// Matches MapScreen.css's mobile pin-shrink breakpoint -- the declutter pass
// below is tuned against that smaller pin/badge size, so it only needs to
// run where that size is actually in effect.
const MOBILE_BREAKPOINT_QUERY = '(max-width: 640px)'

// Minimum on-screen center-to-center clearance (px) between two pins before
// the declutter pass starts nudging them apart -- sized to the mobile-shrunk
// pin's own diameter (20px) plus a few px of breathing room, not a generously
// padded "comfort" value. At mobile map-image widths (~300px, ~35 nodes) a
// larger threshold like the previous 40px counts nearly every pin on the map
// as "too close" to some neighbor, so the repulsion pass below ends up
// nudging the entire node set instead of just genuinely overlapping pairs --
// confirmed by simulating this pass against live position data, where 40px
// triggered on all 35 nodes vs. 16 at this value. Badge overlap is a lesser
// concern already covered by the food category's own tighter badge offset
// (see .map-pin-food .map-pin-tile-badge in MapScreen.css).
const MIN_PIN_GAP_PX = 24
// Cap on how far any single pin may be nudged from its true x_pct/y_pct
// position -- keeps every pin recognizably near its real map location even
// in the densest clusters, instead of letting the declutter pass drag it
// arbitrarily far to satisfy spacing. Sized well under MIN_PIN_GAP_PX so a
// fully-capped nudge still lands close to true position rather than at an
// arbitrary far corner.
const MAX_NUDGE_PX = 10

interface Nudge {
  dx: number
  dy: number
}

const MIN_ZOOM = 1
const MAX_ZOOM = 3
// Below this, a pointer-down-to-up gesture counts as a tap (lets the pin's
// own onClick fire); at or above it, the gesture was a real drag/pinch and
// the resulting click needs to be suppressed so panning the map never
// accidentally opens whatever pin happened to be under the finger.
const DRAG_THRESHOLD_PX = 4
// How long after a drag/pinch gesture ends to keep suppressing the
// synthetic click some browsers fire on pointerup -- just long enough to
// cover that click, not so long a fast deliberate tap right after gets
// eaten.
const CLICK_SUPPRESS_MS = 300

// "Take Me There" focus-on-highlight tuning. A single-node category zooms in
// to a fixed comfortable level (there's no bounding box to fit); a
// multi-node category fits its bounding box instead, so e.g. Attractions
// (spread across nearly the whole map) settles back near MIN_ZOOM instead of
// trying to zoom into empty space.
const KEYSPOT_SINGLE_NODE_ZOOM = 2.2
// Extra percent-of-map padding added around a multi-node bounding box before
// fitting it to the viewport, so the outermost highlighted pins aren't
// touching the viewport edge.
const KEYSPOT_FOCUS_PADDING_PCT = 12

interface GestureState {
  pointers: Map<number, { x: number; y: number }>
  pinchStartDist: number
  pinchStartScale: number
  panStart: { x: number; y: number } | null
  pointerStart: { x: number; y: number } | null
  moved: boolean
}

function clampPan(x: number, y: number, scale: number, size: { width: number; height: number }): { x: number; y: number } {
  // At scale 1 this collapses minX/minY to 0, so pan is forced to (0, 0) --
  // panning only ever does something once actually zoomed in.
  const minX = size.width * (1 - scale)
  const minY = size.height * (1 - scale)
  return { x: Math.min(0, Math.max(minX, x)), y: Math.min(0, Math.max(minY, y)) }
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

// Computes the zoom/pan that fits a "Take Me There" category's matching
// pin(s) in the viewport -- reuses clampPan so the result always respects
// the same pan bounds real pinch/drag gestures do.
function focusScaleAndPan(
  nodes: MapNode[],
  containerSize: { width: number; height: number }
): { scale: number; pan: { x: number; y: number } } {
  if (nodes.length === 0) {
    return { scale: MIN_ZOOM, pan: { x: 0, y: 0 } }
  }
  const xs = nodes.map((n) => n.x_pct!)
  const ys = nodes.map((n) => n.y_pct!)
  const minXPct = Math.min(...xs)
  const maxXPct = Math.max(...xs)
  const minYPct = Math.min(...ys)
  const maxYPct = Math.max(...ys)
  const centerX = ((minXPct + maxXPct) / 2 / 100) * containerSize.width
  const centerY = ((minYPct + maxYPct) / 2 / 100) * containerSize.height

  let scale: number
  if (nodes.length === 1) {
    scale = KEYSPOT_SINGLE_NODE_ZOOM
  } else {
    const spanXPct = maxXPct - minXPct + KEYSPOT_FOCUS_PADDING_PCT * 2
    const spanYPct = maxYPct - minYPct + KEYSPOT_FOCUS_PADDING_PCT * 2
    const spanX = (spanXPct / 100) * containerSize.width
    const spanY = (spanYPct / 100) * containerSize.height
    const fitScale = Math.min(containerSize.width / spanX, containerSize.height / spanY)
    scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitScale))
  }

  const pan = clampPan(
    containerSize.width / 2 - centerX * scale,
    containerSize.height / 2 - centerY * scale,
    scale,
    containerSize
  )
  return { scale, pan }
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

const STATE_ICON: Record<NodeDisplayState, string> = {
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
  const state = deriveNodeDisplayState(node)
  if (state !== 'not_visited') return STATE_ICON[state]
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
  // Deep-link support (FaqScreen's washroom answer "Show me on the map"
  // button) -- opens this "Take Me There" key spot's highlight once this
  // screen has measured its map container. onInitialKeySpotHandled clears
  // the caller's pending state so re-mounting this screen later (e.g.
  // switching tabs away and back) doesn't replay the same deep link.
  initialKeySpot?: string | null
  onInitialKeySpotHandled?: () => void
}

export function MapScreen({
  nodes,
  error,
  onReload,
  onVisitResult,
  initialKeySpot,
  onInitialKeySpotHandled,
}: MapScreenProps) {
  const [selectedNode, setSelectedNode] = useState<MapNode | null>(null)
  const [openLegendCategories, setOpenLegendCategories] = useState<Set<MapNode['category']>>(new Set())
  const [activeKeySpot, setActiveKeySpot] = useState<string | null>(null)
  const imageWrapRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null)
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches
  )

  // Pinch-to-zoom/pan. scale/pan transform the whole .map-image-wrap (image
  // + pins together, since pins are its children) rather than tracking each
  // pin's zoomed position separately -- one transform, everything scales and
  // repositions in lockstep automatically.
  //
  // zoomRef is the authoritative value gesture math reads/writes; zoom
  // (state) only exists to trigger a re-render for the visual `transform`.
  // A rapid burst of pointer events (a fast real pinch, or several dispatched
  // synchronously in one tick) can fire multiple handler calls before React
  // re-renders in between -- reading `zoom` (state) inside those handlers
  // would close over a stale value from before the burst, since setState
  // updates don't apply until the next render. The ref is updated
  // synchronously on every event, so each handler always sees the latest
  // value regardless of how many events land before React catches up.
  const zoomRef = useRef({ scale: MIN_ZOOM, pan: { x: 0, y: 0 } })
  const [zoom, setZoomState] = useState(zoomRef.current)
  const setZoom = (next: { scale: number; pan: { x: number; y: number } }) => {
    zoomRef.current = next
    setZoomState(next)
  }
  const gestureRef = useRef<GestureState>({
    pointers: new Map(),
    pinchStartDist: 0,
    pinchStartScale: MIN_ZOOM,
    panStart: null,
    pointerStart: null,
    moved: false,
  })
  // Sidesteps the synthetic click some browsers fire on pointerup even after
  // real pointer movement -- checked in a capture-phase click handler so a
  // drag/pinch gesture that ends on top of a pin never opens that pin.
  const suppressClickUntilRef = useRef(0)

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current
    // Best-effort: capture keeps receiving move/up events even if the finger
    // slides off this element. Wrapped because a throw here (e.g. no active
    // pointer session for the given id) would otherwise abort the rest of
    // this handler before the pointer ever gets registered below, silently
    // breaking gesture tracking for that finger.
    try {
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    } catch {
      // Gesture tracking below still works without capture; it just won't
      // keep tracking a finger that slides off this element entirely.
    }
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (g.pointers.size === 1) {
      g.pointerStart = { x: e.clientX, y: e.clientY }
      g.panStart = { ...zoomRef.current.pan }
      g.moved = false
    } else if (g.pointers.size === 2) {
      const pts = Array.from(g.pointers.values())
      g.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      g.pinchStartScale = zoomRef.current.scale
      g.moved = true
    }
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current
    if (!g.pointers.has(e.pointerId)) return
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (!containerSize) return
    const viewportEl = viewportRef.current
    if (!viewportEl) return

    if (g.pointers.size === 2) {
      e.preventDefault()
      const rect = viewportEl.getBoundingClientRect()
      const pts = Array.from(g.pointers.values())
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const midX = (pts[0].x + pts[1].x) / 2 - rect.left
      const midY = (pts[0].y + pts[1].y) / 2 - rect.top
      const rawScale = g.pinchStartScale * (g.pinchStartDist > 0 ? dist / g.pinchStartDist : 1)
      const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, rawScale))
      // Keep the point under the pinch midpoint fixed as scale changes,
      // rather than always zooming from a corner/center regardless of where
      // the user's fingers actually are.
      const current = zoomRef.current
      const contentX = (midX - current.pan.x) / current.scale
      const contentY = (midY - current.pan.y) / current.scale
      const newPan = clampPan(midX - contentX * newScale, midY - contentY * newScale, newScale, containerSize)
      setZoom({ scale: newScale, pan: newPan })
    } else if (g.pointers.size === 1 && g.panStart && g.pointerStart) {
      e.preventDefault()
      const dx = e.clientX - g.pointerStart.x
      const dy = e.clientY - g.pointerStart.y
      if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) g.moved = true
      const current = zoomRef.current
      setZoom({
        scale: current.scale,
        pan: clampPan(g.panStart.x + dx, g.panStart.y + dy, current.scale, containerSize),
      })
    }
  }

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current
    g.pointers.delete(e.pointerId)
    if (g.pointers.size === 1) {
      // Dropped from a pinch back to a single finger -- restart the pan
      // baseline from here so the image doesn't jump.
      const [, remaining] = Array.from(g.pointers.entries())[0]
      g.pointerStart = { x: remaining.x, y: remaining.y }
      g.panStart = { ...zoomRef.current.pan }
    }
    if (g.pointers.size === 0) {
      if (g.moved) suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESS_MS
      g.panStart = null
      g.pointerStart = null
    }
  }

  const handleClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (Date.now() < suppressClickUntilRef.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

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

  // Dev-only guard: if a future node rename/removal leaves one of the 6
  // key-spot categories with nothing to highlight, surface it loudly instead
  // of shipping a silently-dead button -- matches the ticket's "flag zero
  // matches explicitly" requirement for whenever this list next drifts from
  // the live data.
  useEffect(() => {
    if (!nodes || import.meta.env.PROD) return
    for (const category of KEY_SPOT_CATEGORIES) {
      if (!nodes.some((n) => category.matches(n))) {
        console.warn(`Take Me There: "${category.label}" matches zero map nodes.`)
      }
    }
  }, [nodes])

  const activeKeySpotCategory = activeKeySpot ? KEY_SPOT_CATEGORIES.find((c) => c.key === activeKeySpot) ?? null : null

  const highlightedNodeIds = useMemo(() => {
    if (!activeKeySpotCategory) return new Set<string>()
    return new Set(positioned.filter((n) => activeKeySpotCategory.matches(n)).map((n) => n.id))
  }, [activeKeySpotCategory, positioned])

  const handleKeySpotClick = (key: string) => {
    if (activeKeySpot === key) {
      // Tapping the active category again clears the highlight and returns
      // the map to its default view, rather than re-running a no-op focus.
      setActiveKeySpot(null)
      setZoom({ scale: MIN_ZOOM, pan: { x: 0, y: 0 } })
      return
    }
    setActiveKeySpot(key)
    if (!containerSize) return
    const category = KEY_SPOT_CATEGORIES.find((c) => c.key === key)
    if (!category) return
    const matchingNodes = positioned.filter((n) => category.matches(n))
    setZoom(focusScaleAndPan(matchingNodes, containerSize))
  }

  // Runs handleKeySpotClick's own logic once (not the toggle-off branch,
  // since a fresh deep link should always open) as soon as containerSize is
  // available to zoom/pan against -- mirrors handleKeySpotClick's guard.
  useEffect(() => {
    if (!initialKeySpot || !containerSize) return
    if (activeKeySpot !== initialKeySpot) {
      handleKeySpotClick(initialKeySpot)
    }
    onInitialKeySpotHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKeySpot, containerSize])

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
      <div className="map-foliage map-foliage-top-left" aria-hidden="true" />
      <div className="map-foliage map-foliage-bottom-right" aria-hidden="true" />
      <h1 className="cap-sign-board">
        <MapPinIcon className="cap-sign-board-icon" />
        Park Map
      </h1>
      <p className="cap-page-subheader">{PAGE_SUBHEADERS.map}</p>

      <div className="map-scene">
        <div className="map-frame">
          <div
            className="map-zoom-viewport"
            ref={viewportRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onClickCapture={handleClickCapture}
          >
            <div
              className="map-image-wrap"
              ref={imageWrapRef}
              style={{ transform: `translate(${zoom.pan.x}px, ${zoom.pan.y}px) scale(${zoom.scale})` }}
            >
              <img src="/park-map.png" alt="Cobb's Adventure Park map" className="map-image" />
              {positioned.map((node) => {
                const uncompletedCount = node.linked_tiles.filter((t) => !t.completed).length
                const pinState = deriveNodeDisplayState(node)
                const stateNote = pinState !== 'not_visited' ? `, ${pinState.replace('_', ' ')}` : ''
                const nudge = nudges.get(node.id)
                const pinStyle = {
                  left: `${node.x_pct}%`,
                  top: `${node.y_pct}%`,
                  '--nudge-x': `${nudge?.dx ?? 0}px`,
                  '--nudge-y': `${nudge?.dy ?? 0}px`,
                } as CSSProperties
                const isKeySpotHighlighted = highlightedNodeIds.has(node.id)
                return (
                  <button
                    type="button"
                    key={node.id}
                    className={`map-pin map-pin-${node.category} map-pin-${pinState}${isKeySpotHighlighted ? ' map-pin-keyspot-highlighted' : ''}`}
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
      </div>

      {unplaced.length > 0 && (
        <section className="map-unplaced">
          <h2 className="map-unplaced-heading">More Locations</h2>
          <div className="node-grid">
            {unplaced.map((node) => {
              const uncompletedCount = node.linked_tiles.filter((t) => !t.completed).length
              const cardState = deriveNodeDisplayState(node)
              return (
                <button
                  type="button"
                  key={node.id}
                  className={`node-card node-card-${cardState}`}
                  onClick={() => setSelectedNode(node)}
                >
                  <span className="node-card-top">
                    <span className="node-card-name">{node.name}</span>
                    {STATE_ICON[cardState] && (
                      <span className={`node-card-state-icon node-card-state-icon-${cardState}`} aria-hidden="true">
                        {STATE_ICON[cardState]}
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

      <div className="map-keyspot-frame">
        <section className="map-keyspot-card cap-parchment-card">
          <div className="map-keyspot-header">
            <span className="map-keyspot-leaf map-keyspot-leaf-left" aria-hidden="true" />
            <h2 className="map-keyspot-title">
              <MapPinIcon className="map-keyspot-title-icon" />
              Take Me There
            </h2>
            <span className="map-keyspot-leaf map-keyspot-leaf-right" aria-hidden="true" />
          </div>
          <p className="map-keyspot-subtitle">Select a key location to highlight it on the map.</p>
          <div className="map-keyspot-grid">
            {KEY_SPOT_CATEGORIES.map((category) => {
              const Icon = category.icon
              const isActive = activeKeySpot === category.key
              return (
                <button
                  type="button"
                  key={category.key}
                  className={`map-keyspot-btn${isActive ? ' map-keyspot-btn-active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => handleKeySpotClick(category.key)}
                >
                  <Icon className="map-keyspot-btn-icon" />
                  <span className="map-keyspot-btn-label">{category.label}</span>
                </button>
              )
            })}
          </div>
        </section>
      </div>

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
                          {!node.is_open && <span className="map-legend-item-closed"> (Closed)</span>}
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
