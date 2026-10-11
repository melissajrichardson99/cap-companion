import { useState } from 'react'
import type { PassportSession } from '../api'
import { PassportIcon } from './NavIcons'
import { PhotoLightbox } from './PhotoLightbox'
import './PassportModal.css'

interface PassportCardProps {
  session: PassportSession
}

// The frozen stats-snapshot card rendering shared by PassportModal (right
// after generating a new one) and PassportHistoryModal (viewing a past one)
// -- identical presentation either way, since a passport never changes after
// creation. Callers own their own surrounding Modal/close button.
export function PassportCard({ session }: PassportCardProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const { stats } = session
  const milestoneNote = stats.bingo_milestones.blackout
    ? ' — Blackout!'
    : stats.bingo_milestones.x
      ? ' — X marks the spot!'
      : stats.bingo_milestones.lines.length > 0
        ? ` — ${stats.bingo_milestones.lines.length} line(s)!`
        : ''

  return (
    <>
      <div className="passport-card">
        {session.photo_url && (
          <img
            src={session.photo_url}
            alt={`${session.family_label} group photo`}
            className="passport-card-photo"
            role="button"
            tabIndex={0}
            onClick={() => setLightboxOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setLightboxOpen(true)
              }
            }}
          />
        )}
        <span className="passport-card-icon-badge" aria-hidden="true">
          <PassportIcon />
        </span>
        <p className="passport-card-eyebrow">Family Passport</p>
        <h2 id="passport-card-title" className="passport-card-title">
          {stats.title}
        </h2>
        <p className="passport-card-family-label">{session.family_label}</p>
        <ul className="passport-card-stats">
          <li>
            🐨 Scavenger Hunt: {stats.scavenger_hunt_characters_completed} / {stats.scavenger_hunt_characters_total}{' '}
            characters
          </li>
          <li>
            🎯 Bingo: {stats.bingo_tiles_completed} / {stats.bingo_tiles_total} tiles
            {milestoneNote}
          </li>
          <li>🏆 Scoring Sheets: {stats.scoring_sheet_games_won} game(s) won</li>
          <li>🧩 Puzzles: {stats.puzzle_challenges_completed} challenge(s) completed</li>
          <li>🪙 Cobb Coins: {stats.total_cobb_coins}</li>
        </ul>
        <p className="passport-card-timestamp">Generated {new Date(session.generated_at).toLocaleString()}</p>
      </div>
      {lightboxOpen && session.photo_url && (
        <PhotoLightbox
          photos={[{ candidates: [session.photo_url], alt: `${session.family_label} group photo` }]}
          startIndex={0}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  )
}
