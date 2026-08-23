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
    DOUBLE_BINGO = "double_bingo"


class SolutionType(StrEnum):
    EXACT = "exact"
    STRATEGY = "strategy"
    NONE = "none"


class WinConditionType(StrEnum):
    FIRST_TO = "first_to"
    FIRST_TO_BONUS_ROUND = "first_to_bonus_round"
    FIRST_TO_ROUND_TIEBREAK = "first_to_round_tiebreak"


class HuntSpeciesCategory(StrEnum):
    MARSUPIAL = "marsupial"
    RODENT = "rodent"
    OTHER = "other"


class HuntChallengeType(StrEnum):
    MC = "mc"
    MATCHING = "matching"
    TRUE_FALSE_SET = "true_false_set"
    IMAGE_MC = "image_mc"
    MINIGAME = "minigame"


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
    # Staff-managed operational status, independent of `state` above (which
    # tracks a guest's own visit progress and is wiped by Reset Session).
    # Drives the Map's grey-pin/lock-icon closed treatment; never affects
    # Hunt/QR completion.
    is_open: bool = True
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
    # Coins awarded for reaching this milestone tier (bingo_milestone amount
    # for event.type, per app/services/coins.py's bingo_milestone_amount()),
    # 0 if none -- lets the frontend show it inline on MilestoneBanner
    # instead of a separate, competing toast.
    coins_awarded: int = Field(default=0, ge=0)


class TileCompletionResult(BaseModel):
    """Result of completing one bingo tile: what changed and what it triggered."""

    tile: BingoTile
    milestones: list[MilestoneEvent]
    minigames_drawn: list[Minigame]
    card_milestones_achieved: MilestonesAchieved
    # Coins awarded by this completion (mirrors milestones[0].coins_awarded
    # when a milestone fired, 0 otherwise -- Bingo coins only ever come from
    # a milestone tier, there's no separate flat per-tile award).
    coins_awarded: int = Field(default=0, ge=0)


class VisitNodeRequest(BaseModel):
    completed_tile_ids: list[UUID] = Field(default_factory=list)


class VisitNodeResponse(BaseModel):
    node: MapNode
    tile_completions: list[TileCompletionResult]
    # The one-time Map Exploration bonus (50, see coins.MAP_EXPLORATION_AMOUNT)
    # if this visit completed it, 0 otherwise. Separate from any
    # tile_completions[].coins_awarded, which are bingo-milestone coins from
    # this same visit's confirmed linked tiles.
    coins_awarded: int = Field(default=0, ge=0)


class SetNodeOpenStatusRequest(BaseModel):
    is_open: bool


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
    point_value: int = Field(ge=0)
    # Server-computed (point_value == 0), not a stored column -- lets the
    # frontend style/place the Miss button without string-matching the label.
    is_miss: bool = False


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
    # This player's 1-indexed turn number within the session. NOT the same
    # concept as ScoreSheetSession.round_number below (that's Tiki-Toss-only,
    # a 10-throw win-check boundary) -- turn_round is per-player-per-turn and
    # applies to every game. See migration 015's header for the full split.
    turn_round: int
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
    # Only meaningful for round-based games (Tiki Toss) -- the win-check
    # round from app/services/scoring.py, unrelated to current_round below.
    round_number: int | None = None
    # Turn-based scoring: whose turn it is and which turn-cycle round is in
    # progress. Both null once the session is completed. Distinct from
    # round_number above -- see ScoreEntry.turn_round's comment.
    current_player: str | None = None
    current_round: int | None = None


class CreateSessionRequest(BaseModel):
    game_id: UUID
    players: list[str] = Field(min_length=1)


class RecordScoreEntryRequest(BaseModel):
    player_name: str
    score_event_id: UUID


class HuntChallenge(BaseModel):
    id: UUID
    character_id: UUID
    order_index: int = Field(ge=1, le=3)
    type: HuntChallengeType
    # Shape varies by type: question/options/answer_index (mc), pairs
    # (matching), statements (true_false_set), scrambled/unscrambled +
    # question/options/answer_index (image_mc), or minigame_slug (minigame).
    # The frontend narrows on `type` to interpret it -- see api.ts.
    content: dict = Field(default_factory=dict)
    metadata: dict = Field(default_factory=dict)


class HuntCharacter(BaseModel):
    id: UUID
    name: str
    species_category: HuntSpeciesCategory
    minigame_slug: str
    challenges: list[HuntChallenge] = Field(default_factory=list)
    # Denormalized from hunt_progress, same embedding pattern as
    # BingoCard.milestones_achieved -- order_index values (1-3) completed.
    challenges_completed: list[int] = Field(default_factory=list)
    completed_at: datetime | None = None
    # False until a guest scans/enters this character's QR code
    # (hunt_progress.unlocked_at is not null) -- gates challenge access.
    unlocked: bool = False
    # Coins awarded by the action that produced this response (only ever
    # non-zero from complete_challenge() -- 15 when this call completed the
    # character, +25 more if it was also the 5th/last character in the hunt.
    # list_characters()/get_character()/unlock_character() leave this at 0.
    coins_awarded: int = Field(default=0, ge=0)


class EncyclopediaStatus(StrEnum):
    PLACEHOLDER = "placeholder"
    PUBLISHED = "published"


class EncyclopediaEntry(BaseModel):
    """Minimal stub -- just enough to be a real scan target with a "Coming
    soon" page. The full card-based Encyclopedia (Plan.md 2.5/5) is later."""

    id: UUID
    animal_name: str
    status: EncyclopediaStatus = EncyclopediaStatus.PLACEHOLDER


