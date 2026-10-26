/**
 * The club's people, read server-side from Netlify Identity — for playlist sharing ("Named people" and "Groups").
 *
 * Netlify hands every function call made with a user's Identity JWT an Identity ADMIN token for this site:
 * context.clientContext.identity = { url, token }. That token lives only inside the function call; nothing is stored
 * and no API key is needed. With it, GET <url>/admin/users lists the site's users with their app_metadata.roles.
 *
 * What leaves the server: a person's Identity id and DISPLAY NAME only (user_metadata.full_name, else the part of the
 * email before the @, title-cased). Emails stay here — they are used to match a sharee and to address a notification.
 *
 * listUsers(context) → [{ id, email, name, roles }] or null when Identity is not reachable (local dev, a call without
 * a user token). The list is cached for 60 s per warm function instance.
 */
const { rolesOf } = require('./access');

let CACHE = { at: 0, url: '', users: null };
const TTL = 60 * 1000;

function displayName(u) {
  const full = u && u.user_metadata && String(u.user_metadata.full_name || u.user_metadata.name || '').trim();
  if (full) return full.slice(0, 80);
  const local = String((u && u.email) || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  return local ? local.split(/\s+/).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : 'Member';
}

async function listUsers(context) {
  const id = context && context.clientContext && context.clientContext.identity;
  if (!id || !id.url || !id.token || typeof fetch !== 'function') return null;
  if (CACHE.users && CACHE.url === id.url && Date.now() - CACHE.at < TTL) return CACHE.users;
  const out = [];
  try {
    for (let page = 1; page <= 20; page++) {
      const res = await fetch(String(id.url).replace(/\/$/, '') + '/admin/users?per_page=500&page=' + page,
        { headers: { Authorization: 'Bearer ' + id.token } });
      if (!res.ok) { console.error('directory: Identity admin/users HTTP ' + res.status); return null; }
      const j = await res.json().catch(() => ({}));
      const list = Array.isArray(j) ? j : (j.users || []);
      list.forEach(u => {
        if (!u || !u.email) return;
        out.push({ id: String(u.id || ''), email: String(u.email).toLowerCase(), name: displayName(u), roles: rolesOf(u) });
      });
      if (list.length < 500) break;
    }
  } catch (e) { console.error('directory: Identity not reachable:', e.message); return null; }
  CACHE = { at: Date.now(), url: id.url, users: out };
  return out;
}

function _resetCache() { CACHE = { at: 0, url: '', users: null }; }

module.exports = { listUsers, displayName, _resetCache };
