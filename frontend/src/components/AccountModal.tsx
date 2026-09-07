import { useState } from 'react'
import { api, type Guest, type GuestBingoMapStatus, type PassportSession } from '../api'
import { Modal } from './Modal'
import { PassportCard } from './PassportCard'
import { UserIcon } from './NavIcons'
import './AccountModal.css'

type Step =
  | 'menu'
  | 'login'
  | 'signup'
  | 'forgot'
  | 'forgot-sent'
  | 'welcome-back'
  | 'welcome-back-confirm'
  | 'passport-history'

interface AccountModalProps {
  // null = no guest logged in on this device (the common case -- accounts
  // are entirely optional, see CLAUDE.md/the Guest Accounts Phase 0 ticket).
  guest: Guest | null
  onAuthed: (guest: Guest, token: string) => void
  onLoggedOut: () => void
  onClose: () => void
  // Guest Accounts Phase 3 -- called once Start Fresh actually clears the
  // guest's Bingo/Map progress server-side, so App.tsx can reload the Bingo
  // card and Map nodes to reflect the now-blank state.
  onBingoMapStartFresh: () => void
  // Guest Accounts Phase 5 follow-up -- the device-already-linked rejection's
  // shortcut button. Closes this modal and opens ResetSessionModal instead of
  // making the guest go find Reset Session in the nav menu themselves.
  onOpenResetSession: () => void
}

// Matches app/services/guest_accounts.py's ALREADY_LINKED_TO_ANOTHER_GUEST_ERROR.
// Detected by substring rather than an exact-string compare so trivial future
// wording tweaks on the backend don't silently break this -- signup's other
// 409 (duplicate email) never contains this phrase.
const DEVICE_LINK_CONFLICT_MARKER = 'already signed in to a different account'

function isDeviceLinkConflict(err: unknown): boolean {
  return String(err).includes(DEVICE_LINK_CONFLICT_MARKER)
}

// Backend error bodies are FastAPI's standard {"detail": "..."} shape, and
// api.ts's request() throws `Error(\`${method} ${path} -> ${status}: ${body}\`)`
// -- pull the human-readable detail back out rather than showing that raw
// string to a guest.
function friendlyError(err: unknown): string {
  const raw = String(err)
  const match = raw.match(/-> \d+: (.*)$/s)
  if (match) {
    try {
      const parsed = JSON.parse(match[1])
      if (typeof parsed.detail === 'string') return parsed.detail
    } catch {
      // Not JSON -- fall through to the raw message below.
    }
  }
  return raw
}

