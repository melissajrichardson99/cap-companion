// Player name entry shared by both Scoring Sheet modes (turn-based
// ScoringSessionModal and stroke-play StrokePlaySessionModal). Styles live
// in ScoringSessionModal.css alongside the rest of the shared modal chrome.

interface ScoringPlayerSetupProps {
  playerInputs: string[]
  onChange: (inputs: string[]) => void
  hint: string
}

// Trimmed, non-empty names, or an error message to show instead.
export function validatePlayerInputs(playerInputs: string[]): { players: string[] } | { error: string } {
  const players = playerInputs.map((p) => p.trim()).filter((p) => p.length > 0)
  if (players.length === 0) return { error: 'Enter at least one player name.' }
  if (new Set(players).size !== players.length) return { error: 'Player names must be unique.' }
  return { players }
}

export function ScoringPlayerSetup({ playerInputs, onChange, hint }: ScoringPlayerSetupProps) {
  const updatePlayerField = (index: number, value: string) =>
    onChange(playerInputs.map((v, i) => (i === index ? value : v)))

  return (
    <div className="scoring-setup">
      <h3 className="scoring-section-title">Players</h3>
      <p className="scoring-setup-hint">{hint}</p>
      {playerInputs.map((value, i) => (
        <div className="scoring-player-input-row" key={i}>
          <input
            type="text"
            className="scoring-player-input"
            placeholder={`Player ${i + 1} name`}
            value={value}
            onChange={(e) => updatePlayerField(i, e.target.value)}
          />
          {playerInputs.length > 1 && (
            <button
              type="button"
              className="btn btn-secondary scoring-remove-player-btn"
              aria-label={`Remove player ${i + 1}`}
              onClick={() => onChange(playerInputs.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button type="button" className="btn btn-secondary" onClick={() => onChange([...playerInputs, ''])}>
        Add Player
      </button>
    </div>
  )
}
