-- COHESION — telestration on comments: a drawing per comment, comment colours, @mentions and freeze-frame stills
-- (Barry, Oct 2026). Runs AFTER supabase/playlists_share.sql (which made playlist_comments).
--
-- Run once in the Supabase SQL editor (safe to run again: every statement is idempotent). Nothing here changes or
-- removes an existing row or column: staff clip drawings (it.draws inside each playlist) are untouched, and every
-- existing comment keeps working — it gets its colour from its place in the thread until it is next written.
-- Until it is run the site still works: comments post as before (colours by order), @mentions still email, and the
-- Playlists page hides "draw on a comment" and the freeze-frame stills (the function answers me.tele:false).
--
-- Access: no new table. playlist_comments keeps RLS on with NO policies and the grants of playlists_share.sql (service
-- role only; anon / authenticated revoked) — they are re-stated below so this script is right even on its own. Only the
-- service role (netlify/functions/playlists.js and notifications.js, which check the user's Identity JWT and roles on
-- every call) reads or writes. The freeze-frame stills live in a PRIVATE storage bucket with no policies (below).

-- ── comments: their drawing, colour and mentions, and the still of their moment ──
alter table public.playlist_comments add column if not exists drawing   jsonb;                                  -- {shapes:[…], caption?} at the comment's t (NULL = none)
alter table public.playlist_comments add column if not exists color     text;                                   -- '#4fc3f7' … assigned by the server when the comment is made
alter table public.playlist_comments add column if not exists color_idx integer;                                -- its place in the palette (max on the clip + 1: deleting never recolours)
alter table public.playlist_comments add column if not exists mentions  jsonb       not null default '[]'::jsonb; -- [{id, name}] Identity user ids @mentioned (names only; never an email)
alter table public.playlist_comments add column if not exists still     text;                                   -- object path in the playlist-stills bucket (the frame under the drawing)
alter table public.playlist_comments add column if not exists parent_id bigint references public.playlist_comments(id) on delete set null;   -- a reply: the comment it answers (one level; NULL = a comment of its own)

-- (the 🔔 bell, notifications.js, finds a person's mentions in these rows — no separate table)

-- ── access (as playlists_share.sql): service role only ──
alter table public.playlist_comments enable row level security;
revoke all on table public.playlist_comments from anon, authenticated;
revoke all on sequence public.playlist_comments_id_seq from anon, authenticated;
grant select, insert, update, delete on public.playlist_comments to service_role;
grant usage, select on sequence public.playlist_comments_id_seq to service_role;

-- ── freeze-frame stills: Supabase Storage bucket "playlist-stills", PRIVATE (as "player-photos") ──
-- Objects <playlist id>/c<comment id>-<stamp>.jpg (a comment's moment) and <playlist id>/d<clip id>-<t×10>-<stamp>.jpg (a
-- staff drawing stop), JPEG only, made by playlists.js (action 'still', service role) from the desktop app's capture of
-- the video, or from a local video file's frame. READ: no public URL and NO storage policy, so the anon key and ordinary
-- Supabase logins can neither download nor list anything; pages get a still only as a 1-hour SIGNED URL handed out by
-- playlists.js to a signed-in person who can see that playlist (its section and sharing level).
-- IF THE SQL EDITOR REFUSES the insert below ("permission denied for table buckets"): Storage → New bucket → name
-- playlist-stills, "Public bucket" OFF, no policies. Until the bucket exists stills are simply not kept (no error).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('playlist-stills', 'playlist-stills', false, 524288, array['image/jpeg'])
on conflict (id) do update
  set public             = false,                                   -- re-running this always puts it back to private
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Check a): expect one row — playlist-stills | false | 524288 | {image/jpeg}
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'playlist-stills';
-- Check b): storage policies that mention this bucket. Expect NO ROWS.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') ilike '%playlist-stills%' or coalesce(with_check, '') ilike '%playlist-stills%');
