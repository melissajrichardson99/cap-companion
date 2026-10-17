-- CAP Companion App — migration 046: enable row level security on every
-- public table (no policies)
--
-- Defence in depth. schema.sql and migrations 002-045 never enabled RLS, so
-- whether the anon / authenticated keys could read or write a table through
-- PostgREST depended only on table grants. Production has no anon grants
-- today (checked live with backend/supabase/CHECK_anon_access.sql). With RLS
-- on and NO policies, a grant alone is no longer enough: anon and
-- authenticated see zero rows and every insert/update/delete is refused,
-- even if a grant is added by accident later. Only service_role, which has
-- BYPASSRLS on Supabase, can still read and write.
--
-- Why nothing in the app breaks (checked 2026-10-17):
--   - The backend is the only thing that talks to the database. It uses one
--     key, SUPABASE_KEY (app/supabase_client.py), which must be the
--     service_role / sb_secret key. Every script in backend/scripts imports
--     that same client. The frontend, the Godot minigames and the GitHub
--     Actions workflow never call Supabase directly (no supabase-js, no
--     anon/publishable key anywhere in the repo) -- they only call the
--     backend.
--   - There are no views, triggers or policies in schema.sql or any
--     migration. The one function, analytics_summary() (044), is SECURITY
--     INVOKER and executable by service_role only, so it runs as
--     service_role and bypasses RLS like every other backend query.
--   - Storage is unaffected: storage.objects / storage.buckets are in the
--     storage schema, not public, and the backend uploads with the service
--     key.
--   - RLS is enabled, not FORCEd, so the table owner (postgres, used by the
--     SQL editor) is not restricted either.
--
-- The tables are listed explicitly, not looped over, so the list can be
-- reviewed: all 33 tables that schema.sql + migrations 002-045 leave in the
-- public schema (schema.sql's 32, plus announcements from 018; collectibles
-- was dropped in 022). The DO block at the end fails the migration if ANY
-- table in public still has RLS off -- a table missing from this list, or
-- one created by hand -- so nothing is silently left open.
--
-- EVERY FUTURE MIGRATION THAT CREATES A TABLE must enable RLS on it in the
-- same migration, right after `create table`:
--     alter table <name> enable row level security;
-- and add no policies unless anon access is genuinely intended. See
-- DEPLOYMENT.md section 2.1.
--
-- Does not need to run before any backend deploy (the backend is unaffected
-- either way). Test on the dev project first: run it, then the backend tests
-- and an e2e smoke run (guest session, map, scan, scoring, staff login,
-- photo upload) against dev, before running it on production.
--
-- Run this in the Supabase SQL editor against the live project (schema.sql
-- edits alone never reach the live DB). Safe to run more than once:
-- enabling RLS on a table that already has it is a no-op. Undo, if ever
-- needed: `alter table <name> disable row level security;` per table.

-- ---------------------------------------------------------------------------
-- 0. Refuse to run unless service_role bypasses RLS (otherwise the backend
--    would see empty tables the moment this commits).
-- ---------------------------------------------------------------------------
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'service_role' and rolbypassrls) then
        raise exception 'migration 046: service_role does not have BYPASSRLS -- enabling RLS would lock the backend out. Nothing changed.';
    end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Enable RLS (alphabetical)
-- ---------------------------------------------------------------------------
alter table animal_map_locations      enable row level security;
alter table animal_photos             enable row level security;
alter table announcements             enable row level security;
alter table bingo_cards               enable row level security;
alter table bingo_tiles               enable row level security;
alter table coin_awards               enable row level security;
alter table collectible_redemptions   enable row level security;
alter table device_sessions           enable row level security;
alter table encyclopedia_entries      enable row level security;
alter table game_score_events         enable row level security;
alter table guest_auth_tokens         enable row level security;
alter table guests                    enable row level security;
alter table hunt_challenges           enable row level security;
alter table hunt_characters           enable row level security;
alter table hunt_progress             enable row level security;
alter table map_node_visit_events     enable row level security;
alter table map_nodes                 enable row level security;
alter table minigames                 enable row level security;
alter table node_visits               enable row level security;
alter table passport_sessions         enable row level security;
alter table password_reset_tokens     enable row level security;
alter table photo_submissions         enable row level security;
alter table photo_votes               enable row level security;
alter table puzzle_attempts           enable row level security;
alter table puzzle_challenges         enable row level security;
alter table puzzles                   enable row level security;
alter table scannable_codes           enable row level security;
alter table score_entries             enable row level security;
alter table score_sheet_sessions      enable row level security;
alter table scoring_games             enable row level security;
alter table session_tile_completions  enable row level security;
alter table staff_requests            enable row level security;
alter table stroke_play_scores        enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Fail if any public table was missed
-- ---------------------------------------------------------------------------
do $$
declare
    missed text;
begin
    select string_agg(c.relname, ', ' order by c.relname) into missed
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
    if missed is not null then
        raise exception 'migration 046: RLS is still off on: % -- add them to this migration. Nothing changed.', missed;
    end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Verification (read-only; run before and after)
-- ---------------------------------------------------------------------------
-- A. RLS per table. Before: every row rls_enabled = false. After: all 33
--    rows true, and policies = 0 everywhere.
--
-- select c.relname as table_name,
--        c.relrowsecurity as rls_enabled,
--        (select count(*) from pg_policies p
--         where p.schemaname = 'public' and p.tablename = c.relname) as policies
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relkind in ('r', 'p')
-- order by c.relname;
--
-- B. Anon / authenticated privileges. Expect 0 rows both before and after on
--    production (no grants). If any row appears, RLS with no policies still
--    blocks it, but revoke the grant anyway.
--
-- select c.relname as table_name, r.rolname as role,
--        has_table_privilege(r.rolname, c.oid, 'SELECT') as can_select,
--        has_table_privilege(r.rolname, c.oid, 'INSERT') as can_insert,
--        has_table_privilege(r.rolname, c.oid, 'UPDATE') as can_update,
--        has_table_privilege(r.rolname, c.oid, 'DELETE') as can_delete
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- cross join (values ('anon'), ('authenticated')) as r(rolname)
-- where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
--   and (has_table_privilege(r.rolname, c.oid, 'SELECT')
--     or has_table_privilege(r.rolname, c.oid, 'INSERT')
--     or has_table_privilege(r.rolname, c.oid, 'UPDATE')
--     or has_table_privilege(r.rolname, c.oid, 'DELETE'))
-- order by c.relname, r.rolname;
--
-- C. service_role still bypasses RLS (expect true):
--
-- select rolbypassrls from pg_roles where rolname = 'service_role';
