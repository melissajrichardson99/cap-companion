import { expect, type Locator, type Page } from '@playwright/test'

// Shared helpers for the guest nav dropdown (NavMenu.tsx). The hamburger
// toggle ("Open menu") hides while the panel is open; the panel's own X
// ("Close menu") is then the single close control.

export function navPanel(page: Page): Locator {
  return page.locator('#nav-menu-panel')
}

export async function openNavMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(navPanel(page)).toHaveClass(/nav-menu-panel-open/)
}

export async function closeNavMenu(page: Page): Promise<void> {
  await navPanel(page).getByRole('button', { name: 'Close menu' }).click()
  await expect(navPanel(page)).not.toHaveClass(/nav-menu-panel-open/)
}

// Opens the menu and picks a route tile (role="menuitemradio") by its label.
// Playwright scrolls the panel's scrolling middle to the tile on its own.
export async function openTab(page: Page, label: string): Promise<void> {
  await openNavMenu(page)
  await page.getByRole('menuitemradio', { name: label, exact: true }).click()
}
