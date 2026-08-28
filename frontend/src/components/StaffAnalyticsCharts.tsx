// Lightweight, dependency-free chart building blocks for the Staff Page
// Analytics dashboard -- no charting library exists in this app today
// (package.json has none), so these stay inline SVG / CSS instead of adding
// one for three chart shapes.

interface LinePoint {
  date: string
  value: number
}

// Daily trend line -- Users Over Time, Full Completionist Rate Over Time.
export function DailyLineChart({ points, valueSuffix = '' }: { points: LinePoint[]; valueSuffix?: string }) {
  if (points.length === 0) return <p className="staff-photos-empty">No data in this range.</p>

  const width = 280
  const height = 90
  const padding = 6
  const max = Math.max(...points.map((p) => p.value), 1)
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0
  const coords = points.map((p, i) => ({
    x: padding + i * stepX,
    y: height - padding - (p.value / max) * (height - padding * 2),
    ...p,
  }))
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${height - padding} L${coords[0].x.toFixed(1)},${height - padding} Z`
  const summary = `${points[0].date} to ${points[points.length - 1].date}: ${points.map((p) => `${p.value}${valueSuffix}`).join(', ')}`

  return (
    <svg className="staff-analytics-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary}>
      <path d={areaPath} className="staff-analytics-line-area" />
      <path d={linePath} className="staff-analytics-line-stroke" />
      {coords.map((c) => (
        <circle key={c.date} cx={c.x} cy={c.y} r={2} className="staff-analytics-line-dot" />
      ))}
      <text x={padding} y={height - 2} className="staff-analytics-line-axis-label">
        {points[0].date.slice(5)}
      </text>
      <text x={width - padding} y={height - 2} textAnchor="end" className="staff-analytics-line-axis-label">
        {points[points.length - 1].date.slice(5)}
      </text>
    </svg>
  )
}

interface BarItem {
  label: string
  value: number
}

// Horizontal bar list -- per-character found %, most-purchased animal,
// most/least-visited map nodes. Plain flex divs with a width percentage
// rather than SVG -- there's no axis/scale math worth a chart library here.
export function HorizontalBarList({
  items,
  format = (value: number) => `${value}`,
}: {
  items: BarItem[]
  format?: (value: number) => string
}) {
  if (items.length === 0) return <p className="staff-photos-empty">No data in this range.</p>
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <div className="staff-analytics-bar-list">
      {items.map((item) => (
        <div key={item.label} className="staff-analytics-bar-row">
          <span className="staff-analytics-bar-label">{item.label}</span>
          <div className="staff-analytics-bar-track">
            <div className="staff-analytics-bar-fill" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
          <span className="staff-analytics-bar-value">{format(item.value)}</span>
        </div>
      ))}
    </div>
  )
}

interface DonutSegment {
  label: string
  value: number
  color: string
}

// Two/three-way split donut (Staff Ops: General vs. Emergency) -- a CSS
// conic-gradient circle, no SVG arc math needed for this few segments.
export function SplitDonut({ segments }: { segments: DonutSegment[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  if (total === 0) return <p className="staff-photos-empty">No data in this range.</p>

  let cumulativePct = 0
  const stops = segments.map((s) => {
    const pct = (s.value / total) * 100
    const stop = `${s.color} ${cumulativePct}% ${cumulativePct + pct}%`
    cumulativePct += pct
    return stop
  })

  return (
    <div className="staff-analytics-donut-row">
      <div className="staff-analytics-donut" style={{ background: `conic-gradient(${stops.join(', ')})` }} />
      <ul className="staff-analytics-donut-legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="staff-analytics-donut-swatch" style={{ background: s.color }} />
            {s.label}: {s.value} ({total ? Math.round((s.value / total) * 100) : 0}%)
          </li>
        ))}
      </ul>
    </div>
  )
}
