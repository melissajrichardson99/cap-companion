"""Orchestration for the map/bingo endpoints.

Wires the pure logic in milestone.py and minigame_draw.py up to Supabase,
and implements the map-node visit / bingo interconnectivity flow from tech
spec section 4.3. This is the only layer that talks to the database — the
milestone math and the random draw stay pure and independently testable.

Guest Accounts Phase 3 (bingo_map_reset_at column, no other schema change):
list_map_nodes/get_bingo_card/complete_tile/visit_node/
_check_map_exploration_bonus all take an optional guest_id now, same
"span every linked session when given, else current-session-only" fork as
app/services/coins.py's get_total -- see _resolve_session_ids. Writes are
unaffected everywhere: a completion/visit is always tagged to the actual
calling session_id, exactly as before. get_guest_bingo_map_status and
start_fresh_bingo_map back the two new guest-only /account/bingo-map
endpoints (app/routers/account.py); session_reset.py's reset_session
preserves this data for a linked guest the same way it already does for
Coins/Collectibles.
"""

from __future__ import annotations

import random
from datetime import datetime, timezone
from uuid import UUID

from app.device_session import list_guest_session_ids
from app.errors import NotFoundError
from app.models import (
    BingoCard,
    BingoCardSummary,
    BingoMapStartFreshResult,
    BingoTile,
    ChildNode,
    CoinSourceType,
    GuestBingoMapStatus,
    LinkedTile,
    MapNode,
    MilestoneEvent,
    MilestonesAchieved,
    Minigame,
    TileCompletionResult,
    VisitNodeResponse,
)
from app.services import coins as coins_service
from app.services import milestone as milestone_service
from app.services import minigame_draw as draw_service
from app.supabase_client import get_supabase_client

CURRENT_MINIGAME_PHASE = 2  # All 10 minigames shipped (Phase 1 + Phase 2, per 4.1).

# Process-local "last played" pointer for the optional back-to-back-repeat
# guard in 4.1. A POC-scale single-process concern; would move to per-card
# state if this ever needs to run behind multiple workers.
_last_played_minigame_id: UUID | None = None


def _row_to_map_node(
    row: dict,
    linked_tiles: list[LinkedTile],
    children: list[ChildNode] | None = None,
    visited: bool = False,
) -> MapNode:
    return MapNode(
        id=row["id"],
        name=row["name"],
        category=row["category"],
        description=row["description"],
        visited=visited,
        is_open=row["is_open"],
        linked_tiles=linked_tiles,
        x_pct=row["x_pct"],
        y_pct=row["y_pct"],
        parent_node_id=row["parent_node_id"],
        children=children or [],
    )


def _row_to_bingo_tile(row: dict, completed_at: str | None) -> BingoTile:
    # completed_at is looked up separately (session_tile_completions, Per-
    # Device Sessions Phase 6a) rather than read off `row` -- bingo_tiles
    # itself carries only the shared layout now, not per-guest completion.
    return BingoTile(
        id=row["id"],
        card_id=row["card_id"],
        row=row["row_index"],
        col=row["col_index"],
        label=row["label"],
        linked_map_node_id=row["linked_map_node_id"],
        completed=completed_at is not None,
        completed_at=completed_at,
    )


def _resolve_session_ids(session_id: UUID, guest_id: UUID | None) -> list[str]:
    """Guest Accounts Phase 3: the set of session_ids a guest-aware read
    should span -- every device session ever linked to the guest
    (app/device_session.py's list_guest_session_ids) when guest_id is given,
    or just the calling session otherwise. Same fork as app/services/
    coins.py's get_total/app/services/collectibles.py's list_cards, applied
    here to Bingo tile completions and Map node visits.
    """
    return list_guest_session_ids(guest_id) if guest_id is not None else [str(session_id)]


