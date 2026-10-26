/**
 * Netlify Function: playerNotes — the Panel Print-out's staff notes and squad picks (service role, ADMIN ONLY).
 *
 * Tables: public.player_notes and public.panel_squads (supabase/player_notes.sql). Both have RLS on with no policies
 * and no grants for anon / authenticated, so this function is the only way in — and every action checks the ADMIN
 * role first (as editEvent.js / gameAdmin.js do): a non-admin gets 403 and never receives a note.
 *
 *   POST /.netlify/functions/playerNotes
 *   { action:'getNotes', team }                                  -> { notes:[{player_key, player_name, club, notes, updated_at, updated_by}] }
 *   { action:'saveNote', team, player:{key, name}, club, notes } -> upsert on (team, player_key) -> { note }
 *   { action:'getSquads', team }                                 -> { squads:[{name, season, competition, data, updated_at, updated_by}] }
 *   { action:'saveSquad', team, name, season, competition, data }-> upsert on (team, name) -> { squad }
 *
 * notes = {hand, style, strengths, watch, form, pos}: strings only, each at most 4000 characters.
 * A missing table answers 503 "notes table not set up — run supabase/player_notes.sql".
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (the existing ones).
 */
const { verifiedClaims, UNAUTH } = require('../lib/identity');
const { rolesOf, can } = require('../lib/access');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const NOTE_FIELDS = ['hand', 'style', 'strengths', 'watch', 'form', 'pos'];
const MAX_NOTE = 4000, MAX_NAME = 120, MAX_CLUB = 120, MAX_TEAM = 80, MAX_KEY = 120, MAX_SLOTS = 60, MAX_DATA = 60000;
const json = (statusCode, o) => ({ statusCode, body: JSON.stringify(o) });
const bad = msg => json(400, { error: msg });
const SETUP = 'notes table not set up — run supabase/player_notes.sql';

