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

Aggregation is done in Python over rows already filtered by date range or
session cohort -- the same convention every other service in this app uses
(e.g. app/services/coins.py::get_total) since there's no SQL-aggregate/RPC
precedent here to match -- but every query below is scoped by the relevant
date range or session cohort first so nothing pulls an unfiltered full
table.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

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
    CoinSourceType,
    DailyRatePoint,
    HuntCharacterFoundRate,
    MapNodeVisitRank,
    StaffRequestType,
    UsersOverTimePoint,
)
from app.services import milestone as milestone_service
from app.supabase_client import get_supabase_client


def _parse_timestamptz(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _range_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    return datetime.combine(start, time.min, tzinfo=timezone.utc), datetime.combine(end, time.max, tzinfo=timezone.utc)


def _daterange(start: date, end: date):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


# This dev project alone has accumulated more than 1000 device_sessions rows
# from repeated e2e runs against the real Supabase project (see
# playwright.config.ts), and PostgREST caps a single response at 1000 rows by
# default -- a plain .select() over a date range that wide silently
# truncates instead of erroring. _PAGE_SIZE paginates around that.
_PAGE_SIZE = 1000
# A cohort of hundreds of sessions turned into one big `in.(id1,id2,...)`
# query string is long enough to get rejected before PostgREST even parses
# it (observed as a opaque "JSON could not be generated" APIError) -- chunk
# the id list instead of sending it as one filter. 200 UUIDs is comfortably
# under typical URL-length limits while keeping the number of chunked round
# trips (and therefore wall-clock latency) down for a large cohort.
_COHORT_CHUNK_SIZE = 200


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


def _in_cohort(client, table: str, select: str, cohort_ids: list[str], *, extra=None) -> list[dict]:
    """select from `table` where session_id in cohort_ids -- every table this
    is used for FKs to device_sessions via a session_id column. Chunked (see
    _COHORT_CHUNK_SIZE above) rather than one big in_() call, and each chunk
    is paginated too in case its rows alone exceed _PAGE_SIZE. `extra`, if
    given, is applied to each chunk's query builder for an additional filter
    (e.g. coin_awards' source_type)."""
    rows: list[dict] = []
    for i in range(0, len(cohort_ids), _COHORT_CHUNK_SIZE):
        chunk = cohort_ids[i : i + _COHORT_CHUNK_SIZE]

        def build(chunk=chunk):
            query = client.table(table).select(select).in_("session_id", chunk)
            return extra(query) if extra else query

        rows.extend(_fetch_paginated(build))
    return rows


def get_summary(start: date, end: date) -> AnalyticsSummary:
    client = get_supabase_client()
    start_dt, end_dt = _range_bounds(start, end)
    start_iso, end_iso = start_dt.isoformat(), end_dt.isoformat()

    session_rows = _fetch_paginated(
        lambda: client.table("device_sessions").select("id,created_at").gte("created_at", start_iso).lte("created_at", end_iso)
    )
    cohort_ids = [r["id"] for r in session_rows]
    total_users = len(cohort_ids)
    created_at_by_session = {r["id"]: _parse_timestamptz(r["created_at"]).date() for r in session_rows}

    # --- Bingo: fetch once, feed both this section and Full Completionist ---
    tile_rows = client.table("bingo_tiles").select("id,row_index,col_index").execute().data
    index_by_tile_id = {t["id"]: t["row_index"] * 5 + t["col_index"] for t in tile_rows}

    completion_rows = _in_cohort(client, "session_tile_completions", "session_id,tile_id,completed_at", cohort_ids)
    completed_indices_by_session: dict[str, set[int]] = {}
    windowed_tiles_by_session: dict[str, int] = {}
    for row in completion_rows:
        idx = index_by_tile_id.get(row["tile_id"])
        if idx is None:
            continue
        completed_indices_by_session.setdefault(row["session_id"], set()).add(idx)
        if start_dt <= _parse_timestamptz(row["completed_at"]) <= end_dt:
            windowed_tiles_by_session[row["session_id"]] = windowed_tiles_by_session.get(row["session_id"], 0) + 1

    # --- Scavenger Hunt: fetch once, feed both this section and Full Completionist ---
    hunt_character_rows = client.table("hunt_characters").select("id,name").order("sort_order").execute().data
    hunt_total_characters = len(hunt_character_rows)
    hunt_progress_rows = _in_cohort(client, "hunt_progress", "session_id,character_id,unlocked_at,completed_at", cohort_ids)
    unlocked_count_by_session: dict[str, int] = {}
    hunt_completed_count_by_session: dict[str, int] = {}
    found_by_character: dict[str, int] = {c["id"]: 0 for c in hunt_character_rows}
    for row in hunt_progress_rows:
        if row["unlocked_at"] is not None:
            unlocked_count_by_session[row["session_id"]] = unlocked_count_by_session.get(row["session_id"], 0) + 1
            if row["character_id"] in found_by_character:
                found_by_character[row["character_id"]] += 1
        if row["completed_at"] is not None:
            hunt_completed_count_by_session[row["session_id"]] = hunt_completed_count_by_session.get(row["session_id"], 0) + 1

    # --- Map Exploration: cohort-scoped visit counts, feed this section and Full Completionist ---
    node_visit_cohort_rows = _in_cohort(client, "node_visits", "session_id", cohort_ids)
    visits_per_session: dict[str, int] = {}
    for row in node_visit_cohort_rows:
        visits_per_session[row["session_id"]] = visits_per_session.get(row["session_id"], 0) + 1

    map_exploration_award_rows = _in_cohort(
        client,
        "coin_awards",
        "session_id",
        cohort_ids,
        extra=lambda q: q.eq("source_type", CoinSourceType.MAP_EXPLORATION.value),
    )
    map_exploration_sessions = {r["session_id"] for r in map_exploration_award_rows}

    # --- Family Passport: cohort-scoped existence (state), feed Full Completionist ---
    passport_cohort_rows = _in_cohort(client, "passport_sessions", "session_id", cohort_ids)
    passport_sessions = {r["session_id"] for r in passport_cohort_rows}

    return AnalyticsSummary(
        range_start=start.isoformat(),
        range_end=end.isoformat(),
        overview=_overview(total_users, created_at_by_session, start, end),
        coins=_coins(client, total_users, start_iso, end_iso),
        hunt=_hunt(cohort_ids, total_users, hunt_character_rows, hunt_total_characters, unlocked_count_by_session, found_by_character),
        bingo=_bingo(cohort_ids, total_users, windowed_tiles_by_session, completed_indices_by_session),
        map_exploration=_map_exploration(client, visits_per_session, total_users, start_iso, end_iso),
        collectibles=_collectibles(client, start_iso, end_iso),
        puzzle_scoring=_puzzle_scoring(client, start_iso, end_iso),
        photos_passport=_photos_passport(client, cohort_ids, total_users, start_iso, end_iso),
        engagement=_engagement(
            cohort_ids,
            total_users,
            created_at_by_session,
            start,
            end,
            hunt_total_characters,
            hunt_completed_count_by_session,
            completed_indices_by_session,
            map_exploration_sessions,
            passport_sessions,
        ),
        staff_ops=_staff_ops(client, start_iso, end_iso),
    )


def _overview(total_users: int, created_at_by_session: dict[str, date], start: date, end: date) -> AnalyticsOverview:
    counts: dict[date, int] = {}
    for d in created_at_by_session.values():
        counts[d] = counts.get(d, 0) + 1
    points = [UsersOverTimePoint(date=day.isoformat(), count=counts.get(day, 0)) for day in _daterange(start, end)]
    return AnalyticsOverview(total_users=total_users, users_over_time=points)


def _coins(client, total_users: int, start_iso: str, end_iso: str) -> AnalyticsCoins:
    rows = _fetch_paginated(lambda: client.table("coin_awards").select("amount").gte("created_at", start_iso).lte("created_at", end_iso))
    total_earned = sum(r["amount"] for r in rows)
    avg_per_user = (total_earned / total_users) if total_users else 0.0
    return AnalyticsCoins(total_coins_earned=total_earned, avg_coins_per_user=avg_per_user)


def _hunt(
    cohort_ids: list[str],
    total_users: int,
    hunt_character_rows: list[dict],
    hunt_total_characters: int,
    unlocked_count_by_session: dict[str, int],
    found_by_character: dict[str, int],
) -> AnalyticsScavengerHunt:
    if total_users and hunt_total_characters:
        total_unlocked = sum(unlocked_count_by_session.get(sid, 0) for sid in cohort_ids)
        avg_completion = total_unlocked / total_users / hunt_total_characters * 100
    else:
        avg_completion = 0.0

    found_rates = [
        HuntCharacterFoundRate(
            character_id=c["id"],
            name=c["name"],
            found_pct=(found_by_character[c["id"]] / total_users * 100) if total_users else 0.0,
        )
        for c in hunt_character_rows
    ]
    return AnalyticsScavengerHunt(avg_completion_rate_pct=avg_completion, character_found_rates=found_rates)


def _bingo(
    cohort_ids: list[str],
    total_users: int,
    windowed_tiles_by_session: dict[str, int],
    completed_indices_by_session: dict[str, set[int]],
) -> AnalyticsBingo:
    total_windowed_tiles = sum(windowed_tiles_by_session.get(sid, 0) for sid in cohort_ids)
    avg_tiles_completed = (total_windowed_tiles / total_users) if total_users else 0.0

    total_milestones = 0
    for sid in cohort_ids:
        lines, x, blackout = milestone_service.achieved_milestones(completed_indices_by_session.get(sid, set()))
        total_milestones += len(lines) + (1 if x else 0) + (1 if blackout else 0)
    avg_milestones = (total_milestones / total_users) if total_users else 0.0

    return AnalyticsBingo(avg_tiles_completed=avg_tiles_completed, avg_milestones_per_session=avg_milestones)


def _map_exploration(client, visits_per_session: dict[str, int], total_users: int, start_iso: str, end_iso: str) -> AnalyticsMapExploration:
    avg_nodes_visited = (sum(visits_per_session.values()) / total_users) if total_users else 0.0

    windowed_visit_rows = _fetch_paginated(
        lambda: client.table("node_visits").select("node_id").gte("visited_at", start_iso).lte("visited_at", end_iso)
    )
    counts_by_node: dict[str, int] = {}
    for row in windowed_visit_rows:
        counts_by_node[row["node_id"]] = counts_by_node.get(row["node_id"], 0) + 1

    node_rows = client.table("map_nodes").select("id,name").execute().data
    name_by_id = {n["id"]: n["name"] for n in node_rows}
    rankings = sorted(
        (
            MapNodeVisitRank(node_id=node_id, name=name_by_id.get(node_id, "Unknown"), visits=count)
            for node_id, count in counts_by_node.items()
        ),
        key=lambda r: r.visits,
        reverse=True,
    )
    return AnalyticsMapExploration(avg_nodes_visited_per_session=avg_nodes_visited, node_rankings=rankings)


def _collectibles(client, start_iso: str, end_iso: str) -> AnalyticsCollectibles:
    rows = _fetch_paginated(
        lambda: client.table("collectible_redemptions").select("animal_slug").gte("created_at", start_iso).lte("created_at", end_iso)
    )
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["animal_slug"]] = counts.get(r["animal_slug"], 0) + 1
    ranked = sorted(
        (AnimalPurchaseRank(animal_slug=slug, count=count) for slug, count in counts.items()),
        key=lambda r: r.count,
        reverse=True,
    )
    return AnalyticsCollectibles(most_purchased=ranked)


