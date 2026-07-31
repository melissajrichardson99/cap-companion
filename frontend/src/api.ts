// Typed fetch client for the Phase 1 backend endpoints.

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export type NodeState = 'not_visited' | 'visited' | 'closed'
export type NodeCategory = 'attraction' | 'animal' | 'service' | 'food' | 'seasonal'

export interface LinkedTile {
  id: string
  label: string
  completed: boolean
}

export interface MapNode {
  id: string
  name: string
  category: NodeCategory
  description: string
  state: NodeState
  linked_tiles: LinkedTile[]
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
}
