import { useEffect, useRef, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, type AnimalPhoto, type Announcement, type BingoCard, type CoinsSummary, type CollectibleCard, type CollectibleCatalogEntry, type Guest, type HuntCharacter, type MapNode, type Minigame, type MilestoneEvent, type PhotoSubmission, type Puzzle, type ResetSessionResult, type ScoringGame, type StaffRequest, type TileCompletionResult, type VisitNodeResponse } from './api'
import { AccountModal } from './components/AccountModal'
import { AnimalsScreen } from './components/AnimalsScreen'
import { AnnouncementPopup } from './components/AnnouncementPopup'
import { BingoScreen } from './components/BingoScreen'
import { BrandLogo } from './components/BrandLogo'
import { CollectiblesScreen } from './components/CollectiblesScreen'
import { ContactStaffModal } from './components/ContactStaffModal'
import { FaqScreen } from './components/FaqScreen'
import { FoodTruckScreen } from './components/FoodTruckScreen'
import { HomePage } from './components/HomePage'
import { HuntScreen } from './components/HuntScreen'
import { MapScreen } from './components/MapScreen'
import { MinigameOverlay, getMinigameSlug } from './components/MinigameOverlay'
import { NavMenu } from './components/NavMenu'
import { BinocularsIcon, CameraIcon, ClipboardIcon, GridIcon, MapPinIcon, PawIcon, PuzzlePieceIcon, QuestionMarkIcon, SearchIcon, ShieldIcon, TruckIcon } from './components/NavIcons'
import { PassportModal } from './components/PassportModal'
import { PhotoScreen } from './components/PhotoScreen'
import { PrivacyScreen } from './components/PrivacyScreen'
import { PuzzleScreen } from './components/PuzzleScreen'
import { ResetPasswordScreen } from './components/ResetPasswordScreen'
import { ResetSessionModal } from './components/ResetSessionModal'
import { ScanEntryModal } from './components/ScanEntryModal'
import { ScanScreen } from './components/ScanScreen'
import { ScoringScreen } from './components/ScoringScreen'
import { StaffPage } from './components/StaffPage'
import { ToastStack, type ToastItem } from './components/ToastStack'
import { rotateDeviceSessionId } from './deviceSession'
import { clearDismissedAnnouncements } from './dismissedAnnouncements'
import { clearGuestAuthToken, getGuestAuthToken, setGuestAuthToken } from './guestAuth'
import './components/shared.css'
import './App.css'

// Every guest-facing screen (Home included) is a real router-driven route --
// see GuestShell below, ScanRoute for /scan/:code, and AnimalsScreen.tsx for
// the nested /animals routing. `key` doubles as the route path (relative to
// GuestShell's mount point) and the value NavMenu compares against the
// current location to highlight the active tab.
// Test-only hook (same spirit as main.tsx's window.__capWhoami) so e2e can
// force an immediate Contact Staff status poll tick instead of sleeping past
// the real 12s interval.
declare global {
  interface Window {
    __capReloadContactStatus?: () => void
  }
}

const TABS: { key: string; label: string; icon: ReactNode }[] = [
  { key: '/map', label: 'Map', icon: <MapPinIcon /> },
  { key: '/bingo', label: 'Bingo Card', icon: <GridIcon /> },
  { key: '/puzzles', label: 'Puzzles', icon: <PuzzlePieceIcon /> },
  { key: '/scoring', label: 'Scoring Sheet', icon: <ClipboardIcon /> },
  { key: '/hunt', label: 'Scavenger Hunt', icon: <SearchIcon /> },
  { key: '/animals', label: 'Our Animals', icon: <BinocularsIcon /> },
  { key: '/collectibles', label: 'Collectibles', icon: <PawIcon /> },
  { key: '/photos', label: 'Favorite Photo', icon: <CameraIcon /> },
  { key: '/food-trucks', label: 'Food Truck Menus', icon: <TruckIcon /> },
  { key: '/faq', label: 'FAQ', icon: <QuestionMarkIcon /> },
  // PIPA "Openness" -- the Privacy Policy must be genuinely, easily
  // discoverable to any guest, not just one who happens into the account
  // flow -- so it gets the same primary-tab tier as FAQ, not the low-emphasis
  // footer treatment (see NavMenu.css's nav-menu-footer comment).
  { key: '/privacy', label: 'Privacy Policy', icon: <ShieldIcon /> },
]

