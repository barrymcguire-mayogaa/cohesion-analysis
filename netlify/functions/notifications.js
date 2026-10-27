/**
 * Netlify Function: notifications — the 🔔 bell in the page headers (cohesion-notify.js), for every signed-in user.
 *
 * NOTHING IS WRITTEN PER EVENT. Every call works the items out from tables that already exist, for the caller only:
 *   game      a NEW GAME in a section he can see (games.created_at; a game he uploaded himself is left out)
 *             → "New game: Castlebar Mitchels v Garrymore (SFC Final)" → dashboard.html?game=<id>
 *   comment   NEW COMMENTS by other people on a playlist he OWNS, or on one he can see and has COMMENTED ON himself
 *             (only the comments after his first one), grouped per playlist (playlist_comments)
 *             → 'New comment on playlist "Kickouts"' / '3 new comments on playlist "Kickouts"' → playlists.html?pl=<id>
 *   share     a playlist SHARED WITH HIM — by name (Named people) or with one of his groups (Groups); never a whole-
 *             section share (playlist_log 'create' / 'share' entries; only people / groups ADDED by that entry; the
 *             playlist must still be shared with him now) → playlists.html?pl=<id>
 *   invite    ADMINS ONLY: "<name> accepted their invite" — an invited person (Identity invited_at) who has set his
 *             password (Identity confirmed_at), via the GoTrue admin API (netlify/lib/identityAdmin.js), named from
 *             team_members → team-admin.html
 * The SECTION wall (netlify/lib/access.js allowedSections) applies to every item: a U20 player never hears of a county
 * game or playlist. Items older than 30 days drop off; nothing from before the user's notify_since (when the bell
 * started for him) is shown, so nobody gets a flood of old items at launch.
 *
 * READ STATE (supabase/playlists_share.sql, columns on playlist_prefs): notify_since, notify_read_at ("Mark all read"),
 * notify_read {key: when read}. An item is read when its time is not after notify_read_at or its key's read time; a
 * comment group also counts as read up to when he last opened that playlist (playlist_seen, the Playlists page badge).
 * A comment group's key stays the same, so newer comments make it unread again.
 *
 *   POST /.netlify/functions/notifications
 *   { action:'list' }            -> { items:[{key, type, text, ts, url, section, unread, count?}], unread, stored }
 *   { action:'read', keys:[…] }  -> marks those items read (clicking one)
 *   { action:'readAll' }         -> "Mark all read"
 * stored:false = the SQL has not been run: the game items still come back and the page keeps the read state in the
 * browser instead; no error is ever shown for it.
 * PERSONAL DATA: names only — never another user's email or phone.
 */
