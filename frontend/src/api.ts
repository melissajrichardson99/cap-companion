// Typed fetch client for the Phase 1 backend endpoints.

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export type NodeState = 'not_visited' | 'visited' | 'closed'
export type NodeCategory = 'attraction' | 'animal' | 'service' | 'food' | 'seasonal'

export interface LinkedTile {
  id: string
  label: string
  completed: boolean
}

export interface ChildNode {
  id: string
  name: string
}

export interface MapNode {
  id: string
  name: string
  category: NodeCategory
  description: string
  state: NodeState
  linked_tiles: LinkedTile[]
  x_pct: number | null
  y_pct: number | null
  parent_node_id: string | null
  children: ChildNode[]
}

export interface BingoTile {
  id: string
  card_id: string
  row: number
  col: number
  label: string
  linked_map_node_id: string | null
  completed: boolean
  completed_at: string | null
}

export interface MilestonesAchieved {
  lines: number[]
  x: boolean
  blackout: boolean
}

export interface BingoCard {
  id: string
  owner_label: string
  tiles: BingoTile[]
  milestones_achieved: MilestonesAchieved
}

export interface BingoCardSummary {
  id: string
  owner_label: string
}

export interface Minigame {
  id: string
  name: string
  engine_group: string
  theme: string
  target_duration_seconds: number
  phase: number
}

export interface MilestoneEvent {
  type: 'line' | 'x' | 'blackout'
  message: string
  tile_ids: string[]
}

export interface TileCompletionResult {
  tile: BingoTile
  milestones: MilestoneEvent[]
  minigames_drawn: Minigame[]
  card_milestones_achieved: MilestonesAchieved
}

export interface VisitNodeResponse {
  node: MapNode
  tile_completions: TileCompletionResult[]
}

export type SolutionType = 'exact' | 'strategy' | 'none'

export interface PuzzleChallenge {
  id: string
  puzzle_id: string
  label: string
  description: string
  staff_time_seconds: number | null
  solution_type: SolutionType
  hint_tier_1: string | null
  hint_tier_2: string | null
  hint_tier_3: string | null
}

export interface Puzzle {
  id: string
  name: string
  rules_text: string
  challenges: PuzzleChallenge[]
}

export interface PuzzleAttempt {
  id: string
  challenge_id: string
  elapsed_seconds: number
  hints_used: number
  created_at: string
}

export type WinConditionType = 'first_to' | 'first_to_bonus_round' | 'first_to_round_tiebreak'
export type ScoreStatus = 'in_progress' | 'won' | 'tie_bonus_round' | 'tie_round_pending'

export interface GameScoreEvent {
  id: string
  game_id: string
  label: string
  point_value: number
}

export interface ScoringGame {
  id: string
  name: string
  rules_text: string
  win_condition_text: string
  win_condition_type: WinConditionType
  win_threshold: number
  throws_per_round: number | null
  score_events: GameScoreEvent[]
}

export interface ScoreEntry {
  id: string
  session_id: string
  player_name: string
  score_event_id: string
  label: string
  point_value: number
  created_at: string
}

export interface ScoreSheetSession {
  id: string
  game_id: string
  players: string[]
  created_at: string
  completed_at: string | null
  winner: string | null
  status: ScoreStatus
  totals: Record<string, number>
  entries: ScoreEntry[]
  tied_players: string[]
  round_number: number | null
}

export type HuntSpeciesCategory = 'marsupial' | 'rodent' | 'other'

export interface HuntMcContent {
  question: string
  options: string[]
  answer_index: number
}

export interface HuntMatchingContent {
  pairs: { left: string; right: string }[]
}

export interface HuntTrueFalseSetContent {
  statements: { text: string; answer: boolean }[]
}

export interface HuntImageMcContent {
  scrambled: string
  unscrambled: string
  image_alt: string
  question: string
  options: string[]
  answer_index: number
}

export interface HuntMinigameContent {
  minigame_slug: string
}

export type HuntChallenge =
  | { id: string; character_id: string; order_index: number; type: 'mc'; content: HuntMcContent; metadata: Record<string, unknown> }
  | { id: string; character_id: string; order_index: number; type: 'matching'; content: HuntMatchingContent; metadata: Record<string, unknown> }
  | {
      id: string
      character_id: string
      order_index: number
      type: 'true_false_set'
      content: HuntTrueFalseSetContent
      metadata: Record<string, unknown>
    }
  | { id: string; character_id: string; order_index: number; type: 'image_mc'; content: HuntImageMcContent; metadata: Record<string, unknown> }
  | { id: string; character_id: string; order_index: number; type: 'minigame'; content: HuntMinigameContent; metadata: Record<string, unknown> }

export interface HuntCharacter {
  id: string
  name: string
  species_category: HuntSpeciesCategory
  minigame_slug: string
  challenges: HuntChallenge[]
  challenges_completed: number[]
  completed_at: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  listMapNodes: () => request<MapNode[]>('/map/nodes'),
  visitNode: (nodeId: string, completedTileIds: string[]) =>
    request<VisitNodeResponse>(`/map/nodes/${nodeId}/visit`, {
      method: 'POST',
      body: JSON.stringify({ completed_tile_ids: completedTileIds }),
    }),
  listBingoCards: () => request<BingoCardSummary[]>('/bingo/cards'),
  getBingoCard: (cardId: string) => request<BingoCard>(`/bingo/card/${cardId}`),
  completeTile: (tileId: string) =>
    request<TileCompletionResult>(`/bingo/tiles/${tileId}/complete`, { method: 'POST' }),
  listPuzzles: () => request<Puzzle[]>('/puzzles'),
  recordPuzzleAttempt: (challengeId: string, elapsedSeconds: number, hintsUsed: number) =>
    request<PuzzleAttempt>(`/puzzles/challenges/${challengeId}/attempts`, {
      method: 'POST',
      body: JSON.stringify({ elapsed_seconds: elapsedSeconds, hints_used: hintsUsed }),
    }),
  listScoringGames: () => request<ScoringGame[]>('/scoring/games'),
  createScoreSheetSession: (gameId: string, players: string[]) =>
    request<ScoreSheetSession>('/scoring/sessions', {
      method: 'POST',
      body: JSON.stringify({ game_id: gameId, players }),
    }),
  getScoreSheetSession: (sessionId: string) => request<ScoreSheetSession>(`/scoring/sessions/${sessionId}`),
  recordScoreEntry: (sessionId: string, playerName: string, scoreEventId: string) =>
    request<ScoreSheetSession>(`/scoring/sessions/${sessionId}/entries`, {
      method: 'POST',
      body: JSON.stringify({ player_name: playerName, score_event_id: scoreEventId }),
    }),
  finishScoreSheetSession: (sessionId: string) =>
    request<ScoreSheetSession>(`/scoring/sessions/${sessionId}/finish`, { method: 'POST' }),
  listMinigames: () => request<Minigame[]>('/bingo/minigames'),
  listHuntCharacters: () => request<HuntCharacter[]>('/hunt/characters'),
  completeHuntChallenge: (challengeId: string) =>
    request<HuntCharacter>(`/hunt/challenges/${challengeId}/complete`, { method: 'POST' }),
}
