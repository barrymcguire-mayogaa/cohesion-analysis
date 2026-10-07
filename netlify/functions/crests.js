/**
 * Netlify Function: crests — uploaded club/county crests (Supabase Storage, service role).
 *
 * Bucket "crests" (public read — see supabase/crests_storage.sql). Browsers can
 * never write to it; every write comes through here, admin-authenticated.
 * Objects are <slug>.png (slug rule shared with the pages: cohesion-crests.js),
 * plus a _index.json manifest so pages get the whole crest list in ONE request.
 *
 *   POST /.netlify/functions/crests
 *   { action:'list' }                                   any verified user
 *        -> { ok, crests:[{slug, name, url, updatedAt}], bucketMissing? }
 *        Never an error for a missing bucket/manifest: crests is just [].
 *   { action:'upload', name, dataBase64, contentType }  admin
 *        -> { ok, crest:{slug, name, url, updatedAt} }   PNG / JPEG / WebP only (no SVG),
 *        max 1.5 MB decoded, content sniffed (the declared type must match the bytes).
 *   { action:'delete', slug }                           admin
 *        -> { ok, slug, removed }
 */
const { verifiedClaims, UNAUTH } = require('../lib/identity');
const { cohCrestSlug } = require('../../cohesion-crests.js');

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'crests';
const MANIFEST = '_index.json';
const MAX_BYTES = 1500000;                       // after base64 decode
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const EXTS = ['png', 'jpg', 'webp'];
const SETUP_MSG = 'Crest storage is not set up yet — run supabase/crests_storage.sql in the Supabase SQL editor, then try again.';

const json = (code, o) => ({ statusCode: code, body: JSON.stringify(o) });
const bad = (msg, code) => json(code || 400, { error: msg });

function isBucketMissing(error) {
  const m = String((error && error.message) || error || '');
  return /bucket not found/i.test(m) || (/bucket/i.test(m) && /not\s*found|does not exist/i.test(m));
}

function publicUrl(file, updatedAt) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const v = updatedAt ? ('?v=' + (Date.parse(updatedAt) || 0)) : '';
  return base + '/storage/v1/object/public/' + BUCKET + '/' + file + v;
}

