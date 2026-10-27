/**
 * PLAYLIST SHARING — who may see, edit, share, delete and moderate a playlist (Barry, Oct 2026).
 * The one place these rules live; netlify/functions/playlists.js asks them on every call. The pages only draw what
 * the function's answer (canEdit / canShare / … on each playlist) tells them.
 *
 * SECTION is always the outer wall (netlify/lib/access.js): a playlist lives in the section it was made in, and only
 * people who can see that section can be reached by any sharing level. A U20 player never sees a senior playlist.
 *
 * SHARING LEVEL (column visibility; one per playlist):
 *   private   Only me — the owner (and admins, who see every playlist)
 *   people    Named people — the owner + the people picked (share_people: [{id, email, name}], Identity users)
 *   groups    Groups — the owner + anyone holding one of the picked roles (share_groups: ['group:forwards', …])
 *   section   Whole squad / section — everyone who can see the section (what 'club' scope always meant)
 *   Rows written before this change have no visibility: scope 'club' → section, scope 'personal' → private.
 *
 * WHO MAY DO WHAT
 *   view / comment    admin: every playlist, every level, every section. Others: within their sections, by the level.
 *   edit              admin · the owner · an analyst on any playlist he can see (staff ones, and players' playlists
 *                     shared with him or the section; never someone's "Only me"). Edit = rename, re-order, add / remove clips, notes, drawings, trims, cover.
 *   share             admin · the owner (a legacy club-wide playlist has no owner: admin only)
 *   delete            admin · the owner of a playlist that is not OFFICIAL (official ones are deleted by an admin)
 *   moderate          admin · the owner — remove anyone's comment on it. Everyone edits / deletes their OWN comments.
 *   OFFICIAL = a staff playlist: a legacy club-wide one (no owner) or one an admin / analyst made at whole-section level.
 */
const { allowedSections, sectionOf, isAdmin, isAnalyst, groupsOf, isGroupRole } = require('./access');

const LEVELS = ['private', 'people', 'groups', 'section'];
const LEVEL_LABEL = { private: 'Only me', people: 'Named people', groups: 'Groups', section: 'Whole section' };

function arr(v) {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
  return Array.isArray(v) ? v : [];
}
function normLevel(v) { v = String(v || '').toLowerCase().trim(); return LEVELS.includes(v) ? v : null; }
function levelOf(row) { return normLevel(row && row.visibility) || (row && row.scope === 'personal' ? 'private' : 'section'); }
function scopeFor(level) { return level === 'section' ? 'club' : 'personal'; }
function normGroup(g) {
  g = String(g || '').toLowerCase().trim();
  if (!g) return null;
  if (!g.startsWith('group:')) g = 'group:' + g;
  return isGroupRole(g) ? g : null;
}
function peopleOf(row) { return arr(row && row.share_people).filter(p => p && (p.id || p.email)); }
function groupsOfRow(row) { return [...new Set(arr(row && row.share_groups).map(normGroup).filter(Boolean))]; }

// the caller, from verified claims
function userOf(claims, rolesFn) {
  const roles = rolesFn(claims);
  const email = String((claims && claims.email) || '').toLowerCase();
  const name = (claims && claims.user_metadata && (claims.user_metadata.full_name || claims.user_metadata.name)) || email.split('@')[0] || 'user';
  return { email, id: String((claims && claims.sub) || ''), roles, sections: allowedSections(roles), groups: groupsOf(roles),
    admin: isAdmin(roles), analyst: isAnalyst(roles), staff: isAdmin(roles) || isAnalyst(roles), name: String(name).slice(0, 80) };
}

const isOwner = (row, u) => !!(row && row.owner && u.email && String(row.owner).toLowerCase() === u.email);
const isOfficial = row => !row.owner || (row.official === true && levelOf(row) === 'section');
const inWall = (row, u) => u.sections.includes(sectionOf(row && row.data));

// through a share (not as owner): a named sharee or a group member
function sharedWith(row, u) {
  const lv = levelOf(row);
  if (lv === 'people') return peopleOf(row).some(p => (p.id && u.id && String(p.id) === u.id) || (p.email && String(p.email).toLowerCase() === u.email));
  if (lv === 'groups') { const g = groupsOfRow(row); return u.groups.some(x => g.includes(x)); }
  return false;
}
// may see it, leaving the admin override aside
function seesAsMember(row, u) {
  if (!inWall(row, u)) return false;
  if (isOwner(row, u)) return true;
  const lv = levelOf(row);
  if (lv === 'section') return true;
  return sharedWith(row, u);
}
function canView(row, u) { return u.admin || seesAsMember(row, u); }
function canEdit(row, u) {
  if (u.admin) return true;
  if (!inWall(row, u)) return false;
  if (isOwner(row, u)) return true;
  return u.analyst && seesAsMember(row, u);   // analysts edit any playlist they can see (staff ones and players' shared ones)
}
function canShare(row, u) { return u.admin || (inWall(row, u) && isOwner(row, u)); }
function canDelete(row, u) { return u.admin || (inWall(row, u) && isOwner(row, u) && !isOfficial(row)); }
function canModerate(row, u) { return u.admin || (inWall(row, u) && isOwner(row, u)); }

module.exports = { LEVELS, LEVEL_LABEL, arr, normLevel, levelOf, scopeFor, normGroup, peopleOf, groupsOfRow, userOf,
  isOwner, isOfficial, sharedWith, seesAsMember, canView, canEdit, canShare, canDelete, canModerate };
