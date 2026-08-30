-- CAP Companion App — migration 034: Contact Staff acknowledgment/resolution attribution
--
-- Adds acknowledged_by / resolved_by so the staff view can show which staff
-- member handled a request. There's still only one shared staff login (no
-- per-staff accounts -- see CLAUDE.md scope) -- these store a self-reported
-- display name (frontend/src/staffName.ts, a lightweight per-device "who am
-- I" layer on top of the shared auth), sent via the X-Staff-Name header
-- (app/staff_auth.py's get_staff_name) and populated on the transition into
-- 'acknowledged'/'resolved' (app/services/staff_requests.py's _transition).
-- Optional: a staff member who hasn't set a name yet can still
-- acknowledge/resolve as before, just without attribution.
--
-- Run this in the Supabase SQL editor against the live project (per the
-- project's standing gotcha, seed.sql/schema.sql edits alone never reach the
-- live DB). Safe to run more than once: the column adds are guarded.

alter table staff_requests add column if not exists acknowledged_by text;
alter table staff_requests add column if not exists resolved_by text;
