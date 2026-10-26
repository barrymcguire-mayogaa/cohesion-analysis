/**
 * TEAM — the people of COHESION (the Team page, its picker list, player links). Pure helpers, shared by
 * netlify/functions/teamAdmin.js and (once playlists-share lands) the playlist "Named people" / "Groups" pickers.
 *
 * WHERE THINGS LIVE (Barry, Oct 2026)
 *   sign-in + ACCESS   Netlify Identity. app_metadata.roles is the source of truth; every function reads it from the
 *                      verified JWT (netlify/lib/access.js). A change applies at the person's next sign-in.
 *   person DETAILS     public.team_members (supabase/team_members.sql), keyed by the Identity user id: name, position,
 *                      squad number, club, PHONE (admins only), team / section, the linked player.
 *   activity log       public.team_audit (same file): every Team page action. Admin-readable only.
 *
 * ROLES offered on the Team page (anything else typed in is kept as it is; access.js decides what it means):
 *   admin · analyst · u20 · club, and the playlist-sharing GROUPS group:coach · group:player · group:forwards · group:backs
 *   (a group:<name> role is never a section and never a capability — access.js isGroupRole).
 *
 * PERSONAL DATA: phone is returned to admins only — publicMember() drops it, and the picker list (pickerPeople) carries
 * id + name + groups and nothing else.
 */
const { allowedSections, isGroupRole, groupLabel } = require('./access');
const { cohPlayerKey } = require('../../cohesion-photos.js');
const TS = require('../../cohesion-teamsheet.js');
const LBL = require('../../cohesion-labels.js');

const BASE_ROLES = ['admin', 'analyst', 'u20', 'club'];
const TEAM_GROUPS = ['group:coach', 'group:player', 'group:forwards', 'group:backs'];
const ROLE_RE = /^[a-z0-9][a-z0-9:_-]{0,39}$/;
const MAX_ROLES = 20;

// roles from a request → {roles} | {error}. Lower case, trimmed, de-duplicated; a bare group name ('forwards') is NOT
// turned into a group — the page sends the full 'group:forwards'.
function cleanRoles(v) {
  if (v == null) return { roles: [] };
  if (!Array.isArray(v)) return { error: 'roles must be a list' };
  const out = [];
  for (const r of v) {
    if (typeof r !== 'string') return { error: 'every role must be text' };
    const s = r.toLowerCase().trim(); if (!s) continue;
    if (!ROLE_RE.test(s)) return { error: 'role "' + r.slice(0, 50) + '" is not allowed (letters, digits, : _ - only, at most 40 characters)' };
    if (s.startsWith('group:') && !isGroupRole(s)) return { error: 'group role "' + s + '" is not allowed' };
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > MAX_ROLES) return { error: 'too many roles (at most ' + MAX_ROLES + ')' };
  return { roles: out };
}
const groupsOfRoles = roles => (roles || []).filter(isGroupRole);

