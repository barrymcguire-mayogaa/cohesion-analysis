/* COHESION — Analysis › Player Dashboard › SCORING card › "⬇ Image": a downloadable 2000 × 1074 PNG of the player's shooting
 * (Barry, Oct 2026 — the David Clifford reference design).
 *
 * Loaded after cohesion-playerdash.js. Everything is drawn on a canvas from the dashboard's own view (PD_V: its range, its
 * opponent filter, its player) — the same shots the SCORING tiles count (S.R.shots of the player), nothing re-derived:
 *   · header: the photo (cohesion-photos.js, square, in the team-colour frame; the initials badge with no photo), the name with
 *     the surname in the team colour, the colour bands (three for Carlow / Offaly — decoration only), the crest, team,
 *     "#<no> · <position>" from the team sheet, "COHESION TEAM ANALYSIS", the RANGE box (the dashboard's own range text);
 *   · TOTAL SHOTS: the Players-tab shot map (ttMapSVG — the same one-size glyphs and colours), "Scoring: x% n of N", its key;
 *   · tiles: SHOTS, SCORES, CONVERSION, POINTS, Pts v xPts (points − xP over the shots the model rates, = the dashboard's
 *     Finishing v xP), AVG. DISTANCE (M);
 *   · bars: distance bands, shot type (open play / free / mark / ’45 / penalty — ssDeadType), attempt type, pressure; the side
 *     chart (Shot Side). Bar length = shots; the team's PRIMARY part = scored, the SECONDARY part = missed (a neutral gold or
 *     grey when the secondary would not show against the primary or the background); the number = scores, % = conversion.
 * DISTANCE (Barry): radial, from the CENTRE of the goal line to the shot = cohShotDistM (cohesion-shotbands.js) =
 *   xpForShot(...).parts.dist on the shot's canonical coordinates (rotated Sportscode games already turned by ttCoordOf):
 *   sqrt(dx² + dy²), dx = 0.878 m per % across from the goal centre (X 50), dy = the depth from the end line on the calibrated
 *   13 / 20 / 45 m lines (at least 0.5 m). Mean over LOCATED shots only; under PDS_MIN_LOC located shots the distance bars and
 *   AVG. DISTANCE are not drawn ("Not enough located shots (n)"). Coverage is always printed.
 * A panel whose tags are missing says "n/a — no <tag> tags in these games". Every text is fitted to its box (pdsText shrinks the
 * font) and recorded in canvas.__texts, so a test can check that nothing overflows.
 */