def _puzzle_scoring(client, start_iso: str, end_iso: str) -> AnalyticsPuzzleScoring:
    puzzle_rows = _fetch_paginated(
        lambda: client.table("puzzle_attempts").select("id").gte("created_at", start_iso).lte("created_at", end_iso)
    )
    scoring_started_rows = _fetch_paginated(
        lambda: client.table("score_sheet_sessions").select("id").gte("created_at", start_iso).lte("created_at", end_iso)
    )
    scoring_completed_rows = _fetch_paginated(
        lambda: client.table("score_sheet_sessions").select("id").gte("completed_at", start_iso).lte("completed_at", end_iso)
    )
    return AnalyticsPuzzleScoring(
        puzzle_timer_solves=len(puzzle_rows),
        scoring_sheet_attempts=len(scoring_started_rows),
        scoring_sheet_completions=len(scoring_completed_rows),
    )


def _photos_passport(client, cohort_ids: list[str], total_users: int, start_iso: str, end_iso: str) -> AnalyticsPhotosPassport:
    photo_rows = _fetch_paginated(
        lambda: client.table("photo_submissions").select("id").gte("submitted_at", start_iso).lte("submitted_at", end_iso)
    )
    vote_rows = _fetch_paginated(
        lambda: client.table("photo_votes").select("session_id").gte("created_at", start_iso).lte("created_at", end_iso)
    )
    # Intersected with the cohort so this can never exceed 100% -- a vote
    # from a session created outside [start, end] shouldn't inflate a ratio
    # denominated by "total sessions in range".
    voting_sessions_in_range = {r["session_id"] for r in vote_rows} & set(cohort_ids)
    pct_voting = (len(voting_sessions_in_range) / total_users * 100) if total_users else 0.0

    passport_generated_rows = _fetch_paginated(
        lambda: client.table("passport_sessions").select("id").gte("generated_at", start_iso).lte("generated_at", end_iso)
    )
    return AnalyticsPhotosPassport(
        photos_submitted=len(photo_rows),
        pct_sessions_voting=pct_voting,
        passports_generated=len(passport_generated_rows),
    )


