/**
 * Netlify Identity (GoTrue) ADMIN API, from inside a Netlify function — the Team page (netlify/functions/teamAdmin.js).
 *
 * HOW ADMIN ACCESS WORKS (no new env vars, no stored secret):
 *   Netlify runs every function with `context.clientContext`. On a site with Identity enabled it carries
 *     identity: { url: 'https://<site>/.netlify/identity', token: '<short-lived admin JWT>' }
 *   and, when the request sent a valid `Authorization: Bearer <user JWT>`, user: <the verified claims>
 *   (netlify/lib/identity.js verifiedClaims reads that one). The identity token is minted by Netlify for THIS call only
 *   and lets the function call GoTrue's admin endpoints. It is an admin credential: every caller of this module must
 *   check the caller's own role first (teamAdmin.js does, before any of these run). It exists only in the Lambda-style
 *   handler(event, context) functions this repo uses, and only on the deployed site (`netlify dev` may not supply it).
 *
 * GoTrue endpoints used (netlify/gotrue api/admin.go, api/invite.go):
 *   GET    {url}/admin/users?page=&per_page=   → { aud, users:[user] }      per_page max 500
 *   GET    {url}/admin/users/{id}              → user
 *   PUT    {url}/admin/users/{id}  {app_metadata:{roles}, user_metadata}  → user   (app_metadata keys are merged: only
 *                                                                                    'roles' is replaced; 'provider' stays)
 *   DELETE {url}/admin/users/{id}              → {}
 *   POST   {url}/invite  {email, data}         → user  (creates the user UNCONFIRMED and sends the site's invitation
 *                                                       email; data → user_metadata. 422 if the email already exists —
 *                                                       confirmed or not — so a re-send is delete + invite again.)
 * user = { id, aud, role, email, confirmed_at?, invited_at?, confirmation_sent_at?, recovery_sent_at?, last_sign_in_at?,
 *          app_metadata:{provider, roles}, user_metadata:{full_name…}, created_at, updated_at }   (models/user.go)
 *
 * Every function here returns { ok:true, … } or { ok:false, status, error } — it never throws.
 */
function identityOf(context) {
  const id = context && context.clientContext && context.clientContext.identity;
  if (!id || typeof id !== 'object' || !id.url || !id.token) return null;
  return { url: String(id.url).replace(/\/+$/, ''), token: String(id.token) };
}

const NOT_AVAILABLE = 'Netlify Identity admin access is not available to this function call (Identity must be enabled on the site; it is supplied on the deployed site only)';

async function call(idn, method, path, body) {
  if (!idn) return { ok: false, status: 503, error: NOT_AVAILABLE };
  if (typeof fetch !== 'function') return { ok: false, status: 503, error: 'fetch is not available in this runtime' };
  let res;
  try {
    res = await fetch(idn.url + path, { method, headers: Object.assign({ Authorization: 'Bearer ' + idn.token },
      body !== undefined ? { 'Content-Type': 'application/json' } : {}), body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) { return { ok: false, status: 502, error: 'Netlify Identity did not answer: ' + ((e && e.message) || e) }; }
  let j = null; try { j = await res.json(); } catch (_) { j = null; }
  if (!res.ok) {
    const msg = (j && (j.msg || j.error_description || j.error || j.message)) || ('HTTP ' + res.status);
    return { ok: false, status: res.status, error: 'Netlify Identity: ' + msg };
  }
  return { ok: true, status: res.status, data: j };
}

async function listUsers(idn) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    const r = await call(idn, 'GET', '/admin/users?per_page=500&page=' + page);
    if (!r.ok) return r;
    const list = Array.isArray(r.data) ? r.data : ((r.data && r.data.users) || []);
    list.forEach(u => { if (u && u.id) out.push(u); });
    if (list.length < 500) break;
  }
  return { ok: true, users: out };
}
const getUser = (idn, id) => call(idn, 'GET', '/admin/users/' + encodeURIComponent(id)).then(r => r.ok ? { ok: true, user: r.data } : r);
const updateUser = (idn, id, patch) => call(idn, 'PUT', '/admin/users/' + encodeURIComponent(id), patch).then(r => r.ok ? { ok: true, user: r.data } : r);
const deleteUser = (idn, id) => call(idn, 'DELETE', '/admin/users/' + encodeURIComponent(id));
const invite = (idn, email, data) => call(idn, 'POST', '/invite', { email, data: data || {} }).then(r => r.ok ? { ok: true, user: r.data } : r);

// the roles GoTrue holds for a user (the same normalisation as access.js rolesOf)
function rolesOfUser(u) {
  const raw = (u && u.app_metadata && u.app_metadata.roles) || [];
  return (Array.isArray(raw) ? raw : []).map(r => String(r).toLowerCase().trim()).filter(Boolean);
}
// invited (has not set a password yet) | accepted
function statusOfUser(u) { return u && u.confirmed_at ? 'accepted' : 'invited'; }

module.exports = { identityOf, listUsers, getUser, updateUser, deleteUser, invite, rolesOfUser, statusOfUser, NOT_AVAILABLE };
