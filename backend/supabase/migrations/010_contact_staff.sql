-- CAP Companion App — migration 010: Contact Staff (Plan.md 2.10)
--
-- staff_requests: a guest-submitted request for staff attention, of one of
-- two kinds -- 'question' (non-urgent) or 'emergency' (needs help now).
-- location_node_id is nullable because a guest may not be near any mapped
-- node, but the app always tries to attach one (guest picks their nearest
-- from the map node list -- no GPS/location tracking in this POC).
--
-- status walks open -> acknowledged -> resolved, one-way (see
-- app/services/staff_requests.py's _transition for the allowed-from checks).
-- resolved_at is only set on the final transition into 'resolved'.
--
-- No auth on the staff-facing list/acknowledge/resolve endpoints -- same
-- no-login POC scope as the rest of this app (see CLAUDE.md).
--
-- Per the project's established gotcha (seed.sql edits don't reach the live
-- DB -- see migrations 004-009's headers), this migration is what actually
-- applies the change to the live database; seed.sql and schema.sql are
-- updated separately (seed.sql needs no new rows here -- staff_requests is
-- runtime guest-generated data, not fixture content).
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: the table create and index creates are guarded.

create table if not exists staff_requests (
    id                uuid primary key default gen_random_uuid(),
    type              text not null check (type in ('question', 'emergency')),
    location_node_id  uuid references map_nodes(id) on delete set null,
    status            text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
    created_at        timestamptz not null default now(),
    resolved_at       timestamptz
);

create index if not exists staff_requests_status_idx on staff_requests(status);
create index if not exists staff_requests_location_node_id_idx on staff_requests(location_node_id);