def _session_tile_completions(client, session_ids: list[str], tile_ids: list[str] | None = None) -> dict[str, str]:
    """tile_id -> completed_at across the given session_ids (Per-Device
    Sessions Phase 6a; guest-wide as of Guest Accounts Phase 3 -- see
    _resolve_session_ids).

    Single source of truth for "has this session completed this tile" --
    every read site (card view, map-node linked-tile status, milestone
    detection) goes through this instead of a stored bingo_tiles.completed
    column, which no longer exists. When two of a guest's linked sessions
    both completed the same tile, the later completed_at simply wins --
    only ever used for a boolean "is it completed" check downstream, so
    which of the two timestamps shows through doesn't matter.
    """
    if not session_ids:
        return {}
    query = (
        client.table("session_tile_completions")
        .select("tile_id,completed_at")
        .in_("session_id", session_ids)
    )
    if tile_ids is not None:
        query = query.in_("tile_id", tile_ids)
    rows = query.execute().data
    return {r["tile_id"]: r["completed_at"] for r in rows}


def list_map_nodes(session_id: UUID, guest_id: UUID | None = None) -> list[MapNode]:
    """List every map node, with `visited` resolved per the calling session
    (or, as of Guest Accounts Phase 3, across every session linked to the
    calling guest -- see _resolve_session_ids).

    session_id is the resolved device session (Per-Device Sessions Phase 3)
    -- visited-status is looked up in node_visits scoped to this session (or
    guest), not globally, so two guests viewing the same node see their own
    independent progress.
    """
    client = get_supabase_client()
    session_ids = _resolve_session_ids(session_id, guest_id)
    nodes = client.table("map_nodes").select("*").execute().data
    all_tiles = client.table("bingo_tiles").select("id,label,linked_map_node_id").execute().data
    visited_rows = (
        client.table("node_visits").select("node_id").in_("session_id", session_ids).execute().data
        if session_ids
        else []
    )
    visited_node_ids = {r["node_id"] for r in visited_rows}
    # Per-Device Sessions Phase 6a: a tile's completed status for this popup
    # flow is this session's (or guest's) own session_tile_completions rows,
    # not a global bingo_tiles.completed column (which no longer exists).
    completed_tile_ids = set(_session_tile_completions(client, session_ids))

    tiles_by_node: dict[str, list[LinkedTile]] = {}
    for t in all_tiles:
        node_id = t["linked_map_node_id"]
        if node_id is None:
            continue
        tiles_by_node.setdefault(node_id, []).append(
            LinkedTile(id=t["id"], label=t["label"], completed=t["id"] in completed_tile_ids)
        )

    children_by_parent: dict[str, list[dict]] = {}
    for n in nodes:
        parent_id = n["parent_node_id"]
        if parent_id is not None:
            children_by_parent.setdefault(parent_id, []).append(n)
    for child_rows in children_by_parent.values():
        child_rows.sort(key=lambda c: c["name"])

    result = []
    for n in nodes:
        child_rows = children_by_parent.get(n["id"], [])
        # A parent's "linked tiles" for the sequential visit-confirmation
        # flow (4.3) include its children's linked tiles too — the games
        # under Arcade Pad/Ground Games each link their own bingo tile, but
        # only the parent renders a pin/popup to walk through them from.
        linked_tiles = list(tiles_by_node.get(n["id"], []))
        for child in child_rows:
            linked_tiles.extend(tiles_by_node.get(child["id"], []))
        children = [ChildNode(id=c["id"], name=c["name"]) for c in child_rows]
        result.append(_row_to_map_node(n, linked_tiles, children, visited=n["id"] in visited_node_ids))

    return result


def list_bingo_cards() -> list[BingoCardSummary]:
    client = get_supabase_client()
    rows = client.table("bingo_cards").select("id,owner_label").order("created_at").execute().data
    return [BingoCardSummary(id=r["id"], owner_label=r["owner_label"]) for r in rows]