const { verifiedClaims, UNAUTH } = require('../lib/identity');
const { rolesOf, sectionOf, metaObj, uploaderOf, groupLabel } = require('../lib/access');
const R = require('../lib/playlistRules');
const IA = require('../lib/identityAdmin');
const TM = require('../lib/team');

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const J = (code, obj) => ({ statusCode: code, body: JSON.stringify(obj) });
const DAY = 24 * 3600 * 1000, WINDOW = 30 * DAY, MAX_ITEMS = 60, MAX_KEYS = 200;
const KEY_RE = /^[gcsi]:[A-Za-z0-9_.:-]{1,120}$/;
const missingTable = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /relation .* does not exist|could not find the table/i.test(e.message || ''));
const missingColumn = e => !!e && (e.code === '42703' || e.code === 'PGRST204' || /column .* does not exist|could not find the '.*' column/i.test(e.message || ''));
async function safe(p) { try { const r = await p; return r || { data: null, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } }
// a stored time → ms. games.created_at is a timestamp WITHOUT a zone (UTC on Supabase): read it as UTC, not local time.
function ms(v) {
  if (v == null || v === '') return 0;
  let s = String(v).trim();
  if (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  const t = Date.parse(s); return Number.isFinite(t) ? t : 0;
}
const iso = t => new Date(t).toISOString();
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const plural = (n, one, many) => n === 1 ? one : n + ' ' + many;
const quote = s => '“' + str(s, 80) + '”';

// ── the caller's read state (playlist_prefs) ─────────────────────────────
// a new user's bell looks back 7 days on his first visit, so recent games and shares are there (Barry, 27 Oct)
const LOOKBACK_MS = 7 * 24 * 3600 * 1000;
async function stateOf(email, now) {
  const r = await safe(supabase.from('playlist_prefs').select('*').eq('email', email));
  if (r.error) return { stored: false, since: 0 };   // SQL not run: the last 30 days; the page keeps its own start point
  let row = (Array.isArray(r.data) ? r.data[0] : r.data) || null;
  if (!row) {
    row = { email, email_opt_out: false, badge_since: iso(now), notify_since: iso(now - LOOKBACK_MS), notify_read: {} };
    const w = await safe(supabase.from('playlist_prefs').insert(row));
    if (w.error) return { stored: false, since: 0 };
  }
  if (!('notify_since' in row) || !('notify_read' in row)) return { stored: false, since: ms(row.badge_since) || now };   // older copy of the SQL
  let read = row.notify_read;
  if (typeof read === 'string') { try { read = JSON.parse(read); } catch (_) { read = {}; } }
  return { stored: true, since: ms(row.notify_since) || now, readAll: ms(row.notify_read_at), read: read && typeof read === 'object' && !Array.isArray(read) ? read : {} };
}
const readUpTo = (st, key) => Math.max(st.readAll || 0, ms(st.read && st.read[key]));

// ── 1. new games ─────────────────────────────────────────────────────────
function gameText(m, id) {
  const home = str(m.homeTeam, 60).trim(), away = str(m.awayTeam, 60).trim();
  const title = home && away ? home + ' v ' + away : str(m.title, 120).trim() || 'Game ' + id;
  const extra = [m.competition, m.round].map(x => str(x, 60).trim()).filter(Boolean).join(' ');
  return 'New game: ' + title + (extra ? ' (' + extra + ')' : '');
}
async function gameItems(u, floor) {
  const r = await safe(supabase.from('games').select('id, meta, created_at').gte('created_at', iso(floor)).order('created_at', { ascending: false }).limit(200));
  if (r.error) { if (!missingColumn(r.error)) console.error('notifications games:', r.error.message); return []; }
  return (r.data || []).map(g => {
    const m = metaObj(g.meta) || {}, sec = sectionOf(m), ts = ms(g.created_at);
    if (!u.sections.includes(sec) || ts <= floor) return null;
    if (u.email && uploaderOf(m) === u.email) return null;                 // his own upload
    return { key: 'g:' + g.id, type: 'game', ts, text: gameText(m, g.id), url: 'dashboard.html?game=' + encodeURIComponent(g.id), section: sec };
  }).filter(Boolean);
}

// ── 2. comments on his playlists / threads he is in ──────────────────────
async function commentItems(u, floor, rowsOf, st) {
  const recent = await safe(supabase.from('playlist_comments').select('id, playlist_id, author_email, author_name, created_at').gt('created_at', iso(floor)).order('created_at', { ascending: true }));
  if (recent.error || !(recent.data || []).filter(c => String(c.author_email || '').toLowerCase() !== u.email).length) return [];
  const rows = await rowsOf();
  const mine = await safe(supabase.from('playlist_comments').select('playlist_id, created_at').eq('author_email', u.email));
  const firstMine = new Map();
  (mine.data || []).forEach(c => { const k = String(c.playlist_id), t = ms(c.created_at); if (!firstMine.has(k) || t < firstMine.get(k)) firstMine.set(k, t); });
  const seenR = await safe(supabase.from('playlist_seen').select('playlist_id, seen_at').eq('email', u.email));
  const seen = new Map(); (seenR.data || []).forEach(x => seen.set(String(x.playlist_id), ms(x.seen_at)));
  const byId = new Map(rows.map(p => [String(p.id), p]));
  const groups = new Map();
  recent.data.forEach(c => {
    if (String(c.author_email || '').toLowerCase() === u.email) return;   // his own comments never notify him
    const pid = String(c.playlist_id), p = byId.get(pid); if (!p) return;
    if (!R.canView(p, u) || !u.sections.includes(sectionOf(p.data))) return;
    const owner = R.isOwner(p, u), t = ms(c.created_at);
    if (!owner && !(firstMine.has(pid) && t > firstMine.get(pid))) return;   // not his playlist, not his thread
    if (t <= floor) return;
    const g = groups.get(pid) || { p, list: [] }; g.list.push({ t, by: str(c.author_name, 60) || 'Someone' }); groups.set(pid, g);
  });
  const out = [];
  groups.forEach((g, pid) => {
    const key = 'c:' + pid, upTo = Math.max(readUpTo(st, key), seen.get(pid) || 0);
    const unread = g.list.filter(x => x.t > upTo), ts = g.list[g.list.length - 1].t;
    const n = unread.length || g.list.length, nm = quote(g.p.name || 'Playlist');
    const text = unread.length ? (n === 1 ? 'New comment on playlist ' + nm : n + ' new comments on playlist ' + nm)
      : (n === 1 ? 'A comment on playlist ' + nm : n + ' comments on playlist ' + nm);
    const by = [...new Set((unread.length ? unread : g.list).map(x => x.by))];
    out.push({ key, type: 'comment', ts, text, sub: by.slice(0, 3).join(', ') + (by.length > 3 ? ' +' + (by.length - 3) : ''), count: n,
      url: 'playlists.html?pl=' + encodeURIComponent(pid), section: sectionOf(g.p.data), unreadOverride: unread.length > 0 });
  });
  return out;
}

// ── 3. playlists shared with him (by name or with one of his groups) ─────
function addedBy(entry) {
  const d = metaObj(entry.details) || {};
  const ids = s => (s && Array.isArray(s.peopleIds) ? s.peopleIds.map(String) : []);
  const grp = s => (s && Array.isArray(s.groups) ? s.groups.map(g => R.normGroup(g)).filter(Boolean) : []);
  if (entry.action === 'create') { const s = d.share || {}; return { people: s.level === 'people' ? ids(s) : [], groups: s.level === 'groups' ? grp(s) : [] }; }
  const to = d.to || {}, from = d.from || {};
  const hadP = new Set(from.level === 'people' ? ids(from) : []), hadG = new Set(from.level === 'groups' ? grp(from) : []);
  return { people: to.level === 'people' ? ids(to).filter(x => !hadP.has(x)) : [], groups: to.level === 'groups' ? grp(to).filter(x => !hadG.has(x)) : [] };
}
async function shareItems(u, floor, rowsOf) {
  const r = await safe(supabase.from('playlist_log').select('playlist_id, actor_email, actor_name, action, details, created_at').in('action', ['create', 'share']).gt('created_at', iso(floor)).order('created_at', { ascending: true }));
  if (r.error || !(r.data || []).some(e => String(e.actor_email || '').toLowerCase() !== u.email)) return [];
  const rows = await rowsOf();
  const byId = new Map(rows.map(p => [String(p.id), p])), best = new Map();
  (r.data || []).forEach(e => {
    if (String(e.actor_email || '').toLowerCase() === u.email) return;
    const p = byId.get(String(e.playlist_id)); if (!p) return;                  // deleted since
    if (!u.sections.includes(sectionOf(p.data)) || R.isOwner(p, u)) return;
    if (!(R.sharedWith(p, u) && R.seesAsMember(p, u))) return;                 // no longer shared with him
    const a = addedBy(e), t = ms(e.created_at); if (t <= floor) return;
    const viaName = !!u.id && a.people.includes(u.id), viaGroup = a.groups.find(g => u.groups.includes(g));
    if (!viaName && !viaGroup) return;
    best.set(String(p.id), { p, t, by: str(e.actor_name, 60) || 'Someone', group: viaName ? null : viaGroup });
  });
  return [...best.values()].map(x => ({ key: 's:' + x.p.id, type: 'share', ts: x.t,
    text: x.by + ' shared playlist ' + quote(x.p.name || 'Playlist') + ' with ' + (x.group ? 'your group ' + groupLabel(x.group) : 'you'),
    url: 'playlists.html?pl=' + encodeURIComponent(x.p.id), section: sectionOf(x.p.data) }));
}

// ── 4. admins: invites accepted ──────────────────────────────────────────
// ONE Identity listUsers call at most per request, for admins only, and cached 5 minutes per warm instance (compute credits)
let INV_CACHE = { at: 0, url: '', users: null };
const INV_TTL = 5 * 60 * 1000;
async function inviteItems(u, floor, context) {
  if (!u.admin) return [];
  const idn = IA.identityOf(context); if (!idn) return [];
  let users = INV_CACHE.users && INV_CACHE.url === idn.url && Date.now() - INV_CACHE.at < INV_TTL ? INV_CACHE.users : null;
  if (!users) {
    const L = await IA.listUsers(idn); if (!L.ok) { console.error('notifications identity:', L.error); return []; }
    users = L.users; INV_CACHE = { at: Date.now(), url: idn.url, users };
  }
  const acc = users.filter(x => x && x.invited_at && x.confirmed_at && ms(x.confirmed_at) > floor && String(x.id) !== u.id);
  if (!acc.length) return [];
  const tm = await safe(supabase.from('team_members').select('user_id, name, status').in('user_id', acc.map(x => String(x.id))));
  const rowOf = id => (tm.data || []).find(m => String(m.user_id) === String(id) && m.status !== 'removed') || null;
  return acc.map(x => ({ key: 'i:' + x.id, type: 'invite', ts: ms(x.confirmed_at), text: TM.displayName(rowOf(x.id), x) + ' accepted their invite',
    url: 'team-admin.html', section: '' }));
}

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') return J(405, { error: 'Method not allowed' });
    let body;
    try { body = JSON.parse(event.body); } catch (e) { return J(400, { error: 'Invalid JSON body' }); }
    body = body && typeof body === 'object' ? body : {};

    // ── auth (Netlify Identity JWT, verified by Netlify) — as playlists.js ──
    const token = ((event.headers && event.headers.authorization) || '').replace('Bearer ', '');
    if (!token) return J(401, { error: 'Authentication required' });
    const decoded = verifiedClaims(context);
    if (!decoded) return UNAUTH;
    const u = R.userOf(decoded, rolesOf);
    if (!u.email) return J(401, { error: 'Session has no email — sign in again' });
    const { action } = body;
    const now = Date.now(), cutoff = now - WINDOW;

    if (action === 'list') {
      const st = await stateOf(u.email, now);
      const floor = Math.max(cutoff, st.since || 0);
      const games = await gameItems(u, floor);
      // the playlists are read once, and only when there is a recent comment / share by someone else to check
      let rowsP = null;
      const rowsOf = () => rowsP || (rowsP = safe(supabase.from('playlists').select('*')).then(pr => pr.error ? [] : (pr.data || [])));
      const items = games.concat(
        st.stored ? await commentItems(u, floor, rowsOf, st) : [],
        st.stored ? await shareItems(u, floor, rowsOf) : [],
        st.stored ? await inviteItems(u, floor, context) : [])
        .map(it => {
          const unread = 'unreadOverride' in it ? it.unreadOverride : !(st.stored && it.ts <= readUpTo(st, it.key));
          const o = Object.assign({}, it, { ts: iso(it.ts), unread }); delete o.unreadOverride; return o;
        })
        .sort((a, b) => (b.unread - a.unread) || b.ts.localeCompare(a.ts)).slice(0, MAX_ITEMS);
      return J(200, { ok: true, items, unread: items.filter(i => i.unread).length, stored: st.stored, since: iso(Math.max(cutoff, st.since || 0)) });
    }

    if (action === 'read' || action === 'readAll') {
      const st = await stateOf(u.email, now);
      if (!st.stored) return J(200, { ok: true, stored: false });
      let patch;
      if (action === 'readAll') patch = { notify_read_at: iso(now), notify_read: {} };
      else {
        const keys = [...new Set((Array.isArray(body.keys) ? body.keys : []).map(k => String(k || '')).filter(k => KEY_RE.test(k)))].slice(0, MAX_KEYS);
        if (!keys.length) return J(400, { error: 'keys must be a list of item keys' });
        const read = {};
        Object.keys(st.read || {}).forEach(k => { if (ms(st.read[k]) > cutoff && KEY_RE.test(k)) read[k] = st.read[k]; });   // drop what has aged out
        keys.forEach(k => { read[k] = iso(now); });
        patch = { notify_read: read };
      }
      const w = await safe(supabase.from('playlist_prefs').update(patch).eq('email', u.email));
      if (w.error) return missingColumn(w.error) || missingTable(w.error) ? J(200, { ok: true, stored: false }) : J(500, { error: w.error.message });
      return J(200, { ok: true, stored: true });
    }

    return J(400, { error: 'action must be list, read or readAll' });
  } catch (error) {
    console.error('notifications error:', error);
    return J(500, { error: error.message || 'Internal server error' });
  }
};

exports._internals = { ms, addedBy, gameText, WINDOW };
exports._resetForTests = () => { INV_CACHE = { at: 0, url: '', users: null }; };
