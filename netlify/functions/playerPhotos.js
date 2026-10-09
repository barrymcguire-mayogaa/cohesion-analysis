/**
 * Netlify Function: playerPhotos — PRIVATE player photos (Supabase Storage, service role).
 *
 * Bucket "player-photos" is NOT public (supabase/player_photos_storage.sql): there is
 * no public URL for anything in it, and no anon / authenticated storage policy. The
 * only way to a photo is a short-lived SIGNED URL made here, and this function
 * answers verified Netlify Identity sessions only (netlify/lib/identity.js).
 *
 * Objects:  <teamKey>/<playerKey>-<stamp>.<jpg|png|webp>      one per player
 *           <teamKey>/_index.json                             that team's photo index
 * teamKey / playerKey = cohPhotoKey(name) (cohesion-photos.js): the Players-tab name
 * key (case, spaces, apostrophe style ignored) with accents folded and everything but
 * a-z 0-9 dropped. Paths are ALWAYS built here from the team and player NAMES — a
 * path, key or file name sent by the client is never used.
 * Index: { team:<name as entered>, updatedAt, players:{ <playerKey>:{ name, file, updatedAt, bytes } } }
 *
 *   POST /.netlify/functions/playerPhotos          (Authorization: Bearer <Identity JWT>)
 *   { action:'list', teams:[name,…] }                       any verified signed-in user
 *        -> { ok, expiresIn, teams:{ <teamKey>:{ name, players:{ <playerKey>:{ name, url, updatedAt } } } }, bucketMissing? }
 *        url = signed URL valid for expiresIn seconds. At most 12 teams per call; a
 *        non-admin only gets teams that play in a section (county / club) he can read.
 *        Never an error for a missing bucket / index: that team is just absent.
 *   { action:'upload', team, player, dataBase64, contentType }   admin
 *        -> { ok, teamKey, playerKey, photo:{ name, url, updatedAt } }
 *        JPEG / PNG / WebP only, checked by magic bytes; max 300 KB decoded (the admin
 *        page sends a 256×256 JPEG).
 *   { action:'delete', team, player }                            admin -> { ok, removed }
 *   { action:'rename', team, player, newPlayer, newTeam? }       admin -> { ok, teamKey, playerKey, photo }
 *        Moves the photo to another name (and/or team). 409 if the target already has one.
 */
const { verifiedClaims, UNAUTH } = require('../lib/identity');
const { cohPhotoKey } = require('../../cohesion-photos.js');

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'player-photos';
const INDEX = '_index.json';
const SIGN_SECONDS = 3600;                       // signed URL lifetime
const MAX_BYTES = 300000;                        // after base64 decode
const MAX_TEAMS = 12;                            // per list call
const MAX_PER_TEAM = 150;                        // signed per team per list call
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const SETUP_MSG = 'Player photo storage is not set up yet — run supabase/player_photos_storage.sql in the Supabase SQL editor, then try again.';

const json = (code, o) => ({ statusCode: code, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(o) });
const bad = (msg, code) => json(code || 400, { error: msg });

function isBucketMissing(error) {
  const m = String((error && error.message) || error || '');
  return /bucket not found/i.test(m) || (/bucket/i.test(m) && /not\s*found|does not exist/i.test(m));
}

// What the bytes actually are, whatever the client claimed.
function sniff(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const tidy = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 80);
const KEY_RE = /^[a-z0-9]{1,64}$/;
const FILE_RE = /^[a-z0-9]{1,64}-[a-z0-9]{1,16}\.(jpg|png|webp)$/;
// {name, key} or null — the key is derived here, from the name only.
function keyed(name) {
  const n = tidy(name), k = cohPhotoKey(n);
  return KEY_RE.test(k) ? { name: n, key: k } : null;
}

let bucketSeen = false;                         // the bucket has answered getBucket in this instance

