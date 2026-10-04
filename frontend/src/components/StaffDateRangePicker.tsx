import { useMemo, useState } from 'react'

// Shared by Staff Analytics and the Staff Visit Heatmap -- extracted from
// StaffAnalytics.tsx as-is (same markup/classes/labels, so existing e2e
// selectors like the "7D"/"Custom" buttons and "Range start"/"Range end"
// inputs keep working). Styles live in StaffAnalytics.css.

type RangePreset = '7d' | 'custom'

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export const TODAY = isoDate(new Date())

// 30D/90D are deferred until the app has real accumulated post-launch usage
// data to make them meaningful -- only 7D and Custom for now.
function presetRange(): { start: string; end: string } {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return { start: isoDate(start), end: isoDate(end) }
}

export interface StaffDateRange {
  preset: RangePreset
  setPreset: (preset: RangePreset) => void
  customStart: string
  setCustomStart: (value: string) => void
  customEnd: string
  setCustomEnd: (value: string) => void
  // Resolved YYYY-MM-DD bounds for whichever preset is active.
  start: string
  end: string
}

export function useStaffDateRange(): StaffDateRange {
  const [preset, setPreset] = useState<RangePreset>('7d')
  const [customStart, setCustomStart] = useState(() => presetRange().start)
  const [customEnd, setCustomEnd] = useState(TODAY)

  const { start, end } = useMemo(
    () => (preset === 'custom' ? { start: customStart, end: customEnd } : presetRange()),
    [preset, customStart, customEnd],
  )

  return { preset, setPreset, customStart, setCustomStart, customEnd, setCustomEnd, start, end }
}

export function StaffDateRangePicker({ range }: { range: StaffDateRange }) {
  const { preset, setPreset, customStart, setCustomStart, customEnd, setCustomEnd } = range
  return (
    <div className="staff-analytics-range" role="group" aria-label="Date range">
      <button
        type="button"
        className={`staff-animal-picker-btn ${preset === '7d' ? 'staff-animal-picker-btn-active' : ''}`}
        onClick={() => setPreset('7d')}
      >
        7D
      </button>
      <button
        type="button"
        className={`staff-animal-picker-btn ${preset === 'custom' ? 'staff-animal-picker-btn-active' : ''}`}
        onClick={() => setPreset('custom')}
      >
        Custom
      </button>
      {preset === 'custom' && (
        <span className="staff-analytics-custom-range">
          <input
            type="date"
            aria-label="Range start"
            value={customStart}
            max={customEnd}
            onChange={(e) => setCustomStart(e.target.value)}
          />
          <span aria-hidden="true">–</span>
          <input
            type="date"
            aria-label="Range end"
            value={customEnd}
            min={customStart}
            max={TODAY}
            onChange={(e) => setCustomEnd(e.target.value)}
          />
        </span>
      )}
    </div>
  )
}
