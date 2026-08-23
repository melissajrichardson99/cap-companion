-- CAP Companion App — migration 020: Contact Staff name + description
--
-- Adds two optional fields to staff_requests so a guest can say who they are
-- and what's going on, instead of staff only seeing a bare type + timestamp:
--   - name: short optional free text, no length cap (matches
--     passport_sessions.family_label, which also has no backend length
--     check -- the frontend's maxLength is the only guard there).
--   - description: optional free text capped at 500 chars so it stays a
--     brief note, not a wall of text. Enforced here via a check constraint
--     *and* in CreateStaffRequestRequest (Field(max_length=500)) so a
--     request that somehow bypasses the frontend's maxLength is rejected
--     with a 422 rather than silently truncated.
--
-- No grant/alter default privileges block needed: this alters an existing
-- table (staff_requests), already covered by
-- 017_grant_service_role_privileges.sql -- confirmed via a live POST/GET
-- round trip (see this migration's header pattern in 019), not assumed.
--
-- Run this in the Supabase SQL editor against the live project (per the
-- project's standing gotcha, seed.sql/schema.sql edits alone never reach
-- the live DB). Safe to run more than once: the column adds and constraint
-- add are all guarded.

alter table staff_requests add column if not exists name text;
alter table staff_requests add column if not exists description text;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'staff_requests_description_length_check') then
        alter table staff_requests add constraint staff_requests_description_length_check
            check (description is null or char_length(description) <= 500);
    end if;
end $$;
