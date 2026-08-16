-- CAP Companion App — migration 017: grant service_role table privileges
--
-- schema.sql never granted explicit privileges on any table (relied on
-- Supabase's usual auto-provisioned defaults, which this project didn't get).
-- The backend connects exclusively as service_role (see
-- backend/app/supabase_client.py), so every route touching the DB was 500ing
-- with Postgres error 42501 "permission denied for table X". Grant it access
-- to everything that exists now, and default-grant it access to anything
-- created by future migrations too, so this doesn't recur per-table.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public
    grant all privileges on tables to service_role;
alter default privileges in schema public
    grant all privileges on sequences to service_role;
