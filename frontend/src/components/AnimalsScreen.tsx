import { useEffect, useState } from 'react'
import { ANIMALS } from '../animalContent'
import { PAGE_SUBHEADERS } from '../pageSubheaderContent'
import { AnimalCardsScreen } from './AnimalCardsScreen'
import { AnimalDetailScreen } from './AnimalDetailScreen'
import { AnimalImage } from './AnimalImage'
import { BinocularsIcon, CameraIcon, SearchIcon } from './NavIcons'
import './AnimalsScreen.css'

interface AnimalsScreenProps {
  onScanQr: () => void
  // Set by App.tsx when a /animals/:slug QR deep link lands here, so this
  // screen opens straight on that animal's detail view instead of the list.
  initialSlug?: string | null
  onInitialSlugHandled?: () => void
}

type View = 'list' | 'detail' | 'cards' | 'invalid'

// "Our Animals" (rebranded Encyclopedia, Plan.md 2.5/5): a 3-screen flow
// (list -> detail -> information cards) all owned by this one component's
// local view state, same "no router" convention as the rest of the app
// (App.tsx's only real URL route is /scan/:code, plus /animals/:slug for QR
// signage -- see initialSlug below). Keying the detail/cards children on
// animal.slug (below) forces a fresh mount -- and therefore fresh internal
// state (active tab, card index) -- whenever the selected animal changes,
// instead of manually resetting that state here.
export function AnimalsScreen({ onScanQr, initialSlug, onInitialSlugHandled }: AnimalsScreenProps) {
  // ANIMALS is a static in-memory constant (see animalContent.ts), so
  // resolving initialSlug against it here is inherently live -- there's no
  // separate fetched/cached copy this could go stale against (unlike the
  // Hunt /scan/:code flow's ScanScreen, which has to re-look-up its scanned
  // character in the shared hunt-characters list for exactly that reason).
  const initialAnimal = initialSlug ? ANIMALS.find((a) => a.slug === initialSlug) ?? null : null
  const [view, setView] = useState<View>(initialSlug ? (initialAnimal ? 'detail' : 'invalid') : 'list')
  const [selectedSlug, setSelectedSlug] = useState<string | null>(initialAnimal ? initialSlug : null)
  const [search, setSearch] = useState('')

  // Pre-existing NavMenu quirk (not new to this screen): selecting a tab from
  // the dropdown leaves #app-root (overflow:hidden, App.css) scrolled ~48px
  // right -- invisible on every other screen since none has interactive UI
  // flush against the content column's left edge, but it clips this screen's
  // back button/tabs. Scoped to this screen rather than touching NavMenu's
  // shared close/transition logic.
  useEffect(() => {
    document.getElementById('app-root')?.scrollTo({ left: 0 })
  }, [])

  // The view/selectedSlug initializers above already resolved initialSlug on
  // mount; this just tells App.tsx to forget the pending slug so navigating
  // away and back to the Our Animals tab later returns to the list instead
  // of re-landing on this animal every time (App.tsx never clears it itself
  // since AnimalsScreen unmounts/remounts on tab switches).
  useEffect(() => {
    if (initialSlug) onInitialSlugHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedAnimal = ANIMALS.find((a) => a.slug === selectedSlug) ?? null

  if (view === 'invalid') {
    return (
      <div className="animals-screen">
        <h1 className="cap-sign-board">
          <BinocularsIcon className="cap-sign-board-icon" />
          Our Animals
        </h1>
        <p className="animals-empty">
          We couldn't find that animal{initialSlug ? ` ("${initialSlug}")` : ''}. It may have moved or the sign's QR
          code is out of date.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setView('list')}>
          Browse Our Animals
        </button>
      </div>
    )
  }

  if (view === 'detail' && selectedAnimal) {
    return (
      <AnimalDetailScreen
        key={selectedAnimal.slug}
        animal={selectedAnimal}
        onBack={() => setView('list')}
        onViewCards={() => setView('cards')}
      />
    )
  }

  if (view === 'cards' && selectedAnimal) {
    return <AnimalCardsScreen key={selectedAnimal.slug} animal={selectedAnimal} onBack={() => setView('detail')} />
  }

  const filtered = ANIMALS.filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <div className="animals-screen">
      <h1 className="cap-sign-board">
        <BinocularsIcon className="cap-sign-board-icon" />
        Our Animals
      </h1>
      <p className="cap-page-subheader">{PAGE_SUBHEADERS.animals}</p>

      <div className="animals-search-row">
        <SearchIcon className="animals-search-icon" aria-hidden="true" />
        <input
          type="text"
          className="animals-search-input"
          placeholder="Search animals by name…"
          aria-label="Search animals by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="animals-empty">No animals match "{search}".</p>
      ) : (
        <div className="animals-grid">
          {filtered.map((animal) => (
            <button
              type="button"
              key={animal.slug}
              className="animal-card cap-parchment-card"
              onClick={() => {
                setSelectedSlug(animal.slug)
                setView('detail')
              }}
            >
              <span className="animal-card-photo">
                <AnimalImage candidates={animal.photoCandidates} alt="" className="animal-card-photo-img" />
              </span>
              <span className="animal-card-name">{animal.name}</span>
            </button>
          ))}
        </div>
      )}

      <button type="button" className="btn btn-primary animals-scan-cta" onClick={onScanQr}>
        <CameraIcon className="animals-scan-cta-icon" />
        Scan a QR Code
      </button>
    </div>
  )
}
