import { useRef, useState } from 'react'
import type { CollectibleCard } from '../api'
import { ANIMALS } from '../animalContent'
import { canShareFiles, cardFilename, downloadCard, shareCard } from '../collectibleCardImage'
import { CollectibleCardVisual } from './CollectibleCardVisual'
import './CollectibleGallery.css'

type FilterTab = 'all' | 'standard' | 'special'

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'standard', label: 'Animals' },
  { key: 'special', label: 'Special' },
]

interface CollectibleGalleryItemProps {
  card: CollectibleCard
}

// Every card stays re-downloadable/re-shareable, not just at the moment of
// purchase (ticket 4) -- each item owns its own DOM ref so it can be
// rasterized again on demand, independent of every other card in the grid.
function CollectibleGalleryItem({ card }: CollectibleGalleryItemProps) {
  const animal = ANIMALS.find((a) => a.slug === card.animal_slug)
  const animalName = animal?.name ?? card.animal_slug
  const cardRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDownload = async () => {
    if (!cardRef.current) return
    setBusy(true)
    setError(null)
    try {
      await downloadCard(cardRef.current, cardFilename(animalName, card.guest_name))
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleShare = async () => {
    if (!cardRef.current) return
    setBusy(true)
    setError(null)
    try {
      await shareCard(cardRef.current, cardFilename(animalName, card.guest_name))
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="collectible-gallery-item">
      <div ref={cardRef} className="collectible-gallery-item-card-wrap">
        <CollectibleCardVisual
          animalSlug={card.animal_slug}
          photoIndex={card.photo_index}
          guestName={card.guest_name}
          className="collectible-gallery-item-card"
        />
      </div>
      <div className="collectible-gallery-item-actions">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={handleDownload}>
          Download
        </button>
        {canShareFiles() && (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={handleShare}>
            Share
          </button>
        )}
      </div>
      {error && <p className="screen-error collectible-gallery-item-error">{error}</p>}
    </div>
  )
}

interface CollectibleGalleryProps {
  cards: CollectibleCard[]
}

export function CollectibleGallery({ cards }: CollectibleGalleryProps) {
  const [filter, setFilter] = useState<FilterTab>('all')
  const filtered = filter === 'all' ? cards : cards.filter((c) => c.tier === filter)

  return (
    <div className="collectible-gallery">
      <div className="collectible-gallery-header">
        <h2 className="cap-section-title">Your Collection (This Visit)</h2>
        <div className="collectible-gallery-tabs" role="tablist">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={filter === tab.key}
              className={`collectible-gallery-tab${filter === tab.key ? ' collectible-gallery-tab-active' : ''}`}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label} ({tab.key === 'all' ? cards.length : cards.filter((c) => c.tier === tab.key).length})
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="collectible-gallery-empty">
          {cards.length === 0
            ? "You haven't collected any cards yet -- visit the Card Shop to get started!"
            : 'No cards in this category yet.'}
        </p>
      ) : (
        <div className="collectible-gallery-grid">
          {filtered.map((card) => (
            <CollectibleGalleryItem key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  )
}
