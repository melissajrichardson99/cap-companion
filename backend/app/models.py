"""Pydantic models mirroring the data models in CAP_Companion_App_TechSpec.md section 3."""

from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class NodeCategory(StrEnum):
    ATTRACTION = "attraction"
    ANIMAL = "animal"
    SERVICE = "service"
    FOOD = "food"
    SEASONAL = "seasonal"


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
    # Per-Device Sessions Phase 3: the calling session's own visit progress
    # (node_visits, resolved via the request's X-Device-Session header),
    # not a global flag. Replaces the old global `state` column.
    visited: bool = False
    # Staff-managed operational status, independent of `visited` above (which
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
    # The calling device's own completion status (Per-Device Sessions Phase
    # 6a, session_tile_completions), resolved server-side from the
    # X-Device-Session header -- not global. row/col/label/linked_map_node_id
    # above are the shared layout, still the same for every guest.
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
    # Computed live per calling device from session_tile_completions (Per-
    # Device Sessions Phase 6a) -- not a stored flag, so two families never
    # see each other's milestone progress on this same shared card.
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
    # QR-routable identifier for /puzzles/:challengeSlug -- derived from
    # `puzzle name + label` (migration 032), not label alone, since label is
    # only unique per-puzzle and several repeat verbatim across puzzles.
    slug: str
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
    # QR-routable identifier for /scoring/:gameSlug (migration 032).
    slug: str
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


class HuntCharacterScanCode(BaseModel):
    """Staff-only: a Hunt character paired with its scannable_codes.code, for
    the Staff Page's QR Code Directory. HuntCharacter itself (guest-facing)
    deliberately doesn't carry this -- see hunt_service.list_character_scan_codes."""

    id: UUID
    name: str
    code: str


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


class ManualEntryMatchType(StrEnum):
    """Which of the four QR-routable destinations a manually-typed sign
    code/name resolved to -- lets ScanEntryModal's single input route to
    /scan/:code, /animals/:slug, /scoring/:gameSlug, or /puzzles/:challengeSlug
    without the guest picking a type up front."""

    SCAN = "scan"
    ANIMAL = "animal"
    SCORING_GAME = "scoring"
    PUZZLE_CHALLENGE = "puzzle"


class ManualEntryResolution(BaseModel):
    type: ManualEntryMatchType
    slug: str


class StaffRequestType(StrEnum):
    QUESTION = "question"
    EMERGENCY = "emergency"


class StaffRequestStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    CANCELLED = "cancelled"


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
    # Self-reported staff display name (see app/staff_auth.py's
    # get_staff_name), attached at the moment of the acknowledge/resolve
    # transition -- null if that staff member hadn't set a name yet.
    acknowledged_by: str | None = None
    resolved_by: str | None = None


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


class CoinsSummary(BaseModel):
    total: int = Field(ge=0)


class CollectibleTier(StrEnum):
    STANDARD = "standard"
    SPECIAL = "special"


class CollectibleCatalogEntry(BaseModel):
    """One purchasable animal in the Card Shop -- price/tier are backend-owned
    (see app/services/collectibles.py) so the frontend never hardcodes them."""

    animal_slug: str
    tier: CollectibleTier
    price: int = Field(gt=0)


class CollectibleCard(BaseModel):
    """A single purchase from collectible_redemptions -- doubles as both the
    spend-ledger entry and a gallery item (see app/services/collectibles.py)."""

    id: UUID
    animal_slug: str
    tier: CollectibleTier
    # Which of the animal's curated photo pool slots (1-based) this purchase
    # rolled -- the frontend resolves the actual image via animalContent.ts's
    # imageCandidates(), same convention as Our Animals.
    photo_index: int = Field(gt=0)
    guest_name: str
    coins_spent: int = Field(gt=0)
    created_at: datetime


class PurchaseCollectibleRequest(BaseModel):
    animal_slug: str
    guest_name: str = Field(min_length=1, max_length=60)

    @field_validator("guest_name")
    @classmethod
    def _guest_name_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("guest_name cannot be blank")
        return stripped


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


class AnimalPhoto(BaseModel):
    id: UUID
    animal_slug: str
    # Derived from storage_path via the Storage API at read time, never
    # stored -- same discipline as PhotoSubmission.photo_url above.
    photo_url: str
    display_order: int


