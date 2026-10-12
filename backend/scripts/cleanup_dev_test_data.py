"""Manual DEV-ONLY cleanup of accumulated test data (device sessions and
everything hanging off them, test guest accounts, and every
map_node_visit_events row). See dev_test_data.py for exactly what counts as
test data and how the production guard decides.

Dry run by default -- prints per-table counts and deletes nothing:

    python backend/scripts/cleanup_dev_test_data.py

Deleting needs the explicit flag:

    python backend/scripts/cleanup_dev_test_data.py --delete

Optionally only rows created at/after an instant (ISO 8601, with offset):

    python backend/scripts/cleanup_dev_test_data.py --since 2026-10-01T00:00:00+00:00

Why this exists: the scheduled session-cleanup job only calls the
PRODUCTION backend (.github/workflows/session-cleanup.yml), so the dev
project is never cleaned, and every full e2e run used to leave ~2,700
device sessions behind (the e2e run now removes its own data -- see
e2e_run_cleanup.py -- so this is for what accumulated before that, or after
an interrupted run).
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime

import dev_test_data


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--delete", action="store_true", help="actually delete (default: dry run, counts only)")
    parser.add_argument("--since", type=datetime.fromisoformat, default=None, help="only rows created at/after this ISO instant")
    args = parser.parse_args()
    if args.since is not None and args.since.tzinfo is None:
        parser.error("--since needs a UTC offset, e.g. 2026-10-01T00:00:00+00:00")

    try:
        client = dev_test_data.client_for_dev()
    except dev_test_data.NotDevProjectError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2

    selection = dev_test_data.select(client, args.since)
    scope = f"created since {args.since.isoformat()}" if args.since else "all"
    print(f"Dev project test data ({scope}):")
    if selection.sessions_kept_for_real_guests:
        print(f"  (keeping {selection.sessions_kept_for_real_guests} session(s) linked to non-test guest accounts)")

    if not args.delete:
        for table, n in dev_test_data.count(client, selection).items():
            print(f"  {table:<26} {n:>7}")
        print("Dry run: nothing deleted. Re-run with --delete to remove these rows.")
        return 0

    for table, n in dev_test_data.delete(client, selection).items():
        print(f"  {table:<28} {n:>7} deleted" if not table.endswith("_referenced") else f"  {table:<28} {n:>7}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
