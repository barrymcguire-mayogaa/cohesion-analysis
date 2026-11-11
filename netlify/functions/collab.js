/**
 * Netlify Function: collab — 👥 TAG TOGETHER: two (or more) analysts tagging one game at the same time (Nov 2026).
 *
 * The events themselves are saved as always (editEvent). This function only tells each tagger what the others are
 * doing, so their Code Rooms stay in step:
 *   · PRESENCE + CHANGE LOG — each tagger has ONE small JSON file of his own in the stills bucket:
 *       collab/<gameId>/<user>.json = { uid, name, lane, tpl, at, seq, log:[{seq, op:'ins'|'upd'|'del', id, at}] }
 *     Nobody ever writes another person's file, so two people saving at once can never overwrite each other.
 *     (No table and no schema change: the bucket the drawing stills already use.)
 *   · POLL — a partner's new log entries since the last look, plus the rows they name, plus every row inserted
 *     since the highest id the caller has seen (the events table has ids but no "changed at").
 *
 *   POST /.netlify/functions/collab
 *   { action:'beat',  gameId, lane, tpl, changes:[{op, id}] }  -> { ok, seq }     (edit capability: admin / analyst)
 *   { action:'poll',  gameId, seen:{uid:seq}, sinceId }        -> { ok, peers:[…], rows:[{id,data}], deleted:[id], seqs, maxId }
 *   { action:'leave', gameId }                                 -> { ok }
 * Every action: the game must be in a section the caller can see.
 */
const { verifiedClaims, UNAUTH } = require('../lib/identity');
const { rolesOf, allowedSections, sectionOf, can } = require('../lib/access');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = 'playlist-stills', LOG_MAX = 400, STALE_MS = 5 * 60 * 1000, ROWS_MAX = 1000;
const J = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const store = () => (supabase.storage && typeof supabase.storage.from === 'function') ? supabase.storage.from(BUCKET) : null;
const safe = async p => { try { return await p; } catch (e) { return { data: null, error: { message: e.message } }; } };
const uidOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'user';
const gidOk = g => typeof g === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(g);
const txt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

