-- COHESION — the Panel Print-out's staff notes and squad picks (Analysis › Player Dashboard › PANEL PRINT-OUT).
--
-- Run once in the Supabase SQL editor (safe to run again: every statement is idempotent). Until it exists the
-- print-out keeps the notes in the analyst's browser and says so; the function playerNotes.js answers
-- "notes table not set up — run supabase/player_notes.sql".
--
-- player_notes   one row per team + player: the notes (dominant foot, style, strengths, watch point, form,
--                position label), the club typed in, who changed it and when.
-- panel_squads   one row per team + squad name: the season, the competition, the panel size, the opponent record,
--                the numbered slots (player / free-typed name / sub line / position label) and the cover's fields.
--                A table of its own (not a jsonb row in player_notes): a squad is a different thing with its own
--                life — several can exist for a team (one per fixture, e.g. "AISFC Final"), it is saved as a whole,
--                and it carries no player's notes.
--
-- Access: RLS on with NO policies, and no grants for anon / authenticated — exactly like xp_models.sql. Only the
-- service role (the Netlify function playerNotes.js, which checks the ADMIN role on every call) reads or writes.
-- Supabase needs explicit grants for new tables (from 30 Oct 2026): service_role only.

create table if not exists public.player_notes (
  id           bigserial   primary key,
  team         text        not null,                       -- normalised team key (upper case, trimmed: 'KERRY')
  player_key   text        not null,                       -- the player's name key (cohPlayerKey: 'davidclifford')
  player_name  text        not null default '',            -- the name as last shown
  club         text        not null default '',
  notes        jsonb       not null default '{}'::jsonb,   -- {hand, style, strengths, watch, form, pos}
  updated_at   timestamptz not null default now(),
  updated_by   text        not null default ''             -- the admin's email
);
create unique index if not exists player_notes_team_player_uq on public.player_notes (team, player_key);

create table if not exists public.panel_squads (
  id           bigserial   primary key,
  team         text        not null,                       -- normalised team key
  name         text        not null default 'current',     -- the squad's label ('current', 'AISFC Final' …)
  season       text        not null default '',
  competition  text        not null default '',
  data         jsonb       not null default '{}'::jsonb,   -- {size, opp, slots:{no:{key,name,free,line,pos}}, cover:{opponent,date}}
  updated_at   timestamptz not null default now(),
  updated_by   text        not null default ''
);
create unique index if not exists panel_squads_team_name_uq on public.panel_squads (team, name);

alter table public.player_notes enable row level security;
alter table public.panel_squads enable row level security;
revoke all on table public.player_notes from anon, authenticated;
revoke all on table public.panel_squads from anon, authenticated;
revoke all on sequence public.player_notes_id_seq from anon, authenticated;
revoke all on sequence public.panel_squads_id_seq from anon, authenticated;
grant select, insert, update, delete on public.player_notes to service_role;
grant select, insert, update, delete on public.panel_squads to service_role;
grant usage, select on sequence public.player_notes_id_seq to service_role;
grant usage, select on sequence public.panel_squads_id_seq to service_role;
