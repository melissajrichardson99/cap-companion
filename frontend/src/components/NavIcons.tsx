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

// Binoculars -- used for the "Our Animals" nav tab, distinct from PawIcon
// (Collectibles) since this feature is about wildlife-watching/learning, not
// earned badges. Nothing else in the app covers this shape.
export function BinocularsIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <rect x="2" y="9" width="6" height="7.5" rx="1.5" />
      <rect x="12" y="9" width="6" height="7.5" rx="1.5" />
      <line x1="8" y1="12.2" x2="12" y2="12.2" />
      <path d="M4.5 9L6 3l2 0.5-1 5.5" />
      <path d="M15.5 9L14 3l-2 0.5 1 5.5" />
    </svg>
  )
}

// Outline heart -- the "Our Animals" detail page's favorite icon. Rendered
// non-interactive/decorative for this pass (no favoriting concept exists
// yet anywhere in the app) -- see AnimalDetailScreen.tsx. Nothing else in
// the app covers this shape.
export function HeartIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M10 17.3c-.25 0-.5-.09-.7-.27C6.1 14 2.5 10.8 2.5 7.3 2.5 4.7 4.5 2.6 7 2.6c1.4 0 2.7.65 3 1.75.3-1.1 1.6-1.75 3-1.75 2.5 0 4.5 2.1 4.5 4.7 0 3.5-3.6 6.7-6.8 9.73-.2.18-.45.27-.7.27z" />
    </svg>
  )
}

// Food truck -- used for the "Food Truck Menus" nav tab. Distinct from
// PawIcon/BinocularsIcon (animals) and ClipboardIcon (scoring); nothing else
// in the app covers this shape.
export function TruckIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <rect x="1.5" y="6" width="10.5" height="8" rx="1" />
      <path d="M12 9h4l3 3v2h-7z" />
      <circle cx="5.5" cy="15.5" r="1.8" />
      <circle cx="14.5" cy="15.5" r="1.8" />
    </svg>
  )
}

// Fork & knife -- the Food Truck Menus sign-board title icon, per the
// approved mockup. Nothing else in the app covers this shape.
export function ForkKnifeIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <line x1="5" y1="2" x2="5" y2="18" />
      <path d="M3 2v6a2 2 0 0 0 4 0V2" />
      <path d="M15 2c-1.7 0-3 2-3 4.5S13.3 10 15 10V18" />
    </svg>
  )
}

// Burger -- Granny Ann's Kitchen ribbon icon. Nothing else in the app covers
// this shape.
export function BurgerIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M2.5 8.5a7.5 6 0 0 1 15 0z" />
      <line x1="2" y1="10.5" x2="18" y2="10.5" />
      <line x1="2" y1="13" x2="18" y2="13" />
      <path d="M2.5 15.5h15a1.5 1.5 0 0 1-1.5 1.5h-12a1.5 1.5 0 0 1-1.5-1.5z" />
    </svg>
  )
}

// Ice cream cone -- Sugar Shack ribbon icon. Nothing else in the app covers
// this shape.
export function IceCreamIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M6 8a4 4 0 0 1 8 0c0 1.2-.5 2-1 2.5H7c-.5-.5-1-1.3-1-2.5z" />
      <path d="M7 10.5l2.5 7 2.5-7" />
    </svg>
  )
}

// Coffee cup -- Critter Cafe ribbon icon. Nothing else in the app covers
// this shape.
export function CoffeeCupIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M3.5 7h10v5.5a3.5 3.5 0 0 1-3.5 3.5h-3a3.5 3.5 0 0 1-3.5-3.5z" />
      <path d="M13.5 8.5h1.5a2 2 0 0 1 0 4h-1.5" />
      <path d="M6 4.5c0-1 1-1 1-2" />
      <path d="M9.5 4.5c0-1 1-1 1-2" />
    </svg>
  )
}

