-- COHESION Analysis: Row Level Security (RLS) Policies
-- Enforces authorization: Public read, Admin-only write
-- Created: April 30, 2026

-- ============================================================================
-- GAMES TABLE POLICIES
-- ============================================================================

-- Enable RLS on games table
alter table games enable row level security;

-- Policy 1: Public can READ all games
-- Anyone (including anonymous users) can view game metadata
create policy "Public read games" on games
  for select
  to public
  using (true);

-- Policy 2: Only authenticated ADMIN users can INSERT games
-- This requires:
--   1. User is authenticated (logged in via Netlify Identity)
--   2. User's JWT has role = 'admin'
create policy "Admin insert games" on games
  for insert
  to authenticated
  with check (auth.jwt() ->> 'role' = 'admin');

-- Policy 3: Only authenticated ADMIN users can UPDATE games
create policy "Admin update games" on games
  for update
  to authenticated
  using (auth.jwt() ->> 'role' = 'admin')
  with check (auth.jwt() ->> 'role' = 'admin');

-- Policy 4: Only authenticated ADMIN users can DELETE games
create policy "Admin delete games" on games
  for delete
  to authenticated
  using (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- EVENTS TABLE POLICIES
-- ============================================================================

-- Enable RLS on events table
alter table events enable row level security;

-- Policy 1: Public can READ all events
-- Anyone can view event data (tags, coordinates, etc.)
create policy "Public read events" on events
  for select
  to public
  using (true);

-- Policy 2: Only authenticated ADMIN users can INSERT events
-- This allows Netlify Functions (using service role key) to insert,
-- and blocks direct browser writes from anon key
create policy "Admin insert events" on events
  for insert
  to authenticated
  with check (auth.jwt() ->> 'role' = 'admin');

-- Policy 3: Only authenticated ADMIN users can UPDATE events
create policy "Admin update events" on events
  for update
  to authenticated
  using (auth.jwt() ->> 'role' = 'admin')
  with check (auth.jwt() ->> 'role' = 'admin');

-- Policy 4: Only authenticated ADMIN users can DELETE events
create policy "Admin delete events" on events
  for delete
  to authenticated
  using (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- IMPLEMENTATION NOTES
-- ============================================================================
--
-- HOW THIS PROTECTS YOUR DATA:
-- 1. Anon key (in browser): Can only SELECT, cannot INSERT/UPDATE/DELETE
-- 2. Authenticated users without admin role: Can only SELECT
-- 3. Authenticated admin users: Can SELECT/INSERT/UPDATE/DELETE
-- 4. Netlify Functions (using service role key): Bypass RLS entirely
--
-- WORKFLOW:
-- - Browser: Uses anon key, can only read data
-- - Admin Panel: When user is authenticated + admin role, calls Netlify Function
-- - Netlify Function: Uses service role key (protected on server), performs writes atomically
-- - Library/Dashboard: Uses anon key, can read all data
--
