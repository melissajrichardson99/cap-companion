import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { api, type HeatmapSource, type HeatmapSummary, type MapNode } from '../api'
import { clearStaffToken } from '../staffAuth'
import { ClipboardIcon } from './NavIcons'
import { StaffAuthGate } from './StaffAuthGate'
import { StaffDateRangePicker, useStaffDateRange } from './StaffDateRangePicker'
import { StaffSidebar } from './StaffSidebar'
// Reuses the guest Map screen's frame/image classes (.map-frame,
// .map-image-wrap, .map-image) so the heatmap sits on the exact same
// background at the exact same x_pct/y_pct positions. The pins themselves are
// NOT shared: MapScreen's pin loop is entangled with pinch-zoom, the mobile
// declutter pass, visit-state icons and the detail popup, none of which
// apply here -- positioning is just left/top percentages, so the heatmap
// renders its own dots rather than refactoring that loop.
import './MapScreen.css'
import './StaffAnalytics.css'
import './StaffHeatmap.css'

// Python's/our backend's weekday names, in calendar display order.
const DAYS: { value: string; label: string }[] = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
]

const SOURCES: { value: HeatmapSource; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'map_node', label: 'Check-ins' },
  { value: 'qr_scan', label: 'QR scans' },
]

const DESTINATION_LABELS: Record<string, string> = {
  hunt_character: 'Hunt character',
  animal: 'Animal',
  scoring_game: 'Scoring game',
  puzzle_challenge: 'Puzzle',
}

function hourLabel(h: number): string {
  if (h === 0 || h === 24) return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

// Single-hue sequential ramp (light -> dark) -- magnitude only, never a
// rainbow. Interpolated in RGB between two steps of one warm hue; dot SIZE
// also scales with the same value, so intensity is never color-alone.
const RAMP_LOW = [253, 214, 170] // #fdd6aa
const RAMP_HIGH = [168, 36, 12] // #a8240c
const ZERO_COLOR = '#9a958c'

// Soft line-break opportunity after each "/" in combined location names
// ("Kangaroos/Wallaroos"), so the narrow phone table breaks them there
// rather than mid-word. <wbr> adds no text, so cell text is unchanged.
function breakableName(name: string): ReactNode {
  const parts = name.split('/')
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <>
          /<wbr />
        </>
      )}
    </Fragment>
  ))
}