// ── names ────────────────────────────────────────────────────────────
// the LOOSE key of cohesion-merge.js (looseKey): fadas folded, apostrophes, spaces, hyphens and dots dropped, case
// ignored. Kept identical (the tests compare the two on a list of spellings).
const looseKey = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s'‘’‛ʼ`´.\-‐‑‒–—]/g, '');
const up = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toUpperCase();
const tidy = s => String(s == null ? '' : s).replace(/[‘’‛ʼ`´]/g, "'").replace(/\s+/g, ' ').trim();
const isPTag = s => /^P\s*\d+$/i.test(String(s || '').trim());

// a team's KNOWN PLAYERS from its games: every team-sheet name (meta.rosters, cohesion-teamsheet.js sheet) and every
// name its events give that team's players (cohesion-labels.js cohEventPlayers: the player's own "<Team> Player Labels"
// group decides his team; an Assist belongs to the row's team) — the same sources as cohTS.loadKnown.
//   games: [meta] of the team · eventsByGame: Map(gameId → [event data]) → [{name, key, n}] (key = cohPlayerKey, the
//   Player Dashboard's player key; name = the spelling used most often)
function knownPlayers(team, games, eventsByGame) {
  const U = up(team), by = new Map();
  const add = n => { n = tidy(n); if (!n || isPTag(n)) return; const k = cohPlayerKey(n); if (!k) return;
    const r = by.get(k) || { key: k, sp: new Map(), n: 0 }; r.n++; r.sp.set(n, (r.sp.get(n) || 0) + 1); by.set(k, r); };
  (games || []).forEach(m => {
    if (!m) return; const side = TS.sideOf(m, U); if (side) TS.sheet(m, side).forEach(r => add(r.name));
    const ev = (eventsByGame && eventsByGame.get && eventsByGame.get(String(m.id))) || [];
    ev.forEach(e => { if (!e) return;
      LBL.cohEventPlayers(e, m).forEach(p => { if (up(p.team) === U) add(p.name); });
      const L = e.labels || {}; if (up(e.team) === U && L.Assist) add(L.Assist); });
  });
  return [...by.values()].map(r => ({ key: r.key, n: r.n, name: [...r.sp.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// a name an admin picked / typed → the known player it is.
//   exact     the same player key (case, spaces and apostrophes ignored — cohPlayerKey)
//   variant   the same LOOSE key (fadas, dots, hyphens too) as exactly ONE known player: "Sean O Se" → "Seán Ó Sé"
//   → {player:{key, name}, how} | {error, close:[names]}
function resolvePlayer(name, known) {
  const n = tidy(name); if (!n) return { error: 'player name is required', close: [] };
  const k = cohPlayerKey(n), list = known || [];
  const hit = list.find(p => p.key === k);
  if (hit) return { player: { key: hit.key, name: hit.name }, how: 'exact' };
  const lk = looseKey(n), loose = list.filter(p => looseKey(p.name) === lk);
  if (loose.length === 1) return { player: { key: loose[0].key, name: loose[0].name }, how: 'variant' };
  if (loose.length > 1) return { error: '"' + n + '" matches more than one known player — pick one: ' + loose.map(p => p.name).join(', '), close: loose.map(p => p.name) };
  const words = n.toLowerCase().split(/\s+/).filter(w => w.length > 2).map(looseKey);
  const close = list.filter(p => words.some(w => looseKey(p.name).includes(w))).slice(0, 8).map(p => p.name);
  return { error: '"' + n + '" is not a known player of this team (no team sheet or tagged event names him)', close };
}
// the Player Dashboard side: the squad key for a stored link (exact key, else the one loose match)
function linkKeyIn(squad, link) {
  if (!link || !link.player_key) return null;
  const S = squad || []; if (S.some(p => p.key === link.player_key)) return link.player_key;
  const lk = looseKey(link.player_name || ''), m = lk ? S.filter(p => looseKey(p.name) === lk) : [];
  return m.length === 1 ? m[0].key : null;
}

// ── people ───────────────────────────────────────────────────────────
// a display name: the Team page's name, else Identity's full_name, else the email's local part title-cased
function displayName(member, user) {
  const n = member && String(member.name || '').trim(); if (n) return n.slice(0, 80);
  const f = user && user.user_metadata && String(user.user_metadata.full_name || user.user_metadata.name || '').trim(); if (f) return f.slice(0, 80);
  const local = String((member && member.email) || (user && user.email) || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  return local ? local.split(/\s+/).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : 'Member';
}
const MEMBER_FIELDS = ['name', 'position', 'squad_number', 'club', 'phone', 'team', 'section'];
// a row as any non-admin may see it: no phone, no email, no audit fields
function publicMember(m) {
  if (!m) return null;
  return { user_id: m.user_id, name: m.name || '', position: m.position || '', squad_number: m.squad_number == null ? null : m.squad_number,
    club: m.club || '', team: m.team || '', section: m.section || '', link: linkOf(m) };
}
function linkOf(m) {
  return m && m.link_player_key ? { team: m.link_team || '', section: m.link_section || 'county', player_key: m.link_player_key, player_name: m.link_player_name || '' } : null;
}
// THE PICKER LIST (playlists "Named people" / "Groups"): the people who can see `section`, with id + name + groups only.
//   users: Identity users (or null when Identity is not reachable → the roles kept on the rows are used instead)
//   members: team_members rows · section: 'county' | 'club' | 'u20'
//   → { people:[{id, name, groups}], groups:[{id, label, n}] }  — never an email, a phone or a role other than a group
function pickerPeople(users, members, section) {
  const rows = (members || []).filter(m => m && m.status !== 'removed');
  const byId = new Map(rows.map(m => [String(m.user_id), m]));
  const src = Array.isArray(users)
    ? users.map(u => ({ id: String(u.id), roles: rolesOfAny(u.app_metadata && u.app_metadata.roles), m: byId.get(String(u.id)), u }))
    : rows.map(m => ({ id: String(m.user_id), roles: rolesOfAny(m.roles), m, u: null }));
  const people = src.filter(p => p.id && allowedSections(p.roles).includes(section))
    .map(p => ({ id: p.id, name: displayName(p.m, p.u), groups: groupsOfRoles(p.roles) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const g = new Map(); people.forEach(p => p.groups.forEach(x => g.set(x, (g.get(x) || 0) + 1)));
  TEAM_GROUPS.forEach(x => { if (!g.has(x)) g.set(x, 0); });
  return { people, groups: [...g.entries()].map(([id, n]) => ({ id, label: groupLabel(id), n })).sort((a, b) => a.label.localeCompare(b.label)) };
}
function rolesOfAny(raw) {
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_) { raw = []; } }
  return (Array.isArray(raw) ? raw : []).map(r => String(r).toLowerCase().trim()).filter(Boolean);
}

module.exports = { BASE_ROLES, TEAM_GROUPS, MEMBER_FIELDS, cleanRoles, groupsOfRoles, looseKey, knownPlayers, resolvePlayer, linkKeyIn,
  displayName, publicMember, linkOf, pickerPeople, rolesOfAny, up, tidy };
