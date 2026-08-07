-- CAP Companion App — migration 012: Favorite Photo (Plan.md 2.14, POC scope)
--
-- POC scope: a single ongoing voting period, no day/week/month cycling yet
-- (that's flagged future work in Plan.md 2.14) -- shortlisted photos just
-- accumulate votes until staff/park decide to reset/cycle manually.
--
-- photo_submissions: guest-submitted entries. status walks
-- pending_review -> shortlisted or pending_review -> rejected, one-way (see
-- app/services/photos.py's _curate) -- same one-way-transition shape as
-- staff_requests (migration 010). Only shortlisted photos are ever shown to
-- guests for voting -- staff curation keeps raw uploads out of the public
-- gallery (Plan.md 2.14's "staff-curated shortlist... to avoid moderation
-- issues").
--
-- photo_votes: one row per (submission, voter_session_id). voter_session_id
-- is a client-generated id stored in localStorage, not real auth -- just
-- enough to stop trivial double-voting from the same device/browser. The
-- unique constraint is the actual enforcement; app/services/photos.py's
-- pre-check is just a friendlier error message ahead of it.
--
-- Storage: actual image bytes live in Supabase Storage, not the DB --
-- photo_submissions.storage_path is the object key. photo_url is derived at
-- read time from storage_path via the storage API's get_public_url, not
-- stored, so it can never drift if the bucket's public URL format changes
-- (same "derive, don't duplicate" discipline as coin_awards -> CoinsSummary
-- and MapNode.linked_bingo_tile_ids). The bucket itself is created public
-- below so guest devices can load gallery images directly with no
-- signed-URL round trip -- fine for a POC with no PII in guest uploads.
--
-- Per the project's established gotcha (seed.sql edits don't reach the live
-- DB -- see migrations 004-011's headers), this migration is what actually
-- applies the change to the live database; seed.sql needs no new rows here
-- -- both tables are runtime guest-generated data, same as staff_requests.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: table/index creates are guarded, and the
-- bucket insert is guarded by ON CONFLICT (id) DO NOTHING.

create table if not exists photo_submissions (
    id            uuid primary key default gen_random_uuid(),
    guest_label   text,
    storage_path  text not null,
    submitted_at  timestamptz not null default now(),
    status        text not null default 'pending_review' check (status in ('pending_review', 'shortlisted', 'rejected'))
);

create index if not exists photo_submissions_status_idx on photo_submissions(status);

create table if not exists photo_votes (
    id                uuid primary key default gen_random_uuid(),
    submission_id     uuid not null references photo_submissions(id) on delete cascade,
    voter_session_id  text not null,
    created_at        timestamptz not null default now(),
    unique (submission_id, voter_session_id)
);

create index if not exists photo_votes_submission_id_idx on photo_votes(submission_id);

insert into storage.buckets (id, name, public)
values ('favorite-photos', 'favorite-photos', true)
on conflict (id) do nothing;
