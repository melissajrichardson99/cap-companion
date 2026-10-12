import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BrandLogo } from './BrandLogo'
import {
  ArrowUpRightIcon,
  BarChartIcon,
  BinocularsIcon,
  CameraIcon,
  HeatmapIcon,
  MapPinIcon,
  MegaphoneIcon,
  MessageIcon,
  QrCodeIcon,
} from './NavIcons'
import './StaffSidebar.css'

export const STAFF_TABS = [
  'photos',
  'requests',
  'announcements',
  'attractions',
  'animal-photos',
  'analytics',
  'qr-codes',
] as const

export type StaffTab = (typeof STAFF_TABS)[number]

export function isStaffTab(value: unknown): value is StaffTab {
  return typeof value === 'string' && (STAFF_TABS as readonly string[]).includes(value)
}

// Router state key /staff reads its initial tab from (StaffPage.tsx) -- set
// when a tab is picked from the sidebar on a standalone staff page.
export interface StaffNavState {
  staffTab?: StaffTab
}

// Two modes: on /staff itself (tab + onSelectTab) the tabs switch in place;
// on a standalone staff page (currentPage, no onSelectTab) they navigate to
// /staff with the chosen tab open, no tab is selected, and that page's own
// link is the current one. Badge counts are optional -- standalone pages
// don't fetch the photo/request lists just for them.
type StaffSidebarProps =
  | {
      tab: StaffTab
      onSelectTab: (tab: StaffTab) => void
      pendingPhotosCount: number
      openRequestsCount: number
      currentPage?: undefined
    }
  | {
      tab?: undefined
      onSelectTab?: undefined
      pendingPhotosCount?: undefined
      openRequestsCount?: undefined
      currentPage: 'heatmap'
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
export function StaffSidebar({ tab, onSelectTab, pendingPhotosCount, openRequestsCount, currentPage }: StaffSidebarProps) {
  const navigate = useNavigate()
  const selectTab = (key: StaffTab) => {
    if (onSelectTab) onSelectTab(key)
    else navigate('/staff', { state: { staffTab: key } satisfies StaffNavState })
  }
  const heatmapCurrent = currentPage === 'heatmap'

  const items: SidebarItem[] = [
    { key: 'photos', label: 'Photo Queue', icon: <CameraIcon />, badge: pendingPhotosCount },
    { key: 'requests', label: 'Contact Requests', icon: <MessageIcon />, badge: openRequestsCount },
    { key: 'announcements', label: 'Announcements', icon: <MegaphoneIcon /> },
    { key: 'attractions', label: 'Attractions', icon: <MapPinIcon /> },
    { key: 'animal-photos', label: 'Animal Photos', icon: <BinocularsIcon /> },
    { key: 'analytics', label: 'Analytics', icon: <BarChartIcon /> },
    { key: 'qr-codes', label: 'QR Codes', icon: <QrCodeIcon /> },
  ]

  return (
    // Anchor wrapper (StaffSidebar.css) -- mirrors #root's own centering
    // recipe so the rail below tracks #root's real edge exactly, including
    // when a vertical scrollbar appears on tall tabs.
    <div className="staff-sidebar-anchor">
      <nav className="staff-sidebar" aria-label="Staff sections">
        <div className="staff-sidebar-brand">
          {/* Real navigation to the guest-facing Home Page -- does not touch
              the staff auth token, so returning to /staff later still works. */}
          <BrandLogo onClick={() => navigate('/')} />
        </div>
        <div className="staff-sidebar-tabs" role="tablist">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={`staff-sidebar-tab ${tab === item.key ? 'staff-sidebar-tab-active' : ''}`}
              onClick={() => selectTab(item.key)}
            >
              {/* Label before the icon+badge group in DOM order (accessible
                  name / textContent must stay "<label><badge digits>", exactly
                  as before) -- the icon+badge group is pulled visually above
                  the label with CSS `order` so it still LOOKS icon-on-top. */}
              <span className="staff-sidebar-tab-label">{item.label}</span>
              <span className="staff-sidebar-tab-icon-wrap">
                <span className="staff-sidebar-tab-icon">{item.icon}</span>
                {/* aria-hidden: decorative count, kept out of the tab's
                    accessible name so it stays exactly the label text (existing
                    e2e specs locate tabs by name). */}
                {!!item.badge && (
                  <span className="staff-sidebar-tab-badge" aria-hidden="true">
                    {item.badge}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
        {/* Separate standalone pages (own routes, not in-page tabs) -- kept
            outside the tablist so it only ever contains real tabs, below a
            divider and marked with an arrow so it doesn't read as one more
            tab. Same staff token, so no second login either way. On the
            page itself it's marked current (aria-current + active style). */}
        <div className="staff-sidebar-pages">
          <Link
            to="/staff/heatmap"
            aria-current={heatmapCurrent ? 'page' : undefined}
            className={`staff-sidebar-tab staff-sidebar-page-link ${heatmapCurrent ? 'staff-sidebar-tab-active' : ''}`}
          >
            <span className="staff-sidebar-tab-label">Heatmap</span>
            <span className="staff-sidebar-tab-icon-wrap">
              <span className="staff-sidebar-tab-icon">
                <HeatmapIcon />
              </span>
              <ArrowUpRightIcon className="staff-sidebar-page-link-arrow" />
            </span>
          </Link>
        </div>
      </nav>
    </div>
  )
}
