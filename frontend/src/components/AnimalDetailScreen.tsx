import { useState } from 'react'
import type { AnimalContent } from '../animalContent'
import { AnimalImage } from './AnimalImage'
import { ChevronLeftIcon, HeartIcon } from './NavIcons'
import './AnimalDetailScreen.css'

interface AnimalDetailScreenProps {
  animal: AnimalContent
  onBack: () => void
  onViewCards: () => void
}

type DetailTab = 'about' | 'photos'

// Screen 2 of "Our Animals" (Plan.md 2.5/5): About/Photos tabs only -- no
// third "Fun Facts" tab, that's what the "View Information Cards" button
// (-> AnimalCardsScreen) covers instead. The heart/favorite icon is
// deliberately non-interactive: no favoriting concept exists anywhere else
// in the app yet, so this stays decorative rather than speculatively
// building a new favorites system for one screen.
export function AnimalDetailScreen({ animal, onBack, onViewCards }: AnimalDetailScreenProps) {
  const [tab, setTab] = useState<DetailTab>('about')

  return (
    <div className="animal-detail-screen">
      <div className="animal-detail-header-row">
        <button type="button" className="animal-detail-back-btn" onClick={onBack} aria-label="Back to Our Animals">
          <ChevronLeftIcon />
        </button>
        <h2 className="animal-detail-title">{animal.name}</h2>
        <span
          className="animal-detail-favorite-btn"
          role="img"
          aria-label="Favoriting isn't available yet"
          title="Favoriting isn't available yet"
        >
          <HeartIcon />
        </span>
      </div>

      <AnimalImage
        candidates={animal.photoCandidates}
        alt={`${animal.name}`}
        className="animal-detail-hero"
      />

      <div className="animal-detail-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'about'}
          className={`animal-detail-tab ${tab === 'about' ? 'animal-detail-tab-active' : ''}`}
          onClick={() => setTab('about')}
        >
          About
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'photos'}
          className={`animal-detail-tab ${tab === 'photos' ? 'animal-detail-tab-active' : ''}`}
          onClick={() => setTab('photos')}
        >
          Photos
        </button>
      </div>

      {tab === 'about' && (
        <section className="animal-detail-about cap-parchment-card">
          <h3 className="animal-detail-about-heading">{animal.aboutHeading}</h3>
          <p className="animal-detail-description">{animal.description}</p>
          <table className="animal-detail-facts-table">
            <tbody>
              {animal.facts.map((fact) => (
                <tr key={fact.label}>
                  <th scope="row">{fact.label}</th>
                  <td>{fact.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-primary animal-detail-cards-btn" onClick={onViewCards}>
            View Information Cards
          </button>
        </section>
      )}

      {tab === 'photos' && (
        <section className="animal-detail-photos cap-parchment-card">
          <div className="animal-detail-photos-grid">
            {animal.photos.map((photo, i) => (
              <AnimalImage key={i} candidates={photo.candidates} alt={photo.alt} className="animal-detail-photo" />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
