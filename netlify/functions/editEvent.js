/**
 * Netlify Function: editEvent — single-event writes (update / insert / delete)
 *
 * WHY THIS EXISTS: the events table has RLS enabled and blocks direct
 * browser writes with the anon key. Such writes fail SILENTLY on update
 * (0 rows changed, no error), so edits appeared to save on screen but never
 * persisted. All real writes must go through the service role key, which is
 * only available server-side. This mirrors processGame.js's auth model but
 * for one event at a time, so Code Room and the dashboard tagger can edit
 * events that actually persist.
 *
 *   POST /.netlify/functions/editEvent
 *   { action: 'update', id, data }            -> updates events.data for that row
 *   { action: 'insert', game_id, data }       -> inserts a new event, returns { id }
 *   { action: 'delete', id }                  -> deletes that row
 *
 * Requires an admin Netlify Identity JWT in the Authorization header.
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

    const { action, id, game_id, data } = body;
    if (!['update', 'insert', 'delete'].includes(action)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'action must be update, insert or delete' }) };
    }

    // ── Admin auth (Netlify Identity JWT) ────────────────────────────────
    const authHeader = event.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Authentication required' }) };

    let decoded;
    try {
      const payload = Buffer.from(token.split('.')[1], 'base64').toString('utf-8');
      decoded = JSON.parse(payload);
    } catch (e) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token format' }) };
    }
    const role = decoded.app_metadata?.roles?.[0];
    if (role !== 'admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: admin role required' }) };
    }

    // ── Perform the operation (service role bypasses RLS) ────────────────
    if (action === 'update') {
      if (id == null || typeof data !== 'object') {
        return { statusCode: 400, body: JSON.stringify({ error: 'update needs id and data' }) };
      }
      const { error } = await supabase.from('events').update({ data }).eq('id', id);
      if (error) throw new Error(error.message);
      return { statusCode: 200, body: JSON.stringify({ ok: true, id }) };
    }

    if (action === 'insert') {
      if (!game_id || typeof data !== 'object') {
        return { statusCode: 400, body: JSON.stringify({ error: 'insert needs game_id and data' }) };
      }
      const { data: row, error } = await supabase
        .from('events').insert({ game_id, data }).select('id').single();
      if (error) throw new Error(error.message);
      return { statusCode: 200, body: JSON.stringify({ ok: true, id: row.id }) };
    }

    if (action === 'delete') {
      if (id == null) {
        return { statusCode: 400, body: JSON.stringify({ error: 'delete needs id' }) };
      }
      const { error } = await supabase.from('events').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { statusCode: 200, body: JSON.stringify({ ok: true, id }) };
    }

  } catch (error) {
    console.error('editEvent error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Internal server error' }) };
  }
};
