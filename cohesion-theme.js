// Modern light/dark pill toggle — swaps in for the emoji theme button on
// every page, in place. Sun and moon icons sit inside the pill and the knob
// slides across (~0.3s) to cover the active side.
(function(){
  const el=document.getElementById('themeToggle')||document.getElementById('TH');
  if(!el) return;
  const css=document.createElement('style');
  css.textContent=`
.theme-pill{position:relative;width:60px !important;height:30px !important;min-width:60px;border-radius:15px !important;
  cursor:pointer;flex:none;padding:0 !important;box-sizing:border-box;display:inline-block !important;
  background:#e7e9ef !important;border:1px solid #c9cdd6 !important;box-shadow:inset 0 2px 5px rgba(0,0,0,.12);
  transition:background .3s,border-color .3s;font-size:0 !important;line-height:0;}
.theme-pill.tp-dark{background:#22232b !important;border-color:#3a3b45 !important;box-shadow:inset 0 2px 6px rgba(0,0,0,.5);}
.theme-pill .tp-knob{position:absolute;top:2px;left:2px;width:24px;height:24px;border-radius:50%;z-index:2;
  background:#ffffff;box-shadow:0 2px 5px rgba(0,0,0,.35);transition:transform .3s cubic-bezier(.4,0,.2,1),background .3s;}
.theme-pill.tp-dark .tp-knob{transform:translateX(30px);background:#14151c;box-shadow:0 2px 6px rgba(0,0,0,.6),inset 0 0 0 1px #3a3b45;}
.theme-pill svg{position:absolute;top:50%;margin-top:-8px;width:16px;height:16px;z-index:3;transition:color .3s,opacity .3s;pointer-events:none;}
.theme-pill .tp-sun{left:7px;color:#b7873a;}
.theme-pill .tp-moon{right:7px;color:#9aa0ab;opacity:.55;}
.theme-pill:not(.tp-dark) .tp-sun{color:#f5a623;}
.theme-pill:not(.tp-dark) .tp-moon{opacity:.4;}
.theme-pill.tp-dark .tp-sun{color:#8a8f99;opacity:.55;}
.theme-pill.tp-dark .tp-moon{color:#e8eaf0;opacity:1;}
`;
  document.head.appendChild(css);
  const PILL='<svg class="tp-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6M4.4 4.4l1.9 1.9M17.7 17.7l1.9 1.9M19.6 4.4l-1.9 1.9M6.3 17.7l-1.9 1.9"/></svg>'
    +'<svg class="tp-moon" viewBox="0 0 24 24" fill="currentColor"><path d="M20.6 14.8A8.7 8.7 0 0 1 9.2 3.4a8.7 8.7 0 1 0 11.4 11.4z"/></svg>'
    +'<span class="tp-knob"></span>';
  const render=()=>{ el.classList.add('theme-pill'); if(!el.querySelector('.tp-knob')) el.innerHTML=PILL; };
  const sync=()=>{
    let t=document.documentElement.getAttribute('data-theme');
    if(!t){ try{ t=localStorage.getItem('cohesion_theme'); }catch(_e){} }
    el.classList.toggle('tp-dark',(t||'dark')!=='light');
  };
  render(); sync();
  // the pages' toggleTheme/initTheme write an emoji into the element with
  // textContent, wiping the pill — re-render after every call
  ['toggleTheme','initTheme'].forEach(fn=>{
    const orig=window[fn];
    if(typeof orig==='function') window[fn]=function(){ const r=orig.apply(this,arguments); render(); sync(); return r; };
  });
})();
