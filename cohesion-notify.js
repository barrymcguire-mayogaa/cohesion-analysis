/* COHESION — the 🔔 notification bell in the page header (Barry, Oct 2026). Self-contained: its own CSS, its own fetch.
 *
 * One <script src="cohesion-notify.js"></script> at the end of a page's body. The bell mounts itself into
 * <span id="cohBellSlot"></span> when the header has one, else just before the header's theme toggle (#themeToggle; the
 * Match Dashboard's is #TH), else at the end of the header's actions. It stays hidden until the server has answered, so
 * a page that is offline, signed out or in the desktop app shows nothing at all (and never an error).
 *
 * Items come from netlify/functions/notifications.js (new games, new comments on your playlists / threads, playlists
 * shared with you, and for admins invites accepted) — only for your own sections. A red dot with the unread count
 * (9+ at most) sits on the bell; clicking it opens the list under it. Clicking an item marks it read and opens it;
 * "Mark all read" clears the dot. The list closes on a page scroll, a click elsewhere or Escape.
 * Polling: on load, then every 5 minutes while the page is visible (never while it is hidden); back on a tab after 5+ minutes it checks at once. No websockets.
 * When the SQL has not been run (stored:false) the read state is kept in this browser instead (localStorage).
 */
(function () {
  'use strict';
  if (window.__cohBell) return; window.__cohBell = true;
  try { if (location.protocol === 'cohesion:' || location.protocol === 'file:') return; } catch (_) { return; }   // the desktop app: offline pages
  const POLL_MS = 300000, FN = '/.netlify/functions/notifications';

  // ── signed in? (the pages' own marker, else the Identity session) ──
  function signedIn() {
    try { if (sessionStorage.getItem('cohesion_auth')) return true; } catch (_) {}
    try { if (typeof window.cohesionLiveUser === 'function' && window.cohesionLiveUser()) return true; } catch (_) {}
    try { const j = JSON.parse(localStorage.getItem('gotrue.user') || 'null'); return !!(j && j.token); } catch (_) { return false; }
  }
  async function tokenOf() {
    const ni = window.netlifyIdentity;
    const cu = ni && ((ni.gotrue && ni.gotrue.currentUser && ni.gotrue.currentUser()) || (ni.currentUser && ni.currentUser()));
    let t = (cu && cu.jwt ? await cu.jwt().catch(() => null) : null) || (cu && cu.token && cu.token.access_token);
    return t || null;
  }
  async function call(payload) {
    if (typeof window.cohesionAuthFetch === 'function') return window.cohesionAuthFetch('notifications', payload);
    const t = await tokenOf(); if (!t) throw new Error('not signed in');
    const res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(payload) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
    return j;
  }

  // ── the read state kept in this browser when the server cannot keep it (SQL not run yet) ──
  const who = () => { try { return (sessionStorage.getItem('cohesion_user') || '').toLowerCase(); } catch (_) { return ''; } };
  const LKEY = () => 'cohesion_notify_' + who();
  function local() {
    let s = null; try { s = JSON.parse(localStorage.getItem(LKEY()) || 'null'); } catch (_) {}
    if (!s || typeof s !== 'object' || !s.since) { s = { since: new Date().toISOString(), readAll: null, read: {} }; saveLocal(s); }
    if (!s.read || typeof s.read !== 'object') s.read = {};
    return s;
  }
  function saveLocal(s) { try { localStorage.setItem(LKEY(), JSON.stringify(s)); } catch (_) {} }
  function applyLocal(items) {
    const s = local(), since = Date.parse(s.since) || 0, all = Date.parse(s.readAll || 0) || 0;
    return items.filter(i => (Date.parse(i.ts) || 0) > since)
      .map(i => Object.assign({}, i, { unread: (Date.parse(i.ts) || 0) > Math.max(all, Date.parse(s.read[i.key] || 0) || 0) }));
  }

  // ── CSS ──
  const css = `
.coh-bell-wrap{position:relative;display:inline-flex;align-items:center;flex:none;}
.coh-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;margin:0 6px 0 0;border-radius:50%;
  border:1px solid var(--border,rgba(255,255,255,.12));background:var(--card,#252530);color:var(--t1,#f0f0f5);font-size:17px;line-height:1;cursor:pointer;flex:none;}
.coh-bell:hover,.coh-bell[aria-expanded="true"]{background:var(--hover,#2c2c3a);}
.coh-bell:focus-visible{outline:2px solid var(--accent,#4fc3f7);outline-offset:2px;}
.coh-bell-dot{position:absolute;top:-4px;right:-5px;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;background:#e53935;color:#fff;
  font:800 10.5px/18px Barlow,'Barlow Condensed',system-ui,sans-serif;text-align:center;border:2px solid var(--panel,#1e1e28);pointer-events:none;}
.coh-bell-pop{position:fixed;z-index:100000;width:360px;box-sizing:border-box;background:var(--panel,#1e1e28);color:var(--t1,#f0f0f5);
  border:1px solid var(--border,rgba(255,255,255,.12));border-radius:12px;box-shadow:0 12px 36px var(--shadow,rgba(0,0,0,.45));overflow:hidden;font-family:Barlow,system-ui,sans-serif;}
.coh-bell-hd{display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid var(--border,rgba(255,255,255,.1));}
.coh-bell-hd b{flex:1;font:800 13px 'Barlow Condensed',Barlow,sans-serif;letter-spacing:.8px;text-transform:uppercase;}
.coh-bell-all{background:none;border:none;color:var(--accent,#4fc3f7);font:700 12px Barlow,sans-serif;cursor:pointer;padding:4px 2px;}
.coh-bell-all:disabled{color:var(--t3,#666);cursor:default;}
.coh-bell-list{max-height:min(420px,65vh);overflow-y:auto;overscroll-behavior:contain;margin:0;padding:0;list-style:none;}
.coh-bell-it{display:flex;gap:10px;align-items:flex-start;width:100%;box-sizing:border-box;text-align:left;padding:11px 14px;border:none;border-bottom:1px solid var(--border,rgba(255,255,255,.06));
  background:transparent;color:var(--t2,#9a9ab0);font:500 13px/1.35 Barlow,sans-serif;cursor:pointer;}
.coh-bell-it:hover,.coh-bell-it:focus-visible{background:var(--hover,#2c2c3a);outline:none;}
.coh-bell-it.unread{color:var(--t1,#f0f0f5);font-weight:600;background:var(--accent-bg,rgba(79,195,247,.08));}
.coh-bell-it .ic{flex:none;width:22px;text-align:center;font-size:15px;line-height:18px;}
.coh-bell-it .tx{flex:1;min-width:0;overflow-wrap:anywhere;}
.coh-bell-it .mt{display:block;margin-top:2px;font:500 11px Barlow,sans-serif;color:var(--t3,#77778c);}
.coh-bell-it .ud{flex:none;width:8px;height:8px;margin-top:6px;border-radius:50%;background:#e53935;}
.coh-bell-empty{padding:22px 14px;text-align:center;color:var(--t2,#999);font:500 13px Barlow,sans-serif;}
`;
  function addCss() { if (document.getElementById('cohBellCss')) return; const st = document.createElement('style'); st.id = 'cohBellCss'; st.textContent = css; document.head.appendChild(st); }

  // ── state ──
  let ITEMS = [], STORED = true, OPEN = false, LAST = 0, BUSY = false, WRAP = null, BTN = null, DOT = null, POP = null, ever = false;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICON = { game: '🎬', comment: '💬', share: '🔗', invite: '✅' };
  function ago(ts) {
    const s = Math.max(0, (Date.now() - (Date.parse(ts) || 0)) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    const d = Math.floor(s / 86400); return d === 1 ? 'yesterday' : d + ' days ago';
  }
  const unreadN = () => ITEMS.filter(i => i.unread).length;

  function mount() {
    const header = document.querySelector('header');
    let slot = document.getElementById('cohBellSlot');
    if (!slot) {
      const th = document.getElementById('themeToggle') || document.getElementById('TH');
      slot = document.createElement('span'); slot.id = 'cohBellSlot';
      if (th && th.parentNode) th.parentNode.insertBefore(slot, th);
      else if (header) { const acts = header.querySelector('.hdr-actions'); (acts || header).insertBefore(slot, acts ? acts.firstChild : null); }
      else return false;
    }
    WRAP = document.createElement('span'); WRAP.className = 'coh-bell-wrap'; WRAP.style.display = 'none';
    WRAP.innerHTML = '<button type="button" class="coh-bell" id="cohBell" aria-label="Notifications" aria-haspopup="true" aria-expanded="false" title="Notifications">🔔<span class="coh-bell-dot" style="display:none"></span></button>';
    slot.appendChild(WRAP);
    BTN = WRAP.querySelector('.coh-bell'); DOT = WRAP.querySelector('.coh-bell-dot');
    BTN.addEventListener('click', e => { e.stopPropagation(); OPEN ? close() : open(); });
    return true;
  }
  function paintDot() {
    const n = unreadN();
    DOT.textContent = n > 9 ? '9+' : String(n); DOT.style.display = n ? '' : 'none';
    BTN.setAttribute('aria-label', n ? 'Notifications, ' + n + ' unread' : 'Notifications');
    BTN.title = n ? n + ' new notification' + (n === 1 ? '' : 's') : 'Notifications';
  }
  function place() {
    if (!POP || !BTN) return;
    // inside what the screen shows (the visual viewport): on a phone a header wider than the screen widens the layout
    // viewport, so its width alone would let the list run off the side
    const r = BTN.getBoundingClientRect(), vv = window.visualViewport;
    const x0 = vv ? vv.offsetLeft : 0, vw = vv ? vv.width : (document.documentElement.clientWidth || window.innerWidth);
    const w = Math.min(360, vw - 16);
    POP.style.width = w + 'px';
    let left = r.right - w; left = Math.max(x0 + 8, Math.min(left, x0 + vw - w - 8));
    POP.style.left = left + 'px'; POP.style.top = Math.round(r.bottom + 8) + 'px';
  }
  function drawList() {
    if (!POP) return;
    const n = unreadN();
    POP.innerHTML = '<div class="coh-bell-hd"><b>Notifications</b><button type="button" class="coh-bell-all"' + (n ? '' : ' disabled') + '>Mark all read</button></div>'
      + (ITEMS.length ? '<ul class="coh-bell-list">' + ITEMS.map((it, i) => '<li><button type="button" class="coh-bell-it' + (it.unread ? ' unread' : '') + '" data-i="' + i + '" data-key="' + esc(it.key) + '">'
        + '<span class="ic" aria-hidden="true">' + (ICON[it.type] || '🔔') + '</span><span class="tx">' + esc(it.text)
        + '<span class="mt">' + esc((it.sub ? it.sub + ' · ' : '') + ago(it.ts)) + '</span></span>' + (it.unread ? '<span class="ud" aria-label="unread"></span>' : '') + '</button></li>').join('') + '</ul>'
        : '<div class="coh-bell-empty">Nothing new in the last 30 days.</div>');
    POP.querySelector('.coh-bell-all').onclick = e => { e.stopPropagation(); markAll(); };
    POP.querySelectorAll('.coh-bell-it').forEach(b => { b.onclick = e => { e.stopPropagation(); go(ITEMS[+b.dataset.i]); }; });
  }
  function open() {
    if (OPEN) return; OPEN = true;
    POP = document.createElement('div'); POP.className = 'coh-bell-pop'; POP.id = 'cohBellPop'; POP.setAttribute('role', 'dialog'); POP.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(POP); drawList(); place();
    BTN.setAttribute('aria-expanded', 'true');
    if (Date.now() - LAST > 90000) poll();   // a fresh look when opened, at most every 90 s
  }
  function close() {
    if (!OPEN) return; OPEN = false;
    if (POP && POP.parentNode) POP.parentNode.removeChild(POP); POP = null;
    if (BTN) BTN.setAttribute('aria-expanded', 'false');
  }
  // close on a page scroll (not a scroll inside the list), a click / tap elsewhere, Escape, a resize
  window.addEventListener('scroll', e => { if (OPEN && !(POP && e.target instanceof Node && POP.contains(e.target))) close(); }, true);
  document.addEventListener('pointerdown', e => { if (OPEN && !(POP && POP.contains(e.target)) && !(WRAP && WRAP.contains(e.target))) close(); }, true);
  document.addEventListener('keydown', e => { if (OPEN && e.key === 'Escape') { close(); try { BTN.focus(); } catch (_) {} } });
  window.addEventListener('resize', () => { if (OPEN) close(); });

  function markLocal(keys) {
    const s = local(), now = new Date().toISOString();
    keys.forEach(k => { s.read[k] = now; });
    Object.keys(s.read).forEach(k => { if (Date.now() - (Date.parse(s.read[k]) || 0) > 31 * 864e5) delete s.read[k]; });
    saveLocal(s);
  }
  const within = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
  async function go(it) {
    if (!it) return;
    it.unread = false; paintDot(); drawList();
    if (STORED) await within(call({ action: 'read', keys: [it.key] }).catch(() => null), 1500);
    else markLocal([it.key]);
    close();
    try { if (it.section && typeof window.cohesionSetSection === 'function') window.cohesionSetSection(it.section); } catch (_) {}
    if (!it.url) return;
    if (typeof window.cohesionGuardedGo === 'function') window.cohesionGuardedGo(it.url); else window.location.href = it.url;
  }
  async function markAll() {
    ITEMS.forEach(i => { i.unread = false; }); paintDot(); drawList();
    if (STORED) { try { await call({ action: 'readAll' }); } catch (_) {} }
    else { const s = local(); s.readAll = new Date().toISOString(); s.read = {}; saveLocal(s); }
  }

  async function poll() {
    if (BUSY) return; BUSY = true;
    try {
      const j = await call({ action: 'list' });
      if (!j || !Array.isArray(j.items)) throw new Error('no items');
      if (j.offline) { WRAP.style.display = 'none'; return; }
      STORED = j.stored !== false;
      ITEMS = STORED ? j.items : applyLocal(j.items);
      LAST = Date.now(); ever = true;
      WRAP.style.display = ''; paintDot();
      if (OPEN) drawList();
    } catch (_) {
      if (!ever && WRAP) WRAP.style.display = 'none';   // offline / signed out / the function not there: show nothing
    } finally { BUSY = false; }
  }
  // the Library's 🎞 Playlists button used to carry its own number; the bell has it now
  function dropOldBadge() { const b = document.querySelector('#plNavBtn .coh-pl-badge'); if (b) b.style.display = 'none'; }

  function start() {
    if (!signedIn()) return;
    addCss();
    if (!mount()) return;
    dropOldBadge();
    poll();
    setInterval(() => { if (document.visibilityState === 'visible') poll(); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - LAST >= POLL_MS) poll(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.cohesionNotify = { poll, open, close, items: () => ITEMS.slice() };   // for the tests
})();