// ── a team's index ───────────────────────────────────────────────────────
// -> { idx:{team, players}, bucketMissing }. A missing / unreadable index is rebuilt
// from that team's folder listing (names fall back to the key), so a lost index
// never hides or orphans uploaded photos.
async function loadIndex(teamKey) {
  const store = supabase.storage.from(BUCKET);
  try {
    const { data, error } = await store.download(teamKey + '/' + INDEX);
    if (!error && data) {
      const text = typeof data.text === 'function' ? await data.text() : String(data);
      const j = JSON.parse(text);
      if (j && j.players && typeof j.players === 'object') return { idx: { team: String(j.team || ''), players: j.players }, bucketMissing: false };
    } else if (error && isBucketMissing(error)) return { idx: { team: '', players: {} }, bucketMissing: true };
  } catch (_e) { /* fall through to the listing */ }

  // No index: is the bucket there at all? (asked once per warm instance)
  if (!bucketSeen) {
    const { error: bErr } = await supabase.storage.getBucket(BUCKET);
    if (bErr) return { idx: { team: '', players: {} }, bucketMissing: true };
    bucketSeen = true;
  }
  const players = {};
  const { data: files, error: lErr } = await store.list(teamKey, { limit: 1000 });
  if (lErr) return { idx: { team: '', players }, bucketMissing: isBucketMissing(lErr) };
  for (const f of files || []) {
    const m = /^([a-z0-9]{1,64})-[a-z0-9]{1,16}\.(jpg|png|webp)$/.exec(f.name || '');
    if (!m) continue;
    const at = f.updated_at || f.created_at || null;
    if (!players[m[1]] || String(at || '') > String(players[m[1]].updatedAt || '')) players[m[1]] = { name: m[1], file: f.name, updatedAt: at };
  }
  return { idx: { team: '', players }, bucketMissing: false };
}

async function saveIndex(teamKey, idx) {
  const body = Buffer.from(JSON.stringify({ team: idx.team || '', updatedAt: new Date().toISOString(), players: idx.players }));
  const { error } = await supabase.storage.from(BUCKET)
    .upload(teamKey + '/' + INDEX, body, { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (error) throw new Error('Photo index could not be saved: ' + error.message);
}

// Only ever a file name this function could have written, inside that team's folder.
const pathOf = (teamKey, e) => (e && typeof e.file === 'string' && FILE_RE.test(e.file)) ? teamKey + '/' + e.file : null;

async function signOne(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGN_SECONDS);
  if (error || !data || !data.signedUrl) throw new Error('Photo saved, but its link could not be made: ' + ((error && error.message) || 'no URL'));
  return data.signedUrl;
}

// ── county / club wall: the team keys a non-admin may see photos for ─────
function allowedSections(roles) {            // = netlify/functions/data.js
  if (roles.includes('admin')) return ['county', 'club'];
  const hasClub = roles.includes('club');
  const hasOther = roles.some(r => r !== 'club');
  if (hasClub && !hasOther) return ['club'];
  if (hasClub) return ['county', 'club'];
  return ['county'];
}
async function visibleTeamKeys(roles) {
  const allowed = allowedSections(roles);
  const { data, error } = await supabase.from('games').select('meta');
  if (error) throw new Error(error.message);
  const keys = new Set();
  for (const r of data || []) {
    let m = r && r.meta;
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_e) { m = null; } }
    if (!m || !allowed.includes(m.section === 'club' ? 'club' : 'county')) continue;
    for (const n of [m.homeTeam, m.awayTeam]) { const k = cohPhotoKey(n); if (k) keys.add(k); }
  }
  return keys;
}