// Restroom pictogram (head + body arch) -- the Map page's "Take Me There"
// card's Washrooms button. Nothing else in the app covers this shape.
export function WashroomIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <circle cx="10" cy="5.3" r="2.3" />
      <path d="M6.3 17v-5.2a3.7 3.7 0 0 1 7.4 0V17" />
    </svg>
  )
}

// Storefront awning -- the Map page's "Take Me There" card's General Store
// button. Distinct from TruckIcon (a vehicle) and the food icons (dishware) --
// nothing else in the app covers this shape.
export function StoreIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M2.5 7L4 2.5h12L17.5 7" />
      <path d="M2.5 7a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" />
      <path d="M4 9.3V17.5h12V9.3" />
      <path d="M8 17.5V13a2 2 0 0 1 4 0v4.5" />
    </svg>
  )
}

// Picket fence -- the Map page's "Take Me There" card's Animal Pens button.
// Distinct from PawIcon (Collectibles nav tab, a different concept). Nothing
// else in the app covers this shape.
export function FenceIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <line x1="1.5" y1="7" x2="18.5" y2="7" />
      <line x1="1.5" y1="12.5" x2="18.5" y2="12.5" />
      <line x1="3.5" y1="4" x2="3.5" y2="17" />
      <line x1="8.3" y1="2.3" x2="8.3" y2="17" />
      <line x1="13" y1="4" x2="13" y2="17" />
      <line x1="17" y1="2.3" x2="17" y2="17" />
    </svg>
  )
}

// Draped stage -- the Map page's "Take Me There" card's Animal Shows button.
// Distinct from BinocularsIcon (Our Animals nav tab, a different concept).
// Nothing else in the app covers this shape.
export function StageIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M2 3h16v2.2a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V3z" />
      <line x1="2" y1="17.2" x2="18" y2="17.2" />
      <line x1="6" y1="8.2" x2="6" y2="17.2" />
      <line x1="14" y1="8.2" x2="14" y2="17.2" />
    </svg>
  )
}

// Joystick -- the Map page's "Take Me There" card's Attractions button.
// Distinct from GridIcon (Bingo Card nav tab, a different concept). Nothing
// else in the app covers this shape.
export function JoystickIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <circle cx="10" cy="4.8" r="2.2" />
      <line x1="10" y1="7" x2="10" y2="12.5" />
      <rect x="3.5" y="12.5" width="13" height="4.8" rx="1.6" />
    </svg>
  )
}

// Question mark bubble -- the FAQ page's sign-board title icon and each
// accordion entry's icon. Nothing else in the app covers this shape.
export function QuestionMarkIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M6.5 7a3.5 3.5 0 1 1 5.7 2.7c-.9.7-1.7 1.3-1.7 2.6v.5" />
      <circle cx="10" cy="15.3" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

// Left/right chevrons -- reused for the "Our Animals" detail/cards screens'
// back button and flashcard prev/next navigation. Nothing else in the app
// covers this shape.
export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M12.5 3.5L6.5 10l6 6.5" />
    </svg>
  )
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M7.5 3.5L13.5 10l-6 6.5" />
    </svg>
  )
}

// Megaphone -- the Staff Page sidebar's Announcements item. A one-way
// broadcast shape, distinct from MessageIcon's two-way speech bubble
// (Contact Requests is a guest-initiated conversation; Announcements is
// staff posting outward). Nothing else in the app covers this shape.
export function MegaphoneIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M2.5 8.5v3l3 .8V13a1.3 1.3 0 0 0 2.6 0v-.2" />
      <path d="M5.5 9.3L15 6v8l-9.5-3.3z" />
      <path d="M15 6a2.5 4 0 0 1 0 8" />
    </svg>
  )
}

