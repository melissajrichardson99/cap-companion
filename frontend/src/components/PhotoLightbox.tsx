import { useEffect, useRef, useState, type TouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeftIcon, ChevronRightIcon } from './NavIcons'
import './PhotoLightbox.css'

const SWIPE_THRESHOLD_PX = 50

export interface LightboxPhoto {
  candidates: string[]
  alt: string
}

interface PhotoLightboxProps {
  photos: LightboxPhoto[]
  startIndex: number
  onClose: () => void
}

// Own jpg/png-cascade fallback img, same technique as AnimalImage/
// FoodTruckPhoto -- kept local (not a shared import) since this component's
// last-candidate fallback (just stop advancing) differs from AnimalImage's
// (fall through to the animal placeholder SVG, wrong for non-animal photos).
function LightboxImg({ candidates, alt }: LightboxPhoto) {
  const [attempt, setAttempt] = useState(0)
  const src = candidates[Math.min(attempt, candidates.length - 1)]
  return (
    <img
      src={src}
      alt={alt}
      className="photo-lightbox-image"
      onError={() => setAttempt((a) => Math.min(a + 1, candidates.length - 1))}
    />
  )
}

// Shared full-screen click-to-expand viewer, reused across Our Animals,
// Favorite Photo, Home Page, and Food Trucks. Pass a single-item `photos`
// array for a single-photo context (e.g. Home's Photo of the Day) -- the
// counter, prev/next arrows, swipe, and arrow-key navigation all disable
// themselves automatically since there's nothing to navigate to.
export function PhotoLightbox({ photos, startIndex, onClose }: PhotoLightboxProps) {
  const [index, setIndex] = useState(startIndex)
  const total = photos.length
  const multi = total > 1
  const touchStartX = useRef<number | null>(null)

  const goPrev = () => setIndex((i) => (i - 1 + total) % total)
  const goNext = () => setIndex((i) => (i + 1) % total)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (multi && e.key === 'ArrowLeft') goPrev()
      else if (multi && e.key === 'ArrowRight') goNext()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, multi, total])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const photo = photos[index]
  if (!photo) return null

  const handleTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e: TouchEvent) => {
    const startX = touchStartX.current
    touchStartX.current = null
    if (startX === null || !multi) return
    const deltaX = e.changedTouches[0].clientX - startX
    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX) return
    if (deltaX > 0) goPrev()
    else goNext()
  }

  return createPortal(
    <div className="photo-lightbox-backdrop" onClick={onClose}>
      <div
        className="photo-lightbox-stage"
        role="dialog"
        aria-modal="true"
        aria-label="Photo viewer"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <button type="button" className="photo-lightbox-close" onClick={onClose} aria-label="Close photo viewer">
          ✕
        </button>

        <LightboxImg key={index} candidates={photo.candidates} alt={photo.alt} />

        {multi && (
          <>
            <button
              type="button"
              className="photo-lightbox-arrow photo-lightbox-arrow-prev"
              onClick={goPrev}
              aria-label="Previous photo"
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              className="photo-lightbox-arrow photo-lightbox-arrow-next"
              onClick={goNext}
              aria-label="Next photo"
            >
              <ChevronRightIcon />
            </button>
            <span className="photo-lightbox-counter">
              {index + 1} / {total}
            </span>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
