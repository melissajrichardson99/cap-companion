-- CAP Companion App — migration 033: Contact Staff device sessions +
-- guest-facing status tracking / cancellation
--
-- staff_requests predates the per-device-session migration and was the last
-- guest-facing table not scoped to device_sessions (every other one --
-- coin_awards/collectible_redemptions (024), puzzle_attempts/
-- score_sheet_sessions (025), node_visits (026), passport_sessions (027),
-- photo_votes (028), session_tile_completions (029), hunt_progress (030) --
-- already is). Adding session_id here is what makes a guest-facing "check my
-- request's status" / "cancel my request" endpoint possible at all.
--
-- Also extends the existing status check (open/acknowledged/resolved,
-- migration 010) with a fourth value, cancelled: a guest-initiated
-- cancellation marks the row cancelled rather than deleting it, so staff
-- can still see it was cancelled (and not waste time responding) instead of
-- it silently disappearing.
--
-- Clean cutover, not a backfill: same reasoning as migrations 024/026 --
-- this is a POC with no real guest data worth preserving, and there is no
-- session to attribute existing rows to anyway. Deleting first is required
-- since a NOT NULL column with no default cannot be added to a non-empty
-- table.
--
-- No grant block needed: this alters an existing table (staff_requests)
-- already covered by 017_grant_service_role_privileges.sql, same reasoning
-- as migration 020's name/description columns on this same table.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: the delete is idempotent (no-op once empty),
-- the column add and index are guarded, and the constraint is dropped and
-- recreated unconditionally (cheap, no data depends on its old definition).

delete from staff_requests;

alter table staff_requests
    add column if not exists session_id uuid not null references device_sessions(id);

create index if not exists staff_requests_session_id_idx on staff_requests(session_id);

alter table staff_requests drop constraint if exists staff_requests_status_check;
alter table staff_requests add constraint staff_requests_status_check
    check (status in ('open', 'acknowledged', 'resolved', 'cancelled'));
