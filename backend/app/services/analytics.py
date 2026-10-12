"""Aggregation for the Staff Page Analytics dashboard.

Every section's session *population* is device_sessions.created_at within
the requested [start, end] window ("who showed up this window") -- the same
count Overview's total_users reports. Two different kinds of numbers are
built on top of that cohort:

- Event/total metrics (coins earned, node-visit rankings, collectible
  purchases, photos submitted, passports generated, staff requests) use
  their OWN row's timestamp windowed to [start, end], independent of
  whether the session that produced them is itself in the cohort.
- Per-session STATE metrics (bingo % filled, milestones achieved, hunt
  characters found, and the map-exploration/blackout/hunt-complete booleans
  behind Full Completionist) describe what a cohort session ultimately
  accomplished, evaluated over that session's full history rather than
  re-windowed a second time -- a family that entered the cohort in the last
  minute of the window but finished Bingo a minute later still counts.
  "Family Passports Generated" is the one metric that appears in both
  categories: the standalone count in AnalyticsPhotosPassport is windowed by
  generated_at (an event total), while the Full Completionist leg below
  checks the cohort session's passport existence at any time (a state).

Ambiguous-metric choices (see models.py docstrings on each field for the
short version):
- avg_coins_per_user divides by every app user in range, not just users who
  earned a coin -- keeps the same denominator as Overview.total_users
  instead of silently redefining "per user" here.
- Scavenger Hunt's avg_completion_rate_pct is the average fraction of
  characters *unlocked* per app user (partial progress), not "% of users
  who fully finished" -- that stricter number already lives in
  full_completionist_rate_pct, so this stays a distinct, useful number
  rather than a duplicate.
- "% of players who scanned each character" is denominated over every app
  user in range, not just users who touched the hunt at all, matching the
  mockup's "% of Players" wording.
- Puzzle Timer only reports one count (puzzle_timer_solves): puzzle_attempts
  rows are only ever written after a successful solve
  (app/services/puzzles.py::record_attempt), so there's no separate
  "attempted but not solved" figure to report, unlike Scoring Sheet (whose
  score_sheet_sessions genuinely has a created_at start / completed_at
  finish).

Date windows: [start, end] are whole UTC calendar days -- UTC midnight of
`start` through 23:59:59.999999 UTC of `end` (_range_bounds), and per-day
buckets are UTC dates. The park timezone is not applied here (only the
Visit Heatmap uses it).

Where the work happens: the counting/joining runs in Postgres, in the
analytics_summary() function (migration 044), in ONE call whatever the
number of sessions. It replaced 13 + ceil(N/1000) + 5*ceil(N/200)
sequential PostgREST calls (N = sessions in range) that made this endpoint
take 25s+ on the dev DB. Python only turns that payload into the response
models -- including Bingo line/X/blackout detection, which stays in
app/services/milestone.py (the exact tile-index math): the function returns
a 25-bit completed-tile bitmask per cohort session that has any
completions, and _mask_indices unpacks it.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from postgrest.exceptions import APIError

from app.models import (
    AnalyticsBingo,
    AnalyticsCoins,
    AnalyticsCollectibles,
    AnalyticsEngagement,
    AnalyticsMapExploration,
    AnalyticsOverview,
    AnalyticsPhotosPassport,
    AnalyticsPuzzleScoring,
    AnalyticsScavengerHunt,
    AnalyticsStaffOps,
    AnalyticsSummary,
    AnimalPurchaseRank,
    DailyRatePoint,
    HuntCharacterFoundRate,
    MapNodeVisitRank,
    UsersOverTimePoint,
)
from app.services import milestone as milestone_service
from app.supabase_client import get_supabase_client

# PostgREST's "function not found in the schema cache" error code.
_FUNCTION_NOT_FOUND = "PGRST202"


class AnalyticsFunctionMissing(RuntimeError):
    """analytics_summary() isn't in the database -- the backend was deployed
    before migration 044 was run. Surfaces as a 500 with this message (and
    "Couldn't load analytics" in the Staff UI), never as all-zero numbers."""


def _parse_timestamptz(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


# PostgREST caps a single response at 1000 rows by default -- a plain
# .select() over a wide range silently truncates instead of erroring.
# Analytics no longer pages (one RPC call), but the Visit Heatmap
# (app/services/heatmap.py) still reads raw rows through this.
_PAGE_SIZE = 1000


def _fetch_paginated(build_query) -> list[dict]:
    """Page through a filtered query via .range(). `build_query` is a
    zero-arg callable returning a fresh query builder, since a postgrest
    query builder is single-use (calling .range()/.execute() on an
    already-executed builder doesn't re-run it)."""
    rows: list[dict] = []
    offset = 0
    while True:
        page = build_query().range(offset, offset + _PAGE_SIZE - 1).execute().data
        rows.extend(page)
        if len(page) < _PAGE_SIZE:
            return rows
        offset += _PAGE_SIZE


def _range_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    return datetime.combine(start, time.min, tzinfo=timezone.utc), datetime.combine(end, time.max, tzinfo=timezone.utc)


def _daterange(start: date, end: date):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def _mask_indices(mask: int) -> set[int]:
    """Unpacks analytics_summary()'s completed-tile bitmask (bit i set =
    tile index i = row_index * 5 + col_index completed) into the index set
    milestone.achieved_milestones expects."""
    return {i for i in range(milestone_service.TILE_COUNT) if mask >> i & 1}


def _fetch_payload(start_iso: str, end_iso: str) -> dict:
    client = get_supabase_client()
    try:
        payload = client.rpc("analytics_summary", {"p_start": start_iso, "p_end": end_iso}).execute().data
    except APIError as exc:
        if exc.code == _FUNCTION_NOT_FOUND:
            raise AnalyticsFunctionMissing(
                "analytics_summary() is missing from the database: run migration "
                "044_analytics_summary_rpc.sql before deploying this backend"
            ) from exc
        raise
    if not isinstance(payload, dict) or "total_users" not in payload:
        raise RuntimeError(f"analytics_summary() returned an unexpected payload: {type(payload).__name__}")
    return payload


def get_summary(start: date, end: date) -> AnalyticsSummary:
    start_dt, end_dt = _range_bounds(start, end)
    payload = _fetch_payload(start_dt.isoformat(), end_dt.isoformat())
    return build_summary(start, end, payload)


def build_summary(start: date, end: date, payload: dict) -> AnalyticsSummary:
    """Pure: analytics_summary()'s jsonb payload -> the response model."""
    total_users: int = payload["total_users"]
    users_by_day = {date.fromisoformat(r["day"]): r["count"] for r in payload["users_by_day"]}
    hunt_characters: list[dict] = payload["hunt_characters"]
    bingo_sessions: list[dict] = payload["bingo_sessions"]

    return AnalyticsSummary(
        range_start=start.isoformat(),
        range_end=end.isoformat(),
        overview=_overview(total_users, users_by_day, start, end),
        coins=AnalyticsCoins(
            total_coins_earned=payload["coins_total"],
            avg_coins_per_user=(payload["coins_total"] / total_users) if total_users else 0.0,
        ),
        hunt=_hunt(total_users, hunt_characters, payload["hunt_total_unlocked"]),
        bingo=_bingo(total_users, bingo_sessions),
        map_exploration=_map_exploration(total_users, payload["cohort_node_visits"], payload["node_rankings"]),
        collectibles=AnalyticsCollectibles(
            most_purchased=sorted(
                (AnimalPurchaseRank(animal_slug=r["animal_slug"], count=r["count"]) for r in payload["collectibles"]),
                key=lambda r: r.count,
                reverse=True,
            )
        ),
        puzzle_scoring=AnalyticsPuzzleScoring(
            puzzle_timer_solves=payload["puzzle_timer_solves"],
            scoring_sheet_attempts=payload["scoring_sheet_attempts"],
            scoring_sheet_completions=payload["scoring_sheet_completions"],
        ),
        photos_passport=AnalyticsPhotosPassport(
            photos_submitted=payload["photos_submitted"],
            # Voting sessions are already intersected with the cohort in SQL,
            # so this can never exceed 100%.
            pct_sessions_voting=(payload["voting_cohort_sessions"] / total_users * 100) if total_users else 0.0,
            passports_generated=payload["passports_generated"],
        ),
        engagement=_engagement(total_users, users_by_day, bingo_sessions, len(hunt_characters), start, end),
        staff_ops=AnalyticsStaffOps(
            total_requests=payload["staff_requests_total"],
            general_count=payload["staff_requests_question"],
            emergency_count=payload["staff_requests_emergency"],
        ),
    )


def _overview(total_users: int, users_by_day: dict[date, int], start: date, end: date) -> AnalyticsOverview:
    points = [UsersOverTimePoint(date=day.isoformat(), count=users_by_day.get(day, 0)) for day in _daterange(start, end)]
    return AnalyticsOverview(total_users=total_users, users_over_time=points)


def _hunt(total_users: int, hunt_characters: list[dict], total_unlocked: int) -> AnalyticsScavengerHunt:
    hunt_total_characters = len(hunt_characters)
    if total_users and hunt_total_characters:
        avg_completion = total_unlocked / total_users / hunt_total_characters * 100
    else:
        avg_completion = 0.0

    found_rates = [
        HuntCharacterFoundRate(
            character_id=c["id"],
            name=c["name"],
            found_pct=(c["found"] / total_users * 100) if total_users else 0.0,
        )
        for c in hunt_characters
    ]
    return AnalyticsScavengerHunt(avg_completion_rate_pct=avg_completion, character_found_rates=found_rates)


def _bingo(total_users: int, bingo_sessions: list[dict]) -> AnalyticsBingo:
    # Only sessions with at least one completion are listed; every other
    # cohort session contributes 0 tiles and 0 milestones.
    total_windowed_tiles = sum(s["windowed_tiles"] for s in bingo_sessions)
    avg_tiles_completed = (total_windowed_tiles / total_users) if total_users else 0.0

    total_milestones = 0
    for s in bingo_sessions:
        lines, x, blackout = milestone_service.achieved_milestones(_mask_indices(s["mask"]))
        total_milestones += len(lines) + (1 if x else 0) + (1 if blackout else 0)
    avg_milestones = (total_milestones / total_users) if total_users else 0.0

    return AnalyticsBingo(avg_tiles_completed=avg_tiles_completed, avg_milestones_per_session=avg_milestones)


def _map_exploration(total_users: int, cohort_node_visits: int, node_rankings: list[dict]) -> AnalyticsMapExploration:
    avg_nodes_visited = (cohort_node_visits / total_users) if total_users else 0.0
    rankings = sorted(
        (MapNodeVisitRank(node_id=r["node_id"], name=r["name"], visits=r["visits"]) for r in node_rankings),
        key=lambda r: r.visits,
        reverse=True,
    )
    return AnalyticsMapExploration(avg_nodes_visited_per_session=avg_nodes_visited, node_rankings=rankings)


def _is_completionist(session: dict, hunt_total_characters: int) -> bool:
    hunt_done = hunt_total_characters > 0 and session["hunt_completed"] == hunt_total_characters
    _, _, blackout = milestone_service.achieved_milestones(_mask_indices(session["mask"]))
    return hunt_done and blackout and session["map_exploration"] and session["passport"]


def _engagement(
    total_users: int,
    users_by_day: dict[date, int],
    bingo_sessions: list[dict],
    hunt_total_characters: int,
    start: date,
    end: date,
) -> AnalyticsEngagement:
    # Full Completionist needs a Bingo blackout, so only sessions with
    # completions (the ones analytics_summary() lists) can qualify.
    completionists_by_day: dict[date, int] = {}
    for s in bingo_sessions:
        if _is_completionist(s, hunt_total_characters):
            day = date.fromisoformat(s["created_day"])
            completionists_by_day[day] = completionists_by_day.get(day, 0) + 1

    full_completionist_count = sum(completionists_by_day.values())
    full_completionist_rate = (full_completionist_count / total_users * 100) if total_users else 0.0

    trend = []
    for day in _daterange(start, end):
        day_total = users_by_day.get(day, 0)
        trend.append(
            DailyRatePoint(date=day.isoformat(), pct=(completionists_by_day.get(day, 0) / day_total * 100) if day_total else 0.0)
        )

    return AnalyticsEngagement(full_completionist_rate_pct=full_completionist_rate, full_completionist_trend=trend)