def get_bingo_card(card_id: UUID, session_id: UUID, guest_id: UUID | None = None) -> BingoCard:
    """The shared card layout with this session's (or guest's, Phase 3) own
    completion/milestone status.

    session_id (Per-Device Sessions Phase 6a) resolves both the per-tile
    `completed` flags and milestones_achieved from session_tile_completions
    -- two families viewing the same card see their own independent progress
    on it, same as MapNode.visited since Phase 3. guest_id, when given,
    widens that to every session linked to the guest (_resolve_session_ids)
    -- a returning guest sees their carried-forward progress automatically.
    """
    client = get_supabase_client()
    session_ids = _resolve_session_ids(session_id, guest_id)
    card_rows = client.table("bingo_cards").select("*").eq("id", str(card_id)).execute().data
    if not card_rows:
        raise NotFoundError(f"Bingo card {card_id} not found")
    card_row = card_rows[0]

    tile_rows = (
        client.table("bingo_tiles")
        .select("*")
        .eq("card_id", str(card_id))
        .order("row_index")
        .order("col_index")
        .execute()
        .data
    )
    completions = _session_tile_completions(client, session_ids, [r["id"] for r in tile_rows])
    completed_indices = {
        r["row_index"] * 5 + r["col_index"] for r in tile_rows if r["id"] in completions
    }
    lines, x, blackout = milestone_service.achieved_milestones(completed_indices)

    return BingoCard(
        id=card_row["id"],
        owner_label=card_row["owner_label"],
        tiles=[_row_to_bingo_tile(r, completions.get(r["id"])) for r in tile_rows],
        milestones_achieved=MilestonesAchieved(lines=sorted(lines), x=x, blackout=blackout),
    )


def _minigame_pool() -> list[Minigame]:
    # Cumulative, not exact-match: per tech spec 4.1 the pool "grows to 10
    # once Phase 2 ships" — it's every game shipped so far, not just the
    # games belonging to the current phase number.
    client = get_supabase_client()
    rows = client.table("minigames").select("*").lte("phase", CURRENT_MINIGAME_PHASE).execute().data
    if not rows:
        raise RuntimeError("No minigames available in the current phase pool.")
    return [Minigame(**r) for r in rows]


def list_minigames() -> list[Minigame]:
    """Every minigame currently in the live draw pool.

    Public wrapper around _minigame_pool() -- also used by GET /bingo/minigames,
    which the Scavenger Hunt frontend calls to resolve a character's
    minigame_slug to the full Minigame row MinigameOverlay needs.
    """
    return _minigame_pool()


