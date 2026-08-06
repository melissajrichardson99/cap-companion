"""Batch-generates a printable QR PNG for every scannable code.

For one-off/testing use, GET /scan/{code}/qr.png returns a single PNG. This
script is for printing every sign at once ahead of a park install. Run from
anywhere with the backend venv active:

    python backend/scripts/generate_qr_codes.py [output_dir]

output_dir defaults to backend/scripts/output/qr_codes/. Each file is named
<code>.png (e.g. brave-otter.png) so it's obvious which sign it belongs to.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.qr import generate_qr_png, scan_url  # noqa: E402
from app.supabase_client import get_supabase_client  # noqa: E402

DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "qr_codes"


def generate_all(output_dir: Path) -> None:
    client = get_supabase_client()
    codes = [row["code"] for row in client.table("scannable_codes").select("code").execute().data]

    output_dir.mkdir(parents=True, exist_ok=True)
    for code in codes:
        png_path = output_dir / f"{code}.png"
        png_path.write_bytes(generate_qr_png(code))
        print(f"{code} -> {png_path} ({scan_url(code)})")

    print(f"Generated {len(codes)} QR code(s) in {output_dir}")


if __name__ == "__main__":
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT_DIR
    generate_all(out_dir)
