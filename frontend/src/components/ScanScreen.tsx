import { useEffect, useState } from 'react'
import { api, type EncyclopediaEntry, type HuntCharacter } from '../api'
import { EncyclopediaEntryScreen } from './EncyclopediaEntryScreen'
import { HuntChallengeModal } from './HuntChallengeModal'
import './ScanScreen.css'

interface ScanScreenProps {
  code: string
  onCompleteChallenge: (challengeId: string) => Promise<HuntCharacter>
  onUnlockCharacter: (characterId: string) => Promise<HuntCharacter>
  onPlayMinigame: (challengeId: string, minigameSlug: string) => void
  onClose: () => void
}

type ScanState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error'; message: string }
  | { status: 'hunt_character'; character: HuntCharacter }
  | { status: 'encyclopedia_entry'; entry: EncyclopediaEntry }

// Resolves a code (from a direct /scan/:code deep link -- e.g. a phone's own
// camera app opening a printed sign's URL -- or from in-app navigation after
// ScanEntryModal decodes/accepts one) and routes to the matching screen.
// Reusing HuntChallengeModal as-is means a scanned hunt character gets the
// exact same challenge flow as opening it from the Scavenger Hunt tab.
export function ScanScreen({ code, onCompleteChallenge, onUnlockCharacter, onPlayMinigame, onClose }: ScanScreenProps) {
  const [state, setState] = useState<ScanState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    api
      .resolveScanCode(code)
      .then((result) => {
        if (cancelled) return
        if (result.type === 'hunt_character') {
          // Unlocking is idempotent server-side, so re-scanning an
          // already-unlocked character is a no-op here too -- it just lands
          // back on the same challenge flow, no error or re-triggered unlock.
          return onUnlockCharacter(result.target.id).then((character) => {
            if (cancelled) return
            setState({ status: 'hunt_character', character })
          })
        }
        setState({ status: 'encyclopedia_entry', entry: result.target })
      })
      .catch((err) => {
        if (cancelled) return
        setState(String(err).includes('404') ? { status: 'not_found' } : { status: 'error', message: String(err) })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `code`
    // only, same as before: callback props from App.tsx aren't stable
    // references across renders and re-running this on every parent
    // re-render would re-fetch/re-unlock needlessly.
  }, [code])

  if (state.status === 'loading') {
    return <div className="scan-screen scan-loading">Looking up "{code}"…</div>
  }

  if (state.status === 'not_found') {
    return (
      <div className="scan-screen">
        <p className="screen-error">
          We couldn't find a code matching "{code}". Double-check the spelling on the sign and try again.
        </p>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Back to the app
        </button>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="scan-screen">
        <p className="screen-error">Something went wrong looking that up: {state.message}</p>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Back to the app
        </button>
      </div>
    )
  }

  if (state.status === 'hunt_character') {
    return (
      <HuntChallengeModal
        character={state.character}
        onClose={onClose}
        onCompleteChallenge={onCompleteChallenge}
        onPlayMinigame={onPlayMinigame}
      />
    )
  }

  return <EncyclopediaEntryScreen entry={state.entry} onClose={onClose} />
}
