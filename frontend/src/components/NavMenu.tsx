import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './NavMenu.css'

export interface NavMenuTab<T extends string> {
  key: T
  label: string
  icon: ReactNode
}

interface NavMenuProps<T extends string> {
  tabs: NavMenuTab<T>[]
  // null while on Home -- Home isn't itself one of `tabs` (it's reached via
  // the logo, not the dropdown), so no tab should render as active there.
  activeTab: T | null
  onSelectTab: (tab: T) => void
  coinTotal: number
  onScanQr: () => void
  onGeneratePassport: () => void
  onContactStaff: () => void
  onResetSession: () => void
  onStaffNav: () => void
}

// Guest-facing mobile nav: a hamburger toggle that opens a panel anchored to
// the top-right of the header. The panel is always mounted (never
// conditionally rendered) so open AND close both animate via CSS transitions
// on the "open" class -- conditional rendering would give us the open
// animation but the close would just snap.
export function NavMenu<T extends string>({
  tabs,
  activeTab,
  onSelectTab,
  coinTotal,
  onScanQr,
  onGeneratePassport,
  onContactStaff,
  onResetSession,
  onStaffNav,
}: NavMenuProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

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
  // each screen to work around it individually.
  useEffect(() => {
    if (open) return
    document.getElementById('app-root')?.scrollTo({ left: 0, top: 0 })
  }, [open])

  const selectTab = (tab: T) => {
    onSelectTab(tab)
    setOpen(false)
  }

  const runAction = (action: () => void) => {
    action()
    setOpen(false)
  }

  return (
    <div className="nav-menu" ref={rootRef}>
      <button
        type="button"
        className={`nav-menu-toggle ${open ? 'nav-menu-toggle-open' : ''}`}
        aria-expanded={open}
        aria-controls="nav-menu-panel"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="nav-menu-toggle-bar" />
        <span className="nav-menu-toggle-bar" />
        <span className="nav-menu-toggle-bar" />
      </button>

      {/* Covers the full viewport (fixed, inset:0) while open, above every
          other page element but below the toggle/panel (z-index 1 vs. 2-3
          in NavMenu.css) -- so it visually and functionally IS "outside the
          dropdown": any click/tap that isn't on the toggle or panel lands
          here and closes the menu, on both mouse and touch since it's a
          plain onClick. The toggle sits above it in stacking, so a click on
          the toggle always hits the toggle itself, never this backdrop --
          no fight with the toggle's own open/close handler. */}
      <div
        className={`nav-menu-backdrop ${open ? 'nav-menu-backdrop-open' : ''}`}
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />

      <div id="nav-menu-panel" className={`nav-menu-panel ${open ? 'nav-menu-panel-open' : ''}`} role="menu">
        <div className="nav-menu-frame">
          <div className="nav-menu-panel-inner">
            <span className="nav-menu-coins" role="menuitem" aria-label={`${coinTotal} Cobb Coins earned`}>
              🪙 {coinTotal} Cobb Coins
            </span>

            <nav className="nav-menu-tabs">
              {tabs.map((tab) => {
                const isActive = tab.key === activeTab
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    className={`nav-menu-tab ${isActive ? 'nav-menu-tab-active' : ''}`}
                    onClick={() => selectTab(tab.key)}
                  >
                    <span className="nav-menu-tab-icon" aria-hidden="true">
                      {tab.icon}
                    </span>
                    {tab.label}
                  </button>
                )
              })}
            </nav>

            <div className="nav-menu-actions">
              <button type="button" className="btn btn-primary" onClick={() => runAction(onScanQr)}>
                Scan QR
              </button>
              <button type="button" className="btn btn-primary" onClick={() => runAction(onGeneratePassport)}>
                Generate Passport
              </button>
              <button type="button" className="btn btn-danger" onClick={() => runAction(onContactStaff)}>
                Contact Staff
              </button>
            </div>

            <div className="nav-menu-footer">
              <button type="button" className="nav-menu-staff-link" onClick={() => runAction(onStaffNav)}>
                Staff
              </button>
              <button type="button" className="nav-menu-reset-link" onClick={() => runAction(onResetSession)}>
                Reset Session
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
