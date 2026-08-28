import { useState } from 'react'
import type { AnimalPhoto } from '../api'
import type { AnimalContent } from '../animalContent'
import { AnimalImage } from './AnimalImage'
import { ChevronLeftIcon, ChevronRightIcon } from './NavIcons'
import './AnimalCardsScreen.css'

interface AnimalCardsScreenProps {
  animal: AnimalContent
  // Same staff-managed photo list AnimalDetailScreen gets -- info-card
  // images cycle through it (card 6 wraps back to photo 1, etc.) instead of
  // the old fixed mod-5 static-file cycling.
  photos: AnimalPhoto[]
  onBack: () => void
}

// Screen 3 of "Our Animals" (Plan.md 2.5/5): one fact "nugget" at a time,
// a "Card X of Y" text counter (no dot-progress indicator), and side arrow
// buttons that cycle linearly through the deck -- deliberately no Shuffle
// Cards or bottom Next Card button, per the mockup trim.
export function AnimalCardsScreen({ animal, photos, onBack }: AnimalCardsScreenProps) {
  const [index, setIndex] = useState(0)
  const total = animal.nuggets.length
  const nugget = animal.nuggets[index]
  const nuggetImageCandidates = photos.length > 0 ? [photos[index % photos.length].photo_url] : []

  const goPrev = () => setIndex((i) => (i - 1 + total) % total)
  const goNext = () => setIndex((i) => (i + 1) % total)

  return (
    <div className="animal-cards-screen">
      <div className="animal-cards-header-row">
        <button type="button" className="animal-cards-back-btn" onClick={onBack} aria-label="Back to animal details">
          <ChevronLeftIcon />
        </button>
        <h2 className="animal-cards-title">{animal.name} — Information Cards</h2>
        <span className="animal-cards-header-spacer" aria-hidden="true" />
      </div>

      <p className="animal-cards-counter">
        Card {index + 1} of {total}
      </p>

      <div className="animal-cards-nav">
        <button type="button" className="animal-cards-arrow" onClick={goPrev} aria-label="Previous card">
          <ChevronLeftIcon />
        </button>

        <div className="animal-card-nugget cap-parchment-card">
          <AnimalImage key={index} candidates={nuggetImageCandidates} alt="" className="animal-card-nugget-image" />
          <h3 className="animal-card-nugget-title">{nugget.title}</h3>
          <p className="animal-card-nugget-text">{nugget.text}</p>
        </div>

        <button type="button" className="animal-cards-arrow" onClick={goNext} aria-label="Next card">
          <ChevronRightIcon />
        </button>
      </div>
    </div>
  )
}
