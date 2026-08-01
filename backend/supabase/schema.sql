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
