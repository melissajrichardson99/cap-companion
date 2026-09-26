"""Orchestration for Favorite Photo (Plan.md 2.14): guest photo submissions,
staff shortlist/reject curation, and shortlist voting.

POC scope -- a single ongoing voting period, no day/week/month cycling yet
(Plan.md 2.14 flags periodic cycling as later work; this ships the
underlying submit/curate/vote loop first). Staff curation exists so voting
only ever sees a moderated shortlist, never raw guest uploads (Plan.md
2.14's "staff-curated shortlist... to avoid moderation issues").
"""

from __future__ import annotations

import re
from datetime import datetime
from uuid import UUID, uuid4

from app.errors import ConflictError, NotFoundError, ValidationError
from app.models import EMAIL_RE, PhotoStatus, PhotoSubmission
from app.supabase_client import get_supabase_client

BUCKET = "favorite-photos"


def _parse_timestamptz(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _photo_url(storage_path: str) -> str:
    client = get_supabase_client()
    return client.storage.from_(BUCKET).get_public_url(storage_path)


def _row_to_submission(row: dict, session_id: UUID | None = None, include_email: bool = False) -> PhotoSubmission:
    # include_email defaults False so every guest-facing caller (gallery,
    # of-the-day, vote, the submitting guest's own receipt) is safe by
    # default -- only the require_staff-gated pending/shortlisted staff views
    # opt in. Never gate on session_id being None/not-None for this: get_
    # photo_of_the_day() also calls list_gallery(None) and is guest-facing.
    votes = row.get("photo_votes") or []
    return PhotoSubmission(
        id=row["id"],
        guest_label=row.get("guest_label"),
        email=row.get("email") if include_email else None,
        photo_url=_photo_url(row["storage_path"]),
        submitted_at=_parse_timestamptz(row["submitted_at"]),
        status=row["status"],
        vote_count=len(votes),
        voted_by_me=session_id is not None and any(v["session_id"] == str(session_id) for v in votes),
    )


def submit_photo(
    guest_label: str | None, email: str | None, filename: str, content_type: str, file_bytes: bytes
) -> PhotoSubmission:
    stripped_email = email.strip() if email else None
    if stripped_email and not re.match(EMAIL_RE, stripped_email):
        raise ValidationError("email must be a valid email address")

    client = get_supabase_client()
    submission_id = uuid4()
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    storage_path = f"{submission_id}.{suffix}"
    client.storage.from_(BUCKET).upload(storage_path, file_bytes, {"content-type": content_type})
    row = (
        client.table("photo_submissions")
        .insert(
            {
                "id": str(submission_id),
                "guest_label": guest_label,
                "email": stripped_email,
                "storage_path": storage_path,
            }
        )
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
    return [_row_to_submission(r, include_email=True) for r in rows]


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


def delete_submission(submission_id: UUID) -> None:
    # Hard delete, for genuinely inappropriate content -- distinct from reject
    # (which soft-flags and keeps the row for an audit trail). Allowed from
    # pending_review (Photo Queue moderation) and shortlisted (Staff removing
    # a live/voting-pool photo, e.g. one that slipped through moderation, or
    # an end-of-day clear). Rejected rows should go through this same path if
    # they ever need removing, but rejecting-then-deleting already covers
    # that -- nothing else routes a rejected row here today.
    row = _get_row(submission_id)
    current = PhotoStatus(row["status"])
    if current not in (PhotoStatus.PENDING_REVIEW, PhotoStatus.SHORTLISTED):
        raise ConflictError(f'Photo submission {submission_id} is "{current}", cannot delete')

    client = get_supabase_client()
    client.storage.from_(BUCKET).remove([row["storage_path"]])
    client.table("photo_submissions").delete().eq("id", str(submission_id)).execute()


def delete_all_shortlisted() -> int:
    # Bulk end-of-day clear of the voting pool. PostgREST rejects an
    # unscoped delete (no WHERE clause) -- the .eq("status", ...) filter
    # below is that clause, not just a courtesy, so this can never widen
    # into deleting pending/rejected rows too.
    client = get_supabase_client()
    rows = (
        client.table("photo_submissions")
        .select("id,storage_path")
        .eq("status", PhotoStatus.SHORTLISTED.value)
        .execute()
        .data
    )
    if not rows:
        return 0

    client.storage.from_(BUCKET).remove([r["storage_path"] for r in rows])
    client.table("photo_submissions").delete().eq("status", PhotoStatus.SHORTLISTED.value).execute()
    return len(rows)


def list_gallery(session_id: UUID | None, include_email: bool = False) -> list[PhotoSubmission]:
    client = get_supabase_client()
    rows = (
        client.table("photo_submissions")
        .select("*,photo_votes(session_id)")
        .eq("status", PhotoStatus.SHORTLISTED.value)
        .order("submitted_at")
        .execute()
        .data
    )
    return [_row_to_submission(r, session_id, include_email) for r in rows]


def get_photo_of_the_day() -> PhotoSubmission | None:
    # Highest-voted shortlisted photo, aggregated across every session's
    # votes -- list_gallery(None) here means "no session context", not "no
    # votes counted"; vote_count always sums every photo_votes row
    # regardless of whose session cast it (Per-Device Sessions Phase 5). It
    # only affects voted_by_me, which is irrelevant for this global result.
    # list_gallery already orders by submitted_at ascending, and max()'s
    # "first item wins ties" behavior means a tie between two photos
    # (including an all-zero-vote shortlist) resolves to whichever was
    # submitted first -- a deterministic, if arbitrary, tiebreak rather than
    # one that changes on every request.
    photos = list_gallery(None)
    if not photos:
        return None
    return max(photos, key=lambda p: p.vote_count)


def vote(submission_id: UUID, session_id: UUID) -> PhotoSubmission:
    row = _get_row(submission_id)
    if PhotoStatus(row["status"]) != PhotoStatus.SHORTLISTED:
        raise ConflictError(f"Photo submission {submission_id} is not shortlisted for voting")

    client = get_supabase_client()
    existing = (
        client.table("photo_votes")
        .select("id")
        .eq("submission_id", str(submission_id))
        .eq("session_id", str(session_id))
        .execute()
        .data
    )
    if existing:
        raise ConflictError(f"Session {session_id} already voted on photo submission {submission_id}")

    # The unique(submission_id, session_id) constraint (migration 028) is
    # the real enforcement against a duplicate vote; the check above just
    # gives a friendlier error ahead of it.
    client.table("photo_votes").insert({"submission_id": str(submission_id), "session_id": str(session_id)}).execute()

    updated_row = (
        client.table("photo_submissions")
        .select("*,photo_votes(session_id)")
        .eq("id", str(submission_id))
        .execute()
        .data[0]
    )
    return _row_to_submission(updated_row, session_id)
