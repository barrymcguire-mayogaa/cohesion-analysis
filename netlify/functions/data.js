/**
 * Netlify Function: data — the READ GATEWAY (hard county/club separation).
 *
 * All game/event reads go through here with a Netlify Identity JWT; the
 * anon key's direct SELECT on games/events is revoked in Supabase
 * (LOCKDOWN.sql), so this function is the only door.
 *
 * Section access from app_metadata.roles (case-insensitive):
 *   admin                → county + club (+ section:'all')
 *   CLUB as the only role→ club only
 *   CLUB + anything else → county + club
 *   anything else / none → county   (no-roles users stay county viewers)
 *
 * A game's section = meta.section === 'club' ? 'club' : 'county'
 * (everything uploaded before sections existed is county by default).
 *
 *   POST /.netlify/functions/data
 *   { action:'listGames',  section? }          -> { games:[{id, meta}] }
 *   { action:'gameBundle', id }                -> { meta, events:[{id, data}] }
 *   { action:'getEvents',  gameId }            -> { events:[{id, data}] }
 *   { action:'gamesMeta' }                     -> { metas:[meta] }  (all allowed sections)
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function rolesOf(decoded) {
  const raw = (decoded.app_metadata && decoded.app_metadata.roles) || [];
  return raw.map(r => String(r).toLowerCase());
}
function allowedSections(roles) {
  if (roles.includes('admin')) return ['county', 'club'];
  const hasClub = roles.includes('club');
  const hasOther = roles.some(r => r !== 'club');
  if (hasClub && !hasOther) return ['club'];
  if (hasClub) return ['county', 'club'];
  return ['county'];
}
function sectionOf(meta) {
  return (meta && meta.section) === 'club' ? 'club' : 'county';
}

exports.handler = async (event) => {
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
    try { decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf-8')); }
    catch (e) { return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token format' }) }; }

    const roles = rolesOf(decoded);
    const isAdmin = roles.includes('admin');
    const allowed = allowedSections(roles);
    const { action } = body;

    if (action === 'listGames') {
      let want = body.section || null;                    // null → every allowed section
      if (want === 'all') {
        if (!isAdmin) return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
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
      const { data: ev, error: eErr } = await supabase.from('events')
        .select('id, data').eq('game_id', id);
      if (eErr) throw new Error(eErr.message);
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

    return { statusCode: 400, body: JSON.stringify({ error: 'action must be listGames, gameBundle, getEvents or gamesMeta' }) };

  } catch (error) {
    console.error('data error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Internal server error' }) };
  }
};
