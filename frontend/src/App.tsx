import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, type BingoCard, type CoinsSummary, type HuntCharacter, type MapNode, type Minigame, type MilestoneEvent, type PhotoSubmission, type Puzzle, type ScoringGame, type TileCompletionResult, type VisitNodeResponse } from './api'
import { AnimalsScreen } from './components/AnimalsScreen'
import { BingoScreen } from './components/BingoScreen'
import { BrandLogo } from './components/BrandLogo'
import { CollectiblesScreen } from './components/CollectiblesScreen'
import { ContactStaffModal } from './components/ContactStaffModal'
import { HomePage } from './components/HomePage'
import { HuntScreen } from './components/HuntScreen'
import { MapScreen } from './components/MapScreen'
import { MinigameOverlay, getMinigameSlug } from './components/MinigameOverlay'
import { NavMenu } from './components/NavMenu'
import { BinocularsIcon, CameraIcon, ClipboardIcon, GridIcon, MapPinIcon, PawIcon, PuzzlePieceIcon, SearchIcon } from './components/NavIcons'
import { PassportModal } from './components/PassportModal'
import { PhotoScreen } from './components/PhotoScreen'
import { PuzzleScreen } from './components/PuzzleScreen'
import { ResetSessionModal } from './components/ResetSessionModal'
import { ScanEntryModal } from './components/ScanEntryModal'
import { ScanScreen } from './components/ScanScreen'
import { ScoringScreen } from './components/ScoringScreen'
import { StaffPage } from './components/StaffPage'
import { ToastStack, type ToastItem } from './components/ToastStack'
import { getVoterSessionId } from './voterSession'
import './components/shared.css'
import './App.css'

type Tab = 'map' | 'bingo' | 'puzzles' | 'scoring' | 'hunt' | 'animals' | 'collectibles' | 'photos'

