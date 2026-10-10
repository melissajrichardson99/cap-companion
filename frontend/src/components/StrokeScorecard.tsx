import type { ScoreSheetSession } from '../api'

// Players-by-holes scorecard for stroke play, plus a total column. Scrolls
// horizontally with a sticky player-name column when the holes don't fit
// (9 to 12 holes at 390px). Filled cells are buttons when onCellTap is
// given, so an earlier score can be corrected through the same keypad and
// confirm flow.

interface StrokeScorecardProps {
  session: ScoreSheetSession
  currentHole?: number | null
  onCellTap?: (hole: number, player: string) => void
}

export function StrokeScorecard({ session, currentHole, onCellTap }: StrokeScorecardProps) {
  const holes = Array.from({ length: session.hole_count ?? 0 }, (_, i) => i + 1)
  const scoreAt = (hole: number, player: string) =>
    session.hole_scores.find((s) => s.hole_number === hole && s.player_name === player)?.strokes ?? null
  const highlighted = session.completed_at ? new Set(session.winners) : new Set(session.leaders)

  return (
    <div className="stroke-scorecard-scroll" role="region" aria-label="Scorecard" tabIndex={0}>
      <table className="stroke-scorecard">
        <thead>
          <tr>
            <th className="stroke-scorecard-name" scope="col">
              Player
            </th>
            {holes.map((h) => (
              <th key={h} scope="col" className={h === currentHole ? 'stroke-scorecard-current-hole' : undefined}>
                {h}
              </th>
            ))}
            <th scope="col" className="stroke-scorecard-total">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {session.players.map((player) => (
            <tr key={player} className={highlighted.has(player) ? 'stroke-scorecard-leader-row' : undefined}>
              <th scope="row" className="stroke-scorecard-name">
                {player}
              </th>
              {holes.map((h) => {
                const strokes = scoreAt(h, player)
                const className = h === currentHole ? 'stroke-scorecard-current-hole' : undefined
                return (
                  <td key={h} className={className} data-hole={h} data-player={player}>
                    {strokes !== null && onCellTap ? (
                      <button
                        type="button"
                        className="stroke-scorecard-cell-btn"
                        aria-label={`${player}, hole ${h}: ${strokes}. Tap to correct.`}
                        onClick={() => onCellTap(h, player)}
                      >
                        {strokes}
                      </button>
                    ) : (
                      (strokes ?? '')
                    )}
                  </td>
                )
              })}
              <td className="stroke-scorecard-total">{session.totals[player] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
