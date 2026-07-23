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
    let t = cu && cu.token && cu.token.access_token;
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

  // Searchable playlist picker — EVERY playlist listed (no cap), with a
  // filter box for a growing library. Shared by the dashboard and Code Room.
  // Resolves 'pl-<id>' | 'new' | 'cancel'.
  window.cohesionPlaylistPicker = function(lists, opts){
    opts = opts || {};
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
            +'<span style="font:700 9.5px \'Barlow Condensed\',sans-serif;letter-spacing:.5px;padding:2px 7px;border-radius:6px;border:1px solid var(--border,#333);color:var(--t2,#999);">'+(p.scope==='personal'?'PERSONAL':'CLUB')+'</span></div>';
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
