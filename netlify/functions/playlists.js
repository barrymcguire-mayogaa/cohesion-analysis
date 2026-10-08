/**
 * Netlify Function: playlists — clip-playlist storage (service role).
 *
 * A playlist is a named, ordered list of video clips (one per event segment,
 * possibly spanning several games). Viewers READ them via the anon key (a
 * SELECT policy exists so players/coaches can watch); all WRITES go through
 * this function (admin JWT required), so playlists live in the club's
 * database and only analysts can create or edit them.
 *
 *   POST /.netlify/functions/playlists
 *   { action:'list' }                                   -> club + caller's personal playlists
 *   { action:'save', name, scope, data, id? }           -> insert (no id) or update own/club
 *   { action:'delete', id }                             -> delete a club or own personal playlist
 *   { action:'append', id, items:[clip…] }              -> add clips to an existing playlist in ONE write,
 *                                                          skipping clips it already holds -> { added, skipped, total }
 *                                                          (admin only, same owner / section rules as an update)
 *
 * scope: 'club' (any admin can use/edit) | 'personal' (owner = caller email).
 */
const { verifiedClaims, UNAUTH } = require('../lib/identity');


const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── clips (the dashboard's dashClipOf shape) ────────────────────────────
const MAX_APPEND = 200;
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

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    let body;
    try { body = JSON.parse(event.body); }
    catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

    // ── Admin auth (Netlify Identity JWT) ────────────────────────────────
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Authentication required' }) };
    let decoded;
    decoded = verifiedClaims(context);
    if (!decoded) return UNAUTH;
    const roles = ((decoded.app_metadata && decoded.app_metadata.roles) || []).map(r => String(r).toLowerCase());
    const isAdmin = roles.includes('admin');
    // County/Club SECTION access (distinct from a playlist's club-wide/personal
    // "scope"): admin → both; CLUB as only role → club; CLUB+other → both; else county.
    const hasClubRole = roles.includes('club');
    const hasOther = roles.some(r => r !== 'club');
    const allowedSections = isAdmin ? ['county','club']
      : (hasClubRole && !hasOther) ? ['club']
      : hasClubRole ? ['county','club'] : ['county'];
    const sectionOf = d => (d && d.section) === 'club' ? 'club' : 'county';
    const email = (decoded.email || '').toLowerCase();
    const author = (decoded.user_metadata && decoded.user_metadata.full_name) || email.split('@')[0] || 'user';

    const { action } = body;
    const COMMENT_ACTIONS = ['comment', 'commentEdit', 'commentDelete'];
    const MEMBER_ACTIONS = ['list', ...COMMENT_ACTIONS];   // any signed-in member
    if (!isAdmin && !MEMBER_ACTIONS.includes(action)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: admin role required' }) };
    }

    // ── comments: any signed-in club member; authorship enforced here ──
    if (COMMENT_ACTIONS.includes(action)) {
      const { id, clipIdx } = body;
      if (id == null || clipIdx == null) return { statusCode: 400, body: JSON.stringify({ error: 'id and clipIdx are required' }) };
      const { data: row, error: rErr } = await supabase.from('playlists').select('id, scope, owner, data').eq('id', id).single();
      if (rErr) throw new Error(rErr.message);
      if (!allowedSections.includes(sectionOf(row.data))) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: no access to this section' }) };
      }
      if (row.scope === 'personal' && row.owner !== email && !isAdmin) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Not your playlist' }) };
      }
      const data = row.data || {}; const items = Array.isArray(data.items) ? data.items : [];
      const it = items[clipIdx];
      if (!it) return { statusCode: 400, body: JSON.stringify({ error: 'No clip at that position — the playlist may have changed. Reload and retry.' }) };
      it.comments = Array.isArray(it.comments) ? it.comments : [];

      if (action === 'comment') {
        const text = String(body.text || '').trim().slice(0, 1000);
        if (!text) return { statusCode: 400, body: JSON.stringify({ error: 'Empty comment' }) };
        const cmObj = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), author, email, text, ts: new Date().toISOString() };
        // optional pin: video-second the comment was left at (playback pauses there)
        const t = Number(body.t);
        if (Number.isFinite(t) && t >= 0) {
          cmObj.t = Math.round(t * 10) / 10;
          if (typeof body.vid === 'string' && body.vid) cmObj.vid = body.vid.slice(0, 20);
        }
        it.comments.push(cmObj);
      } else {
        const cm = it.comments.find(x => x.id === body.commentId);
        if (!cm) return { statusCode: 400, body: JSON.stringify({ error: 'Comment not found' }) };
        if (cm.email !== email && !isAdmin) return { statusCode: 403, body: JSON.stringify({ error: 'Not your comment' }) };
        if (action === 'commentEdit') {
          const text = String(body.text || '').trim().slice(0, 1000);
          if (!text) return { statusCode: 400, body: JSON.stringify({ error: 'Empty comment' }) };
          cm.text = text; cm.edited = true;
        } else {
          it.comments = it.comments.filter(x => x.id !== body.commentId);
        }
      }
      const { error: uErr } = await supabase.from('playlists').update({ data }).eq('id', id);
      if (uErr) throw new Error(uErr.message);
      return { statusCode: 200, body: JSON.stringify({ ok: true, comments: it.comments }) };
    }

    if (action === 'list') {
      let want = body.section || null;
      if (want && !allowedSections.includes(want)) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: no access to that section' }) };
      }
      const { data, error } = await supabase.from('playlists')
        .select('id, scope, owner, name, data, created_at')
        .or(`scope.eq.club,and(scope.eq.personal,owner.eq.${email})`)
        .order('name');
      if (error) throw new Error(error.message);
      const rows = (data || []).filter(p =>
        want ? sectionOf(p.data) === want : allowedSections.includes(sectionOf(p.data)));
      return { statusCode: 200, body: JSON.stringify({ ok: true, playlists: rows, sections: allowedSections }) };
    }

    if (action === 'save') {
      const { id, name, scope, data } = body;
      if (!name || typeof name !== 'string') return { statusCode: 400, body: JSON.stringify({ error: 'name is required' }) };
      if (scope !== 'club' && scope !== 'personal') return { statusCode: 400, body: JSON.stringify({ error: "scope must be 'club' or 'personal'" }) };
      if (!data || typeof data !== 'object') return { statusCode: 400, body: JSON.stringify({ error: 'data object is required' }) };
      // SECTION: stamped at creation from the caller's context; updates keep
      // the stored section so a playlist can never drift across the wall.
      const reqSection = (body.section === 'club') ? 'club' : 'county';
      if (!allowedSections.includes(reqSection)) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: no access to that section' }) };
      }
      const row = { name: name.trim().slice(0, 80), scope, owner: scope === 'personal' ? email : '', data };
      if (id) {
        // Only the owner may update a personal template; club is open to admins.
        const { data: existing, error: exErr } = await supabase.from('playlists').select('scope, owner, data').eq('id', id).single();
        if (exErr) throw new Error(exErr.message);
        if (existing.scope === 'personal' && existing.owner !== email) {
          return { statusCode: 403, body: JSON.stringify({ error: 'Not your template' }) };
        }
        if (!allowedSections.includes(sectionOf(existing.data))) {
          return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: no access to this section' }) };
        }
        row.data.section = sectionOf(existing.data);     // updates preserve the stored section
        const { error } = await supabase.from('playlists').update(row).eq('id', id);
        if (error) throw new Error(error.message);
        return { statusCode: 200, body: JSON.stringify({ ok: true, id }) };
      }
      row.data.section = reqSection;
      const { data: ins, error } = await supabase.from('playlists').insert(row).select('id').single();
      if (error) throw new Error(error.message);
      return { statusCode: 200, body: JSON.stringify({ ok: true, id: ins.id }) };
    }

    // ── append: add a batch of clips to an existing playlist, without duplicates ──
    // Admin only (the gate above); same owner and section rules as updating it via 'save'.
    if (action === 'append') {
      const { id } = body;
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'id is required' }) };
      if (!Array.isArray(body.items) || !body.items.length) return { statusCode: 400, body: JSON.stringify({ error: 'items must be a non-empty array' }) };
      if (body.items.length > MAX_APPEND) return { statusCode: 400, body: JSON.stringify({ error: 'Too many clips in one request (max ' + MAX_APPEND + ')' }) };
      const clean = body.items.map(cleanClip);
      if (clean.some(c => !c)) return { statusCode: 400, body: JSON.stringify({ error: 'Every clip needs a videoId, a gameId and start / end times' }) };
      const { data: existing, error: exErr } = await supabase.from('playlists').select('id, name, scope, owner, data').eq('id', id).single();
      if (exErr) throw new Error(exErr.message);
      if (existing.scope === 'personal' && existing.owner !== email) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Not your template' }) };
      }
      if (!allowedSections.includes(sectionOf(existing.data))) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: no access to this section' }) };
      }
      const data = (existing.data && typeof existing.data === 'object') ? existing.data : {};
      const items = Array.isArray(data.items) ? data.items : [];
      const seen = new Set(); items.forEach(it => clipKeys(it).forEach(k => seen.add(k)));
      let added = 0, skipped = 0;
      for (const c of clean) {
        const keys = clipKeys(c);
        if (keys.some(k => seen.has(k))) { skipped++; continue; }
        keys.forEach(k => seen.add(k)); items.push(c); added++;
      }
      if (added) {
        data.items = items; data.section = sectionOf(existing.data);   // the stored section never changes
        const { error } = await supabase.from('playlists').update({ data }).eq('id', id);
        if (error) throw new Error(error.message);
      }
      return { statusCode: 200, body: JSON.stringify({ ok: true, id, name: existing.name, added, skipped, total: items.length }) };
    }

    if (action === 'delete') {
      const { id } = body;
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'id is required' }) };
      const { data: existing, error: exErr } = await supabase.from('playlists').select('scope, owner').eq('id', id).single();
      if (exErr) throw new Error(exErr.message);
      if (existing.scope === 'personal' && existing.owner !== email) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Not your template' }) };
      }
      const { error } = await supabase.from('playlists').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'action must be list, save, append or delete' }) };

  } catch (error) {
    console.error('playlists error:', error);
    const missing = /relation .*playlists.* does not exist/i.test(error.message || '');
    return { statusCode: missing ? 424 : 500, body: JSON.stringify({ error: missing ? 'Templates table not created yet — run the setup SQL in Supabase.' : (error.message || 'Internal server error') }) };
  }
};
