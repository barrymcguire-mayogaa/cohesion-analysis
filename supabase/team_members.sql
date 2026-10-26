-- COHESION — the TEAM page's people (Admin › Team) and its activity log.
--
-- Run once in the Supabase SQL editor (safe to run again: every statement is idempotent). Until it exists the Team page
-- says "team tables not set up — run supabase/team_members.sql" (netlify/functions/teamAdmin.js answers 503).
--
-- SIGN-IN AND ACCESS STAY ON NETLIFY IDENTITY: a person's roles live in Identity (app_metadata.roles) and every
-- function reads them from the verified JWT. These tables hold what Identity does not:
--
-- team_members   one row per person, keyed by the Identity user id: name, email, position, squad number, club, PHONE,
--                team / section, the LINKED PLAYER (team + player key + the name as shown — their name in the stats),
--                a copy of the roles last written (for display / the picker when Identity cannot be reached; Identity
--                stays the truth), and who created / changed / removed the row and when. "Remove access" deletes the
--                Identity user and marks the row status 'removed' — the row is kept for history.
-- team_audit     every Team page action (invite, update, resend, link, unlink, remove): who, when, to whom, what.
--                A phone number is never written here (only "phone changed").
--
-- PERSONAL DATA: phone is returned by teamAdmin.js to ADMINS ONLY, never to any other role and never in a picker.
--
-- Access: RLS on with NO policies, and no grants for anon / authenticated — exactly like player_notes.sql. Only the
-- service role (the Netlify function teamAdmin.js, which checks the ADMIN role on every call) reads or writes.
-- Supabase needs explicit grants for new tables (from 30 Oct 2026): service_role only, plus the sequences.

create table if not exists public.team_members (
  id                bigserial   primary key,
  user_id           text        not null,                       -- the Netlify Identity user id (changes on a re-sent invite)
  email             text        not null,                       -- lower case
  name              text        not null default '',
  position          text        not null default '',
  squad_number      integer,                                    -- 0–99, null = none
  club              text        not null default '',
  phone             text        not null default '',            -- ADMINS ONLY
  team              text        not null default '',            -- the person's team, e.g. 'MAYO'
  section           text        not null default 'county',      -- 'county' | 'club' | 'u20' (the squad they belong to)
  roles             jsonb       not null default '[]'::jsonb,   -- a copy of the Identity roles last written here
  link_team         text        not null default '',            -- LINKED PLAYER: the team key ('KERRY')
  link_section      text        not null default '',            --   the section of that team's games
  link_player_key   text        not null default '',            --   the Player Dashboard's player key (cohPlayerKey)
  link_player_name  text        not null default '',            --   the name as shown in the stats
  linked_at         timestamptz,
  linked_by         text        not null default '',
  status            text        not null default 'active',      -- 'active' | 'removed'
  removed_at        timestamptz,
  removed_by        text        not null default '',
  created_at        timestamptz not null default now(),
  created_by        text        not null default '',            -- the admin's email
  updated_at        timestamptz not null default now(),
  updated_by        text        not null default ''
);
create unique index if not exists team_members_user_uq on public.team_members (user_id);
create index if not exists team_members_email_idx on public.team_members (email);

create table if not exists public.team_audit (
  id               bigserial   primary key,
  at               timestamptz not null default now(),
  actor            text        not null default '',             -- the admin's email
  actor_id         text        not null default '',             -- the admin's Identity id
  action           text        not null,                        -- invite | update | resend | link | unlink | remove
  target_user_id   text        not null default '',
  target_email     text        not null default '',
  detail           jsonb       not null default '{}'::jsonb     -- e.g. {roles:{from,to}, changed:['position','phone']}
);
create index if not exists team_audit_at_idx on public.team_audit (at desc);

alter table public.team_members enable row level security;
alter table public.team_audit enable row level security;
revoke all on table public.team_members from anon, authenticated;
revoke all on table public.team_audit from anon, authenticated;
revoke all on sequence public.team_members_id_seq from anon, authenticated;
revoke all on sequence public.team_audit_id_seq from anon, authenticated;
grant select, insert, update, delete on public.team_members to service_role;
grant select, insert, update, delete on public.team_audit to service_role;
grant usage, select on sequence public.team_members_id_seq to service_role;
grant usage, select on sequence public.team_audit_id_seq to service_role;
