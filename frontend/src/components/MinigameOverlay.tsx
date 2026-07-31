import { useEffect, useRef } from 'react'
import type { Minigame } from '../api'
import './MinigameOverlay.css'

// Maps a Minigame.name to the slug its Web export was copied to under
// frontend/public/games/. Only games with a built export belong here —
// anything else falls back to the ToastStack stub notice.
const GAME_SLUGS: Record<string, string> = {
  'Mini Snake': 'mini_snake',
  'Whack-a-Capybara': 'whack_a_capybara',
  'Card Flip Pairs': 'card_flip_pairs',
  'Pattern Repeat': 'pattern_repeat',
  'Mini Maze': 'mini_maze',
}

export function getMinigameSlug(game: Minigame): string | null {
  return GAME_SLUGS[game.name] ?? null
}

interface MinigameOverlayProps {
  game: Minigame
  onClose: () => void
}

// Full-screen(ish) host for a Godot Web export. The game itself posts
// { type: 'minigame-complete' } via JavaScriptBridge when the player exits
// or finishes a round (win or lose); we close on that message rather than
// on any in-game timer, since the game controls when a round is truly over.
export function MinigameOverlay({ game, onClose }: MinigameOverlayProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const slug = getMinigameSlug(game)

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (event.data?.type === 'minigame-complete') onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('message', onMessage)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('message', onMessage)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  if (!slug) return null

  return (
    <div className="minigame-overlay">
      <div className="minigame-overlay-panel" role="dialog" aria-modal="true" aria-label={game.name}>
        <div className="minigame-overlay-header">
          <span className="minigame-overlay-title">{game.name}</span>
          <button type="button" className="minigame-overlay-close" onClick={onClose} aria-label="Close minigame">
            ✕
          </button>
        </div>
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
