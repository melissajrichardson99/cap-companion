import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  HuntCharacter,
  HuntChallenge,
  HuntImageMcContent,
  HuntMatchingContent,
  HuntMcContent,
  HuntTrueFalseSetContent,
} from '../api'
import { HUNT_CHARACTER_CONTENT } from '../huntCharacterContent'
import { Modal } from './Modal'
import { SearchIcon } from './NavIcons'
import './HuntChallengeModal.css'

interface HuntChallengeModalProps {
  character: HuntCharacter
  onClose: () => void
  onCompleteChallenge: (challengeId: string) => Promise<HuntCharacter>
  onPlayMinigame: (challengeId: string, minigameSlug: string) => void
}

// Challenge 3 (type='minigame') doesn't self-report a result here -- the
// user plays it via App.tsx's shared MinigameOverlay/minigameQueue, and the
// character prop updates reactively once that closes and the backend call
// lands, which naturally advances this modal past it.
export function HuntChallengeModal({ character, onClose, onCompleteChallenge, onPlayMinigame }: HuntChallengeModalProps) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const slug = HUNT_CHARACTER_CONTENT[character.name].slug

  const currentChallenge = character.challenges
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .find((c) => !character.challenges_completed.includes(c.order_index))

  const handleSolved = async (challengeId: string) => {
    setSaving(true)
    setSaveError(null)
    try {
      await onCompleteChallenge(challengeId)
    } catch (err) {
      setSaveError(String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!currentChallenge) {
    return (
      <Modal onClose={onClose} labelledBy="hunt-modal-title" className="hunt-modal-frame">
        <div className="hunt-modal-inner" data-hunt-character={slug}>
          <h2 id="hunt-modal-title" className="hunt-modal-title">
            <span className="hunt-modal-icon-badge" aria-hidden="true">
              <SearchIcon />
            </span>
            {character.name}
          </h2>
          <div className="hunt-complete-banner">
            <span className="hunt-complete-check">✓</span>
            <p>You found {character.name}! All 3 challenges complete.</p>
          </div>
          <div className="hunt-modal-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} labelledBy="hunt-modal-title" className="hunt-modal-frame">
      <div className="hunt-modal-inner" data-hunt-character={slug}>
        <h2 id="hunt-modal-title" className="hunt-modal-title">
          <span className="hunt-modal-icon-badge" aria-hidden="true">
            <SearchIcon />
          </span>
          {character.name} — Challenge {currentChallenge.order_index}
        </h2>
        <ChallengeBody
          key={currentChallenge.id}
          challenge={currentChallenge}
          disabled={saving}
          onSolved={() => handleSolved(currentChallenge.id)}
          onPlayMinigame={() => onPlayMinigame(currentChallenge.id, character.minigame_slug)}
        />
        {saveError && <p className="screen-error">Couldn't save progress: {saveError}</p>}
      </div>
    </Modal>
  )
}

function ChallengeBody({
  challenge,
  disabled,
  onSolved,
  onPlayMinigame,
}: {
  challenge: HuntChallenge
  disabled: boolean
  onSolved: () => void
  onPlayMinigame: () => void
}) {
  switch (challenge.type) {
    case 'mc':
      return <McChallenge content={challenge.content} disabled={disabled} onSolved={onSolved} />
    case 'matching':
      return <MatchingChallenge content={challenge.content} disabled={disabled} onSolved={onSolved} />
    case 'true_false_set':
      return <TrueFalseSetChallenge content={challenge.content} disabled={disabled} onSolved={onSolved} />
    case 'image_mc':
      return <ImageMcChallenge content={challenge.content} disabled={disabled} onSolved={onSolved} />
    case 'minigame':
      return <MinigameChallenge onPlay={onPlayMinigame} />
  }
}

function McChallenge({
  content,
  disabled,
  onSolved,
}: {
  content: HuntMcContent
  disabled: boolean
  onSolved: () => void
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const [wrong, setWrong] = useState(false)

  const choose = (index: number) => {
    if (disabled) return
    setSelected(index)
    if (index === content.answer_index) {
      setWrong(false)
      onSolved()
    } else {
      setWrong(true)
    }
  }

  return (
    <div className="hunt-mc">
      <p className="hunt-question">{content.question}</p>
      <div className="hunt-mc-options">
        {content.options.map((option, index) => (
          <button
            type="button"
            key={option}
            className={`btn hunt-mc-option ${
              selected === index ? (index === content.answer_index ? 'hunt-option-correct' : 'hunt-option-wrong') : ''
            }`}
            disabled={disabled}
            onClick={() => choose(index)}
          >
            {option}
          </button>
        ))}
      </div>
      {wrong && <p className="hunt-feedback hunt-feedback-wrong">Not quite — try again.</p>}
    </div>
  )
}

// Deterministic pseudo-shuffle (no Math.random) so the right-hand column's
// order is stable across re-renders/tests instead of reshuffling on every
// parent update.
function shuffle<T>(items: T[]): T[] {
  const arr = items.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (i * 7 + 3) % (i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function MatchingChallenge({
  content,
  disabled,
  onSolved,
}: {
  content: HuntMatchingContent
  disabled: boolean
  onSolved: () => void
}) {
  const rightItems = useMemo(() => shuffle(content.pairs.map((p) => p.right)), [content])

  const [matched, setMatched] = useState<Set<string>>(new Set())
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null)
  const [wrongRight, setWrongRight] = useState<string | null>(null)

  const columnsRef = useRef<HTMLDivElement>(null)
  const termButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const meaningButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  // Each column's min-height, measured from this challenge's actual rendered
  // text (not a hardcoded pixel value) -- so a challenge with all-short
  // content stays compact and a challenge with one long entry grows every
  // sibling in that column to match, without towering over the other
  // column's inherently shorter content. Null until the first post-layout
  // measurement, so buttons fall back to .hunt-matching-item's CSS floor.
  const [columnMinHeights, setColumnMinHeights] = useState<{ term: number; meaning: number } | null>(null)

  useLayoutEffect(() => {
    const tallest = (refs: Map<string, HTMLButtonElement>) => {
      let max = 0
      refs.forEach((el) => {
        max = Math.max(max, el.getBoundingClientRect().height)
      })
      return max
    }

    const remeasure = () => {
      setColumnMinHeights({ term: tallest(termButtonRefs.current), meaning: tallest(meaningButtonRefs.current) })
    }

    // Clear any prior override first so text re-wraps (and is measured) at
    // the current column width -- otherwise a resize that lets text wrap
    // onto fewer lines would only ever grow the min-height, never shrink it.
    let frame = 0
    const scheduleRemeasure = () => {
      cancelAnimationFrame(frame)
      setColumnMinHeights(null)
      frame = requestAnimationFrame(remeasure)
    }
    scheduleRemeasure()

    let observer: ResizeObserver | undefined
    if (columnsRef.current && typeof ResizeObserver !== 'undefined') {
      let lastWidth = columnsRef.current.getBoundingClientRect().width
      observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? lastWidth
        // Only react to width changes (viewport resize/orientation change,
        // which can shift where text wraps) -- applying our own min-height
        // only changes this container's *height*, so without this guard
        // that self-triggers the observer and loops forever.
        if (Math.abs(width - lastWidth) < 1) return
        lastWidth = width
        scheduleRemeasure()
      })
      observer.observe(columnsRef.current)
    }

    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [content])

  const chooseLeft = (left: string) => {
    if (disabled || matched.has(left)) return
    setWrongRight(null)
    setSelectedLeft(left)
  }

  const chooseRight = (right: string) => {
    if (disabled || !selectedLeft) return
    const pair = content.pairs.find((p) => p.left === selectedLeft)
    if (pair && pair.right === right) {
      const next = new Set(matched)
      next.add(selectedLeft)
      setMatched(next)
      setSelectedLeft(null)
      setWrongRight(null)
      if (next.size === content.pairs.length) onSolved()
    } else {
      setWrongRight(right)
      setSelectedLeft(null)
    }
  }

  return (
    <div className="hunt-matching">
      <p className="hunt-question">Match each term to its meaning.</p>
      <div className="hunt-matching-columns" ref={columnsRef}>
        <div className="hunt-matching-column">
          {content.pairs.map((p) => (
            <button
              type="button"
              key={p.left}
              ref={(el) => {
                if (el) termButtonRefs.current.set(p.left, el)
                else termButtonRefs.current.delete(p.left)
              }}
              className={`btn hunt-matching-item hunt-matching-term ${matched.has(p.left) ? 'hunt-option-correct' : ''} ${
                selectedLeft === p.left ? 'hunt-matching-selected' : ''
              }`}
              style={columnMinHeights ? { minHeight: columnMinHeights.term } : undefined}
              disabled={disabled || matched.has(p.left)}
              onClick={() => chooseLeft(p.left)}
            >
              {p.left}
            </button>
          ))}
        </div>
        <div className="hunt-matching-column">
          {rightItems.map((right) => {
            const isMatched = content.pairs.some((p) => p.right === right && matched.has(p.left))
            return (
              <button
                type="button"
                key={right}
                ref={(el) => {
                  if (el) meaningButtonRefs.current.set(right, el)
                  else meaningButtonRefs.current.delete(right)
                }}
                className={`btn hunt-matching-item hunt-matching-meaning ${isMatched ? 'hunt-option-correct' : ''} ${
                  wrongRight === right ? 'hunt-option-wrong' : ''
                }`}
                style={columnMinHeights ? { minHeight: columnMinHeights.meaning } : undefined}
                disabled={disabled || isMatched}
                onClick={() => chooseRight(right)}
              >
                {right}
              </button>
            )
          })}
        </div>
      </div>
      {wrongRight && <p className="hunt-feedback hunt-feedback-wrong">Not a match — try again.</p>}
    </div>
  )
}

function TrueFalseSetChallenge({
  content,
  disabled,
  onSolved,
}: {
  content: HuntTrueFalseSetContent
  disabled: boolean
  onSolved: () => void
}) {
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<boolean | null>(null)
  const [wrong, setWrong] = useState(false)
  // True while a correct-but-not-final answer's green highlight is showing,
  // before this auto-advances to the next statement -- without this pause,
  // setIndex/setSelected(null) would land in the very same batched update as
  // setSelected(value), so the highlight would never actually paint.
  const [advancing, setAdvancing] = useState(false)
  const statement = content.statements[index]

  const answer = (value: boolean) => {
    if (disabled || advancing) return
    setSelected(value)
    if (value === statement.answer) {
      setWrong(false)
      if (index + 1 === content.statements.length) {
        onSolved()
      } else {
        setAdvancing(true)
        setTimeout(() => {
          setIndex((i) => i + 1)
          setSelected(null)
          setAdvancing(false)
        }, 500)
      }
    } else {
      setWrong(true)
    }
  }

  return (
    <div className="hunt-tf">
      <p className="hunt-tf-progress">
        Statement {index + 1} of {content.statements.length}
      </p>
      <p className="hunt-question">{statement.text}</p>
      <div className="hunt-tf-actions">
        <button
          type="button"
          className={`btn hunt-tf-button ${
            selected === true ? (statement.answer === true ? 'hunt-option-correct' : 'hunt-option-wrong') : ''
          }`}
          disabled={disabled || advancing}
          onClick={() => answer(true)}
        >
          True
        </button>
        <button
          type="button"
          className={`btn hunt-tf-button ${
            selected === false ? (statement.answer === false ? 'hunt-option-correct' : 'hunt-option-wrong') : ''
          }`}
          disabled={disabled || advancing}
          onClick={() => answer(false)}
        >
          False
        </button>
      </div>
      {wrong && <p className="hunt-feedback hunt-feedback-wrong">Not quite — try again.</p>}
    </div>
  )
}

function ImageMcChallenge({
  content,
  disabled,
  onSolved,
}: {
  content: HuntImageMcContent
  disabled: boolean
  onSolved: () => void
}) {
  const [guess, setGuess] = useState('')
  const [unscrambled, setUnscrambled] = useState(false)
  const [unscrambleWrong, setUnscrambleWrong] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [mcWrong, setMcWrong] = useState(false)

  const submitGuess = () => {
    if (disabled) return
    if (guess.trim().toUpperCase() === content.unscrambled.toUpperCase()) {
      setUnscrambleWrong(false)
      setUnscrambled(true)
    } else {
      setUnscrambleWrong(true)
    }
  }

  const chooseOption = (index: number) => {
    if (disabled) return
    setSelected(index)
    if (index === content.answer_index) {
      setMcWrong(false)
      onSolved()
    } else {
      setMcWrong(true)
    }
  }

  return (
    <div className="hunt-image-mc">
      <div className="hunt-image-placeholder" role="img" aria-label={content.image_alt}>
        {content.image_alt}
      </div>
      {!unscrambled ? (
        <>
          <p className="hunt-question">
            Unscramble the letters: <span className="hunt-scrambled">{content.scrambled}</span>
          </p>
          <div className="hunt-unscramble-row">
            <input
              type="text"
              className="hunt-unscramble-input"
              value={guess}
              disabled={disabled}
              onChange={(e) => setGuess(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitGuess()}
              aria-label="Unscrambled word"
            />
            <button type="button" className="btn btn-primary" disabled={disabled} onClick={submitGuess}>
              Submit
            </button>
          </div>
          {unscrambleWrong && <p className="hunt-feedback hunt-feedback-wrong">Not quite — try again.</p>}
        </>
      ) : (
        <>
          <p className="hunt-question">{content.question}</p>
          <div className="hunt-mc-options">
            {content.options.map((option, index) => (
              <button
                type="button"
                key={option}
                className={`btn hunt-mc-option ${
                  selected === index ? (index === content.answer_index ? 'hunt-option-correct' : 'hunt-option-wrong') : ''
                }`}
                disabled={disabled}
                onClick={() => chooseOption(index)}
              >
                {option}
              </button>
            ))}
          </div>
          {mcWrong && <p className="hunt-feedback hunt-feedback-wrong">Not quite — try again.</p>}
        </>
      )}
    </div>
  )
}

function MinigameChallenge({ onPlay }: { onPlay: () => void }) {
  return (
    <div className="hunt-minigame-step">
      <p className="hunt-question">Play the minigame to finish this challenge.</p>
      <button type="button" className="btn btn-primary" onClick={onPlay}>
        Play Now
      </button>
    </div>
  )
}
