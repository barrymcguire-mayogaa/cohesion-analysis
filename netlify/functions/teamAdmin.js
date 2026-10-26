/**
 * Netlify Function: teamAdmin — the TEAM page (Admin › Team), the picker list of people, and "My page".
 *
 * Sign-in stays on Netlify Identity; this function manages Identity users through the GoTrue ADMIN API with the admin
 * token Netlify gives every function call (context.clientContext.identity — netlify/lib/identityAdmin.js). Roles in
 * Identity stay the source of truth for access (read from the JWT by every function); a change applies at the person's
 * next sign-in. Person details live in public.team_members, the activity log in public.team_audit
 * (supabase/team_members.sql), both service-role only.
 *
 *   POST /.netlify/functions/teamAdmin
 *   ADMIN ONLY (403 for anyone else, before Identity or the database is touched):
 *   { action:'list' }                                         -> { members:[…], identity:{ok, error?} }
 *   { action:'invite', email, name, roles:[…], details:{…} }  -> Identity invite (the site's invitation email) + roles +
 *                                                                the team_members row -> { member }
 *   { action:'update', user_id, roles?, details? }            -> { member }
 *   { action:'resend', user_id }                              -> a new invitation email (invited, not yet accepted)
 *   { action:'remove', user_id }                              -> deletes the Identity user, marks the row 'removed'
 *   { action:'knownPlayers', team, section }                  -> { players:[{key, name, n}] } (team sheets + tagged names)
 *   { action:'link', user_id, team, section, player:{name} }  -> links the person to his name in the stats -> { link, how }
 *   { action:'unlink', user_id }
 *   { action:'audit', limit? }                                -> { entries:[…] } newest first
 *   ANY SIGNED-IN USER:
 *   { action:'people', section? }  -> { section, people:[{id, name, groups}], groups:[{id, label, n}] } — the PICKER LIST
 *                                    (playlists' Named people / Groups): the people who can see that section; never an
 *                                    email or a phone. A section the caller cannot see → 403 (U20s stay apart).
 *   { action:'me' }                -> { member:{name, position, squad_number, club, team, section, link} | null,
 *                                       sections, groups } — the caller's own row, without phone or email.
 *
 * SAFEGUARDS: an admin cannot remove his own admin role or delete himself; the last admin (an accepted Identity user
 * with the admin role) cannot be demoted or removed; a caller whose admin role was taken away in Identity is refused
 * even while his JWT still says admin. Every admin write is logged in team_audit (a phone number never is).
 * PHONE: returned by 'list' / 'invite' / 'update' (admins) only; 'people' and 'me' never select it.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (the existing ones). No new variables.
 */
const { verifiedClaims, UNAUTH } = require('../lib/identity');
const { rolesOf, isAdmin, allowedSections, normSection, sectionOf, metaObj } = require('../lib/access');
const IA = require('../lib/identityAdmin');
const TM = require('../lib/team');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const json = (statusCode, o) => ({ statusCode, body: JSON.stringify(o) });
const bad = msg => json(400, { error: msg });
const SETUP = 'team tables not set up — run supabase/team_members.sql';
const ADMIN_ACTIONS = ['list', 'invite', 'update', 'resend', 'remove', 'knownPlayers', 'link', 'unlink', 'audit'];
const MEMBER_ACTIONS = ['people', 'me'];
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const PUBLIC_COLS = 'user_id, name, position, squad_number, club, team, section, link_team, link_section, link_player_key, link_player_name, status';
const EVENTS_PAGE = 1000, RECENT_GAMES = 15;

function missingTable(e) {
  const m = String((e && e.message) || '');
  return !!e && (e.code === '42P01' || e.code === 'PGRST205' || (/team_members|team_audit/.test(m) && /does not exist|could not find the table|schema cache/i.test(m)));
}
function fail(e, what) {
  if (missingTable(e)) return json(503, { error: SETUP, setup: true });
  return json(500, { error: 'Could not ' + what + ': ' + ((e && e.message) || 'database error') });
}
const idFail = r => json(r.status === 404 ? 404 : r.status >= 500 || r.status === 503 ? 503 : 502, { error: r.error });

