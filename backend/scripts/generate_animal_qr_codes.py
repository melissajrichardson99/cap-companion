"""Batch-generates a printable QR PNG for each Our Animals enclosure sign.

Unlike the Hunt QR scripts (generate_qr_codes.py, generate_hunt_qr_codes.py),
these encode <FRONTEND_BASE_URL>/animals/<slug> -- a deep link straight into
that animal's AnimalDetailScreen -- not a /scan/<code> Hunt URL. Deliberately
a separate URL scheme/namespace from Hunt (see app/services/qr.py) so the 4
animals that are also Hunt characters (Capybara, Kangaroo, Sloth, Pig) never
collide with a Hunt scan code. No Supabase lookup needed: Our Animals content
is a static frontend constant (frontend/src/animalContent.ts), not
backend/DB-backed, so the slugs below are just a hardcoded mirror of that
file's ANIMAL_DEFINITIONS -- keep the two in sync if animals are added/renamed.

Named <slug>-qr.png, same convention as generate_hunt_qr_codes.py. Run from
anywhere with the backend venv active:

    python backend/scripts/generate_animal_qr_codes.py [output_dir]

output_dir defaults to backend/scripts/output/animal_qr_codes/.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.qr import animal_url, generate_qr_png_for_url  # noqa: E402

DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "animal_qr_codes"

# Mirrors frontend/src/animalContent.ts ANIMAL_DEFINITIONS (name, slug).
ANIMALS = [
    ("Capybara", "capybara"),
    ("Kangaroo", "kangaroo"),
    ("Alpaca", "alpaca"),
    ("Emu", "emu"),
    ("Wallaby", "wallaby"),
    ("Goat", "goat"),
    ("Sloth", "sloth"),
    ("Porcupine", "porcupine"),
    ("Pig", "pig"),
]


def generate_all(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, slug in ANIMALS:
        url = animal_url(slug)
        png_path = output_dir / f"{slug}-qr.png"
        png_path.write_bytes(generate_qr_png_for_url(url))
        print(f"{name} ({slug}) -> {png_path} ({url})")

    print(f"Generated {len(ANIMALS)} QR code(s) in {output_dir}")


if __name__ == "__main__":
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT_DIR
    generate_all(out_dir)
