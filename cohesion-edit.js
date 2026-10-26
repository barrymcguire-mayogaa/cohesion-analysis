/* COHESION — shared editing helpers: batched saves, modal, leave-guard.
 *
 * Edits are held in memory (and backed up to localStorage) and pushed to
 * the database in ONE authenticated call via editEvent, instead of a token
 * fetch + write on every keystroke. A leave-guard warns before navigating
 * away with unsaved changes.
 */
(function(){
  async function authToken(){
    const ni = window.netlifyIdentity;
    const cu = ni && ((ni.gotrue && ni.gotrue.currentUser && ni.gotrue.currentUser()) || (ni.currentUser && ni.currentUser()));
    let t = (cu && cu.jwt ? await cu.jwt().catch(()=>null) : null) || (cu && cu.token && cu.token.access_token);
    if(!t && ni && ni.refresh){ try{ await ni.refresh(); const u = ni.gotrue.currentUser(); t = u && u.token && u.token.access_token; }catch(_){ } }
    return t;
  }

  // Push an array of ops ({action,id?,game_id?,data?,ref?}) in one call.
  // Returns { ok, results:[{ref, ok, id?, error?}] }.
  window.cohesionEventBatch = async function(ops){
    if(!ops || !ops.length) return { ok:true, results:[] };
    const t = await authToken();
    if(!t) throw new Error('Not signed in as admin — sign out and back in, then retry.');
    const res = await fetch('/.netlify/functions/editEvent', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+t },
      body: JSON.stringify({ ops })
    });
    const j = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(j.error || ('HTTP '+res.status));
    return j;
  };

  // Themed promise-based dialog. buttons:[{label,value,primary?,danger?}].
  window.cohesionModal = function(opts){
    return new Promise(resolve=>{
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:10000;';
      const card = document.createElement('div');
      card.style.cssText = "background:var(--panel,#1e1e28);color:var(--t1,#eee);border:1px solid var(--border,#333);border-radius:14px;padding:22px;max-width:430px;width:calc(100% - 40px);box-shadow:0 24px 64px rgba(0,0,0,.55);font-family:Barlow,sans-serif;";
      card.innerHTML = '<div style="font:800 18px \'Barlow Condensed\',sans-serif;letter-spacing:.5px;margin-bottom:8px;">'+(opts.title||'')+'</div><div style="font-size:13px;color:var(--t2,#999);line-height:1.6;margin-bottom:18px;">'+(opts.message||'')+'</div>';
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;';
      (opts.buttons || [{label:'OK',value:true,primary:true}]).forEach(b=>{
        const btn = document.createElement('button');
        btn.textContent = b.label;
        btn.style.cssText = "padding:8px 16px;border-radius:8px;font:700 12px 'Barlow Condensed',sans-serif;letter-spacing:.5px;cursor:pointer;border:1px solid var(--border,#333);" + (b.primary ? 'background:var(--accent,#4fc3f7);border-color:var(--accent,#4fc3f7);color:#fff;' : b.danger ? 'background:#dc2626;border-color:#dc2626;color:#fff;' : 'background:var(--card,#252530);color:var(--t1,#eee);');
        btn.onclick = ()=>{ if(ov.parentNode) document.body.removeChild(ov); resolve(b.value); };
        bar.appendChild(btn);
      });
      card.appendChild(bar); ov.appendChild(card); document.body.appendChild(ov);
    });
  };

  // Themed promise-based text input — use instead of window.prompt(), which the desktop app (Electron) does not
  // support (it returns nothing, so the button seemed to do nothing). Resolves the text as typed (untrimmed, like
  // prompt()) on OK / Enter, or null on Cancel / Esc. Focus goes into the box; Tab stays inside the dialog; the
  // page's keyboard shortcuts never see the typing; focus goes back where it was afterwards.
  //   const v = await cohPrompt('Player name:', '');      opts: {title, ok:'Add'}
  let _cohPromptN = 0;
  window.cohPrompt = function(message, def, opts){
    opts = opts || {};
    return new Promise(resolve=>{
      const prev = document.activeElement, uid = 'cohPrompt' + (++_cohPromptN);
      const ov = document.createElement('div');
      ov.className = 'coh-prompt';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:10010;';
      const card = document.createElement('div');
      card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', uid + '-l');
      card.style.cssText = "background:var(--panel,#1e1e28);color:var(--t1,#eee);border:1px solid var(--border,#333);border-radius:14px;padding:22px;max-width:430px;width:calc(100% - 40px);box-shadow:0 24px 64px rgba(0,0,0,.55);font-family:Barlow,sans-serif;";
      if (opts.title) { const h = document.createElement('div'); h.style.cssText = "font:800 18px 'Barlow Condensed',sans-serif;letter-spacing:.5px;margin-bottom:8px;"; h.textContent = opts.title; card.appendChild(h); }
      const lab = document.createElement('label');
      lab.id = uid + '-l'; lab.htmlFor = uid + '-i';
      lab.style.cssText = 'display:block;font-size:13px;color:var(--t2,#bbb);line-height:1.5;margin-bottom:10px;white-space:pre-line;';
      lab.textContent = String(message == null ? '' : message);   // plain text, as prompt() showed it
      const inp = document.createElement('input');
      inp.type = 'text'; inp.id = uid + '-i'; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.value = def == null ? '' : String(def);
      inp.style.cssText = 'display:block;width:100%;box-sizing:border-box;padding:9px 11px;border-radius:8px;border:1px solid var(--border,#444);background:var(--card,#252530);color:var(--t1,#eee);font:500 14px Barlow,sans-serif;margin-bottom:16px;';
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
      const mk = (label, primary) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
        b.style.cssText = "padding:8px 16px;border-radius:8px;font:700 12px 'Barlow Condensed',sans-serif;letter-spacing:.5px;cursor:pointer;border:1px solid var(--border,#333);" + (primary ? 'background:var(--accent,#4fc3f7);border-color:var(--accent,#4fc3f7);color:#fff;' : 'background:var(--card,#252530);color:var(--t1,#eee);');
        bar.appendChild(b); return b; };
      const bCancel = mk('Cancel', false), bOk = mk(opts.ok || 'OK', true);
      let done = false;
      const finish = v => {
        if (done) return; done = true;
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        try { if (prev && prev.focus && document.contains(prev)) prev.focus(); } catch (_) {}
        resolve(v);
      };
      bOk.onclick = () => finish(inp.value);
      bCancel.onclick = () => finish(null);
      card.addEventListener('keydown', e => {
        e.stopPropagation();                                  // never a page shortcut while the box is up
        if (e.isComposing) return;
        if (e.key === 'Escape') { e.preventDefault(); finish(null); return; }
        if (e.key === 'Enter' && e.target === inp) { e.preventDefault(); finish(inp.value); return; }
        if (e.key === 'Tab') {                                // keep Tab inside the dialog
          const f = [inp, bCancel, bOk], i = f.indexOf(document.activeElement);
          e.preventDefault(); f[(i < 0 ? 0 : i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
        }
      });
      ['keyup', 'keypress'].forEach(t => card.addEventListener(t, e => e.stopPropagation()));
      card.appendChild(lab); card.appendChild(inp); card.appendChild(bar); ov.appendChild(card); document.body.appendChild(ov);
      inp.focus(); try { inp.select(); } catch (_) {}
    });
  };

  // ── READ GATEWAY (hard county/club separation) ────────────────────
  // All game/event reads go through /.netlify/functions/data with the
  // signed-in user's JWT; direct anon SELECT on games/events is revoked.
  // The Identity widget restores the session ASYNCHRONOUSLY — pages that
  // read at boot (library, dashboard, code room) must wait for it or the
  // first fetch sees "not signed in". Resolves on init (or ~4s failsafe).
  let _idReady = null;
  window.cohesionIdentityReady = function(){
    if (_idReady) return _idReady;
    // The widget injects a full-viewport iframe that can sit INVISIBLY over
    // the page and eat every click. No page using this file ever shows the
    // widget UI (sign-in lives on index.html, which doesn't load this file),
    // so keep the iframe out of the way everywhere, permanently.
    try {
      const st = document.createElement('style');
      st.textContent = 'iframe#netlify-identity-widget{display:none !important;pointer-events:none !important;}';
      document.head.appendChild(st);
    } catch (_) {}
    _idReady = new Promise(res => {
      let done = false;
      const fin = () => { if (!done) { done = true; res(); } };
      const arm = () => {
        const ni = window.netlifyIdentity;
        if (!ni) return false;
        try {
          const u = (ni.gotrue && ni.gotrue.currentUser && ni.gotrue.currentUser()) || (ni.currentUser && ni.currentUser());
          if (u) { fin(); return true; }
          ni.on('init', () => { try { ni.close(); } catch (_) {} fin(); });
          try { ni.init(); } catch (_) {}
          try { ni.close(); } catch (_) {}
        } catch (_) {}
        return true;
      };
      if (!arm()) {
        let n = 0;
        const iv = setInterval(() => { if (arm() || ++n > 40) clearInterval(iv); }, 100);
      }
      setTimeout(fin, 4000);   // never wedge a page on identity problems
    });
    return _idReady;
  };

  window.cohesionAuthFetch = async function(fn, payload){
    await window.cohesionIdentityReady();
    const ni = window.netlifyIdentity;
    const cu = ni && ((ni.gotrue && ni.gotrue.currentUser && ni.gotrue.currentUser()) || (ni.currentUser && ni.currentUser()));
    let t = (cu && cu.jwt ? await cu.jwt().catch(()=>null) : null) || (cu && cu.token && cu.token.access_token);
    if (!t && ni && ni.refresh) { try { await ni.refresh(); const u = ni.gotrue.currentUser(); t = u && u.token && u.token.access_token; } catch (_) {} }
    if (!t) throw new Error('Not signed in — sign out and back in, then retry.');
    const res = await fetch('/.netlify/functions/' + fn, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
      body: JSON.stringify(payload) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
    return j;
  };
  window.cohesionRead = function(payload){ return window.cohesionAuthFetch('data', payload); };

  // ── SIGN-IN GATE ──────────────────────────────────────────────────
  // Every page checks the sessionStorage marker 'cohesion_auth' before it
  // draws. sessionStorage belongs to ONE TAB, so a page opened in a new tab,
  // from a bookmark or from a pasted link has no marker even though the
  // person is still signed in (the Identity session lives in localStorage and
  // is shared by every tab). cohesionAuthGate() therefore, when the marker is
  // missing:
  //   1. looks for the live Identity session and, if there is one, writes the
  //      markers again from ITS roles — the same derivation index.html uses
  //      at sign-in (cohesionSessionMarkers) — and lets the page carry on;
  //   2. otherwise sends the browser to index.html?next=<this page + query>,
  //      and index.html comes back here after sign-in (it accepts only a
  //      same-folder page name, see cohesionSafeNext there).
  // The markers only decide what the UI shows. Every read and write goes
  // through a Netlify function that verifies the JWT and its roles, so a
  // marker that is wrong (or forged) gets no data.
  // ── SECTIONS and ROLES — the same rules as netlify/lib/access.js (the server decides; this only draws the UI) ──
  //   capability roles: admin (everything, every section) · analyst (tag, upload, edit; no deletes / management)
  //   section roles:    club → club · u20 → u20 · any other role → county · none / analyst only → county
  //   group roles:      group:<name> (playlist sharing groups: group:coaches, group:forwards …) — never a section
  //   admin → county + club + u20; combinations → the union (club + anything else → county + club, as before)
  const COH_SECTIONS = ['county', 'club', 'u20'];
  const COH_CAP_ROLES = ['admin', 'analyst'];
  const COH_CAN = {
    admin:   ['view', 'upload', 'edit', 'playlists', 'templatesPersonal', 'templatesClub', 'deleteGame', 'manage', 'notes'],
    analyst: ['view', 'upload', 'edit', 'playlists', 'templatesPersonal', 'notes'],
  };
  const lowerRoles = roles => (Array.isArray(roles) ? roles : []).map(r => String(r).toLowerCase().trim()).filter(Boolean);
  window.cohesionSectionsOf = function(roles){
    const lower = lowerRoles(roles);
    if (lower.includes('admin')) return COH_SECTIONS.slice();
    const s = new Set();
    lower.forEach(r => { if (r === 'club' || r === 'u20') s.add(r); else if (/^group:[a-z0-9][a-z0-9_-]{0,39}$/.test(r)) return; else if (!COH_CAP_ROLES.includes(r)) s.add('county'); });   // group:<name> = a playlist-sharing group, never a section
    if (!s.size) s.add('county');
    return COH_SECTIONS.filter(x => s.has(x));
  };
  window.cohesionCanRoles = function(roles, cap){
    if (cap === 'view') return true;
    const lower = lowerRoles(roles);
    return Object.keys(COH_CAN).some(r => lower.includes(r) && COH_CAN[r].includes(cap));
  };
  // a stored section ('club' | 'u20', anything else county) and its label
  window.cohSectionOf = function(meta){
    const s = String((meta && meta.section) || '').toLowerCase();
    return s === 'club' ? 'club' : s === 'u20' ? 'u20' : 'county';
  };
  window.cohSectionLabel = function(s){ return s === 'club' ? 'Club' : s === 'u20' ? 'U20s' : 'County'; };
  // cohesion_auth: 'admin' | 'analyst' | 'viewer'. Every check written as === 'admin' therefore stays admin-only for an
  // analyst; the places an analyst may use ask cohesionCan(<capability>) instead.
  window.cohesionSessionMarkers = function(user){   // = index.html at sign-in
    const roles = (user && user.app_metadata && user.app_metadata.roles) || [];
    const lower = lowerRoles(roles);
    return { auth: lower.includes('admin') ? 'admin' : lower.includes('analyst') ? 'analyst' : 'viewer', roles: roles,
      section: window.cohesionSectionsOf(roles)[0] };
  };
  // The signed-in Identity user, synchronously: from the widget when it has
  // already started, else from the session it keeps in localStorage (the
  // record the widget itself restores from when it starts).
  window.cohesionLiveUser = function(){
    let u = null;
    try {
      const ni = window.netlifyIdentity;
      u = (ni && ((ni.gotrue && ni.gotrue.currentUser && ni.gotrue.currentUser()) || (ni.currentUser && ni.currentUser()))) || null;
    } catch (_) {}
    if (!u) {
      try {
        const j = JSON.parse(localStorage.getItem('gotrue.user') || 'null');
        if (j && typeof j === 'object' && j.token && (j.token.access_token || j.token.refresh_token)) u = j;
      } catch (_) {}
    }
    return u;
  };
  // this page as a value for index.html?next= ('' when it cannot be one)
  window.cohesionNextParam = function(loc){
    loc = loc || window.location;
    const page = String(loc.pathname || '').split('/').pop();
    if (!/^[A-Za-z0-9_-]+\.html$/.test(page) || /^index\.html$/i.test(page)) return '';
    return page + (loc.search || '') + (loc.hash || '');
  };
  // true: signed in, carry on. false: the browser is on its way to index.html.
  window.cohesionAuthGate = function(){
    try { if (sessionStorage.getItem('cohesion_auth')) return true; } catch (_) {}
    const u = window.cohesionLiveUser();
    if (u) {
      try {
        const m = window.cohesionSessionMarkers(u);
        sessionStorage.setItem('cohesion_auth', m.auth);
        sessionStorage.setItem('cohesion_roles', JSON.stringify(m.roles));
        if (!sessionStorage.getItem('cohesion_section')) sessionStorage.setItem('cohesion_section', m.section);
        if (u.email && !sessionStorage.getItem('cohesion_user')) sessionStorage.setItem('cohesion_user', u.email);
        if (sessionStorage.getItem('cohesion_auth')) return true;
      } catch (_) {}
    }
    const next = window.cohesionNextParam();
    window.location.href = 'index.html' + (next ? '?next=' + encodeURIComponent(next) : '');
    return false;
  };

  // Section state: which side of the county/club wall the UI is showing.
  window.cohesionRoles = function(){
    try { return JSON.parse(sessionStorage.getItem('cohesion_roles')) || []; } catch (_) { return []; }
  };
  window.cohesionSections = function(){ return window.cohesionSectionsOf(window.cohesionRoles()); };
  // may the signed-in user do this? (capabilities above; the server checks again on every call)
  window.cohesionCan = function(cap){
    let a = ''; try { a = sessionStorage.getItem('cohesion_auth') || ''; } catch (_) {}
    if (cap === 'view') return !!a;
    if (a === 'admin') return true;                          // the admin marker: everything, exactly as before
    if (a !== 'analyst') return false;                       // an analyst marker AND an analyst role
    return window.cohesionCanRoles(window.cohesionRoles(), cap);
  };
  window.cohesionSection = function(){
    const allowed = window.cohesionSections();
    let s = sessionStorage.getItem('cohesion_section');
    if (!allowed.includes(s)) s = allowed[0];
    return s;
  };
  window.cohesionSetSection = function(s){
    if (window.cohesionSections().includes(s)) sessionStorage.setItem('cohesion_section', s);
  };
  // Upload pages: which section a new game is filed under (the SECTION select): 'county' | 'club' | 'u20'.
  window.cohesionUploadSection = function(){
    const el = document.getElementById('uploadSection');
    const v = el ? String(el.value || '').toLowerCase() : '';
    return v === 'club' ? 'club' : v === 'u20' ? 'u20' : 'county';
  };
  // a batch sheet's "section" cell → 'county' | 'club' | 'u20', or null (blank / unknown: the page's select decides)
  window.cohesionSectionCell = function(v){
    const t = String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!t) return null;
    if (t === 'county' || t === 'intercounty' || t === 'senior') return 'county';
    if (t === 'club') return 'club';
    if (t === 'u20' || t === 'u20s' || t === 'under20' || t === 'under20s') return 'u20';
    return null;
  };
  // The section switcher (library, playlists …): one button per section the user can see, hidden with only one.
  //   box: the container; ids: {county:'btnId', club:'btnId', u20:'btnId'}; a missing button is created next to the last.
  window.cohesionPaintSectionSwitch = function(box, ids, onPick){
    if (!box) return;
    const secs = window.cohesionSections(), cur = window.cohesionSection();
    if (secs.length < 2) { box.style.display = 'none'; return; }
    box.style.display = 'flex';
    COH_SECTIONS.forEach(s => {
      let b = ids[s] && document.getElementById(ids[s]);
      if (!b && ids[s]) {
        const tpl = Object.keys(ids).map(k => document.getElementById(ids[k])).filter(Boolean)[0];
        b = document.createElement('button'); b.id = ids[s];
        if (tpl) b.style.cssText = tpl.style.cssText;
        b.textContent = window.cohSectionLabel(s).toUpperCase();
        if (onPick) b.onclick = () => onPick(s);
        box.appendChild(b);
      }
      if (!b) return;
      b.style.display = secs.includes(s) ? '' : 'none';
      b.style.background = s === cur ? 'var(--accent,#4fc3f7)' : 'transparent';
      b.style.color = s === cur ? '#fff' : 'var(--t2,#999)';
    });
  };

  // Searchable playlist picker — every playlist the user may ADD CLIPS TO (his own, the ones he may edit; never one an
  // admin only sees because admins see everything), with a filter box for a growing library. Shared by the dashboard
  // and Code Room. Resolves 'pl-<id>' | 'new' | 'cancel'.
  window.cohesionPlaylistPicker = function(lists, opts){
    opts = opts || {};
    lists = window.cohesionAddableLists(lists);
    const escp = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    return new Promise(resolve=>{
      const ov=document.createElement('div');
      ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:10000;';
      const card=document.createElement('div');
      card.style.cssText="background:var(--panel,#1e1e28);color:var(--t1,#eee);border:1px solid var(--border,#333);border-radius:14px;padding:22px;max-width:460px;width:calc(100% - 40px);box-shadow:0 24px 64px rgba(0,0,0,.55);font-family:Barlow,sans-serif;display:flex;flex-direction:column;max-height:min(560px,86vh);";
      card.innerHTML='<div style="font:800 18px \'Barlow Condensed\',sans-serif;letter-spacing:.5px;margin-bottom:8px;">'+escp(opts.title||'Add to playlist…')+'</div>'
        +'<div style="font-size:13px;color:var(--t2,#999);line-height:1.6;margin-bottom:12px;">'+escp(opts.message||'')+'</div>'
        +'<input id="ppSearch" placeholder="Search playlists…" autocomplete="off" style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid var(--border,#333);background:var(--card,#252530);color:var(--t1,#eee);font:600 13px Barlow,sans-serif;outline:none;margin-bottom:10px;">'
        +'<div id="ppList" style="flex:1;overflow-y:auto;min-height:60px;margin-bottom:14px;border:1px solid var(--border,#333);border-radius:10px;"></div>'
        +'<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">'
        +'<button id="ppNew" style="padding:8px 16px;border-radius:8px;font:700 12px \'Barlow Condensed\',sans-serif;letter-spacing:.5px;cursor:pointer;border:1px solid var(--accent,#4fc3f7);background:var(--accent,#4fc3f7);color:#fff;">＋ New playlist…</button>'
        +'<button id="ppCancel" style="padding:8px 16px;border-radius:8px;font:700 12px \'Barlow Condensed\',sans-serif;letter-spacing:.5px;cursor:pointer;border:1px solid var(--border,#333);background:var(--card,#252530);color:var(--t1,#eee);">Cancel</button></div>';
      ov.appendChild(card); document.body.appendChild(ov);
      const done=v=>{ if(ov.parentNode) document.body.removeChild(ov); resolve(v); };
      const list=card.querySelector('#ppList'), inp=card.querySelector('#ppSearch');
      let vis=[];
      const draw=()=>{
        const q=(inp.value||'').trim().toLowerCase();
        vis=lists.filter(p=>!q||String(p.name||'').toLowerCase().includes(q));
        list.innerHTML=vis.length?vis.map((p,i)=>{
          const n=(((p.data||{}).items)||[]).length;
          return '<div class="pprow" data-i="'+i+'" style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border,#333);">'
            +'<span style="flex:1;font:700 13px Barlow,sans-serif;">'+escp(p.name)+'</span>'
            +'<span style="font-size:11px;color:var(--t2,#999);white-space:nowrap;">'+n+' clip'+(n===1?'':'s')+'</span>'
            +'<span style="font:700 9.5px \'Barlow Condensed\',sans-serif;letter-spacing:.5px;padding:2px 7px;border-radius:6px;border:1px solid var(--border,#333);color:var(--t2,#999);">'+escp(window.cohesionShareLabel(p).toUpperCase())+'</span></div>';
        }).join('')
        :'<div style="padding:14px 12px;font-size:12.5px;color:var(--t2,#999);">'+(lists.length?'No playlist matches \u201c'+escp(inp.value.trim())+'\u201d.':'No playlists yet — create the first below.')+'</div>';
        list.querySelectorAll('.pprow').forEach(r=>{
          r.onmouseenter=()=>r.style.background='var(--card,#252530)';
          r.onmouseleave=()=>r.style.background='';
          r.onclick=()=>done('pl-'+vis[+r.dataset.i].id);
        });
      };
      inp.oninput=draw;
      inp.onkeydown=ev=>{ if(ev.key==='Enter'&&vis.length) done('pl-'+vis[0].id); else if(ev.key==='Escape') done('cancel'); };
      card.querySelector('#ppNew').onclick=()=>done('new');
      card.querySelector('#ppCancel').onclick=()=>done('cancel');
      ov.onclick=ev=>{ if(ev.target===ov) done('cancel'); };
      draw(); setTimeout(()=>inp.focus(),0);
    });
  };

  // ── PLAYLIST SHARING (netlify/lib/playlistRules.js decides; this only draws) ──
  // Every signed-in user creates playlists and picks one of four levels: Only me · Named people · Groups (Identity
  // roles group:<name>) · Whole section. The function answers each playlist with canEdit / canShare / adminView …
  window.cohesionAddableLists = function(lists){
    return (lists || []).filter(p => p && p.canEdit !== false && !p.adminView);
  };
  window.cohesionShareLabel = function(p){
    const v = (p && p.visibility) || (p && p.scope === 'personal' ? 'private' : 'section');
    return v === 'private' ? 'Only me' : v === 'people' ? 'Named people' : v === 'groups' ? 'Groups' : 'Whole section';
  };
  window.COH_ADMIN_NOTE = 'Admins can see all playlists.';
  // The sharing picker. opts: {section, current:{visibility, sharePeople:[{id,name}], shareGroups:[{id,name}]}, title, ok}.
  // Resolves {visibility, scope, people:[id], groups:[id]} or null (cancel). The directory (names only, never emails)
  // comes from the playlists function; "Only me" says plainly that admins can see every playlist.
  window.cohesionShareDialog = function(opts){
    opts = opts || {};
    const esc2 = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    const cur = opts.current || {};
    let level = cur.visibility || (cur.scope === 'personal' ? 'private' : cur.scope === 'club' ? 'section' : (opts.level || 'private'));
    const pickedP = new Set((cur.sharePeople || []).map(x => String(x.id || x)));
    const pickedG = new Set((cur.shareGroups || []).map(x => String(x.id || x)));
    const secLab = typeof window.cohSectionLabel === 'function' ? window.cohSectionLabel(opts.section) : 'this';
    let dir = null, dirErr = '';
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'coh-share';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:10020;';
      const card = document.createElement('div');
      card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', opts.title || 'Who can see this playlist?');
      card.style.cssText = "background:var(--panel,#1e1e28);color:var(--t1,#eee);border:1px solid var(--border,#333);border-radius:14px;padding:22px;max-width:470px;width:calc(100% - 32px);box-shadow:0 24px 64px rgba(0,0,0,.55);font-family:Barlow,sans-serif;display:flex;flex-direction:column;max-height:min(640px,90vh);";
      ov.appendChild(card); document.body.appendChild(ov);
      const done = v => { if (ov.parentNode) ov.parentNode.removeChild(ov); resolve(v); };
      const opt = (v, t, d, extra) => '<label class="coh-sh-opt" style="display:flex;gap:10px;align-items:flex-start;padding:9px 10px;border:1px solid '+(level===v?'var(--accent,#4fc3f7)':'var(--border,#333)')+';border-radius:9px;margin-bottom:7px;cursor:pointer;">'
        + '<input type="radio" name="cohShLevel" value="'+v+'"'+(level===v?' checked':'')+' style="margin-top:3px;">'
        + '<span style="flex:1;"><b style="font:700 14px \'Barlow Condensed\',sans-serif;letter-spacing:.4px;">'+t+'</b><span style="display:block;font-size:12px;color:var(--t2,#999);line-height:1.45;">'+d+'</span>'+(extra||'')+'</span></label>';
      const pickList = (items, set, kind) => {
        if (!dir) return '<div style="font-size:12px;color:var(--t2,#999);padding:6px 0;">'+(dirErr?esc2(dirErr):'Loading…')+'</div>';
        if (!items.length) return '<div style="font-size:12px;color:var(--t2,#999);padding:6px 0;">'+(kind==='g'?'No groups set up yet. An admin adds them as Netlify Identity roles such as group:forwards.':(dir.available===false?'The people list is not available right now.':'Nobody else in this section yet.'))+'</div>';
        return (kind==='p'?'<input class="coh-sh-q" placeholder="Search names…" autocomplete="off" style="width:100%;box-sizing:border-box;margin:6px 0;padding:7px 10px;border-radius:7px;border:1px solid var(--border,#333);background:var(--card,#252530);color:var(--t1,#eee);font:13px Barlow,sans-serif;">':'')
          + '<div class="coh-sh-list" style="max-height:180px;overflow-y:auto;border:1px solid var(--border,#333);border-radius:8px;">'
          + items.map(x => '<label data-n="'+esc2(String(x.name).toLowerCase())+'" style="display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--border,#333);font-size:13px;cursor:pointer;"><input type="checkbox" data-kind="'+kind+'" value="'+esc2(x.id)+'"'+(set.has(String(x.id))?' checked':'')+'>'+esc2(x.name)+(kind==='g'&&x.members!=null?' <span style="color:var(--t3,#777);font-size:11px;">('+x.members+')</span>':'')+'</label>').join('')
          + '</div>';
      };
      const draw = () => {
        card.innerHTML = '<div style="font:800 18px \'Barlow Condensed\',sans-serif;letter-spacing:.5px;margin-bottom:6px;">'+esc2(opts.title||'Who can see this playlist?')+'</div>'
          + '<div style="font-size:12.5px;color:var(--t2,#999);line-height:1.5;margin-bottom:12px;">Only people who can see the '+esc2(secLab)+' section can ever see it. Everyone who can see it can comment.</div>'
          + '<div style="overflow-y:auto;flex:1;">'
          + opt('private', 'Only me', 'Just you.', '<span class="coh-admin-note" style="display:block;margin-top:3px;font-size:11px;color:var(--orange,#ff9800);">'+esc2(window.COH_ADMIN_NOTE)+'</span>')
          + opt('people', 'Named people', 'You and the people you pick.', level==='people'?pickList((dir&&dir.people)||[], pickedP, 'p'):'')
          + opt('groups', 'Groups', 'You and everyone in the groups you pick (e.g. Forwards, Coaches).', level==='groups'?pickList((dir&&dir.groups)||[], pickedG, 'g'):'')
          + opt('section', 'Whole section', 'Everyone in the '+esc2(secLab)+' section.')
          + '</div><div class="coh-sh-err" role="alert" style="font-size:12px;color:var(--red,#f44336);min-height:16px;margin:6px 0;"></div>'
          + '<div style="display:flex;gap:8px;justify-content:flex-end;"><button type="button" class="coh-sh-cancel" style="padding:8px 16px;border-radius:8px;font:700 12px \'Barlow Condensed\',sans-serif;cursor:pointer;border:1px solid var(--border,#333);background:var(--card,#252530);color:var(--t1,#eee);">Cancel</button>'
          + '<button type="button" class="coh-sh-ok" style="padding:8px 16px;border-radius:8px;font:700 12px \'Barlow Condensed\',sans-serif;cursor:pointer;border:1px solid var(--accent,#4fc3f7);background:var(--accent,#4fc3f7);color:#fff;">'+esc2(opts.ok||'Save')+'</button></div>';
        card.querySelectorAll('input[name="cohShLevel"]').forEach(r => r.onchange = () => { level = r.value; if ((level === 'people' || level === 'groups') && !dir) loadDir(); draw(); });
        card.querySelectorAll('input[type="checkbox"]').forEach(c => c.onchange = () => { const set = c.dataset.kind === 'p' ? pickedP : pickedG; if (c.checked) set.add(c.value); else set.delete(c.value); });
        const q = card.querySelector('.coh-sh-q'); if (q) q.oninput = () => { const t = q.value.trim().toLowerCase(); card.querySelectorAll('.coh-sh-list label').forEach(l => l.style.display = !t || l.dataset.n.includes(t) ? '' : 'none'); };
        card.querySelector('.coh-sh-cancel').onclick = () => done(null);
        card.querySelector('.coh-sh-ok').onclick = () => {
          const err = card.querySelector('.coh-sh-err');
          if (level === 'people' && !pickedP.size) { err.textContent = 'Pick at least one person.'; return; }
          if (level === 'groups' && !pickedG.size) { err.textContent = 'Pick at least one group.'; return; }
          done({ visibility: level, scope: level === 'section' ? 'club' : 'personal', people: level === 'people' ? [...pickedP] : [], groups: level === 'groups' ? [...pickedG] : [] });
        };
      };
      const loadDir = () => {
        const f = opts.fetch || window.cohesionAuthFetch;
        Promise.resolve().then(() => f('playlists', { action: 'directory', section: opts.section }))
          .then(j => { dir = j || { people: [], groups: [] }; draw(); })
          .catch(e => { dirErr = 'Could not load the list: ' + ((e && e.message) || e); dir = null; draw(); });
      };
      card.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); done(null); } });
      ov.onclick = ev => { if (ev.target === ov) done(null); };
      if (level === 'people' || level === 'groups') loadDir();
      draw();
    });
  };
  // New playlist: a name, then who can see it. Resolves {name, share} or null.
  window.cohesionAskNewPlaylist = async function(opts){
    opts = opts || {};
    const ask = typeof window.cohPrompt === 'function' ? window.cohPrompt : (m, d) => Promise.resolve(window.prompt(m, d));
    const name = String((await ask(opts.message || 'New playlist name:', '')) || '').trim().slice(0, 80);
    if (!name) return null;
    const share = await window.cohesionShareDialog({ section: opts.section, title: 'Who can see “' + name + '”?', ok: opts.ok || 'Create', fetch: opts.fetch, level: opts.level || 'private' });
    return share ? { name, share } : null;
  };
  // the "new comments" badge on a Playlists link / title: el gets a small count pill (hidden at 0)
  window.cohesionPlaylistBadge = async function(el, opts){
    if (!el) return 0;
    let n = 0;
    try { const f = (opts && opts.fetch) || window.cohesionAuthFetch; const j = await f('playlists', { action: 'unread' }); n = (j && j.total) || 0; } catch (_) { return 0; }
    let b = el.querySelector('.coh-pl-badge');
    if (!b) { b = document.createElement('span'); b.className = 'coh-pl-badge'; b.setAttribute('aria-live', 'polite');
      b.style.cssText = 'display:none;margin-left:6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#e53935;color:#fff;font:800 11px/18px Barlow,sans-serif;text-align:center;'; el.appendChild(b); }
    b.textContent = n > 99 ? '99+' : String(n); b.title = n + ' new comment' + (n === 1 ? '' : 's') + ' on your playlists';
    b.style.display = n ? 'inline-block' : 'none';
    return n;
  };

  // Leave-guard. Pages register hasPending() and saveAll(). In-app navigation
  // should call cohesionGuardedGo(urlOrFn); browser back/close/refresh gets the
  // generic beforeunload warning (custom dialogs aren't allowed there).
  let hasPending = ()=>false, saveAll = async()=>{}, leaving = false;
  window.cohesionSetGuard = function(hp, sa){ hasPending = hp || (()=>false); saveAll = sa || (async()=>{}); };
  // Only nag on a browser-initiated unload (back/close/refresh). When WE
  // navigate after the custom dialog, `leaving` is set so this handler stays
  // quiet — otherwise programmatic navigation re-triggers it and the user
  // gets a second, generic browser prompt on top of the custom one.
  window.addEventListener('beforeunload', function(e){ if(!leaving && hasPending()){ e.preventDefault(); e.returnValue = ''; } });
  window.cohesionGuardedGo = async function(target){
    const go = ()=>{ leaving = true; if(typeof target === 'function') target(); else window.location.href = target; };
    if(!hasPending()){ go(); return; }
    const c = await cohesionModal({
      title:'Unsaved changes',
      message:'You have unsaved changes. Save them before leaving?',
      buttons:[
        { label:'Save & leave', value:'save', primary:true },
        { label:'Discard & leave', value:'discard', danger:true },
        { label:'Cancel', value:'cancel' }
      ]
    });
    if(c === 'cancel') return;
    if(c === 'save'){
      try{ await saveAll(); }
      catch(e){ alert('Save failed: '+e.message+'\nStaying on the page so nothing is lost.'); return; }
    }
    go();
  };
})();
