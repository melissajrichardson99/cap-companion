"""Orchestration for the Contact Staff endpoints (Plan.md 2.10).

Two guest-facing flows (question / emergency) both funnel into the same
staff_requests table -- the type field is what lets the staff view
prioritize, not separate tables. Status walks open -> acknowledged ->
resolved via _transition (staff-only, one-way), or open/acknowledged ->
cancelled via cancel_active_request (guest-only, migration 033) -- a guest
can back out of their own still-active request, but never reach back into a
resolved one.
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
        name=row.get("name"),
        description=row.get("description"),
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


def get_active_request(session_id: UUID) -> StaffRequest | None:
    client = get_supabase_client()
    rows = (
        client.table("staff_requests")
        .select("*,map_nodes(name)")
        .eq("session_id", str(session_id))
        .in_("status", [StaffRequestStatus.OPEN.value, StaffRequestStatus.ACKNOWLEDGED.value])
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return _row_to_request(rows[0]) if rows else None


def create_request(
    session_id: UUID,
    type_: StaffRequestType,
    location_node_id: UUID | None,
    name: str | None = None,
    description: str | None = None,
) -> StaffRequest:
    if get_active_request(session_id) is not None:
        raise ConflictError("This session already has an active staff request")

    client = get_supabase_client()
    # Normalize a blank/whitespace-only optional field to null rather than
    # storing an empty string, so the staff view's "omit if not provided"
    # check (falsy) works the same regardless of how the guest left it blank.
    name = name.strip() or None if name else None
    description = description.strip() or None if description else None
    row = (
        client.table("staff_requests")
        .insert(
            {
                "type": type_.value,
                "location_node_id": str(location_node_id) if location_node_id else None,
                "name": name,
                "description": description,
                "session_id": str(session_id),
            }
        )
        .execute()
        .data[0]
    )
    return get_request(row["id"])


def cancel_active_request(session_id: UUID) -> StaffRequest:
    # Looks at the session's most recent request regardless of status (not
    # get_active_request) so a cancel attempt on one that's already resolved
    # is rejected as a conflict (it exists, just can't be cancelled anymore)
    # rather than reported as if the session never had a request at all.
    client = get_supabase_client()
    rows = (
        client.table("staff_requests")
        .select("*,map_nodes(name)")
        .eq("session_id", str(session_id))
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise NotFoundError(f"No staff request for session {session_id}")
    current = _row_to_request(rows[0])
    if current.status not in (StaffRequestStatus.OPEN, StaffRequestStatus.ACKNOWLEDGED):
        raise ConflictError(f'Staff request {current.id} is "{current.status}", cannot cancel')

    client.table("staff_requests").update({"status": StaffRequestStatus.CANCELLED.value}).eq(
        "id", str(current.id)
    ).execute()
    return get_request(current.id)


def list_requests(include_closed: bool = False) -> list[StaffRequest]:
    client = get_supabase_client()
    query = client.table("staff_requests").select("*,map_nodes(name)").order("created_at")
    if not include_closed:
        query = query.neq("status", StaffRequestStatus.RESOLVED.value).neq(
            "status", StaffRequestStatus.CANCELLED.value
        )
    rows = query.execute().data
    # Emergencies pinned to the top; Python's sort is stable, so within each
    # group rows stay in the created_at order the query already fetched them in.
    rows.sort(key=lambda r: r["type"] != StaffRequestType.EMERGENCY.value)
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