def complete_tile(tile_id: UUID, session_id: UUID, guest_id: UUID | None = None) -> TileCompletionResult:
    """Mark one bingo tile completed *for this session* and run everything it
    triggers (4.1 + 4.2, now per-device -- Per-Device Sessions Phase 6a).

    Shared by POST /bingo/tiles/{id}/complete and the map-node visit flow so
    both paths run identical milestone-detection and minigame-draw logic --
    the map is just a second entry point into the same tile completion, not
    a separate implementation of it.

    session_id now scopes the completion write itself (session_tile_
    completions), not just the coin-award attribution Phase 1 originally
    added it for -- two families completing tiles on the same shared layout
    get fully independent completion/milestone state and bonus-minigame
    triggers, each computed from that session's own completed-tile set only.

    guest_id (Guest Accounts Phase 3): when given, the *read* side (prior
    completions/milestones already achieved) spans every session linked to
    the guest via _resolve_session_ids -- so a milestone already achieved on
    one of the guest's other devices/visits is correctly recognized as
    "already achieved" here too, and isn't re-paid. The write (the new
    completion row itself) is still always tagged to this one calling
    session_id, same as every other guest-aware write in this app.
    """
    global _last_played_minigame_id
    client = get_supabase_client()
    session_ids = _resolve_session_ids(session_id, guest_id)

    tile_rows = client.table("bingo_tiles").select("*").eq("id", str(tile_id)).execute().data
    if not tile_rows:
        raise NotFoundError(f"Bingo tile {tile_id} not found")
    tile_row = tile_rows[0]

    all_tiles = (
        client.table("bingo_tiles")
        .select("id,row_index,col_index")
        .eq("card_id", tile_row["card_id"])
        .execute()
        .data
    )
    index_to_tile_id = {r["row_index"] * 5 + r["col_index"]: r["id"] for r in all_tiles}
    prior_completions = _session_tile_completions(client, session_ids, [r["id"] for r in all_tiles])
    prior_indices = {
        r["row_index"] * 5 + r["col_index"] for r in all_tiles if r["id"] in prior_completions
    }

    if str(tile_id) in prior_completions:
        # Already complete for this session: re-completing must not re-fire
        # milestones or re-draw minigames. Symmetric with 4.1's rule that
        # minigame outcome never feeds back into completion state --
        # completion is a one-way trigger.
        tile = _row_to_bingo_tile(tile_row, prior_completions[str(tile_id)])
        lines, x, blackout = milestone_service.achieved_milestones(prior_indices)
        return TileCompletionResult(
            tile=tile,
            milestones=[],
            minigames_drawn=[],
            card_milestones_achieved=MilestonesAchieved(lines=sorted(lines), x=x, blackout=blackout),
        )

    # achieved_* reflects this session's own state *before* this completion --
    # exactly what detect_new_milestones needs to tell "already achieved"
    # apart from "newly achieved by this tile".
    achieved_lines, achieved_x, achieved_blackout = milestone_service.achieved_milestones(prior_indices)

    completion_row = (
        client.table("session_tile_completions")
        .insert({"session_id": str(session_id), "tile_id": str(tile_id)})
        .execute()
        .data[0]
    )
    tile = _row_to_bingo_tile(tile_row, completion_row["completed_at"])
    completed_indices = prior_indices | {tile.index}

    hits = milestone_service.detect_new_milestones(
        completed_indices,
        achieved_lines=achieved_lines,
        achieved_x=achieved_x,
        achieved_blackout=achieved_blackout,
    )

    # Only the single highest-priority hit is ever reported to the frontend
    # for animation -- the bonus-minigame draw below still triggers off
    # `hits` in full, regardless of which one (if any) is shown. Bingo coins
    # are derived from this same display_hit (not from `hits`), so a
    # completion that satisfies multiple tiers at once pays only the
    # highest tier -- always in agreement with what the banner shows.
    display_hit = milestone_service.select_display_milestone(hits)
    coins_awarded = coins_service.bingo_milestone_amount(display_hit.type) if display_hit else 0
    if display_hit:
        coins_service.award_coins(CoinSourceType.BINGO_MILESTONE, tile.id, coins_awarded, session_id)
    milestone_events = (
        [
            MilestoneEvent(
                type=display_hit.type,
                message=display_hit.message,
                tile_ids=[index_to_tile_id[i] for i in display_hit.tile_indices],
                coins_awarded=coins_awarded,
            )
        ]
        if display_hit
        else []
    )

    new_lines, new_x, new_blackout = milestone_service.achieved_milestones(completed_indices)

    pool = _minigame_pool()
    rng = random.Random()
    drawn = draw_service.draw_for_tile_completion(
        pool,
        rng,
        milestone_triggered=bool(hits),
        last_played_id=_last_played_minigame_id,
        id_fn=lambda m: m.id,
    )
    _last_played_minigame_id = drawn[-1].id

    return TileCompletionResult(
        tile=tile,
        milestones=milestone_events,
        minigames_drawn=drawn,
        card_milestones_achieved=MilestonesAchieved(lines=sorted(new_lines), x=new_x, blackout=new_blackout),
        coins_awarded=coins_awarded,
    )


def _guest_bingo_map_reset_at(client, guest_id: UUID) -> str | None:
    """Guest Accounts Phase 3: the timestamp of this guest's last explicit
    Start Fresh action (start_fresh_bingo_map below), or None if they've
    never done one. Consulted only by _check_map_exploration_bonus's
    already-awarded guard -- see that function's docstring for why a plain
    "does an award exist" check isn't enough for a guest.
    """
    rows = client.table("guests").select("bingo_map_reset_at").eq("id", str(guest_id)).execute().data
    return rows[0]["bingo_map_reset_at"] if rows else None


