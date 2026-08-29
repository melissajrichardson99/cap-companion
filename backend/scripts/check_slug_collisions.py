"""Checks every QR-routable identifier -- Hunt/Encyclopedia scannable_codes,
Scoring game slugs, Puzzle challenge slugs, and Our Animals slugs -- for a
collision across those four sources.

Nothing enforces this automatically today: scannable_codes, scoring_games.slug,
and puzzle_challenges.slug each have their own unique index, but that only
guards uniqueness *within* a table, and Our Animals slugs aren't DB-backed at
all (see app/services/collectibles.ANIMAL_SLUGS), so no single DB constraint
can span all four. A collision would make ScanEntryModal's manual-entry
lookup (GET /scan/lookup/{text}) 409 instead of resolving -- see
app/services/scan.py's resolve_manual_entry.

Run this manually whenever a new scannable code, scoring game, or puzzle
challenge is added via migration -- there's no staff-facing creation UI for
any of them yet that could otherwise catch this at creation time. Run from
anywhere with the backend venv active:

    python backend/scripts/check_slug_collisions.py

Exits non-zero if any collision is found.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.scan import find_cross_type_collisions  # noqa: E402


def main() -> int:
    collisions = find_cross_type_collisions()
    if not collisions:
        print("No cross-type slug/code collisions found.")
        return 0

    print("Cross-type collisions found -- each of these will 409 instead of resolving:")
    for text, kinds in collisions.items():
        print(f'  "{text}": {", ".join(kind.value for kind in kinds)}')
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
