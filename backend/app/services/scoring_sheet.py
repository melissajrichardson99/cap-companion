"""Orchestration for the Scoring Sheet endpoints (Plan.md 2.2).

Win-condition math is pure and lives in app.services.scoring; this module's
job is just DB I/O plus wiring that pure result onto the session row -- same
split as milestone.py (pure) / map_bingo.py (orchestration).

Per-Device Sessions Phase 2 (migration 025) scopes score_sheet_sessions to
device_session_id -- not just the coin award device_session_id already
threaded through since Phase 1, but ownership of the session row itself:
_get_session_row now filters on it, so a session_id that exists but belongs
to a different device 404s exactly like one that doesn't exist at all (no
existence leak). score_entries has no column of its own -- every entries
read/write reaches those rows only via a session_row already fetched scoped
to the caller, so entries are scoped for free (see migration 025's header).

first_to_bonus_round (see the comment on the auto-lock check below) was
checked during this phase's design: it's purely about which player *within
one score_sheet_session* reaches the threshold first -- there's no
cross-session/cross-family competitive condition here (unlike the Map
Exploration bonus's global guard) -- so scoping this table per-device needed
no special-case, same as everything else in this phase.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from uuid import UUID

from app.errors import ConflictError, NotFoundError
from app.models import CoinSourceType, GameScoreEvent, ScoreEntry, ScoreSheetSession, ScoringGame
from app.services import coins as coins_service
from app.services import scoring as scoring_service
from app.supabase_client import get_supabase_client


def _parse_timestamptz(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _row_to_score_event(row: dict) -> GameScoreEvent:
    return GameScoreEvent(
        id=row["id"],
        game_id=row["game_id"],
        label=row["label"],
        point_value=row["point_value"],
        is_miss=row["point_value"] == 0,
    )


def _row_to_game(row: dict, events: list[GameScoreEvent]) -> ScoringGame:
    return ScoringGame(
        id=row["id"],
        name=row["name"],
        rules_text=row["rules_text"],
        win_condition_text=row["win_condition_text"],
        win_condition_type=row["win_condition_type"],
        win_threshold=row["win_threshold"],
        throws_per_round=row["throws_per_round"],
        score_events=events,
    )


def list_games() -> list[ScoringGame]:
    client = get_supabase_client()
    game_rows = client.table("scoring_games").select("*").order("created_at").execute().data
    event_rows = client.table("game_score_events").select("*").order("sort_order").execute().data

    events_by_game: dict[str, list[GameScoreEvent]] = {}
    for row in event_rows:
        events_by_game.setdefault(row["game_id"], []).append(_row_to_score_event(row))

    return [_row_to_game(row, events_by_game.get(row["id"], [])) for row in game_rows]


def _get_game_row(client, game_id: UUID | str) -> dict:
    rows = client.table("scoring_games").select("*").eq("id", str(game_id)).execute().data
    if not rows:
        raise NotFoundError(f"Scoring game {game_id} not found")
    return rows[0]


def _get_session_row(client, session_id: UUID, device_session_id: UUID) -> dict:
    rows = (
        client.table("score_sheet_sessions")
        .select("*")
        .eq("id", str(session_id))
        .eq("device_session_id", str(device_session_id))
        .execute()
        .data
    )
    if not rows:
        raise NotFoundError(f"Score sheet session {session_id} not found")
    return rows[0]


def _entries_for_session(client, session_id: str) -> list[ScoreEntry]:
    rows = (
        client.table("score_entries")
        .select("*, game_score_events(label, point_value)")
        .eq("session_id", session_id)
        .order("created_at")
        .execute()
        .data
    )
    return [
        ScoreEntry(
            id=r["id"],
            session_id=r["session_id"],
            player_name=r["player_name"],
            score_event_id=r["score_event_id"],
            label=r["game_score_events"]["label"],
            point_value=r["game_score_events"]["point_value"],
            turn_round=r["turn_round"],
            created_at=_parse_timestamptz(r["created_at"]),
        )
        for r in rows
    ]


def _current_turn(entries: list, players: list[str]) -> tuple[str, int]:
    """Whose turn it is and which turn-cycle round is in progress.

    Turn order is simply `players` in order, fixed for the whole session;
    only the current index (derived from how many entries exist) advances.
    Not to be confused with the Tiki-Toss-only round_number computed by
    scoring_service.evaluate_win -- see ScoreEntry.turn_round's comment.
    """
    turn_index = len(entries) % len(players)
    current_round = len(entries) // len(players) + 1
    return players[turn_index], current_round


def _round_complete_entries(entries: list[ScoreEntry], players: list[str]) -> list[ScoreEntry]:
    """Entries through the last turn-cycle round every player has completed.

    Win/tie status is only ever decided from this truncated view -- a player
    crossing the threshold mid-round, before the rest of the round's players
    have taken their turn, must not end the game early. Live totals and turn
    order (_current_turn) are unaffected -- they still use the full entry
    list, only the win-check's input is trimmed.
    """
    if not players:
        return entries
    complete_count = (len(entries) // len(players)) * len(players)
    return entries[:complete_count]


def _session_from_row(client, session_row: dict, device_session_id: UUID) -> ScoreSheetSession:
    """device_session_id (Per-Device Sessions Phase 1) attributes the win
    coin award below to the calling device -- named distinctly from this
    file's own pre-existing `session_id` (a score-sheet session, an
    unrelated concept) to avoid shadowing it. Threaded through even on the
    read-only path (get_session) because first_to_bonus_round games are
    deliberately excluded from the auto-lock below, so a GET here isn't
    guaranteed to be free of the award side effect."""
    entries = _entries_for_session(client, session_row["id"])
    players: list[str] = session_row["players"]

    if session_row["completed_at"] and session_row["winner"]:
        totals = scoring_service.compute_totals(
            [scoring_service.ScoreEntryLike(e.player_name, e.point_value) for e in entries], players
        )
        return ScoreSheetSession(
            id=session_row["id"],
            game_id=session_row["game_id"],
            players=players,
            created_at=_parse_timestamptz(session_row["created_at"]),
            completed_at=_parse_timestamptz(session_row["completed_at"]),
            winner=session_row["winner"],
            status=scoring_service.STATUS_WON,
            totals=totals,
            entries=entries,
            # Game's over -- there's no "current turn" left to report.
            current_player=None,
            current_round=None,
        )

    game_row = _get_game_row(client, session_row["game_id"])
    round_entries = _round_complete_entries(entries, players)
    result = scoring_service.evaluate_win(
        win_condition_type=game_row["win_condition_type"],
        entries=[scoring_service.ScoreEntryLike(e.player_name, e.point_value) for e in round_entries],
        players=players,
        threshold=game_row["win_threshold"],
        throws_per_round=game_row["throws_per_round"],
    )
    # Win/tie status above is round-gated (see _round_complete_entries), but
    # displayed totals (running-scores table, current player's own total,
    # "leads with X" text) must keep updating every single turn, not just at
    # round boundaries -- so they're recomputed from the full entry list and
    # overlaid onto the round-gated result.
    live_totals = scoring_service.compute_totals(
        [scoring_service.ScoreEntryLike(e.player_name, e.point_value) for e in entries], players
    )
    result = replace(result, totals=live_totals)

    # first_to and first_to_round_tiebreak are monotonically final: once
    # either fires "won", no later entry can ever undo it (first_to's win
    # is the first crossing, full stop; round_tiebreak only judges once
    # every player has completed an equal number of rounds, so the totals
    # being compared are never still "in flight"). Auto-locking those is
    # safe. first_to_bonus_round is NOT safe to auto-lock: because only one
    # player's total changes per entry, whoever crosses the threshold first
    # is *always* the sole leader at that instant (the other player's total
    # is still whatever it was a moment earlier) -- so locking here would
    # make "bonus round on a tie" unreachable in practice, since the
    # trailing team could never get the chance to actually tie it. Instead,
    # "won" is left provisional and finish_session() below is what a staff
    # member taps once they're confident play has actually concluded (which
    # also gives a genuinely-tying score, if one comes in first, the chance
    # to flip the status to tie_bonus_round instead).
    if result.status == scoring_service.STATUS_WON and game_row["win_condition_type"] != scoring_service.FIRST_TO_BONUS_ROUND:
        now = datetime.now(timezone.utc).isoformat()
        session_row = (
            client.table("score_sheet_sessions")
            .update({"completed_at": now, "winner": result.winner})
            .eq("id", session_row["id"])
            .execute()
            .data[0]
        )
        coins_service.award_coins(
            CoinSourceType.SCORING_SHEET_WIN,
            UUID(session_row["id"]),
            coins_service.SCORING_SHEET_WIN_AMOUNT,
            device_session_id,
        )

    # None once locked (including just now, if the block above auto-locked
    # it) -- otherwise still mid-turn-cycle, including during
    # first_to_bonus_round's provisional-win sudden death.
    current_player, current_round = (None, None) if session_row["completed_at"] else _current_turn(entries, players)

    return ScoreSheetSession(
        id=session_row["id"],
        game_id=session_row["game_id"],
        players=players,
        created_at=_parse_timestamptz(session_row["created_at"]),
        completed_at=_parse_timestamptz(session_row["completed_at"]) if session_row["completed_at"] else None,
        # result.winner, not session_row["winner"] -- the DB column only
        # reflects a *persisted* win, which first_to_bonus_round games don't
        # get until finish_session() is called (see the comment above).
        # Falling back to the stale/null DB column here would show a blank
        # winner name for a provisional bonus-round win.
        winner=result.winner if result.winner is not None else session_row["winner"],
        status=result.status,
        totals=result.totals,
        entries=entries,
        tied_players=list(result.tied_players),
        round_number=result.round_number,
        current_player=current_player,
        current_round=current_round,
    )


def create_session(game_id: UUID, players: list[str], device_session_id: UUID) -> ScoreSheetSession:
    client = get_supabase_client()
    _get_game_row(client, game_id)  # 404s if the game doesn't exist

    row = (
        client.table("score_sheet_sessions")
        .insert({"game_id": str(game_id), "players": players, "device_session_id": str(device_session_id)})
        .execute()
        .data[0]
    )
    return _session_from_row(client, row, device_session_id)


def get_session(session_id: UUID, device_session_id: UUID) -> ScoreSheetSession:
    client = get_supabase_client()
    session_row = _get_session_row(client, session_id, device_session_id)
    return _session_from_row(client, session_row, device_session_id)


def finish_session(session_id: UUID, device_session_id: UUID) -> ScoreSheetSession:
    """Manually conclude a first_to_bonus_round session (Horse Hoops).

    A staff member taps this once they're confident physical play is over --
    see the comment in _session_from_row for why this game type can't be
    auto-locked the instant the pure win check says "won".
    """
    client = get_supabase_client()
    session_row = _get_session_row(client, session_id, device_session_id)

    if session_row["completed_at"]:
        raise ConflictError("This session has already finished.")

    session = _session_from_row(client, session_row, device_session_id)
    if session.status != scoring_service.STATUS_WON:
        raise ConflictError("Can't finish this session yet -- there's no clear winner.")

    now = datetime.now(timezone.utc).isoformat()
    client.table("score_sheet_sessions").update({"completed_at": now, "winner": session.winner}).eq(
        "id", str(session_id)
    ).execute()
    coins_service.award_coins(
        CoinSourceType.SCORING_SHEET_WIN, session_id, coins_service.SCORING_SHEET_WIN_AMOUNT, device_session_id
    )

    return get_session(session_id, device_session_id)


def record_entry(session_id: UUID, player_name: str, score_event_id: UUID, device_session_id: UUID) -> ScoreSheetSession:
    client = get_supabase_client()
    session_row = _get_session_row(client, session_id, device_session_id)

    if session_row["completed_at"]:
        raise ConflictError("This session has already finished -- start a new session to keep playing.")
    players: list[str] = session_row["players"]
    if player_name not in players:
        raise NotFoundError(f"{player_name!r} is not a player in this session")

    event_rows = (
        client.table("game_score_events")
        .select("id")
        .eq("id", str(score_event_id))
        .eq("game_id", session_row["game_id"])
        .execute()
        .data
    )
    if not event_rows:
        raise NotFoundError(f"Score event {score_event_id} not found for this game")

    entries = _entries_for_session(client, str(session_id))
    expected_player, _ = _current_turn(entries, players)
    if player_name != expected_player:
        raise ConflictError(f"It's not {player_name}'s turn -- waiting on {expected_player}.")

    turn_round = sum(1 for e in entries if e.player_name == player_name) + 1
    client.table("score_entries").insert(
        {
            "session_id": str(session_id),
            "player_name": player_name,
            "score_event_id": str(score_event_id),
            "turn_round": turn_round,
        }
    ).execute()

    return _session_from_row(client, session_row, device_session_id)
