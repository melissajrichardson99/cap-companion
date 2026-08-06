import { useEffect, useState } from 'react'
import { api, type BingoCard, type MapNode, type Minigame, type MilestoneEvent, type Puzzle, type ScoringGame, type TileCompletionResult, type VisitNodeResponse } from './api'
import { BingoScreen } from './components/BingoScreen'
import { MapScreen } from './components/MapScreen'
import { MinigameOverlay, getMinigameSlug } from './components/MinigameOverlay'
import { PuzzleScreen } from './components/PuzzleScreen'
import { ScoringScreen } from './components/ScoringScreen'
import { ToastStack, type ToastItem } from './components/ToastStack'
import './components/shared.css'
import './App.css'

type Tab = 'map' | 'bingo' | 'puzzles' | 'scoring'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('map')

  const [nodes, setNodes] = useState<MapNode[] | null>(null)
  const [nodesError, setNodesError] = useState<string | null>(null)

  const [cardId, setCardId] = useState<string | null>(null)
  const [card, setCard] = useState<BingoCard | null>(null)
  const [cardError, setCardError] = useState<string | null>(null)

  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null)
  const [puzzlesError, setPuzzlesError] = useState<string | null>(null)

  const [scoringGames, setScoringGames] = useState<ScoringGame[] | null>(null)
  const [scoringGamesError, setScoringGamesError] = useState<string | null>(null)

  const [milestoneQueue, setMilestoneQueue] = useState<MilestoneEvent[]>([])
  const [minigameQueue, setMinigameQueue] = useState<Minigame[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const activeMinigame = minigameQueue[0] ?? null

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

  useEffect(() => {
    reloadNodes()
    reloadPuzzles()
    reloadScoringGames()
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

  const enqueueMinigames = (drawn: TileCompletionResult['minigames_drawn']) => {
    if (drawn.length === 0) return
    const playable = drawn.filter((game) => getMinigameSlug(game) !== null)
    const unbuilt = drawn.filter((game) => getMinigameSlug(game) === null)
    if (playable.length > 0) {
      setMinigameQueue((prev) => [...prev, ...playable])
    }
    if (unbuilt.length > 0) {
      const newToasts = unbuilt.map((game) => ({
        id: crypto.randomUUID(),
        text: `\u{1F3AE} ${game.name} minigame queued (not built yet — Phase ${game.phase})`,
      }))
      setToasts((prev) => [...prev, ...newToasts])
    }
  }

  const enqueueMilestones = (events: MilestoneEvent[]) => {
    if (events.length === 0) return
    setMilestoneQueue((prev) => [...prev, ...events])
    setActiveTab('bingo')
  }

  const handleTileResult = (result: TileCompletionResult) => {
    if (cardId) reloadCard(cardId)
    reloadNodes()
    enqueueMinigames(result.minigames_drawn)
    enqueueMilestones(result.milestones)
  }

  const handleVisitResult = (result: VisitNodeResponse) => {
    if (cardId) reloadCard(cardId)
    reloadNodes()
    for (const tc of result.tile_completions) {
      enqueueMinigames(tc.minigames_drawn)
    }
    enqueueMilestones(result.tile_completions.flatMap((tc) => tc.milestones))
  }

  return (
    <div id="app-root">
      <header className="app-header">
        <h1 className="app-title">Cobb's Adventure Park</h1>
        <nav className="app-tabs">
          <button
            type="button"
            className={`app-tab ${activeTab === 'map' ? 'app-tab-active' : ''}`}
            onClick={() => setActiveTab('map')}
          >
            Map
          </button>
          <button
            type="button"
            className={`app-tab ${activeTab === 'bingo' ? 'app-tab-active' : ''}`}
            onClick={() => setActiveTab('bingo')}
          >
            Bingo Card
          </button>
          <button
            type="button"
            className={`app-tab ${activeTab === 'puzzles' ? 'app-tab-active' : ''}`}
            onClick={() => setActiveTab('puzzles')}
          >
            Puzzles
          </button>
          <button
            type="button"
            className={`app-tab ${activeTab === 'scoring' ? 'app-tab-active' : ''}`}
            onClick={() => setActiveTab('scoring')}
          >
            Scoring Sheet
          </button>
        </nav>
      </header>

      <main className="app-main">
        {activeTab === 'map' && (
          <MapScreen nodes={nodes} error={nodesError} onReload={reloadNodes} onVisitResult={handleVisitResult} />
        )}
        {activeTab === 'bingo' && (
          <BingoScreen
            card={card}
            error={cardError}
            onReload={() => cardId && reloadCard(cardId)}
            onTileResult={handleTileResult}
            milestoneQueue={milestoneQueue}
            onMilestoneShown={() => setMilestoneQueue((q) => q.slice(1))}
          />
        )}
        {activeTab === 'puzzles' && (
          <PuzzleScreen puzzles={puzzles} error={puzzlesError} onReload={reloadPuzzles} />
        )}
        {activeTab === 'scoring' && (
          <ScoringScreen games={scoringGames} error={scoringGamesError} onReload={reloadScoringGames} />
        )}
      </main>

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />

      {activeMinigame && (
        <MinigameOverlay game={activeMinigame} onClose={() => setMinigameQueue((q) => q.slice(1))} />
      )}
    </div>
  )
}

export default App
