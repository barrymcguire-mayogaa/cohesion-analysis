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
    // A batch request ({ops:[...]}) has no top-level `action`; only validate
    // `action` for single-op requests, otherwise the batch is wrongly rejected.
    if (!Array.isArray(body.ops) && !['update', 'insert', 'delete'].includes(action)) {
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

    // ── Batch: apply many ops in one authenticated call ─────────────────
    // Each op echoes back a `ref` (the caller's temp id / index) so the
    // client can reconcile inserts (temp id -> real new id). Ops are applied
    // independently; a failed op is reported without aborting the rest.
    if (Array.isArray(body.ops)) {
      const results = [];
      for (const op of body.ops) {
        try {
          if (op.action === 'update') {
            if (op.id == null || typeof op.data !== 'object') throw new Error('update needs id and data');
            const { error } = await supabase.from('events').update({ data: op.data }).eq('id', op.id);
            if (error) throw new Error(error.message);
            results.push({ ref: op.ref != null ? op.ref : op.id, ok: true, id: op.id });
          } else if (op.action === 'insert') {
            if (!op.game_id || typeof op.data !== 'object') throw new Error('insert needs game_id and data');
            const { data: row, error } = await supabase.from('events').insert({ game_id: op.game_id, data: op.data }).select('id').single();
            if (error) throw new Error(error.message);
            results.push({ ref: op.ref, ok: true, id: row.id });
          } else if (op.action === 'delete') {
            if (op.id == null) throw new Error('delete needs id');
            const { error } = await supabase.from('events').delete().eq('id', op.id);
            if (error) throw new Error(error.message);
            results.push({ ref: op.ref != null ? op.ref : op.id, ok: true, id: op.id });
          } else {
            throw new Error('bad action: ' + op.action);
          }
        } catch (e) {
          results.push({ ref: op.ref, ok: false, error: e.message });
        }
      }
      return { statusCode: 200, body: JSON.stringify({ ok: results.every(r => r.ok), results }) };
    }

    // ── Single op (service role bypasses RLS) ───────────────────────────
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
