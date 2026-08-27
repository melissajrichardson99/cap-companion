"""Resolves a scanned/manually-entered code to its Hunt character or
Encyclopedia entry -- app.services.scan_codes owns the code format itself.

This is Hunt's QR-scan/deep-link entry point: a guest's camera app opening a
printed sign's <frontend_base_url>/scan/:code URL hits GET /scan/{code}
directly, with no prior in-app navigation. The device session is still
established correctly on that path -- the frontend's request() helper
attaches the X-Device-Session header (minting a token into localStorage on
first use if none exists yet) on every API call unconditionally, including
this one, so a fresh device landing straight on a deep link gets a session
the same way normal in-app navigation does. This endpoint just needs to
actually thread that session_id through to hunt_service.get_character so the
resolved character reflects *this session's* found/unlocked status, same as
every other Hunt read since migration 030."""

from __future__ import annotations

from uuid import UUID

from app.errors import NotFoundError
from app.models import EncyclopediaEntry, ScanResult, ScanResultType
from app.services import hunt as hunt_service
from app.services.scan_codes import normalize_code
from app.supabase_client import get_supabase_client


def _row_to_entry(row: dict) -> EncyclopediaEntry:
    return EncyclopediaEntry(id=row["id"], animal_name=row["animal_name"], status=row["status"])


def resolve_code(raw_code: str, session_id: UUID | None) -> ScanResult:
    client = get_supabase_client()
    code = normalize_code(raw_code)

    rows = client.table("scannable_codes").select("*").eq("code", code).execute().data
    if not rows:
        raise NotFoundError(f'No scannable code "{code}" found')
    row = rows[0]

    if row["hunt_character_id"]:
        character = hunt_service.get_character(row["hunt_character_id"], session_id)
        return ScanResult(type=ScanResultType.HUNT_CHARACTER, target=character)

    entry_rows = (
        client.table("encyclopedia_entries").select("*").eq("id", row["encyclopedia_entry_id"]).execute().data
    )
    if not entry_rows:
        raise NotFoundError(f'Encyclopedia entry for code "{code}" not found')
    return ScanResult(type=ScanResultType.ENCYCLOPEDIA_ENTRY, target=_row_to_entry(entry_rows[0]))
