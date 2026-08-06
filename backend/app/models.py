"""Pydantic models mirroring the data models in CAP_Companion_App_TechSpec.md section 3."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class NodeCategory(StrEnum):
    ATTRACTION = "attraction"
    ANIMAL = "animal"
    SERVICE = "service"
    FOOD = "food"
    SEASONAL = "seasonal"


class NodeState(StrEnum):
    NOT_VISITED = "not_visited"
    VISITED = "visited"
    CLOSED = "closed"


class EngineGroup(StrEnum):
    REACTION_TIMING = "reaction_timing"
    GRID_DRAG = "grid_drag"
    AUTO_SCROLL = "auto_scroll"
    STANDALONE = "standalone"


class MilestoneType(StrEnum):
    LINE = "line"
    X = "x"
    BLACKOUT = "blackout"


class SolutionType(StrEnum):
    EXACT = "exact"
    STRATEGY = "strategy"
    NONE = "none"


class WinConditionType(StrEnum):
    FIRST_TO = "first_to"
    FIRST_TO_BONUS_ROUND = "first_to_bonus_round"
    FIRST_TO_ROUND_TIEBREAK = "first_to_round_tiebreak"


class ScoreStatus(StrEnum):
    """Values match app.services.scoring's STATUS_* constants exactly."""

    IN_PROGRESS = "in_progress"
    WON = "won"
    TIE_BONUS_ROUND = "tie_bonus_round"
    TIE_ROUND_PENDING = "tie_round_pending"


class LinkedTile(BaseModel):
    """Minimal tile summary embedded in a MapNode response.

    Lets the frontend drive the "did you complete X here?" popup sequence
    (tech spec 4.3) directly off GET /map/nodes without a second round trip.
    """

    id: UUID
    label: str
    completed: bool


class ChildNode(BaseModel):
    """Minimal child-node summary embedded in a parent MapNode response.

    Lets the frontend render "Games here: X, Y" on a parent's popup, and
    identify which nodes are children (and so shouldn't get their own pin)
    without a second round trip.
    """

    id: UUID
    name: str


class MapNode(BaseModel):
    id: UUID
    name: str
    category: NodeCategory
    description: str
    state: NodeState = NodeState.NOT_VISITED
    linked_tiles: list[LinkedTile] = Field(default_factory=list)
    # Percentage position (0-100) on the map background image, not pixel
    # coordinates, so pins stay correctly placed regardless of the final
    # artwork's resolution. Null for nodes not yet placed on the map.
    x_pct: float | None = Field(default=None, ge=0, le=100)
    y_pct: float | None = Field(default=None, ge=0, le=100)
    # Set when this node is really a sub-game of a single physical pad (e.g.
    # Cornhole -> Arcade Pad) rather than its own map location. Parented
    # nodes don't render their own pin/fallback entry; the parent's
    # `children` list stands in for them instead.
    parent_node_id: UUID | None = None
    children: list[ChildNode] = Field(default_factory=list)

    @property
    def linked_bingo_tile_ids(self) -> list[UUID]:
        return [t.id for t in self.linked_tiles]


class BingoTile(BaseModel):
    id: UUID
    card_id: UUID
    row: int = Field(ge=0, le=4)
    col: int = Field(ge=0, le=4)
    label: str
    linked_map_node_id: UUID | None = None
    completed: bool = False
    completed_at: datetime | None = None

    @property
    def index(self) -> int:
        return self.row * 5 + self.col


class MilestonesAchieved(BaseModel):
    lines: list[int] = Field(default_factory=list)
    x: bool = False
    blackout: bool = False


class BingoCard(BaseModel):
    id: UUID
    owner_label: str
    tiles: list[BingoTile]
    milestones_achieved: MilestonesAchieved


class BingoCardSummary(BaseModel):
    """Minimal card listing so the frontend can auto-select a card without the guest needing to know/paste a card id."""

    id: UUID
    owner_label: str


class Minigame(BaseModel):
    id: UUID
    name: str
    engine_group: EngineGroup
    theme: str
    target_duration_seconds: int = 30
    phase: int = Field(ge=1, le=2)


class MilestoneEvent(BaseModel):
    type: MilestoneType
    message: str
    tile_ids: list[UUID]


class TileCompletionResult(BaseModel):
    """Result of completing one bingo tile: what changed and what it triggered."""

    tile: BingoTile
    milestones: list[MilestoneEvent]
    minigames_drawn: list[Minigame]
    card_milestones_achieved: MilestonesAchieved


class VisitNodeRequest(BaseModel):
    completed_tile_ids: list[UUID] = Field(default_factory=list)


class VisitNodeResponse(BaseModel):
    node: MapNode
    tile_completions: list[TileCompletionResult]


class PuzzleChallenge(BaseModel):
    id: UUID
    puzzle_id: UUID
    label: str
    description: str
    staff_time_seconds: int | None = Field(default=None, gt=0)
    solution_type: SolutionType
    # hint_tier_3 holds the full solution ('exact') or complete strategy
    # explanation ('strategy'). All three are null for 'none' puzzles
    # (Big Mystery Maze) -- the frontend hides the hint button entirely then.
    hint_tier_1: str | None = None
    hint_tier_2: str | None = None
    hint_tier_3: str | None = None


class Puzzle(BaseModel):
    id: UUID
    name: str
    rules_text: str
    challenges: list[PuzzleChallenge] = Field(default_factory=list)


class PuzzleAttempt(BaseModel):
    id: UUID
    challenge_id: UUID
    elapsed_seconds: int = Field(gt=0)
    hints_used: int = Field(ge=0, le=3)
    created_at: datetime


class RecordAttemptRequest(BaseModel):
    elapsed_seconds: int = Field(gt=0)
    hints_used: int = Field(ge=0, le=3)


class GameScoreEvent(BaseModel):
    id: UUID
    game_id: UUID
    label: str
    point_value: int = Field(gt=0)


class ScoringGame(BaseModel):
    id: UUID
    name: str
    rules_text: str
    win_condition_text: str
    win_condition_type: WinConditionType
    win_threshold: int = Field(gt=0)
    # Only set for round-based games (Tiki Toss: 10 throws/round).
    throws_per_round: int | None = Field(default=None, gt=0)
    score_events: list[GameScoreEvent] = Field(default_factory=list)


class ScoreEntry(BaseModel):
    id: UUID
    session_id: UUID
    player_name: str
    score_event_id: UUID
    # Denormalized from game_score_events so the frontend can render an
    # entry's label/points without a second lookup -- same pattern as
    # BingoTile/LinkedTile embedding.
    label: str
    point_value: int
    created_at: datetime


class ScoreSheetSession(BaseModel):
    id: UUID
    game_id: UUID
    players: list[str]
    created_at: datetime
    completed_at: datetime | None = None
    winner: str | None = None
    status: ScoreStatus = ScoreStatus.IN_PROGRESS
    totals: dict[str, int] = Field(default_factory=dict)
    entries: list[ScoreEntry] = Field(default_factory=list)
    # Only populated when status is a tie state.
    tied_players: list[str] = Field(default_factory=list)
    # Only meaningful for round-based games (Tiki Toss).
    round_number: int | None = None


class CreateSessionRequest(BaseModel):
    game_id: UUID
    players: list[str] = Field(min_length=1)


class RecordScoreEntryRequest(BaseModel):
    player_name: str
    score_event_id: UUID
