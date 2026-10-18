"""Batch-generates a printable QR PNG for every scannable code.

For one-off/testing use, GET /scan/{code}/qr.png returns a single PNG. This
script dumps every scannable_codes row -- Hunt characters and the
Encyclopedia placeholder codes alike -- each encoding <base URL>/scan/<code>.
For the full set of park signs (animals, Hunt, scoring sheets, puzzles) use
generate_all_qr_codes.py instead.

The base URL is required and checked -- see scripts/qr_output.py. The codes
are read from the Supabase project backend/.env points at (printed first).
Run from anywhere with the backend venv active:

    python backend/scripts/generate_qr_codes.py --base-url https://<domain> [output_dir]
    python backend/scripts/generate_qr_codes.py --verify [output_dir]

output_dir defaults to backend/scripts/output/qr_codes/. Each file is named
<code>.png (e.g. brave-otter.png) so it's obvious which sign it belongs to.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from qr_output import QrEntry, add_arguments, run  # noqa: E402

from app.supabase_client import SUPABASE_URL, get_supabase_client  # noqa: E402

DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "qr_codes"


def scan_code_entries() -> list[QrEntry]:
    print(f"Reading scan codes from: {SUPABASE_URL}")
    client = get_supabase_client()
    rows = client.table("scannable_codes").select("code, hunt_character_id").order("code").execute().data
    return [
        QrEntry(
            file=f"{row['code']}.png",
            kind="scan-code",
            name="Hunt character" if row["hunt_character_id"] else "Encyclopedia placeholder",
            id=row["code"],
            path=f"/scan/{row['code']}",
        )
        for row in rows
    ]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="QR PNGs for every scannable code (see module docstring).")
    add_arguments(parser, DEFAULT_OUTPUT_DIR)
    sys.exit(run(parser.parse_args(), scan_code_entries))
