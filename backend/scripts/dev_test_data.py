"""Shared, DEV-ONLY selection/counting/deletion of test data -- used by the
manual cleanup_dev_test_data.py and by the e2e run's setup/teardown
(e2e_run_cleanup.py). Never imported by the app itself.

Production guard (assert_dev_project): refuses to run unless SUPABASE_URL's
project ref (the `<ref>` in https://<ref>.supabase.co) is listed in the
DEV_SUPABASE_PROJECT_REFS env var (comma-separated, set in the local
backend/.env only -- never in Render's environment). It fails closed: unset,
empty, a non-*.supabase.co URL, or any ref not on the list all refuse. An
allow-list rather than a "not production" check, because nothing on a dev
machine reliably knows the production ref, and a typo in a deny-list would
fail open.

What counts as test data:
- device_sessions, except any linked to a guest whose email is NOT a test
  address (guest_id -> guests.email not ending in TEST_GUEST_EMAIL_SUFFIX):
  a real-looking account's history is left alone even on dev.
- Every row referencing those sessions. None of these FKs cascade from
  device_sessions, so they're deleted first (score_sheet_sessions' own
  score_entries / stroke_play_scores DO cascade from it). Passport group
  photos are removed from Storage before their rows, same ordering as
  reset_demo_data.py.
- guests with a test email (+ their guest_auth_tokens /
  password_reset_tokens, which cascade), once nothing references them.
- map_node_visit_events: anonymous (no session link), so it's selected by
  time only.

`since` narrows every selection to rows created at/after that instant (the
e2e teardown passes its run's start); None means everything that matches.
"""

from __future__ import annotations

import os
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from postgrest.types import CountMethod, ReturnMethod  # noqa: E402

from app.services.passport import BUCKET as PASSPORT_BUCKET  # noqa: E402
from app.supabase_client import SUPABASE_URL, get_supabase_client  # noqa: E402

ALLOWED_REFS_ENV = "DEV_SUPABASE_PROJECT_REFS"
TEST_GUEST_EMAIL_SUFFIX = "@example.com"

# Same id-list chunk size as session_cleanup.py / the old analytics code:
# comfortably under URL-length limits for an `in.(...)` filter.
_CHUNK = 200
_PAGE = 1000
# Deletes/counts for one chunk's child tables are independent of each
# other, so they run in parallel (the shared httpx client is thread-safe).
_WORKERS = 6

# (table, column referencing device_sessions.id). All must be emptied for a
# chunk before that chunk's device_sessions rows can go.
SESSION_CHILD_TABLES: tuple[tuple[str, str], ...] = (
    ("score_sheet_sessions", "device_session_id"),  # cascades score_entries, stroke_play_scores
    ("session_tile_completions", "session_id"),
    ("node_visits", "session_id"),
    ("hunt_progress", "session_id"),
    ("coin_awards", "session_id"),
    ("collectible_redemptions", "session_id"),
    ("puzzle_attempts", "session_id"),
    ("photo_votes", "session_id"),
    ("staff_requests", "session_id"),
    ("passport_sessions", "session_id"),
)

_NIL_UUID = "00000000-0000-0000-0000-000000000000"


class NotDevProjectError(RuntimeError):
    pass


def project_ref(url: str | None) -> str | None:
    host = urlparse(url or "").hostname or ""
    return host.split(".")[0] if host.endswith(".supabase.co") else None


def assert_dev_project() -> None:
    allowed = {r.strip() for r in os.environ.get(ALLOWED_REFS_ENV, "").split(",") if r.strip()}
    if not allowed:
        raise NotDevProjectError(
            f"{ALLOWED_REFS_ENV} is not set -- refusing to delete anything. Add the DEV project's ref "
            f"(the <ref> in https://<ref>.supabase.co) to backend/.env on a development machine only."
        )
    ref = project_ref(SUPABASE_URL)
    if ref is None or ref not in allowed:
        raise NotDevProjectError(
            f"SUPABASE_URL's project is not in {ALLOWED_REFS_ENV} -- refusing to delete anything "
            f"(this only ever runs against an explicitly allow-listed dev project)."
        )


@dataclass
class Selection:
    since: datetime | None
    session_ids: list[str] = field(default_factory=list)
    guest_ids: list[str] = field(default_factory=list)
    sessions_kept_for_real_guests: int = 0


def _chunks(ids: list[str]):
    for i in range(0, len(ids), _CHUNK):
        yield ids[i : i + _CHUNK]


def _paged(build) -> list[dict]:
    rows: list[dict] = []
    while True:
        page = build().range(len(rows), len(rows) + _PAGE - 1).execute().data
        rows.extend(page)
        if len(page) < _PAGE:
            return rows


