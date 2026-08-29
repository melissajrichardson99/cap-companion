// Typed fetch client for the Phase 1 backend endpoints.

import { getDeviceSessionId } from './deviceSession'
import { getStaffToken } from './staffAuth'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

// Derived display state for a node's pin/card visuals -- not an API field.
// MapNode itself only carries `visited` (per-session, Per-Device Sessions
// Phase 3) and `is_open` (global, staff-managed); see deriveNodeDisplayState
// below for how the two combine into this.
export type NodeDisplayState = 'not_visited' | 'visited' | 'closed'
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
  // The calling device's own visit progress (Per-Device Sessions Phase 3),
  // resolved server-side from the X-Device-Session header -- not global.
  visited: boolean
  is_open: boolean
  linked_tiles: LinkedTile[]
  x_pct: number | null
  y_pct: number | null
  parent_node_id: string | null
  children: ChildNode[]
}

// Combines visited (per-session) and is_open (global, staff-managed) into
// the single display state MapScreen.tsx/NodeDetailPopup.tsx render --
// is_open wins outright (a closed attraction shows as closed regardless of
// this session's own visit progress).
export function deriveNodeDisplayState(node: Pick<MapNode, 'visited' | 'is_open'>): NodeDisplayState {
  if (!node.is_open) return 'closed'
  return node.visited ? 'visited' : 'not_visited'
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
  coins_awarded: number
}

export interface TileCompletionResult {
  tile: BingoTile
  milestones: MilestoneEvent[]
  minigames_drawn: Minigame[]
  card_milestones_achieved: MilestonesAchieved
  coins_awarded: number
}

export interface VisitNodeResponse {
  node: MapNode
  tile_completions: TileCompletionResult[]
  coins_awarded: number
}

export type SolutionType = 'exact' | 'strategy' | 'none'

export interface PuzzleChallenge {
  id: string
  puzzle_id: string
  label: string
  // QR-routable identifier for /puzzles/:challengeSlug.
  slug: string
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
  // QR-routable identifier for /scoring/:gameSlug.
  slug: string
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
  coins_awarded: number
}

