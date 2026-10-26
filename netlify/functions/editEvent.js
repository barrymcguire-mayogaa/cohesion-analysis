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
 * Requires an admin or analyst Netlify Identity JWT in the Authorization header (netlify/lib/access.js 'edit').
 * An analyst may write only events of games in a section he can see (checked for every op before anything is written).
 */
const { verifiedClaims, UNAUTH } = require('../lib/identity');
const { rolesOf, allowedSections, sectionOf, can, isAdmin } = require('../lib/access');


const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// An analyst's ops: every game they touch must be in a section he can see. Inserts name their game; an update / delete
// names an event row, whose game is looked up. Returns null (all fine) or the reason to refuse the WHOLE request.
const ID_CHUNK = 200;
async function sectionWall(ops, allowed) {
  const gameIds = new Set(), rowIds = [];
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    if (op.action === 'insert') { if (op.game_id != null) gameIds.add(String(op.game_id)); }
    else if (op.id != null) rowIds.push(op.id);
  }
  for (let i = 0; i < rowIds.length; i += ID_CHUNK) {
    const part = rowIds.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase.from('events').select('id, game_id').in('id', part);
    if (error) throw new Error(error.message);
    (data || []).forEach(r => gameIds.add(String(r.game_id)));
  }
  const ids = [...gameIds];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const part = ids.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase.from('games').select('id, meta').in('id', part);
    if (error) throw new Error(error.message);
    const found = new Map((data || []).map(g => [String(g.id), g]));
    for (const id of part) {
      const g = found.get(id);
      if (g && !allowed.includes(sectionOf(g.meta))) return 'no access to game ' + id;
    }
  }
  return null;
}

exports.handler = async (event, context) => {
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

    const decoded = verifiedClaims(context);
    if (!decoded) return UNAUTH;
    const roles = rolesOf(decoded);
    if (!can(roles, 'edit')) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: admin or analyst role required' }) };
    }
    if (!isAdmin(roles)) {
      const why = await sectionWall(Array.isArray(body.ops) ? body.ops : [body], allowedSections(roles));
      if (why) return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: ' + why }) };
    }

    // ── Batch: apply many ops in one authenticated call ─────────────────
    // Each op echoes back a `ref` (the caller's temp id / index) so the
    // client can reconcile inserts (temp id -> real new id). Ops are applied
    // independently; a failed op is reported without aborting the rest.
    if (Array.isArray(body.ops)) {
      // Ops are independent rows — run them with bounded parallelism so a
      // large save (hundreds of edits) finishes well inside the function
      // timeout instead of one-round-trip-per-op serially (the old way 504'd).
      const ops = body.ops;
      const results = new Array(ops.length);
      const doOp = async (op) => {
        try {
          if (op.action === 'update') {
            if (op.id == null || typeof op.data !== 'object') throw new Error('update needs id and data');
            const { error } = await supabase.from('events').update({ data: op.data }).eq('id', op.id);
            if (error) throw new Error(error.message);
            return { ref: op.ref != null ? op.ref : op.id, ok: true, id: op.id };
          } else if (op.action === 'insert') {
            if (!op.game_id || typeof op.data !== 'object') throw new Error('insert needs game_id and data');
            const { data: row, error } = await supabase.from('events').insert({ game_id: op.game_id, data: op.data }).select('id').single();
            if (error) throw new Error(error.message);
            return { ref: op.ref, ok: true, id: row.id };
          } else if (op.action === 'delete') {
            if (op.id == null) throw new Error('delete needs id');
            const { error } = await supabase.from('events').delete().eq('id', op.id);
            if (error) throw new Error(error.message);
            return { ref: op.ref != null ? op.ref : op.id, ok: true, id: op.id };
          }
          throw new Error('bad action: ' + op.action);
        } catch (e) {
          return { ref: op.ref, ok: false, error: e.message };
        }
      };
      let next = 0;
      const worker = async () => {
        while (next < ops.length) { const i = next++; results[i] = await doOp(ops[i]); }
      };
      await Promise.all(Array.from({ length: Math.min(10, ops.length) }, worker));
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
