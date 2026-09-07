// Static content for the Home page (Plan.md build-priority item 4). No admin
// UI/DB table by design -- Melissa edits these values directly whenever the
// schedule, hours, or announcements change.

// Single named constant for the "Today at Cobb's" card photo so swapping in
// a real park photo later is trivial -- either replace the file at this
// public/ path in place, or point this string at a new one. A plain public/
// path (not a src/assets ES import) deliberately, since this file is also
// imported directly by e2e specs under Node/Playwright, which doesn't share
// Vite's asset-import pipeline.
export const TODAY_CARD_PHOTO_SRC = '/home-image.jpg'

export const ANIMAL_SHOW_TIMES: string[] = ['12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM']

// Tractor Rides run from two separate locations (Home Page redesign): West
// departs on the hour, East on the half hour, both spanning the park's
// operating hours (11 AM - 5 PM every open day -- see parkSchedule.ts for
// which days those are) rather than a hardcoded guess. West deliberately
// excludes the 11 AM/5 PM edge times (opening/closing hour) -- interior
// on-the-hour departures only.
export const TRACTOR_RIDE_TIMES_WEST: string[] = ['12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM']

export const TRACTOR_RIDE_TIMES_EAST: string[] = [
  '11:30 AM',
  '12:30 PM',
  '1:30 PM',
  '2:30 PM',
  '3:30 PM',
  '4:30 PM',
]

// The park's real open days/hours are seasonal (May-Oct only, with
// month-dependent weekday windows plus statutory-holiday exceptions) --
// see parkSchedule.ts for the computed schedule and parkStatusText.ts for
// the Home page's "Closes in.../Opens..." display built on top of it.

// Announcements are staff-managed and live (Staff Page "Announcements" tab,
// backend/app/routers/announcements.py) -- see api.ts's Announcement type
// and HomePage.tsx, not this file.

// PLACEHOLDER -- update to the park's real coordinates. Used only for the
// "Today at Cobb's" card's weather fetch (Open-Meteo, no API key required).
export const PARK_WEATHER_LOCATION = {
  label: 'Placeholder location — update PARK_WEATHER_LOCATION',
  latitude: 51.0447,
  longitude: -114.0719,
}

// Google review link for the "Leave a Review, Get a Treat!" card. Redemption
// (free General Store item) is honor-system, handled face-to-face at the
// counter -- entirely outside the app, no tracking here.
export const GOOGLE_REVIEW_URL =
  'https://www.google.com/search?sxsrf=APpeQns_oPJCBvpypNTZ931Hb-38Ga3ljg:1786723860289&q=cobbs+adventure+park+reviews&si=APenkKm7iecQ4G6P-TsbSMFKIQtv3EFIqRAFw-i8uEbk55Z-_w6AwaS0TAFvbTEXr-lcuo1zEqcud4eoM3brwIlk1_ninFOt4QSd8Y1ptoN-F7XSVNyQQNyaOx9dCoOVHUMKRYkIYBLZn0oeaV0aOKdl2ycEl4O9ow%3D%3D'
