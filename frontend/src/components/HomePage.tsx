import { useEffect, useState } from 'react'
import { api, type PhotoSubmission } from '../api'
import {
  ANIMAL_SHOW_TIMES,
  ANNOUNCEMENTS,
  GOOGLE_REVIEW_URL,
  PARK_HOURS_TEXT,
  PARK_OPEN_DAYS,
  PARK_WEATHER_LOCATION,
  TODAY_CARD_PHOTO_SRC,
  TRACTOR_RIDE_TIMES_EAST,
  TRACTOR_RIDE_TIMES_WEST,
} from '../homePageContent'
import { fetchCurrentWeather, type CurrentWeather } from '../weather'
import { CameraIcon, HomeIcon } from './NavIcons'
import './HomePage.css'

interface HomePageProps {
  onBrowsePhotos: () => void
}

// True root route (Plan.md build-priority item 4): a real landing page
// instead of guests just falling into whichever tab happens to be default.
// Schedule/hours/announcements are static (homePageContent.ts, edited
// directly in code) -- the only live network call on this page is the
// weather fetch, and it's designed to fail without blocking anything else
// from rendering (see the weatherFailed branch below).
export function HomePage({ onBrowsePhotos }: HomePageProps) {
  const [weather, setWeather] = useState<CurrentWeather | null>(null)
  const [weatherFailed, setWeatherFailed] = useState(false)

  // undefined = still loading, null = loaded but no shortlisted photos yet.
  const [photoOfTheDay, setPhotoOfTheDay] = useState<PhotoSubmission | null | undefined>(undefined)
  const [photoFailed, setPhotoFailed] = useState(false)

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

  const isOpenToday = PARK_OPEN_DAYS.includes(new Date().getDay())

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
          <button type="button" className="btn home-photo-cta-btn" onClick={onBrowsePhotos}>
            Browse &amp; Vote
          </button>
        </section>
      </div>

      <div className="home-side-by-side">
        {ANNOUNCEMENTS.length > 0 && (
          <section className="home-card cap-parchment-card">
            <h2 className="home-section-title">Announcements</h2>
            <ul className="home-announcements-list">
              {ANNOUNCEMENTS.map((a) => (
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
    </div>
  )
}
