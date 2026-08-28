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

Idempotent/rerunnable: for each animal slug found on disk, deletes any
existing animal_photos rows (and their Storage objects) for that slug before
reinserting fresh ones, so running this again after a static-file update is
safe and doesn't accumulate duplicates.

Run from anywhere with the backend venv active:

    python backend/scripts/migrate_animal_photos.py

Requires migration 031_animal_photos.sql to have been applied to the target
Supabase project first (table + bucket must already exist).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.animal_photos import BUCKET  # noqa: E402
from app.supabase_client import get_supabase_client  # noqa: E402

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


def migrate_animal_photos() -> None:
    if not ANIMALS_DIR.is_dir():
        raise RuntimeError(f"Expected static animal photos at {ANIMALS_DIR}, found nothing")

    client = get_supabase_client()

    for animal_dir in sorted(p for p in ANIMALS_DIR.iterdir() if p.is_dir()):
        slug = animal_dir.name
        photos = _numbered_photos(animal_dir)
        if not photos:
            print(f"{slug}: no numbered photos found, skipping.")
            continue

        existing_rows = client.table("animal_photos").select("id,storage_path").eq("animal_slug", slug).execute().data
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


if __name__ == "__main__":
    migrate_animal_photos()
