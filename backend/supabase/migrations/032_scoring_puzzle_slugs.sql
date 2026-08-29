-- CAP Companion App — migration 032: QR-routable slugs for Scoring Sheet
-- games and Puzzle challenges
--
-- Mirrors the existing Our Animals (static content) and Scavenger Hunt
-- (scannable_codes) QR patterns: scoring_games and puzzle_challenges gain a
-- real unique slug column so physical signage can point at
-- /scoring/:gameSlug and /puzzles/:challengeSlug instead of a DB UUID.
--
-- Puzzle challenge slugs are derived from `puzzle name + label`, not label
-- alone -- puzzle_challenges.label is only unique per-puzzle
-- (puzzle_id, label), and several labels repeat across puzzles verbatim
-- ("Standard" on single-challenge puzzles, "Challenge 1/2/3" on both Pyramid
-- Puzzler and Hop Dots). puzzles.name and scoring_games.name are each
-- globally unique already, so their derived slugs are unique for free.
--
-- Per the project's established gotcha (seed.sql/schema.sql edits don't
-- reach the live DB), this migration is what actually applies the change to
-- the live database; schema.sql and seed.sql are updated separately.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: columns are added with IF NOT EXISTS, the
-- backfill only touches rows where slug is still null, SET NOT NULL is a
-- no-op once already set, and the unique indexes use IF NOT EXISTS.

alter table scoring_games add column if not exists slug text;
alter table puzzle_challenges add column if not exists slug text;

update scoring_games
set slug = lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'))
where slug is null;

update puzzle_challenges pc
set slug = lower(regexp_replace(regexp_replace(p.name || '-' || pc.label, '[^a-zA-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'))
from puzzles p
where pc.puzzle_id = p.id and pc.slug is null;

alter table scoring_games alter column slug set not null;
alter table puzzle_challenges alter column slug set not null;

create unique index if not exists scoring_games_slug_idx on scoring_games(slug);
create unique index if not exists puzzle_challenges_slug_idx on puzzle_challenges(slug);
