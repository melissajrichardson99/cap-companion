-- CAP Companion App — Phase 1 schema
-- Run this in the Supabase SQL editor (or via the CLI) against a fresh project.
-- Covers: map_nodes, bingo_cards, bingo_tiles, minigames (tech spec section 3).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- map_nodes
-- ---------------------------------------------------------------------------
create table if not exists map_nodes (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    category    text not null check (category in ('attraction', 'animal', 'service', 'food', 'seasonal')),
    description text not null default '',
    state       text not null default 'not_visited' check (state in ('not_visited', 'visited', 'closed')),
    -- Percentage position (0-100) on the map background image, not pixel
    -- coordinates. Null until the node has been placed on the hand-drawn map.
    x_pct       double precision check (x_pct is null or (x_pct >= 0 and x_pct <= 100)),
    y_pct       double precision check (y_pct is null or (y_pct >= 0 and y_pct <= 100)),
    -- Self-referential: set on nodes that are really a sub-game of a single
    -- physical pad (e.g. Cornhole -> Arcade Pad). Parented nodes don't render
    -- their own pin; the parent's popup lists them instead.
    parent_node_id uuid references map_nodes(id) on delete set null,
    created_at  timestamptz not null default now()
);

-- Note: MapNode.linked_bingo_tile_ids (tech spec section 3) is intentionally NOT
-- stored as a column here. bingo_tiles.linked_map_node_id is the single source of
-- truth for the relationship; the API derives a node's linked tile ids by querying
-- bingo_tiles where linked_map_node_id = node.id. Storing a mirrored array on both
-- sides would just create a sync-drift bug (the "not just approximate" spirit of
-- the known pitfalls section applies here too).

-- ---------------------------------------------------------------------------
-- bingo_cards
-- ---------------------------------------------------------------------------
create table if not exists bingo_cards (
    id                 uuid primary key default gen_random_uuid(),
    owner_label        text not null,
    milestone_lines    integer[] not null default '{}',   -- indices 0-9: rows 0-4, cols 5-9
    milestone_x        boolean not null default false,
    milestone_blackout boolean not null default false,
    created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- bingo_tiles
-- ---------------------------------------------------------------------------
create table if not exists bingo_tiles (
    id                 uuid primary key default gen_random_uuid(),
    card_id            uuid not null references bingo_cards(id) on delete cascade,
    row_index          integer not null check (row_index between 0 and 4),
    col_index          integer not null check (col_index between 0 and 4),
    label              text not null,
    linked_map_node_id uuid references map_nodes(id) on delete set null,
    completed          boolean not null default false,
    completed_at       timestamptz,
    created_at         timestamptz not null default now(),
    unique (card_id, row_index, col_index)
);

create index if not exists bingo_tiles_card_id_idx on bingo_tiles(card_id);
create index if not exists bingo_tiles_linked_map_node_id_idx on bingo_tiles(linked_map_node_id);

-- ---------------------------------------------------------------------------
-- minigames
-- ---------------------------------------------------------------------------
create table if not exists minigames (
    id                       uuid primary key default gen_random_uuid(),
    name                     text not null unique,
    engine_group             text not null check (engine_group in ('reaction_timing', 'grid_drag', 'auto_scroll', 'standalone')),
    theme                    text not null default '',
    target_duration_seconds  integer not null default 30,
    phase                    integer not null check (phase in (1, 2))
);

-- ---------------------------------------------------------------------------
-- puzzles / puzzle_challenges / puzzle_attempts (Puzzle Solving Timer, plan 2.3)
-- ---------------------------------------------------------------------------
create table if not exists puzzles (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    rules_text  text not null default '',
    -- Optional link back to the physical attraction's map_nodes row (5 of the
    -- 6 puzzles already exist there as sub-games of Ground Games; Big Mystery
    -- Maze links to the existing "Mystery Maze" node). Nullable/set-null, same
    -- pattern as bingo_tiles.linked_map_node_id -- this table is the FK side,
    -- not a mirrored name/description, to avoid a sync-drift bug.
    map_node_id uuid references map_nodes(id) on delete set null,
    created_at  timestamptz not null default now()
);

