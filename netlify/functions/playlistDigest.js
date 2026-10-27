/**
 * Netlify SCHEDULED function: playlistDigest — sends the queued playlist notification emails as a DIGEST.
 * Scheduled in netlify.toml (every 5 minutes). It is never called by a page.
 *
 * playlists.js queues one row in playlist_notify per recipient per event (a comment on your playlist; a playlist
 * shared with you; an @mention of you in a comment — kind 'mention'). This function batches them so a burst of comments never spams anyone:
 *   · at most ONE email per recipient per PLAYLIST_DIGEST_MINUTES (default 15), covering every playlist;
 *   · a recipient's batch waits until it has been quiet for 2 minutes (a burst lands in one email), or until its
 *     oldest item is PLAYLIST_DIGEST_MINUTES old, whichever comes first;
 *   · items older than 24 hours are dropped ('expired'), so a backlog never arrives late;
 *   · the opt-out (playlist_prefs.email_opt_out) is checked again at send time;
 *   · with no EMAIL_API_KEY / EMAIL_FROM set, nothing is sent: pending items are marked 'skipped' and one line is logged.
 *
 * Status of a playlist_notify row: pending → sent | skipped | expired | opted-out | failed.
 */
const { createClient } = require('@supabase/supabase-js');
const notify = require('../lib/notify');

const SETTLE_MS = 2 * 60 * 1000, EXPIRE_MS = 24 * 3600 * 1000;
const windowMs = () => Math.max(1, Number(process.env.PLAYLIST_DIGEST_MINUTES) || 15) * 60 * 1000;
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const siteUrl = () => String(process.env.SITE_URL || process.env.URL || '').replace(/\/$/, '');

let SB = null;
const db = () => SB || (SB = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY));

function compose(recipient, rows) {
  const byPl = new Map();
  rows.forEach(r => { const k = String(r.playlist_id); if (!byPl.has(k)) byPl.set(k, { id: r.playlist_id, name: r.playlist_name, items: [] }); byPl.get(k).items.push(r); });
  const pls = [...byPl.values()], base = siteUrl();
  const link = p => (base ? base : '') + '/playlists.html?pl=' + encodeURIComponent(p.id);
  const nComments = rows.filter(r => r.kind === 'comment').length, nShares = rows.filter(r => r.kind === 'share').length, nMentions = rows.filter(r => r.kind === 'mention').length;
  const subject = 'COHESION playlists — ' + [nMentions ? nMentions + ' mention' + (nMentions === 1 ? '' : 's') + ' of you' : '', nComments ? nComments + ' new comment' + (nComments === 1 ? '' : 's') : '', nShares ? nShares + ' shared with you' : ''].filter(Boolean).join(', ');
  const lines = [], html = [];
  pls.forEach(p => {
    lines.push(p.name + '  ' + link(p));
    html.push('<h3 style="font-family:sans-serif;margin:16px 0 4px;"><a href="' + esc(link(p)) + '">' + esc(p.name) + '</a></h3><ul style="font-family:sans-serif;">');
    p.items.forEach(r => {
      const t = r.kind === 'share' ? r.actor_name + ' shared this playlist with you' : r.kind === 'mention' ? r.actor_name + ' mentioned you: "' + r.excerpt + '"' : r.actor_name + ': "' + r.excerpt + '"';
      lines.push('  - ' + t); html.push('<li>' + esc(t) + '</li>');
    });
    html.push('</ul>');
  });
  const foot = 'You get these because a playlist of yours was commented on or shared with you, or someone mentioned you. Turn them off on the Playlists page (Email me: off).';
  return { to: recipient, subject, text: lines.join('\n') + '\n\n' + foot, html: html.join('') + '<p style="font-family:sans-serif;color:#777;font-size:12px;">' + esc(foot) + '</p>' };
}

async function setStatus(ids, status, extra) {
  if (!ids.length) return;
  await db().from('playlist_notify').update(Object.assign({ status }, extra || {})).in('id', ids);
}

async function runDigest(opts) {
  const now = (opts && opts.now) || Date.now();
  const { data, error } = await db().from('playlist_notify').select('*').eq('status', 'pending').order('created_at');
  if (error) { console.log('[digest] playlist_notify not readable: ' + error.message); return { ok: false, error: error.message }; }
  const pending = data || [], out = { ok: true, sent: 0, skipped: 0, expired: 0, optedOut: 0, waiting: 0, failed: 0 };
  if (!pending.length) return out;
  const age = r => now - Date.parse(r.created_at || 0);
  const old = pending.filter(r => age(r) > EXPIRE_MS);
  await setStatus(old.map(r => r.id), 'expired'); out.expired = old.length;
  const live = pending.filter(r => age(r) <= EXPIRE_MS);
  if (!notify.enabled()) {
    console.log('[digest] EMAIL_API_KEY / EMAIL_FROM not set — ' + live.length + ' notification(s) not emailed');
    await setStatus(live.map(r => r.id), 'skipped'); out.skipped = live.length; return out;
  }
  const W = windowMs();
  const recent = await db().from('playlist_notify').select('*').eq('status', 'sent').gt('sent_at', new Date(now - W).toISOString());
  const sentLately = new Set(((recent && recent.data) || []).map(r => String(r.recipient).toLowerCase()));
  const byTo = new Map(); live.forEach(r => { const k = String(r.recipient).toLowerCase(); if (!byTo.has(k)) byTo.set(k, []); byTo.get(k).push(r); });
  const emails = [...byTo.keys()];
  const pr = emails.length ? await db().from('playlist_prefs').select('*').in('email', emails) : { data: [] };
  const optedOut = new Set(((pr && pr.data) || []).filter(x => x.email_opt_out).map(x => String(x.email).toLowerCase()));
  for (const [to, rows] of byTo) {
    if (optedOut.has(to)) { await setStatus(rows.map(r => r.id), 'opted-out'); out.optedOut += rows.length; continue; }
    const newest = Math.min(...rows.map(age)), oldest = Math.max(...rows.map(age));
    if (sentLately.has(to) || (newest < SETTLE_MS && oldest < W)) { out.waiting += rows.length; continue; }
    const res = await notify.sendEmail(compose(to, rows));
    if (res.sent) { await setStatus(rows.map(r => r.id), 'sent', { sent_at: new Date(now).toISOString() }); out.sent++; }
    else { await setStatus(rows.map(r => r.id), 'failed'); out.failed += rows.length; }
  }
  return out;
}

exports.handler = async () => {
  try { const r = await runDigest(); return { statusCode: 200, body: JSON.stringify(r) }; }
  catch (e) { console.error('playlistDigest error:', e); return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }
};
exports.runDigest = runDigest;
exports.compose = compose;
