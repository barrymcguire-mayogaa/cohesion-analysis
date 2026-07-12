/**
 * Netlify Function: templates — coding-template storage (service role).
 *
 * Coding templates bundle a Code Room setup (event codes, hotkey order, row
 * layout, per-code colours, clip window) so analysts can reuse it across
 * games. Stored in the `templates` table, which has RLS enabled with NO anon
 * policies — all access goes through this function (admin JWT required), so
 * templates live in the club's database, not one analyst's browser.
 *
 *   POST /.netlify/functions/templates
 *   { action:'list' }                                   -> club + caller's personal templates
 *   { action:'save', name, scope, data, id? }           -> insert (no id) or update own/club
 *   { action:'delete', id }                             -> delete a club or own personal template
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
    if (decoded.app_metadata?.roles?.[0] !== 'admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: admin role required' }) };
    }
    const email = (decoded.email || '').toLowerCase();

    const { action } = body;

    if (action === 'list') {
      const { data, error } = await supabase.from('templates')
        .select('id, scope, owner, name, data, created_at')
        .or(`scope.eq.club,and(scope.eq.personal,owner.eq.${email})`)
        .order('name');
      if (error) throw new Error(error.message);
      return { statusCode: 200, body: JSON.stringify({ ok: true, templates: data || [] }) };
    }

    if (action === 'save') {
      const { id, name, scope, data } = body;
      if (!name || typeof name !== 'string') return { statusCode: 400, body: JSON.stringify({ error: 'name is required' }) };
      if (scope !== 'club' && scope !== 'personal') return { statusCode: 400, body: JSON.stringify({ error: "scope must be 'club' or 'personal'" }) };
      if (!data || typeof data !== 'object') return { statusCode: 400, body: JSON.stringify({ error: 'data object is required' }) };
      const row = { name: name.trim().slice(0, 80), scope, owner: scope === 'personal' ? email : '', data };
      if (id) {
        // Only the owner may update a personal template; club is open to admins.
        const { data: existing, error: exErr } = await supabase.from('templates').select('scope, owner').eq('id', id).single();
        if (exErr) throw new Error(exErr.message);
        if (existing.scope === 'personal' && existing.owner !== email) {
          return { statusCode: 403, body: JSON.stringify({ error: 'Not your template' }) };
        }
        const { error } = await supabase.from('templates').update(row).eq('id', id);
        if (error) throw new Error(error.message);
        return { statusCode: 200, body: JSON.stringify({ ok: true, id }) };
      }
      const { data: ins, error } = await supabase.from('templates').insert(row).select('id').single();
      if (error) throw new Error(error.message);
      return { statusCode: 200, body: JSON.stringify({ ok: true, id: ins.id }) };
    }

    if (action === 'delete') {
      const { id } = body;
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'id is required' }) };
      const { data: existing, error: exErr } = await supabase.from('templates').select('scope, owner').eq('id', id).single();
      if (exErr) throw new Error(exErr.message);
      if (existing.scope === 'personal' && existing.owner !== email) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Not your template' }) };
      }
      const { error } = await supabase.from('templates').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'action must be list, save or delete' }) };

  } catch (error) {
    console.error('templates error:', error);
    const missing = /relation .*templates.* does not exist/i.test(error.message || '');
    return { statusCode: missing ? 424 : 500, body: JSON.stringify({ error: missing ? 'Templates table not created yet — run the setup SQL in Supabase.' : (error.message || 'Internal server error') }) };
  }
};
