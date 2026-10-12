-- CAP Companion App — migration 044: Staff Analytics summary as one SQL
-- function (analytics_summary)
--
-- GET /analytics/summary used to make 13 + ceil(N/1000) + 5*ceil(N/200)
-- sequential PostgREST calls, N = device sessions created in the range
-- (154 calls / ~25s for 7 days on the dev DB at ~5.3k sessions), almost all
-- of them chunked `session_id in (...)` lookups that came back empty. This
-- migration moves the aggregation into Postgres so the endpoint makes ONE
-- call whatever N is. It:
--
--   1. Adds analytics_summary(p_start, p_end) returning jsonb. It is a
--      one-for-one port of app/services/analytics.py's queries -- same
--      tables, same windows, same definitions:
--      - p_start / p_end are the exact inclusive bounds the backend already
--        used (UTC midnight of the start date .. 23:59:59.999999 UTC of the
--        end date, from _range_bounds). Every windowed metric compares its
--        own timestamp with >= p_start and <= p_end, exactly as the old
--        .gte()/.lte() filters did.
--      - The session cohort is device_sessions created in [p_start, p_end];
--        per-day buckets are the created_at date in UTC (what the old
--        Python got from PostgREST's UTC timestamps). The park timezone is
--        NOT applied here, because it never was in the Python version
--        either (only the Visit Heatmap uses America/Edmonton).
--      - Per-session STATE metrics (Bingo tiles/milestones, Hunt, Map
--        Exploration, Passport existence) read the cohort sessions' full
--        history, not re-windowed, same as before.
--      - Bingo line/X/blackout detection stays in Python
--        (app/services/milestone.py, the exact tile-index math): the
--        function only returns a 25-bit completed-tile bitmask per cohort
--        session, and only for sessions with at least one completion
--        (no completions can never be a milestone or a Full Completionist).
--        Bit i = tile row_index*5 + col_index, the same index the Python
--        code built from bingo_tiles.
--
--   2. Grants EXECUTE to service_role only. Postgres grants EXECUTE on new
--      functions to PUBLIC by default, and Supabase's default privileges
--      also grant it to anon/authenticated, so those are revoked
--      explicitly. The DO block at the end fails this migration if any of
--      them can still execute it, or if service_role can't.
--
--   3. Adds an index on device_sessions(created_at) (the cohort filter --
--      there was none) and on coin_awards(session_id) (the one
--      session-scoped table the function joins on that had no session_id
--      index).
--
-- Run this in the Supabase SQL editor against the live project (schema.sql
-- edits alone never reach the live DB). Must be run BEFORE deploying the
-- backend that calls it: without it, GET /analytics/summary returns a 500
-- naming this migration and the Analytics tab shows "Couldn't load
-- analytics" -- never zeros. Safe to run more than once: create or replace,
-- if not exists, and the revoke/grant are idempotent.

-- ---------------------------------------------------------------------------
-- 1. Indexes
-- ---------------------------------------------------------------------------
create index if not exists device_sessions_created_at_idx on device_sessions(created_at);
create index if not exists coin_awards_session_id_idx on coin_awards(session_id);

-- ---------------------------------------------------------------------------
-- 2. analytics_summary
-- ---------------------------------------------------------------------------
create or replace function analytics_summary(p_start timestamptz, p_end timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $$
with cohort as (
    select id, (created_at at time zone 'UTC')::date as created_day
    from device_sessions
    where created_at >= p_start and created_at <= p_end
),
-- Completions on tiles that no longer exist are skipped, as before.
cohort_completions as (
    select c.session_id, t.row_index * 5 + t.col_index as idx, c.completed_at
    from session_tile_completions c
    join cohort s on s.id = c.session_id
    join bingo_tiles t on t.id = c.tile_id
),
bingo as (
    select
        session_id,
        bit_or(1 << idx) as mask,
        count(*) filter (where completed_at >= p_start and completed_at <= p_end) as windowed_tiles
    from cohort_completions
    group by session_id
),
cohort_hunt as (
    select hp.session_id, hp.character_id, hp.unlocked_at, hp.completed_at
    from hunt_progress hp
    join cohort s on s.id = hp.session_id
)
select jsonb_build_object(
    'total_users', (select count(*) from cohort),
    'users_by_day', coalesce(
        (
            select jsonb_agg(jsonb_build_object('day', created_day, 'count', n) order by created_day)
            from (select created_day, count(*) as n from cohort group by created_day) d
        ),
        '[]'::jsonb
    ),
    'coins_total', (
        select coalesce(sum(amount), 0) from coin_awards where created_at >= p_start and created_at <= p_end
    ),
    'hunt_characters', coalesce(
        (
            select jsonb_agg(
                jsonb_build_object(
                    'id', hc.id,
                    'name', hc.name,
                    'found', (select count(*) from cohort_hunt h where h.character_id = hc.id and h.unlocked_at is not null)
                )
                order by hc.sort_order, hc.id
            )
            from hunt_characters hc
        ),
        '[]'::jsonb
    ),
    'hunt_total_unlocked', (select count(*) from cohort_hunt where unlocked_at is not null),
    'bingo_sessions', coalesce(
        (
            select jsonb_agg(
                jsonb_build_object(
                    'created_day', s.created_day,
                    'mask', b.mask,
                    'windowed_tiles', b.windowed_tiles,
                    'hunt_completed', (
                        select count(*) from cohort_hunt h where h.session_id = b.session_id and h.completed_at is not null
                    ),
                    'map_exploration', exists (
                        select 1 from coin_awards ca where ca.session_id = b.session_id and ca.source_type = 'map_exploration'
                    ),
                    'passport', exists (select 1 from passport_sessions p where p.session_id = b.session_id)
                )
                order by b.session_id
            )
            from bingo b
            join cohort s on s.id = b.session_id
        ),
        '[]'::jsonb
    ),
    'cohort_node_visits', (
        select count(*) from node_visits nv join cohort s on s.id = nv.session_id
    ),
    'node_rankings', coalesce(
        (
            select jsonb_agg(jsonb_build_object('node_id', r.node_id, 'name', r.name, 'visits', r.visits) order by r.node_id)
            from (
                select nv.node_id, coalesce(m.name, 'Unknown') as name, count(*) as visits
                from node_visits nv
                left join map_nodes m on m.id = nv.node_id
                where nv.visited_at >= p_start and nv.visited_at <= p_end
                group by nv.node_id, m.name
            ) r
        ),
        '[]'::jsonb
    ),
    'collectibles', coalesce(
        (
            select jsonb_agg(jsonb_build_object('animal_slug', r.animal_slug, 'count', r.n) order by r.animal_slug)
            from (
                select animal_slug, count(*) as n
                from collectible_redemptions
                where created_at >= p_start and created_at <= p_end
                group by animal_slug
            ) r
        ),
        '[]'::jsonb
    ),
    'puzzle_timer_solves', (
        select count(*) from puzzle_attempts where created_at >= p_start and created_at <= p_end
    ),
    'scoring_sheet_attempts', (
        select count(*) from score_sheet_sessions where created_at >= p_start and created_at <= p_end
    ),
    'scoring_sheet_completions', (
        select count(*) from score_sheet_sessions where completed_at >= p_start and completed_at <= p_end
    ),
    'photos_submitted', (
        select count(*) from photo_submissions where submitted_at >= p_start and submitted_at <= p_end
    ),
    -- Voting sessions intersected with the cohort, so the % can't exceed 100.
    'voting_cohort_sessions', (
        select count(distinct pv.session_id)
        from photo_votes pv
        join cohort s on s.id = pv.session_id
        where pv.created_at >= p_start and pv.created_at <= p_end
    ),
    'passports_generated', (
        select count(*) from passport_sessions where generated_at >= p_start and generated_at <= p_end
    ),
    'staff_requests_total', (
        select count(*) from staff_requests where created_at >= p_start and created_at <= p_end
    ),
    'staff_requests_question', (
        select count(*) from staff_requests where created_at >= p_start and created_at <= p_end and type = 'question'
    ),
    'staff_requests_emergency', (
        select count(*) from staff_requests where created_at >= p_start and created_at <= p_end and type = 'emergency'
    )
);
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants: service_role only
-- ---------------------------------------------------------------------------
revoke execute on function analytics_summary(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function analytics_summary(timestamptz, timestamptz) to service_role;

do $$
begin
    if not has_function_privilege('service_role', 'analytics_summary(timestamptz, timestamptz)', 'execute') then
        raise exception 'migration 044: service_role cannot execute analytics_summary';
    end if;
    if has_function_privilege('anon', 'analytics_summary(timestamptz, timestamptz)', 'execute')
        or has_function_privilege('authenticated', 'analytics_summary(timestamptz, timestamptz)', 'execute') then
        raise exception 'migration 044: anon/authenticated can still execute analytics_summary';
    end if;
end
$$;

-- PostgREST caches the schema; make the new function callable right away.
notify pgrst, 'reload schema';
