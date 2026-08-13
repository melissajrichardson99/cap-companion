"""Batch-generates a printable QR PNG for each Scavenger Hunt character's scan code.

Unlike generate_qr_codes.py (which dumps every scannable_codes row --
hunt characters and Encyclopedia stubs alike -- named by the opaque signage
code), this is scoped to just the 5 hunt characters and named by character
so Melissa can tell them apart at a glance while printing/testing:
<slug>-qr.png where slug is the lowercased character name (e.g.
capybara-qr.png). Run from anywhere with the backend venv active:

    python backend/scripts/generate_hunt_qr_codes.py [output_dir]

output_dir defaults to backend/scripts/output/hunt_qr_codes/.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.qr import generate_qr_png, scan_url  # noqa: E402
from app.supabase_client import get_supabase_client  # noqa: E402

DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "hunt_qr_codes"


def generate_all(output_dir: Path) -> None:
    client = get_supabase_client()
    char_rows = client.table("hunt_characters").select("id, name").order("sort_order").execute().data
    code_rows = client.table("scannable_codes").select("code, hunt_character_id").execute().data

    code_by_character_id = {row["hunt_character_id"]: row["code"] for row in code_rows if row["hunt_character_id"]}

    output_dir.mkdir(parents=True, exist_ok=True)
    for character in char_rows:
        code = code_by_character_id.get(character["id"])
        if not code:
            print(f"Skipping {character['name']}: no scannable_codes row found")
            continue

        slug = character["name"].lower()
        png_path = output_dir / f"{slug}-qr.png"
        png_path.write_bytes(generate_qr_png(code))
        print(f"{character['name']} ({code}) -> {png_path} ({scan_url(code)})")

    print(f"Generated {len(code_by_character_id)} QR code(s) in {output_dir}")


if __name__ == "__main__":
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT_DIR
    generate_all(out_dir)