function App() {
  // App itself renders inside main.tsx's <BrowserRouter>, so it can call
  // useNavigate() directly -- used below by applyBaseFollowup to jump to
  // /bingo for a milestone banner regardless of which route triggered it.
  const navigate = useNavigate()

  const [showScanEntry, setShowScanEntry] = useState(false)
  const [showContactStaff, setShowContactStaff] = useState(false)
  const [showPassport, setShowPassport] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showAccount, setShowAccount] = useState(false)

  // Guest Accounts Phase 0 -- null whenever no guest is logged in on this
  // device (the common case; accounts are entirely optional and don't gate
  // anything else in the app). Hydrated from a stored token on mount below.
  const [guest, setGuest] = useState<Guest | null>(null)

  const [nodes, setNodes] = useState<MapNode[] | null>(null)
  const [nodesError, setNodesError] = useState<string | null>(null)

  const [cardId, setCardId] = useState<string | null>(null)
  const [card, setCard] = useState<BingoCard | null>(null)
  const [cardError, setCardError] = useState<string | null>(null)

  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null)
  const [puzzlesError, setPuzzlesError] = useState<string | null>(null)

  const [scoringGames, setScoringGames] = useState<ScoringGame[] | null>(null)
  const [scoringGamesError, setScoringGamesError] = useState<string | null>(null)

  const [huntCharacters, setHuntCharacters] = useState<HuntCharacter[] | null>(null)
  const [huntError, setHuntError] = useState<string | null>(null)

  const [minigames, setMinigames] = useState<Minigame[] | null>(null)

  const [coinsSummary, setCoinsSummary] = useState<CoinsSummary | null>(null)

  // undefined = not yet loaded once (mirrors nodes === null elsewhere);
  // null = loaded, no active request; otherwise the session's own active
  // (open/acknowledged) Contact Staff request. myRequestStatusRef mirrors
  // the state so the poll's setInterval closure can compare against the
  // PREVIOUS value without depending on stale state from when the interval
  // was created.
  const [myRequestStatus, setMyRequestStatus] = useState<StaffRequest | null | undefined>(undefined)
  const myRequestStatusRef = useRef<StaffRequest | null | undefined>(undefined)

  const [collectibleCatalog, setCollectibleCatalog] = useState<CollectibleCatalogEntry[] | null>(null)
  const [collectibleCatalogError, setCollectibleCatalogError] = useState<string | null>(null)

  const [collectibleCards, setCollectibleCards] = useState<CollectibleCard[] | null>(null)
  const [collectibleCardsError, setCollectibleCardsError] = useState<string | null>(null)

  const [photoGallery, setPhotoGallery] = useState<PhotoSubmission[] | null>(null)
  const [photoGalleryError, setPhotoGalleryError] = useState<string | null>(null)

  const [animalPhotos, setAnimalPhotos] = useState<AnimalPhoto[] | null>(null)
  const [animalPhotosError, setAnimalPhotosError] = useState<string | null>(null)

  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null)
  // Bumped on Reset Session so the mounted AnnouncementPopup re-reads its
  // dismissed-ids localStorage entry (see dismissedAnnouncements.ts) without
  // needing a full page reload.
  const [announcementResetSignal, setAnnouncementResetSignal] = useState(0)

  const [milestoneQueue, setMilestoneQueue] = useState<MilestoneEvent[]>([])
  // 'base' = the minigame a tile completion always draws; 'milestone' = the
  // one extra celebration minigame a milestone-triggering completion draws
  // (played only once the guest opts in via BingoScreen's prompt, never
  // auto-queued); 'hunt' = a Scavenger Hunt Challenge 3 minigame. Tagged so
  // handleMinigameOverlayClose knows what (if anything) to do once the
  // overlay for it closes.
  const [minigameQueue, setMinigameQueue] = useState<{ game: Minigame; kind: 'base' | 'milestone' | 'hunt' }[]>([])
  // The milestones + optional celebration minigame a still-playing 'base'
  // minigame will unlock once its overlay closes -- one entry per queued
  // 'base' minigame, in the same order. Kept separate from minigameQueue so
  // a milestone banner never shows concurrently with its own base minigame.
  const [baseFollowupQueue, setBaseFollowupQueue] = useState<
    { milestones: MilestoneEvent[]; extraMinigame: Minigame | null }[]
  >([])
  // Celebration minigames unlocked by a milestone, waiting on the guest to
  // tap BingoScreen's "play it" prompt (shown once milestoneQueue drains).
  const [pendingMilestoneMinigames, setPendingMilestoneMinigames] = useState<Minigame[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const activeMinigame = minigameQueue[0]?.game ?? null
  // Set while a Scavenger Hunt Challenge 3 minigame is in the queue, so the
  // overlay's onClose knows to also mark that hunt challenge complete --
  // the overlay itself stays generic/unaware of Hunt.
  const [huntPendingChallengeId, setHuntPendingChallengeId] = useState<string | null>(null)

  const reloadNodes = () => {
    setNodesError(null)
    api.listMapNodes().then(setNodes).catch((err) => setNodesError(String(err)))
  }

  const reloadCard = (id: string) => {
    setCardError(null)
    api.getBingoCard(id).then(setCard).catch((err) => setCardError(String(err)))
  }

  // Guest Accounts Phase 1: unlike reloadCard, doesn't assume cardId is
  // already populated -- on a freshly loaded page, a fast login/logout can
  // easily complete before the mount effect's own listBingoCards() call
  // below has resolved, which would make a plain `if (cardId) reloadCard(...)`
  // silently skip the reload entirely (this is exactly what previously left
  // the Bingo card showing stale, pre-login state until a manual page
  // reload). Re-fetching the card list here instead of relying on `cardId`
  // state makes the reload correct regardless of that race.
  const reloadBingoCard = () => {
    api
      .listBingoCards()
      .then((summaries) => {
        if (summaries.length === 0) return
        setCardId(summaries[0].id)
        reloadCard(summaries[0].id)
      })
      .catch((err) => setCardError(String(err)))
  }

  const reloadPuzzles = () => {
    setPuzzlesError(null)
    api.listPuzzles().then(setPuzzles).catch((err) => setPuzzlesError(String(err)))
  }

  const reloadScoringGames = () => {
    setScoringGamesError(null)
    api.listScoringGames().then(setScoringGames).catch((err) => setScoringGamesError(String(err)))
  }

  const reloadHuntCharacters = () => {
    setHuntError(null)
    api.listHuntCharacters().then(setHuntCharacters).catch((err) => setHuntError(String(err)))
  }

  const reloadMinigames = () => {
    api
      .listMinigames()
      .then(setMinigames)
      .catch((err) => setToasts((prev) => [...prev, { id: crypto.randomUUID(), text: `Couldn't load minigames: ${err}` }]))
  }

  const reloadCoins = () => {
    api
      .getCoinsSummary()
      .then(setCoinsSummary)
      .catch((err) => setToasts((prev) => [...prev, { id: crypto.randomUUID(), text: `Couldn't load Cobb Coins: ${err}` }]))
  }

  // Proactive-notification poll (Contact Staff): the only guest-facing
  // status change worth interrupting the guest for is open -> acknowledged
  // ("a staff member has seen this and is on the way") -- resolved/cancelled
  // just clear the indicator silently, same as the guest closing the modal
  // themselves. Compares against myRequestStatusRef (not React state) since
  // this also runs from a setInterval callback created once on mount, which
  // would otherwise only ever see the myRequestStatus value from that first
  // render.
  const reloadMyRequestStatus = () => {
    api
      .getMyStaffRequest()
      .then((next) => {
        const prev = myRequestStatusRef.current
        if (prev?.status === 'open' && next?.status === 'acknowledged') {
          setToasts((t) => [...t, { id: crypto.randomUUID(), text: '\u{1F44B} Staff has seen your request and is on the way!' }])
        }
        myRequestStatusRef.current = next
        setMyRequestStatus(next)
      })
      // A background poll failing once isn't worth a toast -- it'll just
      // retry on the next tick.
      .catch(() => {})
  }

  const reloadCollectibleCatalog = () => {
    setCollectibleCatalogError(null)
    api.listCollectibleCatalog().then(setCollectibleCatalog).catch((err) => setCollectibleCatalogError(String(err)))
  }

  const reloadCollectibleCards = () => {
    setCollectibleCardsError(null)
    api.listCollectibles().then(setCollectibleCards).catch((err) => setCollectibleCardsError(String(err)))
  }

  const purchaseCollectible = (animalSlug: string, guestName: string): Promise<CollectibleCard> =>
    api.purchaseCollectible(animalSlug, guestName).then((card) => {
      setCollectibleCards((prev) => (prev ? [card, ...prev] : [card]))
      reloadCoins()
      return card
    })

  const reloadPhotoGallery = () => {
    setPhotoGalleryError(null)
    api
      .listPhotoGallery()
      .then(setPhotoGallery)
      .catch((err) => setPhotoGalleryError(String(err)))
  }

  const reloadAnnouncements = () => {
    api
      .listAnnouncements()
      .then(setAnnouncements)
      .catch((err) => setToasts((prev) => [...prev, { id: crypto.randomUUID(), text: `Couldn't load announcements: ${err}` }]))
  }

  const reloadAnimalPhotos = () => {
    setAnimalPhotosError(null)
    api.listAnimalPhotos().then(setAnimalPhotos).catch((err) => setAnimalPhotosError(String(err)))
  }

  // Guest Accounts Phase 0 -- if this device has a stored guest auth token
  // (from a previous signup/login), confirm it's still valid via
  // GET /account/whoami and populate `guest`; a stale/expired token is
  // cleared rather than left around to keep failing silently on every load.
  useEffect(() => {
    if (!getGuestAuthToken()) return
    api.guestWhoami().then(setGuest).catch(() => clearGuestAuthToken())
  }, [])

  // Guest Accounts Phase 1: signing up/logging in (or logging out) changes
  // which guest-scoped state this device sees -- current-session-only vs.
  // this guest's lifetime total, for every one of Coins/Collectibles/Bingo/
  // Map (all read via the same "sessions currently linked to me" join, see
  // app/services/coins.py's get_total) -- so all four need reloading here,
  // or they'd keep showing whatever was fetched under the *previous* auth
  // state until some unrelated action happened to trigger a reload. Hunt is
  // deliberately excluded -- it resets every visit regardless of login, so
  // it has nothing guest-scoped to reload. Passport history is fetched
  // on-demand when AccountModal opens it, not held in App.tsx state, so it
  // has nothing to reload here either.
  const handleGuestAuthed = (nextGuest: Guest, token: string) => {
    setGuestAuthToken(token)
    setGuest(nextGuest)
    reloadCoins()
    reloadCollectibleCards()
    reloadNodes()
    reloadBingoCard()
  }

  const handleGuestLoggedOut = () => {
    clearGuestAuthToken()
    setGuest(null)
    reloadCoins()
    reloadCollectibleCards()
    reloadNodes()
    reloadBingoCard()
  }

  useEffect(() => {
    reloadNodes()
    reloadPuzzles()
    reloadScoringGames()
    reloadHuntCharacters()
    reloadMinigames()
    reloadCoins()
    reloadCollectibleCatalog()
    reloadCollectibleCards()
    reloadPhotoGallery()
    reloadAnnouncements()
    reloadAnimalPhotos()
    api
      .listBingoCards()
      .then((summaries) => {
        if (summaries.length === 0) {
          setCardError('No Bingo cards found — has the database been seeded?')
          return
        }
        setCardId(summaries[0].id)
        reloadCard(summaries[0].id)
      })
      .catch((err) => setCardError(String(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Contact Staff proactive-notification poll -- mirrors StaffPage.tsx's own
  // POLL_INTERVAL_MS (12s) simple-polling approach (no websockets in this
  // app). window.__capReloadContactStatus is a test-only hook (same spirit
  // as main.tsx's window.__capWhoami) so e2e can force an immediate poll
  // tick instead of sleeping past the real interval.
  useEffect(() => {
    reloadMyRequestStatus()
    const timer = window.setInterval(reloadMyRequestStatus, 12_000)
    window.__capReloadContactStatus = reloadMyRequestStatus
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Bingo's coin amount rides along with its MilestoneBanner (see
  // MilestoneEvent.coins_awarded) instead of a toast, since a bingo tile
  // completion only ever earns coins when it also hits a milestone -- a
  // separate toast here would be redundant with the banner. Hunt and Map
  // Exploration have no competing banner, so they get a toast of their own.
  const toastCoinsEarned = (amount: number) => {
    if (amount <= 0) return
    setToasts((prev) => [...prev, { id: crypto.randomUUID(), text: `\u{1FA99} +${amount} Cobb Coins!` }])
  }

  const toastUnbuiltMinigame = (game: Minigame) => {
    setToasts((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text: `\u{1F3AE} ${game.name} minigame queued (not built yet — Phase ${game.phase})` },
    ])
  }

  // What a tile completion's base minigame unlocks once its overlay closes:
  // any milestone banners it triggered, and (if a milestone was hit) the
  // celebration minigame those banners lead into. Also the landing spot for
  // completions whose base minigame never got queued at all (unbuilt).
  const applyBaseFollowup = (followup: { milestones: MilestoneEvent[]; extraMinigame: Minigame | null }) => {
    if (followup.milestones.length === 0) return
    setMilestoneQueue((prev) => [...prev, ...followup.milestones])
    navigate('/bingo')
    if (followup.extraMinigame) {
      setPendingMilestoneMinigames((prev) => [...prev, followup.extraMinigame as Minigame])
    }
  }

  // Tech spec 4.1/4.2 redesign: a tile completion's base minigame (drawn[0])
  // plays immediately; the milestone celebration minigame (drawn[1], only
  // present when this completion hit a milestone) is deliberately NOT
  // auto-queued here -- it's stashed in pendingMilestoneMinigames and only
  // enters minigameQueue once the guest taps BingoScreen's prompt, which
  // itself only appears after the milestone banner(s) have shown.
  const processTileCompletion = (result: TileCompletionResult) => {
    const [base, extra] = result.minigames_drawn
    const followup = { milestones: result.milestones, extraMinigame: extra ?? null }
    if (!base) {
      applyBaseFollowup(followup)
      return
    }
    if (getMinigameSlug(base)) {
      setMinigameQueue((prev) => [...prev, { game: base, kind: 'base' as const }])
      setBaseFollowupQueue((prev) => [...prev, followup])
    } else {
      toastUnbuiltMinigame(base)
      applyBaseFollowup(followup)
    }
  }

  const handlePlayMilestoneMinigame = () => {
    const [game, ...rest] = pendingMilestoneMinigames
    if (!game) return
    setPendingMilestoneMinigames(rest)
    if (getMinigameSlug(game)) {
      setMinigameQueue((prev) => [...prev, { game, kind: 'milestone' as const }])
    } else {
      toastUnbuiltMinigame(game)
    }
  }

  const handleResetSession = (result: ResetSessionResult) => {
    // Guest Accounts Phase 1: the backend already logged the guest out on
    // this device (see backend/app/services/session_reset.py) -- rotate to
    // a fresh, unlinked device session BEFORE the reloads below so they
    // fetch this device's genuinely-fresh anonymous state, not a stale view
    // through the now-retired (but still guest-linked, lifetime-totals-
    // preserving) old session id.
    if (result.guest_logged_out) {
      rotateDeviceSessionId()
      handleGuestLoggedOut()
    }
    if (cardId) reloadCard(cardId)
    reloadNodes()
    reloadHuntCharacters()
    reloadCoins()
    reloadCollectibleCards()
    // Defensive: any minigame/milestone state left over from before the
    // reset refers to tiles/nodes that no longer exist in their prior form.
    setMilestoneQueue([])
    setMinigameQueue([])
    setPendingMilestoneMinigames([])
    setBaseFollowupQueue([])
    // Reset Session is the shared kiosk's "next guest" boundary -- dismissed
    // announcement ids are per-kiosk-session state, same spirit as the DB
    // rows reset above, just stored client-side (dismissedAnnouncements.ts).
    clearDismissedAnnouncements()
    setAnnouncementResetSignal((n) => n + 1)
    // Favorite Photo's own vote (Per-Device Sessions Phase 5) is now
    // cleared server-side by POST /session/reset itself, scoped to this
    // session_id -- reload the gallery so voted_by_me flips back to false
    // for this session instead of staying stuck true until the next
    // unrelated reload.
    reloadPhotoGallery()
  }

  const handleTileResult = (result: TileCompletionResult) => {
    if (cardId) reloadCard(cardId)
    reloadNodes()
    reloadCoins()
    processTileCompletion(result)
  }

  const handleVisitResult = (result: VisitNodeResponse) => {
    if (cardId) reloadCard(cardId)
    reloadNodes()
    if (result.tile_completions.length > 0 || result.coins_awarded > 0) reloadCoins()
    toastCoinsEarned(result.coins_awarded)
    for (const tc of result.tile_completions) {
      processTileCompletion(tc)
    }
  }

  const completeHuntChallenge = (challengeId: string): Promise<HuntCharacter> =>
    api.completeHuntChallenge(challengeId).then((updated) => {
      setHuntCharacters((prev) => (prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev))
      reloadCoins()
      toastCoinsEarned(updated.coins_awarded)
      return updated
    })

  const unlockHuntCharacter = (characterId: string): Promise<HuntCharacter> =>
    api.unlockHuntCharacter(characterId).then((updated) => {
      setHuntCharacters((prev) => (prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev))
      return updated
    })

  const handlePlayHuntMinigame = (challengeId: string, minigameSlug: string) => {
    const game = minigames?.find((m) => getMinigameSlug(m) === minigameSlug)
    if (!game) {
      setToasts((prev) => [...prev, { id: crypto.randomUUID(), text: `\u{1F3AE} That minigame isn't available yet.` }])
      return
    }
    setMinigameQueue((prev) => [...prev, { game, kind: 'hunt' as const }])
    setHuntPendingChallengeId(challengeId)
  }

  const handleMinigameOverlayClose = () => {
    const closed = minigameQueue[0]
    setMinigameQueue((q) => q.slice(1))
    if (closed?.kind === 'base') {
      // Plain statements, not a setBaseFollowupQueue functional-updater with
      // applyBaseFollowup nested inside it -- React (StrictMode) invokes
      // updater functions twice in dev to catch impure ones, and doing the
      // state-setting side effects (setMilestoneQueue et al, inside
      // applyBaseFollowup) from within another setState's updater meant they
      // fired twice per close, double-queuing the milestone banner and the
      // "Play Bonus Minigame" prompt so it looked stuck after being played once.
      const [next, ...rest] = baseFollowupQueue
      setBaseFollowupQueue(rest)
      if (next) applyBaseFollowup(next)
    }
    if (closed?.kind === 'hunt' && huntPendingChallengeId) {
      const challengeId = huntPendingChallengeId
      setHuntPendingChallengeId(null)
      completeHuntChallenge(challengeId).catch((err) =>
        setToasts((prev) => [...prev, { id: crypto.randomUUID(), text: `Couldn't save hunt progress: ${err}` }]),
      )
    }
  }

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id))

  return (
    <Routes>
      {/* Lightweight, separate view (Plan.md 2.10) -- no shared header/nav
          with the guest-facing app. Gated behind a shared staff password
          (app/staff_auth.py) -- StaffPage itself handles the login screen. */}
      <Route path="/staff" element={<StaffPage />} />
      <Route path="/reset-password" element={<ResetPasswordRoute />} />
      <Route
        path="/scan/:code"
        element={
          <ScanRoute
            huntCharacters={huntCharacters}
            onCompleteChallenge={completeHuntChallenge}
            onUnlockCharacter={unlockHuntCharacter}
            onPlayHuntMinigame={handlePlayHuntMinigame}
            toasts={toasts}
            onDismissToast={dismissToast}
            activeMinigame={activeMinigame}
            onMinigameOverlayClose={handleMinigameOverlayClose}
            announcements={announcements}
            announcementResetSignal={announcementResetSignal}
          />
        }
      />
      <Route
        path="/*"
        element={
          <GuestShell
            showScanEntry={showScanEntry}
            setShowScanEntry={setShowScanEntry}
            showContactStaff={showContactStaff}
            setShowContactStaff={setShowContactStaff}
            showPassport={showPassport}
            setShowPassport={setShowPassport}
            showResetConfirm={showResetConfirm}
            setShowResetConfirm={setShowResetConfirm}
            showAccount={showAccount}
            setShowAccount={setShowAccount}
            guest={guest}
            onGuestAuthed={handleGuestAuthed}
            onGuestLoggedOut={handleGuestLoggedOut}
            nodes={nodes}
            nodesError={nodesError}
            reloadNodes={reloadNodes}
            handleVisitResult={handleVisitResult}
            card={card}
            cardError={cardError}
            cardId={cardId}
            reloadCard={reloadCard}
            handleTileResult={handleTileResult}
            milestoneQueue={milestoneQueue}
            setMilestoneQueue={setMilestoneQueue}
            pendingMilestoneMinigames={pendingMilestoneMinigames}
            handlePlayMilestoneMinigame={handlePlayMilestoneMinigame}
            puzzles={puzzles}
            puzzlesError={puzzlesError}
            reloadPuzzles={reloadPuzzles}
            reloadCoins={reloadCoins}
            scoringGames={scoringGames}
            scoringGamesError={scoringGamesError}
            reloadScoringGames={reloadScoringGames}
            huntCharacters={huntCharacters}
            huntError={huntError}
            reloadHuntCharacters={reloadHuntCharacters}
            completeHuntChallenge={completeHuntChallenge}
            handlePlayHuntMinigame={handlePlayHuntMinigame}
            collectibleCatalog={collectibleCatalog}
            collectibleCatalogError={collectibleCatalogError}
            reloadCollectibleCatalog={reloadCollectibleCatalog}
            collectibleCards={collectibleCards}
            collectibleCardsError={collectibleCardsError}
            reloadCollectibleCards={reloadCollectibleCards}
            coinsSummary={coinsSummary}
            myRequestStatus={myRequestStatus}
            reloadMyRequestStatus={reloadMyRequestStatus}
            purchaseCollectible={purchaseCollectible}
            photoGallery={photoGallery}
            photoGalleryError={photoGalleryError}
            reloadPhotoGallery={reloadPhotoGallery}
            animalPhotos={animalPhotos}
            animalPhotosError={animalPhotosError}
            announcements={announcements}
            announcementResetSignal={announcementResetSignal}
            toasts={toasts}
            onDismissToast={dismissToast}
            activeMinigame={activeMinigame}
            onMinigameOverlayClose={handleMinigameOverlayClose}
            handleResetSession={handleResetSession}
          />
        }
      />
    </Routes>
  )
}

// The password reset email's link destination (/reset-password?token=...) --
// a real cold-load deep link, same spirit as ScanRoute. Missing/blank token
// (e.g. someone navigating here directly) just bounces home rather than
// showing a form that can never succeed.
function ResetPasswordRoute() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''

  useEffect(() => {
    if (!token) navigate('/', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (!token) return null

  return <ResetPasswordScreen token={token} onDone={() => navigate('/')} />
}

interface ScanRouteProps {
  huntCharacters: HuntCharacter[] | null
  onCompleteChallenge: (challengeId: string) => Promise<HuntCharacter>
  onUnlockCharacter: (characterId: string) => Promise<HuntCharacter>
  onPlayHuntMinigame: (challengeId: string, minigameSlug: string) => void
  toasts: ToastItem[]
  onDismissToast: (id: string) => void
  activeMinigame: Minigame | null
  onMinigameOverlayClose: () => void
  announcements: Announcement[] | null
  announcementResetSignal: number
}

// The Scavenger Hunt QR deep-link entry point -- must work as a hard deep
// link (someone else's camera app opening a printed sign's URL fresh) as
// well as via in-app navigation from ScanEntryModal. React Router decodes
// dynamic path segments itself, so `code` here is already URL-decoded.
function ScanRoute({
  huntCharacters,
  onCompleteChallenge,
  onUnlockCharacter,
  onPlayHuntMinigame,
  toasts,
  onDismissToast,
  activeMinigame,
  onMinigameOverlayClose,
  announcements,
  announcementResetSignal,
}: ScanRouteProps) {
  const { code = '' } = useParams<{ code: string }>()
  const navigate = useNavigate()

  return (
    <div id="app-root">
      <header className="app-header">
        <div className="app-header-top">
          <BrandLogo onClick={() => navigate('/')} />
        </div>
      </header>
      <main className="app-main">
        <ScanScreen
          code={code}
          characters={huntCharacters}
          onCompleteChallenge={onCompleteChallenge}
          onUnlockCharacter={onUnlockCharacter}
          onPlayMinigame={onPlayHuntMinigame}
          onClose={() => navigate('/')}
        />
      </main>
      <ToastStack toasts={toasts} onDismiss={onDismissToast} />
      {activeMinigame && <MinigameOverlay game={activeMinigame} onClose={onMinigameOverlayClose} />}
      <AnnouncementPopup announcements={announcements} resetSignal={announcementResetSignal} />
    </div>
  )
}

interface GuestShellProps {
  showScanEntry: boolean
  setShowScanEntry: (show: boolean) => void
  showContactStaff: boolean
  setShowContactStaff: (show: boolean) => void
  showPassport: boolean
  setShowPassport: (show: boolean) => void
  showResetConfirm: boolean
  setShowResetConfirm: (show: boolean) => void
  showAccount: boolean
  setShowAccount: (show: boolean) => void
  guest: Guest | null
  onGuestAuthed: (guest: Guest, token: string) => void
  onGuestLoggedOut: () => void
  nodes: MapNode[] | null
  nodesError: string | null
  reloadNodes: () => void
  handleVisitResult: (result: VisitNodeResponse) => void
  card: BingoCard | null
  cardError: string | null
  cardId: string | null
  reloadCard: (id: string) => void
  handleTileResult: (result: TileCompletionResult) => void
  milestoneQueue: MilestoneEvent[]
  setMilestoneQueue: Dispatch<SetStateAction<MilestoneEvent[]>>
  pendingMilestoneMinigames: Minigame[]
  handlePlayMilestoneMinigame: () => void
  puzzles: Puzzle[] | null
  puzzlesError: string | null
  reloadPuzzles: () => void
  reloadCoins: () => void
  scoringGames: ScoringGame[] | null
  scoringGamesError: string | null
  reloadScoringGames: () => void
  huntCharacters: HuntCharacter[] | null
  huntError: string | null
  reloadHuntCharacters: () => void
  completeHuntChallenge: (challengeId: string) => Promise<HuntCharacter>
  handlePlayHuntMinigame: (challengeId: string, minigameSlug: string) => void
  collectibleCatalog: CollectibleCatalogEntry[] | null
  collectibleCatalogError: string | null
  reloadCollectibleCatalog: () => void
  collectibleCards: CollectibleCard[] | null
  collectibleCardsError: string | null
  reloadCollectibleCards: () => void
  coinsSummary: CoinsSummary | null
  myRequestStatus: StaffRequest | null | undefined
  reloadMyRequestStatus: () => void
  purchaseCollectible: (animalSlug: string, guestName: string) => Promise<CollectibleCard>
  photoGallery: PhotoSubmission[] | null
  photoGalleryError: string | null
  reloadPhotoGallery: () => void
  animalPhotos: AnimalPhoto[] | null
  animalPhotosError: string | null
  announcements: Announcement[] | null
  announcementResetSignal: number
  toasts: ToastItem[]
  onDismissToast: (id: string) => void
  activeMinigame: Minigame | null
  onMinigameOverlayClose: () => void
  handleResetSession: (result: ResetSessionResult) => void
}

// Guest-facing shell: shared header/nav/toasts/modals, wrapping every
// guest-facing screen -- each a real route mounted below, including (via its
// own nested <Routes>) the Our Animals feature. Mounted at the top-level
// "/*" route, so it also acts as the fallback for any path that isn't
// /staff or /scan/:code.
function GuestShell(props: GuestShellProps) {
  const navigate = useNavigate()
  const location = useLocation()

  const navActiveTab =
    TABS.find((t) =>
      t.key === '/animals' ? location.pathname.startsWith('/animals') : location.pathname === t.key,
    )?.key ?? null

  const selectTab = (path: string) => navigate(path)

  return (
    <div id="app-root">
      <header className="app-header">
        <div className="app-header-top">
          <BrandLogo onClick={() => navigate('/')} />
          <NavMenu
            tabs={TABS}
            activeTab={navActiveTab}
            onSelectTab={selectTab}
            coinTotal={props.coinsSummary?.total ?? 0}
            contactRequestStatus={props.myRequestStatus?.status ?? null}
            accountLabel={props.guest ? props.guest.email : 'Save Your Progress'}
            onScanQr={() => props.setShowScanEntry(true)}
            onGeneratePassport={() => props.setShowPassport(true)}
            onContactStaff={() => props.setShowContactStaff(true)}
            onResetSession={() => props.setShowResetConfirm(true)}
            onStaffNav={() => navigate('/staff')}
            onAccount={() => props.setShowAccount(true)}
          />
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route index element={<HomePage announcements={props.announcements} onScanQr={() => props.setShowScanEntry(true)} />} />
          <Route
            path="map"
            element={
              <MapRoute
                nodes={props.nodes}
                error={props.nodesError}
                onReload={props.reloadNodes}
                onVisitResult={props.handleVisitResult}
              />
            }
          />
          <Route
            path="bingo"
            element={
              <BingoScreen
                card={props.card}
                error={props.cardError}
                onReload={() => props.cardId && props.reloadCard(props.cardId)}
                onTileResult={props.handleTileResult}
                milestoneQueue={props.milestoneQueue}
                onMilestoneShown={() => props.setMilestoneQueue((q) => q.slice(1))}
                pendingMilestoneMinigame={props.pendingMilestoneMinigames[0] ?? null}
                onPlayMilestoneMinigame={props.handlePlayMilestoneMinigame}
              />
            }
          />
          <Route
            path="puzzles"
            element={
              <PuzzleScreen
                puzzles={props.puzzles}
                error={props.puzzlesError}
                onReload={props.reloadPuzzles}
                onCoinsChanged={props.reloadCoins}
              />
            }
          />
          <Route
            path="puzzles/:challengeSlug"
            element={
              <PuzzleRoute
                puzzles={props.puzzles}
                error={props.puzzlesError}
                onReload={props.reloadPuzzles}
                onCoinsChanged={props.reloadCoins}
              />
            }
          />
          <Route
            path="scoring"
            element={
              <ScoringScreen
                games={props.scoringGames}
                error={props.scoringGamesError}
                onReload={props.reloadScoringGames}
                onCoinsChanged={props.reloadCoins}
              />
            }
          />
          <Route
            path="scoring/:gameSlug"
            element={
              <ScoringRoute
                games={props.scoringGames}
                error={props.scoringGamesError}
                onReload={props.reloadScoringGames}
                onCoinsChanged={props.reloadCoins}
              />
            }
          />
          <Route
            path="hunt"
            element={
              <HuntScreen
                characters={props.huntCharacters}
                error={props.huntError}
                onReload={props.reloadHuntCharacters}
                onCompleteChallenge={props.completeHuntChallenge}
                onPlayMinigame={props.handlePlayHuntMinigame}
                onScanQr={() => props.setShowScanEntry(true)}
              />
            }
          />
          <Route
            path="animals/*"
            element={
              <AnimalsScreen
                onScanQr={() => props.setShowScanEntry(true)}
                photos={props.animalPhotos}
                photosError={props.animalPhotosError}
              />
            }
          />
          <Route
            path="collectibles"
            element={
              <CollectiblesScreen
                catalog={props.collectibleCatalog}
                catalogError={props.collectibleCatalogError}
                onReloadCatalog={props.reloadCollectibleCatalog}
                cards={props.collectibleCards}
                cardsError={props.collectibleCardsError}
                onReloadCards={props.reloadCollectibleCards}
                coinsSummary={props.coinsSummary}
                onPurchase={props.purchaseCollectible}
              />
            }
          />
          <Route
            path="photos"
            element={
              <PhotoScreen gallery={props.photoGallery} error={props.photoGalleryError} onReload={props.reloadPhotoGallery} />
            }
          />
          <Route path="food-trucks" element={<FoodTruckScreen />} />
          <Route path="faq" element={<FaqRoute />} />
          <Route path="privacy" element={<PrivacyScreen />} />
        </Routes>
      </main>

      <ToastStack toasts={props.toasts} onDismiss={props.onDismissToast} />

      {props.activeMinigame && <MinigameOverlay game={props.activeMinigame} onClose={props.onMinigameOverlayClose} />}

      {props.showScanEntry && (
        <ScanEntryModal
          onClose={() => props.setShowScanEntry(false)}
          onResolved={(path) => {
            props.setShowScanEntry(false)
            navigate(path)
          }}
        />
      )}

      {props.showContactStaff && (
        <ContactStaffModal
          nodes={props.nodes}
          myRequestStatus={props.myRequestStatus}
          onRequestChanged={props.reloadMyRequestStatus}
          onClose={() => props.setShowContactStaff(false)}
        />
      )}

      {props.showPassport && <PassportModal onClose={() => props.setShowPassport(false)} />}

      {props.showResetConfirm && (
        <ResetSessionModal
          guest={props.guest}
          onClose={() => props.setShowResetConfirm(false)}
          onReset={props.handleResetSession}
        />
      )}

      {props.showAccount && (
        <AccountModal
          guest={props.guest}
          onAuthed={props.onGuestAuthed}
          onLoggedOut={props.onGuestLoggedOut}
          onClose={() => props.setShowAccount(false)}
          onBingoMapStartFresh={() => {
            if (props.cardId) props.reloadCard(props.cardId)
            props.reloadNodes()
          }}
          onOpenResetSession={() => {
            props.setShowAccount(false)
            props.setShowResetConfirm(true)
          }}
          onOpenPrivacy={() => {
            props.setShowAccount(false)
            navigate('/privacy')
          }}
        />
      )}

      <AnnouncementPopup announcements={props.announcements} resetSignal={props.announcementResetSignal} />
    </div>
  )
}

interface MapRouteProps {
  nodes: MapNode[] | null
  error: string | null
  onReload: () => void
  onVisitResult: (result: VisitNodeResponse) => void
}

// FAQ's washroom answer ("Show me on the map") deep-links here via
// navigate('/map', { state: { keySpot } }) -- router location state instead
// of a value lifted in App, since it's inherently a one-shot handoff between
// two routes rather than app-wide state. Cleared (not just consumed) via a
// replace navigation so Back from Map doesn't land on a history entry that
// would replay the highlight.
function MapRoute({ nodes, error, onReload, onVisitResult }: MapRouteProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const keySpot = (location.state as { keySpot?: string } | null)?.keySpot ?? null

  return (
    <MapScreen
      nodes={nodes}
      error={error}
      onReload={onReload}
      onVisitResult={onVisitResult}
      initialKeySpot={keySpot}
      onInitialKeySpotHandled={() => navigate(location.pathname, { replace: true, state: null })}
    />
  )
}

function FaqRoute() {
  const navigate = useNavigate()
  return <FaqScreen onOpenMapKeySpot={(key) => navigate('/map', { state: { keySpot: key } })} />
}

interface ScoringRouteProps {
  games: ScoringGame[] | null
  error: string | null
  onReload: () => void
  onCoinsChanged: () => void
}

// The Scoring Sheet QR deep-link entry point (/scoring/:gameSlug) -- must
// work as a hard cold-load deep link, same as ScanRoute above and Our
// Animals' /animals/:slug. ScoringScreen itself does the slug matching
// (against the already-loaded games list) and the auto-open/not-found
// behavior; this wrapper's only job is pulling the param off the route.
function ScoringRoute(props: ScoringRouteProps) {
  const { gameSlug = '' } = useParams<{ gameSlug: string }>()
  const navigate = useNavigate()
  return <ScoringScreen {...props} gameSlug={gameSlug} onBrowseGames={() => navigate('/scoring')} />
}

interface PuzzleRouteProps {
  puzzles: Puzzle[] | null
  error: string | null
  onReload: () => void
  onCoinsChanged: () => void
}

// The Puzzle Timer QR deep-link entry point (/puzzles/:challengeSlug) --
// same shape as ScoringRoute above.
function PuzzleRoute(props: PuzzleRouteProps) {
  const { challengeSlug = '' } = useParams<{ challengeSlug: string }>()
  const navigate = useNavigate()
  return <PuzzleScreen {...props} challengeSlug={challengeSlug} onBrowsePuzzles={() => navigate('/puzzles')} />
}

export default App
