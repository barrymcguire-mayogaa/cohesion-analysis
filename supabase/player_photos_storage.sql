-- COHESION — player photos (Supabase Storage bucket "player-photos", PRIVATE).
--
-- Player photos are for signed-in COHESION users only. Unlike the crests bucket,
-- this bucket is NOT public: nothing in it has a public URL.
--
-- WHAT BARRY DOES (once):
--   1. Supabase dashboard -> SQL Editor -> New query.
--   2. Paste this whole file, press Run. It is safe to run again at any time.
--   3. Look at the two result grids at the bottom:
--        a) one row:  player-photos | false | 524288 | {image/jpeg,image/png,image/webp,application/json}
--           The important column is  public = false.
--        b) "policies that mention player-photos": expect NO ROWS.
--   That is all — no policies to click, no keys to copy. Then open
--   COHESION -> Admin -> "👤 Player Photos" and upload.
--
-- IF THE SQL EDITOR REFUSES (e.g. "permission denied for table buckets" on some
-- projects) create the bucket by hand instead — same result:
--   1. Supabase dashboard -> Storage -> "New bucket".
--   2. Name: player-photos        (exactly, lower case, with the hyphen)
--   3. Leave "Public bucket" OFF.          <-- this is the whole point
--   4. Leave "Restrict file upload size" and "Restrict MIME types" OFF
--      (the Netlify function enforces both; if you do set MIME types you MUST
--      include application/json or the photo index cannot be saved).
--   5. Save. Do NOT add any policies.
--
-- HOW IT IS USED
--   * Objects are <team>/<player>-<stamp>.jpg (team and player = the name in lower
--     case with no accents, spaces or punctuation — cohPhotoKey in
--     cohesion-photos.js) plus one <team>/_index.json listing that team's photos.
--     There is no database table: the index files are the index.
--   * READ: the bucket is private and storage.objects has row level security with
--     NO policy for this bucket, so the anon key (the one in the browser) and
--     ordinary Supabase logins can neither download nor list anything in it.
--     Pages get photos only through netlify/functions/playerPhotos.js, which checks
--     the COHESION sign-in and then hands back links that stop working after 1 hour.
--   * WRITE: no insert/update/delete policies either. Only the service role
--     (the same Netlify function, admin-checked) can add, replace or remove a photo.
--   * Until this bucket exists the site just shows the initials badges: the photo
--     list comes back empty and uploads say "run supabase/player_photos_storage.sql".
--
-- DO NOT, later on, switch this bucket to "Public" or add a storage policy that
-- names it (or a catch-all policy on storage.objects with no bucket_id test): either
-- one would make the photos readable without signing in.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'player-photos',
  'player-photos',
  false,                                                            -- PRIVATE: no public URLs
  524288,                                                           -- 512 KB hard ceiling (function allows 300 KB)
  array['image/jpeg', 'image/png', 'image/webp', 'application/json']  -- json = the _index.json files
)
on conflict (id) do update
  set public             = false,                                   -- re-running this always puts it back to private
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Check a): expect exactly one row — player-photos | false | 524288 | {image/jpeg,image/png,image/webp,application/json}
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'player-photos';

-- Check b): storage policies that mention this bucket. Expect NO ROWS.
-- (A row here means somebody added a policy that may let browsers read or write
--  the photos directly — delete it under Storage -> Policies.)
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename  = 'objects'
  and (coalesce(qual, '') ilike '%player-photos%' or coalesce(with_check, '') ilike '%player-photos%');

-- Check c) (optional, read-only): catch-all policies on storage.objects — ones that
-- do not test bucket_id at all and so would cover this bucket too. Expect NO ROWS.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename  = 'objects'
  and coalesce(qual, '') || coalesce(with_check, '') not ilike '%bucket_id%';
