// Static content for the Home page (Plan.md build-priority item 4). No admin
// UI/DB table by design -- Melissa edits these values directly whenever the
// schedule, hours, or announcements change.

export const ANIMAL_SHOW_TIMES: string[] = ['12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM']

export const TRACTOR_RIDE_TIMES: string[] = [
  '11:30 AM',
  '12:00 PM',
  '12:30 PM',
  '1:00 PM',
  '1:30 PM',
  '2:00 PM',
  '2:30 PM',
  '3:00 PM',
  '3:30 PM',
  '4:00 PM',
  '4:30 PM',
]

export const PARK_HOURS_TEXT = 'Wednesday – Sunday, 11:00 AM – 5:00 PM'

// JS Date.getDay() values (0 = Sunday ... 6 = Saturday) the park is open on.
// Closed Monday (1) and Tuesday (2).
export const PARK_OPEN_DAYS: number[] = [0, 3, 4, 5, 6]

export interface Announcement {
  id: string
  text: string
}

export const ANNOUNCEMENTS: Announcement[] = [
  { id: 'capybara-experience-2026', text: 'Capybara Animal Experiences are included with general admission this year!' },
]

// PLACEHOLDER -- update to the park's real coordinates. Used only for the
// "Today at Cobb's" card's weather fetch (Open-Meteo, no API key required).
export const PARK_WEATHER_LOCATION = {
  label: 'Placeholder location — update PARK_WEATHER_LOCATION',
  latitude: 51.0447,
  longitude: -114.0719,
}
