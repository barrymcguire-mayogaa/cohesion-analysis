/* COHESION — team colours made readable on screen (shared, display only).
 *
 * A team colour that is dark (Ballinrobe maroon, navy, black) nearly vanishes on
 * the dark theme; a very pale one (white, pale yellow) vanishes on the light
 * theme. On screen every team colour is drawn through cohTeamInk: the SAME hue,
 * lightened (dark theme) or darkened (light theme) only as far as it takes to
 * reach a WCAG contrast of 3:1 against that theme's background — the WCAG 2.x
 * minimum for UI marks and large text (1.4.11 / 1.4.3 large). A colour that
 * already reaches 3:1 comes back exactly as given.
 *
 *   background (reference)   dark theme  #1e1e28  (--panel of Code Room / Dashboard / Library)
 *                            light theme #f0eeeb  (--bg, the darkest light surface)
 *   lighten / darken          mixed toward #ffffff / #000000 in sRGB; that keeps
 *                             the HSL hue exactly (only lightness / saturation move);
 *                             the smallest mix that reaches 3:1 is used (bisection)
 *
 * DISPLAY ONLY. The saved game colours (meta.homeColor / awayColor), the XML
 * export (cohesion-xml.js) and the rendered images (cohesion-graphics.js canvas
 * and jsPDF renderers, which carry their own rules) never go through this.
 *
 *   cohTeamInk(hex, opts?)          -> '#rrggbb' readable on the current theme
 *                                      opts.theme 'dark'|'light' (default: the page's data-theme)
 *                                      opts.bg    a background hex to measure against instead
 *                                      opts.min   contrast to reach (default 3)
 *                                      anything that is not a #rgb / #rrggbb hex is returned as is
 *   cohTeamTint(hex, alpha, opts?)  -> 'rgba(r,g,b,alpha)' wash of the ink colour ('' for a non-hex)
 *   cohInkOn(fillHex)               -> '#111' or '#fff', whichever has more WCAG contrast
 *                                      on that fill (text ON a team-coloured box; the box keeps its colour)
 *   cohInkTheme()                   -> 'dark' | 'light' (the page's current theme)
 *   cohContrast(a, b)               -> WCAG contrast ratio of two hexes
 *   cohOnThemeChange(fn)            -> fn(theme) after every light/dark switch (data-theme changes)
 */
(function(){
  if(typeof window==='undefined') return;
  var BG={dark:'#1e1e28', light:'#f0eeeb'}, MIN=3;
  function parse(hex){
    var h=String(hex==null?'':hex).trim().replace(/^#/,'');
    if(/^[0-9a-f]{3}$/i.test(h)) h=h.replace(/./g,function(c){ return c+c; });
    if(!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function toHex(rgb){ return '#'+rgb.map(function(v){ return Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0'); }).join(''); }
  function lin(c){ c/=255; return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4); }
  function relLum(rgb){ return 0.2126*lin(rgb[0])+0.7152*lin(rgb[1])+0.0722*lin(rgb[2]); }
  function ratio(a,b){ var la=relLum(a), lb=relLum(b); return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05); }
  function mix(rgb,to,f){ return rgb.map(function(v){ return v+(to-v)*f; }); }
  function theme(){
    var t=document.documentElement&&document.documentElement.getAttribute('data-theme');
    if(!t){ try{ t=localStorage.getItem('cohesion_theme'); }catch(_e){} }
    return t==='light'?'light':'dark';
  }
  function ink(hex, opts){
    opts=opts||{};
    var rgb=parse(hex); if(!rgb) return hex;
    var th=opts.theme==='light'||opts.theme==='dark'?opts.theme:theme();
    var bg=parse(opts.bg)||parse(BG[th]), min=+opts.min||MIN;
    if(ratio(rgb,bg)>=min) return hex;                       // already reads: unchanged
    // dark page → toward white; light page → toward black (a colour lighter than a dark page, or
    // darker than a light one, only ever gains contrast that way)
    var to=relLum(bg)<0.18?255:0;
    if(ratio(mix(rgb,to,1),bg)<min) return toHex(mix(rgb,to,1));
    var lo=0, hi=1;
    for(var i=0;i<20;i++){ var m=(lo+hi)/2; if(ratio(mix(rgb,to,m),bg)>=min) hi=m; else lo=m; }
    var out=mix(rgb,to,hi);
    // rounding can land a hair under the line: step on until it reads
    for(var k=0;k<8&&ratio(parse(toHex(out)),bg)<min;k++){ hi=Math.min(1,hi+0.01); out=mix(rgb,to,hi); }
    return toHex(out);
  }
  function tint(hex, a, opts){
    var c=parse(ink(hex, opts)); if(!c) return '';
    return 'rgba('+Math.round(c[0])+','+Math.round(c[1])+','+Math.round(c[2])+','+a+')';
  }
  function inkOn(fill){
    var rgb=parse(fill); if(!rgb) return '#fff';
    return ratio(rgb,[17,17,17])>ratio(rgb,[255,255,255])?'#111':'#fff';
  }
  function contrast(a,b){ var x=parse(a), y=parse(b); return x&&y?ratio(x,y):null; }

  var fns=[], last=null;
  function fire(){ var t=theme(); if(t===last) return; last=t; fns.slice().forEach(function(fn){ try{ fn(t); }catch(e){ if(window.console) console.error(e); } }); }
  function onThemeChange(fn){
    if(typeof fn!=='function') return;
    fns.push(fn);
    if(last==null){
      last=theme();
      try{ new MutationObserver(fire).observe(document.documentElement,{attributes:true, attributeFilter:['data-theme']}); }catch(_e){}
    }
  }
  window.cohTeamInk=ink; window.cohTeamTint=tint; window.cohInkOn=inkOn;
  window.cohInkTheme=theme; window.cohContrast=contrast; window.cohOnThemeChange=onThemeChange;
  window.COH_INK={BG:BG, MIN:MIN};
})();