// Simple ascending bar chart -- the Staff Page sidebar's Analytics item.
// Nothing else in the app covers this shape.
export function BarChartIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <line x1="2.5" y1="17.5" x2="17.5" y2="17.5" />
      <rect x="4" y="11" width="3.2" height="6.5" />
      <rect x="8.4" y="6.5" width="3.2" height="11" />
      <rect x="12.8" y="2.5" width="3.2" height="15" />
    </svg>
  )
}

// Head + shoulders -- Guest Accounts' "Save Your Progress" nav entry and the
// AccountModal's title badge. Nothing else in the app covers this shape.
export function UserIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <circle cx="10" cy="6.3" r="3.3" />
      <path d="M3.5 17v-1.2a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5V17" />
    </svg>
  )
}

// Shield outline -- the Privacy Policy page's sign-board title icon. Nothing
// else in the app covers this shape.
export function ShieldIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M10 2.5l6.5 2.6v4.8c0 4.6-2.8 7.9-6.5 9.6-3.7-1.7-6.5-5-6.5-9.6V5.1z" />
      <path d="M7 10l2.2 2.2L13.3 8" />
    </svg>
  )
}

// Two corner finder squares + a scattered data grid -- a simplified QR code
// glyph for the Staff Page sidebar's QR Codes item. Nothing else in the app
// covers this shape.
export function QrCodeIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <rect x="2.5" y="2.5" width="5.5" height="5.5" rx="0.8" />
      <rect x="12" y="2.5" width="5.5" height="5.5" rx="0.8" />
      <rect x="2.5" y="12" width="5.5" height="5.5" rx="0.8" />
      <rect x="4.6" y="4.6" width="1.3" height="1.3" fill="currentColor" stroke="none" />
      <rect x="14.1" y="4.6" width="1.3" height="1.3" fill="currentColor" stroke="none" />
      <rect x="4.6" y="14.1" width="1.3" height="1.3" fill="currentColor" stroke="none" />
      <rect x="12" y="12" width="2.4" height="2.4" />
      <rect x="15.1" y="12" width="2.4" height="2.4" />
      <rect x="12" y="15.1" width="2.4" height="2.4" />
      <rect x="15.1" y="15.1" width="2.4" height="2.4" />
    </svg>
  )
}

// Compass -- the nav dropdown's "Explore" section header. Nothing else in the
// app covers this shape.
export function CompassIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M13 7l-1.8 4.2L7 13l1.8-4.2z" />
    </svg>
  )
}

// Five-point star -- the nav dropdown's "Activities" section header. Nothing
// else in the app covers this shape.
export function StarIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M10 2.5l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5-3.7-3.4 5-.6z" />
    </svg>
  )
}

// Backpack -- the nav dropdown's "My Collection" section header. Nothing else
// in the app covers this shape.
export function BackpackIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M4.5 9a5.5 5.5 0 0 1 11 0v8.5h-11z" />
      <path d="M7.5 4.2V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.2" />
      <rect x="7" y="11.5" width="6" height="3.5" rx="0.8" />
    </svg>
  )
}

// Gear -- the nav dropdown's "Help & Settings" section header. Nothing else
// in the app covers this shape.
export function GearIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2v2.2M10 15.8V18M2 10h2.2M15.8 10H18M4.3 4.3l1.6 1.6M14.1 14.1l1.6 1.6M4.3 15.7l1.6-1.6M14.1 5.9l1.6-1.6" />
      <circle cx="10" cy="10" r="5.4" />
    </svg>
  )
}

// Plain X -- the nav dropdown panel's own close button. Nothing else in the
// app covers this shape.
export function CloseIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <line x1="4.5" y1="4.5" x2="15.5" y2="15.5" />
      <line x1="15.5" y1="4.5" x2="4.5" y2="15.5" />
    </svg>
  )
}

// Down chevron -- the nav dropdown's "more below" scroll hint. Pairs with
// ChevronLeftIcon/ChevronRightIcon above.
export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg className={className} {...commonProps}>
      <path d="M3.5 7.5L10 13.5l6.5-6" />
    </svg>
  )
}
