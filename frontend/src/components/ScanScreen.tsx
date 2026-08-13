import { useEffect, useState } from 'react'
import { api, type EncyclopediaEntry, type HuntCharacter } from '../api'
import { EncyclopediaEntryScreen } from './EncyclopediaEntryScreen'
import { HuntCharacterFoundModal } from './HuntCharacterFoundModal'
import { HuntChallengeModal } from './HuntChallengeModal'
import './ScanScreen.css'

interface ScanScreenProps {
  code: string
  characters: HuntCharacter[] | null
  onCompleteChallenge: (challengeId: string) => Promise<HuntCharacter>
  onUnlockCharacter: (characterId: string) => Promise<HuntCharacter>
  onPlayMinigame: (challengeId: string, minigameSlug: string) => void
  onClose: () => void
}

type ScanState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error'; message: string }
  // Shown once, right after a fresh scan unlocks a character -- see the
  // wasLocked check below. A re-scan of an already-unlocked character skips
  // straight to 'hunt_character', same as before this redesign.
  | { status: 'hunt_character_found'; character: HuntCharacter }
  | { status: 'hunt_character'; character: HuntCharacter }
  | { status: 'encyclopedia_entry'; entry: EncyclopediaEntry }

// Resolves a code (from a direct /scan/:code deep link -- e.g. a phone's own
// camera app opening a printed sign's URL -- or from in-app navigation after
// ScanEntryModal decodes/accepts one) and routes to the matching screen.
// Reusing HuntChallengeModal as-is means a scanned hunt character gets the
// exact same challenge flow as opening it from the Scavenger Hunt tab.
export function ScanScreen({ code, characters, onCompleteChallenge, onUnlockCharacter, onPlayMinigame, onClose }: ScanScreenProps) {
  const [state, setState] = useState<ScanState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    api
      .resolveScanCode(code)
      .then((result) => {
        if (cancelled) return
        if (result.type === 'hunt_character') {
          // result.target reflects state *before* the unlock call below (the
          // /scan/:code GET just looks the character up), so this captures
          // whether this scan is a genuine first-time find.
          const wasLocked = !result.target.unlocked
          // Unlocking is idempotent server-side, so re-scanning an
          // already-unlocked character is a no-op here too -- it just lands
          // back on the same challenge flow, no error or re-triggered unlock,
          // and (per wasLocked above) no found-popup either.
          return onUnlockCharacter(result.target.id).then((character) => {
            if (cancelled) return
            setState({ status: wasLocked ? 'hunt_character_found' : 'hunt_character', character })
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

  if (state.status === 'hunt_character_found') {
    return (
      <HuntCharacterFoundModal
        character={state.character}
        onStartChallenges={() => setState({ status: 'hunt_character', character: state.character })}
        onClose={onClose}
      />
    )
  }

  if (state.status === 'hunt_character') {
    // state.character is only the snapshot from when the scan resolved --
    // completing a challenge (directly, or via a minigame closing back in
    // App.tsx) updates the shared `characters` list, not this local state,
    // so this modal would otherwise keep re-showing the same challenge
    // forever regardless of answers. Prefer the live entry from the shared
    // list (same source HuntScreen's modal reads from) and only fall back to
    // the snapshot for the brief window before that list has loaded.
    const character = characters?.find((c) => c.id === state.character.id) ?? state.character
    return (
      <HuntChallengeModal
        character={character}
        onClose={onClose}
        onCompleteChallenge={onCompleteChallenge}
        onPlayMinigame={onPlayMinigame}
      />
    )
  }

  return <EncyclopediaEntryScreen entry={state.entry} onClose={onClose} />
}
