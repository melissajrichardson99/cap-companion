"""Orchestration for Favorite Photo (Plan.md 2.14): guest photo submissions,
staff shortlist/reject curation, and shortlist voting.

POC scope -- a single ongoing voting period, no day/week/month cycling yet
(Plan.md 2.14 flags periodic cycling as later work; this ships the
underlying submit/curate/vote loop first). Staff curation exists so voting
only ever sees a moderated shortlist, never raw guest uploads (Plan.md
2.14's "staff-curated shortlist... to avoid moderation issues").
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from app.errors import ConflictError, NotFoundError
from app.models import PhotoStatus, PhotoSubmission
from app.supabase_client import get_supabase_client

BUCKET = "favorite-photos"


def _parse_timestamptz(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _photo_url(storage_path: str) -> str:
    client = get_supabase_client()
    return client.storage.from_(BUCKET).get_public_url(storage_path)


def _row_to_submission(row: dict, voter_session_id: str | None = None) -> PhotoSubmission:
    votes = row.get("photo_votes") or []
    return PhotoSubmission(
        id=row["id"],
        guest_label=row.get("guest_label"),
        photo_url=_photo_url(row["storage_path"]),
        submitted_at=_parse_timestamptz(row["submitted_at"]),
        status=row["status"],
        vote_count=len(votes),
        voted_by_me=voter_session_id is not None
        and any(v["voter_session_id"] == voter_session_id for v in votes),
    )


def submit_photo(guest_label: str | None, filename: str, content_type: str, file_bytes: bytes) -> PhotoSubmission:
    client = get_supabase_client()
    submission_id = uuid4()
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    storage_path = f"{submission_id}.{suffix}"
    client.storage.from_(BUCKET).upload(storage_path, file_bytes, {"content-type": content_type})
    row = (
        client.table("photo_submissions")
        .insert({"id": str(submission_id), "guest_label": guest_label, "storage_path": storage_path})
        .execute()
        .data[0]
    )
    return _row_to_submission(row)


def list_pending() -> list[PhotoSubmission]:
    client = get_supabase_client()
    rows = (
        client.table("photo_submissions")
        .select("*")
        .eq("status", PhotoStatus.PENDING_REVIEW.value)
        .order("submitted_at")
        .execute()
        .data
    )
    return [_row_to_submission(r) for r in rows]


def _get_row(submission_id: UUID) -> dict:
    client = get_supabase_client()
    rows = client.table("photo_submissions").select("*").eq("id", str(submission_id)).execute().data
    if not rows:
        raise NotFoundError(f"Photo submission {submission_id} not found")
    return rows[0]


def _curate(submission_id: UUID, new_status: PhotoStatus) -> PhotoSubmission:
    current = PhotoStatus(_get_row(submission_id)["status"])
    if current != PhotoStatus.PENDING_REVIEW:
        raise ConflictError(f'Photo submission {submission_id} is "{current}", cannot mark {new_status}')

    client = get_supabase_client()
    row = (
        client.table("photo_submissions")
        .update({"status": new_status.value})
        .eq("id", str(submission_id))
        .execute()
        .data[0]
    )
    return _row_to_submission(row)


def shortlist(submission_id: UUID) -> PhotoSubmission:
    return _curate(submission_id, PhotoStatus.SHORTLISTED)


def reject(submission_id: UUID) -> PhotoSubmission:
    return _curate(submission_id, PhotoStatus.REJECTED)


def list_gallery(voter_session_id: str | None) -> list[PhotoSubmission]:
    client = get_supabase_client()
    rows = (
        client.table("photo_submissions")
        .select("*,photo_votes(voter_session_id)")
        .eq("status", PhotoStatus.SHORTLISTED.value)
        .order("submitted_at")
        .execute()
        .data
    )
    return [_row_to_submission(r, voter_session_id) for r in rows]


def vote(submission_id: UUID, voter_session_id: str) -> PhotoSubmission:
    row = _get_row(submission_id)
    if PhotoStatus(row["status"]) != PhotoStatus.SHORTLISTED:
        raise ConflictError(f"Photo submission {submission_id} is not shortlisted for voting")

    client = get_supabase_client()
    existing = (
        client.table("photo_votes")
        .select("id")
        .eq("submission_id", str(submission_id))
        .eq("voter_session_id", voter_session_id)
        .execute()
        .data
    )
    if existing:
        raise ConflictError(f"Voter {voter_session_id} already voted on photo submission {submission_id}")

    # The unique(submission_id, voter_session_id) constraint (migration 012)
    # is the real enforcement against a duplicate vote; the check above just
    # gives a friendlier error ahead of it.
    client.table("photo_votes").insert(
        {"submission_id": str(submission_id), "voter_session_id": voter_session_id}
    ).execute()

    updated_row = (
        client.table("photo_submissions")
        .select("*,photo_votes(voter_session_id)")
        .eq("id", str(submission_id))
        .execute()
        .data[0]
    )
    return _row_to_submission(updated_row, voter_session_id)
