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

  // ── signed-URL cache: MEMORY ONLY, per team, for the life of the page ────
  var FN = 'playerPhotos';
  var MAX_TEAMS = 12;            // per list call (the function's cap)
  var MARGIN = 5 * 60 * 1000;    // treat a URL as expired this long before it really is
  var RETRY = 60 * 1000;         // after a failed list call, leave that team alone for a minute
  var ERR_GAP = 5 * 60 * 1000;   // a broken <img> forces at most one re-fetch per team in this time

  var teams = {};                // teamKey -> { players:{playerKey:{name,url,v,bad?}}, exp, at }
  var inflight = {};             // teamKey -> Promise<boolean>
  var failedAt = {};             // teamKey -> ms
  var lastErrFetch = {};         // teamKey -> ms
  var queued = {}, qTimer = null;
  var setupMissing = false;      // the last list said the bucket does not exist yet (SQL not run)

  function now() { return Date.now(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fresh(tk) { var t = teams[tk]; return !!t && now() < t.exp; }

  function store(tk, entry, ttlMs) {
    var players = {};
    var src = (entry && entry.players) || {};
    Object.keys(src).forEach(function (pk) {
      var p = src[pk];
      if (!p || typeof p.url !== 'string' || !/^https:\/\//i.test(p.url)) return;   // signed URLs only, never anything else
      players[pk] = { name: String(p.name || pk), url: p.url, v: String(p.updatedAt || '') };
    });
    teams[tk] = { name: (entry && entry.name) || '', players: players, at: now(), exp: now() + ttlMs };
  }

  function fetchTeams(list) {                    // list: [{k, name}] (<= MAX_TEAMS)
    var p = Promise.resolve().then(function () {
      if (typeof window.cohesionAuthFetch !== 'function') throw new Error('cohesion-edit.js not loaded');
      return window.cohesionAuthFetch(FN, { action: 'list', teams: list.map(function (t) { return t.name; }) });
    }).then(function (j) {
      var secs = +(j && j.expiresIn) || 3600;
      var ttl = Math.max(60 * 1000, secs * 1000 - MARGIN);
      var got = (j && j.teams) || {};
      setupMissing = !!(j && j.bucketMissing);
      list.forEach(function (t) { store(t.k, got[t.k], ttl); delete failedAt[t.k]; });
      return true;
    }).catch(function () {
      list.forEach(function (t) { failedAt[t.k] = now(); });
      return false;
    }).then(function (ok) {
      list.forEach(function (t) { if (inflight[t.k] === p) delete inflight[t.k]; });
      if (ok) swapAll();
      return ok;
    });
    list.forEach(function (t) { inflight[t.k] = p; });
    return p;
  }

  window.cohPhotosReady = function (names, opts) {
    try {
      var force = !!(opts && opts.force);
      var arr = Array.isArray(names) ? names : (names == null ? [] : [names]);
      var need = [], wait = [], seen = {};
      arr.forEach(function (n) {
        var k = cohPhotoKey(n); if (!k || seen[k]) return; seen[k] = true;
        if (inflight[k] && !force) { wait.push(inflight[k]); return; }
        if (!force && fresh(k)) return;
        if (!force && failedAt[k] && now() - failedAt[k] < RETRY) { wait.push(Promise.resolve(false)); return; }
        need.push({ k: k, name: String(n) });
      });
      for (var i = 0; i < need.length; i += MAX_TEAMS) wait.push(fetchTeams(need.slice(i, i + MAX_TEAMS)));
      if (!wait.length) return Promise.resolve(true);
      return Promise.all(wait).then(function (r) { return r.every(Boolean); }).catch(function () { return false; });
    } catch (_e) {
      return Promise.resolve(false);
    }
  };

  function schedule(team) {
    var k = cohPhotoKey(team); if (!k || inflight[k] || fresh(k)) return;
    if (failedAt[k] && now() - failedAt[k] < RETRY) return;
    queued[k] = String(team);
    if (qTimer) return;
    qTimer = setTimeout(function () {
      qTimer = null;
      var list = Object.keys(queued).map(function (x) { return queued[x]; }); queued = {};
      window.cohPhotosReady(list);
    }, 30);
  }

  function entry(team, name) {
    var tk = cohPhotoKey(team), pk = cohPhotoKey(name);
    if (!tk || !pk || !fresh(tk)) return null;
    var p = teams[tk].players[pk];
    return p && !p.bad ? p : null;
  }
  window.cohPhotoSrc = function (team, name) {
    var p = entry(team, name);
    if (!p) { schedule(team); return null; }
    return p.url;
  };
  // { photoKey: {name, url, updatedAt} } for a team that has been loaded (else {}).
  window.cohPhotosOf = function (team) {
    var tk = cohPhotoKey(team), out = {};
    if (!fresh(tk)) return out;
    Object.keys(teams[tk].players).forEach(function (pk) {
      var p = teams[tk].players[pk]; out[pk] = { name: p.name, url: p.url, updatedAt: p.v };
    });
    return out;
  };

  // true when the last list reported that the storage bucket has not been created yet
  window.cohPhotosSetupMissing = function () { return setupMissing; };

  function imgHTML(p, name) {
    return '<img src="' + esc(p.url) + '" alt="' + esc(name) + '" data-v="' + esc(p.v) + '" loading="lazy" decoding="async"'
      + ' referrerpolicy="no-referrer" draggable="false" onerror="cohPhotoImgError(this)">';
  }
  window.cohPlayerBadgeHTML = function (team, name, opts) {
    opts = opts || {};
    var p = entry(team, name);
    if (!p) schedule(team);
    var style = (opts.size ? '--pbs:' + (+opts.size || 38) + 'px;' : '') + (opts.color ? '--bc:' + esc(opts.color) + ';' : '');
    return '<span class="coh-pb' + (opts.cls ? ' ' + esc(opts.cls) : '') + '" data-coh-pt="' + esc(team) + '" data-coh-pn="' + esc(name) + '"'
      + (style ? ' style="' + style + '"' : '') + (opts.decorative === false ? '' : ' aria-hidden="true"') + '>'
      + '<span class="coh-pb-i">' + esc(cohPlayerInitials(name)) + '</span>' + (p ? imgHTML(p, name) : '') + '</span>';
  };

  // Upgrade every badge already in the page: add a photo that has arrived,
  // replace one that changed, drop one that was removed. Initials stay underneath.
  function swapAll() {
    var list;
    try { list = document.querySelectorAll('.coh-pb[data-coh-pt]'); } catch (_e) { return; }
    for (var i = 0; i < (list ? list.length : 0); i++) {
      var el = list[i];
      try {
        var team = el.getAttribute('data-coh-pt'), name = el.getAttribute('data-coh-pn');
        if (!fresh(cohPhotoKey(team))) continue;              // nothing known: leave the badge as it is
        var p = entry(team, name), img = el.querySelector('img');
        if (p && !img) el.insertAdjacentHTML('beforeend', imgHTML(p, name));
        else if (p && img && img.getAttribute('data-v') !== p.v) { img.setAttribute('data-v', p.v); img.src = p.url; }
        else if (!p && img) img.parentNode.removeChild(img);
      } catch (_e) {}
    }
    try { window.dispatchEvent(new CustomEvent('cohphotos')); } catch (_e) {}
  }
  window.cohPhotosSwap = swapAll;

  // A photo that will not load (expired signature, removed, offline): show the
  // initials again and ask for a fresh list — once; a second failure waits.
  window.cohPhotoImgError = function (img) {
    try {
      var el = img && img.parentNode; if (!el) return;
      var team = el.getAttribute('data-coh-pt'), name = el.getAttribute('data-coh-pn');
      el.removeChild(img);
      var tk = cohPhotoKey(team), pk = cohPhotoKey(name), t = teams[tk];
      if (t && t.players[pk]) t.players[pk].bad = true;
      if (!tk || (lastErrFetch[tk] && now() - lastErrFetch[tk] < ERR_GAP)) return;
      lastErrFetch[tk] = now();
      window.cohPhotosReady([team], { force: true });
    } catch (_e) {}
  };

  // Fixed size, round, so swapping a photo in never moves the layout.
  try {
    var st = document.createElement('style'); st.id = 'coh-pb-css';
    st.textContent = '.coh-pb{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;box-sizing:border-box;'
      + 'width:var(--pbs,38px);height:var(--pbs,38px);border-radius:50%;overflow:hidden;border:2px solid var(--bc,#4fc3f7);background:#10111a;color:#fff;'
      + "font:700 calc(var(--pbs,38px)*.34)/1 'Barlow Condensed',sans-serif;letter-spacing:.04em;vertical-align:middle;user-select:none;}"
      + '.coh-pb-i{pointer-events:none;}'
      + '.coh-pb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;background:#10111a;}';
    document.head.appendChild(st);
  } catch (_e) {}
})();
