"""Orchestration for the Announcements CRUD endpoints (Staff Page + Home Page +
guest-facing popup).

Deliberately no status/state machine (unlike staff_requests.py) -- an
announcement is just text that staff can create, edit, or delete outright.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from app import reference_cache
from app.errors import NotFoundError
from app.models import Announcement
from app.supabase_client import get_supabase_client


def _row_to_announcement(row: dict) -> Announcement:
    return Announcement(
        id=row["id"],
        text=row["text"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def list_announcements() -> list[Announcement]:
    # Shared by every guest, so cached (app/reference_cache.py); each write
    # below invalidates it before returning.
    client = get_supabase_client()
    rows = reference_cache.get(
        reference_cache.ANNOUNCEMENTS,
        lambda: client.table("announcements").select("*").order("created_at", desc=True).execute().data,
    )
    return [_row_to_announcement(r) for r in rows]


def create_announcement(text: str) -> Announcement:
    client = get_supabase_client()
    try:
        row = client.table("announcements").insert({"text": text}).execute().data[0]
    finally:
        reference_cache.invalidate(reference_cache.ANNOUNCEMENTS)
    return _row_to_announcement(row)


def update_announcement(announcement_id: UUID, text: str) -> Announcement:
    client = get_supabase_client()
    try:
        rows = (
            client.table("announcements")
            .update({"text": text, "updated_at": datetime.now(timezone.utc).isoformat()})
            .eq("id", str(announcement_id))
            .execute()
            .data
        )
    finally:
        reference_cache.invalidate(reference_cache.ANNOUNCEMENTS)
    if not rows:
        raise NotFoundError(f"Announcement {announcement_id} not found")
    return _row_to_announcement(rows[0])


def delete_announcement(announcement_id: UUID) -> None:
    client = get_supabase_client()
    try:
        rows = client.table("announcements").delete().eq("id", str(announcement_id)).execute().data
    finally:
        reference_cache.invalidate(reference_cache.ANNOUNCEMENTS)
    if not rows:
        raise NotFoundError(f"Announcement {announcement_id} not found")
