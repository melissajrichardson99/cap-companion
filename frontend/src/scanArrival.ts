import { api, type ManualEntryMatchType } from './api'

// Every QR sign in the park encodes a full <frontend_base_url>/<prefix>/<id>
// URL (so a phone's own camera app works with no app install, no in-app
// scanning needed) -- the path prefix says which of the 4 destinations it
// is. Shared by ScanEntryModal's routing and the Staff Visit Heatmap's scan
// logging below.
export const ROUTE_PREFIXES: { prefix: string; type: ManualEntryMatchType }[] = [
  { prefix: '/scan/', type: 'scan' },
  { prefix: '/animals/', type: 'animal' },
  { prefix: '/scoring/', type: 'scoring' },
  { prefix: '/puzzles/', type: 'puzzle' },
]

// The destination an app path is the QR landing page for, or null. Exactly
// /<prefix>/<id> -- a sub-page like /animals/goat/cards is never a QR
// landing page.
export function scanTargetFromPath(pathname: string): { type: ManualEntryMatchType; id: string } | null {
  for (const { prefix, type } of ROUTE_PREFIXES) {
    if (!pathname.startsWith(prefix)) continue
    const rest = pathname.slice(prefix.length).replace(/\/$/, '')
    if (!rest || rest.includes('/')) return null
    try {
      return { type, id: decodeURIComponent(rest) }
    } catch {
      return null
    }
  }
  return null
}

// Staff Visit Heatmap Phase 2: what counts as a QR scan is a guest
// *arriving* at a destination by scanning its QR or typing its sign code --
// never browsing to it inside the app. Two arrival paths, logged from two
// places:
//
// 1. In-app: ScanEntryModal (camera decode or manual entry) calls
//    logScanForPath with the path it's about to navigate to.
// 2. Phone camera app: the QR's URL opens as a fresh page load straight onto
//    the destination route. logInitialPageLoadScan (called once from
//    main.tsx, before React renders) logs it if the page's very first URL is
//    a QR landing path and the load was a normal navigation -- a reload or
//    back/forward to that page is not a new scan. A bookmark or a shared
//    link opened fresh is indistinguishable from a scan here and is
//    counted; a ?src=qr marker would avoid that but would miss every QR
//    already printed.
//
// In-app navigation to the same routes (e.g. Our Animals' list -> detail)
// goes through neither, so it never logs. Fire-and-forget: a failed log
// (including the backend's 404 for an unknown code) never affects the guest.
export function logScanForPath(pathname: string): void {
  const target = scanTargetFromPath(pathname)
  if (!target) return
  api.logScanEvent(target.type, target.id).catch(() => {})
}

let initialLoadHandled = false

export function logInitialPageLoadScan(): void {
  // Module-level one-shot: runs outside React, so StrictMode's double-invoked
  // effects can't repeat it, and a second call is a no-op regardless.
  if (initialLoadHandled) return
  initialLoadHandled = true
  const entry = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined
  if (entry && entry.type !== 'navigate') return
  logScanForPath(window.location.pathname)
}