def _check_map_exploration_bonus(client, node_id: UUID, session_id: UUID, guest_id: UUID | None = None) -> int:
    """Award the one-time 50-coin Map Exploration bonus once the calling
    session (or, as of Guest Accounts Phase 3, the calling guest across
    every linked session) has visited every currently-open top-level node.

    Scoped to parent_node_id IS NULL: children (the Arcade Pad/Ground Games
    sub-nodes) render no pin/card of their own in MapScreen.tsx and are never
    visited directly through any code path, so including them here would
    make the bonus permanently unreachable by default. Closed nodes
    (is_open false) don't count, and the `top_level_open_ids` guard below
    avoids vacuously awarding when every top-level node is closed.

    Per-Device Sessions Phase 3: both halves of this check -- the
    completeness condition (node_visits) and the already-awarded guard
    (coin_awards) -- are now scoped to session_id, closing the bounded gap
    Phase 1 documented (a session that had visited nothing could collect
    this bonus if another concurrent session had already finished exploring
    the map, since the completeness condition was still global then). A
    session that has visited nothing itself can no longer receive this
    bonus no matter what any other session has done.

    Guest Accounts Phase 3: guest_id, when given, widens both halves to
    every session linked to the guest (_resolve_session_ids), same as
    Bingo's completion checks. The already-awarded guard needs one extra
    wrinkle for a guest that Bingo's milestone guard doesn't: unlike
    achieved_milestones (derived live from session_tile_completions, which
    Start Fresh genuinely deletes), this guard checks coin_awards directly,
    and coin_awards is an append-only ledger that Start Fresh never deletes
    from (see start_fresh_bingo_map/session_reset.py) -- deleting a guest's
    own earn history there would both violate that ledger's append-only
    invariant and claw back coins they already spent/kept. So the guard
    additionally requires the award to have landed after the guest's last
    Start Fresh (guests.bingo_map_reset_at, set by start_fresh_bingo_map) --
    that column is what actually makes the bonus re-earnable post-Start-
    Fresh, not the node_visits delete alone.
    """
    session_ids = _resolve_session_ids(session_id, guest_id)
    all_nodes = client.table("map_nodes").select("id,is_open,parent_node_id").execute().data
    top_level_open_ids = {n["id"] for n in all_nodes if n["is_open"] and n["parent_node_id"] is None}
    if not top_level_open_ids:
        return 0

    visited_rows = (
        client.table("node_visits")
        .select("node_id")
        .in_("session_id", session_ids)
        .in_("node_id", list(top_level_open_ids))
        .execute()
        .data
        if session_ids
        else []
    )
    visited_node_ids = {r["node_id"] for r in visited_rows}
    if not top_level_open_ids <= visited_node_ids:
        return 0

    already_awarded_query = (
        client.table("coin_awards")
        .select("id")
        .eq("source_type", CoinSourceType.MAP_EXPLORATION.value)
        .in_("session_id", session_ids)
    )
    if guest_id is not None:
        reset_at = _guest_bingo_map_reset_at(client, guest_id)
        if reset_at is not None:
            already_awarded_query = already_awarded_query.gte("created_at", reset_at)
    already_awarded = already_awarded_query.execute().data
    if already_awarded:
        return 0

    coins_service.award_coins(
        CoinSourceType.MAP_EXPLORATION, node_id, coins_service.MAP_EXPLORATION_AMOUNT, session_id
    )
    return coins_service.MAP_EXPLORATION_AMOUNT