create table if not exists puzzle_challenges (
    id                   uuid primary key default gen_random_uuid(),
    puzzle_id            uuid not null references puzzles(id) on delete cascade,
    -- e.g. "Reach the Top" for multi-challenge puzzles, or "Default" for the
    -- 4 puzzles that only have one objective.
    label                text not null,
    sort_order           integer not null default 0,
    -- Not all challenges have an official target time yet (Plan.md 2.3 open
    -- item) -- nullable rather than a placeholder 0/-1.
    target_time_seconds  integer check (target_time_seconds is null or target_time_seconds > 0),
    solution_type        text not null check (solution_type in ('exact', 'strategy', 'none')),
    -- hint_tier_3 holds the full solution ('exact') or complete strategy
    -- explanation ('strategy'). All three are null for 'none' puzzles
    -- (Big Mystery Maze), which get a timer/leaderboard but no hint button.
    hint_tier_1          text,
    hint_tier_2          text,
    hint_tier_3          text,
    created_at           timestamptz not null default now(),
    unique (puzzle_id, label)
);

create index if not exists puzzle_challenges_puzzle_id_idx on puzzle_challenges(puzzle_id);

create table if not exists puzzle_attempts (
    id              uuid primary key default gen_random_uuid(),
    challenge_id    uuid not null references puzzle_challenges(id) on delete cascade,
    elapsed_seconds integer not null check (elapsed_seconds > 0),
    created_at      timestamptz not null default now()
);

create index if not exists puzzle_attempts_challenge_id_idx on puzzle_attempts(challenge_id);

-- ---------------------------------------------------------------------------
-- scoring_games / game_score_events / score_sheet_sessions / score_entries
-- (Scoring Sheet, plan 2.2)
-- ---------------------------------------------------------------------------
create table if not exists scoring_games (
    id                  uuid primary key default gen_random_uuid(),
    name                text not null unique,
    rules_text          text not null default '',
    win_condition_text  text not null default '',
    -- Machine-readable win condition, since automatic detection needs exact
    -- threshold/tie-rule math, not text parsing. Maps 1:1 to the three pure
    -- functions in app/services/scoring.py: 'first_to' (first player past
    -- the threshold wins outright), 'first_to_bonus_round' (first past the
    -- threshold wins unless tied with the leader, in which case play
    -- continues sudden-death until someone pulls ahead -- Horse Hoops), and
    -- 'first_to_round_tiebreak' (win condition only checked at
    -- throws_per_round boundaries, highest of those clearing the threshold
    -- wins, ties continue into further rounds -- Tiki Toss).
    win_condition_type  text not null check (win_condition_type in ('first_to', 'first_to_bonus_round', 'first_to_round_tiebreak')),
    win_threshold       integer not null check (win_threshold > 0),
    throws_per_round    integer check (throws_per_round is null or throws_per_round > 0),
    created_at          timestamptz not null default now()
);

create table if not exists game_score_events (
    id          uuid primary key default gen_random_uuid(),
    game_id     uuid not null references scoring_games(id) on delete cascade,
    label       text not null,
    -- >= 0, not > 0: a 0-point "Miss" event is seeded per game (migration
    -- 015) so a missed shot reuses the same events/entries machinery as a
    -- real score.
    point_value integer not null check (point_value >= 0),
    sort_order  integer not null default 0,
    created_at  timestamptz not null default now(),
    unique (game_id, label)
);

create index if not exists game_score_events_game_id_idx on game_score_events(game_id);

create table if not exists score_sheet_sessions (
    id            uuid primary key default gen_random_uuid(),
    game_id       uuid not null references scoring_games(id) on delete cascade,
    players       text[] not null,
    winner        text,
    completed_at  timestamptz,
    created_at    timestamptz not null default now()
);

create index if not exists score_sheet_sessions_game_id_idx on score_sheet_sessions(game_id);

create table if not exists score_entries (
    id             uuid primary key default gen_random_uuid(),
    session_id     uuid not null references score_sheet_sessions(id) on delete cascade,
    player_name    text not null,
    score_event_id uuid not null references game_score_events(id) on delete restrict,
    -- This player's 1-indexed turn number within the session (their Nth
    -- turn). NOT the same concept as the Tiki-Toss-only round_number in
    -- app/services/scoring.py (that's a 10-throw win-check boundary) --
    -- turn_round is per-player-per-turn and applies to every game, used for
    -- turn-order enforcement and the round-based export (migration 015).
    turn_round     integer not null,
    created_at     timestamptz not null default now()
);

create index if not exists score_entries_session_id_idx on score_entries(session_id);

