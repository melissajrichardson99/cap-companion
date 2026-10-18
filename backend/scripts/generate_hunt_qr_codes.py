"""Batch-generates a printable QR PNG for each Scavenger Hunt character's scan code.

Unlike generate_qr_codes.py (which dumps every scannable_codes row --
hunt characters and Encyclopedia stubs alike -- named by the opaque signage
code), this is scoped to just the hunt characters and named by character
so Melissa can tell them apart at a glance while printing/testing:
<slug>-qr.png where slug is the lowercased character name (e.g.
capybara-qr.png). Each encodes <base URL>/scan/<code>.

The base URL is required and checked -- see scripts/qr_output.py. The
codes are read from the Supabase project backend/.env points at (printed
first). Run from anywhere with the backend venv active:

    python backend/scripts/generate_hunt_qr_codes.py --base-url https://<domain> [output_dir]
    python backend/scripts/generate_hunt_qr_codes.py --verify [output_dir]

output_dir defaults to backend/scripts/output/hunt_qr_codes/.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from qr_output import QrEntry, add_arguments, run  # noqa: E402

from app.supabase_client import SUPABASE_URL, get_supabase_client  # noqa: E402

DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "hunt_qr_codes"


def file_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def hunt_entries(file_pattern: str = "{slug}-qr.png") -> list[QrEntry]:
    print(f"Reading Hunt codes from: {SUPABASE_URL}")
    client = get_supabase_client()
    char_rows = client.table("hunt_characters").select("id, name").order("sort_order").execute().data
    code_rows = client.table("scannable_codes").select("code, hunt_character_id").execute().data
    code_by_character_id = {row["hunt_character_id"]: row["code"] for row in code_rows if row["hunt_character_id"]}

    entries = []
    for character in char_rows:
        code = code_by_character_id.get(character["id"])
        if not code:
            print(f"Skipping {character['name']}: no scannable_codes row found")
            continue
        entries.append(
            QrEntry(
                file=file_pattern.format(slug=file_slug(character["name"])),
                kind="hunt",
                name=character["name"],
                id=code,
                path=f"/scan/{code}",
            )
        )
    return entries


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="QR PNGs for the Scavenger Hunt characters (see module docstring).")
    add_arguments(parser, DEFAULT_OUTPUT_DIR)
    sys.exit(run(parser.parse_args(), hunt_entries))