// the same team key the page uses (upper case, spaces collapsed)
function teamKey(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim().toUpperCase(); }
// the player key the page sends (cohPlayerKey): lower case letters and digits
function playerKey(k) { return String(k == null ? '' : k).trim(); }
function missingTable(e) {
  const m = String((e && e.message) || '');
  return !!e && (e.code === '42P01' || e.code === 'PGRST205' || (/player_notes|panel_squads/.test(m) && /does not exist|could not find the table|schema cache/i.test(m)));
}
function fail(e, what) {
  if (missingTable(e)) return json(503, { error: SETUP, setup: true });
  return json(500, { error: 'Could not ' + what + ': ' + ((e && e.message) || 'database error') });
}
// validate a notes object → {ok, notes} | {error}
function cleanNotes(n) {
  if (n == null) return { notes: {} };
  if (typeof n !== 'object' || Array.isArray(n)) return { error: 'notes must be an object {hand, style, strengths, watch, form, pos}' };
  const out = {};
  for (const k of Object.keys(n)) {
    if (!NOTE_FIELDS.includes(k)) return { error: 'unknown notes field "' + k + '" (allowed: ' + NOTE_FIELDS.join(', ') + ')' };
    const v = n[k];
    if (v == null) continue;
    if (typeof v !== 'string') return { error: 'notes.' + k + ' must be text' };
    if (v.length > MAX_NOTE) return { error: 'notes.' + k + ' is too long (' + v.length + ' characters; at most ' + MAX_NOTE + ')' };
    out[k] = v;
  }
  return { notes: out };
}

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    let body;
    try { body = JSON.parse(event.body || ''); } catch (e) { return bad('Invalid JSON body'); }
    if (!body || typeof body !== 'object') return bad('Invalid JSON body');

    // ── ADMIN ONLY (Netlify Identity JWT, verified by Netlify) ──
    const token = String((event.headers && (event.headers.authorization || event.headers.Authorization)) || '').replace('Bearer ', '');
    if (!token) return json(401, { error: 'Authentication required' });
    const claims = verifiedClaims(context);
    if (!claims) return UNAUTH;
    const roles = rolesOf(claims);
    // 'notes' = admin only (netlify/lib/access.js). An ANALYST role does not open them — to confirm with Barry.
    if (!can(roles, 'notes')) return json(403, { error: 'Forbidden: admin role required — staff notes are for analysts only' });
    const who = String(claims.email || claims.sub || '').slice(0, 200);

    const { action } = body;
    const team = teamKey(body.team);
    if (!['getNotes', 'saveNote', 'getSquads', 'saveSquad'].includes(action)) return bad('action must be getNotes, saveNote, getSquads or saveSquad');
    if (!team) return bad('team is required');
    if (team.length > MAX_TEAM) return bad('team is too long (at most ' + MAX_TEAM + ' characters)');

    if (action === 'getNotes') {
      const { data, error } = await supabase.from('player_notes').select('player_key, player_name, club, notes, updated_at, updated_by').eq('team', team);
      if (error) return fail(error, 'read the notes');
      return json(200, { ok: true, team, notes: data || [] });
    }
    if (action === 'saveNote') {
      const p = body.player;
      if (!p || typeof p !== 'object') return bad('player {key, name} is required');
      const key = playerKey(p.key), name = String(p.name == null ? '' : p.name).trim();
      if (!key) return bad('player.key is required');
      if (key.length > MAX_KEY || !/^[a-z0-9]+$/.test(key)) return bad('player.key must be letters and digits (the page’s player key), at most ' + MAX_KEY);
      if (name.length > MAX_NAME) return bad('player.name is too long (at most ' + MAX_NAME + ' characters)');
      if (body.club != null && typeof body.club !== 'string') return bad('club must be text');
      const club = String(body.club || '').trim();
      if (club.length > MAX_CLUB) return bad('club is too long (at most ' + MAX_CLUB + ' characters)');
      const c = cleanNotes(body.notes); if (c.error) return bad(c.error);
      const row = { team, player_key: key, player_name: name, club, notes: c.notes, updated_at: new Date().toISOString(), updated_by: who };
      const { data, error } = await supabase.from('player_notes').upsert(row, { onConflict: 'team,player_key' }).select('player_key, player_name, club, notes, updated_at, updated_by').single();
      if (error) return fail(error, 'save the note');
      return json(200, { ok: true, note: data || row });
    }
    if (action === 'getSquads') {
      const { data, error } = await supabase.from('panel_squads').select('name, season, competition, data, updated_at, updated_by').eq('team', team);
      if (error) return fail(error, 'read the squads');
      return json(200, { ok: true, team, squads: data || [] });
    }
    // saveSquad
    const name = String(body.name == null ? 'current' : body.name).trim() || 'current';
    if (name.length > MAX_NAME) return bad('name is too long (at most ' + MAX_NAME + ' characters)');
    const season = String(body.season == null ? '' : body.season).trim(), competition = String(body.competition == null ? '' : body.competition).trim();
    if (season.length > 20 || competition.length > MAX_NAME) return bad('season / competition is too long');
    const d = body.data;
    if (d == null || typeof d !== 'object' || Array.isArray(d)) return bad('data must be an object {size, opp, slots, cover}');
    if (d.slots != null && (typeof d.slots !== 'object' || Array.isArray(d.slots))) return bad('data.slots must be an object keyed by number');
    if (d.slots && Object.keys(d.slots).length > MAX_SLOTS) return bad('too many slots (at most ' + MAX_SLOTS + ')');
    if (d.slots && Object.keys(d.slots).some(n => !/^\d{1,2}$/.test(n))) return bad('data.slots keys must be numbers 1–99');
    if (JSON.stringify(d).length > MAX_DATA) return bad('the squad is too large to save');
    const row = { team, name, season, competition, data: d, updated_at: new Date().toISOString(), updated_by: who };
    const { data, error } = await supabase.from('panel_squads').upsert(row, { onConflict: 'team,name' }).select('name, season, competition, data, updated_at, updated_by').single();
    if (error) return fail(error, 'save the squad');
    return json(200, { ok: true, squad: data || row });
  } catch (e) {
    console.error('playerNotes:', e);
    return json(500, { error: 'Unexpected error: ' + (e && e.message) });
  }
};
// for the tests
exports._ = { cleanNotes, teamKey, missingTable, SETUP };
