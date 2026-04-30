-- COHESION Analysis: Initial Schema
-- Tables: games, events
-- Created: April 30, 2026

-- Games table: Stores game metadata (teams, competition, videos, angles)
create table if not exists games (
  id text primary key,
  title text not null,
  date text,
  opposition text,
  competition text,
  venue text,
  youtube_id text,
  thumbnail text,
  angles jsonb,
  created_at timestamp default now()
);

-- Events table: Stores individual game events (tags, coordinates, metadata)
-- ON DELETE CASCADE ensures orphaned events are automatically cleaned up
create table if not exists events (
  id bigserial primary key,
  game_id text references games(id) on delete cascade,
  code text,
  time_seconds numeric,
  period text,
  player text,
  team text,
  x numeric,
  y numeric,
  extra jsonb,
  created_at timestamp default now()
);

-- Create indexes for common queries
create index if not exists idx_events_game_id on events(game_id);
create index if not exists idx_events_period on events(period);
create index if not exists idx_games_date on games(date);

-- Add comments for documentation
comment on table games is 'Game metadata: teams, competition, video links, camera angles';
comment on table events is 'Individual events/tags within a game: coordinates, player names, action codes';
comment on column games.angles is 'JSON array of camera angles with timestamps: [{"name":"Main","youtube_id":"...","half1Start":123,...}]';
comment on column events.extra is 'JSON object for additional event metadata not in standard columns';
