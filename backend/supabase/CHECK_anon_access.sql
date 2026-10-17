-- Read-only. Run in the Supabase SQL editor on EACH project (dev/demo and
-- production). Answers: what can the anon (and authenticated) key do?
-- Before migration 046, schema.sql and the migrations enabled no RLS
-- anywhere, so the answer depended entirely on what grants those roles
-- hold. After 046, every public table has RLS on with no policies, so query
-- 1 should show rls_enabled = true for every row.

-- 1. Every public table: RLS on/off, and what anon / authenticated may do.
select c.relname                                   as table_name,
       c.relrowsecurity                            as rls_enabled,
       has_table_privilege('anon', c.oid, 'SELECT')           as anon_select,
       has_table_privilege('anon', c.oid, 'INSERT')           as anon_insert,
       has_table_privilege('anon', c.oid, 'UPDATE')           as anon_update,
       has_table_privilege('anon', c.oid, 'DELETE')           as anon_delete,
       has_table_privilege('authenticated', c.oid, 'SELECT')  as auth_select,
       has_table_privilege('authenticated', c.oid, 'INSERT')  as auth_insert
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
order by anon_select desc, c.relname;
-- Wanted: every anon_* / auth_* column false. Any true with rls_enabled =
-- false means anyone holding the anon key can read/write that table through
-- PostgREST -- most sensitive: guests (password hashes), guest_auth_tokens,
-- password_reset_tokens, photo_submissions (emails), device_sessions.

-- 2. Functions anon can execute (044 revoked analytics_summary; check the rest).
select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by anon_exec desc, p.proname;

-- 3. Default privileges that would hand future tables to anon.
select pg_get_userbyid(defaclrole) as owner, defaclobjtype, defaclacl
from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname = 'public';

-- 4. Storage: buckets, and any policy letting anon list/read/write objects.
select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;
select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage';
-- Wanted: no policies granting anon on storage.objects (public buckets
-- serve by exact URL only; listing needs a SELECT policy).