async function listAction(body, roles, isAdmin) {
  const out = { ok: true, expiresIn: SIGN_SECONDS, teams: {} };
  const names = Array.isArray(body.teams) ? body.teams : (body.team != null ? [body.team] : []);
  if (names.length > MAX_TEAMS) return bad('At most ' + MAX_TEAMS + ' teams per request');
  const want = [], seen = new Set();
  for (const n of names) { const t = keyed(n); if (t && !seen.has(t.key)) { seen.add(t.key); want.push(t); } }
  if (!want.length) return json(200, out);

  let visible = null;
  if (!isAdmin) {
    try { visible = await visibleTeamKeys(roles); }
    catch (e) { console.error('playerPhotos list (sections):', e); return json(200, out); }   // cannot tell -> show nothing
  }
  const teams = want.filter(t => !visible || visible.has(t.key));

  const loaded = await Promise.all(teams.map(t => loadIndex(t.key).catch(() => ({ idx: { team: '', players: {} }, bucketMissing: false }))));
  const paths = [], owner = {};
  teams.forEach((t, i) => {
    if (loaded[i].bucketMissing) out.bucketMissing = true;
    const players = loaded[i].idx.players || {};
    Object.keys(players).filter(k => KEY_RE.test(k)).sort().slice(0, MAX_PER_TEAM).forEach(pk => {
      const p = pathOf(t.key, players[pk]);
      if (p && !owner[p]) { owner[p] = { t, pk, e: players[pk], team: loaded[i].idx.team }; paths.push(p); }
    });
  });
  if (!paths.length) return json(200, out);

  // One batch call signs every photo of every requested team.
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGN_SECONDS);
  if (error) {
    if (isBucketMissing(error)) out.bucketMissing = true;
    else console.error('playerPhotos sign error:', error);
    return json(200, out);                                  // pages keep their initials
  }
  for (const s of data || []) {
    const o = s && owner[s.path];
    if (!o || s.error || typeof s.signedUrl !== 'string' || !s.signedUrl) continue;   // gone from the bucket: not listed
    const T = out.teams[o.t.key] || (out.teams[o.t.key] = { name: o.team || o.t.name, players: {} });
    T.players[o.pk] = { name: String(o.e.name || o.pk), url: s.signedUrl, updatedAt: o.e.updatedAt || null };
  }
  return json(200, out);
}

async function uploadAction(body) {
  const team = keyed(body.team), player = keyed(body.player);
  if (!team) return bad('A team name (with at least one letter or number) is required');
  if (!player) return bad('A player name (with at least one letter or number) is required');

  const declared = String(body.contentType || '').toLowerCase().split(';')[0].trim();
  if (!TYPES[declared]) return bad('Unsupported image type — upload a JPEG, PNG or WebP', 415);

  let b64 = body.dataBase64;
  if (typeof b64 !== 'string' || !b64) return bad('dataBase64 is required');
  b64 = b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (b64.length * 3 / 4 > MAX_BYTES + 3) return bad('Photo is too large (limit 300 KB)', 413);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return bad('dataBase64 is not valid base64');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return bad('Photo is empty');
  if (buf.length > MAX_BYTES) return bad('Photo is too large (limit 300 KB)', 413);

  const actual = sniff(buf);
  if (!actual || actual !== declared) return bad('File content is not a valid ' + declared.replace('image/', '').toUpperCase() + ' image', 415);

  const store = supabase.storage.from(BUCKET);
  const updatedAt = new Date().toISOString();
  const file = player.key + '-' + Date.now().toString(36) + '.' + TYPES[actual];
  const path = team.key + '/' + file;
  const { error: upErr } = await store.upload(path, buf, { contentType: actual, upsert: true, cacheControl: '3600' });
  if (upErr) {
    if (isBucketMissing(upErr)) return json(424, { error: SETUP_MSG });
    throw new Error('Upload failed: ' + upErr.message);
  }
  const { idx } = await loadIndex(team.key);
  const old = pathOf(team.key, idx.players[player.key]);
  idx.team = idx.team || team.name;
  idx.players[player.key] = { name: player.name, file, updatedAt, bytes: buf.length };
  await saveIndex(team.key, idx);
  // One photo per player: the replaced file goes, so links to it stop working at once.
  if (old && old !== path) { try { await store.remove([old]); } catch (_e) {} }
  const url = await signOne(path);
  return json(200, { ok: true, expiresIn: SIGN_SECONDS, teamKey: team.key, playerKey: player.key, photo: { name: player.name, url, updatedAt } });
}

async function deleteAction(body) {
  const team = keyed(body.team), player = keyed(body.player);
  if (!team || !player) return bad('team and player are required');
  const store = supabase.storage.from(BUCKET);
  const { idx, bucketMissing } = await loadIndex(team.key);
  if (bucketMissing) return json(424, { error: SETUP_MSG });
  const path = pathOf(team.key, idx.players[player.key]);
  let removed = 0;
  if (path) {
    const { data: gone, error } = await store.remove([path]);
    if (error) {
      if (isBucketMissing(error)) return json(424, { error: SETUP_MSG });
      throw new Error('Delete failed: ' + error.message);
    }
    removed = (gone || []).length;
  }
  if (idx.players[player.key]) { delete idx.players[player.key]; await saveIndex(team.key, idx); }
  return json(200, { ok: true, teamKey: team.key, playerKey: player.key, removed });
}

