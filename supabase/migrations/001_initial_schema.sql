-- COHESION Analysis: Initial Schema
-- Tables: games, events
-- Created: April 30, 2026
-- Updated: April 30, 2026 - Match existing JSONB data structure

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

-- Events table: Stores individual game events as JSON data blobs
-- This matches the existing schema where all event data is stored in the 'data' column
-- ON DELETE CASCADE ensures orphaned events are automatically cleaned up
create table if not exists events (
  id bigserial primary key,
  game_id text references games(id) on delete cascade,
  data jsonb,
  created_at timestamp default now()
);

-- Create indexes for common queries
create index if not exists idx_events_game_id on events(game_id);
create index if not exists idx_games_date on games(date);

-- Add comments for documentation
comment on table games is 'Game metadata: teams, competition, video links, camera angles';
comment on table events is 'Individual events/tags within a game stored as JSON data blobs';
comment on column games.angles is 'JSON array of camera angles with timestamps: [{"name":"Main","youtube_id":"...","half1Start":123,...}]';
comment on column events.data is 'JSON object containing event data: {code, time_seconds, period, player, team, x, y, extra, ...}';
