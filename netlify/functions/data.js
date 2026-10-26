/**
 * Netlify Function: data — the READ GATEWAY (hard county/club separation).
 *
 * All game/event reads go through here with a Netlify Identity JWT; the
 * anon key's direct SELECT on games/events is revoked in Supabase
 * (LOCKDOWN.sql), so this function is the only door.
 *
 * Section access from app_metadata.roles — netlify/lib/access.js (allowedSections):
 *   admin                → county + club + u20 (+ section:'all')
 *   club                 → club        u20 → u20
 *   any other role       → county      (analyst is a capability, not a section)
 *   none / analyst only  → county      (no-roles users stay county viewers)
 *   combinations         → the union, e.g. CLUB + anything else → county + club (as before)
 *
 * A game's section = meta.section 'club' → club, 'u20' → u20, else county
 * (everything uploaded before sections existed is county by default). A U20
 * game is in NO county list, bundle or gamesMeta — it lives only in U20s.
 *
 *   POST /.netlify/functions/data
 *   { action:'listGames',  section? }          -> { games:[{id, meta}] }
 *   { action:'gameBundle', id }                -> { meta, events:[{id, data}] }
 *   { action:'getEvents',  gameId }            -> { events:[{id, data}] }
 *   { action:'gamesMeta' }                     -> { metas:[meta] }  (all allowed sections)
 *   { action:'xpModel' }                       -> { model: <xp_model.json> | null, version?, id?, published_at? }
 *        the CURRENT published xP model (table xp_models, see supabase/xp_models.sql).
 *        Any verified user. null (never an error) when the table or a current row doesn't
 *        exist yet, so cohesion-xp.js keeps its bundled v1.
 */
const { verifiedClaims, UNAUTH } = require('../lib/identity');
const { rolesOf, allowedSections, sectionOf } = require('../lib/access');


const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EVENTS_PAGE = 1000;   // Supabase's (PostgREST's) default row cap per request

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }
    let body;
    try { body = JSON.parse(event.body); }
    catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

    const token = (event.headers.authorization || '').replace('Bearer ', '');
    if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Authentication required' }) };
    let decoded;
    decoded = verifiedClaims(context);
    if (!decoded) return UNAUTH;

    const roles = rolesOf(decoded);
    const allowed = allowedSections(roles);
    const { action } = body;

    if (action === 'listGames') {
      let want = body.section ? String(body.section).toLowerCase() : null;   // null → every allowed section
      if (want === 'all') {
        // every section the caller can see (an admin: all three). The upload pages ask for 'all'; an analyst uses them.
        want = null;
      } else if (want && !allowed.includes(want)) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: no access to that section' }) };
      }
      const { data, error } = await supabase.from('games')
        .select('id, meta').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const games = (data || []).filter(g =>
        want ? sectionOf(g.meta) === want : allowed.includes(sectionOf(g.meta)));
      return { statusCode: 200, body: JSON.stringify({ ok: true, games, sections: allowed }) };
    }

    if (action === 'gameBundle' || action === 'getEvents') {
      const id = body.id || body.gameId;
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'id is required' }) };
      const { data: g, error: gErr } = await supabase.from('games')
        .select('id, meta').eq('id', id).single();
      if (gErr || !g) return { statusCode: 404, body: JSON.stringify({ error: 'Game not found' }) };
      if (!allowed.includes(sectionOf(g.meta))) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: no access to this game' }) };
      }
      // Every event of the game, a page at a time: Supabase returns at most 1000 rows per request, so a game with more
      // events than that lost everything past the 1000th (a 1400-event Final stopped at about 57 minutes).
      // Ordered by id so the pages never overlap or skip a row.
      const ev = [];
      for (let from = 0; ; from += EVENTS_PAGE) {
        const { data: page, error: eErr } = await supabase.from('events')
          .select('id, data').eq('game_id', id).order('id', { ascending: true }).range(from, from + EVENTS_PAGE - 1);
        if (eErr) throw new Error(eErr.message);
        (page || []).forEach(r => ev.push(r));
        if (!page || page.length < EVENTS_PAGE) break;
      }
      if (action === 'getEvents') {
        return { statusCode: 200, body: JSON.stringify({ ok: true, events: ev || [] }) };
      }
      return { statusCode: 200, body: JSON.stringify({ ok: true, meta: g.meta, events: ev || [] }) };
    }

    if (action === 'gamesMeta') {
      const { data, error } = await supabase.from('games').select('meta');
      if (error) throw new Error(error.message);
      const metas = (data || []).map(r => r.meta).filter(m => allowed.includes(sectionOf(m)));
      return { statusCode: 200, body: JSON.stringify({ ok: true, metas }) };
    }

    if (action === 'xpModel') {
      const none = (why) => ({ statusCode: 200, body: JSON.stringify({ ok: true, model: null, reason: why }) });
      try {
        const { data, error } = await supabase.from('xp_models')
          .select('id, version, model, made_current_at')
          .not('made_current_at', 'is', null)
          .order('made_current_at', { ascending: false })
          .limit(1);
        if (error) { console.warn('xpModel: ' + error.message); return none('unavailable'); }
        const row = (data || [])[0];
        if (!row || !row.model || typeof row.model !== 'object') return none('none published');
        return { statusCode: 200, body: JSON.stringify({ ok: true, model: row.model, version: row.version, id: row.id, published_at: row.made_current_at }) };
      } catch (e) {
        console.warn('xpModel: ' + (e && e.message));
        return none('unavailable');
      }
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'action must be listGames, gameBundle, getEvents, gamesMeta or xpModel' }) };

  } catch (error) {
    console.error('data error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Internal server error' }) };
  }
};
