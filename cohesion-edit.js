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

  // Leave-guard. Pages register hasPending() and saveAll(). In-app navigation
  // should call cohesionGuardedGo(urlOrFn); browser back/close/refresh gets the
  // generic beforeunload warning (custom dialogs aren't allowed there).
  let hasPending = ()=>false, saveAll = async()=>{};
  window.cohesionSetGuard = function(hp, sa){ hasPending = hp || (()=>false); saveAll = sa || (async()=>{}); };
  window.addEventListener('beforeunload', function(e){ if(hasPending()){ e.preventDefault(); e.returnValue = ''; } });
  window.cohesionGuardedGo = async function(target){
    const go = ()=>{ if(typeof target === 'function') target(); else window.location.href = target; };
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
