import type { ReactNode } from 'react'
import { BrandLogo } from './BrandLogo'
import { BarChartIcon, BinocularsIcon, CameraIcon, MapPinIcon, MegaphoneIcon, MessageIcon } from './NavIcons'
import './StaffSidebar.css'

export type StaffTab = 'photos' | 'requests' | 'announcements' | 'attractions' | 'animal-photos' | 'analytics'

interface StaffSidebarProps {
  tab: StaffTab
  onSelectTab: (tab: StaffTab) => void
  pendingPhotosCount: number
  openRequestsCount: number
}

interface SidebarItem {
  key: StaffTab
  label: string
  icon: ReactNode
  badge?: number
}

// Exactly the real, currently-implemented Staff Page features (Part 1 of the
// analytics feature plan) plus the new Analytics dashboard -- deliberately
// excludes the mockup's Dashboard/Reports/Settings/Quick Actions/Food Trucks,
// none of which have a real staff-manageable backing feature.
export function StaffSidebar({ tab, onSelectTab, pendingPhotosCount, openRequestsCount }: StaffSidebarProps) {
  const items: SidebarItem[] = [
    { key: 'photos', label: 'Photo Queue', icon: <CameraIcon />, badge: pendingPhotosCount },
    { key: 'requests', label: 'Contact Requests', icon: <MessageIcon />, badge: openRequestsCount },
    { key: 'announcements', label: 'Announcements', icon: <MegaphoneIcon /> },
    { key: 'attractions', label: 'Attractions', icon: <MapPinIcon /> },
    { key: 'animal-photos', label: 'Animal Photos', icon: <BinocularsIcon /> },
    { key: 'analytics', label: 'Analytics', icon: <BarChartIcon /> },
  ]

  return (
    <nav className="staff-sidebar" aria-label="Staff sections">
      {/* Same wood-frame + green-panel recipe as the guest-facing nav
          dropdown (.nav-menu-frame/.nav-menu-panel-inner in NavMenu.css) --
          one continuous card, not the old two stacked wood-framed blocks. */}
      <div className="staff-sidebar-frame">
        <div className="staff-sidebar-inner">
          <div className="staff-sidebar-brand">
            <BrandLogo />
          </div>
          <div className="staff-sidebar-tabs" role="tablist">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                className={`staff-sidebar-tab ${tab === item.key ? 'staff-sidebar-tab-active' : ''}`}
                onClick={() => onSelectTab(item.key)}
              >
                <span className="staff-sidebar-tab-icon">{item.icon}</span>
                <span className="staff-sidebar-tab-label">{item.label}</span>
                {/* aria-hidden: decorative count, kept out of the tab's
                    accessible name so it stays exactly the label text (existing
                    e2e specs locate tabs by name). */}
                {!!item.badge && (
                  <span className="staff-sidebar-tab-badge" aria-hidden="true">
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </nav>
  )
}
