-- CAP Companion App — migration 028: Per-Device Sessions Phase 5
-- (Favorite Photo vote)
--
-- Retires photo_votes.voter_session_id (a bespoke, Favorite-Photo-only
-- localStorage token from the now-deleted frontend/src/voterSession.ts,
-- predating device_sessions/migration 023) in favor of session_id, a real
-- FK into device_sessions -- the same unified per-device session every
-- other migrated feature now uses. The "one vote per device" rule keeps its
-- existing shape: unique(submission_id, session_id), scoped per submission
-- (a device can still vote for several different shortlisted photos, once
-- each) -- only the identity behind the dedup changes, not the rule itself.
--
-- The aggregate vote tally / Photo of the Day computation
-- (app/services/photos.py's list_gallery/get_photo_of_the_day) already
-- counts every photo_votes row for a submission with no session filter, so
-- it stays correctly global/all-sessions with no code change needed here --
-- only the per-session "have I voted" check (voted_by_me) is session-scoped.
--
-- session_reset.py now deletes the calling session's own photo_votes row(s)
-- on Reset Session -- see that file's docstring for why this is a
-- deliberate addition (not the same "leave it untouched" exception carved
-- out for Family Passport in migration 027): the old voterSession.ts
-- mechanism let a guest vote again after Reset Session by rotating its own
-- token, which device_sessions' token deliberately does not do (confirmed
-- in migration 027). Preserving "vote again after Reset Session" therefore
-- requires actually deleting the row now, which also fixes a latent bug --
-- the old token-rotation approach left the prior vote row (and its count)
-- in the tally forever, so the same physical device's tally silently
-- doubled after every reset-then-revote cycle.
--
-- Clean cutover, not a backfill: same reasoning as migrations 024/025/026/
-- 027 -- this is a POC with no real guest data worth preserving, so
-- existing vote rows are deleted before the new NOT NULL FK column is
-- added (a NOT NULL column with no default cannot be added to a non-empty
-- table anyway).
--
-- Dropping voter_session_id also drops the old unique(submission_id,
-- voter_session_id) constraint that referenced it -- Postgres removes a
-- table's own local constraints automatically when a column they depend on
-- is dropped, no CASCADE needed. The replacement unique(submission_id,
-- session_id) constraint is added guarded by a pg_constraint existence
-- check (same idempotent pattern as migration 002's x_pct/y_pct checks),
-- since ALTER TABLE ADD CONSTRAINT has no IF NOT EXISTS clause of its own.
--
-- No grant/alter-default-privileges block needed: this is an ALTER TABLE on
-- a table already granted service_role privileges (photo_votes via
-- migration 012/017) -- grants are table-level, not column-level, same
-- reasoning as migrations 024/025/027. Verify with a live round-trip anyway
-- per this project's standing "queries silently return empty/stale, no
-- error" gotcha.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: the delete is idempotent (no-op once empty),
-- the column drop/add are guarded, and the constraint add is guarded.

delete from photo_votes;

alter table photo_votes drop column if exists voter_session_id;

alter table photo_votes
    add column if not exists session_id uuid not null references device_sessions(id);

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'photo_votes_submission_id_session_id_key'
    ) then
        alter table photo_votes
            add constraint photo_votes_submission_id_session_id_key unique (submission_id, session_id);
    end if;
end $$;
