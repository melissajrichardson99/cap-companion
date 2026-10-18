"""Batch-generates every park QR sign in one folder -- the same set the
Staff QR Code Directory lists:

    animal-<slug>.png    <base URL>/animals/<slug>     all 20 Our Animals
    hunt-<name>.png      <base URL>/scan/<code>        each Hunt character
    scoring-<slug>.png   <base URL>/scoring/<slug>     every scoring sheet,
                                                       incl. both mini golf
    puzzle-<slug>.png    <base URL>/puzzles/<slug>     every puzzle challenge

plus one manifest.csv. Encyclopedia placeholder codes are left out, as in
the directory (generate_qr_codes.py still has them). Refuses to write if
either mini golf sheet (blacklight-mini-golf, cornhole-mini-golf) is
missing from the database it reads -- e.g. a project without migration 043.

The base URL is required and checked -- see scripts/qr_output.py. Hunt,
scoring and puzzle entries are read from the Supabase project backend/.env
points at (printed first). Run from anywhere with the backend venv active:

    python backend/scripts/generate_all_qr_codes.py --base-url https://<domain> [output_dir]
    python backend/scripts/generate_all_qr_codes.py --verify [output_dir]

output_dir defaults to backend/scripts/output/all_qr_codes/.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate_animal_qr_codes import animal_entries  # noqa: E402
from generate_hunt_qr_codes import hunt_entries  # noqa: E402
from qr_output import QrEntry, add_arguments, run  # noqa: E402

from app.supabase_client import get_supabase_client  # noqa: E402

DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "all_qr_codes"
REQUIRED_SCORING_SLUGS = ("blacklight-mini-golf", "cornhole-mini-golf")


def scoring_entries(client) -> list[QrEntry]:
    rows = client.table("scoring_games").select("name, slug").order("created_at").execute().data
    missing = [s for s in REQUIRED_SCORING_SLUGS if s not in {r["slug"] for r in rows}]
    if missing:
        raise SystemExit(f"REFUSED: scoring_games has no {', '.join(missing)} -- is migration 043 applied to this project?")
    return [
        QrEntry(file=f"scoring-{r['slug']}.png", kind="scoring", name=r["name"], id=r["slug"], path=f"/scoring/{r['slug']}")
        for r in rows
    ]


def puzzle_entries(client) -> list[QrEntry]:
    puzzles = {p["id"]: p["name"] for p in client.table("puzzles").select("id, name").execute().data}
    rows = client.table("puzzle_challenges").select("puzzle_id, label, slug").order("sort_order").execute().data
    return [
        QrEntry(
            file=f"puzzle-{r['slug']}.png",
            kind="puzzle",
            name=f"{puzzles.get(r['puzzle_id'], '?')} -- {r['label']}",
            id=r["slug"],
            path=f"/puzzles/{r['slug']}",
        )
        for r in rows
    ]


def all_entries() -> list[QrEntry]:
    entries = animal_entries("animal-{slug}.png") + hunt_entries("hunt-{slug}.png")
    client = get_supabase_client()
    return entries + scoring_entries(client) + puzzle_entries(client)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Every park QR sign in one folder (see module docstring).")
    add_arguments(parser, DEFAULT_OUTPUT_DIR)
    sys.exit(run(parser.parse_args(), all_entries))
