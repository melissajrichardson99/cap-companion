"""Orchestration for the map/bingo endpoints.

Wires the pure logic in milestone.py and minigame_draw.py up to Supabase,
and implements the map-node visit / bingo interconnectivity flow from tech
spec section 4.3. This is the only layer that talks to the database — the
milestone math and the random draw stay pure and independently testable.
"""

from __future__ import annotations

import random
from datetime import datetime, timezone
from uuid import UUID

from app.errors import NotFoundError
from app.models import (
    BingoCard,
    BingoCardSummary,
    BingoTile,
    ChildNode,
    CoinSourceType,
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
    row: dict, linked_tiles: list[LinkedTile], children: list[ChildNode] | None = None
) -> MapNode:
    return MapNode(
        id=row["id"],
        name=row["name"],
        category=row["category"],
        description=row["description"],
        state=row["state"],
        is_open=row["is_open"],
        linked_tiles=linked_tiles,
        x_pct=row["x_pct"],
        y_pct=row["y_pct"],
        parent_node_id=row["parent_node_id"],
        children=children or [],
    )


def _row_to_bingo_tile(row: dict) -> BingoTile:
    return BingoTile(
        id=row["id"],
        card_id=row["card_id"],
        row=row["row_index"],
        col=row["col_index"],
        label=row["label"],
        linked_map_node_id=row["linked_map_node_id"],
        completed=row["completed"],
        completed_at=row["completed_at"],
    )


def _milestones_from_card_row(row: dict) -> MilestonesAchieved:
    return MilestonesAchieved(
        lines=row["milestone_lines"] or [],
        x=row["milestone_x"],
        blackout=row["milestone_blackout"],
    )