// What the bytes actually are, whatever the client claimed.
function sniff(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Manifest: { crests: { <slug>: { name, file, updatedAt } } }.
// If it is missing or unreadable, rebuild from the bucket listing (names fall
// back to the slug) so a lost manifest never hides or orphans uploaded crests.
async function loadEntries() {
  const store = supabase.storage.from(BUCKET);
  try {
    const { data, error } = await store.download(MANIFEST);
    if (!error && data) {
      const text = typeof data.text === 'function' ? await data.text() : String(data);
      const j = JSON.parse(text);
      if (j && j.crests && typeof j.crests === 'object') return { entries: j.crests, bucketMissing: false };
    }
  } catch (_e) { /* fall through to the listing */ }

  const { error: bErr } = await supabase.storage.getBucket(BUCKET);
  if (bErr) return { entries: {}, bucketMissing: true };

  const entries = {};
  const { data: files, error: lErr } = await store.list('', { limit: 1000 });
  if (lErr) return { entries, bucketMissing: isBucketMissing(lErr) };
  for (const f of files || []) {
    const m = /^([a-z0-9]+)\.(png|jpg|webp)$/.exec(f.name || '');
    if (!m) continue;
    entries[m[1]] = { name: m[1], file: f.name, updatedAt: f.updated_at || f.created_at || null };
  }
  return { entries, bucketMissing: false };
}

async function saveEntries(entries) {
  const body = Buffer.from(JSON.stringify({ updatedAt: new Date().toISOString(), crests: entries }));
  const { error } = await supabase.storage.from(BUCKET)
    .upload(MANIFEST, body, { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (error) throw new Error('Crest index could not be saved: ' + error.message);
}

function toList(entries) {
  return Object.keys(entries).sort().map(slug => {
    const e = entries[slug] || {};
    const file = e.file || (slug + '.png');
    return { slug, name: e.name || slug, url: publicUrl(file, e.updatedAt), updatedAt: e.updatedAt || null };
  });
}

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') return bad('Method not allowed', 405);

    let body;
    try { body = JSON.parse(event.body); }
    catch (e) { return bad('Invalid JSON body'); }
    if (!body || typeof body !== 'object') return bad('Invalid JSON body');

    // ── Auth (Netlify Identity JWT, verified by Netlify — never decoded here) ──
    const token = ((event.headers && event.headers.authorization) || '').replace('Bearer ', '');
    if (!token) return json(401, { error: 'Authentication required' });
    const decoded = verifiedClaims(context);
    if (!decoded) return UNAUTH;
    const roles = ((decoded.app_metadata && decoded.app_metadata.roles) || []).map(r => String(r).toLowerCase());
    const isAdmin = roles.includes('admin');

    const { action } = body;

    if (action === 'list') {
      try {
        const { entries, bucketMissing } = await loadEntries();
        const out = { ok: true, crests: toList(entries) };
        if (bucketMissing) out.bucketMissing = true;
        return json(200, out);
      } catch (e) {
        console.error('crests list error:', e);
        return json(200, { ok: true, crests: [], warning: String((e && e.message) || e) });   // pages fall back to bundled crests
      }
    }

    if (action !== 'upload' && action !== 'delete') return bad('action must be list, upload or delete');
    if (!isAdmin) return json(403, { error: 'Forbidden: admin role required' });

    if (action === 'upload') {
      const name = String(body.name == null ? '' : body.name).replace(/\s+/g, ' ').trim().slice(0, 80);
      const slug = cohCrestSlug(name);
      if (!slug) return bad('A team name (with at least one letter or number) is required');
      if (slug.length > 64) return bad('Team name is too long');

      const declared = String(body.contentType || '').toLowerCase().split(';')[0].trim();
      if (/svg/.test(declared)) return bad('SVG crests are not accepted — upload a PNG, JPEG or WebP', 415);
      if (!TYPES[declared]) return bad('Unsupported image type — upload a PNG, JPEG or WebP', 415);

      let b64 = body.dataBase64;
      if (typeof b64 !== 'string' || !b64) return bad('dataBase64 is required');
      b64 = b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
      if (b64.length * 3 / 4 > MAX_BYTES + 3) return bad('Image is too large (limit 1.5 MB)', 413);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return bad('dataBase64 is not valid base64');
      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) return bad('Image is empty');
      if (buf.length > MAX_BYTES) return bad('Image is too large (limit 1.5 MB)', 413);

      const actual = sniff(buf);
      if (!actual || actual !== declared) return bad('File content is not a valid ' + declared.replace('image/', '').toUpperCase() + ' image', 415);

      const file = slug + '.' + TYPES[actual];
      const store = supabase.storage.from(BUCKET);
      const { error: upErr } = await store.upload(file, buf, { contentType: actual, upsert: true, cacheControl: '86400' });
      if (upErr) {
        if (isBucketMissing(upErr)) return json(424, { error: SETUP_MSG });
        throw new Error('Upload failed: ' + upErr.message);
      }
      // One crest per slug: drop an older copy saved under another extension.
      const stale = EXTS.map(x => slug + '.' + x).filter(f => f !== file);
      try { await store.remove(stale); } catch (_e) {}

      const { entries } = await loadEntries();
      const updatedAt = new Date().toISOString();
      entries[slug] = { name, file, updatedAt };
      await saveEntries(entries);
      return json(200, { ok: true, crest: { slug, name, url: publicUrl(file, updatedAt), updatedAt } });
    }

    // delete
    const slug = String(body.slug || '');
    if (!/^[a-z0-9]{1,64}$/.test(slug)) return bad('slug is required');
    const store = supabase.storage.from(BUCKET);
    const { data: gone, error: rmErr } = await store.remove(EXTS.map(x => slug + '.' + x));
    if (rmErr) {
      if (isBucketMissing(rmErr)) return json(424, { error: SETUP_MSG });
      throw new Error('Delete failed: ' + rmErr.message);
    }
    const { entries, bucketMissing } = await loadEntries();
    if (bucketMissing) return json(424, { error: SETUP_MSG });
    delete entries[slug];
    await saveEntries(entries);
    return json(200, { ok: true, slug, removed: (gone || []).length });

  } catch (error) {
    console.error('crests error:', error);
    if (isBucketMissing(error)) return json(424, { error: SETUP_MSG });
    return json(500, { error: error.message || 'Internal server error' });
  }
};
