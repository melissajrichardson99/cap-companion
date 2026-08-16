// Typed fetch client for the Phase 1 backend endpoints.

import { getStaffToken } from './staffAuth'

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
  type: 'line' | 'x' | 'blackout' | 'double_bingo'
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
  is_miss: boolean
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
  // This player's 1-indexed turn number within the session. Not the same
  // concept as round_number below (that's Tiki-Toss-only win-check rounds).
  turn_round: number
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
  // Turn-based scoring: null once the session is completed.
  current_player: string | null
  current_round: number | null
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
  unlocked: boolean
}

export type EncyclopediaStatus = 'placeholder' | 'published'

export interface EncyclopediaEntry {
  id: string
  animal_name: string
  status: EncyclopediaStatus
}

export type ScanResult =
  | { type: 'hunt_character'; target: HuntCharacter }
  | { type: 'encyclopedia_entry'; target: EncyclopediaEntry }

export type StaffRequestType = 'question' | 'emergency'
export type StaffRequestStatus = 'open' | 'acknowledged' | 'resolved'

export interface StaffRequest {
  id: string
  type: StaffRequestType
  location_node_id: string | null
  location_name: string | null
  status: StaffRequestStatus
  created_at: string
  resolved_at: string | null
}

export type CoinSourceType = 'scavenger_hunt' | 'puzzle_timer' | 'scoring_sheet_win' | 'bingo_tile'

export interface Collectible {
  id: string
  name: string
  icon: string
  unlock_threshold: number
  unlocked: boolean
}

export interface CoinsSummary {
  total: number
  collectibles: Collectible[]
}

export type PhotoStatus = 'pending_review' | 'shortlisted' | 'rejected'

export interface PhotoSubmission {
  id: string
  guest_label: string | null
  photo_url: string
  submitted_at: string
  status: PhotoStatus
  vote_count: number
  voted_by_me: boolean
}

export interface PassportStats {
  scavenger_hunt_characters_completed: number
  scavenger_hunt_characters_total: number
  bingo_tiles_completed: number
  bingo_tiles_total: number
  bingo_milestones: MilestonesAchieved
  scoring_sheet_games_won: number
  puzzle_challenges_completed: number
  total_cobb_coins: number
  title: string
}

export interface PassportSession {
  id: string
  family_label: string
  photo_url: string | null
  generated_at: string
  stats: PassportStats
}

export interface ResetSessionResult {
  bingo_tiles_reset: number
  map_nodes_reset: number
  hunt_characters_reset: number
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
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// Staff-only endpoints require this Authorization header (validated
// server-side by app/staff_auth.require_staff -- the client-side /staff
// login gate alone is not the real enforcement).
function staffRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStaffToken()
  return request<T>(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
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
  unlockHuntCharacter: (characterId: string) =>
    request<HuntCharacter>(`/hunt/characters/${characterId}/unlock`, { method: 'POST' }),
  resolveScanCode: (code: string) => request<ScanResult>(`/scan/${encodeURIComponent(code)}`),
  createStaffRequest: (type: StaffRequestType, locationNodeId: string | null) =>
    request<StaffRequest>('/staff-requests', {
      method: 'POST',
      body: JSON.stringify({ type, location_node_id: locationNodeId }),
    }),
  listStaffRequests: (includeResolved = false) =>
    staffRequest<StaffRequest[]>(`/staff-requests?include_resolved=${includeResolved}`),
  acknowledgeStaffRequest: (requestId: string) =>
    staffRequest<StaffRequest>(`/staff-requests/${requestId}/acknowledge`, { method: 'POST' }),
  resolveStaffRequest: (requestId: string) =>
    staffRequest<StaffRequest>(`/staff-requests/${requestId}/resolve`, { method: 'POST' }),
  staffLogin: (password: string) =>
    request<{ token: string }>('/staff/login', { method: 'POST', body: JSON.stringify({ password }) }),
  staffCheckSession: async (): Promise<boolean> => {
    try {
      await staffRequest<{ ok: boolean }>('/staff/session')
      return true
    } catch {
      return false
    }
  },
  getCoinsSummary: () => request<CoinsSummary>('/coins/summary'),
  submitPhoto: async (file: File, guestLabel: string | null) => {
    const body = new FormData()
    body.append('file', file)
    if (guestLabel) body.append('guest_label', guestLabel)
    // Not routed through request(): that helper always sets a JSON
    // Content-Type header, which would stop the browser from adding the
    // multipart boundary this upload needs.
    const res = await fetch(`${API_BASE_URL}/photos/submit`, { method: 'POST', body })
    if (!res.ok) {
      const responseBody = await res.text()
      throw new Error(`POST /photos/submit -> ${res.status}: ${responseBody}`)
    }
    return res.json() as Promise<PhotoSubmission>
  },
  listPendingPhotos: () => staffRequest<PhotoSubmission[]>('/photos/pending'),
  listShortlistedPhotos: () => staffRequest<PhotoSubmission[]>('/photos/shortlisted'),
  clearShortlistedPhotos: () => staffRequest<{ deleted: number }>('/photos/shortlisted', { method: 'DELETE' }),
  shortlistPhoto: (submissionId: string) =>
    staffRequest<PhotoSubmission>(`/photos/${submissionId}/shortlist`, { method: 'POST' }),
  rejectPhoto: (submissionId: string) =>
    staffRequest<PhotoSubmission>(`/photos/${submissionId}/reject`, { method: 'POST' }),
  deletePhoto: (submissionId: string) => staffRequest<void>(`/photos/${submissionId}`, { method: 'DELETE' }),
  listPhotoGallery: (voterSessionId: string) =>
    request<PhotoSubmission[]>(`/photos/gallery?voter_session_id=${encodeURIComponent(voterSessionId)}`),
  votePhoto: (submissionId: string, voterSessionId: string) =>
    request<PhotoSubmission>(`/photos/${submissionId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ voter_session_id: voterSessionId }),
    }),
  getPhotoOfTheDay: () => request<PhotoSubmission | null>('/photos/of-the-day'),
  generatePassport: async (familyLabel: string, file: File | null) => {
    const body = new FormData()
    body.append('family_label', familyLabel)
    if (file) body.append('file', file)
    // Not routed through request(): same multipart-vs-JSON-Content-Type
    // reasoning as submitPhoto above.
    const res = await fetch(`${API_BASE_URL}/passport/generate`, { method: 'POST', body })
    if (!res.ok) {
      const responseBody = await res.text()
      throw new Error(`POST /passport/generate -> ${res.status}: ${responseBody}`)
    }
    return res.json() as Promise<PassportSession>
  },
  resetSession: () => request<ResetSessionResult>('/session/reset', { method: 'POST' }),
}
