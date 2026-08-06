import type { EncyclopediaEntry } from '../api'
import './EncyclopediaEntryScreen.css'

interface EncyclopediaEntryScreenProps {
  entry: EncyclopediaEntry
  onClose: () => void
}

// Minimal stub page for a scanned Encyclopedia sign -- the full card-based
// Encyclopedia (Plan.md 2.5/5) is a later sprint, once real animal
// photos/facts exist. This just proves the code resolves to a real target.
export function EncyclopediaEntryScreen({ entry, onClose }: EncyclopediaEntryScreenProps) {
  return (
    <div className="encyclopedia-entry-screen">
      <h2 className="encyclopedia-entry-title">{entry.animal_name}</h2>
      {entry.status === 'published' ? (
        <p>Full encyclopedia content for {entry.animal_name} isn't wired up in this view yet.</p>
      ) : (
        <>
          <p className="encyclopedia-coming-soon">Coming soon!</p>
          <p>We're still gathering photos and facts about the {entry.animal_name.toLowerCase()} for this page.</p>
        </>
      )}
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        Back to the app
      </button>
    </div>
  )
}
