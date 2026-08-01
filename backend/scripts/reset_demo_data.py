"""Dev-only reset for the "Demo Family" bingo card + all map nodes.

Not an API endpoint on purpose — this is for repeatedly re-running through
the app during manual/QA testing, not something the app itself should ever
trigger. Run from anywhere with the backend venv active:

    python backend/scripts/reset_demo_data.py

Resets:
  - every bingo_tiles row on the "Demo Family" card: completed = false,
    completed_at = null
  - that card's milestone_lines/milestone_x/milestone_blackout back to none
  - every map_nodes row (all cards share the same map): state = 'not_visited'
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.supabase_client import get_supabase_client  # noqa: E402

DEMO_CARD_OWNER_LABEL = "Demo Family"


def reset_demo_data() -> None:
    client = get_supabase_client()

    card_rows = client.table("bingo_cards").select("id").eq("owner_label", DEMO_CARD_OWNER_LABEL).execute().data
    if not card_rows:
        raise RuntimeError(f'No bingo card found with owner_label "{DEMO_CARD_OWNER_LABEL}"')
    card_id = card_rows[0]["id"]

    tile_rows = (
        client.table("bingo_tiles")
        .update({"completed": False, "completed_at": None})
        .eq("card_id", card_id)
        .execute()
        .data
    )
    print(f"Reset {len(tile_rows)} bingo tile(s) on the '{DEMO_CARD_OWNER_LABEL}' card.")

    client.table("bingo_cards").update(
        {"milestone_lines": [], "milestone_x": False, "milestone_blackout": False}
    ).eq("id", card_id).execute()
    print(f"Cleared milestone state on the '{DEMO_CARD_OWNER_LABEL}' card.")

    # PostgREST rejects an UPDATE with no WHERE clause at all; `id <> the nil
    # UUID` is a standard no-op filter that matches every real row.
    node_rows = (
        client.table("map_nodes")
        .update({"state": "not_visited"})
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .execute()
        .data
    )
    print(f"Reset {len(node_rows)} map node(s) to not_visited.")


if __name__ == "__main__":
    reset_demo_data()
