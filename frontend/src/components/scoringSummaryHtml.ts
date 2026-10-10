import type { ScoreSheetSession, ScoringGame } from '../api'

// Standalone export for the finished Scoring Sheet screen's "Download
// Summary" button. Deliberately hardcodes the wood-grain gradient recipe
// (same values as .map-frame / .bingo-content) and the parchment/outline
// tokens from index.css rather than referencing CSS vars, since a downloaded
// file has no access to the app's stylesheet -- this is the one exported
// artifact that's meant to look like a wood-plank game board, per the redesign.
const WOOD_GRADIENT =
  'repeating-linear-gradient(100deg, rgba(255,255,255,.05) 0px, rgba(255,255,255,.05) 2px, rgba(0,0,0,.04) 2px, rgba(0,0,0,.04) 4px), linear-gradient(155deg, #a9773f 0%, #8a5a2f 35%, #6e4523 65%, #7c4f28 100%)'
const OUTLINE = '#14181a'
const PARCHMENT = 'rgb(240, 222, 192)'
const SHADOW_POP = `3px 3px 0 ${OUTLINE}`
const ROUNDS_PER_BLOCK = 10

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Stroke play (mini golf): the full scorecard, players by holes plus a
// total, in one table -- 9 to 12 holes fits without the 10-round blocks the
// turn-based export needs.
function buildScorecard(session: ScoreSheetSession): string {
  const holes = Array.from({ length: session.hole_count ?? 0 }, (_, i) => i + 1)
  const headerCells = holes.map((h) => `<th>${h}</th>`).join('')
  const rows = session.players
    .map((player) => {
      const cells = holes
        .map((h) => {
          const score = session.hole_scores.find((s) => s.player_name === player && s.hole_number === h)
          return `<td>${score ? score.strokes : ''}</td>`
        })
        .join('')
      const winnerClass = session.winners.includes(player) ? ' class="winner-row"' : ''
      return `<tr${winnerClass}><td class="player-name">${escapeHtml(player)}</td>${cells}<td class="total-cell">${session.totals[player] ?? 0}</td></tr>`
    })
    .join('')

  return `
    <div class="round-block-title">Scorecard</div>
    <table class="round-block">
      <thead><tr><th>Player</th>${headerCells}<th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
}

function roundsPlayed(session: ScoreSheetSession): number {
  return session.entries.reduce((max, e) => Math.max(max, e.turn_round), 0)
}

function scoreAtRound(session: ScoreSheetSession, player: string, round: number): number | null {
  const entry = session.entries.find((e) => e.player_name === player && e.turn_round === round)
  return entry ? entry.point_value : null
}

// Running total through the last round in a block -- the single "Total"
// column the redesign keeps in place of the removed per-round "Round Total"
// column (see ScoringSessionModal.tsx / Plan.md turn-based redesign).
function totalThroughRound(session: ScoreSheetSession, player: string, round: number): number {
  return session.entries
    .filter((e) => e.player_name === player && e.turn_round <= round)
    .reduce((sum, e) => sum + e.point_value, 0)
}

function buildRoundBlock(session: ScoreSheetSession, startRound: number, endRound: number): string {
  const roundNumbers = Array.from({ length: endRound - startRound + 1 }, (_, i) => startRound + i)
  const headerCells = roundNumbers.map((r) => `<th>R${r}</th>`).join('')
  const rows = session.players
    .map((player) => {
      const cells = roundNumbers
        .map((r) => {
          const value = scoreAtRound(session, player, r)
          return `<td>${value === null ? '' : value}</td>`
        })
        .join('')
      const total = totalThroughRound(session, player, endRound)
      return `<tr><td class="player-name">${escapeHtml(player)}</td>${cells}<td class="total-cell">${total}</td></tr>`
    })
    .join('')

  return `
    <div class="round-block-title">Rounds ${startRound}–${endRound}</div>
    <table class="round-block">
      <thead><tr><th>Player</th>${headerCells}<th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
}

export function buildSummaryHtml(game: ScoringGame, session: ScoreSheetSession): string {
  const strokePlay = game.scoring_mode === 'stroke_play'
  const totalRounds = roundsPlayed(session)
  const blockCount = Math.max(1, Math.ceil(totalRounds / ROUNDS_PER_BLOCK))
  const blocks = strokePlay
    ? buildScorecard(session)
    : Array.from({ length: blockCount }, (_, i) => {
        const startRound = i * ROUNDS_PER_BLOCK + 1
        const endRound = startRound + ROUNDS_PER_BLOCK - 1
        return buildRoundBlock(session, startRound, endRound)
      }).join('')

  const resultLine =
    strokePlay && session.winners.length > 1
      ? `Tied for the win: ${escapeHtml(session.winner ?? '')} (lowest total, shared)`
      : session.winner
    ? `Winner: ${escapeHtml(session.winner)}`
    : session.tied_players.length > 0
      ? `Tied: ${escapeHtml(session.tied_players.join(' & '))}`
      : 'No winner yet.'

  const totalsRows = session.players
    .map((player) => {
      const isWinner = strokePlay ? session.winners.includes(player) : player === session.winner
      const winnerClass = isWinner ? ' class="winner-row"' : ''
      return `<tr${winnerClass}><td class="player-name">${escapeHtml(player)}</td><td class="total-cell">${session.totals[player] ?? 0}</td></tr>`
    })
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(game.name)} — Score Sheet</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0;
    padding: 24px;
    font-family: 'Nunito', system-ui, sans-serif;
    background: #e8d9bb;
    color: ${OUTLINE};
  }
  .wood-frame {
    max-width: 960px;
    margin: 0 auto;
    border-radius: 22px;
    padding: 16px;
    background: ${WOOD_GRADIENT};
    box-shadow: ${SHADOW_POP}, inset 0 0 0 2px rgba(255,255,255,.12), inset 0 2px 4px rgba(255,255,255,.25), inset 0 -3px 6px rgba(0,0,0,.35);
  }
  .parchment {
    background: ${PARCHMENT};
    border: 2px solid ${OUTLINE};
    border-radius: 14px;
    padding: 24px;
  }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .meta { font-size: 14px; margin: 0 0 4px; }
  .result { font-size: 18px; font-weight: 700; margin: 16px 0; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 20px; }
  th, td { border: 1.5px solid ${OUTLINE}; padding: 6px 8px; font-size: 13px; text-align: center; }
  th { background: rgba(0,0,0,.08); }
  td.player-name, th:first-child { text-align: left; font-weight: 700; }
  td.total-cell { font-weight: 700; }
  tr.winner-row td { color: #b5460a; }
  .round-block-title {
    font-size: 13px;
    font-weight: 700;
    margin: 20px 0 4px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
</head>
<body>
  <div class="wood-frame"${strokePlay ? ' data-scoring-mode="stroke_play"' : ''}>
    <div class="parchment">
      <h1>Cobb's Adventure Park — ${escapeHtml(game.name)}</h1>
      <p class="meta">Players: ${escapeHtml(session.players.join(', '))}</p>
      <p class="meta">Started: ${new Date(session.created_at).toLocaleString()}</p>
      ${session.completed_at ? `<p class="meta">Finished: ${new Date(session.completed_at).toLocaleString()}</p>` : ''}
      <p class="result">${resultLine}</p>

      <div class="round-block-title">Final Totals</div>
      <table>
        <tbody>${totalsRows}</tbody>
      </table>

      ${blocks}
    </div>
  </div>
</body>
</html>
`
}

export function downloadSummary(game: ScoringGame, session: ScoreSheetSession) {
  const html = buildSummaryHtml(game, session)
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${game.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-score-sheet.html`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
