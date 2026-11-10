/* COHESION — the Match Dashboard as a LIVE pop-out of Code Room (web): dashboard.html?game=<id>&live=1, opened by
 * Code Room's 📊 Stats → "⧉ Pop out". The dashboard for that game on its Stats view, read-only, without its video.
 * Code Room sends its in-memory events (unsaved changes included) over a BroadcastChannel ('cohesion-live')
 * whenever they change; this page re-renders from them — the filters, the view and the scroll position stay.
 * The same re-render as the desktop app's live stats window (cohesion-desktop app/desktop/live-dash.js); in the
 * desktop app that script runs instead and this one stands aside.
 */
(function(){
  'use strict';
  var q = new URLSearchParams(location.search);
  if(!q.get('live') || (window.cohDesktop && window.cohDesktop.live) || typeof BroadcastChannel !== 'function') return;
  var id = q.get('game'); if(!id) return;
  document.documentElement.classList.add('coh-live');
  var st = document.createElement('style');
  st.textContent = '.coh-live main{grid-template-columns:1fr !important;}'
    + '.coh-live .right-panel{display:none !important;}'
    + '.coh-live .left-panel{width:100%;max-width:880px;margin:0 auto;border-left:1px solid var(--border);}'
    + '.coh-livechip{align-self:center;font:800 10.5px "Barlow Condensed",sans-serif;letter-spacing:.08em;color:#04130a;background:#22c55e;border-radius:6px;padding:4px 9px;white-space:nowrap;}'
    + '.coh-livechip.off{background:#9ca3af;}';
  document.head.appendChild(st);
  window.dashRestoreBackup = async function(){};   // read-only: never offers the dashboard's own unsaved edits
  window.makeYTP = function(){};                   // no video here (Code Room has it)
  var ch = new BroadcastChannel('cohesion-live'), booted = false, pending = null, n = 0, lastAt = 0;
  function stamp(){
    var c = document.getElementById('cohLiveChip');
    if(!c){
      var h = document.querySelector('header .hdr-actions'); if(!h) return;
      c = document.createElement('span'); c.id = 'cohLiveChip'; c.className = 'coh-livechip';
      c.title = 'Follows Code Room as you tag, edit and delete — before you save. Read-only.';
      h.insertBefore(c, h.firstChild);
    }
    var t = lastAt ? new Date(lastAt) : null, p = function(x){ return String(x).padStart(2, '0'); };
    c.classList.toggle('off', !lastAt);
    c.textContent = '● LIVE FROM CODE ROOM' + (t ? ' · ' + (typeof ALL !== 'undefined' ? ALL.length : 0) + ' events · ' + p(t.getHours()) + ':' + p(t.getMinutes()) + ':' + p(t.getSeconds()) : ' · waiting for Code Room…');
  }
  function apply(json){
    var evs; try{ evs = JSON.parse(json); }catch(_){ return; }
    if(!Array.isArray(evs)) return;
    var es = document.getElementById('ES'), top = es ? es.scrollTop : 0;
    ALL = evs.map(function(e){ return Object.assign({}, e); });
    DASH_GFX.setContext({ game: GAME, events: ALL });
    applyVisualSyncCorrections(ALL);
    cohGfxSortEvents(ALL);
    PTM = {}; buildPTM();
    var fp = document.getElementById('FP'), keep = fp ? fp.value : '';
    try{ populatePl(); }catch(_){}
    if(fp && keep && [].some.call(fp.options, function(o){ return o.value === keep; })) fp.value = keep;
    applyF();
    try{ sbTick(); }catch(_){}
    es = document.getElementById('ES'); if(es) es.scrollTop = top;
    n++; lastAt = Date.now(); stamp();
    window.__cohLiveDash = { updates: n, at: lastAt, events: ALL.length };
  }
  ch.onmessage = function(m){
    var d = (m && m.data) || {};
    if(d.game !== id) return;
    if(d.t === 'events'){ if(!booted){ pending = d.json; return; } apply(d.json); }
  };
  var tries = 0, iv = setInterval(function(){
    if(++tries > 600){ clearInterval(iv); return; }
    if(!(document.getElementById('ES') && typeof GAME !== 'undefined' && GAME && GAME.homeTeam && typeof setVM === 'function')) return;
    clearInterval(iv);
    try{ setVM('stats'); }catch(_){}
    booted = true; stamp();
    window.__cohLiveDash = { updates: 0, at: 0, events: ALL.length };
    if(pending){ var x = pending; pending = null; apply(x); }
    ch.postMessage({ t: 'want', game: id });
  }, 100);
  // Code Room reloaded or opened later: ask again now and then until it answers
  setInterval(function(){ if(booted && !lastAt) ch.postMessage({ t: 'want', game: id }); }, 3000);
})();