class ReorderAnimalPhotosRequest(BaseModel):
    photo_ids: list[UUID]


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
    clears this device's Bingo tile completion/milestones (Phase 6a), this
    device's Map node visited status (Phase 3), this device's Scavenger Hunt
    found/unlocked and challenge-completion progress (Phase 6b, the final
    phase of the Per-Device Sessions migration), the entire Cobb Coins earn
    ledger, every purchased Collectible Card, this device's Puzzle Timer
    attempts, this device's Scoring Sheet sessions, and this device's
    Favorite Photo vote(s) (Phase 5) -- photo submissions/gallery and
    passports are left untouched. Every field here is now genuinely scoped
    to the calling device only -- see app/services/session_reset.py's
    docstring for the full per-table picture.
    """

    bingo_tiles_reset: int = Field(ge=0)
    map_nodes_reset: int = Field(ge=0)
    hunt_characters_reset: int = Field(ge=0)
    coins_reset: int = Field(ge=0)
    collectible_cards_reset: int = Field(ge=0)
    puzzle_attempts_reset: int = Field(ge=0)
    scoring_sessions_reset: int = Field(ge=0)
    photo_votes_reset: int = Field(ge=0)
    # Guest Accounts Phase 1: true when the calling device session was linked
    # to a guest account, in which case this reset also logged them out on
    # this device (see app/services/session_reset.py's docstring) -- always
    # false for an anonymous session. coins_reset/collectible_cards_reset are
    # deliberately 0 in that case (their rows are preserved, not deleted) --
    # bingo_tiles_reset/map_nodes_reset join that same exception as of Guest
    # Accounts Phase 3 -- which is why the frontend needs this flag rather
    # than inferring the logout from those counts.
    guest_logged_out: bool = False


class PassportSession(BaseModel):
    id: UUID
    family_label: str
    # Derived from photo_storage_path via the Storage API at read time, never
    # stored -- same pattern as PhotoSubmission.photo_url. Null when the
    # guest skipped the optional group photo.
    photo_url: str | None = None
    generated_at: datetime
    stats: PassportStats


_EMAIL_RE = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class Guest(BaseModel):
    """Guest Accounts Phase 0 -- see app/guest_auth.py.

    Deliberately excludes password_hash (never sent to the client) and
    guest_auth_tokens/password_reset_tokens rows (internal to the service
    layer) -- same "don't echo back what the caller doesn't need" discipline
    as DeviceSession excluding device_token.
    """

    id: UUID
    email: str
    created_at: datetime


class GuestAuthResult(BaseModel):
    """Returned by signup and login -- the new/refreshed auth token plus the
    guest it belongs to, so the frontend can store both in one round trip."""

    token: str
    guest: Guest


class GuestSignupRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    # Matches app/guest_auth.py's MIN_PASSWORD_LENGTH -- kept in sync there,
    # not duplicated as a constant here, since the service layer is what
    # actually enforces it (this is just the earliest, cheapest rejection).
    password: str = Field(min_length=8, max_length=200)

    @field_validator("email")
    @classmethod
    def _email_looks_valid(cls, value: str) -> str:
        stripped = value.strip()
        if not re.match(_EMAIL_RE, stripped):
            raise ValueError("must be a valid email address")
        return stripped


class GuestLoginRequest(BaseModel):
    email: str = Field(min_length=1)
    password: str = Field(min_length=1)


class PasswordResetRequestRequest(BaseModel):
    email: str = Field(min_length=1)


class PasswordResetConfirmRequest(BaseModel):
    token: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=200)


class GenericMessageResponse(BaseModel):
    message: str


class DeviceSession(BaseModel):
    """Per-Device Sessions Phase 0 -- see app/device_session.py.

    Deliberately excludes device_token from the response: the caller already
    knows its own token (it's the one it sent), so there's no reason to echo
    it back.
    """

    id: UUID
    created_at: datetime
    last_active_at: datetime


class GuestBingoMapStatus(BaseModel):
    """Guest Accounts Phase 3 -- backs GET /account/bingo-map/status, called
    right after login so the frontend can decide whether to show the
    "Welcome back" continue-or-start-fresh prompt at all (only when
    has_progress is true) and, if so, what summary numbers to show alongside
    it. tiles_completed/nodes_visited are computed across every device
    session ever linked to the guest (app/device_session.py's
    list_guest_session_ids), same join as Coins/Collectibles' lifetime
    totals -- see app/services/map_bingo.py's get_guest_bingo_map_status.
    """

    has_progress: bool
    tiles_completed: int = Field(ge=0)
    tiles_total: int = Field(ge=0)
    nodes_visited: int = Field(ge=0)


class BingoMapStartFreshResult(BaseModel):
    """Guest Accounts Phase 3 -- result of the explicit, guest-initiated
    POST /account/bingo-map/start-fresh action: deletes the guest's
    accumulated session_tile_completions/node_visits rows across every
    device session ever linked to them. Never triggered automatically and
    never bundled into Reset Session -- see app/services/map_bingo.py's
    start_fresh_bingo_map.
    """

    bingo_tiles_reset: int = Field(ge=0)
    map_nodes_reset: int = Field(ge=0)


# ---------------------------------------------------------------------------
# Staff Page Analytics dashboard -- see app/services/analytics.py for the
# date-range convention and the reasoning behind every ambiguous-metric
# choice referenced in these fields' docstrings.
# ---------------------------------------------------------------------------


class UsersOverTimePoint(BaseModel):
    date: str  # YYYY-MM-DD
    count: int = Field(ge=0)


class DailyRatePoint(BaseModel):
    date: str  # YYYY-MM-DD
    pct: float = Field(ge=0, le=100)


class AnalyticsOverview(BaseModel):
    total_users: int = Field(ge=0)
    users_over_time: list[UsersOverTimePoint]


class AnalyticsCoins(BaseModel):
    total_coins_earned: int = Field(ge=0)
    # Denominator is every app user in range, not just users who earned a
    # coin -- see analytics.py.
    avg_coins_per_user: float = Field(ge=0)


class HuntCharacterFoundRate(BaseModel):
    character_id: UUID
    name: str
    # Of every app user in range (not just users who engaged with the hunt at
    # all), the percentage whose hunt_progress.unlocked_at is set for this
    # character.
    found_pct: float = Field(ge=0, le=100)


class AnalyticsScavengerHunt(BaseModel):
    # Average, across app users in range, of (characters unlocked / total
    # characters) -- partial-progress average, not "% of users who fully
    # finished" (that stricter number lives in
    # AnalyticsEngagement.full_completionist_rate_pct instead). See
    # analytics.py for why this definition was chosen.
    avg_completion_rate_pct: float = Field(ge=0, le=100)
    character_found_rates: list[HuntCharacterFoundRate]


class AnalyticsBingo(BaseModel):
    # Raw count of tiles completed within the window (session_tile_completions
    # rows), averaged across app users in range -- not a percentage of the
    # 25-tile board.
    avg_tiles_completed: float = Field(ge=0)
    # Count of achieved milestone tiers (lines + X + blackout, per
    # milestone.py's achieved_milestones) averaged across app users in range.
    avg_milestones_per_session: float = Field(ge=0)


class MapNodeVisitRank(BaseModel):
    node_id: UUID
    name: str
    visits: int = Field(ge=0)


class AnalyticsMapExploration(BaseModel):
    avg_nodes_visited_per_session: float = Field(ge=0)
    # Sorted descending by visits -- the frontend slices the head/tail for
    # "most"/"least" visited without a second request.
    node_rankings: list[MapNodeVisitRank]


class AnimalPurchaseRank(BaseModel):
    animal_slug: str
    count: int = Field(ge=0)


class AnalyticsCollectibles(BaseModel):
    # Sorted descending by count.
    most_purchased: list[AnimalPurchaseRank]


class AnalyticsPuzzleScoring(BaseModel):
    # puzzle_attempts rows are only ever written after a successful solve
    # (app/services/puzzles.py::record_attempt) -- there's no "attempted but
    # not solved" event captured anywhere in the schema, so unlike Scoring
    # Sheet there's only one honest number to report here. See analytics.py.
    puzzle_timer_solves: int = Field(ge=0)
    scoring_sheet_attempts: int = Field(ge=0)
    scoring_sheet_completions: int = Field(ge=0)


class AnalyticsPhotosPassport(BaseModel):
    photos_submitted: int = Field(ge=0)
    pct_sessions_voting: float = Field(ge=0, le=100)
    passports_generated: int = Field(ge=0)


class AnalyticsEngagement(BaseModel):
    full_completionist_rate_pct: float = Field(ge=0, le=100)
    full_completionist_trend: list[DailyRatePoint]


class AnalyticsStaffOps(BaseModel):
    total_requests: int = Field(ge=0)
    general_count: int = Field(ge=0)
    emergency_count: int = Field(ge=0)


class AnalyticsSummary(BaseModel):
    range_start: str  # YYYY-MM-DD
    range_end: str
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
