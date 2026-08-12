// Simple stroke-only icon set for the nav dropdown's menu items. Inline SVG
// (not emoji) so color follows currentColor -- including the active-tab
// orange swap -- and rendering doesn't depend on the platform's emoji font.
type IconProps = {
  className?: string
}

const commonProps = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function MapPinIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M2 5l6-2.5 6 2.5 6-2.5v13l-6 2.5-6-2.5-6 2.5V5z" />
      <line x1="8" y1="2.5" x2="8" y2="15.5" />
      <line x1="14" y1="5" x2="14" y2="18" />
    </svg>
  )
}

export function GridIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <rect x="2" y="2" width="16" height="16" rx="2" />
      <line x1="2" y1="7.33" x2="18" y2="7.33" />
      <line x1="2" y1="12.67" x2="18" y2="12.67" />
      <line x1="7.33" y1="2" x2="7.33" y2="18" />
      <line x1="12.67" y1="2" x2="12.67" y2="18" />
    </svg>
  )
}

export function PuzzlePieceIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M4 4 L8 4 A2 2 0 0 0 12 4 L16 4 L16 8 A2 2 0 0 1 16 12 L16 16 L4 16 Z" />
    </svg>
  )
}

export function ClipboardIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <rect x="5" y="3" width="10" height="15" rx="1.5" />
      <rect x="7.5" y="1.5" width="5" height="3" rx="1" />
      <line x1="7" y1="9" x2="13" y2="9" />
      <line x1="7" y1="12.5" x2="13" y2="12.5" />
    </svg>
  )
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <line x1="17" y1="17" x2="12.7" y2="12.7" />
    </svg>
  )
}

export function PawIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <ellipse cx="10" cy="13.5" rx="5" ry="4" />
      <ellipse cx="4" cy="7.5" rx="2" ry="2.6" />
      <ellipse cx="8.7" cy="4" rx="2" ry="2.6" />
      <ellipse cx="13.3" cy="5" rx="2" ry="2.6" />
      <ellipse cx="16.5" cy="8.8" rx="1.8" ry="2.3" />
    </svg>
  )
}

export function CameraIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <rect x="2.5" y="6" width="15" height="10.5" rx="2" />
      <path d="M7 6l1.3-2.2h3.4L13 6" />
      <circle cx="10" cy="11.2" r="3.2" />
    </svg>
  )
}

// Speech bubble -- Contact Staff is a two-way "ask a question / flag an
// emergency" flow, so a message bubble reads better than a one-way
// megaphone/broadcast icon. Nothing else in the app covers this shape.
export function MessageIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M2.5 5h13a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8.5L5 17.5V14H2.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
      <line x1="4.8" y1="8" x2="13.2" y2="8" />
      <line x1="4.8" y1="10.8" x2="10.5" y2="10.8" />
    </svg>
  )
}

// Simple house shape -- used by the Home page's sign-board header. Nothing
// else in the app covers this shape.
export function HomeIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M3 9.5L10 3l7 6.5" />
      <path d="M4.5 8.5V17h11V8.5" />
      <line x1="8" y1="17" x2="8" y2="12.5" />
      <line x1="12" y1="17" x2="12" y2="12.5" />
      <line x1="8" y1="12.5" x2="12" y2="12.5" />
    </svg>
  )
}

// Padlock -- used for locked Scavenger Hunt characters (locked until their
// QR code is scanned). Nothing else in the app covers this shape.
export function LockIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <rect x="4.5" y="9" width="11" height="8.5" rx="1.5" />
      <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" />
    </svg>
  )
}

// Passport booklet -- rounded card with a "photo" circle and text lines,
// distinct from ClipboardIcon (which is used elsewhere for lists/sheets).
// Nothing else in the app covers this shape.
export function PassportIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <rect x="4" y="2" width="12" height="16" rx="1.5" />
      <circle cx="10" cy="7.5" r="2.3" />
      <line x1="7" y1="12.5" x2="13" y2="12.5" />
      <line x1="7" y1="15" x2="13" y2="15" />
    </svg>
  )
}
