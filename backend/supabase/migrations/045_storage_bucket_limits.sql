-- CAP Companion App — migration 045: upload size and type limits on the
-- three photo Storage buckets
--
-- Defence in depth behind backend/app/uploads.py, which already checks every
-- photo upload (POST /photos/submit, POST /passport/generate, staff POST
-- /animal-photos/{slug}) before it reaches Storage. With this migration
-- Storage itself refuses an object over 15 MB, or with any content type
-- other than JPEG/PNG/WebP, whoever uploads it. The limits apply to
-- service_role uploads too, and the content type checked is the one the
-- uploader declares. The backend declares the type uploads.py detected from
-- the bytes, never the client's.
--
--   - file_size_limit = 15728640 bytes = 15 * 1024 * 1024 (15 MiB). That is
--     exactly uploads.py's MAX_UPLOAD_BYTES, so the backend's 413 always
--     fires first and Storage never refuses a photo the backend accepted.
--     ("15 MB" in the user-facing message means this same value.)
--   - allowed_mime_types = the three types uploads.py's _FORMATS stores:
--     image/jpeg, image/png, image/webp.
--
-- Existing objects are NOT affected. Storage checks these limits only when
-- an object is uploaded; it never re-checks stored objects. Everything
-- already stored -- including any animal GIFs staff uploaded before
-- uploads.py stopped accepting GIF -- keeps being served from its public
-- URL, and staff can still delete it. The app never copies, moves or
-- re-uploads an existing object: it only reads public URLs and deletes.
--
-- Scripts that upload directly with the service key were changed with this
-- migration so they stay inside the list:
--   - scripts/migrate_animal_photos.py no longer picks up .gif files (a GIF
--     would have been refused only after that animal's rows were deleted).
--   - scripts/verify_session_cleanup.py's passport fixture is now a 1x1 PNG
--     instead of a text/plain file.
--
-- Does NOT need to run before the backend deploys -- run it AFTER the
-- backend that includes uploads.py is live. A backend from before uploads.py
-- stores the client's own Content-Type (GIF accepted for staff, anything at
-- all for guests), so with these limits in place Storage would turn some of
-- its uploads into errors instead of clean 413/415 messages.
--
-- Run this in the Supabase SQL editor against the live project (schema.sql
-- edits alone never reach the live DB). Safe to run more than once: a plain
-- UPDATE to fixed values. Buckets not yet created are simply not updated --
-- check the verify query below shows all three rows.

update storage.buckets
set file_size_limit    = 15728640,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id in ('animal-photos', 'family-passport-photos', 'favorite-photos');

-- Verify (expect 3 rows, each public = true, file_size_limit = 15728640,
-- allowed_mime_types = {image/jpeg,image/png,image/webp}):
--
-- select id, public, file_size_limit, allowed_mime_types
-- from storage.buckets
-- where id in ('animal-photos', 'family-passport-photos', 'favorite-photos')
-- order by id;