class ScanResultType(StrEnum):
    HUNT_CHARACTER = "hunt_character"
    ENCYCLOPEDIA_ENTRY = "encyclopedia_entry"


class ScanResult(BaseModel):
    type: ScanResultType
    target: HuntCharacter | EncyclopediaEntry


class StaffRequestType(StrEnum):
    QUESTION = "question"
    EMERGENCY = "emergency"


class StaffRequestStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class StaffRequest(BaseModel):
    id: UUID
    type: StaffRequestType
    location_node_id: UUID | None = None
    # Denormalized from map_nodes so the staff view can render a location
    # name without a second round trip -- same embedding pattern as
    # BingoTile/LinkedTile.
    location_name: str | None = None
    # Both optional -- a guest can always submit with just a type and
    # nothing else (see CreateStaffRequestRequest below).
    name: str | None = None
    description: str | None = None
    status: StaffRequestStatus = StaffRequestStatus.OPEN
    created_at: datetime
    resolved_at: datetime | None = None


class CreateStaffRequestRequest(BaseModel):
    type: StaffRequestType
    location_node_id: UUID | None = None
    name: str | None = None
    # Capped so it stays a brief note, not a wall of text -- matches
    # staff_requests_description_length_check in migration 020. Rejects
    # (422) rather than truncating if the frontend's own cap is bypassed.
    description: str | None = Field(default=None, max_length=500)


class CoinSourceType(StrEnum):
    SCAVENGER_HUNT = "scavenger_hunt"
    PUZZLE_TIMER = "puzzle_timer"
    SCORING_SHEET_WIN = "scoring_sheet_win"
    BINGO_MILESTONE = "bingo_milestone"
    HUNT_COMPLETE = "hunt_complete"
    MAP_EXPLORATION = "map_exploration"


class CoinAward(BaseModel):
    id: UUID
    source_type: CoinSourceType
    source_id: UUID
    amount: int = Field(gt=0)
    created_at: datetime


class Collectible(BaseModel):
    id: UUID
    name: str
    icon: str
    unlock_threshold: int = Field(gt=0)
    # Computed at read time (total >= unlock_threshold), never stored -- see
    # app/services/coins.py -- so it can't drift out of sync with the ledger.
    unlocked: bool = False


class CoinsSummary(BaseModel):
    total: int = Field(ge=0)
    collectibles: list[Collectible] = Field(default_factory=list)


class PhotoStatus(StrEnum):
    PENDING_REVIEW = "pending_review"
    SHORTLISTED = "shortlisted"
    REJECTED = "rejected"


class PhotoSubmission(BaseModel):
    id: UUID
    guest_label: str | None = None
    # Derived from storage_path via the Storage API at read time, never
    # stored -- see app/services/photos.py.
    photo_url: str
    submitted_at: datetime
    status: PhotoStatus = PhotoStatus.PENDING_REVIEW
    # Only meaningful once shortlisted -- 0/false on pending_review/rejected rows.
    vote_count: int = 0
    voted_by_me: bool = False


class Announcement(BaseModel):
    id: UUID
    text: str
    created_at: datetime
    updated_at: datetime


class CreateAnnouncementRequest(BaseModel):
    text: str = Field(min_length=1)


class UpdateAnnouncementRequest(BaseModel):
    text: str = Field(min_length=1)


class StaffLoginRequest(BaseModel):
    password: str = Field(min_length=1)


class StaffLoginResponse(BaseModel):
    token: str


class CreateVoteRequest(BaseModel):
    voter_session_id: str = Field(min_length=1)


class PassportStats(BaseModel):
    """Snapshot of cross-feature progress at the moment a passport was generated.

    Totals are included alongside each numerator (not just the fixed "out of
    5"/"out of 25" the guest sees today) so a frozen snapshot stays
    self-describing even if the seeded content those numbers are drawn from
    changes later -- see app/services/passport.py.
    """

    scavenger_hunt_characters_completed: int = Field(ge=0)
    scavenger_hunt_characters_total: int = Field(gt=0)
    bingo_tiles_completed: int = Field(ge=0)
    bingo_tiles_total: int = Field(gt=0)
    bingo_milestones: MilestonesAchieved
    scoring_sheet_games_won: int = Field(ge=0)
    puzzle_challenges_completed: int = Field(ge=0)
    total_cobb_coins: int = Field(ge=0)
    # Auto-generated from whichever category the family is strongest in --
    # see app/services/passport.py's _pick_title for the thresholds/logic.
    title: str


class ResetSessionResult(BaseModel):
    """Result of the guest-facing "Reset Session" action (nav dropdown).

    Narrower than backend/scripts/reset_demo_data.py's dev-only reset: this
    clears Bingo tile completion/milestones, Map node visited state,
    Scavenger Hunt challenge progress, and the entire Cobb Coins ledger --
    puzzle attempts, photos, and passports are left untouched (note that
    puzzle/scoring-sheet *completion* state itself isn't reset, only the
    coins tied to it, since coin_awards is cleared wholesale regardless of
    source_type).
    """

    bingo_tiles_reset: int = Field(ge=0)
    map_nodes_reset: int = Field(ge=0)
    hunt_characters_reset: int = Field(ge=0)
    coins_reset: int = Field(ge=0)


class PassportSession(BaseModel):
    id: UUID
    family_label: str
    # Derived from photo_storage_path via the Storage API at read time, never
    # stored -- same pattern as PhotoSubmission.photo_url. Null when the
    # guest skipped the optional group photo.
    photo_url: str | None = None
    generated_at: datetime
    stats: PassportStats
