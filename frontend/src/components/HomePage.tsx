import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Announcement, type PhotoSubmission } from '../api'
import { getClosingStatusText } from '../closingCountdown'
import {
  ANIMAL_SHOW_TIMES,
  GOOGLE_REVIEW_URL,
  PARK_HOURS_TEXT,
  PARK_OPEN_DAYS,
  PARK_WEATHER_LOCATION,
  TODAY_CARD_PHOTO_SRC,
  TRACTOR_RIDE_TIMES_EAST,
  TRACTOR_RIDE_TIMES_WEST,
} from '../homePageContent'
import { PAGE_SUBHEADERS } from '../pageSubheaderContent'
import { fetchCurrentWeather, type CurrentWeather } from '../weather'
import { CameraIcon, ClipboardIcon, GridIcon, HomeIcon, MapPinIcon, PawIcon, QuestionMarkIcon } from './NavIcons'
import { PhotoLightbox } from './PhotoLightbox'
import './HomePage.css'

interface HomePageProps {
  announcements: Announcement[] | null
  // Scan QR opens a shared modal (lifted in App.tsx/GuestShell, not a route)
  // rather than navigating, same as NavMenu's own Scan QR action -- every
  // other Choose Your Adventure button below navigates directly via useNavigate.
  onScanQr: () => void
}

