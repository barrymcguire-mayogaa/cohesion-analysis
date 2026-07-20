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
 *
 * scope: 'club' (any admin can use/edit) | 'personal' (owner = caller email).
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
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
    try { decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf-8')); }
    catch (e) { return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token format' }) }; }
    const isAdmin = decoded.app_metadata?.roles?.[0] === 'admin';
    const email = (decoded.email || '').toLowerCase();
    const author = (decoded.user_metadata && decoded.user_metadata.full_name) || email.split('@')[0] || 'user';

    const { action } = body;
    const COMMENT_ACTIONS = ['comment', 'commentEdit', 'commentDelete'];
    if (!isAdmin && !COMMENT_ACTIONS.includes(action)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: admin role required' }) };
    }

    // ── comments: any signed-in club member; authorship enforced here ──
    if (COMMENT_ACTIONS.includes(action)) {
      const { id, clipIdx } = body;
      if (id == null || clipIdx == null) return { statusCode: 400, body: JSON.stringify({ error: 'id and clipIdx are required' }) };
      const { data: row, error: rErr } = await supabase.from('playlists').select('id, scope, owner, data').eq('id', id).single();
      if (rErr) throw new Error(rErr.message);
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
      const { data, error } = await supabase.from('playlists')
        .select('id, scope, owner, name, data, created_at')
        .or(`scope.eq.club,and(scope.eq.personal,owner.eq.${email})`)
        .order('name');
      if (error) throw new Error(error.message);
      return { statusCode: 200, body: JSON.stringify({ ok: true, playlists: data || [] }) };
    }

    if (action === 'save') {
      const { id, name, scope, data } = body;
      if (!name || typeof name !== 'string') return { statusCode: 400, body: JSON.stringify({ error: 'name is required' }) };
      if (scope !== 'club' && scope !== 'personal') return { statusCode: 400, body: JSON.stringify({ error: "scope must be 'club' or 'personal'" }) };
      if (!data || typeof data !== 'object') return { statusCode: 400, body: JSON.stringify({ error: 'data object is required' }) };
      const row = { name: name.trim().slice(0, 80), scope, owner: scope === 'personal' ? email : '', data };
      if (id) {
        // Only the owner may update a personal template; club is open to admins.
        const { data: existing, error: exErr } = await supabase.from('playlists').select('scope, owner').eq('id', id).single();
        if (exErr) throw new Error(exErr.message);
        if (existing.scope === 'personal' && existing.owner !== email) {
          return { statusCode: 403, body: JSON.stringify({ error: 'Not your template' }) };
        }
        const { error } = await supabase.from('playlists').update(row).eq('id', id);
        if (error) throw new Error(error.message);
        return { statusCode: 200, body: JSON.stringify({ ok: true, id }) };
      }
      const { data: ins, error } = await supabase.from('playlists').insert(row).select('id').single();
      if (error) throw new Error(error.message);
      return { statusCode: 200, body: JSON.stringify({ ok: true, id: ins.id }) };
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

    return { statusCode: 400, body: JSON.stringify({ error: 'action must be list, save or delete' }) };

  } catch (error) {
    console.error('playlists error:', error);
    const missing = /relation .*playlists.* does not exist/i.test(error.message || '');
    return { statusCode: missing ? 424 : 500, body: JSON.stringify({ error: missing ? 'Templates table not created yet — run the setup SQL in Supabase.' : (error.message || 'Internal server error') }) };
  }
};
