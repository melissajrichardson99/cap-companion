import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { StaffRequestStatus } from '../api'
import { BackpackIcon, ChevronDownIcon, CloseIcon, CompassIcon, GearIcon, MessageIcon, PassportIcon, QrCodeIcon, StarIcon, UserIcon } from './NavIcons'
import './NavMenu.css'

// The dropdown's grouped sections, in render order. Each tab in `tabs` names
// the section it belongs to; the non-route actions (Generate Passport, Save
// Your Progress, Staff, Reset Session) are slotted into their sections below
// rather than living in `tabs`, since they open modals/other pages instead of
// switching the active guest route.
export type NavMenuSection = 'explore' | 'activities' | 'collection' | 'help'

const SECTIONS: { key: NavMenuSection; label: string; icon: ReactNode }[] = [
  { key: 'explore', label: 'Explore', icon: <CompassIcon /> },
  { key: 'activities', label: 'Activities', icon: <StarIcon /> },
  { key: 'collection', label: 'My Collection', icon: <BackpackIcon /> },
  { key: 'help', label: 'Help & Settings', icon: <GearIcon /> },
]

export interface NavMenuTab<T extends string> {
  key: T
  label: string
  icon: ReactNode
  section: NavMenuSection
}

interface NavMenuProps<T extends string> {
  tabs: NavMenuTab<T>[]
  // null when the current route isn't one of `tabs` (e.g. a /staff page).
  activeTab: T | null
  onSelectTab: (tab: T) => void
  coinTotal: number
  // The guest's own active (open/acknowledged) Contact Staff request status,
  // if any -- null when there isn't one. Drives the persistent "you have an
  // active request" badge, the check-anytime counterpart to the proactive
  // toast App.tsx fires on open -> acknowledged.
  contactRequestStatus: StaffRequestStatus | null
  // Guest Accounts Phase 0 -- "Save Your Progress" when logged out, the
  // guest's own email when logged in. Entirely optional/additive: this is
  // the one discoverable entry point into AccountModal.
  accountLabel: string
  // True while logged in -- the email label is too long for a half-width
  // tile, so the account tile (and Generate Passport, to keep the grid even)
  // goes full-width instead of truncating it to nothing.
  accountSignedIn: boolean
  onScanQr: () => void
  onGeneratePassport: () => void
  onContactStaff: () => void
  onResetSession: () => void
  onStaffNav: () => void
  onAccount: () => void
}