def _engagement(
    cohort_ids: list[str],
    total_users: int,
    created_at_by_session: dict[str, date],
    start: date,
    end: date,
    hunt_total_characters: int,
    hunt_completed_count_by_session: dict[str, int],
    completed_indices_by_session: dict[str, set[int]],
    map_exploration_sessions: set[str],
    passport_sessions: set[str],
) -> AnalyticsEngagement:
    completionist_by_session: dict[str, bool] = {}
    for sid in cohort_ids:
        hunt_done = hunt_total_characters > 0 and hunt_completed_count_by_session.get(sid, 0) == hunt_total_characters
        _, _, blackout = milestone_service.achieved_milestones(completed_indices_by_session.get(sid, set()))
        completionist_by_session[sid] = hunt_done and blackout and sid in map_exploration_sessions and sid in passport_sessions

    full_completionist_count = sum(1 for done in completionist_by_session.values() if done)
    full_completionist_rate = (full_completionist_count / total_users * 100) if total_users else 0.0

    totals_by_day: dict[date, int] = {}
    completionists_by_day: dict[date, int] = {}
    for sid in cohort_ids:
        day = created_at_by_session[sid]
        totals_by_day[day] = totals_by_day.get(day, 0) + 1
        if completionist_by_session[sid]:
            completionists_by_day[day] = completionists_by_day.get(day, 0) + 1

    trend = []
    for day in _daterange(start, end):
        day_total = totals_by_day.get(day, 0)
        trend.append(
            DailyRatePoint(date=day.isoformat(), pct=(completionists_by_day.get(day, 0) / day_total * 100) if day_total else 0.0)
        )

    return AnalyticsEngagement(full_completionist_rate_pct=full_completionist_rate, full_completionist_trend=trend)


def _staff_ops(client, start_iso: str, end_iso: str) -> AnalyticsStaffOps:
    rows = _fetch_paginated(lambda: client.table("staff_requests").select("type").gte("created_at", start_iso).lte("created_at", end_iso))
    general_count = sum(1 for r in rows if r["type"] == StaffRequestType.QUESTION.value)
    emergency_count = sum(1 for r in rows if r["type"] == StaffRequestType.EMERGENCY.value)
    return AnalyticsStaffOps(total_requests=len(rows), general_count=general_count, emergency_count=emergency_count)
