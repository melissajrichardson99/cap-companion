import { useEffect, useMemo, useState } from 'react'
import { Route, Routes, useNavigate, useParams } from 'react-router-dom'
import type { AnimalPhoto } from '../api'
import { ANIMALS } from '../animalContent'
import { PAGE_SUBHEADERS } from '../pageSubheaderContent'
import { AnimalCardsScreen } from './AnimalCardsScreen'
import { AnimalDetailScreen } from './AnimalDetailScreen'
import { AnimalImage } from './AnimalImage'
import { BinocularsIcon, CameraIcon, SearchIcon } from './NavIcons'
import './AnimalsScreen.css'

interface AnimalsScreenProps {
  onScanQr: () => void
  // Staff-managed photos (api.listAnimalPhotos, fetched once by App.tsx) --
  // null while loading. Grouped by slug below so every nested route can pull
  // its animal's photos from one shared fetch instead of re-fetching per
  // route. Deliberately unrelated to Collectibles' own curated photo pool,
  // which never touches this prop.
  photos: AnimalPhoto[] | null
  photosError: string | null
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
export function AnimalsScreen({ onScanQr, photos, photosError }: AnimalsScreenProps) {
  const photosBySlug = useMemo(() => {
    const map = new Map<string, AnimalPhoto[]>()
    for (const photo of photos ?? []) {
      const forSlug = map.get(photo.animal_slug)
      if (forSlug) forSlug.push(photo)
      else map.set(photo.animal_slug, [photo])
    }
    return map
  }, [photos])

  return (
    <Routes>
      <Route
        index
        element={
          <AnimalsListView onScanQr={onScanQr} photosBySlug={photosBySlug} loading={photos === null} error={photosError} />
        }
      />
      <Route path=":slug" element={<AnimalDetailRoute photosBySlug={photosBySlug} />} />
      <Route path=":slug/cards" element={<AnimalCardsRoute photosBySlug={photosBySlug} />} />
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

function AnimalDetailRoute({ photosBySlug }: { photosBySlug: Map<string, AnimalPhoto[]> }) {
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
      photos={photosBySlug.get(animal.slug) ?? []}
      onBack={() => navigate('/animals')}
      onViewCards={() => navigate(`/animals/${animal.slug}/cards`)}
    />
  )
}

function AnimalCardsRoute({ photosBySlug }: { photosBySlug: Map<string, AnimalPhoto[]> }) {
  useResetHorizontalScroll()
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const animal = ANIMALS.find((a) => a.slug === slug) ?? null

  if (!animal) {
    return <AnimalNotFound slug={slug} onBrowse={() => navigate('/animals')} />
  }

  return (
    <AnimalCardsScreen
      key={animal.slug}
      animal={animal}
      photos={photosBySlug.get(animal.slug) ?? []}
      onBack={() => navigate(`/animals/${animal.slug}`)}
    />
  )
}

function AnimalsListView({
  onScanQr,
  photosBySlug,
  loading,
  error,
}: {
  onScanQr: () => void
  photosBySlug: Map<string, AnimalPhoto[]>
  loading: boolean
  error: string | null
}) {
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

      {error && <p className="screen-error">Couldn't load animal photos: {error}</p>}

      {loading ? (
        <p className="animals-empty">Loading animals…</p>
      ) : filtered.length === 0 ? (
        <p className="animals-empty">No animals match "{search}".</p>
      ) : (
        <div className="animals-grid">
          {filtered.map((animal) => {
            const firstPhoto = photosBySlug.get(animal.slug)?.[0]
            return (
              <button
                type="button"
                key={animal.slug}
                className="animal-card cap-parchment-card"
                onClick={() => navigate(`/animals/${animal.slug}`)}
              >
                <span className="animal-card-photo">
                  <AnimalImage
                    candidates={firstPhoto ? [firstPhoto.photo_url] : []}
                    alt=""
                    className="animal-card-photo-img"
                  />
                </span>
                <span className="animal-card-name">{animal.name}</span>
              </button>
            )
          })}
        </div>
      )}

      <button type="button" className="btn btn-primary animals-scan-cta" onClick={onScanQr}>
        <CameraIcon className="animals-scan-cta-icon" />
        Scan a QR Code
      </button>
    </div>
  )
}