// Staff-only (Staff Page QR Code Directory): a Hunt character paired with
// its /scan/:code value. HuntCharacter itself doesn't carry this.
export interface HuntCharacterScanCode {
  id: string
  name: string
  code: string
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

// Which of the 4 QR-routable destinations ScanEntryModal's manual-entry
// field resolved to -- see GET /scan/lookup/:text (app/services/scan.py's
// resolve_manual_entry). 'scan' covers both hunt_character and
// encyclopedia_entry, same as ScanResult above, since both route through
// /scan/:code regardless.
export type ManualEntryMatchType = 'scan' | 'animal' | 'scoring' | 'puzzle'

export interface ManualEntryResolution {
  type: ManualEntryMatchType
  slug: string
}

export type StaffRequestType = 'question' | 'emergency'
export type StaffRequestStatus = 'open' | 'acknowledged' | 'resolved'

export interface StaffRequest {
  id: string
  type: StaffRequestType
  location_node_id: string | null
  location_name: string | null
  name: string | null
  description: string | null
  status: StaffRequestStatus
  created_at: string
  resolved_at: string | null
}

// Keep in sync with backend/app/models.py's CreateStaffRequestRequest --
// description is rejected (422) past this length, not truncated.
export const STAFF_REQUEST_DESCRIPTION_MAX_LENGTH = 500

export type CoinSourceType =
  | 'scavenger_hunt'
  | 'puzzle_timer'
  | 'scoring_sheet_win'
  | 'bingo_milestone'
  | 'hunt_complete'
  | 'map_exploration'

export interface CoinsSummary {
  total: number
}

export type CollectibleTier = 'standard' | 'special'

export interface CollectibleCatalogEntry {
  animal_slug: string
  tier: CollectibleTier
  price: number
}

export interface CollectibleCard {
  id: string
  animal_slug: string
  tier: CollectibleTier
  photo_index: number
  guest_name: string
  coins_spent: number
  created_at: string
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
  coins_reset: number
  collectible_cards_reset: number
  puzzle_attempts_reset: number
  scoring_sessions_reset: number
  photo_votes_reset: number
}

// Per-Device Sessions Phase 0 -- see backend/app/routers/device_session.py.
export interface DeviceSession {
  id: string
  created_at: string
  last_active_at: string
}

export interface Announcement {
  id: string
  text: string
  created_at: string
  updated_at: string
}

// Staff-managed "Our Animals" photos -- distinct from Collectibles' curated
// pool (CollectibleCard.photo_index / imageCandidates()), which is
// unaffected by this and stays resolved against the static frontend files.
export interface AnimalPhoto {
  id: string
  animal_slug: string
  photo_url: string
  display_order: number
}

// Staff Page Analytics dashboard -- see backend/app/services/analytics.py
// for the date-range convention and the reasoning behind every
// ambiguous-metric choice referenced in the comments below.
export interface UsersOverTimePoint {
  date: string
  count: number
}

export interface DailyRatePoint {
  date: string
  pct: number
}

export interface AnalyticsOverview {
  total_users: number
  users_over_time: UsersOverTimePoint[]
}

export interface AnalyticsCoins {
  total_coins_earned: number
  // Denominator is every app user in range, not just users who earned a coin.
  avg_coins_per_user: number
}

export interface HuntCharacterFoundRate {
  character_id: string
  name: string
  found_pct: number
}

export interface AnalyticsScavengerHunt {
  // Average, across app users in range, of (characters found / total
  // characters) -- partial-progress average, not "% of users who fully
  // finished" (see AnalyticsEngagement.full_completionist_rate_pct for that).
  avg_completion_rate_pct: number
  character_found_rates: HuntCharacterFoundRate[]
}

export interface AnalyticsBingo {
  // Raw average count of tiles completed per session in range, not a
  // percentage of the 25-tile board.
  avg_tiles_completed: number
  avg_milestones_per_session: number
}

export interface MapNodeVisitRank {
  node_id: string
  name: string
  visits: number
}

export interface AnalyticsMapExploration {
  avg_nodes_visited_per_session: number
  // Sorted descending by visits.
  node_rankings: MapNodeVisitRank[]
}

export interface AnimalPurchaseRank {
  animal_slug: string
  count: number
}

export interface AnalyticsCollectibles {
  most_purchased: AnimalPurchaseRank[]
}

export interface AnalyticsPuzzleScoring {
  // puzzle_attempts rows are only ever written after a successful solve, so
  // there's no separate "attempted but not solved" count for Puzzle Timer,
  // unlike Scoring Sheet.
  puzzle_timer_solves: number
  scoring_sheet_attempts: number
  scoring_sheet_completions: number
}

export interface AnalyticsPhotosPassport {
  photos_submitted: number
  pct_sessions_voting: number
  passports_generated: number
}

export interface AnalyticsEngagement {
  full_completionist_rate_pct: number
  full_completionist_trend: DailyRatePoint[]
}

export interface AnalyticsStaffOps {
  total_requests: number
  general_count: number
  emergency_count: number
}

export interface AnalyticsSummary {
  range_start: string
  range_end: string
  overview: AnalyticsOverview
  coins: AnalyticsCoins
  hunt: AnalyticsScavengerHunt
  bingo: AnalyticsBingo
  map_exploration: AnalyticsMapExploration
  collectibles: AnalyticsCollectibles
  puzzle_scoring: AnalyticsPuzzleScoring
  photos_passport: AnalyticsPhotosPassport
  engagement: AnalyticsEngagement
  staff_ops: AnalyticsStaffOps
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Session': getDeviceSessionId(),
      ...init?.headers,
    },
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
  setNodeOpenStatus: (nodeId: string, isOpen: boolean) =>
    staffRequest<MapNode>(`/map/nodes/${nodeId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ is_open: isOpen }),
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
  listHuntScanCodes: () => staffRequest<HuntCharacterScanCode[]>('/hunt/scan-codes'),
  completeHuntChallenge: (challengeId: string) =>
    request<HuntCharacter>(`/hunt/challenges/${challengeId}/complete`, { method: 'POST' }),
  unlockHuntCharacter: (characterId: string) =>
    request<HuntCharacter>(`/hunt/characters/${characterId}/unlock`, { method: 'POST' }),
  resolveScanCode: (code: string) => request<ScanResult>(`/scan/${encodeURIComponent(code)}`),
  resolveManualEntry: (text: string) => request<ManualEntryResolution>(`/scan/lookup/${encodeURIComponent(text)}`),
  createStaffRequest: (
    type: StaffRequestType,
    locationNodeId: string | null,
    name: string | null,
    description: string | null,
  ) =>
    request<StaffRequest>('/staff-requests', {
      method: 'POST',
      body: JSON.stringify({ type, location_node_id: locationNodeId, name, description }),
    }),
  listStaffRequests: (includeResolved = false) =>
    staffRequest<StaffRequest[]>(`/staff-requests?include_resolved=${includeResolved}`),
  acknowledgeStaffRequest: (requestId: string) =>
    staffRequest<StaffRequest>(`/staff-requests/${requestId}/acknowledge`, { method: 'POST' }),
  resolveStaffRequest: (requestId: string) =>
    staffRequest<StaffRequest>(`/staff-requests/${requestId}/resolve`, { method: 'POST' }),
  // start/end are YYYY-MM-DD (date-only, matching the backend's `date` query
  // params) -- no time-of-day component from the frontend.
  getAnalyticsSummary: (start: string, end: string) =>
    staffRequest<AnalyticsSummary>(`/analytics/summary?start=${start}&end=${end}`),
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
  listCollectibleCatalog: () => request<CollectibleCatalogEntry[]>('/collectibles/catalog'),
  listCollectibles: () => request<CollectibleCard[]>('/collectibles'),
  purchaseCollectible: (animalSlug: string, guestName: string) =>
    request<CollectibleCard>('/collectibles/purchase', {
      method: 'POST',
      body: JSON.stringify({ animal_slug: animalSlug, guest_name: guestName }),
    }),
  submitPhoto: async (file: File, guestLabel: string | null) => {
    const body = new FormData()
    body.append('file', file)
    if (guestLabel) body.append('guest_label', guestLabel)
    // Not routed through request(): that helper always sets a JSON
    // Content-Type header, which would stop the browser from adding the
    // multipart boundary this upload needs.
    const res = await fetch(`${API_BASE_URL}/photos/submit`, {
      method: 'POST',
      headers: { 'X-Device-Session': getDeviceSessionId() },
      body,
    })
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
  listPhotoGallery: () => request<PhotoSubmission[]>('/photos/gallery'),
  votePhoto: (submissionId: string) => request<PhotoSubmission>(`/photos/${submissionId}/vote`, { method: 'POST' }),
  getPhotoOfTheDay: () => request<PhotoSubmission | null>('/photos/of-the-day'),
  listAnimalPhotos: () => request<AnimalPhoto[]>('/animal-photos'),
  uploadAnimalPhoto: async (animalSlug: string, file: File) => {
    const body = new FormData()
    body.append('file', file)
    // Not routed through request(): same multipart-vs-JSON-Content-Type
    // reasoning as submitPhoto above.
    const token = getStaffToken()
    const res = await fetch(`${API_BASE_URL}/animal-photos/${animalSlug}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    })
    if (!res.ok) {
      const responseBody = await res.text()
      throw new Error(`POST /animal-photos/${animalSlug} -> ${res.status}: ${responseBody}`)
    }
    return res.json() as Promise<AnimalPhoto>
  },
  deleteAnimalPhoto: (photoId: string) => staffRequest<void>(`/animal-photos/${photoId}`, { method: 'DELETE' }),
  reorderAnimalPhotos: (animalSlug: string, photoIds: string[]) =>
    staffRequest<AnimalPhoto[]>(`/animal-photos/${animalSlug}/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ photo_ids: photoIds }),
    }),
  generatePassport: async (familyLabel: string, file: File | null) => {
    const body = new FormData()
    body.append('family_label', familyLabel)
    if (file) body.append('file', file)
    // Not routed through request(): same multipart-vs-JSON-Content-Type
    // reasoning as submitPhoto above.
    const res = await fetch(`${API_BASE_URL}/passport/generate`, {
      method: 'POST',
      headers: { 'X-Device-Session': getDeviceSessionId() },
      body,
    })
    if (!res.ok) {
      const responseBody = await res.text()
      throw new Error(`POST /passport/generate -> ${res.status}: ${responseBody}`)
    }
    return res.json() as Promise<PassportSession>
  },
  resetSession: () => request<ResetSessionResult>('/session/reset', { method: 'POST' }),
  // Per-Device Sessions Phase 0 throwaway verification endpoint -- see
  // backend/app/routers/device_session.py. Not called from any guest-facing
  // UI yet; exercised via the console (see main.tsx's window.__capWhoami).
  whoami: () => request<DeviceSession>('/session/whoami'),
  listAnnouncements: () => request<Announcement[]>('/announcements'),
  createAnnouncement: (text: string) =>
    staffRequest<Announcement>('/announcements', { method: 'POST', body: JSON.stringify({ text }) }),
  updateAnnouncement: (announcementId: string, text: string) =>
    staffRequest<Announcement>(`/announcements/${announcementId}`, {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    }),
  deleteAnnouncement: (announcementId: string) =>
    staffRequest<void>(`/announcements/${announcementId}`, { method: 'DELETE' }),
}
