import { useEffect, useState } from 'react'
import { Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { ANIMALS } from '../animalContent'
import { PAGE_SUBHEADERS } from '../pageSubheaderContent'
import { AnimalCardsScreen } from './AnimalCardsScreen'
import { AnimalDetailScreen } from './AnimalDetailScreen'
import { AnimalImage } from './AnimalImage'
import { BinocularsIcon, CameraIcon, SearchIcon } from './NavIcons'
import './AnimalsScreen.css'

interface AnimalsScreenProps {
  onScanQr: () => void
}

// "Our Animals" (rebranded Encyclopedia, Plan.md 2.5/5): a 3-screen flow
// (list -> detail -> information cards). React Router pilot: each screen is
// now a real nested route under /animals (mounted by App.tsx's GuestShell at
// "animals/*"), so browsing list->detail->cards updates the URL and Back/
// Forward/hard-reload all work -- previously this was local view state on a
// single persistent component, with no URL reflection past the initial
// /animals/:slug deep link. Keying the detail/cards routes on animal.slug
// (via React Router's own remount-on-param-change) still gives each a fresh
// mount -- and therefore fresh internal state (About/Photos tab, card
// index) -- whenever the selected animal changes.
export function AnimalsScreen({ onScanQr }: AnimalsScreenProps) {
  return (
    <Routes>
      <Route index element={<AnimalsListView onScanQr={onScanQr} />} />
      <Route path=":slug" element={<AnimalDetailRoute />} />
      <Route path=":slug/cards" element={<AnimalCardsRoute />} />
    </Routes>
  )
}

// Pre-existing NavMenu quirk (not new to this screen): selecting a tab from
// the dropdown leaves #app-root (overflow:hidden, App.css) scrolled ~48px
// right -- invisible on every other screen since none has interactive UI
// flush against the content column's left edge, but it clips this screen's
// back button/tabs. Each of the three routes below mounts independently
// (real nested routes now, not shared view state), so each needs its own
// copy of this reset rather than the one shared effect the old single-
// component version used.
function useResetHorizontalScroll() {
  useEffect(() => {
    document.getElementById('app-root')?.scrollTo({ left: 0 })
  }, [])
}

function AnimalNotFound({ slug, onBrowse }: { slug: string; onBrowse: () => void }) {
  return (
    <div className="animals-screen">
      <h1 className="cap-sign-board">
        <BinocularsIcon className="cap-sign-board-icon" />
        Our Animals
      </h1>
      <p className="animals-empty">
        We couldn't find that animal{slug ? ` ("${slug}")` : ''}. It may have moved or the sign's QR code is out of
        date.
      </p>
      <button type="button" className="btn btn-primary" onClick={onBrowse}>
        Browse Our Animals
      </button>
    </div>
  )
}

function AnimalDetailRoute() {
  useResetHorizontalScroll()
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const animal = ANIMALS.find((a) => a.slug === slug) ?? null

  if (!animal) {
    return <AnimalNotFound slug={slug} onBrowse={() => navigate('/animals')} />
  }

  return (
    <AnimalDetailScreen
      key={animal.slug}
      animal={animal}
      onBack={() => navigate('/animals')}
      onViewCards={() => navigate(`/animals/${animal.slug}/cards`)}
    />
  )
}

function AnimalCardsRoute() {
  useResetHorizontalScroll()
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const animal = ANIMALS.find((a) => a.slug === slug) ?? null

  if (!animal) {
    return <AnimalNotFound slug={slug} onBrowse={() => navigate('/animals')} />
  }

  return <AnimalCardsScreen key={animal.slug} animal={animal} onBack={() => navigate(`/animals/${animal.slug}`)} />
}

function AnimalsListView({ onScanQr }: { onScanQr: () => void }) {
  useResetHorizontalScroll()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

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
              onClick={() => navigate(`/animals/${animal.slug}`)}
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
