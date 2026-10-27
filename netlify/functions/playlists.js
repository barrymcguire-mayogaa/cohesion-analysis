/**
 * Netlify Function: playlists — clip-playlist storage, sharing, comments, badge and activity log (service role).
 *
 * A playlist is a named, ordered list of video clips (one per event segment, possibly spanning several games). Every
 * read and write goes through this function with a verified Netlify Identity JWT; the tables have RLS on and no
 * anon / authenticated grants. EVERY access rule is decided here, server-side, by netlify/lib/playlistRules.js.
 *
 * SHARING (Barry, Oct 2026): every signed-in user — player, coach, analyst, admin — creates playlists and picks one of
 * four levels per playlist: Only me · Named people · Groups (Identity roles 'group:<name>') · Whole section. The
 * SECTION (county / club / u20, netlify/lib/access.js) is always the outer wall. Admins see every playlist.
 *
 *   POST /.netlify/functions/playlists
 *   { action:'list', section?, all? }                    -> the playlists the caller can see (each with canEdit / canShare /
 *                                                           canDelete / canModerate / sharedWithMe / adminView / unread),
 *                                                           comments merged in. all:true (admin) = every section.
 *   { action:'save', name, visibility?|scope?, people?, groups?, section, data }      -> create
 *   { action:'save', id, name, data }                    -> update (rename / re-order / clips / notes / drawings / cover)
 *   { action:'append', id, items:[clip…] }               -> add clips in ONE write, skipping ones already there
 *   { action:'share', id, visibility, people?, groups? } -> change the sharing level (owner / admin)
 *   { action:'delete', id }
 *   { action:'comment', id, clipIdx?|clipId?|target:'playlist', text, t?, vid? }
 *   { action:'commentEdit' | 'commentDelete', id, commentId, clipIdx?|clipId?|target? }
 *   { action:'directory', section }                      -> people {id, name} and groups {id, name, members} for sharing
 *   { action:'seen', id }                                -> the caller has read this playlist's comments (badge)
 *   { action:'unread' }                                  -> { total, byPlaylist } for the "new comments" badge
 *   { action:'prefs', emailOptOut? }                     -> the caller's notification preference
 *   { action:'log', playlistId?, actor?, kind?, section?, limit? }   -> the activity log (ADMIN ONLY)
 *
 * Tables (supabase/playlists_share.sql): playlists (+ visibility, share_people, share_groups, owner_name, official,
 * updated_at), playlist_comments, playlist_seen, playlist_prefs, playlist_notify (email digest queue, sent by
 * playlistDigest.js), playlist_log. Before that SQL is run everything that worked before still works: comments fall
 * back to the clip's own data (as before), and 'Only me' / 'Whole section' are written through the old scope column.
 */
const { verifiedClaims, UNAUTH } = require('../lib/identity');
const { rolesOf, allowedSections, sectionOf, normSection, metaObj, groupLabel } = require('../lib/access');
const R = require('../lib/playlistRules');
const { listUsers } = require('../lib/directory');

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const J = (code, obj) => ({ statusCode: code, body: JSON.stringify(obj) });
const forbid = msg => J(403, { error: 'Forbidden: ' + msg });
const nowISO = () => new Date().toISOString();
const missingTable = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /relation .* does not exist|could not find the table/i.test(e.message || ''));
const missingColumn = e => !!e && (e.code === '42703' || e.code === 'PGRST204' || /column .* does not exist|could not find the '.*' column/i.test(e.message || ''));
const NEEDS_SQL = 'Sharing tables not set up yet — run supabase/playlists_share.sql in Supabase.';