def visit_node(
    node_id: UUID, completed_tile_ids: list[UUID], session_id: UUID, guest_id: UUID | None = None
) -> VisitNodeResponse:
    """Mark a node visited, completing any confirmed linked tiles first (4.3).

    completed_tile_ids are the tiles the guest answered "Yes" to on the
    sequential per-tile Yes/No popups the frontend drives off the
    linked_tiles list returned by GET /map/nodes — one popup per uncompleted
    linked tile, so none get silently skipped. Each confirmed tile is run
    through complete_tile (triggering 4.1/4.2) before the node itself flips
    to visited; answering "No" for a tile simply means its id is omitted.

    session_id attributes any coin awards (tile milestones, the Map
    Exploration bonus) to the calling device, and (Per-Device Sessions
    Phase 3) is also the session whose visited-status actually gets written
    -- node visit state is per-device now, not global. guest_id (Guest
    Accounts Phase 3) widens every *read* this triggers (prior tile
    completions, the exploration-bonus completeness/already-awarded checks)
    to the guest's full linked-session set -- see complete_tile and
    _check_map_exploration_bonus.
    """
    client = get_supabase_client()
    session_ids = _resolve_session_ids(session_id, guest_id)

    node_rows = client.table("map_nodes").select("*").eq("id", str(node_id)).execute().data
    if not node_rows:
        raise NotFoundError(f"Map node {node_id} not found")
    node_row = node_rows[0]

    child_rows = (
        client.table("map_nodes")
        .select("id,name")
        .eq("parent_node_id", str(node_id))
        .order("name")
        .execute()
        .data
    )
    # A parent's linked tiles include its children's tiles too, so confirming
    # them here must recognize child-linked tile ids, not just the node's own.
    relevant_node_ids = [str(node_id)] + [c["id"] for c in child_rows]

    linked_tile_rows = (
        client.table("bingo_tiles").select("id").in_("linked_map_node_id", relevant_node_ids).execute().data
    )
    linked_ids = {r["id"] for r in linked_tile_rows}

    tile_completions = [
        complete_tile(tile_id, session_id, guest_id) for tile_id in completed_tile_ids if str(tile_id) in linked_ids
    ]

    # Upsert, not insert: re-visiting an already-visited node must not violate
    # node_visits' (session_id, node_id) unique constraint -- it's a no-op
    # write (visited_at is left at its original value on conflict) that
    # still lets the rest of this call (tile completions, the exploration
    # bonus check) run normally. default_to_null=False, same reasoning as
    # app/device_session.py's own upsert: postgrest-py otherwise sends
    # `Prefer: missing=null`, which would null out id/visited_at on insert
    # instead of letting their column defaults (gen_random_uuid(), now())
    # apply.
    client.table("node_visits").upsert(
        {"session_id": str(session_id), "node_id": str(node_id)},
        on_conflict="session_id,node_id",
        ignore_duplicates=True,
        default_to_null=False,
    ).execute()

    map_exploration_bonus = _check_map_exploration_bonus(client, node_id, session_id, guest_id)

    tiles = (
        client.table("bingo_tiles")
        .select("id,label")
        .in_("linked_map_node_id", relevant_node_ids)
        .execute()
        .data
    )
    # Per-Device Sessions Phase 6a: completed status for this response is
    # this session's (or guest's, Phase 3) own session_tile_completions rows,
    # not a global column.
    session_completions = _session_tile_completions(client, session_ids, [t["id"] for t in tiles])
    linked_tiles = [LinkedTile(id=t["id"], label=t["label"], completed=t["id"] in session_completions) for t in tiles]
    children = [ChildNode(id=c["id"], name=c["name"]) for c in child_rows]

    node = _row_to_map_node(node_row, linked_tiles, children, visited=True)
    return VisitNodeResponse(node=node, tile_completions=tile_completions, coins_awarded=map_exploration_bonus)


