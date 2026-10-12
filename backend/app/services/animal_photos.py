"""Orchestration for staff-managed Animal Photos (Our Animals page).

Staff-only upload/delete/reorder of permanent reference photos per animal --
distinct from Favorite Photo's guest-submitted, moderation-queued content
(app/services/photos.py): no status column here, since staff uploading
directly IS the approval. Also distinct from Collectibles' curated photo
pool (app/services/collectibles.py's PHOTO_POOL_SIZE), which continues to
resolve straight against the static files in frontend/public/animals/ via
animalContent.ts's imageCandidates() -- nothing here feeds into that.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from app import reference_cache
from app.errors import NotFoundError, ValidationError
from app.models import AnimalPhoto
from app.supabase_client import get_supabase_client

BUCKET = "animal-photos"

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_FILE_BYTES = 10 * 1024 * 1024


def _photo_url(storage_path: str) -> str:
    client = get_supabase_client()
    return client.storage.from_(BUCKET).get_public_url(storage_path)


def _row_to_photo(row: dict) -> AnimalPhoto:
    return AnimalPhoto(
        id=row["id"],
        animal_slug=row["animal_slug"],
        photo_url=_photo_url(row["storage_path"]),
        display_order=row["display_order"],
    )


def list_all() -> list[AnimalPhoto]:
    # Shared by every guest, so cached (app/reference_cache.py); upload,
    # delete and reorder invalidate it before returning. photo_url is a
    # public (non-expiring) Storage URL built locally from storage_path, so
    # nothing in here goes stale on its own.
    client = get_supabase_client()
    rows = reference_cache.get(
        reference_cache.ANIMAL_PHOTOS,
        lambda: client.table("animal_photos").select("*").order("animal_slug").order("display_order").execute().data,
    )
    return [_row_to_photo(r) for r in rows]


def _get_row(photo_id: UUID) -> dict:
    client = get_supabase_client()
    rows = client.table("animal_photos").select("*").eq("id", str(photo_id)).execute().data
    if not rows:
        raise NotFoundError(f"Animal photo {photo_id} not found")
    return rows[0]


def upload(animal_slug: str, filename: str, content_type: str, file_bytes: bytes) -> AnimalPhoto:
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise ValidationError(f"Unsupported file type '{content_type}' -- must be one of {sorted(ALLOWED_CONTENT_TYPES)}")
    if len(file_bytes) > MAX_FILE_BYTES:
        raise ValidationError(f"File is too large -- max {MAX_FILE_BYTES // (1024 * 1024)}MB")

    client = get_supabase_client()
    existing = (
        client.table("animal_photos")
        .select("display_order")
        .eq("animal_slug", animal_slug)
        .order("display_order", desc=True)
        .limit(1)
        .execute()
        .data
    )
    next_order = (existing[0]["display_order"] + 1) if existing else 1

    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    storage_path = f"{animal_slug}/{uuid4()}.{suffix}"
    client.storage.from_(BUCKET).upload(storage_path, file_bytes, {"content-type": content_type})
    try:
        row = (
            client.table("animal_photos")
            .insert({"animal_slug": animal_slug, "storage_path": storage_path, "display_order": next_order})
            .execute()
            .data[0]
        )
    finally:
        reference_cache.invalidate(reference_cache.ANIMAL_PHOTOS)
    return _row_to_photo(row)


def delete(photo_id: UUID) -> None:
    row = _get_row(photo_id)
    client = get_supabase_client()
    try:
        client.storage.from_(BUCKET).remove([row["storage_path"]])
        client.table("animal_photos").delete().eq("id", str(photo_id)).execute()
    finally:
        reference_cache.invalidate(reference_cache.ANIMAL_PHOTOS)


def reorder(animal_slug: str, photo_ids: list[UUID]) -> list[AnimalPhoto]:
    client = get_supabase_client()
    rows = client.table("animal_photos").select("*").eq("animal_slug", animal_slug).execute().data
    existing_ids = {row["id"] for row in rows}
    submitted_ids = {str(pid) for pid in photo_ids}
    if submitted_ids != existing_ids:
        raise ValidationError(f"Submitted photo ids don't match {animal_slug}'s current photo set")

    try:
        for display_order, photo_id in enumerate(photo_ids, start=1):
            client.table("animal_photos").update({"display_order": display_order}).eq("id", str(photo_id)).execute()
    finally:
        # Even after a partial failure, so guests never keep a cached order
        # that no longer matches the database.
        reference_cache.invalidate(reference_cache.ANIMAL_PHOTOS)

    return list_for_animal(animal_slug)


def list_for_animal(animal_slug: str) -> list[AnimalPhoto]:
    client = get_supabase_client()
    rows = (
        client.table("animal_photos")
        .select("*")
        .eq("animal_slug", animal_slug)
        .order("display_order")
        .execute()
        .data
    )
    return [_row_to_photo(r) for r in rows]
