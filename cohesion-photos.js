/**
 * COHESION player photos — the ONE player-name key, the photo keys, and the
 * shared badge (photo with the initials badge underneath).
 *
 * Photos are PRIVATE: they live in the Supabase bucket "player-photos" (not
 * public — see supabase/player_photos_storage.sql) and are only ever handed out
 * as short-lived SIGNED URLs by netlify/functions/playerPhotos.js, which
 * answers verified signed-in sessions only.
 *
 * Load after cohesion-edit.js (auth fetch):
 *   <script src="cohesion-edit.js"></script>
 *   <script src="cohesion-photos.js"></script>
 *
 *   cohPlayerKey(name)        "Ryan O’Donoghue" -> "ryanodonoghue". Case, spaces and
 *                             apostrophe style ignored — THE Players-tab key
 *                             (analysis.html's pyKey calls this; do not copy it).
 *   cohPlayerInitials(name)   "Ryan O'Donoghue" -> "RO" (analysis.html's pyInitials).
 *   cohPhotoKey(s)            cohPlayerKey + accents folded + anything that is not
 *                             a-z / 0-9 dropped: "Seán Ó Sé" -> "seanose". Used for
 *                             BOTH the team and the player part of a photo's
 *                             storage path and index key (so it is path-safe).
 *   cohPhotoNameFromFile(fn)  "ryan_o'donoghue (2).JPG" -> "ryan o'donoghue"
 *   cohPhotoMatchFiles(fileNames, players, hasPhoto) -> one row per file for the
 *                             bulk preview (see below).
 *
 *   await cohPhotosReady(teams, opts)   resolves true/false (never rejects) once the
 *                             signed-URL list for those team names is in memory.
 *                             { force:true } re-fetches. Badges already in the page
 *                             are upgraded to photos when it resolves.
 *   cohPhotoSrc(team, name)   signed URL, or null (no photo / not loaded / expired).
 *   cohPlayerBadgeHTML(team, name, opts)
 *                             HTML for a round, fixed-size badge: the initials, with
 *                             the photo laid over them when there is one. It is all
 *                             a page needs to call — it asks for the team's photos
 *                             itself and swaps them in when they arrive.
 *                             opts: { size:38, color:'#4fc3f7', cls:'py-badge',
 *                                     decorative:true (aria-hidden wrapper) }
 *
 * Signed URLs are kept in MEMORY only (never localStorage / sessionStorage) and
 * are re-requested when they are close to expiring or when an <img> fails.
 *
 * Also required by netlify/functions/playerPhotos.js (Node) for the key rules —
 * everything below the module.exports line is browser-only.
 */
(function () {
  'use strict';

  // ── keys (pure; shared with the Netlify function and the tests) ──────────
  function cohPlayerKey(name) {
    return String(name || '').replace(/[‘’ʼ`´']/g, '').replace(/\s+/g, '').toLowerCase();
  }
  function cohPhotoKey(s) {
    return cohPlayerKey(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  }
  function cohPlayerInitials(name) {
    var s = String(name || '').trim(); if (!s) return '?';
    if (s.length <= 3 || /^[A-Za-z]{0,2}\d+$/.test(s)) return s.slice(0, 3).toUpperCase();
    var w = s.split(/\s+/).filter(Boolean);
    return ((w[0][0] || '') + (w.length > 1 ? (w[w.length - 1].replace(/^[^A-Za-zÀ-ÿ]+/, '')[0] || '') : '')).toUpperCase();
  }

  // "Ryan_O'Donoghue (2).JPG" -> "Ryan O'Donoghue". A leading jersey number
  // ("14 Ryan O'Donoghue.jpg", "14-ryan.jpg") is not part of the name.
  function cohPhotoNameFromFile(fn) {
    var n = String(fn || '').split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,5}$/i, '');
    n = n.replace(/[_]+/g, ' ').replace(/\(\d+\)/g, ' ').replace(/\b(copy|photo|headshot|portrait|profile)\b/gi, ' ');
    n = n.replace(/^\s*#?\d{1,3}\s*[-.)_ ]\s*(?=\D)/, '');
    return n.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  }

  // Bulk preview rows. players: [name]; hasPhoto: {photoKey:true} | [names] | fn(name).
  // -> [{ file, guess, key, player|null, status:'match'|'replace'|'nomatch'|'duplicate', tick }]
  //    match     a player with no photo yet          (ticked)
  //    replace   the player already has a photo      (NOT ticked — nothing is overwritten by default)
  //    duplicate an earlier file in this batch already took that player (not ticked)
  //    nomatch   no player with that name            (not ticked; assign by hand)
  function cohPhotoMatchFiles(fileNames, players, hasPhoto) {
    var byKey = {};
    (players || []).forEach(function (p) { var k = cohPhotoKey(p); if (k && !byKey[k]) byKey[k] = p; });
    var has = function (name) {
      if (!hasPhoto) return false;
      if (typeof hasPhoto === 'function') return !!hasPhoto(name);
      if (Array.isArray(hasPhoto)) return hasPhoto.some(function (n) { return cohPhotoKey(n) === cohPhotoKey(name); });
      return !!hasPhoto[cohPhotoKey(name)];
    };
    var taken = {};
    return (fileNames || []).map(function (f) {
      var guess = cohPhotoNameFromFile(f), key = cohPhotoKey(guess), player = (key && byKey[key]) || null;
      var status = 'nomatch';
      if (player) {
        if (taken[key]) status = 'duplicate';
        else { taken[key] = true; status = has(player) ? 'replace' : 'match'; }
      }
      return { file: String(f), guess: guess, key: key, player: player, status: status, tick: status === 'match' };
    });
  }

  var PURE = { cohPlayerKey: cohPlayerKey, cohPhotoKey: cohPhotoKey, cohPlayerInitials: cohPlayerInitials,
    cohPhotoNameFromFile: cohPhotoNameFromFile, cohPhotoMatchFiles: cohPhotoMatchFiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = PURE;
  if (typeof window === 'undefined') return;
  Object.keys(PURE).forEach(function (k) { window[k] = PURE[k]; });
