-- CAP Companion App — migration 008: Scavenger Hunt tables + seed data
--
-- New feature, so like migrations 005/007 there's no existing live table to
-- alter — this creates hunt_characters / hunt_challenges / hunt_progress
-- from scratch and seeds the 5 launch characters (Kangaroo, Pig, Capybara,
-- Snake, Sloth) with their 3 challenges each.
--
-- content/metadata are jsonb, a deliberate departure from this schema's
-- usual "arrays over JSON" rule (see schema.sql's map_nodes comment) --
-- hunt_challenges.content genuinely varies in shape per challenge_type (an
-- MC question+options, a list of matching pairs, a list of T/F statements,
-- or a scrambled-word+question combo), which native Postgres arrays can't
-- represent. challenges_completed on hunt_progress is a plain integer[]
-- (order_index values 1-3) since that one *is* homogeneous, matching
-- bingo_cards.milestone_lines.
--
-- metadata.source lets the placeholder trivia get found and replaced later
-- without re-auditing every character: 'park_verified' for Capybara (real
-- park-sourced facts per the build spec) vs. 'placeholder_general_knowledge'
-- for the other four (general animal facts, not yet park-verified).
--
-- minigame_slug on hunt_characters matches a key in GAME_SLUGS
-- (frontend/src/components/MinigameOverlay.tsx) — same "must match exactly"
-- discipline as minigames.name in migration 004's header. Challenge 3's own
-- content additionally carries {"minigame_slug": "..."} so the row is
-- self-describing without a join, but hunt_characters.minigame_slug is what
-- the frontend actually reads to launch it.
--
-- Per the project's established gotcha (seed.sql edits don't reach the live
-- DB -- see migrations 004/005/006/007's headers), this migration is what
-- actually applies the change to the live database; seed.sql and schema.sql
-- are updated separately (seed.sql for fresh-install data, schema.sql for a
-- fresh project's baseline).
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: table/index creates are guarded, and every
-- insert is guarded by ON CONFLICT DO NOTHING (hunt_characters.name,
-- hunt_challenges (character_id, order_index), hunt_progress.character_id).

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table if not exists hunt_characters (
    id              uuid primary key default gen_random_uuid(),
    name            text not null unique,
    species_category text not null check (species_category in ('marsupial', 'rodent', 'other')),
    minigame_slug   text not null,
    sort_order      integer not null default 0,
    created_at      timestamptz not null default now()
);

create table if not exists hunt_challenges (
    id            uuid primary key default gen_random_uuid(),
    character_id  uuid not null references hunt_characters(id) on delete cascade,
    order_index   integer not null check (order_index between 1 and 3),
    type          text not null check (type in ('mc', 'matching', 'true_false_set', 'image_mc', 'minigame')),
    content       jsonb not null default '{}'::jsonb,
    metadata      jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now(),
    unique (character_id, order_index)
);

create index if not exists hunt_challenges_character_id_idx on hunt_challenges(character_id);

create table if not exists hunt_progress (
    id                   uuid primary key default gen_random_uuid(),
    character_id         uuid not null unique references hunt_characters(id) on delete cascade,
    -- order_index values (1-3) of challenges completed so far for this
    -- character. completed_at is only ever set once this reaches all 3 --
    -- set monotonically, never re-derived/unset, same "don't lock early"
    -- discipline as the scoring sheet's tie-lock gotcha.
    challenges_completed integer[] not null default '{}',
    completed_at         timestamptz,
    created_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- hunt_characters (5) + hunt_challenges (3 each) + hunt_progress (1 each)
-- ---------------------------------------------------------------------------
insert into hunt_characters (name, species_category, minigame_slug, sort_order) values
    ('Kangaroo', 'marsupial', 'mini_platformer', 1),
    ('Pig',      'other',     'pattern_repeat',  2),
    ('Capybara', 'rodent',    'whack_a_capybara',3),
    ('Snake',    'other',     'mini_snake',      4),
    ('Sloth',    'other',     'mini_maze',       5)
on conflict (name) do nothing;

-- Kangaroo
insert into hunt_challenges (character_id, order_index, type, content, metadata)
select c.id, v.order_index, v.type, v.content::jsonb, v.metadata::jsonb
from hunt_characters c,
(values
    (1, 'mc',
     '{"question":"What do you call a group of kangaroos?","options":["A mob","A pack","A herd","A troop"],"answer_index":0}',
     '{"source":"placeholder_general_knowledge"}'),
    (2, 'matching',
     '{"pairs":[{"left":"Joey","right":"a baby kangaroo"},{"left":"Pouch","right":"where a joey grows"},{"left":"Marsupial","right":"the mammal group kangaroos belong to"},{"left":"Mob","right":"a group of kangaroos"},{"left":"Boomer","right":"a large male kangaroo"}]}',
     '{"source":"placeholder_general_knowledge"}'),
    (3, 'minigame',
     '{"minigame_slug":"mini_platformer"}',
     '{"source":"placeholder_general_knowledge"}')
) as v(order_index, type, content, metadata)
where c.name = 'Kangaroo'
on conflict (character_id, order_index) do nothing;

-- Pig
insert into hunt_challenges (character_id, order_index, type, content, metadata)
select c.id, v.order_index, v.type, v.content::jsonb, v.metadata::jsonb
from hunt_characters c,
(values
    (1, 'mc',
     '{"question":"How do pigs cool themselves down, since they barely sweat?","options":["Rolling in mud","Panting like a dog","Hiding in shade only","They don''t need to"],"answer_index":0}',
     '{"source":"placeholder_general_knowledge"}'),
    (2, 'mc',
     '{"question":"Pigs are considered one of the smartest animals alive. Studies often compare their intelligence to which animals?","options":["Goldfish","Dolphins and primates","Reptiles","Dogs only"],"answer_index":1}',
     '{"source":"placeholder_general_knowledge"}'),
    (3, 'minigame',
     '{"minigame_slug":"pattern_repeat"}',
     '{"source":"placeholder_general_knowledge"}')
) as v(order_index, type, content, metadata)
where c.name = 'Pig'
on conflict (character_id, order_index) do nothing;

-- Capybara (real park-sourced facts)
insert into hunt_challenges (character_id, order_index, type, content, metadata)
select c.id, v.order_index, v.type, v.content::jsonb, v.metadata::jsonb
from hunt_characters c,
(values
    (1, 'mc',
     '{"question":"What is a group of capybaras called?","options":["A herd","A pack","A colony","A raft"],"answer_index":0}',
     '{"source":"park_verified"}'),
    (2, 'true_false_set',
     '{"statements":[{"text":"Capybaras can stay underwater up to five minutes","answer":true},{"text":"Capybaras are the smallest rodent in the world","answer":false},{"text":"Capybaras are native to Central and South America","answer":true}]}',
     '{"source":"park_verified"}'),
    (3, 'minigame',
     '{"minigame_slug":"whack_a_capybara"}',
     '{"source":"park_verified"}')
) as v(order_index, type, content, metadata)
where c.name = 'Capybara'
on conflict (character_id, order_index) do nothing;

-- Snake
insert into hunt_challenges (character_id, order_index, type, content, metadata)
select c.id, v.order_index, v.type, v.content::jsonb, v.metadata::jsonb
from hunt_characters c,
(values
    (1, 'mc',
     '{"question":"How do snakes primarily sense their surroundings, beyond sight?","options":["By smelling with their tongue","Whiskers","Ears","Their tail"],"answer_index":0}',
     '{"source":"placeholder_general_knowledge"}'),
    (2, 'image_mc',
     '{"scrambled":"CSLAE","unscrambled":"SCALE","image_alt":"Close-up photo of snake scale texture","question":"What covers a snake''s body?","options":["Scale","Fur","Feather","Shell"],"answer_index":0}',
     '{"source":"placeholder_general_knowledge"}'),
    (3, 'minigame',
     '{"minigame_slug":"mini_snake"}',
     '{"source":"placeholder_general_knowledge"}')
) as v(order_index, type, content, metadata)
where c.name = 'Snake'
on conflict (character_id, order_index) do nothing;

-- Sloth
insert into hunt_challenges (character_id, order_index, type, content, metadata)
select c.id, v.order_index, v.type, v.content::jsonb, v.metadata::jsonb
from hunt_characters c,
(values
    (1, 'mc',
     '{"question":"About how many hours a day do sloths typically sleep?","options":["4-6","8-10","10-15","20+"],"answer_index":2}',
     '{"source":"placeholder_general_knowledge"}'),
    (2, 'true_false_set',
     '{"statements":[{"text":"Sloths are excellent swimmers","answer":true},{"text":"Sloths spend most of their lives upside down in trees","answer":true},{"text":"Sloths are fast runners on the ground","answer":false}]}',
     '{"source":"placeholder_general_knowledge"}'),
    (3, 'minigame',
     '{"minigame_slug":"mini_maze"}',
     '{"source":"placeholder_general_knowledge"}')
) as v(order_index, type, content, metadata)
where c.name = 'Sloth'
on conflict (character_id, order_index) do nothing;

insert into hunt_progress (character_id)
select c.id from hunt_characters c
on conflict (character_id) do nothing;