def set_node_open_status(node_id: UUID, is_open: bool) -> MapNode:
    """Staff-managed open/closed toggle for the Staff Page Attractions tab.

    Independent of visit progress: never blocks or alters Hunt/QR completion,
    and untouched by Reset Session. Staff actions carry no device session, so
    the returned MapNode.visited is always the default False -- callers of
    this endpoint (the Staff Page) only ever read is_open off its response.
    linked_tiles.completed is likewise always False here for the same reason
    (Per-Device Sessions Phase 6a: completed status is per-session, and staff
    actions carry no session to resolve it from) -- the Staff Page never
    reads that field off this endpoint's response either.
    """
    client = get_supabase_client()

    updated_rows = (
        client.table("map_nodes").update({"is_open": is_open}).eq("id", str(node_id)).execute().data
    )
    if not updated_rows:
        raise NotFoundError(f"Map node {node_id} not found")
    updated_node_row = updated_rows[0]

    child_rows = (
        client.table("map_nodes")
        .select("id,name")
        .eq("parent_node_id", str(node_id))
        .order("name")
        .execute()
        .data
    )
    relevant_node_ids = [str(node_id)] + [c["id"] for c in child_rows]

    tiles = (
        client.table("bingo_tiles")
        .select("id,label")
        .in_("linked_map_node_id", relevant_node_ids)
        .execute()
        .data
    )
    linked_tiles = [LinkedTile(id=t["id"], label=t["label"], completed=False) for t in tiles]
    children = [ChildNode(id=c["id"], name=c["name"]) for c in child_rows]

    return _row_to_map_node(updated_node_row, linked_tiles, children)


def get_guest_bingo_map_status(guest_id: UUID) -> GuestBingoMapStatus:
    """Guest Accounts Phase 3: backs GET /account/bingo-map/status, called
    right after login so the frontend can decide whether the "Welcome back"
    continue-or-start-fresh prompt should appear at all (has_progress) and,
    if so, what numbers to show alongside it.

    tiles_completed/nodes_visited span every session ever linked to the
    guest (list_guest_session_ids), same join as every other guest-lifetime
    read in this app. tiles_completed dedupes by tile_id (via a set) rather
    than counting rows -- two of the guest's linked sessions independently
    completing the same tile must still count as 1, not 2.
    """
    client = get_supabase_client()
    session_ids = list_guest_session_ids(guest_id)
    tiles_total = len(client.table("bingo_tiles").select("id").execute().data)

    if not session_ids:
        return GuestBingoMapStatus(has_progress=False, tiles_completed=0, tiles_total=tiles_total, nodes_visited=0)

    tile_rows = client.table("session_tile_completions").select("tile_id").in_("session_id", session_ids).execute().data
    tiles_completed = len({r["tile_id"] for r in tile_rows})

    node_rows = client.table("node_visits").select("node_id").in_("session_id", session_ids).execute().data
    nodes_visited = len({r["node_id"] for r in node_rows})

    return GuestBingoMapStatus(
        has_progress=tiles_completed > 0 or nodes_visited > 0,
        tiles_completed=tiles_completed,
        tiles_total=tiles_total,
        nodes_visited=nodes_visited,
    )


def start_fresh_bingo_map(guest_id: UUID) -> BingoMapStartFreshResult:
    """Guest Accounts Phase 3: backs POST /account/bingo-map/start-fresh --
    the one deliberate, guest-initiated wipe of this guest's Bingo/Map
    progress across every device session ever linked to them. Never
    triggered automatically and never bundled into Reset Session (see
    app/services/session_reset.py's docstring).

    Also stamps guests.bingo_map_reset_at = now(), which is what actually
    makes the Map Exploration bonus re-earnable afterward -- unlike Bingo
    milestones (recomputed live off session_tile_completions, so deleting
    those rows alone is enough), the Map Exploration bonus's idempotency
    guard checks the append-only coin_awards ledger directly and never
    deletes from it, so it needs this explicit boundary to know a fresh
    attempt has started. See _check_map_exploration_bonus's docstring for
    the full reasoning.
    """
    client = get_supabase_client()
    session_ids = list_guest_session_ids(guest_id)

    if not session_ids:
        return BingoMapStartFreshResult(bingo_tiles_reset=0, map_nodes_reset=0)

    tile_rows = (
        client.table("session_tile_completions").delete().in_("session_id", session_ids).execute().data
    )
    node_rows = client.table("node_visits").delete().in_("session_id", session_ids).execute().data

    client.table("guests").update({"bingo_map_reset_at": datetime.now(timezone.utc).isoformat()}).eq(
        "id", str(guest_id)
    ).execute()

    return BingoMapStartFreshResult(bingo_tiles_reset=len(tile_rows), map_nodes_reset=len(node_rows))
