-- CAP Companion App — migration 018: Announcements (Staff-managed)
--
-- Backs the new Staff Page "Announcements" tab (create/edit/delete, plain
-- text only -- no category/type/scheduling for this pass) plus the Home
-- Page announcements box and the app-wide "new announcement" popup, both of
-- which now read this table instead of the old static ANNOUNCEMENTS array
-- in frontend/src/homePageContent.ts.
--
-- No explicit grant/alter default privileges block here: migration
-- 017_grant_service_role_privileges.sql already ran
-- `alter default privileges in schema public grant all privileges on
-- tables to service_role`, which covers tables created by any migration run
-- afterward the same way (Supabase SQL editor, same role) -- see
-- DEPLOYMENT.md's note on 017. Verify this holds with a real round trip
-- (staff POST /announcements, then a plain GET /announcements) once this
-- migration has been run against the live project -- "queries silently
-- return empty, no error" is this project's most-repeated gotcha, so don't
-- take that assumption on faith alone.
--
-- Run this in the Supabase SQL editor against the live project (per the
-- project's standing gotcha, seed.sql/schema.sql edits alone never reach
-- the live DB). Safe to run more than once: the create is guarded.

create table if not exists announcements (
    id          uuid primary key default gen_random_uuid(),
    text        text not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists announcements_created_at_idx on announcements(created_at desc);