// Guest-facing mobile nav: a hamburger toggle that opens a panel anchored to
// the top-right of the header. The panel is always mounted (never
// conditionally rendered) so open AND close both animate via CSS transitions
// on the "open" class -- conditional rendering would give us the open
// animation but the close would just snap.
//
// Panel layout: a pinned header (Cobb Coins + close X, then Scan QR -- the
// app's key action and the panel's only filled orange element), a scrolling
// middle of grouped two-column tiles, and a pinned footer (Contact Staff).
// Only the middle scrolls, so Scan QR and Contact Staff stay reachable on
// short/landscape screens. The hamburger toggle hides while the panel is open
// -- the panel's own X is the one close control.
export function NavMenu<T extends string>({
  tabs,
  activeTab,
  onSelectTab,
  coinTotal,
  contactRequestStatus,
  accountLabel,
  accountSignedIn,
  onScanQr,
  onGeneratePassport,
  onContactStaff,
  onResetSession,
  onStaffNav,
  onAccount,
}: NavMenuProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const scrollContentRef = useRef<HTMLDivElement | null>(null)
  // Set by the "just dismiss" close paths (X, Escape, outside click) so focus
  // goes back to the toggle once it's visible again. Not set by tab/action
  // clicks: those navigate or open a modal, and pulling focus to the toggle
  // would steal it from that modal.
  const restoreFocusRef = useRef(false)

  // Scroll hint state for the scrolling middle -- whether there's content
  // hidden above/below, and whether the guest has scrolled yet this open
  // (the "more" chevron only shows until they do).
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)
  const [hasScrolled, setHasScrolled] = useState(false)

  const dismiss = useCallback(() => {
    restoreFocusRef.current = true
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) dismiss()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open, dismiss])

  // The toggle hides while open, so focus moves into the panel (its X) on
  // open, and back to the toggle on a dismiss. preventScroll for the same
  // #app-root scroll-drift reason as the effect below.
  useEffect(() => {
    if (open) {
      // Reset here, not on close -- the close effect's scrollTo fires a
      // late scroll event that would immediately mark it scrolled again.
      setHasScrolled(false)
      closeRef.current?.focus({ preventScroll: true })
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current = false
      toggleRef.current?.focus({ preventScroll: true })
    }
  }, [open])

  const updateScrollHint = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // 2px slack so sub-pixel layout never leaves a stray hint at either end.
    setCanScrollUp(el.scrollTop > 2)
    setCanScrollDown(el.scrollHeight - el.clientHeight - el.scrollTop > 2)
  }, [])

  // Re-measure whenever the scroll area or its content changes size --
  // rotation, a viewport resize, or the tile count changing (signed-in state
  // widens two tiles) -- not just on scroll.
  useEffect(() => {
    const el = scrollRef.current
    const content = scrollContentRef.current
    if (!el || !content) return
    updateScrollHint()
    const observer = new ResizeObserver(updateScrollHint)
    observer.observe(el)
    observer.observe(content)
    return () => observer.disconnect()
  }, [updateScrollHint])

  // The always-mounted panel above (position:absolute, closed state still
  // laid out just transformed/faded) sits inside #app-root's scrollable-
  // overflow region even while closed. Focusing a panel button -- opening
  // the menu, then any close path (tab select, action click, Escape, outside
  // click) that shifts focus back -- makes the browser auto-scroll #app-root
  // (overflow:hidden, App.css, but still programmatically scrollable) to
  // keep the newly/previously focused element in view, leaving a stray
  // scrollLeft/scrollTop that persists app-wide since nothing else resets it.
  // Invisible on screens whose content sits inset from #app-root's edges,
  // but it clips anything flush against them (e.g. Map's border foliage,
  // AnimalsScreen's flush header). Reset on every close instead of leaving
  // each screen to work around it individually. Also rewinds the panel's own
  // scrolling middle, so every open starts at Explore.
  useEffect(() => {
    if (open) return
    document.getElementById('app-root')?.scrollTo({ left: 0, top: 0 })
    scrollRef.current?.scrollTo({ top: 0 })
    updateScrollHint()
  }, [open, updateScrollHint])

  const selectTab = (tab: T) => {
    onSelectTab(tab)
    setOpen(false)
  }

  const runAction = (action: () => void) => {
    action()
    setOpen(false)
  }

  const renderSectionExtras = (section: NavMenuSection) => {
    if (section === 'collection') {
      return (
        <>
          <button
            type="button"
            className={`nav-menu-tile ${accountSignedIn ? 'nav-menu-tile-wide' : ''}`}
            onClick={() => runAction(onGeneratePassport)}
          >
            <span className="nav-menu-tile-icon" aria-hidden="true">
              <PassportIcon />
            </span>
            <span className="nav-menu-tile-label">Generate Passport</span>
          </button>
          <button
            type="button"
            className={`nav-menu-tile ${accountSignedIn ? 'nav-menu-tile-wide' : ''}`}
            onClick={() => runAction(onAccount)}
          >
            <span className="nav-menu-tile-icon" aria-hidden="true">
              <UserIcon />
            </span>
            <span className="nav-menu-tile-label">{accountLabel}</span>
          </button>
        </>
      )
    }
    return null
  }

  return (
    <div className="nav-menu" ref={rootRef}>
      <button
        ref={toggleRef}
        type="button"
        className={`nav-menu-toggle ${open ? 'nav-menu-toggle-hidden' : ''}`}
        aria-expanded={open}
        aria-controls="nav-menu-panel"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
      >
        <span className="nav-menu-toggle-bar" />
        <span className="nav-menu-toggle-bar" />
        <span className="nav-menu-toggle-bar" />
      </button>

      {/* Covers the full viewport (fixed, inset:0) while open, above every
          other page element (header included) but below the panel (z-index
          1 vs. 2 in NavMenu.css) -- so it visually and functionally IS
          "outside the dropdown": any click/tap that isn't on the panel lands
          here and closes the menu, on both mouse and touch since it's a
          plain onClick. */}
      <div
        className={`nav-menu-backdrop ${open ? 'nav-menu-backdrop-open' : ''}`}
        aria-hidden="true"
        onClick={dismiss}
      />

      {/* aria-hidden + inert the instant it closes, not after the CSS
          fade-out's delayed visibility:hidden -- otherwise, for those 180ms,
          the closing panel's controls (e.g. its "Close menu" X) are still
          in the accessibility tree alongside whatever modal the action just
          opened. */}
      <div
        id="nav-menu-panel"
        className={`nav-menu-panel ${open ? 'nav-menu-panel-open' : ''}`}
        role="menu"
        aria-hidden={!open}
        inert={!open}
      >
        <div className="nav-menu-frame">
          <div className="nav-menu-panel-inner">
            <div className="nav-menu-header">
              <span className="nav-menu-coins" role="menuitem" aria-label={`${coinTotal} Cobb Coins earned`}>
                🪙 {coinTotal} Cobb Coins
              </span>
              <button ref={closeRef} type="button" className="nav-menu-close" aria-label="Close menu" onClick={dismiss}>
                <CloseIcon />
              </button>
              <button type="button" className="nav-menu-scan" onClick={() => runAction(onScanQr)}>
                <span className="nav-menu-scan-icon" aria-hidden="true">
                  <QrCodeIcon />
                </span>
                Scan QR
              </button>
            </div>

            <div
              className="nav-menu-scroll-wrap"
              data-can-scroll-up={canScrollUp}
              data-can-scroll-down={canScrollDown}
            >
              <div
                className="nav-menu-scroll"
                ref={scrollRef}
                onScroll={() => {
                  setHasScrolled(true)
                  updateScrollHint()
                }}
              >
                <div className="nav-menu-scroll-content" ref={scrollContentRef}>
                  {SECTIONS.map((section) => (
                    <div
                      key={section.key}
                      className={`nav-menu-section nav-menu-section-${section.key}`}
                      role="group"
                      aria-labelledby={`nav-menu-section-${section.key}`}
                    >
                      <div className="nav-menu-section-header" id={`nav-menu-section-${section.key}`}>
                        <span className="nav-menu-section-icon" aria-hidden="true">
                          {section.icon}
                        </span>
                        {section.label}
                      </div>
                      <div className="nav-menu-tiles">
                        {tabs
                          .filter((tab) => tab.section === section.key)
                          .map((tab) => {
                            const isActive = tab.key === activeTab
                            return (
                              <button
                                key={tab.key}
                                type="button"
                                role="menuitemradio"
                                aria-checked={isActive}
                                className={`nav-menu-tile ${isActive ? 'nav-menu-tile-active' : ''}`}
                                onClick={() => selectTab(tab.key)}
                              >
                                <span className="nav-menu-tile-icon" aria-hidden="true">
                                  {tab.icon}
                                </span>
                                <span className="nav-menu-tile-label">{tab.label}</span>
                              </button>
                            )
                          })}
                        {renderSectionExtras(section.key)}
                      </div>
                      {/* Staff and Reset Session -- quiet text rows, not tiles:
                          irrelevant to almost every guest. /staff is gated
                          behind its own login (StaffPage), so Staff doesn't
                          need hiding for security. Reset Session never resets
                          anything by itself -- onResetSession only opens
                          ResetSessionModal's confirm step. */}
                      {section.key === 'help' && (
                        <div className="nav-menu-quiet-rows">
                          <button type="button" className="nav-menu-quiet-row" onClick={() => runAction(onStaffNav)}>
                            Staff
                          </button>
                          <button
                            type="button"
                            className="nav-menu-quiet-row nav-menu-reset-link"
                            onClick={() => runAction(onResetSession)}
                          >
                            Reset Session
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {/* Scroll hints -- decorative only (aria-hidden, pointer-events
                  none in NavMenu.css), driven by the real scroll position:
                  soft fades at whichever edge has more content past it, and
                  a small "more" chevron until the guest first scrolls. */}
              <div className={`nav-menu-fade nav-menu-fade-top ${canScrollUp ? 'nav-menu-fade-visible' : ''}`} aria-hidden="true" />
              <div className={`nav-menu-fade nav-menu-fade-bottom ${canScrollDown ? 'nav-menu-fade-visible' : ''}`} aria-hidden="true" />
              <div
                className={`nav-menu-more ${open && canScrollDown && !hasScrolled ? 'nav-menu-more-visible' : ''}`}
                aria-hidden="true"
              >
                <ChevronDownIcon />
              </div>
            </div>

            <div className="nav-menu-footer">
              <button
                type="button"
                className="nav-menu-contact-staff-btn"
                aria-label={contactRequestStatus ? `Contact Staff — request ${contactRequestStatus}` : undefined}
                onClick={() => runAction(onContactStaff)}
              >
                <span className="nav-menu-contact-staff-icon" aria-hidden="true">
                  <MessageIcon />
                </span>
                Contact Staff
                {contactRequestStatus && (
                  <span
                    className={`nav-menu-contact-staff-badge nav-menu-contact-staff-badge-${contactRequestStatus}`}
                    aria-hidden="true"
                  />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