// details from a request → {details} | {error}. Only the fields sent are returned.
function cleanDetails(d) {
  if (d == null) return { details: {} };
  if (typeof d !== 'object' || Array.isArray(d)) return { error: 'details must be an object {position, squad_number, club, phone, team, section}' };
  const out = {}, LIM = { position: 60, club: 120, phone: 40, team: 80 };
  for (const k of Object.keys(d)) {
    const v = d[k];
    if (k === 'squad_number') {
      if (v == null || v === '') { out.squad_number = null; continue; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 99) return { error: 'squad_number must be a whole number 0–99' };
      out.squad_number = n; continue;
    }
    if (k === 'section') { if (v != null && typeof v !== 'string') return { error: 'section must be text' }; out.section = normSection(v); continue; }
    if (!LIM[k]) return { error: 'unknown details field "' + k + '" (allowed: position, squad_number, club, phone, team, section)' };
    if (v != null && typeof v !== 'string') return { error: k + ' must be text' };
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    if (s.length > LIM[k]) return { error: k + ' is too long (at most ' + LIM[k] + ' characters)' };
    if (k === 'phone' && s && !/^[0-9+()\-. ]{5,40}$/.test(s)) return { error: 'phone may hold digits, spaces, + ( ) - . only' };
    out[k] = k === 'team' ? s.toUpperCase() : s;
  }
  return { details: out };
}
function cleanName(v) {
  if (v != null && typeof v !== 'string') return { error: 'name must be text' };
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (s.length > 80) return { error: 'name is too long (at most 80 characters)' };
  return { name: s };
}

// ── the merged view of a person (admin) ──
function memberView(u, row) {
  const roles = u ? IA.rolesOfUser(u) : TM.rolesOfAny(row && row.roles);
  const removed = row && row.status === 'removed';
  return {
    user_id: String((u && u.id) || (row && row.user_id) || ''),
    email: String((u && u.email) || (row && row.email) || '').toLowerCase(),
    name: TM.displayName(row, u), roles, groups: TM.groupsOfRoles(roles), sections: allowedSections(roles),
    status: u ? IA.statusOfUser(u) : removed ? 'removed' : 'no-account',
    invited_at: (u && u.invited_at) || null, confirmed_at: (u && u.confirmed_at) || null,
    last_sign_in_at: (u && u.last_sign_in_at) || null,                  // GoTrue's last_sign_in_at (absent until a sign-in)
    has_details: !!row,
    position: (row && row.position) || '', squad_number: row && row.squad_number != null ? row.squad_number : null,
    club: (row && row.club) || '', phone: (row && row.phone) || '', team: (row && row.team) || '', section: (row && row.section) || '',
    link: TM.linkOf(row),
    created_at: (row && row.created_at) || (u && u.created_at) || null, created_by: (row && row.created_by) || '',
    updated_at: (row && row.updated_at) || null, updated_by: (row && row.updated_by) || '',
    removed_at: (row && row.removed_at) || null, removed_by: (row && row.removed_by) || '',
  };
}

async function rowsAll() { const { data, error } = await supabase.from('team_members').select('*'); return { rows: data || [], error }; }
async function rowOf(userId) {
  const { data, error } = await supabase.from('team_members').select('*').eq('user_id', userId);
  return { row: (data || [])[0] || null, error };
}
async function audit(who, action, target, detail) {
  const { error } = await supabase.from('team_audit').insert({ at: new Date().toISOString(), actor: who.email, actor_id: who.id, action,
    target_user_id: String((target && target.user_id) || ''), target_email: String((target && target.email) || ''), detail: detail || {} });
  if (error) console.error('teamAdmin audit:', error.message);
  return !error;
}
// accepted admins in Identity, other than `exceptId`
const otherAdmins = (users, exceptId) => users.filter(u => String(u.id) !== String(exceptId) && u.confirmed_at && IA.rolesOfUser(u).includes('admin'));

