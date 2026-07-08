/**
 * Netlify Function: gameAdmin — game-level admin writes (service role).
 *
 * WHY: the games/events tables have RLS that blocks anon browser writes, and
 * update/delete fail SILENTLY (0 rows, no error). So admin.html's roster
 * meta-save and the delete-game button appeared to work but never persisted —
 * critically, a "deleted" game was not actually deleted. These must go through
 * the service-role key, admin-authenticated, like processGame/editEvent.
 *
 *   POST /.netlify/functions/gameAdmin
 *   { action: 'updateMeta', gameId, meta }   -> updates games.meta
 *   { action: 'deleteGame', gameId }          -> deletes the game's events then the game row
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

    const { action, gameId, meta } = body;

    // ── Admin auth (Netlify Identity JWT) ────────────────────────────────
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Authentication required' }) };
    let decoded;
    try { decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf-8')); }
    catch (e) { return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token format' }) }; }
    if (decoded.app_metadata?.roles?.[0] !== 'admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: admin role required' }) };
    }

    if (!gameId) return { statusCode: 400, body: JSON.stringify({ error: 'gameId is required' }) };

    if (action === 'updateMeta') {
      if (!meta || typeof meta !== 'object') {
        return { statusCode: 400, body: JSON.stringify({ error: 'updateMeta needs a meta object' }) };
      }
      const { error } = await supabase.from('games').update({ meta }).eq('id', gameId);
      if (error) throw new Error(error.message);
      return { statusCode: 200, body: JSON.stringify({ ok: true, gameId }) };
    }

    if (action === 'deleteGame') {
      // Events first (FK), then the game row.
      const { error: evErr } = await supabase.from('events').delete().eq('game_id', gameId);
      if (evErr) throw new Error('Failed to delete events: ' + evErr.message);
      const { error: gErr } = await supabase.from('games').delete().eq('id', gameId);
      if (gErr) throw new Error('Failed to delete game: ' + gErr.message);
      return { statusCode: 200, body: JSON.stringify({ ok: true, gameId }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'action must be updateMeta or deleteGame' }) };

  } catch (error) {
    console.error('gameAdmin error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Internal server error' }) };
  }
};