def list_map_nodes() -> list[MapNode]:
    client = get_supabase_client()
    nodes = client.table("map_nodes").select("*").execute().data
    all_tiles = client.table("bingo_tiles").select("id,label,completed,linked_map_node_id").execute().data

    tiles_by_node: dict[str, list[LinkedTile]] = {}
    for t in all_tiles:
        node_id = t["linked_map_node_id"]
        if node_id is None:
            continue
        tiles_by_node.setdefault(node_id, []).append(
            LinkedTile(id=t["id"], label=t["label"], completed=t["completed"])
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
        result.append(_row_to_map_node(n, linked_tiles, children))

    return result


def list_bingo_cards() -> list[BingoCardSummary]:
    client = get_supabase_client()
    rows = client.table("bingo_cards").select("id,owner_label").order("created_at").execute().data
    return [BingoCardSummary(id=r["id"], owner_label=r["owner_label"]) for r in rows]


def get_bingo_card(card_id: UUID) -> BingoCard:
    client = get_supabase_client()
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

    return BingoCard(
        id=card_row["id"],
        owner_label=card_row["owner_label"],
        tiles=[_row_to_bingo_tile(r) for r in tile_rows],
        milestones_achieved=_milestones_from_card_row(card_row),
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


def complete_tile(tile_id: UUID) -> TileCompletionResult:
    """Mark one bingo tile completed and run everything it triggers (4.1 + 4.2).

    Shared by POST /bingo/tiles/{id}/complete and the map-node visit flow so
    both paths run identical milestone-detection and minigame-draw logic —
    the map is just a second entry point into the same tile completion, not
    a separate implementation of it.
    """
    global _last_played_minigame_id
    client = get_supabase_client()

    tile_rows = client.table("bingo_tiles").select("*").eq("id", str(tile_id)).execute().data
    if not tile_rows:
        raise NotFoundError(f"Bingo tile {tile_id} not found")
    tile_row = tile_rows[0]

    if tile_row["completed"]:
        # Already complete: re-completing must not re-fire milestones or re-draw
        # minigames. Symmetric with 4.1's rule that minigame outcome never
        # feeds back into completion state — completion is a one-way trigger.
        tile = _row_to_bingo_tile(tile_row)
        card = get_bingo_card(tile.card_id)
        return TileCompletionResult(
            tile=tile,
            milestones=[],
            minigames_drawn=[],
            card_milestones_achieved=card.milestones_achieved,
        )

    now = datetime.now(timezone.utc).isoformat()
    updated_tile_row = (
        client.table("bingo_tiles")
        .update({"completed": True, "completed_at": now})
        .eq("id", str(tile_id))
        .execute()
        .data[0]
    )
    tile = _row_to_bingo_tile(updated_tile_row)

    card_rows = client.table("bingo_cards").select("*").eq("id", str(tile.card_id)).execute().data
    card_row = card_rows[0]

    all_tiles = (
        client.table("bingo_tiles")
        .select("id,row_index,col_index,completed")
        .eq("card_id", str(tile.card_id))
        .execute()
        .data
    )
    index_to_tile_id = {r["row_index"] * 5 + r["col_index"]: r["id"] for r in all_tiles}
    completed_indices = {
        r["row_index"] * 5 + r["col_index"] for r in all_tiles if r["completed"]
    }

    achieved_lines = set(card_row["milestone_lines"] or [])
    hits = milestone_service.detect_new_milestones(
        completed_indices,
        achieved_lines=achieved_lines,
        achieved_x=card_row["milestone_x"],
        achieved_blackout=card_row["milestone_blackout"],
    )

    # Only the single highest-priority hit is ever reported to the frontend
    # for animation -- achieved-lines/x/blackout bookkeeping below still
    # covers every hit in `hits`, regardless of which one (if any) is shown.
    # Bingo coins are derived from this same display_hit (not from `hits`),
    # so a completion that satisfies multiple tiers at once pays only the
    # highest tier -- always in agreement with what the banner shows.
    display_hit = milestone_service.select_display_milestone(hits)
    coins_awarded = coins_service.bingo_milestone_amount(display_hit.type) if display_hit else 0
    if display_hit:
        coins_service.award_coins(CoinSourceType.BINGO_MILESTONE, tile.id, coins_awarded)
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

    if hits:
        new_achieved_lines = achieved_lines | {h.line_index for h in hits if h.line_index is not None}
        new_x = card_row["milestone_x"] or any(h.type == "x" for h in hits)
        new_blackout = card_row["milestone_blackout"] or any(h.type == "blackout" for h in hits)
        card_row = (
            client.table("bingo_cards")
            .update(
                {
                    "milestone_lines": sorted(new_achieved_lines),
                    "milestone_x": new_x,
                    "milestone_blackout": new_blackout,
                }
            )
            .eq("id", str(tile.card_id))
            .execute()
            .data[0]
        )

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
        card_milestones_achieved=_milestones_from_card_row(card_row),
        coins_awarded=coins_awarded,
    )


def _check_map_exploration_bonus(client, node_id: UUID) -> int:
    """Award the one-time 50-coin Map Exploration bonus once every
    currently-open top-level node has been visited.

    Scoped to parent_node_id IS NULL: children (the Arcade Pad/Ground Games
    sub-nodes) render no pin/card of their own in MapScreen.tsx and their
    `state` never leaves 'not_visited' through any code path, so including
    them here would make the bonus permanently unreachable by default.
    Closed nodes (is_open false) don't count, and the `top_level_open` guard
    below avoids vacuously awarding when every top-level node is closed.
    Idempotent: guarded by whether a map_exploration award already exists,
    which Reset Session clears along with the rest of coin_awards.
    """
    all_nodes = client.table("map_nodes").select("id,is_open,state,parent_node_id").execute().data
    top_level_open = [n for n in all_nodes if n["is_open"] and n["parent_node_id"] is None]
    if not top_level_open or not all(n["state"] == "visited" for n in top_level_open):
        return 0

    already_awarded = (
        client.table("coin_awards")
        .select("id")
        .eq("source_type", CoinSourceType.MAP_EXPLORATION.value)
        .execute()
        .data
    )
    if already_awarded:
        return 0

    coins_service.award_coins(CoinSourceType.MAP_EXPLORATION, node_id, coins_service.MAP_EXPLORATION_AMOUNT)
    return coins_service.MAP_EXPLORATION_AMOUNT


def visit_node(node_id: UUID, completed_tile_ids: list[UUID]) -> VisitNodeResponse:
    """Mark a node visited, completing any confirmed linked tiles first (4.3).

    completed_tile_ids are the tiles the guest answered "Yes" to on the
    sequential per-tile Yes/No popups the frontend drives off the
    linked_tiles list returned by GET /map/nodes — one popup per uncompleted
    linked tile, so none get silently skipped. Each confirmed tile is run
    through complete_tile (triggering 4.1/4.2) before the node itself flips
    to visited; answering "No" for a tile simply means its id is omitted.
    """
    client = get_supabase_client()

    node_rows = client.table("map_nodes").select("*").eq("id", str(node_id)).execute().data
    if not node_rows:
        raise NotFoundError(f"Map node {node_id} not found")

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
        complete_tile(tile_id) for tile_id in completed_tile_ids if str(tile_id) in linked_ids
    ]

    updated_node_row = (
        client.table("map_nodes").update({"state": "visited"}).eq("id", str(node_id)).execute().data[0]
    )

    map_exploration_bonus = _check_map_exploration_bonus(client, node_id)

    tiles = (
        client.table("bingo_tiles")
        .select("id,label,completed")
        .in_("linked_map_node_id", relevant_node_ids)
        .execute()
        .data
    )
    linked_tiles = [LinkedTile(id=t["id"], label=t["label"], completed=t["completed"]) for t in tiles]
    children = [ChildNode(id=c["id"], name=c["name"]) for c in child_rows]

    node = _row_to_map_node(updated_node_row, linked_tiles, children)
    return VisitNodeResponse(node=node, tile_completions=tile_completions, coins_awarded=map_exploration_bonus)


def set_node_open_status(node_id: UUID, is_open: bool) -> MapNode:
    """Staff-managed open/closed toggle for the Staff Page Attractions tab.

    Independent of `state`/visit progress: never blocks or alters Hunt/QR
    completion, and untouched by Reset Session.
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
        .select("id,label,completed")
        .in_("linked_map_node_id", relevant_node_ids)
        .execute()
        .data
    )
    linked_tiles = [LinkedTile(id=t["id"], label=t["label"], completed=t["completed"]) for t in tiles]
    children = [ChildNode(id=c["id"], name=c["name"]) for c in child_rows]

    return _row_to_map_node(updated_node_row, linked_tiles, children)