// a team's games (meta) in a section, and the events of its most recent ones
async function teamGames(team, section) {
  const { data, error } = await supabase.from('games').select('id, meta');
  if (error) throw error;
  return (data || []).map(r => { const m = metaObj(r && r.meta); return m ? Object.assign({}, m, { id: m.id != null ? m.id : r.id }) : null; })
    .filter(m => m && sectionOf(m) === section && [m.homeTeam, m.awayTeam].some(t => TM.up(t) === team));
}
async function eventsOf(games) {
  const recent = games.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, RECENT_GAMES);
  const ids = recent.map(g => String(g.id)), out = new Map(ids.map(i => [i, []]));
  if (!ids.length) return out;
  for (let from = 0; ; from += EVENTS_PAGE) {
    const { data, error } = await supabase.from('events').select('id, game_id, data').in('game_id', ids).order('id', { ascending: true }).range(from, from + EVENTS_PAGE - 1);
    if (error) throw error;
    (data || []).forEach(r => { const k = String(r.game_id); if (out.has(k) && r.data) out.get(k).push(r.data); });
    if (!data || data.length < EVENTS_PAGE) break;
  }
  return out;
}
async function knownOf(team, section) { const g = await teamGames(team, section); return TM.knownPlayers(team, g, await eventsOf(g)); }

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    let body;
    try { body = JSON.parse(event.body || ''); } catch (e) { return bad('Invalid JSON body'); }
    if (!body || typeof body !== 'object') return bad('Invalid JSON body');

    const token = String((event.headers && (event.headers.authorization || event.headers.Authorization)) || '').replace('Bearer ', '');
    if (!token) return json(401, { error: 'Authentication required' });
    const claims = verifiedClaims(context);
    if (!claims) return UNAUTH;
    const roles = rolesOf(claims);
    const who = { email: String(claims.email || '').toLowerCase().slice(0, 200), id: String(claims.sub || '') };
    const { action } = body;
    if (!ADMIN_ACTIONS.includes(action) && !MEMBER_ACTIONS.includes(action)) return bad('action must be one of ' + ADMIN_ACTIONS.concat(MEMBER_ACTIONS).join(', '));
    const idn = IA.identityOf(context);

    // ── any signed-in user ──
    if (action === 'me') {
      const { data, error } = await supabase.from('team_members').select(PUBLIC_COLS).eq('user_id', who.id);
      if (error && !missingTable(error)) return fail(error, 'read your details');
      const row = ((data || []).filter(r => r.status !== 'removed'))[0] || null;
      return json(200, { ok: true, member: TM.publicMember(row), sections: allowedSections(roles), groups: TM.groupsOfRoles(roles), setup: missingTable(error) || undefined });
    }
    if (action === 'people') {
      const mine = allowedSections(roles);
      const section = body.section == null || body.section === '' ? mine[0] : normSection(body.section);
      if (!mine.includes(section)) return json(403, { error: 'Forbidden: no access to that section' });
      const { data, error } = await supabase.from('team_members').select('user_id, name, status, roles');   // never phone / email
      if (error && !missingTable(error)) return fail(error, 'read the people');
      let users = null;
      if (idn) { const r = await IA.listUsers(idn); if (r.ok) users = r.users; else console.error('teamAdmin people:', r.error); }
      const out = TM.pickerPeople(users, data || [], section);
      return json(200, { ok: true, section, people: out.people, groups: out.groups, source: users ? 'identity' : 'rows' });
    }

    // ── ADMIN ONLY from here ──
    if (!isAdmin(roles)) return json(403, { error: 'Forbidden: admin role required — the Team page is for admins only' });

    if (action === 'audit') {
      const limit = Math.max(1, Math.min(500, Number(body.limit) || 200));
      const { data, error } = await supabase.from('team_audit').select('*').order('at', { ascending: false }).limit(limit);
      if (error) return fail(error, 'read the activity log');
      return json(200, { ok: true, entries: data || [] });
    }
    if (action === 'knownPlayers') {
      const team = TM.up(body.team); if (!team) return bad('team is required');
      const section = normSection(body.section);
      return json(200, { ok: true, team, section, players: await knownOf(team, section) });
    }

    // every other admin action reads the table first (so nothing is sent to Identity when it is not set up) and Identity
    const all = await rowsAll(); if (all.error) return fail(all.error, 'read the team');
    const L = await IA.listUsers(idn);
    if (action === 'list') {
      const users = L.ok ? L.users : [], seen = new Set();
      const members = users.map(u => { seen.add(String(u.id)); return memberView(u, all.rows.find(r => String(r.user_id) === String(u.id)) || null); });
      all.rows.filter(r => !seen.has(String(r.user_id))).forEach(r => members.push(memberView(null, r)));
      members.sort((a, b) => (a.status === 'removed') - (b.status === 'removed') || a.name.localeCompare(b.name));
      return json(200, { ok: true, members, identity: L.ok ? { ok: true } : { ok: false, error: L.error } });
    }
    if (!L.ok) return idFail(L);
    const users = L.users;
    // a JWT that still says admin while Identity no longer does (demoted within the hour): refused
    const me = users.find(u => String(u.id) === who.id);
    if (me && !IA.rolesOfUser(me).includes('admin')) return json(403, { error: 'Forbidden: your admin role has been removed — sign in again' });
    const userOf = id => users.find(u => String(u.id) === String(id)) || null;
    const rowFor = id => all.rows.find(r => String(r.user_id) === String(id)) || null;
    const now = () => new Date().toISOString();

    if (action === 'invite') {
      const email = String(body.email == null ? '' : body.email).trim().toLowerCase();
      if (!email || email.length > 200 || !EMAIL_RE.test(email)) return bad('a valid email is required');
      const n = cleanName(body.name); if (n.error) return bad(n.error); if (!n.name) return bad('name is required');
      const r = TM.cleanRoles(body.roles); if (r.error) return bad(r.error);
      const d = cleanDetails(body.details); if (d.error) return bad(d.error);
      if (users.some(u => String(u.email || '').toLowerCase() === email)) return json(409, { error: email + ' already has a COHESION account — edit that person instead' });
      const inv = await IA.invite(idn, email, { full_name: n.name });
      if (!inv.ok) return idFail(inv);
      const u = inv.user;
      if (r.roles.length) {
        const up = await IA.updateUser(idn, u.id, { app_metadata: { roles: r.roles } });
        if (!up.ok) {   // never leave an account with the wrong access: take the invite back
          await IA.deleteUser(idn, u.id);
          return json(502, { error: 'The invitation was sent but the roles could not be set, so the account was removed again (the email link will not work): ' + up.error });
        }
        u.app_metadata = Object.assign({}, u.app_metadata, { roles: r.roles });
      }
      const row = Object.assign({ user_id: String(u.id), email, name: n.name, position: '', squad_number: null, club: '', phone: '', team: '', section: 'county',
        roles: r.roles, status: 'active', created_at: now(), created_by: who.email, updated_at: now(), updated_by: who.email }, d.details);
      const { error } = await supabase.from('team_members').insert(row);
      if (error) return json(500, { error: 'The invitation was sent, but the person\'s details could not be saved: ' + error.message, user_id: u.id });
      await audit(who, 'invite', row, { roles: r.roles, details: Object.keys(d.details) });
      return json(200, { ok: true, member: memberView(u, row) });
    }

    const userId = String(body.user_id == null ? '' : body.user_id).trim();
    if (!userId) return bad('user_id is required');
    const u = userOf(userId), row = rowFor(userId);
    if (!u && !row) return json(404, { error: 'No such person' });
    const target = { user_id: userId, email: String((u && u.email) || (row && row.email) || '').toLowerCase() };
    const isSelf = userId === who.id;

    if (action === 'update') {
      const patch = {}, detail = {};
      let newRoles = null;
      if (body.roles !== undefined) {
        const r = TM.cleanRoles(body.roles); if (r.error) return bad(r.error); newRoles = r.roles;
        if (!u) return json(409, { error: 'This person has no COHESION account (removed) — roles cannot be set' });
        const old = IA.rolesOfUser(u);
        if (old.includes('admin') && !newRoles.includes('admin')) {
          if (isSelf) return json(403, { error: 'You can\'t remove your own admin role — ask another admin' });
          if (!otherAdmins(users, userId).length) return json(409, { error: 'This is the last admin — make someone else an admin first' });
        }
      }
      if (body.name !== undefined) { const n = cleanName(body.name); if (n.error) return bad(n.error); if (!n.name) return bad('name cannot be empty'); patch.name = n.name; }
      const d = cleanDetails(body.details); if (d.error) return bad(d.error); Object.assign(patch, d.details);
      if (newRoles) {
        const old = IA.rolesOfUser(u);
        if (JSON.stringify(old.slice().sort()) !== JSON.stringify(newRoles.slice().sort())) {
          const up = await IA.updateUser(idn, userId, { app_metadata: { roles: newRoles } });
          if (!up.ok) return idFail(up);
          u.app_metadata = Object.assign({}, u.app_metadata, { roles: newRoles });
          detail.roles = { from: old, to: newRoles };
        }
        patch.roles = newRoles;
      }
      if (patch.name && u && (!u.user_metadata || u.user_metadata.full_name !== patch.name)) {
        const up = await IA.updateUser(idn, userId, { user_metadata: Object.assign({}, u.user_metadata, { full_name: patch.name }) });
        if (up.ok) u.user_metadata = Object.assign({}, u.user_metadata, { full_name: patch.name });
      }
      detail.changed = Object.keys(patch).filter(k => k !== 'roles' && (!row || String(row[k] == null ? '' : row[k]) !== String(patch[k] == null ? '' : patch[k])));
      patch.updated_at = now(); patch.updated_by = who.email;
      let saved;
      if (row) {
        const { error } = await supabase.from('team_members').update(patch).eq('user_id', userId);
        if (error) return fail(error, 'save the details');
        saved = Object.assign({}, row, patch);
      } else {   // a person who signed up before the Team page: his first row
        saved = Object.assign({ user_id: userId, email: target.email, name: TM.displayName(null, u), position: '', squad_number: null, club: '', phone: '', team: '', section: 'county',
          roles: IA.rolesOfUser(u), status: 'active', created_at: now(), created_by: who.email }, patch);
        const { error } = await supabase.from('team_members').insert(saved);
        if (error) return fail(error, 'save the details');
      }
      if (detail.roles || detail.changed.length) await audit(who, 'update', target, detail);
      return json(200, { ok: true, member: memberView(u, saved) });
    }

    if (action === 'resend') {
      if (row && row.status === 'removed') return json(409, { error: 'This person\'s access was removed — add them again to invite them' });
      if (u && u.confirmed_at) return json(409, { error: target.email + ' has already accepted the invitation — they sign in with their password (Forgot password on the sign-in page resets it)' });
      // GoTrue answers 422 to an invite for an email it already holds (accepted or not), so a re-send is: delete the
      // unaccepted user, invite again (a NEW Identity id), give the new user the same roles, move the row to the new id.
      const keepRoles = u ? IA.rolesOfUser(u) : TM.rolesOfAny(row && row.roles);
      const meta = (u && u.user_metadata) || { full_name: (row && row.name) || '' };
      if (u) { const del = await IA.deleteUser(idn, userId); if (!del.ok && del.status !== 404) return idFail(del); }
      const inv = await IA.invite(idn, target.email, meta);
      if (!inv.ok) {
        if (row) await supabase.from('team_members').update({ updated_at: now(), updated_by: who.email }).eq('user_id', userId);
        await audit(who, 'resend', target, { failed: inv.error });
        return json(502, { error: 'The old invitation was withdrawn but a new one could not be sent: ' + inv.error + ' — press Resend again' });
      }
      const nu = inv.user;
      if (keepRoles.length) {
        const up = await IA.updateUser(idn, nu.id, { app_metadata: { roles: keepRoles } });
        if (!up.ok) { await IA.deleteUser(idn, nu.id); return json(502, { error: 'The new invitation went out but the roles could not be set, so it was withdrawn: ' + up.error }); }
        nu.app_metadata = Object.assign({}, nu.app_metadata, { roles: keepRoles });
      }
      let saved = null;
      if (row) {
        const patch = { user_id: String(nu.id), updated_at: now(), updated_by: who.email };
        const { error } = await supabase.from('team_members').update(patch).eq('user_id', userId);
        if (error) return fail(error, 'move the details to the new invitation');
        saved = Object.assign({}, row, patch);
      }
      await audit(who, 'resend', { user_id: String(nu.id), email: target.email }, { previous_user_id: userId });
      return json(200, { ok: true, member: memberView(nu, saved) });
    }

    if (action === 'remove') {
      if (isSelf) return json(403, { error: 'You can\'t remove your own access — ask another admin' });
      if (u && IA.rolesOfUser(u).includes('admin') && !otherAdmins(users, userId).length) return json(409, { error: 'This is the last admin — make someone else an admin first' });
      if (row && row.status === 'removed' && !u) return json(409, { error: 'Already removed' });
      if (u) { const del = await IA.deleteUser(idn, userId); if (!del.ok && del.status !== 404) return idFail(del); }
      const patch = { status: 'removed', removed_at: now(), removed_by: who.email, roles: u ? IA.rolesOfUser(u) : TM.rolesOfAny(row && row.roles), updated_at: now(), updated_by: who.email };
      let saved;
      if (row) { const { error } = await supabase.from('team_members').update(patch).eq('user_id', userId); if (error) return fail(error, 'mark the person removed'); saved = Object.assign({}, row, patch); }
      else { saved = Object.assign({ user_id: userId, email: target.email, name: TM.displayName(null, u), created_at: now(), created_by: who.email }, patch);
        const { error } = await supabase.from('team_members').insert(saved); if (error) return fail(error, 'record the removal'); }
      await audit(who, 'remove', target, { roles: patch.roles });
      return json(200, { ok: true, member: memberView(null, saved) });
    }

    if (action === 'link' || action === 'unlink') {
      if (row && row.status === 'removed') return json(409, { error: 'This person\'s access was removed' });
      let patch, detail;
      if (action === 'unlink') {
        patch = { link_team: '', link_section: '', link_player_key: '', link_player_name: '', linked_at: null, linked_by: '' };
        detail = { from: TM.linkOf(row) };
      } else {
        const team = TM.up(body.team); if (!team) return bad('team is required');
        const section = normSection(body.section);
        const p = body.player; if (!p || typeof p !== 'object' || typeof p.name !== 'string') return bad('player {name} is required');
        const known = await knownOf(team, section);
        if (!known.length) return bad('no ' + team + ' games in the ' + section + ' section — no known players to link to');
        const res = TM.resolvePlayer(p.name, known);
        if (res.error) return json(400, { error: res.error, close: res.close });
        patch = { link_team: team, link_section: section, link_player_key: res.player.key, link_player_name: res.player.name, linked_at: now(), linked_by: who.email };
        detail = { team, section, player: res.player.name, key: res.player.key, how: res.how, typed: TM.tidy(p.name) };
      }
      patch.updated_at = now(); patch.updated_by = who.email;
      let saved;
      if (row) { const { error } = await supabase.from('team_members').update(patch).eq('user_id', userId); if (error) return fail(error, 'save the link'); saved = Object.assign({}, row, patch); }
      else { saved = Object.assign({ user_id: userId, email: target.email, name: TM.displayName(null, u), roles: IA.rolesOfUser(u), status: 'active', section: 'county', created_at: now(), created_by: who.email }, patch);
        const { error } = await supabase.from('team_members').insert(saved); if (error) return fail(error, 'save the link'); }
      await audit(who, action, target, detail);
      return json(200, { ok: true, link: TM.linkOf(saved), how: detail.how || null, member: memberView(u, saved) });
    }
    return bad('unknown action');
  } catch (e) {
    console.error('teamAdmin:', e);
    if (missingTable(e)) return json(503, { error: SETUP, setup: true });
    return json(500, { error: 'Unexpected error: ' + (e && e.message) });
  }
};
// for the tests
exports._ = { cleanDetails, cleanName, memberView, missingTable, SETUP };