// ── clips (the dashboard's dashClipOf shape) ────────────────────────────
const MAX_APPEND = 500, MAX_ITEMS = 2000, MAX_DATA = 6 * 1024 * 1024;
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
// Whitelist a clip's fields; null when it could not be played.
function cleanClip(c) {
  if (!c || typeof c !== 'object') return null;
  const start = Number(c.start), end = Number(c.end), driveT = Number(c.driveT);
  if (typeof c.videoId !== 'string' || !c.videoId.trim() || c.gameId == null || c.gameId === '') return null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
  const out = { videoId: str(c.videoId, 40), gameId: str(c.gameId, 80), gameTitle: str(c.gameTitle, 200),
    driveT: Number.isFinite(driveT) && driveT >= 0 ? driveT : start, start, end,
    label: str(c.label, 200), code: str(c.code, 120), player: str(c.player, 120) };
  if (c.eventId != null && c.eventId !== '') out.eventId = str(c.eventId, 80);
  if (typeof c.angle === 'string' && c.angle) out.angle = str(c.angle, 40);
  return out;
}
// A saved playlist's clip: the clip fields plus what the Playlists page edits (note, drawings, trims) and its id.
const ITEM_KEYS = ['videoId', 'gameId', 'gameTitle', 'driveT', 'start', 'end', 'label', 'code', 'player', 'eventId', 'angle', 'note', 'draws', 'draw', 'cid'];
const STR_CAP = { videoId: 40, gameId: 80, gameTitle: 200, label: 200, code: 120, player: 120, eventId: 80, angle: 40, note: 1000, cid: 16 };
function cleanItem(it) {
  if (!it || typeof it !== 'object' || Array.isArray(it)) return null;
  const o = {};
  ITEM_KEYS.forEach(k => {
    if (it[k] === undefined || it[k] === null) return;
    if (STR_CAP[k]) o[k] = str(it[k], STR_CAP[k]);
    else if (k === 'start' || k === 'end' || k === 'driveT') { const n = Number(it[k]); if (Number.isFinite(n)) o[k] = n; }
    else o[k] = it[k];                                   // draws / draw: the page's telestration shapes
  });
  return o;
}
// The same event twice = same game + same event id, or (clips saved before event ids
// were stored) same game + same code + same main-angle second.
function clipKeys(c) {
  if (!c || c.gameId == null) return [];
  const g = String(c.gameId), keys = [];
  if (c.eventId != null && c.eventId !== '') keys.push(g + '|id|' + c.eventId);
  const t = Number(c.driveT);
  if (Number.isFinite(t)) keys.push(g + '|t|' + String(c.code || '').toUpperCase().trim() + '|' + Math.round(t));
  return keys;
}
const CID_RE = /^[a-z0-9]{4,16}$/i;
const newCid = () => 'k' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
// Give each incoming clip the id of the stored clip it is (by cid, else by game + event), so comments that hang on a
// clip id follow it through re-orders and saves from a page that never saw the ids. Legacy comments kept INSIDE a
// clip (before playlist_comments existed) are restored from the stored clip — a save can never drop or forge them.
function matchItems(incoming, stored) {
  const byCid = new Map(); stored.forEach(s => { if (s.cid && !byCid.has(s.cid)) byCid.set(s.cid, s); });
  const byKey = new Map(); stored.forEach(s => clipKeys(s).forEach(k => { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(s); }));
  const used = new Set(), usedCid = new Set(), pairs = [];
  incoming.forEach(it => {
    let m = null;
    if (it.cid && byCid.has(it.cid) && !used.has(byCid.get(it.cid))) m = byCid.get(it.cid);
    if (!m && !it.cid) for (const k of clipKeys(it)) { m = (byKey.get(k) || []).find(s => !used.has(s)) || null; if (m) break; }
    if (m) used.add(m);
    let cid = m && m.cid ? m.cid : (it.cid && CID_RE.test(it.cid) && !byCid.has(it.cid) ? it.cid : null);
    if (!cid || usedCid.has(cid)) cid = newCid();
    usedCid.add(cid);
    const out = Object.assign({}, it, { cid });
    delete out.comments;
    if (m && Array.isArray(m.comments) && m.comments.length) out.comments = m.comments;
    pairs.push({ item: out, from: m });
  });
  return { pairs, removed: stored.filter(s => !used.has(s)) };
}
function ensureCids(items) { let changed = false; const seen = new Set();
  items.forEach(it => { if (!it.cid || seen.has(it.cid)) { it.cid = newCid(); changed = true; } seen.add(it.cid); }); return changed; }
const EDIT_FIELDS = ['label', 'note', 'start', 'end', 'driveT', 'angle', 'videoId', 'draws', 'draw'];
const sameEdit = (a, b) => EDIT_FIELDS.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
const clipName = c => str((c && (c.label || c.code)) || 'Clip', 80);

