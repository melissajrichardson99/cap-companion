"""One-off data migration: seed animal_photos from the existing static files.

Uploads every real photo currently bundled at
frontend/public/animals/<slug>/<n>.{jpg,png} into the new 'animal-photos'
Storage bucket and inserts a matching animal_photos row, preserving each
animal's existing display order. This is what backs "Our Animals" going
forward.

Deliberately does NOT touch or delete frontend/public/animals/ -- those
static files stay in place permanently, because Collectibles
(app/services/collectibles.py's PHOTO_POOL_SIZE) resolves straight against
them via animalContent.ts's imageCandidates() and is explicitly out of scope
for this migration.

Rerunnable: for each animal slug found on disk, deletes any existing
animal_photos rows (and their Storage objects) for that slug before
reinserting fresh ones, so it doesn't accumulate duplicates.

This is a real data migration (it is meant to run against production, so it
is NOT behind the dev-only DEV_SUPABASE_PROJECT_REFS guard) -- which is why
it never deletes anything without showing the plan first:

  1. It always prints a read-only plan first: the target project, and per
     animal the photos on disk, the existing rows that would be removed, and
     whether that animal will be reseeded or skipped.
  2. Animals staff have already changed through the Staff Page are SKIPPED,
     with the reason, unless --force is given: any staff-uploaded photo
     (staff uploads are stored as <slug>/<uuid>.<ext>, this script's as
     <slug>/<n>.<ext>), or this script's photos in a different order than
     on disk (a staff reorder). Reseeding those would silently erase that
     work.
  3. Nothing changes without --yes, or typing the project ref at the prompt
     when run interactively. --dry-run prints the plan and exits.

Run from anywhere with the backend venv active:

    python backend/scripts/migrate_animal_photos.py --dry-run
    python backend/scripts/migrate_animal_photos.py            # plan, then asks
    python backend/scripts/migrate_animal_photos.py --yes      # plan, then runs
    python backend/scripts/migrate_animal_photos.py --yes --force   # also reseed staff-changed animals

Requires migration 031_animal_photos.sql to have been applied to the target
Supabase project first (table + bucket must already exist).
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.animal_photos import BUCKET  # noqa: E402
from app.supabase_client import SUPABASE_URL, get_supabase_client  # noqa: E402

ANIMALS_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public" / "animals"

_NUMBERED_FILE_RE = re.compile(r"^(\d+)\.(jpg|jpeg|png|webp|gif)$", re.IGNORECASE)


def _numbered_photos(animal_dir: Path) -> list[Path]:
    candidates = []
    for path in animal_dir.iterdir():
        match = _NUMBERED_FILE_RE.match(path.name)
        if match:
            candidates.append((int(match.group(1)), path))
    candidates.sort(key=lambda pair: pair[0])
    return [path for _, path in candidates]


def _content_type_for(path: Path) -> str:
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }[path.suffix.lower()]


@dataclass
class AnimalPlan:
    slug: str
    photos: list[Path]
    existing_rows: list[dict] = field(default_factory=list)
    staff_uploaded: int = 0
    staff_reordered: bool = False

    @property
    def staff_changed(self) -> bool:
        return self.staff_uploaded > 0 or self.staff_reordered


def _is_script_seeded(storage_path: str) -> bool:
    return bool(_NUMBERED_FILE_RE.match(storage_path.rsplit("/", 1)[-1]))


def build_plan(client) -> list[AnimalPlan]:
    """Read-only: what a run would touch, per animal with photos on disk."""
    plans = []
    for animal_dir in sorted(p for p in ANIMALS_DIR.iterdir() if p.is_dir()):
        slug = animal_dir.name
        photos = _numbered_photos(animal_dir)
        if not photos:
            print(f"{slug}: no numbered photos found, skipping.")
            continue
        rows = (
            client.table("animal_photos")
            .select("id,storage_path,display_order")
            .eq("animal_slug", slug)
            .order("display_order")
            .execute()
            .data
        )
        seeded_in_order = [r["storage_path"] for r in rows if _is_script_seeded(r["storage_path"])]
        on_disk_order = [f"{slug}/{p.name}" for p in photos if f"{slug}/{p.name}" in seeded_in_order]
        plans.append(
            AnimalPlan(
                slug=slug,
                photos=photos,
                existing_rows=rows,
                staff_uploaded=len(rows) - len(seeded_in_order),
                staff_reordered=seeded_in_order != on_disk_order,
            )
        )
    return plans


def _print_plan(plans: list[AnimalPlan], force: bool) -> None:
    print(f"Target project: {SUPABASE_URL}")
    print(f"{'animal':<26} {'on disk':>7} {'to remove':>9}  action")
    for p in plans:
        reasons = []
        if p.staff_uploaded:
            reasons.append(f"{p.staff_uploaded} staff-uploaded photo(s)")
        if p.staff_reordered:
            reasons.append("staff reordered its photos")
        if p.staff_changed and not force:
            action = "SKIP -- " + " and ".join(reasons) + " (--force to reseed anyway)"
            removed = 0
        else:
            action = "reseed" + (" (FORCED over " + " and ".join(reasons) + ")" if p.staff_changed else "")
            removed = len(p.existing_rows)
        print(f"{p.slug:<26} {len(p.photos):>7} {removed:>9}  {action}")


def migrate_animal_photos(*, dry_run: bool = False, yes: bool = False, force: bool = False) -> int:
    if not ANIMALS_DIR.is_dir():
        raise RuntimeError(f"Expected static animal photos at {ANIMALS_DIR}, found nothing")

    client = get_supabase_client()
    plans = build_plan(client)
    _print_plan(plans, force)
    todo = [p for p in plans if force or not p.staff_changed]

    if dry_run:
        print("Dry run: nothing changed.")
        return 0
    if not todo:
        print("Nothing to reseed.")
        return 0
    if not yes:
        expected = SUPABASE_URL.split("//", 1)[-1].split(".", 1)[0] if SUPABASE_URL else ""
        if not sys.stdin.isatty():
            print("REFUSED: not interactive and --yes not given -- nothing changed.", file=sys.stderr)
            return 2
        # isatty() alone isn't enough: on Windows a NUL stdin reports as a
        # terminal, and input() then hits end-of-file -- treat that (and
        # Ctrl-C) as "not confirmed".
        try:
            typed = input(f"Type the project ref ({expected}) to delete and reseed {len(todo)} animal(s): ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            typed = None
        if not expected or typed != expected:
            print("REFUSED: confirmation did not match -- nothing changed.", file=sys.stderr)
            return 2

    for plan in todo:
        slug, photos, existing_rows = plan.slug, plan.photos, plan.existing_rows
        if existing_rows:
            client.storage.from_(BUCKET).remove([r["storage_path"] for r in existing_rows])
            client.table("animal_photos").delete().eq("animal_slug", slug).execute()
            print(f"{slug}: cleared {len(existing_rows)} existing row(s) before reseeding.")

        for display_order, photo_path in enumerate(photos, start=1):
            storage_path = f"{slug}/{photo_path.name}"
            file_bytes = photo_path.read_bytes()
            client.storage.from_(BUCKET).upload(
                storage_path, file_bytes, {"content-type": _content_type_for(photo_path)}
            )
            client.table("animal_photos").insert(
                {"animal_slug": slug, "storage_path": storage_path, "display_order": display_order}
            ).execute()

        print(f"{slug}: seeded {len(photos)} photo(s).")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed animal_photos from frontend/public/animals (see module docstring).")
    parser.add_argument("--dry-run", action="store_true", help="print the plan and change nothing")
    parser.add_argument("--yes", action="store_true", help="proceed without the typed confirmation")
    parser.add_argument("--force", action="store_true", help="also reseed animals staff have changed (uploads/reorder)")
    args = parser.parse_args()
    sys.exit(migrate_animal_photos(dry_run=args.dry_run, yes=args.yes, force=args.force))
