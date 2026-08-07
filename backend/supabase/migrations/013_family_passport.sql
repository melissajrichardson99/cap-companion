-- CAP Companion App — migration 013: Family Passport (Plan.md 2.8, POC scope)
--
-- passport_sessions: one row per "Generate Passport" tap. stats is a JSON
-- snapshot computed once at generation time (app/services/passport.py's
-- _compute_stats), not re-derived on read -- deliberately different from
-- the "derive, don't duplicate" discipline used everywhere else in this
-- schema (coin_awards -> CoinsSummary, MapNode.linked_bingo_tile_ids). A
-- passport is a one-time end-of-visit keepsake: if a family keeps playing
-- after generating theirs, or later activity changes the underlying rows,
-- the numbers on an already-generated passport must NOT drift -- so the
-- computed result is frozen into the row instead of being recomputed from
-- live tables on every read.
--
-- No login/session-linking in this POC (same "one device per family visit"
-- scope as the rest of the app -- App.tsx always auto-selects the single
-- active bingo card). family_label is free text the guest types in, not a
-- foreign key to anything.
--
-- photo_storage_path is nullable -- the group photo prompt is optional, a
-- guest can generate a passport with no photo at all. Same Storage-backed
-- pattern as Favorite Photo (migration 012): actual bytes live in the
-- 'family-passport-photos' bucket, photo_url is derived at read time from
-- this path (app/services/passport.py), never stored.
--
-- Per the project's established gotcha (seed.sql edits don't reach the live
-- DB -- see migrations 004-012's headers), this migration is what actually
-- applies the change to the live database; seed.sql needs no new rows here
-- -- this table is runtime guest-generated data, same as staff_requests and
-- photo_submissions.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: table/index creates are guarded, and the
-- bucket insert is guarded by ON CONFLICT (id) DO NOTHING.

create table if not exists passport_sessions (
    id                  uuid primary key default gen_random_uuid(),
    family_label        text not null,
    photo_storage_path  text,
    generated_at        timestamptz not null default now(),
    stats               jsonb not null
);

create index if not exists passport_sessions_generated_at_idx on passport_sessions(generated_at);

-- Public so guest devices can load a generated passport's photo directly
-- with no signed-URL round trip -- same POC tradeoff as favorite-photos
-- (no PII beyond what the family chose to submit).
insert into storage.buckets (id, name, public)
values ('family-passport-photos', 'family-passport-photos', true)
on conflict (id) do nothing;
