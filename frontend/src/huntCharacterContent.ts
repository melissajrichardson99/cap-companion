// Per-character presentation content for the Scavenger Hunt redesign --
// emoji placeholder "art" (no character images exist in the repo yet),
// plus placeholder location-hint and description copy. Both text fields are
// deliberately bracketed/obviously-fake so they're easy to find and swap
// for real copy later without re-auditing every character, same discipline
// as migration 008's metadata.source markers for placeholder trivia.
//
// Keyed by HuntCharacter.name (fixed 5-character roster, same "exact string
// match" style as CHARACTER_CODES in the e2e specs and GAME_SLUGS in
// MinigameOverlay.tsx). `slug` is the lowercase form used for the
// data-hunt-character attribute that drives HuntScreen.css's per-character
// accent-color theming.
export interface HuntCharacterContent {
  slug: string
  emoji: string
  hint: string
  description: string
}

export const HUNT_CHARACTER_CONTENT: Record<string, HuntCharacterContent> = {
  Kangaroo: {
    slug: 'kangaroo',
    emoji: '🦘',
    hint: "Somewhere near [Kangaroo's hint location]...",
    description: '[Placeholder description for Kangaroo — real copy coming soon.]',
  },
  Pig: {
    slug: 'pig',
    emoji: '🐷',
    hint: "Somewhere near [Pig's hint location]...",
    description: '[Placeholder description for Pig — real copy coming soon.]',
  },
  Capybara: {
    slug: 'capybara',
    emoji: '🦫',
    hint: "Somewhere near [Capybara's hint location]...",
    description: '[Placeholder description for Capybara — real copy coming soon.]',
  },
  Snake: {
    slug: 'snake',
    emoji: '🐍',
    hint: "Somewhere near [Snake's hint location]...",
    description: '[Placeholder description for Snake — real copy coming soon.]',
  },
  Sloth: {
    slug: 'sloth',
    emoji: '🦥',
    hint: "Somewhere near [Sloth's hint location]...",
    description: '[Placeholder description for Sloth — real copy coming soon.]',
  },
}
