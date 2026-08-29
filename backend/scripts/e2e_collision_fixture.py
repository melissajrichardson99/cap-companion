"""Test-only fixture for scan.spec.ts's manual-entry collision test (the
"unified scan resolution" describe block) -- temporarily makes the existing
Scoring Sheet slug "farm-toss" also exist as a scannable_codes code, so
resolve_manual_entry() (app/services/scan.py) has a genuine two-source
collision to 409 on, then removes it again. Not something the app itself, or
any real signage workflow, would ever do on its own -- scannable_codes has no
staff-facing creation UI (see check_slug_collisions.py's docstring), so this
reaches the DB directly with the same service-role client the other one-off
scripts in this directory use, the same way global-setup.ts already shells
out to reset_demo_data.py for e2e state.

    python backend/scripts/e2e_collision_fixture.py insert
    python backend/scripts/e2e_collision_fixture.py remove
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.supabase_client import get_supabase_client  # noqa: E402

# An existing Scoring Sheet slug (see seed.sql) -- reused as the colliding
# scannable_codes.code below, so the test's collision is between two *real*
# rows, not two synthetic ones.
COLLIDING_TEXT = "farm-toss"


def insert() -> None:
    client = get_supabase_client()
    entry_rows = client.table("encyclopedia_entries").select("id").limit(1).execute().data
    if not entry_rows:
        raise RuntimeError("No encyclopedia_entries row to attach the test fixture's scannable_codes row to")
    client.table("scannable_codes").insert(
        {"code": COLLIDING_TEXT, "encyclopedia_entry_id": entry_rows[0]["id"]}
    ).execute()
    print(f'Inserted colliding scannable_codes row for "{COLLIDING_TEXT}".')


def remove() -> None:
    client = get_supabase_client()
    client.table("scannable_codes").delete().eq("code", COLLIDING_TEXT).execute()
    print(f'Removed colliding scannable_codes row for "{COLLIDING_TEXT}".')


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("insert", "remove"):
        print(__doc__)
        raise SystemExit(1)
    (insert if sys.argv[1] == "insert" else remove)()
