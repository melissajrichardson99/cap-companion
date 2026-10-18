import { useState } from 'react'
import { PLACEHOLDER_PHOTO_SRC } from '../animalContent'

interface AnimalImageProps {
  candidates: string[]
  alt: string
  className?: string
  onClick?: () => void
  // For images below the fold (grids): the browser fetches them only as
  // they near the viewport. Their boxes are sized by CSS aspect-ratio, so
  // nothing shifts when they arrive.
  lazy?: boolean
}

// Real animal photos vary in extension (.jpg/.png) and aren't all uploaded
// yet per-animal (see animalContent.ts) -- this walks the candidate URLs in
// order on each load failure, landing on the placeholder SVG only once every
// real candidate has genuinely 404'd, rather than assuming the first
// candidate always exists.
//
// onClick is optional (used to open the shared PhotoLightbox) -- when
// present, the image gets button-equivalent keyboard semantics so it stays
// reachable without a mouse.
export function AnimalImage({ candidates, alt, className, onClick, lazy }: AnimalImageProps) {
  const [attempt, setAttempt] = useState(0)
  const src = attempt < candidates.length ? candidates[attempt] : PLACEHOLDER_PHOTO_SRC

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={lazy ? 'lazy' : undefined}
      decoding={lazy ? 'async' : undefined}
      onError={() => setAttempt((a) => a + 1)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    />
  )
}
