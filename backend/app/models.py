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
