import { imageCandidates, ANIMALS } from '../animalContent'
import logo from '../assets/COBBS-logo_Colour-on-dark.png'
import { AnimalImage } from './AnimalImage'
import { HeartIcon } from './NavIcons'
import './CollectibleCardVisual.css'

interface CollectibleCardVisualProps {
  animalSlug: string
  photoIndex: number
  guestName: string
  className?: string
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" />
      <ellipse cx="10" cy="10" rx="3.2" ry="7.5" />
      <line x1="2.5" y1="10" x2="17.5" y2="10" />
      <line x1="3.6" y1="6" x2="16.4" y2="6" />
      <line x1="3.6" y1="14" x2="16.4" y2="14" />
    </svg>
  )
}

// The card artwork itself -- purchase reveal and the gallery both render
// this same component, then rasterize whichever DOM node wraps it via
// collectibleCardImage.ts's downloadCard/shareCard. Deliberate deviations
// from the reference mockup (per Melissa): the real app logo instead of the
// mockup's placeholder, no arrow icon in the bottom banner, and the logo
// shrunk to a corner badge (no mountain motif) so the photo dominates.
export function CollectibleCardVisual({ animalSlug, photoIndex, guestName, className }: CollectibleCardVisualProps) {
  const animal = ANIMALS.find((a) => a.slug === animalSlug)
  const animalName = animal?.name ?? animalSlug
  const photoAlt = `${animalName} photo`

  return (
    <div className={className ? `collectible-card-frame ${className}` : 'collectible-card-frame'}>
      <div className="collectible-card-visual cap-parchment-card">
        <div className="collectible-card-photo-wrap">
          <AnimalImage candidates={imageCandidates(animalSlug, photoIndex)} alt={photoAlt} className="collectible-card-photo" />
          <img className="collectible-card-logo" src={logo} alt="Cobb's Adventure Park" />
        </div>

        <div className="collectible-card-name-banner">
          <span className="collectible-card-name-text">{animalName}</span>
        </div>

        <div className="collectible-card-collected">
          <span className="collectible-card-collected-label">Collected by</span>
          <span className="collectible-card-collected-name">{guestName}</span>
          <HeartIcon className="collectible-card-heart" />
        </div>

        <div className="collectible-card-bottom-banner">
          <p className="collectible-card-thanks">Thanks for exploring with us!</p>
          <p className="collectible-card-website">
            <GlobeIcon className="collectible-card-globe" />
            Plan your next adventure at <span className="collectible-card-website-link">cobbsadventurepark.com</span>
          </p>
        </div>
      </div>
    </div>
  )
}
