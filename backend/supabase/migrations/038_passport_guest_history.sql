-- CAP Companion App — migration 038: Guest Accounts Phase 4 — Family
-- Passport history
--
-- Adds passport_sessions.guest_id, nullable, tagging each passport with the
-- guest it belongs to at generation time (app/services/passport.py's
-- generate_passport, resolved the same way as every other guest-aware
-- endpoint -- app/guest_auth.py's get_optional_guest). Unlike Coins/
-- Collectibles/Bingo/Map, this needs no cross-session join at read time: a
-- passport is generated once and never recomputed, so direct tagging at
-- creation is sufficient -- GET /account/passports (app/services/
-- passport.py's list_guest_passports) just filters passport_sessions by
-- guest_id directly.
--
-- Retroactive linking: app/services/guest_accounts.py's _link_device_session
-- (the same function that sets device_sessions.guest_id on login/signup) also
-- backfills guest_id onto any passport_sessions rows already tied to that
-- device session that don't yet have one set -- so a passport generated
-- earlier in the same visit, before logging in, becomes part of the guest's
-- history too. This never touches a row that already has a guest_id (e.g. a
-- passport generated on a different device, already linked to this guest).
--
-- An anonymous passport (guest_id stays null forever) is completely
-- unaffected -- same generation flow as before this migration, just with
-- nothing to view a history of.
--
-- Run this in the Supabase SQL editor against the live project.
-- Safe to run more than once: the column add is guarded and the index
-- create is idempotent.

alter table passport_sessions add column if not exists guest_id uuid references guests(id);

create index if not exists passport_sessions_guest_id_idx on passport_sessions(guest_id);
