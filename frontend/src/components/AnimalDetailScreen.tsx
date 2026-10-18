import { useState } from 'react'
import type { AnimalPhoto } from '../api'
import type { AnimalContent } from '../animalContent'
import { AnimalImage } from './AnimalImage'
import { ChevronLeftIcon, HeartIcon } from './NavIcons'
import { PhotoLightbox, type LightboxPhoto } from './PhotoLightbox'
import './AnimalDetailScreen.css'

interface AnimalDetailScreenProps {
  animal: AnimalContent
  // Staff-managed photos for this animal, already filtered/ordered by
  // AnimalsScreen (api.listAnimalPhotos, grouped by animal_slug). Can be
  // empty for an animal with no photos uploaded yet.
  photos: AnimalPhoto[]
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
export function AnimalDetailScreen({ animal, photos, onBack, onViewCards }: AnimalDetailScreenProps) {
  const [tab, setTab] = useState<DetailTab>('about')
  const [lightbox, setLightbox] = useState<{ photos: LightboxPhoto[]; startIndex: number } | null>(null)
  const heroCandidates = photos[0] ? [photos[0].photo_url] : []

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
        candidates={heroCandidates}
        alt={`${animal.name}`}
        className="animal-detail-hero"
        onClick={
          photos.length > 0
            ? () => setLightbox({ photos: [{ candidates: heroCandidates, alt: animal.name }], startIndex: 0 })
            : undefined
        }
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
          {animal.tagline && <p className="animal-detail-tagline">{animal.tagline}</p>}
          <p className="animal-detail-description">{animal.description}</p>
          {animal.facts.length > 0 && (
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
          )}
          <button type="button" className="btn btn-primary animal-detail-cards-btn" onClick={onViewCards}>
            View Information Cards
          </button>
        </section>
      )}

      {tab === 'photos' && (
        <section className="animal-detail-photos cap-parchment-card">
          {photos.length === 0 ? (
            <p className="animals-empty">No photos of {animal.name} yet -- check back soon!</p>
          ) : (
            <div className="animal-detail-photos-grid">
              {photos.map((photo, i) => (
                <AnimalImage
                  key={photo.id}
                  candidates={[photo.photo_url]}
                  alt={`Photo ${i + 1} of ${animal.name}`}
                  className="animal-detail-photo"
                  lazy
                  onClick={() =>
                    setLightbox({
                      photos: photos.map((p, j) => ({
                        candidates: [p.photo_url],
                        alt: `Photo ${j + 1} of ${animal.name}`,
                      })),
                      startIndex: i,
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {lightbox && (
        <PhotoLightbox photos={lightbox.photos} startIndex={lightbox.startIndex} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}
