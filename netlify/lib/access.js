/**
 * SECTIONS and ROLES — the one place the server decides who sees what and who may do what.
 * Every Netlify function uses this; the pages mirror it in cohesion-edit.js (cohesionSections / cohesionCan) and the
 * desktop app in src/localfn.js. Change the three together.
 *
 * ROLES come from Netlify Identity app_metadata.roles (case-insensitive). Two kinds:
 *   capability roles  admin    everything, every section
 *                     analyst  tag, upload and edit games (no deletes, no management, no admin settings)
 *   section roles     club     the club section
 *                     u20      the U20s section
 *   any other role (or none)   the county section — exactly as before sections had a third value
 *
 * SECTIONS a user sees (allowedSections):
 *   admin                                  county + club + u20
 *   otherwise the union of
 *     club                → club
 *     u20                 → u20
 *     any role that is not admin / analyst / club / u20 (e.g. 'county', 'viewer', 'mayo')  → county
 *   and if that leaves nothing (no roles, or analyst only)  → county   (no-roles users stay county viewers)
 *
 * So the users who existed before U20s keep EXACTLY what they had:
 *   no roles → county · club only → club · club + other → county + club · other → county · admin → (now also u20)
 *
 * A GAME's section (sectionOf): meta.section 'club' → club, 'u20' → u20, anything else → county (every game uploaded
 * before sections existed is county). A U20 game is a county team's game but lives ONLY in the U20s section: it is in
 * no county list, stat, rank, analysis, report or playlist.
 */
const SECTIONS = ['county', 'club', 'u20'];
const CAPABILITY_ROLES = ['admin', 'analyst'];
const SECTION_ROLES = { club: 'club', u20: 'u20' };

function rolesOf(claims) {
  const raw = (claims && claims.app_metadata && claims.app_metadata.roles) || [];
  return (Array.isArray(raw) ? raw : []).map(r => String(r).toLowerCase().trim()).filter(Boolean);
}
function allowedSections(roles) {
  roles = roles || [];
  if (roles.includes('admin')) return SECTIONS.slice();
  const s = new Set();
  roles.forEach(r => {
    if (SECTION_ROLES[r]) s.add(SECTION_ROLES[r]);
    else if (!CAPABILITY_ROLES.includes(r)) s.add('county');
  });
  if (!s.size) s.add('county');
  return SECTIONS.filter(x => s.has(x));
}
// a stored meta (Supabase can hand a json column back as text)
function metaObj(meta) {
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch (_) { meta = null; } }
  return meta && typeof meta === 'object' ? meta : null;
}
// a game's / playlist's / template's stored section
function sectionOf(meta) {
  meta = metaObj(meta);
  const s = String((meta && meta.section) || '').toLowerCase();
  return s === 'club' ? 'club' : s === 'u20' ? 'u20' : 'county';
}
// a section named in a request (anything unknown = county, as the pages always sent it)
function normSection(s) {
  s = String(s || '').toLowerCase();
  return s === 'club' ? 'club' : s === 'u20' ? 'u20' : 'county';
}

// ── capabilities ──
//   view          any signed-in user (the read gateway)
//   upload        upload new games; re-parse a game (an analyst only one he uploaded himself)
//   edit          Code Room tagging / editing / saving, Repair missing events, Merge XML, game details (updateMeta)
//   playlists     create / edit / append to playlists (an analyst deletes only his own personal ones)
//   templatesPersonal  personal coding templates
//   templatesClub      club-wide coding templates
//   deleteGame    delete a game
//   manage        crests, player photos, player names, the xP refit / publish, every other admin page
//   notes         the Panel Print-out staff notes (admin; analyst for teams that play in his sections — Barry, Oct 2026)
const CAN = {
  admin:   ['view', 'upload', 'edit', 'playlists', 'templatesPersonal', 'templatesClub', 'deleteGame', 'manage', 'notes'],
  analyst: ['view', 'upload', 'edit', 'playlists', 'templatesPersonal', 'notes'],
};
function can(roles, cap) {
  roles = roles || [];
  if (cap === 'view') return true;
  return Object.keys(CAN).some(r => roles.includes(r) && CAN[r].includes(cap));
}
const isAdmin = roles => (roles || []).includes('admin');
const isAnalyst = roles => !isAdmin(roles) && (roles || []).includes('analyst');

// who uploaded a game (stamped by processGame / processBatchGames; '' for games uploaded before Oct 2026)
function uploaderOf(meta) { meta = metaObj(meta); return String((meta && meta.uploadedBy) || '').toLowerCase(); }

function forbid(msg) { return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: ' + msg }) }; }

module.exports = { SECTIONS, metaObj, rolesOf, allowedSections, sectionOf, normSection, can, isAdmin, isAnalyst, uploaderOf, forbid };
