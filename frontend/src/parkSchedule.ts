// Real seasonal operating schedule for Cobb's Adventure Park (Home Page
// "Today at Cobb's" card). Replaces the old fixed Wed-Sun hardcoded schedule.
// Everything here is computed per-year (nth-weekday-of-month / statutory
// holiday math) rather than hardcoded to specific calendar dates, so it
// stays correct in future years without manual updates.
//
// Season shape:
//   Nov - Apr: closed entirely, no exceptions.
//   May & Jun: Sat/Sun only, plus Victoria Day.
//   Jul & Aug: Wed-Sun, plus Canada Day (only if it lands Mon/Tue) and
//              Heritage Day (Alberta civic holiday, always Mon so it always
//              qualifies as an additional day).
//   Sep & Oct: Fri-Sun, plus Labour Day and Thanksgiving.
// All open days share the same 11:00 AM - 5:00 PM hours.

export const PARK_OPEN_HOUR = 11
export const PARK_CLOSE_HOUR = 17

const SUNDAY = 0
const MONDAY = 1
const TUESDAY = 2
const WEDNESDAY = 3

export interface DaySchedule {
  isOpen: boolean
  openTime?: Date
  closeTime?: Date
}

export interface OpenOccurrence {
  date: Date
  openTime: Date
  closeTime: Date
}

export type ParkStatus = { status: 'open'; closeTime: Date } | { status: 'closed'; nextOpen: OpenOccurrence }

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function atTime(date: Date, hour: number, minute = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0)
}

// nth (1-indexed) occurrence of `weekday` in `month` of `year`.
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1)
  const offset = (weekday - first.getDay() + 7) % 7
  return new Date(year, month, 1 + offset + (n - 1) * 7)
}

// Last `weekday` on or before the given day-of-month.
function lastWeekdayOnOrBefore(year: number, month: number, day: number, weekday: number): Date {
  const d = new Date(year, month, day)
  const diff = (d.getDay() - weekday + 7) % 7
  d.setDate(d.getDate() - diff)
  return d
}

export function getVictoriaDay(year: number): Date {
  return lastWeekdayOnOrBefore(year, 4, 24, MONDAY) // May 24
}

export function getCanadaDay(year: number): Date {
  return new Date(year, 6, 1) // July 1, fixed date
}

// Canada Day only counts as an additional park-open day when it falls on a
// Monday or Tuesday (otherwise it's already within/adjacent to the regular
// Jul/Aug Wed-Sun window or on a day the park would be closed anyway).
export function getCanadaDayIfQualifying(year: number): Date | null {
  const canadaDay = getCanadaDay(year)
  const day = canadaDay.getDay()
  return day === MONDAY || day === TUESDAY ? canadaDay : null
}

export function getHeritageDay(year: number): Date {
  return nthWeekdayOfMonth(year, 7, MONDAY, 1) // first Monday of August
}

export function getLabourDay(year: number): Date {
  return nthWeekdayOfMonth(year, 8, MONDAY, 1) // first Monday of September
}

export function getThanksgiving(year: number): Date {
  return nthWeekdayOfMonth(year, 9, MONDAY, 2) // second Monday of October
}

// Whether the park is open on the given calendar day, and its hours if so.
// Only the year/month/date of `date` are used -- time-of-day is ignored.
export function getScheduleForDate(date: Date): DaySchedule {
  const year = date.getFullYear()
  const month = date.getMonth() // 0-indexed: 4 = May, 9 = October
  const day = date.getDay()
  let isOpenDay = false

  if (month === 4 || month === 5) {
    // May & June: Sat/Sun, plus Victoria Day.
    isOpenDay = day === SUNDAY || day === 6
    if (!isOpenDay && isSameLocalDay(date, getVictoriaDay(year))) isOpenDay = true
  } else if (month === 6 || month === 7) {
    // July & August: Wed-Sun, plus qualifying Canada Day and Heritage Day.
    isOpenDay = day === SUNDAY || day >= WEDNESDAY
    if (!isOpenDay) {
      const canadaDay = getCanadaDayIfQualifying(year)
      if (canadaDay && isSameLocalDay(date, canadaDay)) isOpenDay = true
      if (!isOpenDay && isSameLocalDay(date, getHeritageDay(year))) isOpenDay = true
    }
  } else if (month === 8 || month === 9) {
    // September & October: Fri-Sun, plus Labour Day and Thanksgiving.
    isOpenDay = day === SUNDAY || day === 5 || day === 6
    if (!isOpenDay) {
      if (isSameLocalDay(date, getLabourDay(year))) isOpenDay = true
      if (!isOpenDay && isSameLocalDay(date, getThanksgiving(year))) isOpenDay = true
    }
  }
  // Nov (10) - Apr (3): closed for the season, no exceptions.

  if (!isOpenDay) return { isOpen: false }
  return { isOpen: true, openTime: atTime(date, PARK_OPEN_HOUR), closeTime: atTime(date, PARK_CLOSE_HOUR) }
}

// Searches forward day-by-day from `fromDate` (inclusive) for the next open
// day. Capped at ~2 seasons out, which comfortably covers the longest
// possible gap (end of October to the following May's first open Saturday).
export function findNextOpenOccurrence(fromDate: Date): OpenOccurrence {
  const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate())
  for (let i = 0; i < 800; i++) {
    const schedule = getScheduleForDate(cursor)
    if (schedule.isOpen && schedule.openTime && schedule.closeTime) {
      return { date: new Date(cursor), openTime: schedule.openTime, closeTime: schedule.closeTime }
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  throw new Error('No open day found within search window')
}

// The park's status at a precise instant: currently open (with the closing
// time), or closed (with the next open occurrence, which may be later today,
// a future day this week, or -- off-season -- months away).
export function getParkStatus(now: Date): ParkStatus {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todaySchedule = getScheduleForDate(today)
  if (todaySchedule.isOpen && todaySchedule.openTime && todaySchedule.closeTime) {
    if (now >= todaySchedule.openTime && now < todaySchedule.closeTime) {
      return { status: 'open', closeTime: todaySchedule.closeTime }
    }
    if (now < todaySchedule.openTime) {
      return {
        status: 'closed',
        nextOpen: { date: today, openTime: todaySchedule.openTime, closeTime: todaySchedule.closeTime },
      }
    }
  }
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return { status: 'closed', nextOpen: findNextOpenOccurrence(tomorrow) }
}

// Whether today has a scheduled open window at all, independent of whether
// that window has started/ended yet -- backs the "Open Today"/"Closed Today"
// badge, which stays "Open Today" all day on a day the park opens.
export function isScheduledOpenToday(now: Date): boolean {
  return getScheduleForDate(now).isOpen
}