async function renameAction(body) {
  const team = keyed(body.team), player = keyed(body.player), to = keyed(body.newPlayer);
  const toTeam = body.newTeam != null && String(body.newTeam).trim() ? keyed(body.newTeam) : team;
  if (!team || !player) return bad('team and player are required');
  if (!to) return bad('newPlayer (with at least one letter or number) is required');
  if (!toTeam) return bad('newTeam is not a usable team name');
  const store = supabase.storage.from(BUCKET);
  const { idx, bucketMissing } = await loadIndex(team.key);
  if (bucketMissing) return json(424, { error: SETUP_MSG });
  const cur = idx.players[player.key], from = pathOf(team.key, cur);
  if (!cur || !from) return bad('That player has no photo', 404);

  const sameTeam = toTeam.key === team.key;
  if (sameTeam && to.key === player.key) {                 // only the spelling shown changes
    cur.name = to.name; await saveIndex(team.key, idx);
    return json(200, { ok: true, expiresIn: SIGN_SECONDS, teamKey: team.key, playerKey: to.key, photo: { name: to.name, url: await signOne(from), updatedAt: cur.updatedAt || null } });
  }
  const dest = sameTeam ? idx : (await loadIndex(toTeam.key)).idx;
  if (dest.players[to.key]) return bad('"' + to.name + '" already has a photo — remove it first', 409);

  const ext = /\.(jpg|png|webp)$/.exec(cur.file)[1];
  const file = to.key + '-' + Date.now().toString(36) + '.' + ext;
  const path = toTeam.key + '/' + file;
  const { error: mvErr } = await store.move(from, path);
  if (mvErr) throw new Error('Rename failed: ' + mvErr.message);
  const updatedAt = new Date().toISOString();
  dest.team = dest.team || toTeam.name;
  dest.players[to.key] = { name: to.name, file, updatedAt, bytes: cur.bytes };
  delete idx.players[player.key];
  if (!sameTeam) await saveIndex(toTeam.key, dest);
  await saveIndex(team.key, idx);
  return json(200, { ok: true, expiresIn: SIGN_SECONDS, teamKey: toTeam.key, playerKey: to.key, photo: { name: to.name, url: await signOne(path), updatedAt } });
}

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') return bad('Method not allowed', 405);

    // ── Auth FIRST (Netlify Identity JWT, verified by Netlify — never decoded here) ──
    const token = ((event.headers && (event.headers.authorization || event.headers.Authorization)) || '').replace('Bearer ', '');
    if (!token) return json(401, { error: 'Authentication required' });
    const decoded = verifiedClaims(context);
    if (!decoded) return json(UNAUTH.statusCode, JSON.parse(UNAUTH.body));
    const roles = ((decoded.app_metadata && decoded.app_metadata.roles) || []).map(r => String(r).toLowerCase());
    const isAdmin = roles.includes('admin');

    let body;
    try { body = JSON.parse(event.body); }
    catch (e) { return bad('Invalid JSON body'); }
    if (!body || typeof body !== 'object') return bad('Invalid JSON body');
    const { action } = body;

    if (action === 'list') {
      try { return await listAction(body, roles, isAdmin); }
      catch (e) {
        console.error('playerPhotos list error:', e);
        return json(200, { ok: true, expiresIn: SIGN_SECONDS, teams: {}, warning: 'unavailable' });   // pages keep their initials
      }
    }
    if (action !== 'upload' && action !== 'delete' && action !== 'rename') return bad('action must be list, upload, delete or rename');
    if (!isAdmin) return json(403, { error: 'Forbidden: admin role required' });

    if (action === 'upload') return await uploadAction(body);
    if (action === 'delete') return await deleteAction(body);
    return await renameAction(body);

  } catch (error) {
    console.error('playerPhotos error:', error);
    if (isBucketMissing(error)) return json(424, { error: SETUP_MSG });
    return json(500, { error: error.message || 'Internal server error' });
  }
};
