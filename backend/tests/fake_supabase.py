"""In-memory stand-in for the supabase-py client, just wide enough for the
routes the reference-cache tests drive end to end (tests/
test_reference_cache_routes.py): table().select/eq/neq/in_/lte/gte/lt/is_/
order/limit plus insert/update/delete/upsert, one embedded relation
(photo_submissions -> photo_votes), and storage get_public_url/upload/remove.

Every execute() is recorded in `reads`/`writes` by table, which is how the
tests tell a cache hit (no read) from a miss.
"""

from __future__ import annotations

import collections
import copy
import re
import uuid
from datetime import datetime, timedelta, timezone

_EMBEDS = {("photo_submissions", "photo_votes"): "submission_id"}

_clock = {"t": datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)}


def _now_iso() -> str:
    _clock["t"] += timedelta(milliseconds=1)
    return _clock["t"].isoformat()


# Column defaults Postgres would fill in on insert.
_DEFAULTS = {
    "device_sessions": lambda: {"created_at": _now_iso(), "guest_id": None},
    "announcements": lambda: {"created_at": _now_iso(), "updated_at": _now_iso()},
    "photo_submissions": lambda: {"submitted_at": _now_iso(), "status": "pending_review", "email": None},
    "passport_sessions": lambda: {"generated_at": _now_iso()},
    "animal_photos": lambda: {"created_at": _now_iso()},
    "session_tile_completions": lambda: {"completed_at": _now_iso()},
    "node_visits": lambda: {"visited_at": _now_iso()},
    "coin_awards": lambda: {"created_at": _now_iso()},
    "hunt_progress": lambda: {"challenges_completed": [], "completed_at": None, "unlocked_at": None},
}


def _split_top_level(cols: str) -> list[str]:
    parts, depth, cur = [], 0, ""
    for ch in cols:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur.strip())
    return parts


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db: "FakeSupabase", table: str):
        self.db = db
        self.table = table
        self.op = "select"
        self.cols = "*"
        self.filters: list = []
        self.orders: list = []
        self.limit_n = None
        self.payload = None
        self.on_conflict = None
        self.ignore_duplicates = False

    # --- builders ---
    def select(self, cols="*", **_):
        self.cols = cols
        return self

    def insert(self, payload, **_):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload, **_):
        self.op, self.payload = "update", payload
        return self

    def delete(self, **_):
        self.op = "delete"
        return self

    def upsert(self, payload, on_conflict=None, ignore_duplicates=False, **_):
        self.op, self.payload = "upsert", payload
        self.on_conflict, self.ignore_duplicates = on_conflict, ignore_duplicates
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def neq(self, col, val):
        self.filters.append(lambda r: r.get(col) != val)
        return self

    def in_(self, col, vals):
        vals = set(vals)
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def lte(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and r.get(col) <= val)
        return self

    def lt(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and r.get(col) < val)
        return self

    def gte(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and r.get(col) >= val)
        return self

    def is_(self, col, val):
        assert val == "null"
        self.filters.append(lambda r: r.get(col) is None)
        return self

    def order(self, col, desc=False):
        self.orders.append((col, desc))
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    # --- execution ---
    def _matching(self) -> list[dict]:
        return [r for r in self.db.tables[self.table] if all(f(r) for f in self.filters)]

    def _project(self, row: dict) -> dict:
        out: dict = {}
        for part in _split_top_level(self.cols):
            m = re.fullmatch(r"(\w+)\((.*)\)", part)
            if m:
                child, child_cols = m.group(1), m.group(2)
                fk = _EMBEDS[(self.table, child)]
                children = [c for c in self.db.tables[child] if c.get(fk) == row["id"]]
                out[child] = [{k: c.get(k) for k in _split_top_level(child_cols)} for c in children]
            elif part == "*":
                out.update(row)
            else:
                out[part] = row.get(part)
        return copy.deepcopy(out)

    def execute(self):
        rows_table = self.db.tables[self.table]
        if self.op == "select":
            self.db.reads[self.table] += 1
            rows = self._matching()
            for col, desc in reversed(self.orders):
                rows = sorted(rows, key=lambda r: (r.get(col) is None, r.get(col)), reverse=desc)
            if self.limit_n is not None:
                rows = rows[: self.limit_n]
            return _Resp([self._project(r) for r in rows])

        self.db.writes[self.table] += 1
        if self.op == "insert":
            payloads = self.payload if isinstance(self.payload, list) else [self.payload]
            out = []
            for p in payloads:
                row = {"id": str(uuid.uuid4()), **_DEFAULTS.get(self.table, dict)(), **copy.deepcopy(p)}
                rows_table.append(row)
                out.append(copy.deepcopy(row))
            return _Resp(out)
        if self.op == "update":
            out = []
            for r in self._matching():
                r.update(copy.deepcopy(self.payload))
                out.append(copy.deepcopy(r))
            return _Resp(out)
        if self.op == "delete":
            doomed = self._matching()
            self.db.tables[self.table] = [r for r in rows_table if r not in doomed]
            return _Resp(copy.deepcopy(doomed))
        if self.op == "upsert":
            keys = [k.strip() for k in self.on_conflict.split(",")]
            existing = next((r for r in rows_table if all(r.get(k) == self.payload.get(k) for k in keys)), None)
            if existing is not None:
                if not self.ignore_duplicates:
                    existing.update(copy.deepcopy(self.payload))
                return _Resp([copy.deepcopy(existing)])
            row = {"id": str(uuid.uuid4()), **_DEFAULTS.get(self.table, dict)(), **copy.deepcopy(self.payload)}
            rows_table.append(row)
            return _Resp([copy.deepcopy(row)])
        raise AssertionError(self.op)


class _Bucket:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def get_public_url(self, path):
        return f"https://fake.supabase.co/storage/v1/object/public/{self.name}/{path}"

    def upload(self, path, content, options=None):
        self.db.storage_objects.add((self.name, path))
        self.db.storage_content_types[(self.name, path)] = (options or {}).get("content-type")

    def remove(self, paths):
        for p in paths:
            self.db.storage_objects.discard((self.name, p))


class _Storage:
    def __init__(self, db):
        self.db = db

    def from_(self, name):
        return _Bucket(self.db, name)


class FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = collections.defaultdict(list)
        self.reads: collections.Counter = collections.Counter()
        self.writes: collections.Counter = collections.Counter()
        self.storage_objects: set = set()
        self.storage_content_types: dict = {}
        self.storage = _Storage(self)

    def table(self, name):
        return _Query(self, name)

    def reset_counts(self):
        self.reads.clear()
        self.writes.clear()
