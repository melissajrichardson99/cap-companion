// Pure logic tests for the real seasonal park schedule (parkSchedule.ts) and
// its Home page status-text formatting (parkStatusText.ts). These run as
// plain Playwright tests with no `page` fixture and no dev server -- just
// Node-side assertions against the date math -- since the thing under test
// is the schedule/holiday computation itself, not any rendered UI (that's
// covered by home-page.spec.ts's 'park status' describe block instead).
//
// Expected dates below were derived independently (by hand, cross-checked
// against plain `Date`/`toLocaleDateString` weekday lookups) rather than by
// re-running the code under test, so these assertions can actually catch a
// wrong nth-weekday/holiday calculation instead of just restating it.
import { test, expect } from '@playwright/test'
import {
  getCanadaDayIfQualifying,
  getHeritageDay,
  getLabourDay,
  getParkStatus,
  getScheduleForDate,
  getThanksgiving,
  getVictoriaDay,
  isScheduledOpenToday,
} from '../src/parkSchedule'
import { getParkStatusDisplay } from '../src/parkStatusText'

function expectSameDay(actual: Date, year: number, month: number, day: number) {
  expect(actual.getFullYear()).toBe(year)
  expect(actual.getMonth()).toBe(month)
  expect(actual.getDate()).toBe(day)
}

test.describe('holiday computation is per-year, not hardcoded', () => {
  test('Victoria Day: last Monday on/before May 24', () => {
    // May 24 2026 is a Sunday -> last Monday on/before is May 18.
    expectSameDay(getVictoriaDay(2026), 2026, 4, 18)
    // May 24 2027 is itself a Monday -> Victoria Day is May 24 2027.
    expectSameDay(getVictoriaDay(2027), 2027, 4, 24)
  })

  test('Heritage Day: first Monday of August', () => {
    expectSameDay(getHeritageDay(2026), 2026, 7, 3)
    expectSameDay(getHeritageDay(2027), 2027, 7, 2)
  })

  test('Labour Day: first Monday of September', () => {
    expectSameDay(getLabourDay(2026), 2026, 8, 7)
    expectSameDay(getLabourDay(2027), 2027, 8, 6)
  })

  test('Thanksgiving: second Monday of October', () => {
    expectSameDay(getThanksgiving(2026), 2026, 9, 12)
    expectSameDay(getThanksgiving(2027), 2027, 9, 11)
  })

  test('Canada Day only qualifies as an extra open day on a Monday or Tuesday', () => {
    // July 1 2025 is a Tuesday -> qualifies.
    const qualifying = getCanadaDayIfQualifying(2025)
    expect(qualifying).not.toBeNull()
    expectSameDay(qualifying as Date, 2025, 6, 1)

    // July 1 2026 is a Wednesday -> does not qualify (already an open day
    // via the regular Jul/Aug Wed-Sun window regardless).
    expect(getCanadaDayIfQualifying(2026)).toBeNull()
  })
})

test.describe('getScheduleForDate: which days are open', () => {
  test('off-season (Nov-Apr) is closed with no exceptions', () => {
    expect(getScheduleForDate(new Date(2026, 11, 25)).isOpen).toBe(false) // Christmas
    expect(getScheduleForDate(new Date(2027, 1, 14)).isOpen).toBe(false) // mid-Feb
    expect(getScheduleForDate(new Date(2027, 3, 1)).isOpen).toBe(false) // Apr 1
  })

  test('May/June: open Sat/Sun, plus Victoria Day; closed other weekdays', () => {
    expect(getScheduleForDate(new Date(2026, 4, 16)).isOpen).toBe(true) // Sat May 16
    expect(getScheduleForDate(new Date(2026, 4, 18)).isOpen).toBe(true) // Victoria Day (Mon)
    expect(getScheduleForDate(new Date(2026, 4, 11)).isOpen).toBe(false) // ordinary Monday
    expect(getScheduleForDate(new Date(2026, 4, 12)).isOpen).toBe(false) // ordinary Tuesday
  })

  test('July/August: open Wed-Sun, plus qualifying Canada Day and Heritage Day', () => {
    expect(getScheduleForDate(new Date(2026, 6, 15)).isOpen).toBe(true) // ordinary Wed Jul 15
    expect(getScheduleForDate(new Date(2026, 7, 3)).isOpen).toBe(true) // Heritage Day (Mon)
    // Canada Day 2025 (Tuesday) is open only because it qualifies -- Tuesday
    // is otherwise a closed weekday in Jul/Aug.
    expect(getScheduleForDate(new Date(2025, 6, 1)).isOpen).toBe(true) // Canada Day 2025 (Tue, qualifies)
    // Canada Day 2026 (Wednesday, non-qualifying) is still open, but only
    // because Wednesday is already in the regular Wed-Sun window.
    expect(getScheduleForDate(new Date(2026, 6, 1)).isOpen).toBe(true)
    // An ordinary non-holiday Tuesday in July is closed.
    expect(getScheduleForDate(new Date(2026, 6, 7)).isOpen).toBe(false)
  })

  test('September/October: open Fri-Sun, plus Labour Day and Thanksgiving', () => {
    expect(getScheduleForDate(new Date(2026, 9, 2)).isOpen).toBe(true) // ordinary Fri Oct 2
    expect(getScheduleForDate(new Date(2026, 8, 7)).isOpen).toBe(true) // Labour Day (Mon)
    expect(getScheduleForDate(new Date(2026, 9, 12)).isOpen).toBe(true) // Thanksgiving (Mon)
    expect(getScheduleForDate(new Date(2026, 8, 2)).isOpen).toBe(false) // ordinary Wed Sep 2 -- no longer open
    expect(getScheduleForDate(new Date(2026, 8, 8)).isOpen).toBe(false) // ordinary Tue (day after Labour Day)
  })

  test('open days all use 11:00 AM - 5:00 PM hours', () => {
    const schedule = getScheduleForDate(new Date(2026, 4, 16)) // Sat May 16
    expect(schedule.openTime?.getHours()).toBe(11)
    expect(schedule.openTime?.getMinutes()).toBe(0)
    expect(schedule.closeTime?.getHours()).toBe(17)
    expect(schedule.closeTime?.getMinutes()).toBe(0)
  })
})

