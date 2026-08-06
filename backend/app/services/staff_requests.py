"""Orchestration for the Contact Staff endpoints (Plan.md 2.10).

Two guest-facing flows (question / emergency) both funnel into the same
staff_requests table -- the type field is what lets the staff view
prioritize, not separate tables. Status walks open -> acknowledged ->
resolved, one-way; _transition enforces which starting statuses are valid
for each move.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from app.errors import ConflictError, NotFoundError
from app.models import StaffRequest, StaffRequestStatus, StaffRequestType
from app.supabase_client import get_supabase_client


def _parse_timestamptz(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _row_to_request(row: dict) -> StaffRequest:
    node = row.get("map_nodes")
    return StaffRequest(
        id=row["id"],
        type=row["type"],
        location_node_id=row["location_node_id"],
        location_name=node["name"] if node else None,
        status=row["status"],
        created_at=_parse_timestamptz(row["created_at"]),
        resolved_at=_parse_timestamptz(row["resolved_at"]) if row["resolved_at"] else None,
    )


def get_request(request_id: UUID) -> StaffRequest:
    client = get_supabase_client()
    rows = client.table("staff_requests").select("*,map_nodes(name)").eq("id", str(request_id)).execute().data
    if not rows:
        raise NotFoundError(f"Staff request {request_id} not found")
    return _row_to_request(rows[0])


def create_request(type_: StaffRequestType, location_node_id: UUID | None) -> StaffRequest:
    client = get_supabase_client()
    row = (
        client.table("staff_requests")
        .insert({"type": type_.value, "location_node_id": str(location_node_id) if location_node_id else None})
        .execute()
        .data[0]
    )
    return get_request(row["id"])


def list_requests(include_resolved: bool = False) -> list[StaffRequest]:
    client = get_supabase_client()
    query = client.table("staff_requests").select("*,map_nodes(name)").order("created_at")
    if not include_resolved:
        query = query.neq("status", StaffRequestStatus.RESOLVED.value)
    rows = query.execute().data
    return [_row_to_request(r) for r in rows]


def _transition(request_id: UUID, new_status: StaffRequestStatus, allowed_from: set[StaffRequestStatus]) -> StaffRequest:
    client = get_supabase_client()
    rows = client.table("staff_requests").select("status").eq("id", str(request_id)).execute().data
    if not rows:
        raise NotFoundError(f"Staff request {request_id} not found")
    current = StaffRequestStatus(rows[0]["status"])
    if current not in allowed_from:
        raise ConflictError(f'Staff request {request_id} is "{current}", cannot mark {new_status}')

    update: dict = {"status": new_status.value}
    if new_status == StaffRequestStatus.RESOLVED:
        update["resolved_at"] = datetime.now(timezone.utc).isoformat()
    client.table("staff_requests").update(update).eq("id", str(request_id)).execute()
    return get_request(request_id)


def acknowledge_request(request_id: UUID) -> StaffRequest:
    return _transition(request_id, StaffRequestStatus.ACKNOWLEDGED, {StaffRequestStatus.OPEN})


def resolve_request(request_id: UUID) -> StaffRequest:
    return _transition(
        request_id, StaffRequestStatus.RESOLVED, {StaffRequestStatus.OPEN, StaffRequestStatus.ACKNOWLEDGED}
    )
