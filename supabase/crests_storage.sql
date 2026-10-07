-- COHESION — club / county crest uploads (Supabase Storage bucket "crests").
--
-- WHAT BARRY DOES (once):
--   1. Supabase dashboard -> SQL Editor -> New query.
--   2. Paste this whole file, press Run. It is safe to run again at any time.
--   3. Look at the result grid at the bottom: one row, id = crests, public = true.
--   That is all — no policies to click, no keys to copy. Then open
--   COHESION -> Admin -> "🛡 Crests" and upload.
--
-- IF THE SQL EDITOR REFUSES (e.g. "permission denied for table buckets" on some
-- projects) create the bucket by hand instead — same result:
--   1. Supabase dashboard -> Storage -> "New bucket".
--   2. Name: crests            (exactly, lower case)
--   3. Turn ON "Public bucket".
--   4. Leave "Restrict file upload size" and "Restrict MIME types" OFF
--      (the Netlify function enforces both; if you do set MIME types you MUST
--      include application/json or the crest index cannot be saved).
--   5. Save. Do NOT add any policies.
--
-- HOW IT IS USED
--   * Objects are <slug>.png (slug = team name, lower case, no accents/spaces —
--     the same rule as crests/index.js; see cohesion-crests.js) plus one
--     _index.json manifest listing every uploaded crest.
--   * READ: the bucket is PUBLIC, so <img> and <canvas> load
--     https://<project>.supabase.co/storage/v1/object/public/crests/<slug>.png
--     directly. Supabase Storage answers with Access-Control-Allow-Origin: *,
--     which is what lets the stats image / PDF / infographic draw them.
--     A public bucket needs NO select policy for this — and none is created,
--     so nobody can list or search the bucket with the anon key.
--   * WRITE: no insert/update/delete policies exist, so browsers cannot write.
--     Only the service role (netlify/functions/crests.js, admin-checked) can.
--   * Until this bucket exists the site just keeps using the bundled crests:
--     the crest list comes back empty and uploads say "run supabase/crests_storage.sql".

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crests',
  'crests',
  true,
  2097152,                                                         -- 2 MB hard ceiling (function allows 1.5 MB)
  array['image/png', 'image/jpeg', 'image/webp', 'application/json']  -- json = the _index.json manifest
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Check: expect exactly one row — crests | true | 2097152 | {image/png,image/jpeg,image/webp,application/json}
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'crests';
