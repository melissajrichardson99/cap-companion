import { useEffect, useState } from 'react'
import {
  api,
  type HuntCharacterScanCode,
  type MapNode,
  type Puzzle,
  type QrDestinationType,
  type QrLocation,
  type ScoringGame,
} from '../api'
import { ANIMALS } from '../animalContent'
import './StaffQrDirectory.css'

interface QrEntry {
  key: string
  name: string
  url: string
  // The plain text a guest can type into ScanEntryModal's manual-entry field
  // instead of scanning -- the same value the URL's last path segment
  // carries, surfaced separately so staff can print it as human-readable
  // text under a QR code on physical signage.
  code: string
  // Which stored location this row shows/edits (Staff Visit Heatmap Phase
  // 2). Puzzle challenges share their puzzle's location.
  location: { type: QrDestinationType; id: string; note?: string }
}

type SaveState = { status: 'saving' | 'saved' } | { status: 'error'; message: string }

function locationKey(type: QrDestinationType, id: string): string {
  return `${type}:${id}`
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
  const [mapNodes, setMapNodes] = useState<MapNode[] | null>(null)
  const [locations, setLocations] = useState<Map<string, string | null> | null>(null)
  const [locationsError, setLocationsError] = useState<string | null>(null)
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({})

  useEffect(() => {
    api.listScoringGames().then(setScoringGames).catch((err) => setScoringError(String(err)))
    api.listPuzzles().then(setPuzzles).catch((err) => setPuzzlesError(String(err)))
    api.listHuntScanCodes().then(setScanCodes).catch((err) => setScanCodesError(String(err)))
    api.listMapNodes().then(setMapNodes).catch((err) => setLocationsError(String(err)))
    api
      .listQrLocations()
      .then((rows: QrLocation[]) =>
        setLocations(new Map(rows.map((r) => [locationKey(r.destination_type, r.destination_id), r.map_node_id]))),
      )
      .catch((err) => setLocationsError(String(err)))
  }, [])

  const saveLocation = (type: QrDestinationType, id: string, mapNodeId: string | null) => {
    const key = locationKey(type, id)
    setSaveStates((prev) => ({ ...prev, [key]: { status: 'saving' } }))
    api
      .setQrLocation(type, id, mapNodeId)
      .then(() => {
        setLocations((prev) => new Map(prev ?? []).set(key, mapNodeId))
        setSaveStates((prev) => ({ ...prev, [key]: { status: 'saved' } }))
      })
      .catch((err) => setSaveStates((prev) => ({ ...prev, [key]: { status: 'error', message: String(err) } })))
  }

  const locationProps = { mapNodes, locations, saveStates, onSaveLocation: saveLocation }

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
    code: a.slug,
    location: { type: 'animal', id: a.slug },
  }))

  const huntEntries: QrEntry[] | null =
    scanCodes &&
    scanCodes.map((c) => ({
      key: `hunt-${c.id}`,
      name: c.name,
      url: `${origin}/scan/${c.code}`,
      code: c.code,
      location: { type: 'hunt_character', id: c.id },
    }))

  const scoringEntries: QrEntry[] | null =
    scoringGames &&
    scoringGames.map((g) => ({
      key: `scoring-${g.id}`,
      name: g.name,
      url: `${origin}/scoring/${g.slug}`,
      code: g.slug,
      location: { type: 'scoring_game', id: g.id },
    }))

  const puzzleEntries: QrEntry[] | null =
    puzzles &&
    puzzles.flatMap((p) =>
      p.challenges.map((c) => ({
        key: `puzzle-${c.id}`,
        name: `${p.name} — ${c.label}`,
        url: `${origin}/puzzles/${c.slug}`,
        code: c.slug,
        location: {
          type: 'puzzle',
          id: p.id,
          note: p.challenges.length > 1 ? `Shared by all ${p.name} challenges.` : undefined,
        },
      })),
    )

  return (
    <section className="staff-qr-directory">
      <p className="staff-attractions-hint">
        Every QR-ready destination in the app, with its full link -- copy a link to print onto physical park signage.
        Each one's map location places its scans on the Visit Heatmap.
      </p>
      {locationsError && <p className="screen-error">Couldn't load map locations: {locationsError}</p>}

      <StaffQrSection title="Our Animals" entries={animalEntries}
        error={null}
        copiedKey={copiedKey}
        onCopy={copy}
        {...locationProps}
      />
      <StaffQrSection
        title="Scavenger Hunt Characters"
        entries={huntEntries}
        error={scanCodesError}
        copiedKey={copiedKey}
        onCopy={copy}
        {...locationProps}
      />
      <StaffQrSection
        title="Scoring Sheet Games"
        entries={scoringEntries}
        error={scoringError}
        copiedKey={copiedKey}
        onCopy={copy}
        {...locationProps}
      />
      <StaffQrSection
        title="Puzzle Challenges"
        entries={puzzleEntries}
        error={puzzlesError}
        copiedKey={copiedKey}
        onCopy={copy}
        {...locationProps}
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
  mapNodes,
  locations,
  saveStates,
  onSaveLocation,
}: {
  title: string
  entries: QrEntry[] | null
  error: string | null
  copiedKey: string | null
  onCopy: (key: string, url: string) => void
  mapNodes: MapNode[] | null
  locations: Map<string, string | null> | null
  saveStates: Record<string, SaveState>
  onSaveLocation: (type: QrDestinationType, id: string, mapNodeId: string | null) => void
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
                <span className="staff-qr-row-code">
                  Manual code: <code>{entry.code}</code>
                </span>
                <QrLocationPicker
                  name={entry.name}
                  location={entry.location}
                  mapNodes={mapNodes}
                  locations={locations}
                  saveState={saveStates[locationKey(entry.location.type, entry.location.id)]}
                  onSave={onSaveLocation}
                />
              </div>
              <div className="staff-qr-row-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onCopy(`${entry.key}-url`, entry.url)}
                >
                  {copiedKey === `${entry.key}-url` ? 'Copied!' : 'Copy Link'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onCopy(`${entry.key}-code`, entry.code)}
                >
                  {copiedKey === `${entry.key}-code` ? 'Copied!' : 'Copy Code'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Map-node dropdown for one QR destination's location. Child nodes (e.g.
// Cornhole under Arcade Pad) are listed under their parent's name; the
// heatmap counts them on the parent's dot.
function QrLocationPicker({
  name,
  location,
  mapNodes,
  locations,
  saveState,
  onSave,
}: {
  name: string
  location: QrEntry['location']
  mapNodes: MapNode[] | null
  locations: Map<string, string | null> | null
  saveState: SaveState | undefined
  onSave: (type: QrDestinationType, id: string, mapNodeId: string | null) => void
}) {
  if (!mapNodes || !locations) return null
  const nameById = new Map(mapNodes.map((n) => [n.id, n.name]))
  const current = locations.get(locationKey(location.type, location.id)) ?? null
  // A coming-soon node can't be visited and isn't on the heatmap, so it isn't
  // offered as a location (unless something already points at it).
  const options = mapNodes
    .filter((n) => !n.coming_soon || n.id === current)
    .map((n) => ({
      id: n.id,
      label: n.parent_node_id ? `${nameById.get(n.parent_node_id) ?? '?'} › ${n.name}` : n.name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <span className="staff-qr-row-location">
      <label>
        Map location:{' '}
        <select
          aria-label={`Map location for ${name}`}
          value={current ?? ''}
          disabled={saveState?.status === 'saving'}
          onChange={(e) => onSave(location.type, location.id, e.target.value || null)}
        >
          <option value="">Not mapped</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {location.note && <span className="staff-qr-row-location-note"> {location.note}</span>}
      {saveState?.status === 'saved' && <span className="staff-qr-row-location-status"> Saved</span>}
      {saveState?.status === 'error' && (
        <span className="screen-error staff-qr-row-location-status"> Couldn't save: {saveState.message}</span>
      )}
    </span>
  )
}