const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: 'map', label: 'Map', icon: <MapPinIcon /> },
  { key: 'bingo', label: 'Bingo Card', icon: <GridIcon /> },
  { key: 'puzzles', label: 'Puzzles', icon: <PuzzlePieceIcon /> },
  { key: 'scoring', label: 'Scoring Sheet', icon: <ClipboardIcon /> },
  { key: 'hunt', label: 'Scavenger Hunt', icon: <SearchIcon /> },
  { key: 'animals', label: 'Our Animals', icon: <BinocularsIcon /> },
  { key: 'collectibles', label: 'Collectibles', icon: <PawIcon /> },
  { key: 'photos', label: 'Favorite Photo', icon: <CameraIcon /> },
]

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('map')
  // True root route (Plan.md build-priority item 4): guests land on Home
  // first, same as `path`/`activeTab` below this is state layered on the
  // single '/' route rather than its own URL -- consistent with the rest of
  // this hand-rolled router, which never gave individual tabs their own
  // paths either. Picking a tab (NavMenu) leaves Home; the navbar logo
  // (BrandLogo) always returns to it.
  const [showHome, setShowHome] = useState(true)

  // Hand-rolled routing (no router lib elsewhere in this app): the only real
  // URL route is /scan/:code, which must work as a hard deep link (someone
  // else's camera app opening a printed sign's URL fresh) as well as via
  // in-app navigation from ScanEntryModal -- both funnel through the same
  // `path` state and ScanScreen below.
  const [path, setPath] = useState(() => window.location.pathname)
  const [showScanEntry, setShowScanEntry] = useState(false)
  const [showContactStaff, setShowContactStaff] = useState(false)
  const [showPassport, setShowPassport] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = (nextPath: string) => {
    window.history.pushState({}, '', nextPath)
    setPath(nextPath)
  }

  const scanMatch = path.match(/^\/scan\/([^/]+)$/)
  const isStaffView = path === '/staff'

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
  const [coinsError, setCoinsError] = useState<string | null>(null)

  const [photoGallery, setPhotoGallery] = useState<PhotoSubmission[] | null>(null)
  const [photoGalleryError, setPhotoGalleryError] = useState<string | null>(null)

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
    setCoinsError(null)
    api.getCoinsSummary().then(setCoinsSummary).catch((err) => setCoinsError(String(err)))
  }

  const reloadPhotoGallery = () => {
    setPhotoGalleryError(null)
    api
      .listPhotoGallery(getVoterSessionId())
      .then(setPhotoGallery)
      .catch((err) => setPhotoGalleryError(String(err)))
  }

  useEffect(() => {
    reloadNodes()
    reloadPuzzles()
    reloadScoringGames()
    reloadHuntCharacters()
    reloadMinigames()
    reloadCoins()
    reloadPhotoGallery()
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
    setActiveTab('bingo')
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

  const handleResetSession = () => {
    if (cardId) reloadCard(cardId)
    reloadNodes()
    reloadHuntCharacters()
    // Defensive: any minigame/milestone state left over from before the
    // reset refers to tiles/nodes that no longer exist in their prior form.
    setMilestoneQueue([])
    setMinigameQueue([])
    setPendingMilestoneMinigames([])
    setBaseFollowupQueue([])
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
    if (result.tile_completions.length > 0) reloadCoins()
    for (const tc of result.tile_completions) {
      processTileCompletion(tc)
    }
  }

  const completeHuntChallenge = (challengeId: string): Promise<HuntCharacter> =>
    api.completeHuntChallenge(challengeId).then((updated) => {
      setHuntCharacters((prev) => (prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev))
      reloadCoins()
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

  if (isStaffView) {
    // Lightweight, separate view (Plan.md 2.10) -- no shared header/nav with
    // the guest-facing app. Gated behind a shared staff password
    // (app/staff_auth.py) -- StaffPage itself handles the login screen.
    return <StaffPage />
  }

  if (scanMatch) {
    const code = decodeURIComponent(scanMatch[1])
    return (
      <div id="app-root">
        <header className="app-header">
          <div className="app-header-top">
            <BrandLogo
              onClick={() => {
                navigate('/')
                setShowHome(true)
              }}
            />
          </div>
        </header>
        <main className="app-main">
          <ScanScreen
            code={code}
            characters={huntCharacters}
            onCompleteChallenge={completeHuntChallenge}
            onUnlockCharacter={unlockHuntCharacter}
            onPlayMinigame={handlePlayHuntMinigame}
            onClose={() => navigate('/')}
          />
        </main>
        <ToastStack toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
        {activeMinigame && <MinigameOverlay game={activeMinigame} onClose={handleMinigameOverlayClose} />}
      </div>
    )
  }

  return (
    <div id="app-root">
      <header className="app-header">
        <div className="app-header-top">
          <BrandLogo onClick={() => setShowHome(true)} />
          <NavMenu
            tabs={TABS}
            activeTab={showHome ? null : activeTab}
            onSelectTab={(tab) => {
              setShowHome(false)
              setActiveTab(tab)
            }}
            coinTotal={coinsSummary?.total ?? 0}
            onScanQr={() => setShowScanEntry(true)}
            onGeneratePassport={() => setShowPassport(true)}
            onContactStaff={() => setShowContactStaff(true)}
            onResetSession={() => setShowResetConfirm(true)}
            onStaffNav={() => navigate('/staff')}
          />
        </div>
      </header>

      <main className="app-main">
        {showHome && (
          <HomePage
            onBrowsePhotos={() => {
              setShowHome(false)
              setActiveTab('photos')
            }}
          />
        )}
        {!showHome && activeTab === 'map' && (
          <MapScreen nodes={nodes} error={nodesError} onReload={reloadNodes} onVisitResult={handleVisitResult} />
        )}
        {!showHome && activeTab === 'bingo' && (
          <BingoScreen
            card={card}
            error={cardError}
            onReload={() => cardId && reloadCard(cardId)}
            onTileResult={handleTileResult}
            milestoneQueue={milestoneQueue}
            onMilestoneShown={() => setMilestoneQueue((q) => q.slice(1))}
            pendingMilestoneMinigame={pendingMilestoneMinigames[0] ?? null}
            onPlayMilestoneMinigame={handlePlayMilestoneMinigame}
          />
        )}
        {!showHome && activeTab === 'puzzles' && (
          <PuzzleScreen puzzles={puzzles} error={puzzlesError} onReload={reloadPuzzles} onCoinsChanged={reloadCoins} />
        )}
        {!showHome && activeTab === 'scoring' && (
          <ScoringScreen
            games={scoringGames}
            error={scoringGamesError}
            onReload={reloadScoringGames}
            onCoinsChanged={reloadCoins}
          />
        )}
        {!showHome && activeTab === 'hunt' && (
          <HuntScreen
            characters={huntCharacters}
            error={huntError}
            onReload={reloadHuntCharacters}
            onCompleteChallenge={completeHuntChallenge}
            onPlayMinigame={handlePlayHuntMinigame}
            onScanQr={() => setShowScanEntry(true)}
          />
        )}
        {!showHome && activeTab === 'animals' && <AnimalsScreen onScanQr={() => setShowScanEntry(true)} />}
        {!showHome && activeTab === 'collectibles' && (
          <CollectiblesScreen summary={coinsSummary} error={coinsError} onReload={reloadCoins} />
        )}
        {!showHome && activeTab === 'photos' && (
          <PhotoScreen gallery={photoGallery} error={photoGalleryError} onReload={reloadPhotoGallery} />
        )}
      </main>

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />

      {activeMinigame && <MinigameOverlay game={activeMinigame} onClose={handleMinigameOverlayClose} />}

      {showScanEntry && (
        <ScanEntryModal
          onClose={() => setShowScanEntry(false)}
          onCodeSubmitted={(code) => {
            setShowScanEntry(false)
            navigate(`/scan/${encodeURIComponent(code)}`)
          }}
        />
      )}

      {showContactStaff && <ContactStaffModal nodes={nodes} onClose={() => setShowContactStaff(false)} />}

      {showPassport && <PassportModal onClose={() => setShowPassport(false)} />}

      {showResetConfirm && (
        <ResetSessionModal onClose={() => setShowResetConfirm(false)} onReset={handleResetSession} />
      )}
    </div>
  )
}

export default App