def select(client, since: datetime | None = None) -> Selection:
    since_iso = since.isoformat() if since else None
    guests = _paged(lambda: client.table("guests").select("id,email,created_at").order("id"))
    real_guest_ids = {g["id"] for g in guests if not g["email"].lower().endswith(TEST_GUEST_EMAIL_SUFFIX)}
    test_guest_ids = [
        g["id"]
        for g in guests
        if g["id"] not in real_guest_ids and (since is None or datetime.fromisoformat(g["created_at"]) >= since)
    ]

    def sessions_query():
        q = client.table("device_sessions").select("id,guest_id").order("id")
        return q.gte("created_at", since_iso) if since_iso else q

    sessions = _paged(sessions_query)
    selection = Selection(since=since, guest_ids=test_guest_ids)
    for s in sessions:
        if s["guest_id"] in real_guest_ids:
            selection.sessions_kept_for_real_guests += 1
        else:
            selection.session_ids.append(s["id"])
    return selection


def _events_filter(query, since: datetime | None):
    return query.gte("visited_at", since.isoformat()) if since else query.neq("id", _NIL_UUID)


def count(client, selection: Selection) -> dict[str, int]:
    """Rows that delete() would remove, per table (read-only)."""
    counts = {table: 0 for table, _ in SESSION_CHILD_TABLES}

    def count_chunk(table: str, column: str, chunk: list[str]) -> tuple[str, int]:
        res = client.table(table).select("*", count=CountMethod.exact, head=True).in_(column, chunk).execute()
        return table, res.count or 0

    with ThreadPoolExecutor(_WORKERS) as pool:
        jobs = [
            pool.submit(count_chunk, table, column, chunk)
            for chunk in _chunks(selection.session_ids)
            for table, column in SESSION_CHILD_TABLES
        ]
        for job in jobs:
            table, n = job.result()
            counts[table] += n

    counts["device_sessions"] = len(selection.session_ids)
    counts["guests"] = len(selection.guest_ids)
    counts["map_node_visit_events"] = (
        _events_filter(client.table("map_node_visit_events").select("*", count=CountMethod.exact, head=True), selection.since)
        .execute()
        .count
        or 0
    )
    return counts


def _delete_in(client, table: str, column: str, ids: list[str]) -> int:
    res = client.table(table).delete(count=CountMethod.exact, returning=ReturnMethod.minimal).in_(column, ids).execute()
    return res.count or 0


def delete(client, selection: Selection) -> dict[str, int]:
    """Deletes everything count() reports, children before parents. Safe to
    re-run: every delete is by id list or time filter, so rows already gone
    are simply not matched."""
    deleted = {table: 0 for table, _ in SESSION_CHILD_TABLES}
    deleted["device_sessions"] = 0

    with ThreadPoolExecutor(_WORKERS) as pool:
        for chunk in _chunks(selection.session_ids):
            photo_paths = [
                r["photo_storage_path"]
                for r in client.table("passport_sessions").select("photo_storage_path").in_("session_id", chunk).execute().data
                if r["photo_storage_path"]
            ]
            if photo_paths:
                client.storage.from_(PASSPORT_BUCKET).remove(photo_paths)
            jobs = {table: pool.submit(_delete_in, client, table, column, chunk) for table, column in SESSION_CHILD_TABLES}
            for table, job in jobs.items():
                deleted[table] += job.result()
            deleted["device_sessions"] += _delete_in(client, "device_sessions", "id", chunk)

    # A test guest can only go once nothing references it any more (a
    # session or passport outside this selection, e.g. created before
    # `since`, keeps it -- reported, not forced).
    deleted["guests"] = 0
    deleted["guests_kept_still_referenced"] = 0
    for chunk in _chunks(selection.guest_ids):
        referenced = {
            r["guest_id"] for r in client.table("device_sessions").select("guest_id").in_("guest_id", chunk).execute().data
        } | {r["guest_id"] for r in client.table("passport_sessions").select("guest_id").in_("guest_id", chunk).execute().data}
        free = [g for g in chunk if g not in referenced]
        deleted["guests_kept_still_referenced"] += len(chunk) - len(free)
        if free:
            deleted["guests"] += _delete_in(client, "guests", "id", free)

    deleted["map_node_visit_events"] = (
        _events_filter(client.table("map_node_visit_events").delete(count=CountMethod.exact, returning=ReturnMethod.minimal), selection.since)
        .execute()
        .count
        or 0
    )
    return deleted


def client_for_dev() -> object:
    """The Supabase client, only after the dev-project guard passes."""
    assert_dev_project()
    return get_supabase_client()