(function(){
'use strict';
const W=2000, H=1074, PDS_MIN_LOC=10;
const BG='#0d0e13', PANEL='#15161d', CARD='#1b1c25', BORDER='#2a2b37', T1='#ececf1', T2='#a0a0ae', T3='#6d6d7a';
const FB="'Barlow', Arial, sans-serif", FC="'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
const DIST_BANDS=[['INSIDE 13m',0,13],['13–20m',13,20],['20–30m',20,30],['30–40m',30,40],['40m+',40,Infinity]];
const TYPES=[['open','OPEN PLAY'],['Free','FREE'],['Mark','MARK'],['45','45’s'],['Penalty','PENALTY']];
const ATTS=[['1','1-POINT ATTEMPT'],['2','2-POINT ATTEMPT'],['G','GOAL ATTEMPT']];
const PRS=[['L','LOW PRESSURE'],['M','MEDIUM PRESSURE'],['H','HIGH PRESSURE']];
const SIDES=[['L','LEFT SIDE'],['C','CENTRE'],['R','RIGHT SIDE']];

// ── colours ──
function rgb(h){ const m=/^#?([0-9a-f]{6})$/i.exec(String(h||'').trim()); if(!m) return [128,128,128]; const n=parseInt(m[1],16); return [n>>16&255, n>>8&255, n&255]; }
function lum(h){ const a=rgb(h).map(v=>{ v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); }); return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2]; }
function cr(a,b){ const x=lum(a), y=lum(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); }
function achro(h){ const c=rgb(h); return (Math.max(...c)-Math.min(...c))/255<0.15; }
function mix(a,b,t){ const A=rgb(a), B=rgb(b); return '#'+A.map((v,i)=>Math.round(v*(1-t)+B[i]*t).toString(16).padStart(2,'0')).join(''); }
// scored = the team's primary (lifted when it would vanish on the dark panel), missed = the secondary — unless that is
// black / white / grey, too close in COLOUR to the primary (RGB distance — Mayo’s red v green is fine, two greens are not), or too
// dark / light against the panel: then a neutral gold (or grey when the primary is gold)
function pdsBarCols(col){
  const st=col.stored||{}, p0=st.primary||col.primary, s0=st.secondary||col.secondary;
  let scored=p0; if(cr(scored, PANEL)<1.6||achro(scored)) scored=col.a||'#4fc3f7';
  const goldish=h=>{ const [r,g,b]=rgb(h); return r>150&&g>110&&b<90; };
  let missed=s0, why='secondary';
  const dist=(a,b)=>{ const A=rgb(a), B=rgb(b); return Math.hypot(A[0]-B[0], A[1]-B[1], A[2]-B[2]); };
  if(!missed||achro(missed)||dist(missed, scored)<120||cr(missed, PANEL)<1.6){ missed=goldish(scored)?'#8a8a96':'#e3b505'; why='fallback'; }
  return {scored, missed, why};
}

// ── the figures (the dashboard's own shots of the player in the range; o.shots replaces them — tests only) ──
function tally(list){ const n=list.length, s=list.filter(x=>x.v>0).length; return {shots:n, scores:s, pct:n?s/n*100:null, list}; }
function pdsData(V, o){
  o=o||{}; const S=V.S, key=V.key, mine=(o.shots||S.R.shots.filter(s=>s.pk===key)).slice();
  const sc=mine.filter(s=>s.v>0), xs=mine.filter(s=>s.xp!=null);
  const xp=xs.reduce((a,s)=>a+s.xp,0), xpPts=xs.reduce((a,s)=>a+(s.v>0?s.v:0),0);
  const dist=typeof cohShotDistM==='function'?cohShotDistM:(typeof window!=='undefined'&&window.cohShotDistM)||null;
  const loc=mine.map(s=>({s, d:dist?dist(s):null})).filter(x=>x.d!=null&&isFinite(x.d));
  const D={shots:mine.length, scores:sc.length, pts:sc.reduce((a,s)=>a+s.v,0), pct:mine.length?sc.length/mine.length*100:null,
    xp:xs.length?xp:null, xpShots:xs.length, fin:xs.length?xpPts-xp:null, located:loc.length, minLoc:PDS_MIN_LOC,
    avgDist:loc.length?loc.reduce((a,x)=>a+x.d,0)/loc.length:null, dists:loc.map(x=>x.d)};
  D.distOk=loc.length>=PDS_MIN_LOC;
  D.bands=DIST_BANDS.map(([l,a,b])=>Object.assign({label:l}, tally(loc.filter(x=>x.d>=a&&x.d<b).map(x=>x.s))));
  D.types=TYPES.map(([k,l])=>Object.assign({key:k, label:l}, tally(k==='open'?mine.filter(s=>!s.dead):mine.filter(s=>s.dead&&s.deadType===k))));
  D.typesOther={sideline:mine.filter(s=>s.dead&&s.deadType==='Sideline').length, untyped:mine.filter(s=>s.dead&&(!s.deadType||s.deadType==='Dead ball')).length};
  D.atts=ATTS.map(([k,l])=>Object.assign({key:k, label:l}, tally(mine.filter(s=>s.att===k)))); D.attTagged=mine.filter(s=>s.att==='1'||s.att==='2'||s.att==='G').length;
  const prOf=s=>s.pr&&s.pr!=='N'?s.pr:'';
  D.prs=PRS.map(([k,l])=>Object.assign({key:k, label:l}, tally(mine.filter(s=>prOf(s)===k)))); D.prTagged=mine.filter(s=>prOf(s)).length;
  D.sides=SIDES.map(([k,l])=>Object.assign({key:k, label:l}, tally(mine.filter(s=>s.side===k)))); D.sideTagged=mine.filter(s=>s.side==='L'||s.side==='C'||s.side==='R').length;
  D.mapShots=mine.filter(s=>s.x!=null&&s.y!=null);
  return D;
}
// a nice axis for shot COUNTS: 0 … top in whole steps of 1 / 2 / 5 × 10^k (2.5 × 10^k from 25 up), about `want` steps
function pdsNice(max, want){ max=Math.max(1, max||0); want=want||6; const raw=max/want, p=Math.pow(10, Math.floor(Math.log10(raw))), m=raw/p;
  const step=(m<=1?1:m<=2?2:m<=2.5&&p>=10?2.5:m<=5?5:10)*p, st=Math.max(1, Math.round(step)); return {step:st, top:Math.ceil(max/st)*st}; }

// ── drawing helpers ──
function rr(c, x, y, w, h, r){ r=Math.min(r, w/2, h/2); c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
function box(c, x, y, w, h, o){ o=o||{}; rr(c,x,y,w,h,o.r==null?18:o.r); if(o.fill!==false){ c.fillStyle=o.fill||PANEL; c.fill(); } if(o.stroke!==false){ c.strokeStyle=o.stroke||BORDER; c.lineWidth=o.lw||2; c.stroke(); } }
// text fitted to maxW (the font shrinks, never below 55%), recorded with its box and the region it must stay in
function pdsText(c, str, x, y, o){
  o=o||{}; str=String(str==null?'':str); let size=o.size||20; const fam=o.fam||FB, wt=o.wt||600;
  const set=()=>{ c.font=wt+' '+size+'px '+fam; }; set();
  if(o.ls!=null&&'letterSpacing' in c) c.letterSpacing=o.ls+'px';
  if(o.maxW){ const min=size*0.55; while(c.measureText(str).width>o.maxW&&size>min){ size-=1; set(); } }
  c.fillStyle=o.col||T1; c.textAlign=o.align||'left'; c.textBaseline=o.base||'alphabetic'; c.fillText(str, x, y);
  const m=c.measureText(str), w=m.width, x0=o.align==='right'?x-w:o.align==='center'?x-w/2:x, asc=m.actualBoundingBoxAscent||size*0.75, desc=m.actualBoundingBoxDescent||size*0.2;
  const y0=o.base==='middle'?y-size/2:o.base==='top'?y:y-asc, y1=o.base==='middle'?y+size/2:o.base==='top'?y+size:y+desc;
  if(c.canvas.__texts&&!o.noRec) c.canvas.__texts.push({t:str, x0, x1:x0+w, y0, y1, reg:o.reg||null, size});
  if('letterSpacing' in c) c.letterSpacing='0px';
  return w;
}
function loadImg(src, cors){ return new Promise(res=>{ if(!src) return res(null); const i=new Image(); if(cors) i.crossOrigin='anonymous'; i.onload=()=>res(i); i.onerror=()=>res(null); i.src=src; setTimeout(()=>res(null), 8000); }); }
// the dashboard's shot map (ttMapSVG) as an image: drawn in the page so its stylesheet applies, the computed paint inlined,
// serialised, loaded from a data: URL (no taint)
async function pdsMapImage(shots){
  if(typeof ttMapSVG!=='function') return null;
  const host=document.createElement('div'); host.setAttribute('aria-hidden','true'); host.style.cssText='position:fixed;left:-10000px;top:0;width:760px;pointer-events:none;';
  (document.getElementById('pane-player-dash')||document.body).appendChild(host);
  try{
    host.innerHTML=ttMapSVG(shots, {view:'loc'}); const svg=host.querySelector('svg'); if(!svg) return null;
    const P=['fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-dasharray','stroke-linecap','stroke-linejoin','opacity','display','visibility'];
    [svg].concat([...svg.querySelectorAll('*')]).forEach(el=>{ const cs=getComputedStyle(el); el.setAttribute('style', P.map(p=>p+':'+cs.getPropertyValue(p)).join(';')); });
    svg.querySelectorAll('.tt-mx').forEach(x=>x.remove());   // the transparent touch targets
    const vb=svg.viewBox.baseVal; svg.setAttribute('xmlns','http://www.w3.org/2000/svg'); svg.setAttribute('width', 1000); svg.setAttribute('height', Math.round(1000*vb.height/vb.width));
    const img=await loadImg('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg)));
    return img?{img, ratio:vb.height/vb.width}:null;
  } finally { host.remove(); }
}

// ── the image ──
async function pdsCanvas(V, o){
  o=o||{}; const D=pdsData(V, o), col=V.col, BC=pdsBarCols(col);
  try{ if(document.fonts&&document.fonts.load) await Promise.all(['800 64px "Barlow"','600 20px "Barlow"','700 30px "Barlow"','800 40px "Barlow Condensed"','700 20px "Barlow Condensed"'].map(f=>document.fonts.load(f).catch(()=>null))); }catch(_){ }
  const cv=document.createElement('canvas'); cv.width=W; cv.height=H; cv.__texts=[]; cv.__data=D; cv.__cols=BC; const c=cv.getContext('2d');
  c.fillStyle=BG; c.fillRect(0,0,W,H);
  const regs={}; const reg=(id,x,y,w,h)=>{ regs[id]={x0:x, y0:y, x1:x+w, y1:y+h}; return id; }; cv.__regs=regs;

  // HEADER
  const hx=24, hy=18, hw=W-48, hh=236; reg('head', hx, hy, hw, hh);
  const g=c.createLinearGradient(hx,0,hx+hw*0.55,0); g.addColorStop(0, mix(PANEL, col.stored&&col.stored.primary||col.primary, 0.32)); g.addColorStop(1, PANEL);
  rr(c,hx,hy,hw,hh,22); c.fillStyle=g; c.fill(); c.strokeStyle=BORDER; c.lineWidth=2; c.stroke();
  c.save(); rr(c,hx,hy,hw,hh,22); c.clip(); c.fillStyle=col.a; c.fillRect(hx,hy,7,hh); c.restore();
  // photo / initials, the rounded-square frame: primary border + secondary outer ring (the dashboard's frame)
  const px=64, py=46, ps=178, prad=ps*0.10, P=col.stored||{};
  rr(c,px-7,py-7,ps+14,ps+14,prad+6); c.fillStyle=P.secondary||col.secondary||col.primary; c.fill();
  rr(c,px-3,py-3,ps+6,ps+6,prad+3); c.fillStyle=P.primary||col.primary; c.fill();
  rr(c,px,py,ps,ps,prad); c.fillStyle='#10111a'; c.fill();
  const name=(V.row&&V.row.name)||V.name||'', src=typeof cohPhotoSrc==='function'?cohPhotoSrc(V.T, name):null, photo=o.noPhoto?null:await loadImg(src, true);
  const ini=typeof cohPlayerInitials==='function'?cohPlayerInitials(name):name.split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase();
  const drawIni=()=>pdsText(c, ini, px+ps/2, py+ps/2+4, {size:64, wt:700, fam:FC, align:'center', base:'middle', col:'#fff', reg:'head'});
  if(photo){ c.save(); rr(c,px,py,ps,ps,prad); c.clip(); const s=Math.max(ps/photo.width, ps/photo.height); c.drawImage(photo, px+(ps-photo.width*s)/2, py+(ps-photo.height*s)/2, photo.width*s, photo.height*s); c.restore(); }
  else drawIni();
  // name
  const parts=name.trim().split(/\s+/), first=parts.length>1?parts.slice(0,-1).join(' '):'', last=parts[parts.length-1]||'';
  let nx=274; const nmax=1180;
  c.font='800 64px '+FB; let ns=64; while(c.measureText((first?first+' ':'')+last).width>nmax&&ns>36){ ns-=2; c.font='800 '+ns+'px '+FB; }
  if(first) nx+=pdsText(c, first+' ', nx, 110, {size:ns, wt:800, col:T1, reg:'head'});
  pdsText(c, last, nx, 110, {size:ns, wt:800, col:col.a, reg:'head'});
  // the colour bands (decoration: two, or three for Carlow / Offaly)
  const bands=(col.bands&&col.bands.length?col.bands:[col.primary]); const bw=186/bands.length;
  bands.forEach((b,i)=>{ rr(c, 274+i*bw+(i?3:0), 126, bw-(i<bands.length-1?3:0), 9, 4); c.fillStyle=b; c.fill(); c.strokeStyle='rgba(255,255,255,.25)'; c.lineWidth=1; c.stroke(); });
  // crest + team + number / position
  const crestSrc=typeof cohCrestSrc==='function'?cohCrestSrc(V.T):null, crest=o.noCrest?null:await loadImg(crestSrc, /^https?:/i.test(String(crestSrc||''))&&!String(crestSrc).startsWith(location.origin));
  cv.__crest=!!crest;
  if(crest){ const s=Math.min(62/crest.width, 72/crest.height); c.drawImage(crest, 280+(62-crest.width*s)/2, 148+(72-crest.height*s)/2, crest.width*s, crest.height*s); }
  else { c.beginPath(); c.arc(311,184,30,0,Math.PI*2); c.fillStyle=col.primary; c.fill(); c.lineWidth=3; c.strokeStyle=col.secondary||col.primary; c.stroke(); pdsText(c, String(V.T||'').slice(0,3).toUpperCase(), 311, 185, {size:18, wt:800, fam:FC, align:'center', base:'middle', col:'#fff', maxW:52, reg:'head'}); }
  const tt=typeof titleCase==='function'?titleCase(V.T):V.T, sh=V.sheet;
  pdsText(c, tt, 360, 184, {size:30, wt:700, col:T1, maxW:560, reg:'head'});
  pdsText(c, (sh&&sh.no!=null&&sh.no!==''?'#'+sh.no:'No. n/a')+' · '+(sh&&sh.pos?sh.pos:'Position n/a'), 360, 216, {size:25, wt:400, col:T2, maxW:560, reg:'head'});
  // brand + range
  const bx=W-50; let bw2=pdsText(c, 'TEAM ANALYSIS', bx, 98, {size:38, wt:700, fam:FC, align:'right', col:T1, reg:'head'});
  pdsText(c, 'COHESION', bx-bw2-10, 98, {size:60, wt:800, fam:FC, align:'right', col:T1, reg:'head'});
  const rgx=W-50-300, rgy=150; box(c, rgx, rgy, 300, 86, {r:14, fill:'rgba(255,255,255,0.03)'}); reg('range', rgx, rgy, 300, 86);
  pdsText(c, 'RANGE', rgx+22, rgy+30, {size:14, wt:700, fam:FC, col:T3, ls:2.5, reg:'range'});
  pdsText(c, V.rangeTxt||'', rgx+22, rgy+64, {size:26, wt:700, col:T1, maxW:256, reg:'range'});

  // LEFT: TOTAL SHOTS
  const lx=26, ly=276, lw=848, lh=778; box(c, lx, ly, lw, lh); reg('map', lx, ly, lw, lh);
  pdsText(c, 'TOTAL SHOTS', lx+48, ly+58, {size:34, wt:700, fam:FC, col:T1, ls:0.5, reg:'map'});
  { let x=lx+lw-52; x-=pdsText(c, D.shots?D.scores+' of '+D.shots:'no shots', x, ly+60, {size:22, wt:500, col:T3, align:'right', reg:'map'})+10;
    if(D.shots){ x-=pdsText(c, D.pct==null?'n/a':(Math.round(D.pct*10)/10).toFixed(1)+'%', x, ly+60, {size:28, wt:700, col:T1, align:'right', reg:'map'})+8; pdsText(c, 'Scoring:', x, ly+60, {size:28, wt:500, col:T2, align:'right', reg:'map'}); } }
  const mx=lx+42, my=ly+80, mw=lw-84, mhMax=lh-80-78;
  const M=await pdsMapImage(D.mapShots);
  if(M){ let w=mw, h=w*M.ratio; if(h>mhMax){ h=mhMax; w=h/M.ratio; } const x0=mx+(mw-w)/2; rr(c,x0-4,my-4,w+8,h+8,10); c.fillStyle='#2e8b22'; c.fill(); c.drawImage(M.img, x0, my, w, h); cv.__map={x:x0, y:my, w, h, n:D.mapShots.length}; }
  else pdsText(c, 'Shot map n/a', lx+lw/2, my+mhMax/2, {size:24, wt:600, col:T3, align:'center', reg:'map'});
  if(!D.mapShots.length&&M){ const t=D.shots?'n/a — none of his '+D.shots+' shots has a pitch location':'No shots', bwid=Math.min(mw-60, 620), by=my+(cv.__map?cv.__map.h:mhMax)/2-34;
    box(c, lx+(lw-bwid)/2, by, bwid, 68, {r:14, fill:'rgba(13,14,19,0.86)', stroke:'rgba(255,255,255,0.18)'}); pdsText(c, t, lx+lw/2, by+43, {size:22, wt:600, col:T1, align:'center', maxW:bwid-40, reg:'map'}); }
  // the map's key, as the Players tab's
  { const ky=ly+lh-34, MK=(typeof TT_MK_COL!=='undefined'?TT_MK_COL:{'1':'#ffffff','2':'#ff8c1a','G':'#b4ff00','P':'#b266ff'});
    const items=[['dot',MK['1'],'1-point'],['dot',MK['2'],'2-point'],['dot',MK['G'],'Goal'],['dot',MK['P'],'Penalty'],['dot','#d0d3d8','From play'],['sq','#d0d3d8','Dead ball'],['dot','#d0d3d8','Scored'],['ring','#d0d3d8','Missed']];
    c.font='500 19px '+FB; const gap=26, ws=items.map(it=>18+c.measureText(it[2]).width); let tot=ws.reduce((a,b)=>a+b,0)+gap*(items.length-1), sc=Math.min(1,(lw-60)/tot), x=lx+(lw-tot*sc)/2;
    items.forEach((it,i)=>{ const r=6*sc; c.fillStyle=it[1]; c.strokeStyle=it[1]; c.lineWidth=2.4;
      if(it[0]==='dot'){ c.beginPath(); c.arc(x+r, ky-6, r, 0, Math.PI*2); c.fill(); } else if(it[0]==='sq'){ c.fillRect(x, ky-6-r, 2*r, 2*r); } else { c.beginPath(); c.arc(x+r, ky-6, r-1, 0, Math.PI*2); c.stroke(); }
      pdsText(c, it[2], x+18*sc, ky, {size:19*sc, wt:500, col:T2, reg:'map'}); x+=ws[i]*sc+gap*sc; }); }

  // KPI tiles
  const kx=898, ky0=276, kw=1074, kh=188; box(c, kx, ky0, kw, kh); reg('kpi', kx, ky0, kw, kh);
  const fin=D.fin==null?'n/a':((Math.round(D.fin*10)/10)>0?'+':(Math.round(D.fin*10)/10)<0?'−':'±')+Math.abs(Math.round(D.fin*10)/10).toFixed(1);
  const tiles=[[String(D.shots),'SHOTS'],[String(D.scores),'SCORES'],[D.pct==null?'n/a':Math.round(D.pct)+'%','CONVERSION'],[String(D.pts),'POINTS'],[fin,'Pts v xPts'],
    [D.distOk&&D.avgDist!=null?(Math.round(D.avgDist*10)/10).toFixed(1):'n/a','AVG. DISTANCE (M)']];
  tiles.forEach(([v,l],i)=>{ const tw=150, gapx=(kw-24*2-tw*6)/5, tx=kx+24+i*(tw+gapx), ty=ky0+18, th=kh-36; box(c, tx, ty, tw, th, {r:14, fill:CARD, lw:1.5}); reg('tile'+i, tx, ty, tw, th);
    pdsText(c, v, tx+tw/2, ty+76, {size:v==='n/a'?44:62, wt:800, fam:FB, align:'center', col:v==='n/a'?T3:T1, maxW:tw-16, reg:'tile'+i});
    if(l==='AVG. DISTANCE (M)'){ pdsText(c, 'AVG. DISTANCE', tx+tw/2, ty+112, {size:17, wt:600, align:'center', col:T1, maxW:tw-12, reg:'tile'+i}); pdsText(c, '(M)', tx+tw/2, ty+132, {size:17, wt:600, align:'center', col:T1, reg:'tile'+i}); }
    else pdsText(c, l, tx+tw/2, ty+112, {size:17, wt:600, align:'center', col:T1, maxW:tw-12, reg:'tile'+i}); });

  // a horizontal bar: length = shots on the scale, scored part = primary, missed = the missed colour
  const hbar=(x, y, w, h, t, top)=>{ const L=top>0?w*t.shots/top:0, Sc=top>0?w*t.scores/top:0; c.fillStyle='rgba(255,255,255,0.05)'; c.fillRect(x, y, w, h);
    if(L>0){ c.fillStyle=BC.missed; c.fillRect(x, y, L, h); c.fillStyle=BC.scored; c.fillRect(x, y, Sc, h); } };
  const pctTxt=p=>p==null?'–':Math.round(p)+'%';

  // DISTANCE
  const dx=898, dy=486, dw=698, dh=304; box(c, dx, dy, dw, dh); reg('dist', dx, dy, dw, dh); box(c, dx+18, dy+16, dw-36, dh-48, {r:14, fill:CARD, lw:1.5});
  const covTxt='Distance from '+D.located+' of '+D.shots+' shot'+(D.shots===1?'':'s')+' (located) · radial, from the centre of the goal line';
  if(!D.distOk) pdsText(c, 'Not enough located shots ('+D.located+')', dx+dw/2, dy+dh/2-6, {size:26, wt:700, col:T2, align:'center', maxW:dw-80, reg:'dist'});
  else {
    const sc=pdsNice(Math.max(...D.bands.map(b=>b.shots)), 7), bx0=dx+146, bw0=dw-146-112;
    D.bands.forEach((b,i)=>{ const y=dy+38+i*40; pdsText(c, b.label, bx0-12, y+15, {size:17, wt:600, col:T1, align:'right', maxW:120, reg:'dist'});
      hbar(bx0, y, bw0, 21, b, sc.top);
      pdsText(c, String(b.scores), bx0+bw0+24, y+16, {size:17, wt:600, col:T1, align:'right', reg:'dist'}); pdsText(c, pctTxt(b.pct), bx0+bw0+34, y+16, {size:17, wt:600, col:T1, maxW:56, reg:'dist'}); });
    const ay=dy+38+5*40+12; c.font='500 16px '+FB;
    for(let v=0; v<=sc.top+1e-9; v+=sc.step){ const x=bx0+bw0*v/sc.top; c.strokeStyle='rgba(255,255,255,0.06)'; c.lineWidth=1; c.beginPath(); c.moveTo(x, dy+38); c.lineTo(x, ay-14); c.stroke(); pdsText(c, String(+v.toFixed(1)), x, ay+4, {size:16, wt:500, col:T2, align:'center', reg:'dist'}); }
  }
  pdsText(c, covTxt, dx+dw/2, dy+dh-11, {size:14, wt:500, col:T3, align:'center', maxW:dw-40, reg:'dist'});

  // SHOT TYPE
  const sx=1626, sy=486, sw=346, sh2=304; box(c, sx, sy, sw, sh2); reg('type', sx, sy, sw, sh2); box(c, sx+16, sy+16, sw-32, sh2-32, {r:14, fill:CARD, lw:1.5});
  { const top=pdsNice(Math.max(...D.types.map(t=>t.shots)), 4).top, bx0=sx+134, bw0=sw-134-58;
    D.types.forEach((t,i)=>{ const y=sy+46+i*46; pdsText(c, t.label, bx0-14, y+15, {size:16, wt:600, col:T1, align:'right', maxW:104, reg:'type'}); hbar(bx0, y, bw0, 21, t, top);
      pdsText(c, String(t.scores), bx0+bw0+10, y+16, {size:16, wt:600, col:T1, maxW:36, reg:'type'}); });
    const oth=[D.typesOther.sideline?D.typesOther.sideline+' sideline':'', D.typesOther.untyped?D.typesOther.untyped+' dead ball, type not tagged':''].filter(Boolean).join(' · ');
    if(oth) pdsText(c, '+ '+oth, sx+sw/2, sy+sh2-26, {size:12, wt:500, col:T3, align:'center', maxW:sw-44, reg:'type'}); }

  // BOTTOM: attempt type · pressure · side
  box(c, 898, 808, 1074, 246, {fill:'rgba(0,0,0,0)'}); reg('bottom', 898, 808, 1074, 246);
  const listPanel=(x, y, w, h, rows, tagged, tagName, id)=>{ box(c, x, y, w, h, {r:14, fill:CARD, lw:1.5}); reg(id, x, y, w, h);
    if(!tagged){ pdsText(c, 'n/a — no '+tagName+' tags in these games', x+w/2, y+h/2+6, {size:17, wt:600, col:T3, align:'center', maxW:w-30, reg:id}); return; }
    const top=Math.max(...rows.map(r=>r.shots), 1);
    rows.forEach((r,i)=>{ const yy=y+28+i*62; pdsText(c, r.label, x+16, yy, {size:17, wt:700, col:T1, maxW:w-120, reg:id});
      pdsText(c, r.shots?r.scores+' · '+pctTxt(r.pct):'–', x+w-16, yy, {size:14, wt:600, col:T2, align:'right', maxW:96, reg:id}); hbar(x+16, yy+10, w-32, 24, r, top); });
    if(tagged<D.shots) pdsText(c, tagged+' of '+D.shots+' shots tagged', x+w-16, y+h-8, {size:11, wt:500, col:T3, align:'right', reg:id}); };
  listPanel(922, 828, 322, 206, D.atts, D.attTagged, 'Shot Attempts', 'att');
  listPanel(1275, 828, 322, 206, D.prs, D.prTagged, 'Shot Pressure', 'press');
  // side chart
  { const x=1628, y=828, w=322, h=206; box(c, x, y, w, h, {r:14, fill:CARD, lw:1.5}); reg('side', x, y, w, h);
    if(!D.sideTagged) pdsText(c, 'n/a — no Shot Side tags in these games', x+w/2, y+h/2+6, {size:17, wt:600, col:T3, align:'center', maxW:w-30, reg:'side'});
    else { const sc=pdsNice(Math.max(...D.sides.map(s=>s.shots)), 5), x0=x+62, x1=x+w-18, y0=y+24, y1=y+h-50;
      c.save(); c.translate(x+20, (y0+y1)/2); c.rotate(-Math.PI/2); pdsText(c, 'TOTAL SHOTS', 0, 0, {size:12, wt:700, fam:FC, col:T2, align:'center', base:'middle', ls:1, noRec:true}); c.restore();
      cv.__texts.push({t:'TOTAL SHOTS (rotated)', x0:x+14, x1:x+26, y0:(y0+y1)/2-40, y1:(y0+y1)/2+40, reg:'side'});
      for(let v=0; v<=sc.top+1e-9; v+=sc.step){ const yy=y1-(y1-y0)*v/sc.top; c.strokeStyle='rgba(255,255,255,0.07)'; c.lineWidth=1; c.beginPath(); c.moveTo(x0, yy); c.lineTo(x1, yy); c.stroke();
        pdsText(c, String(+v.toFixed(1)), x0-8, yy+4, {size:12, wt:500, col:T2, align:'right', reg:'side'}); }
      const gw=(x1-x0)/3, bwid=Math.min(26, gw*0.4);
      D.sides.forEach((s,i)=>{ const cx=x0+gw*(i+.5), bh=(y1-y0)*s.shots/sc.top; c.fillStyle=BC.scored; c.fillRect(cx-bwid/2, y1-bh, bwid, bh);
        pdsText(c, s.label, cx, y1+20, {size:12, wt:700, col:T1, align:'center', maxW:gw-6, reg:'side'}); });
      if(D.sideTagged<D.shots) pdsText(c, D.sideTagged+' of '+D.shots+' tagged', x1, y+h-6, {size:11, wt:500, col:T3, align:'right', reg:'side'}); } }

  // footer line
  pdsText(c, 'COHESION Analysis · '+((V.row&&V.row.name)||V.name||'')+' · '+tt+' · '+(V.rangeTxt||'')+' · generated '+new Date().toLocaleDateString('en-IE',{day:'numeric',month:'short',year:'numeric'}), W/2, H-4, {size:12, wt:500, col:T3, align:'center', maxW:W-80, reg:'foot'}); reg('foot', 0, H-22, W, 22);
  // a canvas a foreign image tainted cannot be saved: draw again without the photo / crest
  try{ cv.toDataURL('image/png').slice(0,10); }catch(_){ if(!o.noPhoto||!o.noCrest) return pdsCanvas(V, Object.assign({}, o, {noPhoto:true, noCrest:true})); }
  return cv;
}
function pdsFileName(V){ const s=x=>String(x||'').replace(/[^\w\- ]+/g,'').trim().replace(/\s+/g,'-'); return s((V.row&&V.row.name)||V.name)+'-scoring-'+s(V.rangeTxt)+'.png'; }
async function pdsDownload(btn){
  if(typeof PD_V==='undefined'||!PD_V||!PD_V.row) return;
  const lab=btn&&btn.textContent; if(btn){ btn.disabled=true; btn.textContent='Making image…'; }
  try{ const cv=await pdsCanvas(PD_V); const blob=await new Promise(r=>cv.toBlob(r, 'image/png')); if(!blob) throw new Error('the image could not be made');
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=pdsFileName(PD_V); document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    window.__pdsLast={name:a.download, size:blob.size, w:cv.width, h:cv.height};
  } catch(e){ console.error('scoring image', e); if(btn) btn.title='Could not make the image: '+e.message; }
  finally{ if(btn){ btn.disabled=false; btn.textContent=lab; } }
}
Object.assign(window, {pdsData, pdsCanvas, pdsDownload, pdsBarCols, pdsNice, pdsFileName, PDS_MIN_LOC});
})();
