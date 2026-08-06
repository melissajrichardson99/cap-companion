"""Resolves a scanned/manually-entered code to its Hunt character or
Encyclopedia entry -- app.services.scan_codes owns the code format itself."""

from __future__ import annotations

from app.errors import NotFoundError
from app.models import EncyclopediaEntry, ScanResult, ScanResultType
from app.services import hunt as hunt_service
from app.services.scan_codes import normalize_code
from app.supabase_client import get_supabase_client


def _row_to_entry(row: dict) -> EncyclopediaEntry:
    return EncyclopediaEntry(id=row["id"], animal_name=row["animal_name"], status=row["status"])


def resolve_code(raw_code: str) -> ScanResult:
    client = get_supabase_client()
    code = normalize_code(raw_code)

    rows = client.table("scannable_codes").select("*").eq("code", code).execute().data
    if not rows:
        raise NotFoundError(f'No scannable code "{code}" found')
    row = rows[0]

    if row["hunt_character_id"]:
        character = hunt_service.get_character(row["hunt_character_id"])
        return ScanResult(type=ScanResultType.HUNT_CHARACTER, target=character)

    entry_rows = (
        client.table("encyclopedia_entries").select("*").eq("id", row["encyclopedia_entry_id"]).execute().data
    )
    if not entry_rows:
        raise NotFoundError(f'Encyclopedia entry for code "{code}" not found')
    return ScanResult(type=ScanResultType.ENCYCLOPEDIA_ENTRY, target=_row_to_entry(entry_rows[0]))
