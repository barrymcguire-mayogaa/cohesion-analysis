/**
 * Verified Netlify Identity claims for a function call.
 *
 * NEVER base64-decode the Authorization header yourself: anyone can forge an
 * unsigned token with app_metadata.roles ['admin']. When a request carries
 * `Authorization: Bearer <Identity JWT>`, Netlify verifies the signature
 * (site's Identity JWT secret) and exposes the claims as
 * context.clientContext.user. A missing, forged or expired token leaves it
 * undefined — so this returns null and the caller answers 401.
 */
function verifiedClaims(context) {
  const u = context && context.clientContext && context.clientContext.user;
  if (!u || typeof u !== 'object' || !(u.sub || u.email)) return null;
  if (typeof u.exp === 'number' && u.exp * 1000 < Date.now()) return null;
  return u;
}

const UNAUTH = { statusCode: 401, body: JSON.stringify({ error: 'Session not verified — sign in again' }) };

module.exports = { verifiedClaims, UNAUTH };
