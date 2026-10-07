/**
 * COHESION crests — the ONE slug rule and the shared crest resolver.
 *
 * Load after crests/index.js (bundled crests) and cohesion-edit.js (auth fetch):
 *   <script src="crests/index.js"></script>
 *   <script src="cohesion-edit.js"></script>
 *   <script src="cohesion-crests.js"></script>
 *
 *   cohCrestSlug(name)        'Béal an Mhuirthead' -> 'bealanmhuirthead'
 *                             (accent-, spacing-, punctuation- and case-insensitive).
 *                             Also the object name in the Supabase 'crests' bucket (<slug>.png).
 *   cohCrestSrc(name, pack)   image URL or null. Order: team-pack crest, then a crest
 *                             UPLOADED on crests-admin.html, then the bundled /crests file.
 *   cohCrestInfo(name, pack)  { src, source: 'pack'|'uploaded'|'bundled'|null, slug }
 *   await cohCrestsReady()    resolves (never rejects, never longer than ~2s) once the
 *                             uploaded-crest list is known. Await it before drawing an
 *                             image / PDF / infographic. { force:true } re-fetches.
 *
 * Uploaded crests live on another origin (Supabase Storage), so anything that draws
 * them on a canvas must load the image with crossOrigin='anonymous'.
 *
 * Also required by netlify/functions/crests.js (Node) for the slug rule only —
 * everything below the module.exports line is browser-only.
 */
(function () {
  'use strict';

  function cohCrestSlug(name) {
    return String(name == null ? '' : name).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  // Irish county names -> the English name games are normally stored under.
  var COUNTY_ALIASES = {
    maigheo: 'mayo', gaillimh: 'galway', roscomain: 'roscommon', sligeach: 'sligo', liatroim: 'leitrim',
    ciarrai: 'kerry', corcaigh: 'cork', baileathacliath: 'dublin', athcliath: 'dublin', cilldara: 'kildare',
    dunnangall: 'donegal', tireoghain: 'tyrone', ardmhacha: 'armagh', doire: 'derry', anclar: 'clare',
    luimneach: 'limerick', tiobraidarann: 'tipperary'
  };

  // Slugs to try for a team name, most specific first: the exact slug, then the
  // name without a "GAA / GFC / CLG / County" decoration, then a county alias.
  function cohCrestSlugCandidates(name) {
    var s = cohCrestSlug(name), out = [];
    var add = function (x) { if (x && out.indexOf(x) < 0) out.push(x); };
    add(s);
    var bare = s.replace(/(gaaclub|gaa|gfc|gac|clg)$/, '').replace(/^(clg|county)/, '');
    if (bare.length >= 3) add(bare);
    out.slice().forEach(function (x) { add(COUNTY_ALIASES[x]); });
    return out;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { cohCrestSlug: cohCrestSlug, cohCrestSlugCandidates: cohCrestSlugCandidates };
  }
  if (typeof window === 'undefined') return;

  // ── Uploaded-crest manifest: memory + localStorage (1h), one request per page ──
  var KEY = 'coh_crests_manifest_v1';
  var TTL = 60 * 60 * 1000;      // re-fetch the uploaded list at most hourly
  var WAIT = 2000;               // cohCrestsReady never holds a page longer than this
  var RETRY = 60 * 1000;         // after a failed/slow fetch, don't make exports wait again for a minute

  var list = [];                 // [{slug,name,url,updatedAt}]
  var index = {};                // slug (and its bare variants) -> url
  var loadedAt = 0, failedAt = 0, inflight = null;

  function setList(arr) {
    var clean = [], idx = {};
    (Array.isArray(arr) ? arr : []).forEach(function (c) {
      if (!c || typeof c.slug !== 'string' || typeof c.url !== 'string') return;
      if (!/^https:\/\//i.test(c.url)) return;
      clean.push({ slug: c.slug, name: String(c.name || c.slug), url: c.url, updatedAt: c.updatedAt || null });
    });
    clean.forEach(function (c) { idx[c.slug] = c.url; });                       // exact slugs win
    clean.forEach(function (c) {                                                 // "Mayo GAA" also answers "Mayo"
      cohCrestSlugCandidates(c.slug).forEach(function (v) { if (!idx[v]) idx[v] = c.url; });
    });
    list = clean; index = idx;
  }

  function readCache() {
    try {
      var j = JSON.parse(window.localStorage.getItem(KEY));
      if (j && Array.isArray(j.crests)) return j;
    } catch (_e) {}
    return null;
  }
  function writeCache() {
    try { window.localStorage.setItem(KEY, JSON.stringify({ t: loadedAt, crests: list })); } catch (_e) {}
  }

  try {
    var cached = readCache();
    if (cached) { setList(cached.crests); loadedAt = +cached.t || 0; }   // stale entries still resolve while we refresh
  } catch (_e) {}

  function fetchList() {
    if (inflight) return inflight;
    inflight = Promise.resolve().then(function () {
      if (typeof window.cohesionAuthFetch !== 'function') throw new Error('cohesion-edit.js not loaded');
      return window.cohesionAuthFetch('crests', { action: 'list' });
    }).then(function (j) {
      setList(j && j.crests);
      loadedAt = Date.now(); failedAt = 0;
      writeCache();
      return true;
    }).catch(function () {
      failedAt = Date.now();
      return false;
    }).then(function (ok) { inflight = null; return ok; });
    return inflight;
  }

  window.cohCrestsReady = function (opts) {
    try {
      var force = !!(opts && opts.force);
      var now = Date.now();
      if (!force && loadedAt && now - loadedAt < TTL) return Promise.resolve(true);
      if (!force && failedAt && now - failedAt < RETRY) return Promise.resolve(false);
      var wait = (opts && opts.timeout) || WAIT;
      return Promise.race([
        fetchList(),
        new Promise(function (res) { setTimeout(function () { failedAt = Date.now(); res(false); }, wait); })
      ]).catch(function () { return false; });
    } catch (_e) {
      return Promise.resolve(false);
    }
  };

  window.cohCrestInfo = function (name, pack) {
    var slug = cohCrestSlug(name);
    if (pack && pack.crest) return { src: pack.crest, source: 'pack', slug: slug };
    var c = cohCrestSlugCandidates(name), i;
    for (i = 0; i < c.length; i++) if (index[c[i]]) return { src: index[c[i]], source: 'uploaded', slug: slug };
    var M = window.COHESION_CRESTS || {};
    for (i = 0; i < c.length; i++) if (M[c[i]]) return { src: 'crests/' + M[c[i]], source: 'bundled', slug: slug };
    return { src: null, source: null, slug: slug };
  };
  window.cohCrestSrc = function (name, pack) { return window.cohCrestInfo(name, pack).src; };

  window.cohCrestSlug = cohCrestSlug;
  window.cohCrestSlugCandidates = cohCrestSlugCandidates;
  window.cohCrestsUploaded = function () { return list.slice(); };

  // Warm the list in the background so exports rarely have to wait at all.
  try { setTimeout(function () { window.cohCrestsReady(); }, 0); } catch (_e) {}
})();
