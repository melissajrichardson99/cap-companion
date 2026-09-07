// Home page "Today at Cobb's" card status line: a live "Closes in Xh Ym"
// countdown while open, or an "Opens..." message/countdown while closed --
// driven by the real seasonal schedule in parkSchedule.ts rather than a
// fixed daily one.

import { getParkStatus, isScheduledOpenToday, type OpenOccurrence } from './parkSchedule'

function formatClockTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatWeekday(date: Date): string {
  return date.toLocaleDateString([], { weekday: 'long' })
}

function formatAbsoluteDate(date: Date): string {
  return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h`
  return `${minutes}m`
}

function daysBetweenLocalDays(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((utcB - utcA) / msPerDay)
}

// Near openings (today/tomorrow/this week) read as a plain clock time --
// a literal ticking countdown only makes sense for "closes in" today.
// Far-future openings (the Nov-Apr off-season can be months away) fall back
// to a day count and then an absolute date, so this never renders as a
// months-long countdown ticking in real time.
function formatOpensText(now: Date, nextOpen: OpenOccurrence): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysUntil = daysBetweenLocalDays(today, nextOpen.date)
  const openClock = formatClockTime(nextOpen.openTime)

  if (daysUntil === 0) return `Opens at ${openClock}`
  if (daysUntil === 1) return `Opens tomorrow at ${openClock}`
  if (daysUntil <= 6) return `Opens ${formatWeekday(nextOpen.date)} at ${openClock}`
  if (daysUntil <= 27) return `Opens in ${daysUntil} days`
  return `Opens ${formatAbsoluteDate(nextOpen.date)}`
}

export interface ParkStatusDisplay {
  // Backs the "Open Today"/"Closed Today" badge -- true for the entire day
  // the park has a scheduled window, even before it opens or after it closes.
  isOpenToday: boolean
  statusText: string
}

export function getParkStatusDisplay(now: Date): ParkStatusDisplay {
  const isOpenToday = isScheduledOpenToday(now)
  const status = getParkStatus(now)

  if (status.status === 'open') {
    const minutesLeft = Math.round((status.closeTime.getTime() - now.getTime()) / 60_000)
    return { isOpenToday, statusText: `Closes in ${formatDuration(minutesLeft)}` }
  }
  return { isOpenToday, statusText: formatOpensText(now, status.nextOpen) }
}
