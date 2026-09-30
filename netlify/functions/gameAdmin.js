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
 *
 * xP model publishing (table xp_models — supabase/xp_models.sql; refits come from xp-refit.html):
 *   { action: 'publishXpModel', model, training?, validation?, notes? }
 *        -> saves a NEW version (next minor after every stored version, e.g. 1.1.0) and makes it current
 *   { action: 'listXpModels' }                -> { models:[…newest first], currentId }  (history)
 *   { action: 'setCurrentXpModel', id }       -> rollback: make an older version current;
 *                                                id 'bundled' reverts to cohesion-xp.js's built-in v1
 * Never called automatically — publishing is always an admin clicking Publish.
 */
const { verifiedClaims, UNAUTH } = require('../lib/identity');


const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event, context) => {
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
    decoded = verifiedClaims(context);
    if (!decoded) return UNAUTH;
    if (!((decoded.app_metadata && decoded.app_metadata.roles) || []).map(r => String(r).toLowerCase()).includes('admin')) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: admin role required' }) };
    }

    if (action === 'publishXpModel' || action === 'listXpModels' || action === 'setCurrentXpModel') {
      return await xpModelAction(action, body, (decoded.email || '').toLowerCase());
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

    return { statusCode: 400, body: JSON.stringify({ error: 'action must be updateMeta, deleteGame, publishXpModel, listXpModels or setCurrentXpModel' }) };

  } catch (error) {
    console.error('gameAdmin error:', error);
    if (isMissingTable(error)) {
      return { statusCode: 424, body: JSON.stringify({ error: 'xP model table not created yet — run supabase/xp_models.sql in the Supabase SQL editor.' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Internal server error' }) };
  }
};

// ── xP models ─────────────────────────────────────────────────────────────
const BUNDLED_VERSION = '1.0.0';   // cohesion-xp.js's built-in model
const ok = (o) => ({ statusCode: 200, body: JSON.stringify(Object.assign({ ok: true }, o)) });
const bad = (msg, code) => ({ statusCode: code || 400, body: JSON.stringify({ error: msg }) });

function isMissingTable(e) {
  const m = String((e && e.message) || '');
  return (e && (e.code === '42P01' || e.code === 'PGRST205')) || /xp_models/.test(m) && /does not exist|could not find the table|schema cache/i.test(m);
}
function dbErr(error) { const e = new Error(error.message || String(error)); e.code = error.code; return e; }
function vparts(v) { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '')); return m ? [+m[1], +m[2], +m[3]] : null; }
function vcmp(a, b) { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

// Shape check: everything cohesion-xp.js's scorer reads must be present and finite.
function validateModel(m) {
  const fin = (v) => typeof v === 'number' && isFinite(v);
  if (!m || typeof m !== 'object') return 'model object is required';
  const P = m.point_attempt_model, G = m.goal_attempt_model, C = m.coordinates, Pen = m.penalty;
  if (!P || !fin(P.intercept) || !P.coefficients || typeof P.coefficients !== 'object') return 'point_attempt_model.intercept/coefficients missing';
  const need = ['dist', 'dist_rcs1', 'dist_rcs2', 'log_goalmouth_angle', 'db_free', 'db_45', 'db_free_x_dist', 'press_high', 'press_missing'];
  for (const k of need) if (!fin(P.coefficients[k])) return 'point_attempt_model.coefficients.' + k + ' must be a finite number';
  if (!Array.isArray(P.dist_knots) || P.dist_knots.length !== 4 || !P.dist_knots.every(fin)) return 'point_attempt_model.dist_knots must be 4 numbers';
  if (!G || !G.p_goal || !fin(G.p_goal.intercept) || !fin(G.p_goal.coef_log_dist) || !G.p_point_given_no_goal || !fin(G.p_point_given_no_goal.intercept)) return 'goal_attempt_model incomplete';
  if (!Pen || !fin(Pen.p_goal) || !fin(Pen.p_point)) return 'penalty.p_goal/p_point missing';
  if (!C || !Array.isArray(C.depth_knots_Yt) || !Array.isArray(C.depth_knots_m) || !fin(C.metres_per_Xt) || !fin(C.goal_centre_Xt) || !fin(C.min_depth_m) || !fin(C.post_half_width_m)) return 'coordinates incomplete';
  return null;
}

async function currentRow() {
  const { data, error } = await supabase.from('xp_models').select('id, version, made_current_at')
    .not('made_current_at', 'is', null).order('made_current_at', { ascending: false }).limit(1);
  if (error) throw dbErr(error);
  return (data || [])[0] || null;
}

async function xpModelAction(action, body, email) {
  if (action === 'listXpModels') {
    const { data, error } = await supabase.from('xp_models')
      .select('id, version, created_at, author, model, training, validation, notes, made_current_at')
      .order('created_at', { ascending: false });
    if (error) throw dbErr(error);
    const cur = await currentRow();
    return ok({ models: data || [], currentId: cur ? cur.id : null, bundledVersion: BUNDLED_VERSION });
  }

  if (action === 'publishXpModel') {
    const model = body.model;
    const why = validateModel(model);
    if (why) return bad(why);
    const size = JSON.stringify({ model, training: body.training || null, validation: body.validation || null }).length;
    if (size > 1500000) return bad('model + training + validation too large (' + size + ' bytes)');
    // Version = next minor after every stored version (and the bundled 1.0.0).
    const { data: vs, error: vErr } = await supabase.from('xp_models').select('version');
    if (vErr) throw dbErr(vErr);
    let max = vparts(BUNDLED_VERSION);
    for (const r of vs || []) { const p = vparts(r.version); if (p && vcmp(p, max) > 0) max = p; }
    const version = max[0] + '.' + (max[1] + 1) + '.0';
    const stored = Object.assign({}, model, { version, created: model.created || new Date().toISOString().slice(0, 10) });
    const row = { version, author: email, model: stored, training: body.training || null, validation: body.validation || null,
                  notes: String(body.notes || '').slice(0, 2000), made_current_at: new Date().toISOString() };
    const { data: ins, error } = await supabase.from('xp_models').insert(row).select('id, version, created_at, made_current_at').single();
    if (error) throw dbErr(error);
    return ok({ id: ins.id, version: ins.version, created_at: ins.created_at, currentId: ins.id });
  }

  if (action === 'setCurrentXpModel') {
    const id = body.id;
    if (id === 'bundled' || id === null) {
      const { error } = await supabase.from('xp_models').update({ made_current_at: null }).not('made_current_at', 'is', null);
      if (error) throw dbErr(error);
      return ok({ currentId: null, version: BUNDLED_VERSION });
    }
    if (id === undefined || id === '') return bad("id is required ('bundled' reverts to the built-in v1)");
    const { data: ex, error: exErr } = await supabase.from('xp_models').select('id, version').eq('id', id).limit(1);
    if (exErr) throw dbErr(exErr);
    if (!ex || !ex.length) return bad('xP model ' + id + ' not found', 404);
    const { error } = await supabase.from('xp_models').update({ made_current_at: new Date().toISOString() }).eq('id', id);
    if (error) throw dbErr(error);
    return ok({ currentId: ex[0].id, version: ex[0].version });
  }
}