// True root route (Plan.md build-priority item 4): a real landing page
// instead of guests just falling into whichever tab happens to be default.
// Schedule/hours are static (homePageContent.ts, edited directly in code);
// announcements are staff-managed and live (App.tsx fetches them, same
// lifting pattern as nodes/puzzles/etc. -- see Staff Page's Announcements
// tab). The only other live network call on this page is the weather fetch,
// and it's designed to fail without blocking anything else from rendering
// (see the weatherFailed branch below).
export function HomePage({ announcements, onScanQr }: HomePageProps) {
  const navigate = useNavigate()
  const [weather, setWeather] = useState<CurrentWeather | null>(null)
  const [weatherFailed, setWeatherFailed] = useState(false)

  // undefined = still loading, null = loaded but no shortlisted photos yet.
  const [photoOfTheDay, setPhotoOfTheDay] = useState<PhotoSubmission | null | undefined>(undefined)
  const [photoFailed, setPhotoFailed] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  useEffect(() => {
    fetchCurrentWeather(PARK_WEATHER_LOCATION.latitude, PARK_WEATHER_LOCATION.longitude)
      .then(setWeather)
      .catch(() => setWeatherFailed(true))
  }, [])

  useEffect(() => {
    api
      .getPhotoOfTheDay()
      .then(setPhotoOfTheDay)
      .catch(() => setPhotoFailed(true))
  }, [])

  // Ticks once a minute so the closing countdown below stays live without a
  // full page reload -- open/closed status only needs this same granularity.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(interval)
  }, [])

  const isOpenToday = PARK_OPEN_DAYS.includes(now.getDay())
  const closingStatusText = getClosingStatusText(now, isOpenToday)

  return (
    <div className="home-page">
      <div className="home-foliage home-foliage-bottom-left-lower" aria-hidden="true" />
      <div className="home-foliage home-foliage-bottom-center" aria-hidden="true" />
      <div className="home-foliage home-foliage-bottom-right" aria-hidden="true" />
      <h1 className="cap-sign-board home-sign-board">
        <span className="home-sign-board-text">
          <span className="home-sign-board-line1">
            <HomeIcon className="home-sign-board-icon" />
            Welcome to
          </span>
          <span className="home-sign-board-line2">Cobb's Adventure Park</span>
        </span>
      </h1>
      <p className="cap-page-subheader">{PAGE_SUBHEADERS.home}</p>

      <section className="home-card cap-parchment-card">
        <h2 className="home-section-title">Choose Your Adventure</h2>
        <div className="home-quicknav-grid">
          <button type="button" className="home-quicknav-btn" onClick={() => navigate('/map')}>
            <MapPinIcon className="home-quicknav-btn-icon" />
            <span className="home-quicknav-btn-label">Map</span>
          </button>
          <button type="button" className="home-quicknav-btn" onClick={() => navigate('/bingo')}>
            <GridIcon className="home-quicknav-btn-icon" />
            <span className="home-quicknav-btn-label">Bingo Card</span>
          </button>
          <button type="button" className="home-quicknav-btn" onClick={onScanQr}>
            <CameraIcon className="home-quicknav-btn-icon" />
            <span className="home-quicknav-btn-label">Scan QR</span>
          </button>
          <button type="button" className="home-quicknav-btn" onClick={() => navigate('/scoring')}>
            <ClipboardIcon className="home-quicknav-btn-icon" />
            <span className="home-quicknav-btn-label">Scoring Sheet</span>
          </button>
          <button type="button" className="home-quicknav-btn" onClick={() => navigate('/collectibles')}>
            <PawIcon className="home-quicknav-btn-icon" />
            <span className="home-quicknav-btn-label">Collectibles</span>
          </button>
        </div>
        <p className="home-quicknav-note">Looking for something else? Check the menu in the top-right corner.</p>
      </section>

      <section className="home-card cap-parchment-card">
        <h2 className="home-section-title">Today at Cobb's</h2>
        <img className="home-today-photo" src={TODAY_CARD_PHOTO_SRC} alt="Cobb's Adventure Park" />
        <div className="home-today-row">
          <span className={`home-open-badge ${isOpenToday ? 'home-open-badge-open' : 'home-open-badge-closed'}`}>
            {isOpenToday ? 'Open Today' : 'Closed Today'}
          </span>
          <span className="home-hours-text">{PARK_HOURS_TEXT}</span>
        </div>
        <div className="home-weather">
          {weatherFailed ? (
            <span className="home-weather-unavailable">Weather unavailable right now</span>
          ) : weather ? (
            <span className="home-weather-value">
              {weather.emoji} {Math.round(weather.temperatureC)}°C — {weather.description}
            </span>
          ) : (
            <span className="home-weather-loading">Loading weather…</span>
          )}
        </div>
        {closingStatusText && <div className="home-closing-countdown">{closingStatusText}</div>}
      </section>

      <section className="home-card cap-parchment-card">
        <h2 className="home-section-title">Today's Schedule</h2>
        <div className="home-schedule-grid">
          <div className="home-schedule-block">
            <h3 className="home-schedule-heading">🐾 Animal Shows</h3>
            <div className="home-schedule-times">
              {ANIMAL_SHOW_TIMES.map((time) => (
                <span key={time} className="home-schedule-time-chip">
                  {time}
                </span>
              ))}
            </div>
          </div>
          <div className="home-schedule-block">
            <h3 className="home-schedule-heading">🚜 Tractor Rides — West</h3>
            <div className="home-schedule-times">
              {TRACTOR_RIDE_TIMES_WEST.map((time) => (
                <span key={time} className="home-schedule-time-chip">
                  {time}
                </span>
              ))}
            </div>
          </div>
          <div className="home-schedule-block">
            <h3 className="home-schedule-heading">🚜 Tractor Rides — East</h3>
            <div className="home-schedule-times">
              {TRACTOR_RIDE_TIMES_EAST.map((time) => (
                <span key={time} className="home-schedule-time-chip">
                  {time}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="home-side-by-side">
        <section className="home-card cap-parchment-card home-photo-card">
          <h2 className="home-section-title">Photo of the Day</h2>
          {photoFailed && <p className="home-photo-empty">Couldn't load today's photo — check back soon!</p>}
          {!photoFailed && photoOfTheDay === undefined && <p className="home-photo-empty">Loading…</p>}
          {!photoFailed && photoOfTheDay === null && (
            <p className="home-photo-empty">No favorite photo yet — submit and vote in Favorite Photo!</p>
          )}
          {!photoFailed && photoOfTheDay && (
            <figure className="home-photo-frame">
              <img
                src={photoOfTheDay.photo_url}
                alt={
                  photoOfTheDay.guest_label
                    ? `Favorite photo submitted by ${photoOfTheDay.guest_label}`
                    : 'Favorite guest photo'
                }
                className="home-photo-image"
                role="button"
                tabIndex={0}
                onClick={() => setLightboxOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setLightboxOpen(true)
                  }
                }}
              />
              <figcaption className="home-photo-caption">
                {photoOfTheDay.guest_label ?? 'A guest'} — {photoOfTheDay.vote_count}{' '}
                {photoOfTheDay.vote_count === 1 ? 'vote' : 'votes'}
              </figcaption>
            </figure>
          )}
        </section>

        <section className="home-card cap-parchment-card home-photo-cta-card">
          <CameraIcon className="home-photo-cta-icon" />
          <h2 className="home-section-title">Vote For Your Favorites</h2>
          <p className="home-cta-text">Love this photo? Vote for your favorites when you visit!</p>
          <button type="button" className="btn home-photo-cta-btn" onClick={() => navigate('/photos')}>
            Browse &amp; Vote
          </button>
        </section>
      </div>

      <div className="home-side-by-side">
        {announcements && announcements.length > 0 && (
          <section className="home-card cap-parchment-card">
            <h2 className="home-section-title">Announcements</h2>
            <ul className="home-announcements-list">
              {announcements.map((a) => (
                <li key={a.id} className="home-announcement-item">
                  📣 {a.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="home-card cap-parchment-card">
          <h2 className="home-section-title">Leave a Review, Get a Treat!</h2>
          <p className="home-review-text">
            Enjoyed your visit? Leave us a review on Google and grab a free treat from the General Store — just show
            your review at the counter!
          </p>
          <a className="btn home-review-btn" href={GOOGLE_REVIEW_URL} target="_blank" rel="noopener noreferrer">
            ⭐ Leave a Google Review
          </a>
        </section>
      </div>

      <section className="home-card cap-parchment-card">
        <h2 className="home-section-title">How It Works</h2>
        <ol className="home-howto-list">
          <li className="home-howto-step">
            <span className="home-howto-number">1</span>
            <MapPinIcon className="home-howto-icon" />
            <div className="home-howto-text">
              <h3 className="home-howto-heading">Explore the Map</h3>
              <p className="home-howto-desc">
                Visit map nodes around the park and complete any challenges you find along the way.
              </p>
            </div>
          </li>
          <li className="home-howto-step">
            <span className="home-howto-number">2</span>
            <CameraIcon className="home-howto-icon" />
            <div className="home-howto-text">
              <h3 className="home-howto-heading">Scan QR Codes</h3>
              <p className="home-howto-desc">
                Scan codes around the park to meet Scavenger Hunt characters, score games and puzzles, and learn
                about the animals.
              </p>
            </div>
          </li>
          <li className="home-howto-step">
            <span className="home-howto-number">3</span>
            <GridIcon className="home-howto-icon" />
            <div className="home-howto-text">
              <h3 className="home-howto-heading">Fill Your Bingo Card</h3>
              <p className="home-howto-desc">
                Complete nearby challenges as you go to check off tiles and work toward Bingo milestones.
              </p>
            </div>
          </li>
          <li className="home-howto-step">
            <span className="home-howto-number">4</span>
            <QuestionMarkIcon className="home-howto-icon" />
            <div className="home-howto-text">
              <h3 className="home-howto-heading">Check In Anytime</h3>
              <p className="home-howto-desc">
                Pop open the menu whenever you need it — vote for Photo of the Day, or contact staff.
              </p>
            </div>
          </li>
          <li className="home-howto-step">
            <span className="home-howto-number">5</span>
            <PawIcon className="home-howto-icon" />
            <div className="home-howto-text">
              <h3 className="home-howto-heading">Spend Your Cobb Coins</h3>
              <p className="home-howto-desc">🪙 Cash in the coins you've earned on Collectibles in the shop.</p>
            </div>
          </li>
        </ol>
      </section>

      {lightboxOpen && photoOfTheDay && (
        <PhotoLightbox
          photos={[
            {
              candidates: [photoOfTheDay.photo_url],
              alt: photoOfTheDay.guest_label
                ? `Favorite photo submitted by ${photoOfTheDay.guest_label}`
                : 'Favorite guest photo',
            },
          ]}
          startIndex={0}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  )
}
