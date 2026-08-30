// Home page "Today at Cobb's" card closing-time countdown, computed
// client-side against PARK_OPEN_TIME/PARK_CLOSE_TIME (homePageContent.ts).

import { PARK_CLOSE_TIME, PARK_OPEN_TIME } from './homePageContent'

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

function formatClockTime(hour: number, minute: number): string {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h`
  return `${minutes}m`
}

// Returns null when the park isn't open at all today -- that state is
// already conveyed by the "Closed Today" badge, so no separate countdown
// text is needed. On an open day, returns one of three sensible states:
// before opening, currently open (a live countdown to close), or after
// today's closing time.
export function getClosingStatusText(now: Date, isOpenToday: boolean): string | null {
  if (!isOpenToday) return null

  const nowMinutes = minutesSinceMidnight(now)
  const openMinutes = PARK_OPEN_TIME.hour * 60 + PARK_OPEN_TIME.minute
  const closeMinutes = PARK_CLOSE_TIME.hour * 60 + PARK_CLOSE_TIME.minute

  if (nowMinutes < openMinutes) {
    return `Opens at ${formatClockTime(PARK_OPEN_TIME.hour, PARK_OPEN_TIME.minute)}`
  }
  if (nowMinutes >= closeMinutes) {
    return 'Closed for today'
  }
  return `Closes in ${formatDuration(closeMinutes - nowMinutes)}`
}