async function readJson(path) {
  const st = store(); if (!st) return null;
  const r = await safe(st.download(path)); if (r.error || !r.data) return null;
  let s = ''; try { s = typeof r.data.text === 'function' ? await r.data.text() : Buffer.isBuffer(r.data) ? r.data.toString('utf8') : String(r.data); } catch (_) { return null; }
  try { return JSON.parse(s); } catch (_) { return null; }
}
// a lane: {kind:'all'} | {kind:'team', team} | {kind:'codes', codes:[…]} — only to show partners; nothing is enforced here
function cleanLane(l) {
  l = l && typeof l === 'object' ? l : {};
  if (l.kind === 'team' && l.team) return { kind: 'team', team: txt(l.team, 60).toUpperCase() };
  if (l.kind === 'codes' && Array.isArray(l.codes)) return { kind: 'codes', codes: l.codes.slice(0, 60).map(c => txt(c, 60).toUpperCase()).filter(Boolean) };
  return { kind: 'all' };
}

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') return J(405, { error: 'Method not allowed' });
    let body; try { body = JSON.parse(event.body); } catch (_) { return J(400, { error: 'Invalid JSON body' }); }
    body = body && typeof body === 'object' ? body : {};
    const token = ((event.headers && event.headers.authorization) || '').replace('Bearer ', '');
    if (!token) return J(401, { error: 'Authentication required' });
    const claims = verifiedClaims(context); if (!claims) return UNAUTH;
    const roles = rolesOf(claims), email = String(claims.email || '').toLowerCase();
    if (!email) return J(401, { error: 'Session has no email — sign in again' });
    const name = txt((claims.user_metadata && (claims.user_metadata.full_name || claims.user_metadata.name)) || email.split('@')[0], 60);
    const { action, gameId } = body;
    if (!gidOk(gameId)) return J(400, { error: 'gameId is required' });
    const g = await safe(supabase.from('games').select('id, meta').eq('id', gameId).single());
    if (g.error || !g.data) return J(404, { error: 'Game not found' });
    if (!allowedSections(roles).includes(sectionOf(g.data.meta))) return J(403, { error: 'Forbidden: no access to this game' });
    const st = store(), me = uidOf(email), dir = 'collab/' + gameId + '/', mine = dir + me + '.json';

    if (action === 'beat' || action === 'leave') {
      if (!can(roles, 'edit')) return J(403, { error: 'Forbidden: only people who can tag (admins and analysts) join a tagging session' });
      if (!st) return J(500, { error: 'Storage is not set up' });
      if (action === 'leave') { await safe(st.remove([mine])); return J(200, { ok: true }); }
      const cur = (await readJson(mine)) || { uid: me, seq: 0, log: [] };
      let seq = +cur.seq || 0; const now = Date.now(), log = Array.isArray(cur.log) ? cur.log : [];
      (Array.isArray(body.changes) ? body.changes : []).slice(0, 500).forEach(c => {
        if (!c || !['ins', 'upd', 'del'].includes(c.op)) return; const id = Number(c.id); if (!Number.isFinite(id) || id <= 0) return;
        log.push({ seq: ++seq, op: c.op, id, at: now });
      });
      const out = { uid: me, name, lane: cleanLane(body.lane), tpl: txt(body.tpl, 40), at: now, seq, lastTag: log.length ? log[log.length - 1].at : (cur.lastTag || 0), log: log.slice(-LOG_MAX) };
      const up = await safe(st.upload(mine, Buffer.from(JSON.stringify(out)), { contentType: 'application/json', upsert: true, cacheControl: '0' }));
      if (up.error) return J(500, { error: 'Could not record the session: ' + up.error.message });
      return J(200, { ok: true, seq, uid: me });
    }

    if (action === 'poll') {
      const seen = body.seen && typeof body.seen === 'object' ? body.seen : {}, sinceId = Math.max(0, Number(body.sinceId) || 0);
      const peers = [], seqs = {}, ids = new Set(), deleted = new Set();
      if (st) {
        const L = await safe(st.list(dir.replace(/\/$/, ''), { limit: 100 }));
        for (const f of (L.data || [])) {
          const uid = String(f.name || '').replace(/\.json$/, ''); if (!uid || uid === me) continue;
          const p = await readJson(dir + uid + '.json'); if (!p) continue;
          const live = Date.now() - (+p.at || 0) < STALE_MS;
          peers.push({ uid, name: txt(p.name, 60), lane: cleanLane(p.lane), tpl: txt(p.tpl, 40), at: +p.at || 0, lastTag: +p.lastTag || 0, live });
          const since = Number(seen[uid]) || 0; seqs[uid] = +p.seq || 0;
          (Array.isArray(p.log) ? p.log : []).forEach(c => { if (c.seq > since) { if (c.op === 'del') { deleted.add(c.id); ids.delete(c.id); } else if (!deleted.has(c.id)) ids.add(c.id); } });
        }
      }
      const rows = new Map();
      if (sinceId > 0) {
        const r = await safe(supabase.from('events').select('id, data').eq('game_id', gameId).gt('id', sinceId).order('id', { ascending: true }).range(0, ROWS_MAX - 1));
        (r.data || []).forEach(x => rows.set(x.id, x));
      }
      const want = [...ids].filter(id => !rows.has(id));
      for (let i = 0; i < want.length; i += 200) {
        const r = await safe(supabase.from('events').select('id, data').eq('game_id', gameId).in('id', want.slice(i, i + 200)));
        (r.data || []).forEach(x => rows.set(x.id, x));
      }
      let maxId = sinceId; rows.forEach((_, id) => { if (id > maxId) maxId = id; });
      return J(200, { ok: true, me, peers, rows: [...rows.values()], deleted: [...deleted], seqs, maxId });
    }
    return J(400, { error: 'action must be beat, poll or leave' });
  } catch (e) {
    return J(500, { error: e.message || String(e) });
  }
};