-- ---------------------------------------------------------------------------
-- hunt_characters / hunt_challenges / hunt_progress (Scavenger Hunt)
-- ---------------------------------------------------------------------------
create table if not exists hunt_characters (
    id               uuid primary key default gen_random_uuid(),
    name             text not null unique,
    species_category text not null check (species_category in ('marsupial', 'rodent', 'other')),
    -- Matches a key in GAME_SLUGS (frontend/src/components/MinigameOverlay.tsx).
    minigame_slug    text not null,
    sort_order       integer not null default 0,
    created_at       timestamptz not null default now()
);

create table if not exists hunt_challenges (
    id            uuid primary key default gen_random_uuid(),
    character_id  uuid not null references hunt_characters(id) on delete cascade,
    order_index   integer not null check (order_index between 1 and 3),
    type          text not null check (type in ('mc', 'matching', 'true_false_set', 'image_mc', 'minigame')),
    -- jsonb, not the usual array-over-JSON convention: content genuinely
    -- varies in shape per type (MC question+options, matching pairs, T/F
    -- statement list, or scrambled-word+question), which a native array
    -- can't represent.
    content       jsonb not null default '{}'::jsonb,
    -- metadata.source flags placeholder trivia ('placeholder_general_knowledge')
    -- vs. park-verified content ('park_verified') so it can be found and
    -- replaced later without re-auditing every character.
    metadata      jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now(),
    unique (character_id, order_index)
);

create index if not exists hunt_challenges_character_id_idx on hunt_challenges(character_id);

