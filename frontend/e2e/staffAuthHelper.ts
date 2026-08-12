import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendEnvPath = path.resolve(__dirname, '..', '..', 'backend', '.env')

// Playwright's Node process doesn't load backend/.env (that's the FastAPI
// webServer's job, via python-dotenv) -- read the same file directly so
// specs can log in as staff without hardcoding a password in a checked-in
// file. Mirrors the direct-filesystem-path pattern global-setup.ts already
// uses for the backend dir.
function readStaffPassword(): string {
  const contents = readFileSync(backendEnvPath, 'utf-8')
  const match = contents.match(/^STAFF_PASSWORD=(.*)$/m)
  if (!match || !match[1]) {
    throw new Error(`STAFF_PASSWORD not set in ${backendEnvPath} -- required for staff-gated e2e specs.`)
  }
  return match[1].trim()
}

// Navigates to /staff and logs in, leaving the page on the loaded staff
// view. Safe to call on a fresh page/context with no prior staff session.
export async function loginAsStaff(page: Page): Promise<void> {
  await page.goto('/staff')
  await page.getByLabel('Password').fill(readStaffPassword())
  await page.getByRole('button', { name: 'Log In' }).click()
  await page.getByRole('tab', { name: 'Photo Queue' }).waitFor()
}
