import { useMemo, useState } from 'react'
import type {
  HuntCharacter,
  HuntChallenge,
  HuntImageMcContent,
  HuntMatchingContent,
  HuntMcContent,
  HuntTrueFalseSetContent,
} from '../api'
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
        <div className="hunt-modal-inner">
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
      <div className="hunt-modal-inner">
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
      <div className="hunt-matching-columns">
        <div className="hunt-matching-column">
          {content.pairs.map((p) => (
            <button
              type="button"
              key={p.left}
              className={`btn hunt-matching-item ${matched.has(p.left) ? 'hunt-option-correct' : ''} ${
                selectedLeft === p.left ? 'hunt-matching-selected' : ''
              }`}
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
                className={`btn hunt-matching-item ${isMatched ? 'hunt-option-correct' : ''} ${
                  wrongRight === right ? 'hunt-option-wrong' : ''
                }`}
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
  const [wrong, setWrong] = useState(false)
  const statement = content.statements[index]

  const answer = (value: boolean) => {
    if (disabled) return
    if (value === statement.answer) {
      setWrong(false)
      if (index + 1 === content.statements.length) {
        onSolved()
      } else {
        setIndex(index + 1)
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
        <button type="button" className="btn hunt-tf-button" disabled={disabled} onClick={() => answer(true)}>
          True
        </button>
        <button type="button" className="btn hunt-tf-button" disabled={disabled} onClick={() => answer(false)}>
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
