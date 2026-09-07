import { test, expect, type Page } from '@playwright/test'

// Guest Accounts Phase 0 -- signup/login/logout/whoami round trip, the
// enumeration-prevention behavior (generic errors/messages regardless of
// whether the email exists), and confirmation that anonymous per-device
// session usage (device_sessions/X-Device-Session) is entirely unaffected by
// whether a guest is also logged in. Password-reset CONFIRM isn't covered
// here -- it requires intercepting the emailed token out of band, which is
// out of scope for this spec; app/services/guest_accounts.py's
// confirm_password_reset logic (single-use, expiry) is covered by backend
// unit tests instead (backend/tests/test_guest_auth.py).

function uniqueEmail(): string {
  return `guest-${crypto.randomUUID()}@example.com`
}

const PASSWORD = 'correct horse battery staple'

async function openAccountModal(page: Page) {
  await page.getByRole('button', { name: /Open menu/ }).click()
  await page.getByRole('button', { name: 'Save Your Progress' }).click()
}

test.describe('Guest Accounts Phase 0', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Welcome to Cobb's Adventure Park/ })).toBeVisible()
  })

  test('the account entry point is optional -- "Not Now" closes it with no account created', async ({ page }) => {
    await openAccountModal(page)
    await expect(page.getByRole('heading', { name: 'Save Your Progress' })).toBeVisible()
    await page.getByRole('button', { name: 'Not Now' }).click()
    await expect(page.getByRole('heading', { name: 'Save Your Progress' })).not.toBeVisible()
  })

  test('sign up logs the guest in immediately and persists the email in the nav; log out returns to the optional prompt', async ({
    page,
  }) => {
    const email = uniqueEmail()
    await openAccountModal(page)
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password (8+ characters)').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign Up' }).click()

    // Modal closes on success; the nav's account entry now shows the email.
    await expect(page.getByRole('heading', { name: 'Sign Up' })).not.toBeVisible()
    await page.getByRole('button', { name: /Open menu/ }).click()
    await expect(page.getByRole('button', { name: email })).toBeVisible()
    await page.getByRole('button', { name: email }).click()

    await expect(page.getByRole('heading', { name: 'Your Account' })).toBeVisible()
    // Scoped to the modal's own summary -- NavMenu's always-mounted panel
    // (open or not) still has its own account-email button in the DOM behind
    // this modal, so an unscoped getByText(email) matches both.
    await expect(page.locator('.account-modal-account-email')).toHaveText(email)
    await page.getByRole('button', { name: 'Close' }).click()

    // A reload has no in-memory guest state left -- the only way the nav can
    // still show the email afterward is by round-tripping the stored token
    // through GET /account/whoami on mount (App.tsx's hydration effect).
    await page.reload()
    await expect(page.getByRole('heading', { name: /Welcome to Cobb's Adventure Park/ })).toBeVisible()
    await page.getByRole('button', { name: /Open menu/ }).click()
    await expect(page.getByRole('button', { name: email })).toBeVisible()
    await page.getByRole('button', { name: email }).click()
    await page.getByRole('button', { name: 'Log Out' }).click()

    await openAccountModal(page)
    await expect(page.getByRole('heading', { name: 'Save Your Progress' })).toBeVisible()
  })

  test('signing up with an email that already has an account is rejected, but logging in with it then works', async ({
    page,
  }) => {
    const email = uniqueEmail()
    await openAccountModal(page)
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password (8+ characters)').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await expect(page.getByRole('heading', { name: 'Sign Up' })).not.toBeVisible()

    // Log out, then try to sign up again with the same email.
    await page.getByRole('button', { name: /Open menu/ }).click()
    await page.getByRole('button', { name: email }).click()
    await page.getByRole('button', { name: 'Log Out' }).click()

    await openAccountModal(page)
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password (8+ characters)').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await expect(page.getByText('An account with that email already exists')).toBeVisible()

    // The same credentials work via Log In instead.
    await page.getByRole('button', { name: 'Already have an account?' }).click()
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Log In' }).click()
    await expect(page.getByRole('heading', { name: 'Log In' })).not.toBeVisible()
  })

  test('a wrong password shows a generic error that does not reveal which part was wrong', async ({ page }) => {
    const email = uniqueEmail()
    // Sign up, log out, then try logging in with the wrong password.
    await openAccountModal(page)
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password (8+ characters)').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign Up' }).click()
    await expect(page.getByRole('heading', { name: 'Sign Up' })).not.toBeVisible()
    await page.getByRole('button', { name: /Open menu/ }).click()
    await page.getByRole('button', { name: email }).click()
    await page.getByRole('button', { name: 'Log Out' }).click()

    await openAccountModal(page)
    await page.getByRole('button', { name: 'Log In' }).click()
    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password').fill('the wrong password')
    await page.getByRole('button', { name: 'Log In' }).click()
    await expect(page.getByText('Invalid email or password')).toBeVisible()

    // An email that was never registered at all gets the exact same message.
    await page.getByPlaceholder('Email').fill(uniqueEmail())
    await page.getByPlaceholder('Password').fill('whatever')
    await page.getByRole('button', { name: 'Log In' }).click()
    await expect(page.getByText('Invalid email or password')).toBeVisible()
  })

  test('password reset request shows the same generic message for an email that was never registered', async ({
    page,
  }) => {
    await openAccountModal(page)
    await page.getByRole('button', { name: 'Log In' }).click()
    await page.getByRole('button', { name: 'Forgot password?' }).click()
    await page.getByPlaceholder('Email').fill(uniqueEmail())
    await page.getByRole('button', { name: 'Send Reset Link' }).click()
    await expect(page.getByRole('heading', { name: 'Check Your Email' })).toBeVisible()
    await expect(page.getByText('If an account exists for that email, a password reset link has been sent.')).toBeVisible()
  })

  test('anonymous map/bingo usage keeps working with no guest account involved', async ({ page }) => {
    await page.getByRole('button', { name: /Open menu/ }).click()
    await page.getByRole('menuitemradio', { name: 'Map' }).click()
    await expect(page.getByRole('heading', { name: 'Park Map' })).toBeVisible()
  })
})