// ── side tables (each one optional until the SQL is run) ────────────────
async function safe(p) { try { const r = await p; return r || { data: null, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } }

async function logAction(row, u, action, details) {
  const entry = { playlist_id: row && row.id != null ? Number(row.id) || null : null, playlist_name: str(row && row.name, 120),
    section: sectionOf(row && row.data), owner: str(row && row.owner, 200), actor_email: u.email, actor_name: u.name,
    action, details: details || {}, created_at: nowISO() };
  const r = await safe(supabase.from('playlist_log').insert(entry));
  if (r.error && !missingTable(r.error)) console.error('playlist_log:', r.error.message);
}
async function prefsOf(email) {
  const r = await safe(supabase.from('playlist_prefs').select('*').eq('email', email));
  if (r.error) return { missing: true, row: null };
  return { missing: false, row: (Array.isArray(r.data) ? r.data[0] : r.data) || null };
}
async function ensurePrefs(email) {
  const p = await prefsOf(email);
  if (p.missing) return null;
  if (p.row) return p.row;
  const row = { email, email_opt_out: false, badge_since: nowISO() };
  await safe(supabase.from('playlist_prefs').insert(row));
  return row;
}
async function commentsFor(ids) {
  if (!ids.length) return { ok: true, rows: [] };
  const r = await safe(supabase.from('playlist_comments').select('*').in('playlist_id', ids).order('created_at'));
  if (r.error) return { ok: false, rows: [], missing: missingTable(r.error) };
  return { ok: true, rows: r.data || [] };
}
async function seenOf(email) {
  const r = await safe(supabase.from('playlist_seen').select('*').eq('email', email));
  const m = new Map(); (r.data || []).forEach(x => m.set(String(x.playlist_id), x.seen_at)); return m;
}
// queue notification emails (sent in a digest by playlistDigest.js); the actor and anyone opted out are left out
async function enqueue(row, u, kind, recipients, excerpt) {
  const list = [...new Set((recipients || []).map(e => String(e || '').toLowerCase().trim()))]
    .filter(e => e && e !== u.email && /@/.test(e));
  if (!list.length) return 0;
  const pr = await safe(supabase.from('playlist_prefs').select('*').in('email', list));
  const out = new Set((pr.data || []).filter(x => x.email_opt_out).map(x => String(x.email).toLowerCase()));
  const rows = list.filter(e => !out.has(e)).map(e => ({ recipient: e, playlist_id: Number(row.id) || null, playlist_name: str(row.name, 120),
    kind, actor_name: u.name, excerpt: str(excerpt, 300), status: 'pending', created_at: nowISO() }));
  if (!rows.length) return 0;
  const r = await safe(supabase.from('playlist_notify').insert(rows));
  if (r.error) { if (!missingTable(r.error)) console.error('playlist_notify:', r.error.message); return 0; }
  return rows.length;
}

// ── shaping a row for the caller ─────────────────────────────────────────
function cmTable(c, u, mod) {
  const mine = String(c.author_email || '').toLowerCase() === u.email;
  const o = { id: 'db-' + c.id, author: c.author_name || 'user', text: c.text, ts: c.created_at, mine, canEdit: mine || u.admin, canDelete: mine || mod };
  if (c.t != null && c.t !== '') o.t = Number(c.t);
  if (c.vid) o.vid = c.vid;
  if (c.edited_at) o.edited = true;
  return o;
}
function cmLegacy(c, u, mod) {
  const mine = String(c.email || '').toLowerCase() === u.email && !!u.email;
  const o = { id: c.id, author: c.author || 'user', text: c.text, ts: c.ts, mine, canEdit: mine || u.admin, canDelete: mine || mod, legacy: true };
  if (c.t != null) o.t = c.t; if (c.vid) o.vid = c.vid; if (c.edited) o.edited = true;
  return o;
}
const byTs = (a, b) => String(a.ts || '').localeCompare(String(b.ts || ''));
function commentsOfTarget(row, u, tbl, clip) {
  const mod = R.canModerate(row, u), data = metaObj(row.data) || {};
  const legacy = clip ? R.arr(clip.comments) : R.arr(data.comments);
  const t = (tbl || []).filter(c => String(c.playlist_id) === String(row.id) && (clip ? (clip.cid && c.clip_id === clip.cid) : !c.clip_id));
  return legacy.map(c => cmLegacy(c, u, mod)).concat(t.map(c => cmTable(c, u, mod))).sort(byTs);
}
function decorate(row, u, tbl, unread) {
  const data = metaObj(row.data) || {}, lv = R.levelOf(row), owner = R.isOwner(row, u);
  const items = R.arr(data.items).map(it => {
    const o = Object.assign({}, it); delete o.comments;
    const cms = commentsOfTarget(row, u, tbl, it); if (cms.length) o.comments = cms;
    return o;
  });
  const out = { id: row.id, name: row.name, scope: R.scopeFor(lv), visibility: lv, section: sectionOf(data),
    owner: (owner || u.admin) ? (row.owner || '') : '', ownerName: row.owner_name || (row.owner ? String(row.owner).split('@')[0] : 'Staff'),
    mine: owner, official: R.isOfficial(row),
    sharePeople: R.peopleOf(row).map(p => ({ id: p.id || '', name: p.name || 'Member' })),
    shareGroups: R.groupsOfRow(row).map(g => ({ id: g, name: groupLabel(g) })),
    sharedWithMe: !owner && R.sharedWith(row, u) && R.seesAsMember(row, u),
    adminView: u.admin && !R.seesAsMember(row, u),
    canEdit: R.canEdit(row, u), canShare: R.canShare(row, u), canDelete: R.canDelete(row, u), canModerate: R.canModerate(row, u),
    unread: unread || 0, created_at: row.created_at, updated_at: row.updated_at || row.created_at,
    data: Object.assign({}, data, { items, comments: commentsOfTarget(row, u, tbl, null) }) };
  if (u.admin) out.sharePeople = R.peopleOf(row).map(p => ({ id: p.id || '', name: p.name || 'Member', email: p.email || '' }));
  return out;
}
function unreadMap(rows, u, tbl, since, seen) {
  const m = new Map();
  (tbl || []).forEach(c => {
    if (String(c.author_email || '').toLowerCase() === u.email) return;
    const pid = String(c.playlist_id), s = seen.get(pid);
    // compare as instants: Postgres hands timestamps back as '…+00:00' with microseconds, a fresh row has '…Z'
    const after = Math.max(Date.parse(since || 0) || 0, Date.parse(s || 0) || 0);
    if ((Date.parse(c.created_at || 0) || 0) > after) m.set(pid, (m.get(pid) || 0) + 1);
  });
  const vis = new Set(rows.map(r => String(r.id))); let total = 0; const byPlaylist = {};
  m.forEach((n, pid) => { if (vis.has(pid)) { byPlaylist[pid] = n; total += n; } });
  return { total, byPlaylist };
}

// ── sharing: resolve the people / groups a request names ────────────────
async function resolveShare(body, u, section, context) {
  const level = R.normLevel(body.visibility) || (body.scope === 'personal' ? 'private' : body.scope === 'club' ? 'section' : null);
  if (!level) return { error: J(400, { error: "visibility must be one of private, people, groups, section" }) };
  let people = [], groups = [];
  if (level === 'people') {
    const ids = [...new Set((Array.isArray(body.people) ? body.people : []).map(p => String((p && p.id) || p || '')).filter(Boolean))];
    if (!ids.length) return { error: J(400, { error: 'Pick at least one person to share with' }) };
    const users = await listUsers(context);
    if (!users) return { error: J(503, { error: 'The people list is not available right now (Netlify Identity) — try again, or share with a group or the whole section.' }) };
    const ok = users.filter(x => allowedSections(x.roles).includes(section));
    people = ids.map(id => ok.find(x => x.id === id)).filter(Boolean).filter(x => x.email !== u.email)
      .map(x => ({ id: x.id, email: x.email, name: x.name }));
    if (!people.length) return { error: J(400, { error: 'None of those people can see this section' }) };
  }
  if (level === 'groups') {
    groups = [...new Set((Array.isArray(body.groups) ? body.groups : []).map(g => R.normGroup((g && g.id) || g)).filter(Boolean))];
    if (!groups.length) return { error: J(400, { error: 'Pick at least one group to share with' }) };
  }
  return { level, people, groups };
}
// who to tell about a share: people newly added, members of groups newly added (whole-section shares email nobody)
async function shareRecipients(before, after, section, context) {
  if (after.level === 'people') {
    const had = new Set(before.level === 'people' ? before.people.map(p => p.id || p.email) : []);
    return after.people.filter(p => !had.has(p.id || p.email)).map(p => p.email);
  }
  if (after.level === 'groups') {
    const had = new Set(before.level === 'groups' ? before.groups : []);
    const add = after.groups.filter(g => !had.has(g)); if (!add.length) return [];
    const users = await listUsers(context); if (!users) return [];
    return users.filter(x => allowedSections(x.roles).includes(section) && x.roles.some(r => add.includes(r))).map(x => x.email);
  }
  return [];
}
const shareOf = row => ({ level: R.levelOf(row), people: R.peopleOf(row), groups: R.groupsOfRow(row) });
// peopleIds: the sharees' Identity ids, so the 🔔 bell (notifications.js) can tell a person a playlist was shared with him
// (names alone are not unique; an email never goes in the log's details)
const shareSummary = s => ({ level: s.level, people: s.people.map(p => p.name || p.id), peopleIds: s.people.map(p => String(p.id || '')).filter(Boolean), groups: s.groups });

// write a playlists row; before the SQL is run the new columns do not exist — fall back to the old ones when the
// level can be said with scope alone (Only me / Whole section)
const NEW_COLS = ['visibility', 'share_people', 'share_groups', 'owner_name', 'official', 'updated_at'];
async function writeRow(op, row, id) {
  const go = r => op === 'insert' ? supabase.from('playlists').insert(r).select('id').single() : supabase.from('playlists').update(r).eq('id', id);
  let res = await go(row);
  if (res && res.error && missingColumn(res.error)) {
    if (row.visibility === 'people' || row.visibility === 'groups') return { error: { message: NEEDS_SQL, needsSql: true } };
    const r2 = Object.assign({}, row); NEW_COLS.forEach(k => delete r2[k]);
    res = await go(r2);
  }
  return res || { data: null, error: null };
}
async function loadRow(id) {
  const { data, error } = await supabase.from('playlists').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Playlist not found');
  return data;
}
const renamed = (row, name) => Object.assign({}, row, { name });

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') return J(405, { error: 'Method not allowed' });
    let body;
    try { body = JSON.parse(event.body); } catch (e) { return J(400, { error: 'Invalid JSON body' }); }
    body = body && typeof body === 'object' ? body : {};

    // ── auth (Netlify Identity JWT, verified by Netlify) ──
    const token = ((event.headers && event.headers.authorization) || '').replace('Bearer ', '');
    if (!token) return J(401, { error: 'Authentication required' });
    const decoded = verifiedClaims(context);
    if (!decoded) return UNAUTH;
    const u = R.userOf(decoded, rolesOf);
    if (!u.email) return J(401, { error: 'Session has no email — sign in again' });
    const { action } = body;

    // ── list / unread ──
    if (action === 'list' || action === 'unread') {
      const want = body.section ? String(body.section).toLowerCase() : null;
      if (want && !u.sections.includes(want)) return forbid('no access to that section');
      const { data, error } = await supabase.from('playlists').select('*').order('name');
      if (error) throw new Error(error.message);
      const all = u.admin && body.all === true;      // an admin's "every section" view
      const rows = (data || []).filter(p => R.canView(p, u) && (all || (want ? sectionOf(p.data) === want : u.sections.includes(sectionOf(p.data)))));
      const tbl = await commentsFor(rows.map(r => r.id));
      const pf = await ensurePrefs(u.email), seen = await seenOf(u.email);
      const un = unreadMap(rows, u, tbl.rows, pf ? pf.badge_since : nowISO(), seen);
      if (action === 'unread') return J(200, { ok: true, total: un.total, byPlaylist: un.byPlaylist });
      return J(200, { ok: true, playlists: rows.map(r => decorate(r, u, tbl.rows, un.byPlaylist[String(r.id)])), sections: u.sections,
        unreadTotal: un.total, commentsTable: tbl.ok,
        me: { name: u.name, admin: u.admin, staff: u.staff, groups: u.groups.map(g => ({ id: g, name: groupLabel(g) })), emailOptOut: !!(pf && pf.email_opt_out) } });
    }

    // ── directory: who a playlist in this section can be shared with (names only, never emails) ──
    if (action === 'directory') {
      const section = normSection(body.section);
      if (!u.sections.includes(section)) return forbid('no access to that section');
      const users = await listUsers(context);
      if (!users) return J(200, { ok: true, available: false, people: [], groups: [] });
      const inSec = users.filter(x => allowedSections(x.roles).includes(section));
      const people = inSec.filter(x => x.email !== u.email).map(x => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name));
      const gm = new Map(); inSec.forEach(x => x.roles.filter(r => R.normGroup(r) === r).forEach(r => gm.set(r, (gm.get(r) || 0) + 1)));
      const groups = [...gm.entries()].map(([id, n]) => ({ id, name: groupLabel(id), members: n })).sort((a, b) => a.name.localeCompare(b.name));
      return J(200, { ok: true, available: true, people, groups });
    }

    // ── notification preference ──
    if (action === 'prefs') {
      const p = await ensurePrefs(u.email);
      if (!p) return J(424, { error: NEEDS_SQL });
      if (typeof body.emailOptOut === 'boolean') {
        const r = await safe(supabase.from('playlist_prefs').update({ email_opt_out: body.emailOptOut }).eq('email', u.email));
        if (r.error) throw new Error(r.error.message);
        p.email_opt_out = body.emailOptOut;
      }
      return J(200, { ok: true, emailOptOut: !!p.email_opt_out });
    }

    // ── activity log: admins only ──
    if (action === 'log') {
      if (!u.admin) return forbid('the activity log is for admins');
      let q = supabase.from('playlist_log').select('*');
      if (body.playlistId != null && body.playlistId !== '') q = q.eq('playlist_id', Number(body.playlistId));
      if (body.actor) q = q.eq('actor_email', String(body.actor).toLowerCase());
      if (body.kind) q = q.eq('action', String(body.kind));
      if (body.section) q = q.eq('section', normSection(body.section));
      const lim = Math.max(1, Math.min(1000, Number(body.limit) || 300));
      const r = await safe(q.order('created_at', { ascending: false }).limit(lim));
      if (r.error) return missingTable(r.error) ? J(424, { error: NEEDS_SQL }) : J(500, { error: r.error.message });
      return J(200, { ok: true, entries: r.data || [] });
    }

    // ── create / update ──
    if (action === 'save') {
      const { id, name, data } = body;
      if (!name || typeof name !== 'string' || !name.trim()) return J(400, { error: 'name is required' });
      if (!data || typeof data !== 'object') return J(400, { error: 'data object is required' });
      const rawItems = Array.isArray(data.items) ? data.items : [];
      if (rawItems.length > MAX_ITEMS) return J(400, { error: 'Too many clips (max ' + MAX_ITEMS + ')' });
      const items = rawItems.map(cleanItem).filter(Boolean);
      const cover = typeof data.cover === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(data.cover) && data.cover.length <= 400000 ? data.cover : null;
      if (JSON.stringify(items).length > MAX_DATA) return J(400, { error: 'Playlist too large' });
      const nm = name.trim().slice(0, 80);

      if (id) {
        const existing = await loadRow(id);
        if (!R.canView(existing, u)) return forbid('no access to this playlist');
        if (!R.canEdit(existing, u)) return forbid('Not your playlist — only its owner, an admin or (for official playlists) an analyst can edit it');
        const ex = metaObj(existing.data) || {}, stored = R.arr(ex.items);
        const { pairs, removed } = matchItems(items, stored);
        const newData = { items: pairs.map(p => p.item), section: sectionOf(existing.data) };   // updates keep the stored section
        if (cover) newData.cover = cover;
        if (Array.isArray(ex.comments) && ex.comments.length) newData.comments = ex.comments;     // legacy playlist-level comments
        const { error } = await writeRow('update', { name: nm, data: newData, updated_at: nowISO() }, id);
        if (error) return error.needsSql ? J(424, { error: NEEDS_SQL }) : J(500, { error: error.message });
        // the log: one entry per kind of change
        const after = renamed(existing, nm);
        if (nm !== existing.name) await logAction(after, u, 'rename', { from: existing.name, to: nm });
        const added = pairs.filter(p => !p.from).map(p => clipName(p.item));
        if (added.length) await logAction(after, u, 'clips_added', { count: added.length, clips: added.slice(0, 20) });
        if (removed.length) await logAction(after, u, 'clips_removed', { count: removed.length, clips: removed.map(clipName).slice(0, 20) });
        const order = pairs.filter(p => p.from).map(p => stored.indexOf(p.from));
        if (order.some((v, i) => i && v < order[i - 1])) await logAction(after, u, 'reorder', { clips: order.length });
        const edited = pairs.filter(p => p.from && !sameEdit(p.item, p.from)).map(p => clipName(p.item));
        const coverChanged = (ex.cover || null) !== (cover || null);
        if (edited.length || coverChanged) await logAction(after, u, 'edit', Object.assign({ count: edited.length, clips: edited.slice(0, 20) }, coverChanged ? { cover: true } : {}));
        return J(200, { ok: true, id, items: newData.items.map(it => { const o = Object.assign({}, it); delete o.comments; return o; }) });
      }

      // create: the section is stamped from the caller's context, the owner is the caller
      const section = normSection(body.section);
      if (!u.sections.includes(section)) return forbid('no access to that section');
      const sh = await resolveShare(body.visibility || body.scope ? body : { visibility: 'section' }, u, section, context);
      if (sh.error) return sh.error;
      ensureCids(items);
      const row = { name: nm, scope: R.scopeFor(sh.level), owner: u.email, owner_name: u.name, visibility: sh.level,
        share_people: sh.people, share_groups: sh.groups, official: u.staff && sh.level === 'section',
        data: Object.assign({ items, section }, cover ? { cover } : {}), updated_at: nowISO() };
      const { data: ins, error } = await writeRow('insert', row);
      if (error) return error.needsSql ? J(424, { error: NEEDS_SQL }) : J(500, { error: error.message });
      const created = Object.assign({ id: ins.id }, row);
      await logAction(created, u, 'create', { share: shareSummary(sh), clips: items.length });
      const to = await shareRecipients({ level: 'private', people: [], groups: [] }, sh, section, context);
      if (to.length) await enqueue(created, u, 'share', to, '');
      return J(200, { ok: true, id: ins.id, items });
    }

    // ── append: add a batch of clips to an existing playlist, without duplicates ──
    if (action === 'append') {
      const { id } = body;
      if (!id) return J(400, { error: 'id is required' });
      if (!Array.isArray(body.items) || !body.items.length) return J(400, { error: 'items must be a non-empty array' });
      if (body.items.length > MAX_APPEND) return J(400, { error: 'Too many clips in one request (max ' + MAX_APPEND + ')' });
      const clean = body.items.map(cleanClip);
      if (clean.some(c => !c)) return J(400, { error: 'Every clip needs a videoId, a gameId and start / end times' });
      const existing = await loadRow(id);
      if (!R.canView(existing, u)) return forbid('no access to this playlist');
      if (!R.canEdit(existing, u)) return forbid('Not your playlist — only its owner, an admin or (for official playlists) an analyst can add clips');
      const data = metaObj(existing.data) || {};
      const items = Array.isArray(data.items) ? data.items : [];
      const seen = new Set(); items.forEach(it => clipKeys(it).forEach(k => seen.add(k)));
      let added = 0, skipped = 0; const names = [];
      for (const c of clean) {
        const keys = clipKeys(c);
        if (keys.some(k => seen.has(k))) { skipped++; continue; }
        keys.forEach(k => seen.add(k)); c.cid = newCid(); items.push(c); added++; names.push(clipName(c));
      }
      if (added) {
        data.items = items; data.section = sectionOf(existing.data);   // the stored section never changes
        const { error } = await writeRow('update', { data, updated_at: nowISO() }, id);
        if (error) throw new Error(error.message);
        await logAction(existing, u, 'clips_added', { count: added, skipped, clips: names.slice(0, 20) });
      }
      return J(200, { ok: true, id, name: existing.name, added, skipped, total: items.length });
    }

    // ── share: change the level ──
    if (action === 'share') {
      const { id } = body;
      if (!id) return J(400, { error: 'id is required' });
      const existing = await loadRow(id);
      if (!R.canView(existing, u)) return forbid('no access to this playlist');
      if (!R.canShare(existing, u)) return forbid('only the owner or an admin can change who sees this playlist');
      const section = sectionOf(existing.data);
      const sh = await resolveShare(body, u, section, context);
      if (sh.error) return sh.error;
      const before = shareOf(existing);
      if (sh.level === 'people') sh.people = sh.people.filter(p => p.email !== String(existing.owner || '').toLowerCase());   // never the owner himself
      if (sh.level === 'people' && !sh.people.length) return J(400, { error: 'Pick at least one person other than the owner' });
      const upd = { visibility: sh.level, scope: R.scopeFor(sh.level), share_people: sh.people, share_groups: sh.groups, updated_at: nowISO() };
      const { error } = await writeRow('update', upd, id);
      if (error) return error.needsSql ? J(424, { error: NEEDS_SQL }) : J(500, { error: error.message });
      await logAction(existing, u, 'share', { from: shareSummary(before), to: shareSummary(sh) });
      const to = await shareRecipients(before, sh, section, context);
      const queued = to.length ? await enqueue(existing, u, 'share', to, '') : 0;
      const tbl = await commentsFor([existing.id]);
      return J(200, { ok: true, id, notified: queued, playlist: decorate(Object.assign({}, existing, upd), u, tbl.rows, 0) });
    }

    if (action === 'delete') {
      const { id } = body;
      if (!id) return J(400, { error: 'id is required' });
      const existing = await loadRow(id);
      if (!R.canView(existing, u)) return forbid('no access to this playlist');
      if (!R.canDelete(existing, u)) {
        return R.isOfficial(existing) ? forbid('an official (club-wide) playlist is deleted by an admin') : J(403, { error: 'Not your playlist' });
      }
      const tbl = await commentsFor([existing.id]);
      const { error } = await supabase.from('playlists').delete().eq('id', id);
      if (error) throw new Error(error.message);
      const d = metaObj(existing.data) || {};
      const legacyN = R.arr(d.items).reduce((n, it) => n + R.arr(it.comments).length, 0) + R.arr(d.comments).length;
      await logAction(existing, u, 'delete', { name: existing.name, clips: R.arr(d.items).length, comments: tbl.rows.length + legacyN,
        share: shareSummary(shareOf(existing)), owner: existing.owner || '' });
      if (tbl.ok && tbl.rows.length) await safe(supabase.from('playlist_comments').delete().eq('playlist_id', Number(existing.id)));
      await safe(supabase.from('playlist_seen').delete().eq('playlist_id', Number(existing.id)));
      return J(200, { ok: true });
    }

    // ── read state for the badge ──
    if (action === 'seen') {
      const { id } = body;
      if (!id) return J(400, { error: 'id is required' });
      const existing = await loadRow(id);
      if (!R.canView(existing, u)) return forbid('no access to this playlist');
      const pid = Number(existing.id);
      const r = await safe(supabase.from('playlist_seen').select('*').eq('email', u.email).eq('playlist_id', pid));
      if (r.error) return missingTable(r.error) ? J(200, { ok: true, stored: false }) : J(500, { error: r.error.message });
      const at = nowISO();
      const w = (r.data || []).length
        ? await safe(supabase.from('playlist_seen').update({ seen_at: at }).eq('email', u.email).eq('playlist_id', pid))
        : await safe(supabase.from('playlist_seen').insert({ email: u.email, playlist_id: pid, seen_at: at }));
      if (w.error) throw new Error(w.error.message);
      return J(200, { ok: true, stored: true, seen_at: at });
    }

    // ── comments: anyone who can see the playlist; on the playlist or on one clip, optionally at a moment ──
    if (['comment', 'commentEdit', 'commentDelete'].includes(action)) {
      const { id } = body;
      const onPlaylist = body.target === 'playlist';
      if (id == null || (!onPlaylist && body.clipIdx == null && !body.clipId)) return J(400, { error: "id and clipIdx are required (or target:'playlist')" });
      const row = await loadRow(id);
      if (!R.canView(row, u)) return forbid(u.sections.includes(sectionOf(row.data)) ? 'Not your playlist' : 'no access to this section');
      const data = metaObj(row.data) || {}; row.data = data;
      const items = Array.isArray(data.items) ? data.items : [];
      let it = null;
      if (!onPlaylist) {
        const idx = body.clipId ? items.findIndex(x => x && x.cid === body.clipId) : Number(body.clipIdx);
        it = items[idx];
        if (!it) return J(400, { error: 'No clip at that position — the playlist may have changed. Reload and retry.' });
      }
      const where = onPlaylist ? 'playlist' : clipName(it);
      const saveData = async () => { const { error } = await writeRow('update', { data }, id); if (error) throw new Error(error.message); };
      const answer = async (extra) => { const tbl = await commentsFor([row.id]);
        return J(200, Object.assign({ ok: true, comments: commentsOfTarget(row, u, tbl.rows, it) }, extra || {})); };

      if (action === 'comment') {
        const text = String(body.text || '').trim().slice(0, 1000);
        if (!text) return J(400, { error: 'Empty comment' });
        let t = Number(body.t); t = body.t != null && Number.isFinite(t) && t >= 0 ? Math.round(t * 10) / 10 : null;
        const vid = t != null && typeof body.vid === 'string' && body.vid ? body.vid.slice(0, 20) : null;
        const cidsNew = it ? ensureCids(items) : false;
        const ins = await safe(supabase.from('playlist_comments').insert({ playlist_id: Number(row.id), clip_id: it ? it.cid : null, t, vid,
          author_email: u.email, author_name: u.name, text, created_at: nowISO() }).select('id').single());
        let newId;
        if (ins.error) {
          if (!missingTable(ins.error)) throw new Error(ins.error.message);
          // before the SQL is run: the comment lives inside the playlist, as it always did
          const cmObj = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), author: u.name, email: u.email, text, ts: nowISO() };
          if (t != null) { cmObj.t = t; if (vid) cmObj.vid = vid; }
          if (it) { it.comments = Array.isArray(it.comments) ? it.comments : []; it.comments.push(cmObj); }
          else { data.comments = Array.isArray(data.comments) ? data.comments : []; data.comments.push(cmObj); }
          await saveData(); newId = cmObj.id;
        } else {
          if (cidsNew) await saveData();
          newId = 'db-' + ((ins.data && ins.data.id) != null ? ins.data.id : '');
        }
        await logAction(row, u, 'comment_add', { on: where, clipId: it ? it.cid : null, text: str(text, 300), t });
        await enqueue(row, u, 'comment', [row.owner], text);
        return answer({ commentId: newId, clipId: it ? it.cid : null });
      }

      // edit / delete: one's own comment; the owner and admins remove anyone's (an admin may also edit)
      const cidStr = String(body.commentId || '');
      const mod = R.canModerate(row, u);
      if (/^db-\d+$/.test(cidStr)) {
        const r = await safe(supabase.from('playlist_comments').select('*').eq('id', Number(cidStr.slice(3))));
        const cm = (r.data || [])[0];
        if (!cm || String(cm.playlist_id) !== String(row.id)) return J(400, { error: 'Comment not found' });
        const mine = String(cm.author_email || '').toLowerCase() === u.email;
        if (action === 'commentEdit') {
          if (!mine && !u.admin) return J(403, { error: 'Not your comment' });
          const text = String(body.text || '').trim().slice(0, 1000);
          if (!text) return J(400, { error: 'Empty comment' });
          const w = await safe(supabase.from('playlist_comments').update({ text, edited_at: nowISO() }).eq('id', cm.id));
          if (w.error) throw new Error(w.error.message);
          await logAction(row, u, 'comment_edit', { on: where, author: cm.author_name, from: str(cm.text, 300), to: str(text, 300) });
        } else {
          if (!mine && !mod) return J(403, { error: 'Not your comment' });
          const w = await safe(supabase.from('playlist_comments').delete().eq('id', cm.id));
          if (w.error) throw new Error(w.error.message);
          await logAction(row, u, 'comment_remove', { on: where, author: cm.author_name, authorEmail: cm.author_email, text: str(cm.text, 300), removedBy: u.name, byModerator: !mine });
        }
        return answer();
      }
      const list = it ? (it.comments = Array.isArray(it.comments) ? it.comments : []) : (data.comments = Array.isArray(data.comments) ? data.comments : []);
      const cm = list.find(x => x.id === cidStr);
      if (!cm) return J(400, { error: 'Comment not found' });
      const mine = !!u.email && String(cm.email || '').toLowerCase() === u.email;
      if (action === 'commentEdit') {
        if (!mine && !u.admin) return J(403, { error: 'Not your comment' });
        const text = String(body.text || '').trim().slice(0, 1000);
        if (!text) return J(400, { error: 'Empty comment' });
        const from = cm.text; cm.text = text; cm.edited = true;
        await saveData();
        await logAction(row, u, 'comment_edit', { on: where, author: cm.author, from: str(from, 300), to: str(text, 300) });
      } else {
        if (!mine && !mod) return J(403, { error: 'Not your comment' });
        const keep = list.filter(x => x.id !== cidStr);
        if (it) it.comments = keep; else data.comments = keep;
        await saveData();
        await logAction(row, u, 'comment_remove', { on: where, author: cm.author, authorEmail: cm.email || '', text: str(cm.text, 300), removedBy: u.name, byModerator: !mine });
      }
      return answer();
    }

    return J(400, { error: 'action must be list, save, append, share, delete, comment, commentEdit, commentDelete, directory, seen, unread, prefs or log' });

  } catch (error) {
    console.error('playlists error:', error);
    const missing = /relation .*playlists.* does not exist/i.test(error.message || '');
    return J(missing ? 424 : 500, { error: missing ? 'Playlists table not created yet — run the setup SQL in Supabase.' : (error.message || 'Internal server error') });
  }
};

// for the tests
exports._internals = { matchItems, cleanItem, clipKeys, unreadMap };
