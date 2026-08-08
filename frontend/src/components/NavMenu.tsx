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
  activeTab: T
  onSelectTab: (tab: T) => void
  coinTotal: number
  onScanQr: () => void
  onGeneratePassport: () => void
  onContactStaff: () => void
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

      <div className={`nav-menu-backdrop ${open ? 'nav-menu-backdrop-open' : ''}`} aria-hidden="true" />

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
          </div>
        </div>
      </div>
    </div>
  )
}
