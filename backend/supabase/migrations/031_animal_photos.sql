-- CAP Companion App — migration 031: Staff-managed Animal Photos
--
-- Moves "Our Animals" photos off static files bundled with the frontend
-- (frontend/public/animals/<slug>/1..5.{jpg,png}) onto real staff-managed
-- storage, following the same pattern as Favorite Photo (migration 012):
-- animal_photos.storage_path is a Supabase Storage object key, photo_url is
-- derived at read time via the storage API's get_public_url (never stored),
-- same "derive, don't duplicate" discipline as photo_submissions.
--
-- Deliberately separate from photo_submissions/favorite-photos: this is
-- permanent, staff-only reference content, not ephemeral guest submissions
-- behind a moderation queue -- no status column, since staff uploading
-- directly IS the approval.
--
-- Deliberately separate from Collectibles' curated photo pool
-- (backend/app/services/collectibles.py's PHOTO_POOL_SIZE): Collectibles
-- keeps resolving straight against the static files in
-- frontend/public/animals/ via animalContent.ts's imageCandidates() --
-- those files are NOT deleted by this migration or by
-- backend/scripts/migrate_animal_photos.py, and newly staff-uploaded animal
-- photos never feed into Collectibles.
--
-- Run this in the Supabase SQL editor against the live project, then run
-- backend/scripts/migrate_animal_photos.py to seed it from the existing
-- static files. Safe to run more than once: table/index creates are
-- guarded, and the bucket insert is guarded by ON CONFLICT (id) DO NOTHING.
-- Migration 017's default-privileges grant already covers this new table
-- for service_role, no explicit grant needed here.

create table if not exists animal_photos (
    id            uuid primary key default gen_random_uuid(),
    animal_slug   text not null,
    storage_path  text not null,
    display_order integer not null,
    created_at    timestamptz not null default now()
);

create index if not exists animal_photos_animal_slug_idx on animal_photos(animal_slug);

insert into storage.buckets (id, name, public)
values ('animal-photos', 'animal-photos', true)
on conflict (id) do nothing;
