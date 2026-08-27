-- CAP Companion App — migration 025: Per-Device Sessions Phase 2
-- (Puzzle Timer + Scoring Sheet)
--
-- Scopes puzzle_attempts (Puzzle Timer) and score_sheet_sessions (Scoring
-- Sheet) to device_sessions (migration 023), finishing what migration 024
-- only gap-filled far enough to attribute Cobb Coins awards correctly.
-- Bingo, Hunt, Map, and Family Passport remain global this phase -- see
-- app/services/session_reset.py's docstring for the current full picture.
--
-- Column naming deliberately differs per table, matching each service
-- module's existing Phase 1 gap-fill parameter name rather than introducing
-- a third variant (see app/services/puzzles.py and
-- app/services/scoring_sheet.py):
--   * puzzle_attempts.session_id      (puzzles.py already says session_id)
--   * score_sheet_sessions.device_session_id (scoring_sheet.py already says
--     device_session_id, specifically to avoid colliding with that table's
--     own "session" concept -- a score-sheet session is a different thing
--     from a device session, and this table's rows already mean the former)
--
-- score_entries (score-sheet session child rows) does NOT get its own
-- column: every read/write of score_entries is already reached exclusively
-- through a score_sheet_sessions row that's been fetched scoped to the
-- calling device (see scoring_sheet.py's _get_session_row), so entries are
-- transitively scoped for free. Its FK is `on delete cascade` to
-- score_sheet_sessions, so Reset Session (below) doesn't need to touch it
-- directly either -- deleting a device's score_sheet_sessions rows cascades
-- to their entries automatically.
--
-- Clean cutover, not a backfill: same reasoning as migration 024 -- this is
-- a POC with no real guest data worth preserving, so both tables are wiped
-- before their NOT NULL column is added. score_entries is wiped first since
-- it FKs to score_sheet_sessions.
--
-- No grant/alter-default-privileges block needed, same reasoning as
-- migration 024: ALTER TABLE ADD COLUMN on tables already granted
-- service_role privileges (migration 017) is a table-level grant, not
-- column-level. Verify with a live round-trip anyway per this project's
-- standing "queries silently return empty/stale, no error" gotcha.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: the deletes are idempotent (no-op once empty)
-- and the column adds are guarded.

delete from score_entries;
delete from score_sheet_sessions;
delete from puzzle_attempts;

alter table puzzle_attempts
    add column if not exists session_id uuid not null references device_sessions(id);

alter table score_sheet_sessions
    add column if not exists device_session_id uuid not null references device_sessions(id);