function heatColor(t: number): string {
  const c = RAMP_LOW.map((lo, i) => Math.round(lo + (RAMP_HIGH[i] - lo) * t))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

export function StaffHeatmapPage() {
  return <StaffAuthGate>{(onLoggedOut) => <StaffHeatmap onLoggedOut={onLoggedOut} />}</StaffAuthGate>
}

function StaffHeatmap({ onLoggedOut }: { onLoggedOut: () => void }) {
  const range = useStaffDateRange()
  const { start, end } = range
  const [day, setDay] = useState('')
  // '' = unbounded on that side; both '' = all hours.
  const [hourStart, setHourStart] = useState('')
  const [hourEnd, setHourEnd] = useState('')
  const [source, setSource] = useState<HeatmapSource>('all')

  const [nodes, setNodes] = useState<MapNode[] | null>(null)
  const [nodesError, setNodesError] = useState<string | null>(null)
  const [summary, setSummary] = useState<HeatmapSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Guards against an older, slower response landing after a newer filter
  // change and repainting the map with stale counts.
  const requestSeq = useRef(0)

  useEffect(() => {
    api
      .listMapNodes()
      .then((rows) => setNodes(rows.filter((n) => n.parent_node_id == null)))
      .catch((err) => setNodesError(String(err)))
  }, [])

  const hourRangeInvalid = hourStart !== '' && hourEnd !== '' && Number(hourStart) >= Number(hourEnd)

  useEffect(() => {
    // Clear first so a filter change never leaves the previous window's
    // colors on screen while the new counts load.
    setSummary(null)
    setError(null)
    if (hourRangeInvalid) return
    const seq = ++requestSeq.current
    api
      .getHeatmap({
        start,
        end,
        day: day || undefined,
        hourStart: hourStart === '' ? undefined : Number(hourStart),
        hourEnd: hourEnd === '' ? undefined : Number(hourEnd),
        source,
      })
      .then((result) => {
        if (seq === requestSeq.current) setSummary(result)
      })
      .catch((err) => {
        if (seq === requestSeq.current) setError(String(err))
      })
  }, [start, end, day, hourStart, hourEnd, source, hourRangeInvalid])

  const countsById = useMemo(() => new Map((summary?.counts ?? []).map((c) => [c.source_id, c])), [summary])
  const maxVisits = summary?.counts.reduce((max, c) => Math.max(max, c.visits), 0) ?? 0

  const positioned = (nodes ?? []).filter((n) => n.x_pct != null && n.y_pct != null)
  const ranked = (nodes ?? [])
    .map((n) => {
      const c = countsById.get(n.id)
      return { node: n, visits: c?.visits ?? 0, checkIns: c?.check_ins ?? 0, scans: c?.scans ?? 0 }
    })
    .sort((a, b) => b.visits - a.visits || a.node.name.localeCompare(b.node.name))

  return (
    <div className="staff-page">
      <div className="staff-page-header">
        <span className="staff-mode-badge">
          <ClipboardIcon className="staff-mode-badge-icon" />
          Staff Mode
        </span>
        {/* No "Back to Staff Page" button any more: the Staff sidebar
            below is on this page too (72px rail at phone widths), and its
            tabs open /staff on the chosen tab. */}
        <div className="staff-page-header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              clearStaffToken()
              onLoggedOut()
            }}
          >
            Log Out
          </button>
        </div>
      </div>

      <div className="staff-page-body">
        <StaffSidebar currentPage="heatmap" />

        <div className="staff-page-content">
      <section className="staff-heatmap">
        <h1 className="staff-heatmap-title">Visit Heatmap</h1>
        <p className="staff-heatmap-subtitle">
          Every Map check-in and QR scan (repeats included), by location.
        </p>

        <div className="staff-heatmap-filters">
          <StaffDateRangePicker range={range} />
          <label className="staff-heatmap-filter">
            <span>Source</span>
            <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value as HeatmapSource)}>
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="staff-heatmap-filter">
            <span>Day</span>
            <select aria-label="Day of week" value={day} onChange={(e) => setDay(e.target.value)}>
              <option value="">All days</option>
              {DAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="staff-heatmap-filter">
            <span>From</span>
            <select aria-label="Hour start" value={hourStart} onChange={(e) => setHourStart(e.target.value)}>
              <option value="">All hours</option>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <label className="staff-heatmap-filter">
            <span>To</span>
            <select aria-label="Hour end" value={hourEnd} onChange={(e) => setHourEnd(e.target.value)}>
              <option value="">All hours</option>
              {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="staff-heatmap-tz-note" data-testid="heatmap-tz-note">
          Dates, days and hours shown in park time (Alberta), whatever timezone this device is in.
        </p>

        {hourRangeInvalid && <p className="screen-error">The "To" hour must be later than the "From" hour.</p>}
        {error && <p className="screen-error">Couldn't load heatmap: {error}</p>}
        {nodesError && <p className="screen-error">Couldn't load the park map: {nodesError}</p>}

        <div className="staff-heatmap-summary" aria-live="polite">
          {summary ? (
            <span data-testid="heatmap-total">
              {summary.total_visits} visit{summary.total_visits === 1 ? '' : 's'} in this window
            </span>
          ) : (
            !error && !hourRangeInvalid && <span className="staff-photos-loading">Loading heatmap…</span>
          )}
        </div>

        <div className="map-frame staff-heatmap-frame">
          <div className="map-zoom-viewport staff-heatmap-viewport">
            <div className="map-image-wrap">
              <img src="/park-map.png" alt="Cobb's Adventure Park map" className="map-image" />
              {summary &&
                positioned.map((node) => {
                  const visits = countsById.get(node.id)?.visits ?? 0
                  const t = maxVisits > 0 ? visits / maxVisits : 0
                  const size = visits === 0 ? 10 : 16 + 26 * t
                  const style = {
                    left: `${node.x_pct}%`,
                    top: `${node.y_pct}%`,
                    width: `${size}px`,
                    height: `${size}px`,
                    background: visits === 0 ? ZERO_COLOR : heatColor(t),
                  } as CSSProperties
                  const label = `${node.name}: ${visits} visit${visits === 1 ? '' : 's'}`
                  return (
                    <span
                      key={node.id}
                      className={`staff-heatmap-dot${visits === 0 ? ' staff-heatmap-dot-zero' : ''}`}
                      style={style}
                      title={label}
                      role="img"
                      aria-label={label}
                      data-node-name={node.name}
                      data-visits={visits}
                    />
                  )
                })}
            </div>
          </div>
        </div>

        <div className="staff-heatmap-legend" aria-label="Heatmap legend">
          <span className="staff-heatmap-legend-zero">
            <span className="staff-heatmap-legend-zero-swatch" aria-hidden="true" />
            No visits
          </span>
          <span className="staff-heatmap-legend-scale">
            <span>Low{summary && maxVisits > 0 ? ' (1)' : ''}</span>
            <span
              className="staff-heatmap-legend-bar"
              aria-hidden="true"
              style={{ background: `linear-gradient(to right, ${heatColor(0)}, ${heatColor(1)})` }}
            />
            <span>High{summary && maxVisits > 0 ? ` (${maxVisits})` : ''}</span>
          </span>
        </div>

        {summary && source !== 'map_node' && (
          <p className="staff-heatmap-unmapped" data-testid="heatmap-unmapped">
            {summary.unmapped_scans === 0
              ? 'No unmapped QR scans in this window.'
              : `${summary.unmapped_scans} unmapped QR scan${summary.unmapped_scans === 1 ? '' : 's'} in this window ` +
                `(no map location, so not on the map): ` +
                summary.unmapped
                  .map((u) => `${DESTINATION_LABELS[u.destination_type] ?? u.destination_type} "${u.destination_id}" (${u.scans})`)
                  .join(', ') +
                ". Set locations in the Staff Page's QR Codes tab."}
          </p>
        )}

        {summary && nodes && (
          <table className="staff-heatmap-table">
            <caption>Visits by location</caption>
            <thead>
              <tr>
                <th scope="col">Location</th>
                <th scope="col">Visits</th>
                <th scope="col">Check-ins</th>
                <th scope="col">QR scans</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ node, visits, checkIns, scans }) => (
                <tr key={node.id} data-node-name={node.name}>
                  <td>{breakableName(node.name)}</td>
                  <td>{visits}</td>
                  <td>{checkIns}</td>
                  <td>{scans}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
        </div>
      </div>
    </div>
  )
}
