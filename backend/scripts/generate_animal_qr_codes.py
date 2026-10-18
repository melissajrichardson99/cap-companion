"""Batch-generates a printable QR PNG for each Our Animals enclosure sign.

Unlike the Hunt QR scripts (generate_qr_codes.py, generate_hunt_qr_codes.py),
these encode <base URL>/animals/<slug> -- a deep link straight into
that animal's AnimalDetailScreen -- not a /scan/<code> Hunt URL. Deliberately
a separate URL scheme/namespace from Hunt (see app/services/qr.py) so the 5
animals that are also Hunt characters (Capybara, Kangaroo, Sloth, Pig, Snake) never
collide with a Hunt scan code. No Supabase lookup needed: Our Animals content
is a static frontend constant (frontend/src/animalContent.ts), not
backend/DB-backed, so the slugs below are just a hardcoded mirror of that
file's ANIMAL_DEFINITIONS -- keep the two in sync if animals are added/renamed
(checked against app/services/animals.py's ANIMAL_SLUGS on every run).

The base URL is required and checked -- see scripts/qr_output.py. Named
<slug>-qr.png, same convention as generate_hunt_qr_codes.py, with a
manifest.csv alongside. Run from anywhere with the backend venv active:

    python backend/scripts/generate_animal_qr_codes.py --base-url https://<domain> [output_dir]
    python backend/scripts/generate_animal_qr_codes.py --verify [output_dir]

output_dir defaults to backend/scripts/output/animal_qr_codes/.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from qr_output import QrEntry, add_arguments, run  # noqa: E402

from app.services.animals import ANIMAL_SLUGS  # noqa: E402

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
    ("Wallaroo", "wallaroo"),
    ("Tamandua (Anteater)", "tamandua"),
    ("Sugar Glider", "sugar-glider"),
    ("Tortoise", "tortoise"),
    ("Iguana", "iguana"),
    ("Snake", "snake"),
    ("Sheep", "sheep"),
    ("Rabbit", "rabbit"),
    ("Ferret", "ferret"),
    ("Chicken", "chicken"),
    ("Duck", "duck"),
]


def animal_entries(file_pattern: str = "{slug}-qr.png") -> list[QrEntry]:
    slugs = [slug for _, slug in ANIMALS]
    if slugs != ANIMAL_SLUGS:
        raise SystemExit("ANIMALS here is out of sync with app/services/animals.py ANIMAL_SLUGS -- fix that first.")
    return [
        QrEntry(file=file_pattern.format(slug=slug), kind="animal", name=name, id=slug, path=f"/animals/{slug}")
        for name, slug in ANIMALS
    ]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="QR PNGs for the 20 Our Animals signs (see module docstring).")
    add_arguments(parser, DEFAULT_OUTPUT_DIR)
    sys.exit(run(parser.parse_args(), animal_entries))
