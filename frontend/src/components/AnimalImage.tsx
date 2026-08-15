import { useState } from 'react'
import { PLACEHOLDER_PHOTO_SRC } from '../animalContent'

interface AnimalImageProps {
  candidates: string[]
  alt: string
  className?: string
}

// Real animal photos vary in extension (.jpg/.png) and aren't all uploaded
// yet per-animal (see animalContent.ts) -- this walks the candidate URLs in
// order on each load failure, landing on the placeholder SVG only once every
// real candidate has genuinely 404'd, rather than assuming the first
// candidate always exists.
export function AnimalImage({ candidates, alt, className }: AnimalImageProps) {
  const [attempt, setAttempt] = useState(0)
  const src = attempt < candidates.length ? candidates[attempt] : PLACEHOLDER_PHOTO_SRC

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setAttempt((a) => a + 1)}
    />
  )
}
