-- COHESION — playlists open to players and coaches: sharing levels, comments, the "new comments" badge, email
-- notifications and the admins' activity log (Barry, Oct 2026).
--
-- Run once in the Supabase SQL editor (safe to run again: every statement is idempotent). Nothing here changes or
-- removes an existing row: every playlist keeps working exactly as before —
--   scope 'club'     → Whole section   (visibility stays NULL; the function reads it as 'section')
--   scope 'personal' → Only me         (visibility NULL → 'private')
-- Until it is run the site still works: 'Only me' / 'Whole section' playlists and clip comments are written the old
-- way; Named people / Groups sharing, the badge, emails and the log answer "run supabase/playlists_share.sql".
--
-- Access: RLS on with NO policies, and no grants for anon / authenticated — like player_notes.sql. Only the service
-- role (the Netlify functions playlists.js and playlistDigest.js, which check the user's Identity JWT and roles on
-- every call) reads or writes. Supabase needs explicit grants for new tables (from 30 Oct 2026): service_role only.

-- ── playlists: the sharing columns ──
alter table public.playlists add column if not exists visibility   text;                                  -- private | people | groups | section (NULL = from scope)
alter table public.playlists add column if not exists share_people jsonb       not null default '[]'::jsonb; -- [{id, email, name}] Identity users (emails never leave the server)
alter table public.playlists add column if not exists share_groups jsonb       not null default '[]'::jsonb; -- ['group:forwards', …] Identity roles
alter table public.playlists add column if not exists owner_name   text        not null default '';
alter table public.playlists add column if not exists official     boolean     not null default false;      -- made by an admin / analyst at whole-section level
alter table public.playlists add column if not exists updated_at   timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'playlists_visibility_chk') then
    alter table public.playlists add constraint playlists_visibility_chk
      check (visibility is null or visibility in ('private', 'people', 'groups', 'section'));
  end if;
end $$;

-- ── comments: on a playlist (clip_id NULL) or on one clip (clip_id = the clip's cid), optionally at a moment (t, vid) ──
create table if not exists public.playlist_comments (
  id            bigserial   primary key,
  playlist_id   bigint      not null,
  clip_id       text,
  t             numeric,                                     -- the video second the comment is pinned to
  vid           text,                                        -- the camera (YouTube id) it was pinned on
  author_email  text        not null,
  author_name   text        not null default '',
  text          text        not null,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz
);
create index if not exists playlist_comments_playlist_idx on public.playlist_comments (playlist_id, created_at);

-- ── the badge: when each user last read each playlist's comments ──
create table if not exists public.playlist_seen (
  id           bigserial   primary key,
  email        text        not null,
  playlist_id  bigint      not null,
  seen_at      timestamptz not null default now()
);
create unique index if not exists playlist_seen_email_playlist_uq on public.playlist_seen (email, playlist_id);

-- ── per-user preferences: the email opt-out, and when the badge started counting for him ──
create table if not exists public.playlist_prefs (
  id             bigserial   primary key,
  email          text        not null,
  email_opt_out  boolean     not null default false,
  badge_since    timestamptz not null default now()
);
create unique index if not exists playlist_prefs_email_uq on public.playlist_prefs (email);

-- ── the email queue (sent as a digest by playlistDigest.js) ──
create table if not exists public.playlist_notify (
  id             bigserial   primary key,
  recipient      text        not null,
  playlist_id    bigint,
  playlist_name  text        not null default '',
  kind           text        not null,                       -- comment | share
  actor_name     text        not null default '',
  excerpt        text        not null default '',
  status         text        not null default 'pending',     -- pending | sent | skipped | expired | opted-out | failed
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);
create index if not exists playlist_notify_status_idx on public.playlist_notify (status, created_at);

-- ── the activity log: every action, kept after the playlist or comment is gone (no foreign key on purpose) ──
create table if not exists public.playlist_log (
  id             bigserial   primary key,
  playlist_id    bigint,
  playlist_name  text        not null default '',
  section        text        not null default 'county',
  owner          text        not null default '',
  actor_email    text        not null,
  actor_name     text        not null default '',
  action         text        not null,                       -- create | rename | edit | reorder | clips_added | clips_removed | share
                                                             -- | comment_add | comment_edit | comment_remove | delete
  details        jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists playlist_log_created_idx  on public.playlist_log (created_at desc);
create index if not exists playlist_log_playlist_idx on public.playlist_log (playlist_id, created_at desc);

-- ── access: service role only ──
alter table public.playlist_comments enable row level security;
alter table public.playlist_seen     enable row level security;
alter table public.playlist_prefs    enable row level security;
alter table public.playlist_notify   enable row level security;
alter table public.playlist_log      enable row level security;
revoke all on table public.playlist_comments from anon, authenticated;
revoke all on table public.playlist_seen     from anon, authenticated;
revoke all on table public.playlist_prefs    from anon, authenticated;
revoke all on table public.playlist_notify   from anon, authenticated;
revoke all on table public.playlist_log      from anon, authenticated;
revoke all on sequence public.playlist_comments_id_seq from anon, authenticated;
revoke all on sequence public.playlist_seen_id_seq     from anon, authenticated;
revoke all on sequence public.playlist_prefs_id_seq    from anon, authenticated;
revoke all on sequence public.playlist_notify_id_seq   from anon, authenticated;
revoke all on sequence public.playlist_log_id_seq      from anon, authenticated;
grant select, insert, update, delete on public.playlist_comments to service_role;
grant select, insert, update, delete on public.playlist_seen     to service_role;
grant select, insert, update, delete on public.playlist_prefs    to service_role;
grant select, insert, update, delete on public.playlist_notify   to service_role;
grant select, insert, update, delete on public.playlist_log      to service_role;
grant usage, select on sequence public.playlist_comments_id_seq to service_role;
grant usage, select on sequence public.playlist_seen_id_seq     to service_role;
grant usage, select on sequence public.playlist_prefs_id_seq    to service_role;
grant usage, select on sequence public.playlist_notify_id_seq   to service_role;
grant usage, select on sequence public.playlist_log_id_seq      to service_role;
-- playlists itself keeps its existing grants (service role; anon / authenticated SELECT already revoked by LOCKDOWN.sql)
