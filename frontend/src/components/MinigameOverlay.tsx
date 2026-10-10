import { useEffect, useRef, useState } from 'react'
import type { Minigame } from '../api'
import './MinigameOverlay.css'

// Maps a Minigame.name to the slug its Web export was copied to under
// frontend/games-dist/. Served at /games/<slug>/... by the dev-server
// middleware locally and by the Worker's R2 route in production (both
// export builds are too large for the Vite-bundled static assets — see
// worker.js). Only games with a built export belong here — anything else
// falls back to the ToastStack stub notice.
const GAME_SLUGS: Record<string, string> = {
  'Mini Snake': 'mini_snake',
  'Whack-a-Capybara': 'whack_a_capybara',
  'Card Flip Pairs': 'card_flip_pairs',
  'Pattern Repeat': 'pattern_repeat',
  'Mini Maze': 'mini_maze',
  'Mini Platformer': 'mini_platformer',
  'Obstacle Dodge': 'obstacle_dodge',
  'Digital Ring Toss': 'digital_ring_toss',
  'Bug Net Swipe': 'bug_net_swipe',
  'Sort the Species': 'sort_the_species',
}

export function getMinigameSlug(game: Minigame): string | null {
  return GAME_SLUGS[game.name] ?? null
}

export type MinigameOutcome = 'win' | 'lose' | 'timeup' | 'finished'

const OUTCOMES: readonly MinigameOutcome[] = ['win', 'lose', 'timeup', 'finished']

// What a game reports when a round ends: the outcome plus the numbers its
// pill row shows, keyed by lowercased pill label (e.g. { score: 7, length: 10 }).
export interface MinigameResult {
  outcome: MinigameOutcome
  stats: Record<string, number>
}

export interface MinigameCloseInfo {
  // The latest round result for this launch (a guest can Play Again, so it's
  // the last round's), or null if no round ended before the overlay closed.
  result: MinigameResult | null
  // Whether this build reports results at all. Builds from before the end
  // card never do, so for them a close can't be told apart from a finish.
  reportsResults: boolean
}

// True when the guest played a round to its end before closing. An old build
// can't say, so it counts as finished -- exactly how every close was treated
// before results existed.
export function finishedRound(info: MinigameCloseInfo): boolean {
  return info.result !== null || !info.reportsResults
}

function parseResult(data: Record<string, unknown>): MinigameResult | null {
  if (!OUTCOMES.includes(data.outcome as MinigameOutcome)) return null
  const stats: Record<string, number> = {}
  if (data.stats && typeof data.stats === 'object') {
    for (const [key, value] of Object.entries(data.stats)) {
      if (typeof value === 'number' && Number.isFinite(value)) stats[key] = value
    }
  }
  return { outcome: data.outcome as MinigameOutcome, stats }
}

interface MinigameOverlayProps {
  game: Minigame
  // Identifies this launch. App keys the overlay on it, so each launch gets a
  // fresh iframe (and fresh result state) even when the same game is queued
  // twice in a row.
  launchId: string
  onClose: (launchId: string, info: MinigameCloseInfo) => void
}

// Full-screen(ish) host for a Godot Web export. Message contract, all posted
// by the game to window.parent:
//   { type: 'minigame-hello' }    -- a build that reports results; new builds
//                                    post it from an inline <head> script,
//                                    before the engine boots
//   { type: 'minigame-result', outcome, stats } -- a round ended. The game
//                                    shows its own end card (Play Again /
//                                    Exit), so the overlay stays open
//   { type: 'minigame-complete' } -- the guest tapped Exit or the X. Old
//                                    builds also send this the moment a round
//                                    ends, which is why they close at once
// Escape also closes. Each launch closes at most once.
export function MinigameOverlay({ game, launchId, onClose }: MinigameOverlayProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const slug = getMinigameSlug(game)
  const [result, setResult] = useState<MinigameResult | null>(null)
  // Refs alongside the state so a close reads the latest values even when
  // several messages land before React re-renders.
  const closeInfoRef = useRef<MinigameCloseInfo>({ result: null, reportsResults: false })
  const closedRef = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const close = () => {
      if (closedRef.current) return
      closedRef.current = true
      onCloseRef.current(launchId, { ...closeInfoRef.current })
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data
      if (!data || typeof data !== 'object') return
      if (data.type === 'minigame-hello') {
        closeInfoRef.current.reportsResults = true
      } else if (data.type === 'minigame-result') {
        const parsed = parseResult(data)
        if (!parsed) return
        closeInfoRef.current = { result: parsed, reportsResults: true }
        setResult(parsed)
      } else if (data.type === 'minigame-complete') {
        close()
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('message', onMessage)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('message', onMessage)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [launchId])

  if (!slug) return null

  // Exposed as data attributes so e2e can read the outcome without having to
  // inspect the game's WebGL canvas.
  return (
    <div
      className="minigame-overlay"
      data-launch-id={launchId}
      data-minigame-outcome={result?.outcome}
      data-minigame-score={result?.stats.score}
      data-minigame-stats={result ? JSON.stringify(result.stats) : undefined}
    >
      <div className="minigame-overlay-panel" role="dialog" aria-modal="true" aria-label={game.name}>
        <iframe
          ref={iframeRef}
          className="minigame-overlay-frame"
          src={`/games/${slug}/index.html`}
          title={game.name}
          allow="autoplay"
        />
      </div>
    </div>
  )
}
