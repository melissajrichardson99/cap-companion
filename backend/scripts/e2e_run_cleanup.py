"""Removes the test data an e2e run creates (dev project only), called from
Playwright's globalSetup ("begin") and globalTeardown ("end") -- see
frontend/e2e/global-setup.ts / global-teardown.ts.

    python scripts/e2e_run_cleanup.py begin   # before the run
    python scripts/e2e_run_cleanup.py end     # after the run

"begin" records the run's start (backend/scripts/output/, gitignored);
"end" deletes everything created since then (sessions + their rows, test
guests, map_node_visit_events -- dev_test_data.py) and removes the marker.
If "begin" finds a marker already there, the previous run never reached its
teardown (killed/interrupted), so it cleans that run's leftovers first.

The start time is taken a couple of minutes early so local/DB clock skew
can't leave a run's first rows behind; the cost is that anything made by
hand on dev in those two minutes goes too.

Never fails the test run: if the dev-project guard refuses (e.g.
DEV_SUPABASE_PROJECT_REFS isn't set) or a delete errors, it prints why and
exits 0 -- skipping a cleanup is always the safe direction, and
cleanup_dev_test_data.py can catch up later.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import dev_test_data

MARKER = Path(__file__).resolve().parent / "output" / "e2e-run-marker.json"
CLOCK_SKEW_MARGIN = timedelta(minutes=2)


def _clean_since(since: datetime, label: str) -> None:
    client = dev_test_data.client_for_dev()
    started = time.perf_counter()
    selection = dev_test_data.select(client, since)
    deleted = dev_test_data.delete(client, selection)
    summary = ", ".join(f"{n} {table}" for table, n in deleted.items() if n)
    print(f"e2e cleanup ({label}): {summary or 'nothing to delete'} in {time.perf_counter() - started:.1f}s")


def begin() -> None:
    if MARKER.exists():
        since = datetime.fromisoformat(json.loads(MARKER.read_text())["since"])
        _clean_since(since, "leftovers from an interrupted run")
    MARKER.parent.mkdir(parents=True, exist_ok=True)
    MARKER.write_text(json.dumps({"since": (datetime.now(timezone.utc) - CLOCK_SKEW_MARGIN).isoformat()}))


def end() -> None:
    if not MARKER.exists():
        print("e2e cleanup: no run marker (setup didn't record one) -- skipping")
        return
    since = datetime.fromisoformat(json.loads(MARKER.read_text())["since"])
    _clean_since(since, "this run")
    MARKER.unlink()


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in ("begin", "end"):
        print("usage: e2e_run_cleanup.py begin|end", file=sys.stderr)
        return 2
    try:
        # Guard first, so a refused run doesn't even record a marker.
        dev_test_data.assert_dev_project()
        begin() if sys.argv[1] == "begin" else end()
    except dev_test_data.NotDevProjectError as exc:
        print(f"e2e cleanup SKIPPED: {exc}")
    except Exception as exc:  # never fail the test run over cleanup
        print(f"e2e cleanup FAILED (run cleanup_dev_test_data.py later): {exc!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