// Guest Accounts Phase 0 -- signup / login / forgot-password, plus the
// logged-in account summary. Deliberately optional and discoverable (a
// NavMenu entry), never a gate in front of anything that works today for an
// anonymous device session.
export function AccountModal({
  guest,
  onAuthed,
  onLoggedOut,
  onClose,
  onBingoMapStartFresh,
  onOpenResetSession,
}: AccountModalProps) {
  const [step, setStep] = useState<Step>('menu')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set instead of `error` specifically when signup/login is rejected because
  // this device is already linked to a different guest -- rendered as its own
  // explanatory block (with a Reset Session shortcut) rather than a plain
  // one-line error, since the fix here is genuinely non-obvious (Log Out
  // looks like it should work and doesn't -- see guest_accounts.py).
  const [deviceLinkConflict, setDeviceLinkConflict] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  // Guest Accounts Phase 3 -- populated by submitLogin's status check below,
  // read by the 'welcome-back'/'welcome-back-confirm' screens.
  const [bingoMapStatus, setBingoMapStatus] = useState<GuestBingoMapStatus | null>(null)
  // Guest Accounts Phase 4 -- populated when 'passport-history' is opened;
  // null distinguishes "still loading" from "loaded, zero passports" (an
  // empty array). selectedPassport drives the list-vs-detail sub-view within
  // that same step, so Back from a detail returns to the list without a
  // refetch.
  const [passports, setPassports] = useState<PassportSession[] | null>(null)
  const [passportsError, setPassportsError] = useState<string | null>(null)
  const [selectedPassport, setSelectedPassport] = useState<PassportSession | null>(null)

  const goTo = (next: Step) => {
    setEmail('')
    setPassword('')
    setError(null)
    setDeviceLinkConflict(false)
    setStep(next)
  }

  const submitLogin = () => {
    setSubmitting(true)
    setError(null)
    setDeviceLinkConflict(false)
    api
      .guestLogin(email.trim(), password)
      .then((result) => {
        onAuthed(result.guest, result.token)
        // Guest Accounts Phase 3 -- only a login (never a signup, which
        // can't have prior progress) can have a return visit's Bingo/Map
        // progress to choose between. Only prompt when there's actually
        // something to continue -- has_progress false skips straight to
        // closing, same as before this phase existed.
        return api.getBingoMapStatus().then((status) => {
          if (status.has_progress) {
            setBingoMapStatus(status)
            setStep('welcome-back')
          } else {
            onClose()
          }
        })
      })
      .catch((err) => {
        if (isDeviceLinkConflict(err)) {
          setDeviceLinkConflict(true)
        } else {
          setError(friendlyError(err))
        }
      })
      .finally(() => setSubmitting(false))
  }

  const confirmStartFresh = () => {
    setSubmitting(true)
    setError(null)
    api
      .startFreshBingoMap()
      .then(() => {
        onBingoMapStartFresh()
        onClose()
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setSubmitting(false))
  }

  const submitSignup = () => {
    setSubmitting(true)
    setError(null)
    setDeviceLinkConflict(false)
    api
      .guestSignup(email.trim(), password)
      .then((result) => {
        onAuthed(result.guest, result.token)
        onClose()
      })
      .catch((err) => {
        if (isDeviceLinkConflict(err)) {
          setDeviceLinkConflict(true)
        } else {
          setError(friendlyError(err))
        }
      })
      .finally(() => setSubmitting(false))
  }

  const submitForgot = () => {
    setSubmitting(true)
    setError(null)
    api
      .requestPasswordReset(email.trim())
      .then(() => setStep('forgot-sent'))
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setSubmitting(false))
  }

  const openPassportHistory = () => {
    setSelectedPassport(null)
    setPassports(null)
    setPassportsError(null)
    setStep('passport-history')
    api
      .getGuestPassports()
      .then(setPassports)
      .catch((err) => setPassportsError(friendlyError(err)))
  }

  const doLogout = () => {
    setLoggingOut(true)
    api
      .guestLogout()
      .catch(() => {
        // Logging out is best-effort server-side (it just deletes the token
        // row) -- clear it locally regardless so the guest is never stuck
        // "logged in" on a network hiccup.
      })
      .finally(() => {
        setLoggingOut(false)
        onLoggedOut()
        onClose()
      })
  }

  const renderDeviceLinkConflict = () => (
    <div className="account-modal-device-link-conflict">
      <p className="screen-error">
        This device is currently signed in to a different account. To use a different account here, tap{' '}
        <strong>Reset Session</strong> first — your other account&rsquo;s saved progress will be completely safe.
      </p>
      <p className="account-modal-subtitle">
        Reset Session only clears this device&rsquo;s current, unsaved anonymous state and frees it up. It does{' '}
        <strong>not</strong> delete or affect the other account&rsquo;s saved data — their Cobb Coins, Collectible
        Cards, Bingo/Map progress, and Passports stay exactly as they are, safe until they log back in.
      </p>
      <button type="button" className="btn btn-primary" onClick={onOpenResetSession}>
        Reset Session
      </button>
    </div>
  )

  const renderTitle = (text: string) => (
    <h2 id="account-modal-title" className="account-modal-title">
      <span className="account-modal-icon-badge" aria-hidden="true">
        <UserIcon />
      </span>
      {text}
    </h2>
  )

  // Guest Accounts Phase 3: `guest` is already set by the time the
  // 'welcome-back'/'welcome-back-confirm' steps render (onAuthed runs before
  // the status check that leads to them -- see submitLogin above), so this
  // branch must not short-circuit past those two steps.
  if (guest && step !== 'welcome-back' && step !== 'welcome-back-confirm' && step !== 'passport-history') {
    return (
      <Modal onClose={onClose} labelledBy="account-modal-title" className="account-modal-frame">
        <div className="account-modal-inner">
          {renderTitle('Your Account')}
          <div className="account-modal-account-summary">
            <span className="account-modal-account-email">{guest.email}</span>
            <span>Your Cobb Coins and Collectible Cards are saved to this account.</span>
          </div>
          {error && <p className="screen-error">{error}</p>}
          <div className="account-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={openPassportHistory}>
              Passport History
            </button>
            <button type="button" className="btn btn-secondary" onClick={doLogout} disabled={loggingOut}>
              {loggingOut ? 'Logging out…' : 'Log Out'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  if (step === 'passport-history') {
    return (
      <Modal onClose={onClose} labelledBy="account-modal-title" className="account-modal-frame">
        <div className="account-modal-inner">
          {renderTitle(selectedPassport ? selectedPassport.family_label : 'Passport History')}
          {selectedPassport ? (
            <>
              <PassportCard session={selectedPassport} />
              <div className="account-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setSelectedPassport(null)}>
                  Back to List
                </button>
              </div>
            </>
          ) : (
            <>
              {passportsError && <p className="screen-error">{passportsError}</p>}
              {passports === null && !passportsError && (
                <p className="account-modal-subtitle">Loading your past passports…</p>
              )}
              {passports && passports.length === 0 && (
                <p className="account-modal-subtitle">No passports generated yet on this account.</p>
              )}
              {passports && passports.length > 0 && (
                <ul className="account-modal-passport-list">
                  {passports.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="account-modal-passport-item"
                        onClick={() => setSelectedPassport(p)}
                      >
                        <span className="account-modal-passport-item-date">
                          {new Date(p.generated_at).toLocaleDateString()}
                        </span>
                        <span className="account-modal-passport-item-label">
                          {p.family_label} &mdash; {p.stats.title}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="account-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => goTo('menu')}>
                  Back
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    )
  }

  if (step === 'menu') {
    return (
      <Modal onClose={onClose} labelledBy="account-modal-title" className="account-modal-frame">
        <div className="account-modal-inner">
          {renderTitle('Save Your Progress')}
          <p className="account-modal-subtitle">
            Create a free account to keep your Cobb Coins and Collectible Cards saved across visits — log back in next
            time and they&rsquo;ll be right where you left them. This is entirely optional — everything still works
            without one.
          </p>
          <div className="account-modal-menu">
            <button type="button" className="btn btn-primary" onClick={() => goTo('login')}>
              Log In
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => goTo('signup')}>
              Sign Up
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Not Now
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  if (step === 'login') {
    return (
      <Modal onClose={onClose} labelledBy="account-modal-title" className="account-modal-frame">
        <div className="account-modal-inner">
          {renderTitle('Log In')}
          {deviceLinkConflict ? renderDeviceLinkConflict() : error && <p className="screen-error">{error}</p>}
          <div className="account-modal-field">
            <input
              type="email"
              className="account-modal-input"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              autoComplete="email"
            />
            <input
              type="password"
              className="account-modal-input"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              autoComplete="current-password"
            />
          </div>
          <div className="account-modal-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={submitLogin}
              disabled={submitting || !email.trim() || !password}
            >
              {submitting ? 'Logging in…' : 'Log In'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => goTo('menu')} disabled={submitting}>
              Back
            </button>
          </div>
          <div className="account-modal-link-row">
            <button type="button" className="account-modal-link" onClick={() => goTo('forgot')}>
              Forgot password?
            </button>
            <button type="button" className="account-modal-link" onClick={() => goTo('signup')}>
              Need an account?
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  if (step === 'signup') {
    return (
      <Modal onClose={onClose} labelledBy="account-modal-title" className="account-modal-frame">
        <div className="account-modal-inner">
          {renderTitle('Sign Up')}
          {deviceLinkConflict ? renderDeviceLinkConflict() : error && <p className="screen-error">{error}</p>}
          <div className="account-modal-field">
            <input
              type="email"
              className="account-modal-input"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              autoComplete="email"
            />
            <input
              type="password"
              className="account-modal-input"
              placeholder="Password (8+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              autoComplete="new-password"
            />
          </div>
          <div className="account-modal-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={submitSignup}
              disabled={submitting || !email.trim() || password.length < 8}
            >
              {submitting ? 'Creating account…' : 'Sign Up'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => goTo('menu')} disabled={submitting}>
              Back
            </button>
          </div>
          <div className="account-modal-link-row">
            <button type="button" className="account-modal-link" onClick={() => goTo('login')}>
              Already have an account?
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  if (step === 'forgot') {
    return (
      <Modal onClose={onClose} labelledBy="account-modal-title" className="account-modal-frame">
        <div className="account-modal-inner">
          {renderTitle('Reset Password')}
          <p className="account-modal-subtitle">Enter your email and we'll send you a link to reset your password.</p>
          {error && <p className="screen-error">{error}</p>}
          <div className="account-modal-field">
            <input
              type="email"
              className="account-modal-input"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              autoComplete="email"
            />
          </div>
          <div className="account-modal-actions">
            <button type="button" className="btn btn-primary" onClick={submitForgot} disabled={submitting || !email.trim()}>
              {submitting ? 'Sending…' : 'Send Reset Link'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => goTo('login')} disabled={submitting}>
              Back
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  if (step === 'forgot-sent') {
    return (
      <Modal onClose={onClose} labelledBy="account-modal-title" className="account-modal-frame">
        <div className="account-modal-inner">
          {renderTitle('Check Your Email')}
          <p className="account-modal-subtitle">
            If an account exists for that email, a password reset link has been sent. It expires in 1 hour.
          </p>
          <div className="account-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  if (step === 'welcome-back') {
    // Guest Accounts Phase 3 -- shown only once, right after a login that
    // found prior Bingo/Map progress (see submitLogin above). Continue needs
    // no action of its own beyond closing -- the guest-aware backend reads
    // (app/services/map_bingo.py's list_map_nodes/get_bingo_card) already
    // show the carried-forward state on their own once this closes.
    return (
      <Modal onClose={onClose} labelledBy="account-modal-title" className="account-modal-frame">
        <div className="account-modal-inner">
          {renderTitle('Welcome Back')}
          <p className="account-modal-subtitle">
            Your Cobb Coins, Collectible Cards, Passports, and other progress carry over on this account every time
            you log in — and we found saved Bingo and Map progress here too. Continuing makes it easier to reach 100%
            on your existing Bingo card and map exploration. Starting fresh clears that Bingo/Map progress and gives
            you a new chance to earn Cobb Coins from scratch — either way, your Coins, Collectibles, and Passports
            are safe. One thing carryover never covers: the Scavenger Hunt always resets every visit, no matter which
            you choose.
          </p>
          {bingoMapStatus && (
            <p className="account-modal-progress-summary">
              {bingoMapStatus.tiles_completed}/{bingoMapStatus.tiles_total} Bingo tiles &middot;{' '}
              {bingoMapStatus.nodes_visited} map node{bingoMapStatus.nodes_visited === 1 ? '' : 's'} visited
            </p>
          )}
          <div className="account-modal-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Continue
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep('welcome-back-confirm')}>
              Start Fresh
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  // step === 'welcome-back-confirm'
  return (
    <Modal onClose={onClose} labelledBy="account-modal-title" className="account-modal-frame">
      <div className="account-modal-inner">
        {renderTitle('Start Fresh?')}
        <p className="account-modal-subtitle">
          This clears your saved Bingo tile progress and Map visits on this account, across every device you&rsquo;ve
          logged in on. Your Cobb Coins and Collectible Cards are not affected.
        </p>
        <p className="account-modal-warning">Are you sure? This can&rsquo;t be undone.</p>
        {error && <p className="screen-error">{error}</p>}
        <div className="account-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setStep('welcome-back')} disabled={submitting}>
            Back
          </button>
          <button type="button" className="btn btn-danger" onClick={confirmStartFresh} disabled={submitting}>
            {submitting ? 'Starting Fresh…' : 'Start Fresh'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
