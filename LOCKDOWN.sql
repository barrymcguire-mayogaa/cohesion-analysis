-- COHESION hard county/club separation — LOCKDOWN (run once in the
-- Supabase SQL editor AFTER the matching site deploy is live).
--
-- All game/event reads now go through /.netlify/functions/data with a
-- Netlify Identity JWT (role-checked). This revokes the public keys'
-- direct SELECT so the function is the only door. The service-role key
-- used by the functions is unaffected.
--
-- To undo (restore open reads):
--   grant select on table public.games  to anon, authenticated;
--   grant select on table public.events to anon, authenticated;

revoke select on table public.games  from anon, authenticated;
revoke select on table public.events from anon, authenticated;

-- ── PHASE B (run AFTER the Phase B deploy is live) ──
-- Playlists/templates now read through their functions with section
-- filtering; close the direct door too.
-- Undo:
--   grant select on table public.playlists to anon, authenticated;
--   grant select on table public.templates to anon, authenticated;

revoke select on table public.playlists from anon, authenticated;
revoke select on table public.templates from anon, authenticated;