create table if not exists hunt_progress (
    id                    uuid primary key default gen_random_uuid(),
    character_id          uuid not null unique references hunt_characters(id) on delete cascade,
    -- order_index values (1-3) completed so far. completed_at is set once
    -- this reaches all 3, monotonically -- never re-derived/unset.
    challenges_completed  integer[] not null default '{}',
    completed_at          timestamptz,
    -- Set once, the first time a guest scans/enters this character's QR
    -- code (migration 014). NULL = locked; the character's challenges are
    -- gated behind this in the frontend until it's set.
    unlocked_at           timestamptz,
    created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- encyclopedia_entries / scannable_codes (QR scanning)
-- ---------------------------------------------------------------------------
create table if not exists encyclopedia_entries (
    id          uuid primary key default gen_random_uuid(),
    animal_name text not null unique,
    status      text not null default 'placeholder' check (status in ('placeholder', 'published')),
    created_at  timestamptz not null default now()
);

create table if not exists scannable_codes (
    id                    uuid primary key default gen_random_uuid(),
    -- Two curated, easy-to-spell English words joined by a hyphen (e.g.
    -- "brave-otter"), generated by app/services/scan_codes.py. Stored
    -- canonically lowercase/hyphenated -- lookups normalize case/whitespace
    -- before matching (see app/services/scan.py).
    code                  text not null unique,
    -- Real polymorphic association, not an untyped (type, target_id) pair:
    -- exactly one of these two FKs is set, enforced below, so referential
    -- integrity (cascade on delete, FK validation) holds for whichever
    -- target type a given code points at.
    hunt_character_id     uuid references hunt_characters(id) on delete cascade,
    encyclopedia_entry_id uuid references encyclopedia_entries(id) on delete cascade,
    created_at            timestamptz not null default now(),
    constraint scannable_codes_exactly_one_target check (
        (hunt_character_id is not null)::int + (encyclopedia_entry_id is not null)::int = 1
    )
);

create index if not exists scannable_codes_hunt_character_id_idx on scannable_codes(hunt_character_id);
create index if not exists scannable_codes_encyclopedia_entry_id_idx on scannable_codes(encyclopedia_entry_id);

-- ---------------------------------------------------------------------------
-- staff_requests (Contact Staff -- Plan.md 2.10)
-- ---------------------------------------------------------------------------
create table if not exists staff_requests (
    id                uuid primary key default gen_random_uuid(),
    type              text not null check (type in ('question', 'emergency')),
    -- No GPS/location tracking in this POC -- the guest picks their nearest
    -- node from the map node list, so this can be null if they skip it.
    location_node_id  uuid references map_nodes(id) on delete set null,
    -- One-way: open -> acknowledged -> resolved. See
    -- app/services/staff_requests.py's _transition for the allowed-from checks.
    status            text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
    created_at        timestamptz not null default now(),
    resolved_at       timestamptz
);

create index if not exists staff_requests_status_idx on staff_requests(status);
create index if not exists staff_requests_location_node_id_idx on staff_requests(location_node_id);

-- ---------------------------------------------------------------------------
-- coin_awards / collectibles (Cobb Coins -- POC scope, no redemption)
-- ---------------------------------------------------------------------------
create table if not exists coin_awards (
    id          uuid primary key default gen_random_uuid(),
    source_type text not null check (source_type in ('scavenger_hunt', 'puzzle_timer', 'scoring_sheet_win', 'bingo_tile')),
    -- Id of the row that triggered this award (hunt_characters.id,
    -- puzzle_attempts.id, score_sheet_sessions.id, or bingo_tiles.id
    -- depending on source_type) -- a plain uuid, not an FK, since it's
    -- polymorphic across 4 tables (same tradeoff as scannable_codes' typed
    -- pair, minus the exactly-one-of constraint since the type tag alone
    -- already disambiguates the table). This is an append-only ledger, not
    -- a mutable balance column -- the running total is always derived by
    -- summing it (app/services/coins.py's get_total()).
    source_id   uuid not null,
    amount      integer not null check (amount > 0),
    created_at  timestamptz not null default now()
);

create index if not exists coin_awards_source_type_idx on coin_awards(source_type);

create table if not exists collectibles (
    id                uuid primary key default gen_random_uuid(),
    name              text not null unique,
    -- Emoji/icon reference, not an uploaded image -- POC scope.
    icon              text not null,
    unlock_threshold  integer not null check (unlock_threshold > 0),
    created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- photo_submissions / photo_votes (Favorite Photo -- Plan.md 2.14, POC scope:
-- single ongoing voting period, no day/week/month cycling yet)
-- ---------------------------------------------------------------------------
create table if not exists photo_submissions (
    id            uuid primary key default gen_random_uuid(),
    guest_label   text,
    -- Supabase Storage object key in the 'favorite-photos' bucket -- the
    -- actual image bytes live in Storage, not the DB. photo_url is derived
    -- at read time from this path (app/services/photos.py), never stored,
    -- same "derive, don't duplicate" discipline as coin_awards -> CoinsSummary.
    storage_path  text not null,
    submitted_at  timestamptz not null default now(),
    -- One-way: pending_review -> shortlisted or pending_review -> rejected.
    -- See app/services/photos.py's _curate for the allowed-from check. Only
    -- shortlisted photos are ever shown to guests for voting.
    status        text not null default 'pending_review' check (status in ('pending_review', 'shortlisted', 'rejected'))
);

create index if not exists photo_submissions_status_idx on photo_submissions(status);

create table if not exists photo_votes (
    id                uuid primary key default gen_random_uuid(),
    submission_id     uuid not null references photo_submissions(id) on delete cascade,
    -- Client-generated id stored in localStorage, not real auth -- just
    -- enough to stop trivial double-voting from the same device/browser.
    voter_session_id  text not null,
    created_at        timestamptz not null default now(),
    unique (submission_id, voter_session_id)
);

create index if not exists photo_votes_submission_id_idx on photo_votes(submission_id);

-- Public so guest devices can load gallery images directly with no
-- signed-URL round trip -- fine for a POC with no PII in guest uploads.
insert into storage.buckets (id, name, public)
values ('favorite-photos', 'favorite-photos', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- passport_sessions (Family Passport -- Plan.md 2.8, POC scope)
-- ---------------------------------------------------------------------------
create table if not exists passport_sessions (
    id                  uuid primary key default gen_random_uuid(),
    family_label        text not null,
    -- Supabase Storage object key in the 'family-passport-photos' bucket --
    -- nullable, since the group photo prompt is optional.
    photo_storage_path  text,
    generated_at        timestamptz not null default now(),
    -- JSON snapshot computed once at generation time (app/services/passport.py)
    -- and frozen here -- deliberately NOT re-derived on read, unlike every
    -- other "derive, don't duplicate" spot in this schema, because a
    -- passport is a one-time end-of-visit keepsake whose numbers must not
    -- drift if the family keeps playing afterward.
    stats               jsonb not null
);

create index if not exists passport_sessions_generated_at_idx on passport_sessions(generated_at);

insert into storage.buckets (id, name, public)
values ('family-passport-photos', 'family-passport-photos', true)
on conflict (id) do nothing;
