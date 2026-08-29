import { useEffect, useState } from 'react'
import { api, type HuntCharacterScanCode, type Puzzle, type ScoringGame } from '../api'
import { ANIMALS } from '../animalContent'
import './StaffQrDirectory.css'

interface QrEntry {
  key: string
  name: string
  url: string
}

// Read-only reference view (Staff Page "QR Codes" tab): every QR-ready
// destination in the app, with its full absolute URL, so staff can generate
// physical signage for the park. window.location.origin (not a hardcoded/env
// domain) so the printed URL is always correct for wherever this is viewed
// from -- localhost during dev, the real deployed domain in production.
export function StaffQrDirectory() {
  const [scoringGames, setScoringGames] = useState<ScoringGame[] | null>(null)
  const [scoringError, setScoringError] = useState<string | null>(null)
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null)
  const [puzzlesError, setPuzzlesError] = useState<string | null>(null)
  const [scanCodes, setScanCodes] = useState<HuntCharacterScanCode[] | null>(null)
  const [scanCodesError, setScanCodesError] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  useEffect(() => {
    api.listScoringGames().then(setScoringGames).catch((err) => setScoringError(String(err)))
    api.listPuzzles().then(setPuzzles).catch((err) => setPuzzlesError(String(err)))
    api.listHuntScanCodes().then(setScanCodes).catch((err) => setScanCodesError(String(err)))
  }, [])

  const origin = window.location.origin

  const copy = (key: string, url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500)
    })
  }

  const animalEntries: QrEntry[] = ANIMALS.map((a) => ({
    key: `animal-${a.slug}`,
    name: a.name,
    url: `${origin}/animals/${a.slug}`,
  }))

  const huntEntries: QrEntry[] | null =
    scanCodes && scanCodes.map((c) => ({ key: `hunt-${c.id}`, name: c.name, url: `${origin}/scan/${c.code}` }))

  const scoringEntries: QrEntry[] | null =
    scoringGames &&
    scoringGames.map((g) => ({ key: `scoring-${g.id}`, name: g.name, url: `${origin}/scoring/${g.slug}` }))

  const puzzleEntries: QrEntry[] | null =
    puzzles &&
    puzzles.flatMap((p) =>
      p.challenges.map((c) => ({
        key: `puzzle-${c.id}`,
        name: `${p.name} — ${c.label}`,
        url: `${origin}/puzzles/${c.slug}`,
      })),
    )

  return (
    <section className="staff-qr-directory">
      <p className="staff-attractions-hint">
        Every QR-ready destination in the app, with its full link -- copy a link to print onto physical park signage.
      </p>

      <StaffQrSection title="Our Animals" entries={animalEntries} error={null} copiedKey={copiedKey} onCopy={copy} />
      <StaffQrSection
        title="Scavenger Hunt Characters"
        entries={huntEntries}
        error={scanCodesError}
        copiedKey={copiedKey}
        onCopy={copy}
      />
      <StaffQrSection
        title="Scoring Sheet Games"
        entries={scoringEntries}
        error={scoringError}
        copiedKey={copiedKey}
        onCopy={copy}
      />
      <StaffQrSection
        title="Puzzle Challenges"
        entries={puzzleEntries}
        error={puzzlesError}
        copiedKey={copiedKey}
        onCopy={copy}
      />
    </section>
  )
}

function StaffQrSection({
  title,
  entries,
  error,
  copiedKey,
  onCopy,
}: {
  title: string
  entries: QrEntry[] | null
  error: string | null
  copiedKey: string | null
  onCopy: (key: string, url: string) => void
}) {
  return (
    <div className="staff-qr-section">
      <h2 className="staff-photos-subheading">{title}</h2>
      {error && (
        <p className="screen-error">
          Couldn't load {title.toLowerCase()}: {error}
        </p>
      )}
      {entries === null ? (
        <p className="staff-photos-loading">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="staff-photos-empty">Nothing here yet.</p>
      ) : (
        <ul className="staff-qr-list">
          {entries.map((entry) => (
            <li key={entry.key} className="staff-qr-row cap-parchment-card">
              <div className="staff-qr-row-main">
                <span className="staff-qr-row-name">{entry.name}</span>
                <span className="staff-qr-row-url">{entry.url}</span>
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => onCopy(entry.key, entry.url)}>
                {copiedKey === entry.key ? 'Copied!' : 'Copy Link'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
