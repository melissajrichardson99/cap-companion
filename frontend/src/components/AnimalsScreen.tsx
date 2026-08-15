import { useEffect, useState } from 'react'
import { ANIMALS } from '../animalContent'
import { AnimalCardsScreen } from './AnimalCardsScreen'
import { AnimalDetailScreen } from './AnimalDetailScreen'
import { AnimalImage } from './AnimalImage'
import { BinocularsIcon, CameraIcon, SearchIcon } from './NavIcons'
import './AnimalsScreen.css'

interface AnimalsScreenProps {
  onScanQr: () => void
}

type View = 'list' | 'detail' | 'cards'

// "Our Animals" (rebranded Encyclopedia, Plan.md 2.5/5): a 3-screen flow
// (list -> detail -> information cards) all owned by this one component's
// local view state, same "no router" convention as the rest of the app
// (App.tsx's only real URL route is /scan/:code). Keying the detail/cards
// children on animal.slug (below) forces a fresh mount -- and therefore
// fresh internal state (active tab, card index) -- whenever the selected
// animal changes, instead of manually resetting that state here.
export function AnimalsScreen({ onScanQr }: AnimalsScreenProps) {
  const [view, setView] = useState<View>('list')
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
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

  const selectedAnimal = ANIMALS.find((a) => a.slug === selectedSlug) ?? null

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