test.describe('getParkStatus / getParkStatusDisplay: countdown directions', () => {
  test('before opening on an open day: closed, next-open is later today', () => {
    const status = getParkStatus(new Date(2026, 8, 4, 9, 30)) // Fri Sep 4, 9:30am
    expect(status.status).toBe('closed')
    if (status.status === 'closed') {
      expectSameDay(status.nextOpen.date, 2026, 8, 4)
      expect(status.nextOpen.openTime.getHours()).toBe(11)
    }
    expect(isScheduledOpenToday(new Date(2026, 8, 4, 9, 30))).toBe(true)
    expect(getParkStatusDisplay(new Date(2026, 8, 4, 9, 30)).statusText).toMatch(/^Opens at 11:00/)
  })

  test('during open hours: open, with minutes remaining until close', () => {
    const status = getParkStatus(new Date(2026, 8, 4, 14, 45)) // Fri Sep 4, 2:45pm
    expect(status.status).toBe('open')
    if (status.status === 'open') {
      expect(status.closeTime.getHours()).toBe(17)
    }
    expect(getParkStatusDisplay(new Date(2026, 8, 4, 14, 45)).statusText).toBe('Closes in 2h 15m')
  })

  test('after closing, same day still open-today but next-open rolls to tomorrow', () => {
    const now = new Date(2026, 8, 4, 18, 0) // Fri Sep 4, 6pm (closed for the day)
    const status = getParkStatus(now)
    expect(status.status).toBe('closed')
    if (status.status === 'closed') {
      expectSameDay(status.nextOpen.date, 2026, 8, 5) // Saturday, tomorrow
    }
    expect(isScheduledOpenToday(now)).toBe(true) // today itself was still an open day
    expect(getParkStatusDisplay(now).statusText).toMatch(/^Opens tomorrow at 11:00/)
  })

  test('closed day mid-week finds next open day within the same week', () => {
    const now = new Date(2026, 4, 11, 10, 0) // Mon May 11 (closed; not Victoria Day)
    const display = getParkStatusDisplay(now)
    expect(display.isOpenToday).toBe(false)
    expect(display.statusText).toMatch(/^Opens Saturday at 11:00/)
  })

  test('off-season, close to the upcoming season: shows a day count, not a date or literal countdown', () => {
    const now = new Date(2027, 3, 20) // Apr 20 2027, 11 days before May 1 2027 opening
    const display = getParkStatusDisplay(now)
    expect(display.isOpenToday).toBe(false)
    expect(display.statusText).toBe('Opens in 11 days')
  })

  test('season-boundary search: after the season closes, correctly finds next May, months out', () => {
    // Nov 2 2026 -- the season's last open weekend was Oct 30-31 (Fri/Sat,
    // still within the Sept/Oct Fri-Sun window), so this is safely into the
    // unconditional Nov-Apr closure, not a date that could still find an
    // open day left over in October.
    const now = new Date(2026, 10, 2, 12, 0)
    const status = getParkStatus(now)
    expect(status.status).toBe('closed')
    if (status.status === 'closed') {
      // Next open day is the following May's first open Saturday, not
      // anything left in the current Oct/Nov.
      expectSameDay(status.nextOpen.date, 2027, 4, 1)
    }
    // Far enough out that this renders as an absolute date, never a
    // multi-month countdown ticking in real time.
    expect(getParkStatusDisplay(now).statusText).toBe('Opens May 1, 2027')
  })

  test('deep off-season (December, February) also resolves to next May without error', () => {
    expect(getParkStatusDisplay(new Date(2026, 11, 25)).statusText).toMatch(/^Opens /)
    expect(getParkStatusDisplay(new Date(2027, 1, 14)).statusText).toMatch(/^Opens /)
  })
})
