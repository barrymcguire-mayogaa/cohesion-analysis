/* COHESION — shared match graphics: the generators behind the dashboard's
 * Stats tab, used by dashboard.html and by the Analysis page's Match Reports tab.
 *
 *   const G = cohesionGraphics({ game, events, host });
 *   await G.dashBuildInfographic()   -> 1920x1080 canvas (the 🖼 Infographic)
 *   await G.dashBuildStatsCanvas()   -> the stats card canvas (📤 Download stats image)
 *   await G.dashBuildMapsImage()     -> shot + kickout maps canvas, or null
 *   await G.dashExportPDF()          -> saves the multi-page match report (jsPDF + autoTable)
 *   G.dashComputeStats(), G.dashXpSummary(), G.dashFileStem() … (every name in
 *   cohesionGraphics.GLOBALS)
 *
 * EXPLICIT CONTEXT. Everything inside reads ONE game through the two names
 * GAME (the game's meta) and ALL (its events, prepared as the dashboard
 * prepares them: see cohGfxPrepare below). Each call of cohesionGraphics()
 * is its own instance with its own caches and its own stats period, so a page
 * can hold several games at once and nothing leaks into the page's globals.
 *   G.setContext({game, events})  swap the game of an instance (the dashboard
 *                                 calls it once, when its bundle arrives)
 *   G.giSup(e)                    the converted-Gaelic-Insights "superseded" test
 *   G.statPeriodNow()             the Stats tab's current period chip
 *   host: { renderSV, populatePl, setVM, filterLbl }  dashboard-only UI hooks
 *         (re-draw the Stats tab, jump to an event list). Optional: without
 *         them those calls do nothing, which is right for a page that only
 *         wants the images / PDF.
 *
 * The body between the BEGIN / END markers is the dashboard's code, moved
 * here unchanged (it was dashboard.html lines 747–2838), so the dashboard's
 * own buttons produce byte-identical output: cohesion-tests/analysis/
 * dash_parity.js renders both versions in headless Chrome and compares hashes.
 *
 * Needs (all optional at load, checked at call time): cohesion-crests.js
 * (cohCrestSrc, cohCrestsReady, cohCrestSlug), crests/index.js, cohesion-xp.js
 * (xpForShot), cohesion-gi.js, and jsPDF + autoTable for the PDF.
 */
// "MAYO SHOT OPEN PLAY" -> "Mayo Shot Open Play"
function cohGfxTitleCase(s){if(!s)return'';return s.toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase());}
// Maps a stored event's `half` field to the period key Visual Sync uses
// ('1st Half' -> '1H', etc.)
function cohGfxVisualSyncPeriod(half){
  if(!half)return '1H';
  if(half.includes('ET')&&half.includes('2'))return 'ET2';
  if(half.includes('ET'))return 'ET1';
  if(half.includes('2'))return '2H';
  return '1H';
}
// Applies any saved Visual Sync correction to the Main angle's events.
// IMPORTANT: this must be added to ev.start (the untouched raw XML time,
// the same reference frame Visual Sync computed its offset against), NOT
// ev.driveT — driveT is already a transformed value (admin.html applies
// its own whistle-based period offset at upload time). Adding Visual
// Sync's offset to driveT compounds two different corrections and
// produces wildly wrong, often backward-shifted positions.
function cohGfxApplyVisualSync(game, events){
  const segments = game && game.visualSync?.syncSegments?.main;
  if(!segments) return;
  events.forEach(ev=>{
    const periodKey = cohGfxVisualSyncPeriod(ev.half);
    const segs = segments[periodKey];
    if(!segs || !segs.length) return;
    const offset = segs[segs.length-1].offset || 0;
    if(typeof ev.start === 'number'){
      ev.driveT = Math.max(0, Math.round(ev.start + offset));
    }
  });
}
// Watch order: the gateway returns rows in physical table order.
function cohGfxSortEvents(events){ return events.sort((a,b)=>(a.driveT??0)-(b.driveT??0)||(a.start??0)-(b.start??0)); }
// Player -> team map, then fill a missing team / player from it (PTM is the
// caller's map: the dashboard keeps its own for the player filter).
function cohGfxFillTeams(events, PTM){
  PTM=PTM||{};
  events.forEach(ev=>{if(ev.player&&ev.team)PTM[ev.player]=ev.team;});
  events.forEach(ev=>{
    if(!ev.team){ev.team=PTM[ev.player]||PTM[ev.code]||'';}
    if(!ev.player&&PTM[ev.code]){ev.player=ev.code;}
  });
  return PTM;
}
// A gateway bundle ({meta, events:[{id, data}]}) -> the {game, events} context,
// prepared exactly as the dashboard prepares its own game: a COPY of every
// event (so the caller's objects are never touched), Visual Sync corrections,
// watch order, teams filled from the player map. (The dashboard additionally
// re-applies unsaved local edits; no other page has any.)
function cohGfxPrepare(bundle){
  let game=(bundle&&bundle.meta)||{};
  if(typeof game==='string'){ try{ game=JSON.parse(game); }catch(_){ game={}; } }
  const events=((bundle&&bundle.events)||[]).map(r=>(r&&r.data&&typeof r.data==='object'&&!('code' in r))?{ ...r.data, _rowId:r.id }:{ ...r });
  cohGfxApplyVisualSync(game, events);
  cohGfxSortEvents(events);
  cohGfxFillTeams(events, {});
  return {game, events};
}

function cohesionGraphics(ctx){
ctx=ctx||{};
let GAME=ctx.game||{}, ALL=ctx.events||[];
const host=ctx.host||{};
// dashboard-only UI hooks (no-ops elsewhere)
function renderSV(){ if(typeof host.renderSV==='function') return host.renderSV.apply(null, arguments); }
function populatePl(){ if(typeof host.populatePl==='function') return host.populatePl.apply(null, arguments); }
function setVM(){ if(typeof host.setVM==='function') return host.setVM.apply(null, arguments); }
function filterLbl(){ if(typeof host.filterLbl==='function') return host.filterLbl.apply(null, arguments); }
const tc=cohGfxTitleCase;
// Gaelic Insights shots converted to COHESION shots (cohesion-gi.js): the
// original "<Team> Shot" is superseded by its derived SHOT OPEN PLAY /
// DEADBALL event, so every count skips the original (each shot once). The
// derived bare score companion is not a shot either. Unconverted games have
// no derived events, so both predicates are always false for them.
let _giSupC={a:null,n:-1,f:()=>false};
function giSup(e){
  if(_giSupC.a!==ALL||_giSupC.n!==ALL.length)
    _giSupC={a:ALL,n:ALL.length,f:(typeof cohGiSupersededFn==='function')?cohGiSupersededFn(ALL):()=>false};
  return _giSupC.f(e);
}
function setContext(c){
  GAME=(c&&c.game)||{}; ALL=(c&&c.events)||[];
  _giSupC={a:null,n:-1,f:()=>false}; _sideMap=null; _sideKey=''; dashXpInvalidate();
}
function statPeriodNow(){ return statPeriod; }
// ═════════════ BEGIN — moved unchanged from dashboard.html ═════════════
// ── STATS TAB ─────────────────────────────────────────────────
// Whole-game numbers (from ALL events, ignoring the filter) for the groups
// carried in the XML: Shooting, Kickouts, Turnovers, Score Assists, Score
// Source. Everything is derived from label groups, so it works for any two
// teams that came through the parser.
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
// Side of an event's team. Resilient to a renamed game: if the events carry
// a team name matching NEITHER current name, that orphan value is assigned
// to whichever side has no exact-matching events.
let _sideMap=null,_sideKey='';
function _tnorm(x){ return String(x||'').normalize('NFC').toUpperCase(); }
function _statSideMap(){
  const H=_tnorm(GAME.homeTeam), A=_tnorm(GAME.awayTeam);
  const key=H+'|'+A+'|'+ALL.length;
  if(_sideMap&&_sideKey===key) return _sideMap;
  const m={}; if(H) m[H]='h'; if(A) m[A]='a';
  const vals=[...new Set(ALL.map(e=>_tnorm(e.team)).filter(Boolean))];
  const un=vals.filter(v=>!(v in m));
  if(un.length===1){
    const hasH=vals.includes(H), hasA=vals.includes(A);
    if(!hasH&&hasA) m[un[0]]='h'; else if(hasH&&!hasA) m[un[0]]='a';
  }
  _sideMap=m; _sideKey=key; return m;
}
function statSide(e){ return _statSideMap()[_tnorm(e.team)]||null; }
// Period splits. Quarters come from the per-half game clock (Q1 = 1H before
// 18:00, Q2 = the rest, etc.); ET events only count under Full / ET chips.
let statPeriod='full';
function statQOf(e){ const m=/^([12])H\s+(\d+):/.exec(e.gameTime||''); if(!m)return null; const h=+m[1],min=+m[2]; return h===1?(min<18?'q1':'q2'):(min<18?'q3':'q4'); }
function statPred(e){
  switch(statPeriod){
    case 'full': return true;
    case '1h': return e.half==='1st Half';
    case '2h': return e.half==='2nd Half';
    case 'et1': return e.half==='ET 1st Half';
    case 'et2': return e.half==='ET 2nd Half';
    default: return statQOf(e)===statPeriod;
  }
}
function setStatPeriod(p){ statPeriod=p; renderSV(); }
// Different coding systems name their label groups differently (Sportscode
// family: "Shot Outcomes"; Gaelic Insights: "Outcome"/"PO_Result"/...).
// Each stat filters by event code and tries the group aliases in order.
function tallyOutcome(pred, groups){
  const out={h:{},a:{},totH:0,totA:0,group:''};
  ALL.forEach(e=>{ const s=statSide(e); if(!s)return; if(!statPred(e))return;
    if(giSup(e))return;   // converted GI shot: its derived shot is counted instead
    if(pred&&!pred(e))return;
    let v=null,g=null;
    for(const cand of groups){ const val=(e.labels||{})[cand]; if(val){ v=val; g=cand; break; } }
    if(!v)return; if(!out.group) out.group=g;
    const b=s==='h'?out.h:out.a; b[v]=(b[v]||0)+1; if(s==='h')out.totH++; else out.totA++; });
  return out;
}
// Kickout retention across vocabularies: "KT Won ..." = kicking team kept it,
// "RT Won ..." = receiver won it (lost); otherwise plain WON-without-LOST.
// ONE rule for "did the KICKING team (side 'h'|'a') win its own kickout?":
//  · GIU names the WINNER in the outcome ("Kerry Clean", "Donegal Break" on a
//    "Kerry Kickout") — an outcome that starts with a team's name is decided
//    by that name;
//  · Gaelic Insights "KT Won …" = kicker kept it, "RT Won …" = receiver won;
//  · Tracker / Code Room "KO WON CLEAN", "KO BREAK LOST" … = WON without LOST.
function koWonStr(out,side){
  const K=String(out||'').toUpperCase().trim();
  if(side==='h'||side==='a'){
    const H=String((GAME&&GAME.homeTeam)||'').toUpperCase().trim(), A=String((GAME&&GAME.awayTeam)||'').toUpperCase().trim();
    const own=side==='h'?H:A, opp=side==='h'?A:H;
    if(opp&&(K===opp||K.startsWith(opp+' '))) return false;
    if(own&&(K===own||K.startsWith(own+' '))) return true;
  }
  return K.includes('RT ')?false:K.includes('KT ')?true:(K.includes('WON')&&!K.includes('LOST'));
}
function koWonCount(tal,side){
  const b=side==='h'?tal.h:tal.a;
  return Object.entries(b).reduce((s,[k,v])=>s+(koWonStr(k,side)?v:0),0);
}
function codeCount(pred,side){ return ALL.filter(e=>statSide(e)===side&&statPred(e)&&pred(e)).length; }
// Click a stat row → jump to the Events tab filtered to those events.
// side: ''=both teams, 'h'/'a'=that team only. Quarters filter to the parent half.
function statNav(side, group, value){
  const ft=document.getElementById('FT');
  if(ft) ft.value = side==='h'?(GAME.homeTeam||''):side==='a'?(GAME.awayTeam||''):'';
  const fh=document.getElementById('FH');
  if(fh){
    const map={'1h':'1st Half','2h':'2nd Half','et1':'ET 1st Half','et2':'ET 2nd Half','q1':'1st Half','q2':'1st Half','q3':'2nd Half','q4':'2nd Half'};
    fh.value=map[statPeriod]||'';
  }
  if(typeof populatePl==='function') populatePl();
  setVM('events');
  filterLbl(group, value);
}
function statSection(title, summary, rowsHtml){
  return `<div class="stt-sec"><div class="stt-hd">${title}</div>${summary?`<div class="stt-sum">${summary}</div>`:''}${rowsHtml||'<div class="stt-none">No data in this game.</div>'}</div>`;
}
function statRows(tal, group){
  const keys=[...new Set([...Object.keys(tal.h),...Object.keys(tal.a)])].sort((x,y)=>((tal.h[y]||0)+(tal.a[y]||0))-((tal.h[x]||0)+(tal.a[x]||0)));
  if(!keys.length) return '';
  const hC=GAME.homeColor||'#2563eb', aC=GAME.awayColor||'#22c55e';
  const q=s=>esc(s).replace(/'/g,'&#39;');
  return keys.map(k=>{
    const h=tal.h[k]||0, a=tal.a[k]||0, m=Math.max(h,a,1);
    const nav=side=>group?` onclick="statNav('${side}','${q(group)}','${q(k)}')" title="Show these events"`:'';
    return `<div class="stt-row${group?' nav':''}">
      <span class="stt-n${h?' clk':''}"${h?nav('h'):''}>${h||''}</span>
      <span class="stt-bar r"><span style="width:${(h/m)*100}%;background:${hC}"></span></span>
      <span class="stt-k${group?' clk':''}"${nav('')}>${tc(k)}</span>
      <span class="stt-bar"><span style="width:${(a/m)*100}%;background:${aC}"></span></span>
      <span class="stt-n${a?' clk':''}"${a?nav('a'):''}>${a||''}</span>
    </div>`;
  }).join('');
}
function pct(n,d){ return d?Math.round((n/d)*100)+'%':'—'; }
function sumKeys(tal,side,keys){ const b=side==='h'?tal.h:tal.a; return Object.entries(b).filter(([k])=>keys.some(t=>k.toUpperCase().includes(t))).reduce((s,[,v])=>s+v,0); }

// ── Location maps (shots + kickouts plotted on the pitch) ─────
function locPitchSvg(kind){
  if(kind==='shot') return `<svg id="locSvg" viewBox="0 0 100 75" style="width:100%;aspect-ratio:4/3;background:#256e17;border-radius:10px;display:block;"><rect x="1.2" y="1.20" width="97.6" height="7.15" fill="#35862a"/><rect x="1.2" y="8.35" width="97.6" height="7.15" fill="#2e7a24"/><rect x="1.2" y="15.50" width="97.6" height="7.40" fill="#35862a"/><rect x="1.2" y="22.90" width="97.6" height="7.28" fill="#2e7a24"/><rect x="1.2" y="30.17" width="97.6" height="7.28" fill="#35862a"/><rect x="1.2" y="37.45" width="97.6" height="7.28" fill="#2e7a24"/><rect x="1.2" y="44.73" width="97.6" height="7.28" fill="#35862a"/><rect x="1.2" y="52.00" width="97.6" height="7.40" fill="#2e7a24"/><rect x="1.2" y="59.40" width="97.6" height="7.40" fill="#35862a"/><rect x="1.2" y="66.80" width="97.6" height="3.50" fill="#2e7a24"/><rect x="1.2" y="70.30" width="97.6" height="3.50" fill="#35862a"/><rect x="1.2" y="1.2" width="97.6" height="72.6" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="1"/><line x1="37.6" y1="1.2" x2="37.6" y2="15.5" stroke="rgba(255,255,255,.92)" stroke-width=".8"/><line x1="62.2" y1="1.2" x2="62.2" y2="15.5" stroke="rgba(255,255,255,.92)" stroke-width=".8"/><rect x="42.4" y="1.2" width="14.8" height="4.5" fill="none" stroke="rgba(255,255,255,.92)" stroke-width=".8"/><circle cx="49.8" cy="12.7" r=".7" fill="rgba(255,255,255,.92)"/><line x1="1.2" y1="15.5" x2="98.8" y2="15.5" stroke="rgba(255,255,255,.92)" stroke-width=".8"/><line x1="1.2" y1="22.9" x2="98.8" y2="22.9" stroke="rgba(255,255,255,.92)" stroke-width=".8"/><path d="M 34.3 22.9 A 15.7 16.1 0 0 0 65.7 22.9" fill="none" stroke="rgba(255,255,255,.92)" stroke-width=".9"/><path d="M 8.4 22.9 A 46.4 46.2 0 0 0 91.2 22.9" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="1"/><line x1="1.2" y1="52" x2="98.8" y2="52" stroke="rgba(255,255,255,.92)" stroke-width=".8"/><g id="mapMarks"></g></svg>`;
  return `<svg id="locSvg" viewBox="0 0 100 89" style="width:100%;aspect-ratio:100/89;background:#256e17;border-radius:10px;display:block;"><rect x="1.2" y="1.20" width="97.6" height="9.62" fill="#35862a"/><rect x="1.2" y="10.82" width="97.6" height="9.62" fill="#2e7a24"/><rect x="1.2" y="20.44" width="97.6" height="9.62" fill="#35862a"/><rect x="1.2" y="30.07" width="97.6" height="9.62" fill="#2e7a24"/><rect x="1.2" y="39.69" width="97.6" height="9.62" fill="#35862a"/><rect x="1.2" y="49.31" width="97.6" height="9.62" fill="#2e7a24"/><rect x="1.2" y="58.93" width="97.6" height="9.62" fill="#35862a"/><rect x="1.2" y="68.55" width="97.6" height="9.62" fill="#2e7a24"/><rect x="1.2" y="78.18" width="97.6" height="9.62" fill="#35862a"/><rect x="1.2" y="1.2" width="97.6" height="86.6" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="1"/> <line x1="37.6" y1="1.2" x2="37.6" y2="12.46" stroke="rgba(255,255,255,.92)" stroke-width=".8"/> <line x1="62.2" y1="1.2" x2="62.2" y2="12.46" stroke="rgba(255,255,255,.92)" stroke-width=".8"/> <rect x="42.4" y="1.2" width="14.8" height="4.6" fill="none" stroke="rgba(255,255,255,.92)" stroke-width=".8"/> <circle cx="50" cy="10.4" r=".7" fill="rgba(255,255,255,.92)"/> <line x1="1.2" y1="12.46" x2="98.8" y2="12.46" stroke="rgba(255,255,255,.92)" stroke-width=".8"/> <line x1="1.2" y1="18.42" x2="98.8" y2="18.42" stroke="rgba(255,255,255,.92)" stroke-width=".8"/> <path d="M 37.7 18.42 A 12.3 13.4 0 0 0 62.3 18.42" fill="none" stroke="rgba(255,255,255,.92)" stroke-width=".9"/> <path d="M 6 18.42 A 60.4 60.4 0 0 0 94 18.42" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="1"/> <line x1="1.2" y1="42.14" x2="98.8" y2="42.14" stroke="rgba(255,255,255,.92)" stroke-width=".8"/> <line x1="1.2" y1="60.03" x2="98.8" y2="60.03" stroke="rgba(255,255,255,.92)" stroke-width=".8"/> <line x1="1.2" y1="66.26" x2="98.8" y2="66.26" stroke="rgba(255,255,255,.92)" stroke-width="1" stroke-dasharray="3.2,2.4"/> <line x1="1.2" y1="72.09" x2="98.8" y2="72.09" stroke="rgba(255,255,255,.92)" stroke-width=".8"/><g id="mapMarks"></g></svg>`;
}
// Marker style: circle = open play, square = dead ball; colour by result
// (1pt white / 2pt orange / goal yellow / other outcome red / penalty purple).
function locShotGlyph(e){
  const code=(e.code||'').toUpperCase();
  const L=e.labels||{};
  const out=String(L['Shot Outcomes']||L['ShotOutcome']||L['Outcome']||e.outcome||'').toUpperCase();
  const all=(code+' '+out+' '+Object.values(e.labels||{}).join(' ')).toUpperCase();
  const shape=/DEADBALL|FREE|PENALTY|\b45\b|MARK/.test(code)?'square':'circle';
  let color='#c4c4c4';
  if(/PENALTY/.test(all)) color='#a855f7';
  else if(/GOAL/.test(out)) color='#ffd700';
  else if(/2 POINT|TWO POINT/.test(out)) color='#f97316';
  else if(/POINT/.test(out)) color='#ffffff';
  else if(out) color='#ef4444';
  return {shape,color};
}
let locMap={kind:'shot',team:'h'};
// Y-KOs labels are full-pitch % from the kicking goal (the tracker's convention);
// the KO chart spans 92m of the 137m pitch, so scale up and clamp to the view.
function koPlotY(y){ return Math.min(87.5, y*(137/92)*0.89); }
// Coordinates: native e.x/e.y first, else Match Tracker label pairs
// (X-Shot/Y-Shot, X-Shot_away, X-KOs, ...), 0-100 scale.
// Older Mayo Sportscode timelines tag on a pitch rotated 90° (goal at X=100):
// those games are detected once (cohesionXpDetectConv, from the Shot Zones
// labels) and their label pairs un-rotated here, so every map plots them the
// same way as tracker files (goal at the top, X across).
function dashCoordOf(e){
  if(e&&e.x!=null&&e.y!=null) return {x:e.x,y:e.y};
  const keys=Object.keys(e&&e.labels||{});
  for(const k of keys){
    const m=/^x([-_ ].*)$/i.exec(k); if(!m) continue;
    const yk=keys.find(k2=>/^y/i.test(k2)&&k2.slice(1).toLowerCase()===m[1].toLowerCase());
    if(!yk) continue;
    let x=parseFloat(e.labels[k]), y=parseFloat(e.labels[yk]);
    if(isFinite(x)&&isFinite(y)){
      if(dashCoordConv()==='sportscode_rot'){ const x0=x; x=100-y; y=100-x0; }
      return {x:Math.max(0,Math.min(100,x)),y:Math.max(0,Math.min(100,y))};
    }
  }
  return null;
}

// ── EXPECTED POINTS (xP) ─────────────────────────────────────────────
// cohesion-xp.js scores every shot that has a location + attempt type.
// Scored once per game bundle (events array, teams, model) and shared by
// the Stats tab, the location maps, the PDF, the maps image and the
// infographic. Unlocated / unlabelled shots are counted and reported, never
// guessed.
let _dashConvC=null, _dashXpC=null;
function dashXpInvalidate(){ _dashConvC=null; _dashXpC=null; }
function dashCoordConv(){
  if(_dashConvC&&_dashConvC.all===ALL&&_dashConvC.n===ALL.length) return _dashConvC.v;
  let v='tracker';
  try{ if(typeof window.cohesionXpDetectConv==='function') v=window.cohesionXpDetectConv(ALL); }catch(_e){ v='tracker'; }
  _dashConvC={all:ALL,n:ALL.length,v};
  return v;
}
function dashXpModel(){ return (typeof window.xpForShot==='function')?((window.xpForShot.model)||window.XP_MODEL||null):null; }
function dashXpLevel(){ const s=String(GAME.section||GAME.level||'').toLowerCase(); return (s==='club'||s==='county')?s:null; }
function dashShotPts(e){
  const L=e.labels||{};
  const k=String(L['Shot Outcomes']||L['ShotOutcome']||L['Outcome']||e.outcome||'').toUpperCase();
  if(!((k.includes('POINT')||k.includes('GOAL'))&&!k.includes('DISALLOWED')&&!k.includes('ATTEMPT'))) return 0;
  return k.includes('GOAL')?3:(k.includes('2 POINT')||k.includes('TWO'))?2:1;
}
function dashXpAll(){
  const M=dashXpModel(); if(!M) return null;
  const C=_dashXpC;
  if(C&&C.all===ALL&&C.n===ALL.length&&C.M===M&&C.H===GAME.homeTeam&&C.A===GAME.awayTeam) return C.v;
  const conv=dashCoordConv(), level=dashXpLevel();
  let h1len=30;
  ALL.forEach(e=>{ const m=/^1H\s+(\d+):(\d+)/.exec(e.gameTime||''); if(m) h1len=Math.max(h1len,Math.ceil(+m[1]+(+m[2])/60)); });
  const minOf=e=>{ const m=/^([12])H\s+(\d+):(\d+)/.exec(e.gameTime||''); if(!m) return null;
    const mn=+m[2]+(+m[3])/60; return +m[1]===1?mn:h1len+mn; };
  const shots=[], byEv=new Map();
  ALL.forEach(e=>{
    const s=statSide(e); if(!s||!/SHOT (OPEN|DEAD)/i.test(e.code||'')) return;
    let r=null;
    try{ r=window.xpForShot(e.labels||{}, s==='h'?'home':'away', level, {conv, deadball:/DEAD ?BALL/i.test(e.code||''), model:M}); }catch(_e){ r=null; }
    const o={e, s, pts:dashShotPts(e), xp:r?r.xp:null, p:r?r.p:null,
      cat:r?(r.parts.dbType!=='open'?'db':r.parts.attempt):null, min:minOf(e), res:r};
    shots.push(o); byEv.set(e,o);
  });
  const v={conv, level, shots, byEv, h1len, version:M.version||'?'};
  _dashXpC={all:ALL,n:ALL.length,M,H:GAME.homeTeam,A:GAME.awayTeam,v};
  return v;
}
function dashXpOf(e){ const X=dashXpAll(); const o=X&&X.byEv.get(e); return o&&o.xp!=null?o.xp:null; }
// Per-team totals over the shots passing pred (default: the Stats period chip).
// pts/xp/diff use ONLY shots that carry an xP; ptsAll/g/p are the full score.
const DASH_XP_CATS=[['1pt','1pt attempts (open play)'],['2pt','2pt attempts (open play)'],['goal','Goal attempts (open play)'],['db','Dead-ball attempts']];
function dashXpSummary(pred){
  const X=dashXpAll(); if(!X) return null;
  const mk=()=>({shots:0,n:0,xp:0,pts:0,ptsAll:0,g:0,p:0,miss:0,missPts:0,
    cat:Object.fromEntries(DASH_XP_CATS.map(([k])=>[k,{n:0,xp:0,pts:0}]))});
  const T={h:mk(),a:mk()};
  X.shots.forEach(o=>{
    if(pred&&!pred(o.e)) return;
    const t=T[o.s]; t.shots++; t.ptsAll+=o.pts; if(o.pts===3) t.g++; else t.p+=o.pts;
    if(o.xp==null){ t.miss++; t.missPts+=o.pts; return; }
    t.n++; t.xp+=o.xp; t.pts+=o.pts;
    const c=t.cat[o.cat]; if(c){ c.n++; c.xp+=o.xp; c.pts+=o.pts; }
  });
  ['h','a'].forEach(s=>{ const t=T[s]; t.diff=t.pts-t.xp; t.perShot=t.n?t.xp/t.n:null;
    t.score=t.g+'-'+String(t.p).padStart(2,'0'); });
  return {X, h:T.h, a:T.a, miss:T.h.miss+T.a.miss, version:X.version, conv:X.conv};
}
function dashXpF(v){ return (Math.round(v*10)/10).toFixed(1); }
// signed difference; ascii=true for jsPDF helvetica (no unicode minus)
function dashXpSigned(v,ascii){ const r=Math.round(v*10)/10; return (r>0?'+':r<0?(ascii?'-':'−'):(ascii?'':'±'))+Math.abs(r).toFixed(1); }
// Marker scale by xP (area ~ xP, clamped): 0.1 xP -> 0.82x, 0.6 -> 1.14x, 2+ -> 1.6x.
// Shots without an xP keep the standard size.
function dashXpScale(xp){ return xp==null?1:0.6+0.7*Math.sqrt(Math.max(0,Math.min(xp,2.2))); }
function locEvents(kind){
  return ALL.filter(e=>dashCoordOf(e) && !giSup(e) && (kind==='shot'?/SHOT/i.test(e.code||''):/KICKOUT|\bKO\b/i.test(e.code||'')));
}
function openLocMap(kind){
  locMap={kind,team:'h'};
  const ov=document.createElement('div'); ov.id='locOv';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:10005;';
  ov.addEventListener('click',e=>{ if(e.target===ov) closeLocMap(); });
  ov.innerHTML=`<div style="background:var(--panel);color:var(--t1);border:1px solid var(--border);border-radius:14px;padding:20px;width:460px;max-width:calc(100vw - 40px);max-height:calc(100vh - 60px);overflow-y:auto;font-family:Barlow,sans-serif;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
      <div style="font:800 17px 'Barlow Condensed',sans-serif;letter-spacing:.5px;flex:1;">${kind==='shot'?'Shot map':'Kickout map'}</div>
      <div id="locTeamBtns" style="display:flex;gap:4px;"></div>
      <button onclick="closeLocMap()" style="padding:6px 10px;border-radius:7px;border:1px solid var(--border);background:var(--card);color:var(--t2);font:700 12px 'Barlow Condensed',sans-serif;cursor:pointer;">✕</button>
    </div>
    ${locPitchSvg(kind)}
    <div id="locLegend" style="margin-top:10px;font-size:11px;color:var(--t2);line-height:1.7;"></div>
  </div>`;
  document.body.appendChild(ov);
  renderLocMap();
}
function closeLocMap(){ const ov=document.getElementById('locOv'); if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); }
function locSetTeam(t){ locMap.team=t; renderLocMap(); }
function renderLocMap(){
  const btns=document.getElementById('locTeamBtns'), marks=document.getElementById('mapMarks'), leg=document.getElementById('locLegend');
  if(!btns||!marks) return;
  const H=tc(GAME.homeTeam||'Home'), A=tc(GAME.awayTeam||'Away');
  btns.innerHTML=`<div class="tl-pb ${locMap.team==='h'?'on':''}" onclick="locSetTeam('h')" style="cursor:pointer;">${H}</div><div class="tl-pb ${locMap.team==='a'?'on':''}" onclick="locSetTeam('a')" style="cursor:pointer;">${A}</div>`;
  const yf=locMap.kind==='shot'?0.75:null;   // ko uses koPlotY (full-pitch % labels)
  const evs=locEvents(locMap.kind).filter(e=>statSide(e)===locMap.team);
  marks.innerHTML=evs.map(e=>{
    const co=dashCoordOf(e); if(!co) return '';
    const cy=locMap.kind==='shot'?co.y*yf:koPlotY(co.y);
    if(locMap.kind==='shot'){
      const g=locShotGlyph(e), xp=dashXpOf(e), k=dashXpScale(xp);
      const tip=`<title>${tc(e.code||'')}${e.player?' — '+esc(e.player):''}${xp!=null?' · xP '+xp.toFixed(2):' · no xP'}</title>`;
      return g.shape==='square'
        ? `<rect x="${co.x-1.7*k}" y="${co.y*yf-1.7*k}" width="${3.4*k}" height="${3.4*k}" fill="${g.color}" stroke="#000" stroke-width=".4">${tip}</rect>`
        : `<circle cx="${co.x}" cy="${co.y*yf}" r="${1.8*k}" fill="${g.color}" stroke="#000" stroke-width=".4">${tip}</circle>`;
    }
    const out=String((e.labels||{})['Kickout Outcomes']||e.outcome||'').toUpperCase();
    const col=/WON/.test(out)?'#4ade80':/LOST/.test(out)?'#ef4444':'#e5e5e5';
    return `<circle cx="${co.x}" cy="${cy}" r="1.8" fill="${col}" stroke="#000" stroke-width=".4"><title>${tc(e.code||'')}${out?' — '+tc(out):''}</title></circle>`;
  }).join('');
  if(leg) leg.innerHTML=locMap.kind==='shot'
    ? `${evs.length} located shots — ● open play · ■ dead ball &nbsp; <span style="color:#fff">●</span> 1pt <span style="color:#f97316">●</span> 2pt <span style="color:#ffd700">●</span> goal <span style="color:#ef4444">●</span> miss <span style="color:#a855f7">●</span> penalty${dashXpModel()?' · bigger marker = higher xP (hover for the value)':''}`
    : `${evs.length} located kickouts — <span style="color:#4ade80">●</span> won · <span style="color:#ef4444">●</span> lost`;
}

// ── STATS IMAGE — the full-game stat card in the tracker app's exact format:
// crests (from an imported tracker team pack), wrapped equal-size names,
// scores+PSR, mirrored bars, scoring worm. Rows the source XML cannot fill
// (both sides zero) are hidden, as are fully-empty sections.
function cohPacksLoad(){ try{ return JSON.parse(localStorage.getItem('coh_team_packs'))||[]; }catch(_e){ return []; } }
function cohPacksStore(ts){ try{ localStorage.setItem('coh_team_packs', JSON.stringify(ts)); }catch(_e){} }
function cohPackTeam(name){ const n=String(name||'').trim().toLowerCase();
  return cohPacksLoad().find(t=>String(t.club||'').trim().toLowerCase()===n)||null; }
// Crest source: cohCrestSrc(name,pack) is the SHARED resolver in cohesion-crests.js
// (team-pack crest, then a crest uploaded on crests-admin.html, then the bundled
// /crests file). Await cohCrestsReady() before drawing so uploaded crests are known.
// Uploaded crests are cross-origin: load them with crossOrigin so canvases don't taint.
// Bundled default colour for a club (from the published team packs) — used
// only when the game has no colour set and no pack is imported on the device.
function cohTeamColourDefault(name){
  const sl=cohCrestSlug(name);
  const C=window.COHESION_TEAM_COLOURS||{};
  return (C[sl]&&C[sl].primary)||null;
}
function cohImportTeamPack(ev){
  const f=ev.target.files&&ev.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const p=JSON.parse(String(rd.result||''));
      if(p.format!=='gaa-team-pack@1'||!Array.isArray(p.teams)) throw new Error('bad');
      const ts=cohPacksLoad();
      let added=0, updated=0;
      p.teams.forEach(t=>{ if(!t.club) return;
        const i=ts.findIndex(x=>String(x.club||'').toLowerCase()===String(t.club).toLowerCase());
        if(i>=0){ ts[i]=t; updated++; } else { ts.push(t); added++; } });
      cohPacksStore(ts);
      alert('Team pack "'+(p.name||'')+'" imported — '+added+' clubs added, '+updated+' updated. Crests and colours now appear on stats images.');
    }catch(_e){ alert('Not a tracker team-pack file (.json exported from the Pack Builder).'); }
  };
  rd.readAsText(f);
  ev.target.value='';
}
function dashComputeStats(){
  const lum=x=>{ try{ const n=parseInt(String(x).replace('#',''),16);
    return 0.2126*((n>>16)&255)+0.7152*((n>>8)&255)+0.0722*(n&255); }catch(_e){ return 0; } };
  const lighten=(x,f)=>{ try{ const n=parseInt(String(x).replace('#',''),16);
    const L=v=>Math.round(v+(255-v)*f);
    return '#'+((1<<24)+(L((n>>16)&255)<<16)+(L((n>>8)&255)<<8)+L(n&255)).toString(16).slice(1);
  }catch(_e){ return x; } };
  const wrapName=nm=>{ const w=String(nm||'').trim().split(/\s+/).filter(Boolean);
    if(w.length<2) return [nm||'—'];
    let best=null;
    for(let i=1;i<w.length;i++){ const l1=w.slice(0,i).join(' '), l2=w.slice(i).join(' ');
      const m=Math.max(l1.length,l2.length); if(!best||m<best.m) best={m,l1,l2}; }
    return [best.l1,best.l2]; };
  const initials=nm=>{ const w=String(nm||'?').trim().split(/\s+/).filter(Boolean);
    return (w.length>1?w.map(x=>x[0]).join(''):String(w[0]||'?').slice(0,3)).slice(0,3).toUpperCase(); };
  const up=s=>String(s||'').toUpperCase();

  const of=(s,re)=>ALL.filter(e=>statSide(e)===s&&re.test(e.code||''));
  const SHOT=/SHOT (OPEN|DEAD)/i;
  const shotOut=e=>up((e.labels||{})['Shot Outcomes']||(e.labels||{})['ShotOutcome']||(e.labels||{})['Outcome']||e.outcome||'');
  const isScoreOut=k=>(k.includes('POINT')||k.includes('GOAL'))&&!k.includes('DISALLOWED')&&!k.includes('ATTEMPT');
  const shots=s=>of(s,SHOT);
  const scored=s=>shots(s).filter(e=>isScoreOut(shotOut(e)));
  const scoreOf=s=>{ let g=0,p=0;
    scored(s).forEach(e=>{ const k=shotOut(e);
      if(k.includes('GOAL')) g++; else if(k.includes('2 POINT')||k.includes('TWO')) p+=2; else p++; });
    return {g,p,str:g+'-'+String(p).padStart(2,'0')}; };
  const psr=s=>{ const t=shots(s).length; return t?Math.round(scored(s).length/t*100)+'%':'—'; };
  const psrN=s=>{ const t=shots(s).length; return t?Math.round(scored(s).length/t*100):0; };
  const goalAtt=s=>{ const st=of(s,/GOAL ATTEMPT/i).length;
    return st||shots(s).filter(e=>/GOAL/i.test((e.labels||{})['Shot Attempts']||'')).length; };
  const KO=/KICKOUT|\bKO\b/i;
  const koOut=e=>up((e.labels||{})['Kickout Outcomes']||(e.labels||{})['KickoutOutcome']||(e.labels||{})['PO_Result']||e.outcome||'');
  const koAll=s=>of(s,KO).filter(e=>koOut(e));
  const koWonN=s=>koAll(s).filter(e=>koWonStr(koOut(e),s)).length;
  const koBreak=(s,won)=>koAll(s).filter(e=>koOut(e).includes(won?'BREAK WON':'BREAK LOST')).length;
  const fouls=(s,z)=>of(s,/\bFOUL\b/i).filter(e=>{ if(!z) return true;
    return up((e.labels||{})['Foul Areas']||'').includes(z); }).length;
  const cards=(s,t)=>of(s,/\bCARD\b/i).filter(e=>up((e.labels||{})['Card Outcomes']||'').includes(t)).length;

  const scH=scoreOf('h'), scA=scoreOf('a');
  const possH=of('h',/TEAM POSSESSION/i).length, possA=of('a',/TEAM POSSESSION/i).length;
  const possT=possH+possA, ppH=possT?Math.round(possH/possT*100):0, ppA=possT?100-ppH:0;
  const kwH=koWonN('h'), ktH=koAll('h').length, klH=ktH-kwH;
  const kwA=koWonN('a'), ktA=koAll('a').length, klA=ktA-kwA;
  const kwpH=ktH?kwH/ktH*100:0, kwpA=ktA?kwA/ktA*100:0;
  const ftH=fouls('h'), ftA=fouls('a');
  const GOOD='#2ecc71', WARN='#e67e22', TXT='#e8e8ee';
  // basis = the underlying totals; a row with basis 0 has nothing the XML
  // could fill and is hidden.
  const row=(label,nH,nA,dH,dA,cH,cA,pH,pA,basis)=>{
    let wH,wA;
    if(pH!==undefined){ wH=Math.round(pH); wA=Math.round(pA); }
    else{ const t=nH+nA; wH=t?Math.round(nH/t*100):0; wA=t?Math.round(nA/t*100):0; }
    return {label, dH:(dH!==undefined?dH:String(nH)), dA:(dA!==undefined?dA:String(nA)),
            wH, wA, cH:cH||TXT, cA:cA||TXT, basis:(basis!==undefined?basis:nH+nA)}; };
  let sections=[
    ['SHOOTING',[
      row('Shots (scored/total)',shots('h').length,shots('a').length,scored('h').length+'/'+shots('h').length,scored('a').length+'/'+shots('a').length),
      row('Shooting %',psrN('h'),psrN('a'),psr('h'),psr('a'),null,null,psrN('h'),psrN('a'),shots('h').length+shots('a').length),
      row('Shots Open Play',of('h',/SHOT OPEN/i).length,of('a',/SHOT OPEN/i).length),
      row('Shots Dead Ball',of('h',/SHOT DEAD/i).length,of('a',/SHOT DEAD/i).length),
      row('Goal Attempts',goalAtt('h'),goalAtt('a'))]],
    ['POSSESSION & ATTACKS',[
      row('Possessions',possH,possA,possH+' ('+ppH+'%)',possA+' ('+ppA+'%)'),
      row('Attacks',of('h',/\bATTACKS?\b/i).length,of('a',/\bATTACKS?\b/i).length)]],
    ['KICKOUTS',[
      row('KO Won',kwH,kwA,kwH+' ('+Math.round(kwpH)+'%)',kwA+' ('+Math.round(kwpA)+'%)',kwH>=klH?GOOD:null,kwA>=klA?GOOD:null,kwpH,kwpA,ktH+ktA),
      row('KO Lost',klH,klA,klH+' ('+Math.round(ktH?100-kwpH:0)+'%)',klA+' ('+Math.round(ktA?100-kwpA:0)+'%)',klH>kwH?WARN:null,klA>kwA?WARN:null,ktH?100-kwpH:0,ktA?100-kwpA:0,ktH+ktA),
      row('Breaks Won (Own KO)',koBreak('h',true),koBreak('a',true)),
      row('Breaks Won (Opp KO)',koBreak('a',false),koBreak('h',false)),
      row('Breaks Lost (Own KO)',koBreak('h',false),koBreak('a',false)),
      row('Breaks Lost (Opp KO)',koBreak('a',true),koBreak('h',true))]],
    ['FOULS CONCEDED',[
      row('Def Third',fouls('h','DEF'),fouls('a','DEF')),
      row('Mid Third',fouls('h','MID'),fouls('a','MID')),
      row('Att Third',fouls('h','ATT'),fouls('a','ATT')),
      row('Total Fouls',ftH,ftA,undefined,undefined,ftH>5?WARN:null,ftA>5?WARN:null)]],
    ['CARDS',[
      row('Yellow',cards('h','YELLOW'),cards('a','YELLOW')),
      row('Black',cards('h','BLACK'),cards('a','BLACK')),
      row('Red',cards('h','RED'),cards('a','RED'))]]
  ];
  // hide unfillable rows, then empty sections
  sections.forEach(sec=>{ sec[1]=sec[1].filter(r=>r.basis>0); });
  sections=sections.filter(sec=>sec[1].length>0);

  const minOf=e=>{ const m=/^([12])H\s+(\d+):(\d+)/.exec(e.gameTime||''); if(!m) return null;
    return {half:+m[1], min:+m[2]+(+m[3])/60}; };
  let h1len=30;
  ALL.forEach(e=>{ const t=minOf(e); if(t&&t.half===1) h1len=Math.max(h1len,Math.ceil(t.min)); });
  const scoreEvts=[];
  ['h','a'].forEach(s=>scored(s).forEach(e=>{ const t=minOf(e); if(!t) return;
    const k=shotOut(e);
    scoreEvts.push({s, min:t.half===1?t.min:h1len+t.min,
      pts:k.includes('GOAL')?3:(k.includes('2 POINT')||k.includes('TWO'))?2:1}); }));
  scoreEvts.sort((x,y)=>x.min-y.min);
  const hasWorm=scoreEvts.length>0;

  return { sections, scH, scA,
    psrH:psr('h'), psrA:psr('a'),
    shotsH:shots('h').length, shotsA:shots('a').length,
    scoredH:scored('h').length, scoredA:scored('a').length,
    scoreEvts, hasWorm, h1len };
}
function dashBuildStatsCanvas(){
  const lum=x=>{ try{ const n=parseInt(String(x).replace('#',''),16);
    return 0.2126*((n>>16)&255)+0.7152*((n>>8)&255)+0.0722*(n&255); }catch(_e){ return 0; } };
  const lighten=(x,f)=>{ try{ const n=parseInt(String(x).replace('#',''),16);
    const L=v=>Math.round(v+(255-v)*f);
    return '#'+((1<<24)+(L((n>>16)&255)<<16)+(L((n>>8)&255)<<8)+L(n&255)).toString(16).slice(1);
  }catch(_e){ return x; } };
  const wrapName=nm=>{ const w=String(nm||'').trim().split(/\s+/).filter(Boolean);
    if(w.length<2) return [nm||'—'];
    let best=null;
    for(let i=1;i<w.length;i++){ const l1=w.slice(0,i).join(' '), l2=w.slice(i).join(' ');
      const m=Math.max(l1.length,l2.length); if(!best||m<best.m) best={m,l1,l2}; }
    return [best.l1,best.l2]; };
  const initials=nm=>{ const w=String(nm||'?').trim().split(/\s+/).filter(Boolean);
    return (w.length>1?w.map(x=>x[0]).join(''):String(w[0]||'?').slice(0,3)).slice(0,3).toUpperCase(); };
  const up=s=>String(s||'').toUpperCase();
  const S=dashComputeStats();
  const sections=S.sections, scH=S.scH, scA=S.scA, hasWorm=S.hasWorm, scoreEvts=S.scoreEvts, h1len=S.h1len;
  const psr=side=>side==='h'?S.psrH:S.psrA;
  const packH=cohPackTeam(GAME.homeTeam), packA=cohPackTeam(GAME.awayTeam);
  const hCraw=GAME.homeColor||(packH&&packH.primary)||cohTeamColourDefault(GAME.homeTeam)||'#2563eb';
  const aCraw=GAME.awayColor||(packA&&packA.primary)||cohTeamColourDefault(GAME.awayTeam)||'#22c55e';
  // Bars use the exact colour selected in COHESION. Thin elements (team name,
  // worm line) get nudged toward white just enough to read on the black card
  // when the colour is very dark (e.g. maroon), keeping the hue.
  const legible=prim=>{
    let c=prim, n=0;
    while(lum(c)<70 && n<6){ c=lighten(c,0.18); n++; }
    return c; };
  const colH=hCraw, colA2=aCraw;
  const txtH=legible(hCraw), txtA=legible(aCraw);

  const loadImg=src=>new Promise(res=>{ if(!src) return res(null);
    const im=new Image(); im.crossOrigin='anonymous'; im.onload=()=>res(im); im.onerror=()=>res(null); im.src=src; });
  return cohCrestsReady().then(()=>Promise.all([loadImg(cohCrestSrc(GAME.homeTeam,packH)), loadImg(cohCrestSrc(GAME.awayTeam,packA))])).then(([crH,crA])=>{
    const W=1080, HEAD=260, TITLE_H=52, ROW_H=44, WORM_H=330, FOOT=56;
    const nRows=sections.reduce((s,x)=>s+x[1].length,0);
    const HGT=HEAD+sections.length*TITLE_H+nRows*ROW_H+(hasWorm?TITLE_H+WORM_H:0)+FOOT;
    const cv=document.createElement('canvas'); cv.width=W; cv.height=HGT;
    const ctx=cv.getContext('2d');
    const g=ctx.createLinearGradient(0,0,0,HGT);
    g.addColorStop(0,'#12121a'); g.addColorStop(1,'#0c0c12');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,HGT);
    ctx.fillStyle=hCraw; ctx.fillRect(0,0,10,HGT);
    ctx.fillStyle=aCraw; ctx.fillRect(W-10,0,10,HGT);
    ctx.textAlign='center';
    const crest=(im,cx,cy,r,col,nm)=>{
      ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.closePath();
      ctx.fillStyle='#1c1c26'; ctx.fill(); ctx.clip();
      if(im) ctx.drawImage(im,cx-r,cy-r,r*2,r*2);
      else{ ctx.fillStyle=col; ctx.fillRect(cx-r,cy-r,r*2,r*2);
        ctx.fillStyle='#fff'; ctx.font='700 '+Math.round(r*0.6)+'px "Barlow Condensed","Barlow",sans-serif';
        ctx.fillText(initials(nm),cx,cy+r*0.2); }
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
      ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=3; ctx.stroke();
    };
    crest(crH,120,150,68,hCraw,GAME.homeTeam); crest(crA,W-120,150,68,aCraw,GAME.awayTeam);
    const linesH=wrapName(up(GAME.homeTeam)), linesA=wrapName(up(GAME.awayTeam));
    let nfs=42;
    const nfits=fs=>{ ctx.font='italic 800 '+fs+'px "Barlow",sans-serif';
      return linesH.concat(linesA).every(l=>ctx.measureText(l).width<=300); };
    while(nfs>22 && !nfits(nfs)) nfs-=2;
    const teamCol=(lines,col,cx,sc,ps)=>{
      ctx.fillStyle=col; ctx.font='italic 800 '+nfs+'px "Barlow",sans-serif';
      lines.forEach((l,i)=>ctx.fillText(l,cx,70+i*(nfs+8)));
      ctx.fillStyle='#fff'; ctx.font='800 84px "Barlow Condensed","Barlow",sans-serif';
      ctx.fillText(sc,cx,196);
      ctx.fillStyle='#77777f'; ctx.font='600 24px "Barlow",sans-serif';
      ctx.fillText('PSR: '+ps,cx,232);
    };
    teamCol(linesH,txtH,W*0.32,scH.str,psr('h')); teamCol(linesA,txtA,W*0.68,scA.str,psr('a'));
    ctx.fillStyle='#3a3a44'; ctx.font='800 40px "Barlow Condensed",sans-serif'; ctx.fillText('V',W/2,166);
    ctx.fillStyle='#9a9aa5'; ctx.font='600 24px "Barlow",sans-serif';
    ctx.fillText('FULL TIME', W/2, 236);
    let y=HEAD;
    const CX=W/2, LBL_W=300, TRACK_H=13;
    const trackL1=CX-LBL_W/2-14, trackR0=CX+LBL_W/2+14;
    sections.forEach(([title,rows])=>{
      ctx.fillStyle='#8a8a95'; ctx.font='700 26px "Barlow Condensed","Barlow",sans-serif';
      ctx.textAlign='center'; ctx.fillText(title, CX, y+34);
      ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=1;
      const tw=ctx.measureText(title).width;
      ctx.beginPath(); ctx.moveTo(60,y+26); ctx.lineTo(CX-tw/2-18,y+26);
      ctx.moveTo(CX+tw/2+18,y+26); ctx.lineTo(W-60,y+26); ctx.stroke();
      y+=TITLE_H;
      rows.forEach(r=>{
        const cy=y+ROW_H/2;
        ctx.font='500 24px "Barlow Condensed","Barlow",monospace';
        const tl0=18+ctx.measureText(r.dH).width+14;
        const tr1=W-18-ctx.measureText(r.dA).width-14;
        ctx.textAlign='left';  ctx.fillStyle=r.cH; ctx.fillText(r.dH, 18, cy+8);
        ctx.textAlign='right'; ctx.fillStyle=r.cA; ctx.fillText(r.dA, W-18, cy+8);
        ctx.textAlign='center'; ctx.fillStyle='#9a9aa5';
        ctx.font='600 22px "Barlow",sans-serif';
        ctx.fillText(r.label, CX, cy+7);
        ctx.fillStyle='#232330';
        ctx.fillRect(tl0,cy-TRACK_H/2,trackL1-tl0,TRACK_H);
        ctx.fillRect(trackR0,cy-TRACK_H/2,tr1-trackR0,TRACK_H);
        const wl=(trackL1-tl0)*Math.min(100,r.wH)/100;
        const wr=(tr1-trackR0)*Math.min(100,r.wA)/100;
        ctx.fillStyle=colH; ctx.fillRect(trackL1-wl,cy-TRACK_H/2,wl,TRACK_H);
        ctx.fillStyle=colA2; ctx.fillRect(trackR0,cy-TRACK_H/2,wr,TRACK_H);
        y+=ROW_H;
      });
    });
    if(hasWorm){
      ctx.fillStyle='#8a8a95'; ctx.font='700 26px "Barlow Condensed","Barlow",sans-serif';
      ctx.textAlign='center'; ctx.fillText('SCORING TIMELINE', CX, y+34);
      y+=TITLE_H;
      const ML=70, MR=40, MT=14, MB=44;
      const pw=W-ML-MR, ph=WORM_H-MT-MB;
      const nowMin=Math.max(scoreEvts[scoreEvts.length-1].min, h1len*2, 10);
      let cH=0,cA=0;
      const ptsH=[{min:0,v:0}], ptsA=[{min:0,v:0}];
      scoreEvts.forEach(sv=>{ if(sv.s==='h'){cH+=sv.pts; ptsH.push({min:sv.min,v:cH});}
                              else{cA+=sv.pts; ptsA.push({min:sv.min,v:cA});} });
      ptsH.push({min:nowMin,v:cH}); ptsA.push({min:nowMin,v:cA});
      const maxV=Math.max(cH,cA,5);
      const X=m=>ML+(m/nowMin)*pw, Y=v=>y+MT+ph-(v/maxV)*ph;
      ctx.strokeStyle='#26262f'; ctx.fillStyle='#6a6a75';
      ctx.font='18px "Barlow",monospace'; ctx.lineWidth=1;
      const step=maxV<=10?2:maxV<=25?5:10;
      ctx.textAlign='right';
      for(let v=0;v<=maxV;v+=step){
        ctx.beginPath(); ctx.moveTo(ML,Y(v)); ctx.lineTo(W-MR,Y(v)); ctx.stroke();
        ctx.fillText(v,ML-10,Y(v)+6);
      }
      ctx.textAlign='center';
      const xs=nowMin<=20?5:nowMin<=45?10:15;
      for(let m=0;m<=nowMin;m+=xs) ctx.fillText(Math.round(m)+"'",X(m),y+WORM_H-14);
      [[txtH,ptsH],[txtA,ptsA]].forEach(([col,pts])=>{
        ctx.strokeStyle=col; ctx.fillStyle=col; ctx.lineWidth=4;
        ctx.beginPath();
        pts.forEach((p,i)=>{ const x=X(p.min), yy=Y(p.v);
          if(i===0) ctx.moveTo(x,yy);
          else{ ctx.lineTo(x,Y(pts[i-1].v)); ctx.lineTo(x,yy); } });
        ctx.stroke();
        pts.slice(1,-1).forEach(p=>{ ctx.beginPath(); ctx.arc(X(p.min),Y(p.v),6,0,Math.PI*2); ctx.fill(); });
      });
      y+=WORM_H;
    }
    ctx.fillStyle='#55555f'; ctx.font='600 22px "Barlow",sans-serif';
    ctx.textAlign='center'; ctx.fillText('COHESION ANALYSIS', W/2, HGT-16);
    return cv;
  });
}
function dashShareStatsCard(){
  dashBuildStatsCanvas().then(cv=>{
    cv.toBlob(b=>{
      if(!b) return;
      const fname=(String(GAME.homeTeam||'home')+'_v_'+String(GAME.awayTeam||'away')+'_stats.png').toLowerCase().replace(/[^\w.]+/g,'_');
      const file=(typeof File!=='undefined')?new File([b],fname,{type:'image/png'}):null;
      if(file && navigator.canShare && navigator.canShare({files:[file]})){
        navigator.share({files:[file], title:(GAME.homeTeam||'')+' v '+(GAME.awayTeam||'')}).catch(()=>dashDlBlob(b,fname));
      } else dashDlBlob(b,fname);
    },'image/png');
  });
}
// ── MATCH MOMENTUM from the game's XML events (light theme for the PDF):
// TO won: 1 · missed shot: 2 · point: 3 · 2-pointer: 4 · goal: 5. Home up,
// away down, both in their (pack-aware) colours; scores carry markers.
function dashBuildMomentumCanvas(){
  const up=s=>String(s||'').toUpperCase();
  const shotOut=e=>up((e.labels||{})['Shot Outcomes']||(e.labels||{})['ShotOutcome']||(e.labels||{})['Outcome']||e.outcome||'');
  const minOf=e=>{ const m=/^([12])H\s+(\d+):(\d+)/.exec(e.gameTime||''); if(!m) return null;
    return {half:+m[1], min:+m[2]+(+m[3])/60}; };
  let h1len=30;
  ALL.forEach(e=>{ const t=minOf(e); if(t&&t.half===1) h1len=Math.max(h1len,Math.ceil(t.min)); });
  const cum=e=>{ const t=minOf(e); return t?(t.half===1?t.min:h1len+t.min):null; };
  const items=[];
  ALL.forEach(e=>{
    const s=statSide(e); if(!s) return;
    const m=cum(e); if(m==null) return;
    if(/SHOT (OPEN|DEAD)/i.test(e.code||'')){
      const k=shotOut(e);
      if((k.includes('POINT')||k.includes('GOAL'))&&!k.includes('DISALLOWED')&&!k.includes('ATTEMPT')){
        const v=k.includes('GOAL')?5:(k.includes('2 POINT')||k.includes('TWO'))?4:3;
        items.push({s,m,v,kind:v===5?'goal':v===4?'2pt':'1pt'});
      } else items.push({s,m,v:2});
    } else if(/TURNOVER|\bTOS?\b/i.test(e.code||'')){
      items.push({s:s==='h'?'a':'h', m, v:1});
    }
  });
  if(!items.length) return null;
  let maxMin=0; items.forEach(it=>{ maxMin=Math.max(maxMin,it.m); });
  const nW=Math.max(1,Math.ceil((maxMin+0.01)/2));
  const H2=new Array(nW).fill(0), A2=new Array(nW).fill(0), markers=[];
  items.forEach(it=>{
    const w=Math.min(nW-1,Math.floor(it.m/2));
    if(it.s==='h') H2[w]+=it.v; else A2[w]+=it.v;
    if(it.kind) markers.push({w, s:it.s, kind:it.kind});
  });
  const packH=cohPackTeam(GAME.homeTeam), packA=cohPackTeam(GAME.awayTeam);
  const colH=GAME.homeColor||(packH&&packH.primary)||cohTeamColourDefault(GAME.homeTeam)||'#2ecc71';
  const colA=GAME.awayColor||(packA&&packA.primary)||cohTeamColourDefault(GAME.awayTeam)||'#e74c3c';
  const W=1400, HT=460;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=HT;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,HT);
  const ML2=52, MR2=16, MT2=18, MB2=38;
  const plotW=W-ML2-MR2, plotH=HT-MT2-MB2;
  const maxV=Math.max(...H2,...A2,5);
  const zeroY=MT2+plotH/2, scaleY=(plotH/2-8)/maxV, bw=plotW/nW;
  ctx.strokeStyle='#e4e4ec'; ctx.fillStyle='#8a8a95';
  ctx.font='13px sans-serif'; ctx.textAlign='right'; ctx.lineWidth=1;
  const step=maxV<=10?5:10;
  for(let v=-Math.floor(maxV/step)*step; v<=maxV; v+=step){
    const yy=zeroY-v*scaleY;
    ctx.beginPath(); ctx.moveTo(ML2,yy); ctx.lineTo(W-MR2,yy); ctx.stroke();
    ctx.fillText((v>0?'+':'')+v,ML2-7,yy+4);
  }
  const _mL=h=>{ try{ const n=parseInt(String(h).replace('#',''),16);
    return 0.2126*((n>>16)&255)+0.7152*((n>>8)&255)+0.0722*(n&255); }catch(_e){ return 0; } };
  const litH=_mL(colH)>=200, litA=_mL(colA)>=200;
  ctx.lineWidth=1;
  for(let w=0;w<nW;w++){
    const x=ML2+w*bw+1, wd=Math.max(2,bw-2);
    if(H2[w]){ const hh=H2[w]*scaleY; ctx.fillStyle=colH; ctx.fillRect(x,zeroY-hh,wd,hh-1);
      if(litH){ ctx.strokeStyle='#6a7080'; ctx.strokeRect(x,zeroY-hh,wd,hh-1); } }
    if(A2[w]){ const hh=A2[w]*scaleY; ctx.fillStyle=colA; ctx.fillRect(x,zeroY+1,wd,hh-1);
      if(litA){ ctx.strokeStyle='#6a7080'; ctx.strokeRect(x,zeroY+1,wd,hh-1); } }
  }
  ctx.strokeStyle='#b8b8c2'; ctx.beginPath(); ctx.moveTo(ML2,zeroY); ctx.lineTo(W-MR2,zeroY); ctx.stroke();
  const x=ML2+(h1len/2)*bw;
  if(h1len/2<nW){
    ctx.strokeStyle='#8a8a95'; ctx.setLineDash([6,4]);
    ctx.beginPath(); ctx.moveTo(x,MT2-4); ctx.lineTo(x,MT2+plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign='center'; ctx.fillStyle='#8a8a95'; ctx.fillText('HT',x,MT2-6);
  }
  const stackN={};
  markers.forEach(mk=>{
    const key=mk.s+mk.w, n=(stackN[key]=(stackN[key]||0)+1);
    const mx=ML2+mk.w*bw+bw/2;
    const base=mk.s==='h'? zeroY-H2[mk.w]*scaleY-9-(n-1)*15 : zeroY+A2[mk.w]*scaleY+9+(n-1)*15;
    if(mk.kind==='goal'){
      ctx.fillStyle='#006a4e'; ctx.strokeStyle='#003d2d';
      ctx.beginPath(); ctx.arc(mx,base,6,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle='#ffffff'; ctx.beginPath(); ctx.arc(mx,base,2.5,0,Math.PI*2); ctx.stroke();
    } else if(mk.kind==='2pt'){
      ctx.fillStyle='#f97316'; ctx.strokeStyle='#555';
      ctx.beginPath(); ctx.moveTo(mx-5,base+5); ctx.lineTo(mx-5,base-7); ctx.lineTo(mx+7,base-1); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle='#f4f4f6'; ctx.strokeStyle='#777';
      ctx.fillRect(mx-4,base-5,10,8); ctx.strokeRect(mx-4,base-5,10,8);
      ctx.beginPath(); ctx.moveTo(mx-4,base+3); ctx.lineTo(mx-4,base+7); ctx.stroke();
    }
  });
  ctx.fillStyle='#8a8a95'; ctx.textAlign='center'; ctx.font='13px sans-serif';
  for(let min=0;min<=nW*2;min+=10) ctx.fillText(String(min),ML2+(min/2)*bw,HT-18);
  ctx.fillText('Match Minute',ML2+plotW/2,HT-4);
  return cv;
}
// ── MATCH REPORT PDF — the tracker's full report format, computed from the
// game's XML. Sections the XML cannot fill are hidden. Full game only.
function dashBuildWormCanvas(S,hHex,aHex){
  if(!S.hasWorm) return null;
  const W=1200,HH=420;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=HH;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,HH);
  const ML=56,MR=18,MT=16,MB=40;
  const pw=W-ML-MR, ph=HH-MT-MB;
  const evs=S.scoreEvts;
  const nowMin=Math.max(evs.length?evs[evs.length-1].min:0,S.h1len*2,10);
  let cH=0,cA=0;
  const pH=[{min:0,v:0}], pA=[{min:0,v:0}];
  evs.forEach(sv=>{ if(sv.s==='h'){cH+=sv.pts;pH.push({min:sv.min,v:cH});} else {cA+=sv.pts;pA.push({min:sv.min,v:cA});} });
  pH.push({min:nowMin,v:cH}); pA.push({min:nowMin,v:cA});
  const maxV=Math.max(cH,cA,5);
  const X=m=>ML+(m/nowMin)*pw, Y=v=>MT+ph-(v/maxV)*ph;
  ctx.strokeStyle='#d5dae2'; ctx.fillStyle='#4a5568';
  ctx.font='15px Helvetica,Arial,sans-serif'; ctx.textAlign='right'; ctx.lineWidth=1;
  const step=maxV<=10?2:maxV<=25?5:10;
  for(let v=0;v<=maxV;v+=step){
    ctx.beginPath(); ctx.moveTo(ML,Y(v)); ctx.lineTo(W-MR,Y(v)); ctx.stroke();
    ctx.fillText(v,ML-8,Y(v)+5);
  }
  ctx.textAlign='center';
  const xs=nowMin<=20?5:nowMin<=45?10:15;
  for(let m=0;m<=nowMin;m+=xs) ctx.fillText(Math.round(m)+"'",X(m),HH-16);
  const wl=h=>{ try{ const n=parseInt(String(h).replace('#',''),16);
    return 0.2126*((n>>16)&255)+0.7152*((n>>8)&255)+0.0722*(n&255); }catch(_e){ return 0; } };
  [[hHex,pH],[aHex,pA]].forEach(([col,pts])=>{
    if(wl(col)>=200){
      ctx.strokeStyle='#6a7080'; ctx.lineWidth=7; ctx.beginPath();
      pts.forEach((p,i)=>{ const x=X(p.min), yy=Y(p.v);
        if(i===0) ctx.moveTo(x,yy); else { ctx.lineTo(x,Y(pts[i-1].v)); ctx.lineTo(x,yy); } });
      ctx.stroke();
    }
    ctx.strokeStyle=col; ctx.fillStyle=col; ctx.lineWidth=4;
    ctx.beginPath();
    pts.forEach((p,i)=>{ const x=X(p.min), yy=Y(p.v);
      if(i===0) ctx.moveTo(x,yy); else { ctx.lineTo(x,Y(pts[i-1].v)); ctx.lineTo(x,yy); } });
    ctx.stroke();
    pts.slice(1,-1).forEach(p=>{ ctx.beginPath(); ctx.arc(X(p.min),Y(p.v),5,0,Math.PI*2); ctx.fill();
      if(wl(col)>=200){ ctx.strokeStyle='#6a7080'; ctx.lineWidth=1.2; ctx.stroke(); ctx.strokeStyle=col; } });
  });
  return cv;
}
// Running points (solid step) v running xP (dashed step), both teams, in the
// scoring-timeline's white style. Full game.
function dashBuildXpWormCanvas(hHex,aHex){
  const X=dashXpAll(); if(!X) return null;
  const sh=X.shots.filter(o=>o.min!=null).sort((p,q)=>p.min-q.min);
  if(!sh.some(o=>o.xp!=null)) return null;
  const W=1200,HH=380, ML=56,MR=18,MT=16,MB=40, pw=W-ML-MR, ph=HH-MT-MB;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=HH;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,HH);
  const nowMin=Math.max(sh[sh.length-1].min,X.h1len*2,10);
  const ser={h:{p:[{m:0,v:0}],x:[{m:0,v:0}]},a:{p:[{m:0,v:0}],x:[{m:0,v:0}]}}, tot={h:{p:0,x:0},a:{p:0,x:0}};
  sh.forEach(o=>{ const t=tot[o.s];
    if(o.pts){ t.p+=o.pts; ser[o.s].p.push({m:o.min,v:t.p}); }
    if(o.xp!=null){ t.x+=o.xp; ser[o.s].x.push({m:o.min,v:t.x}); } });
  ['h','a'].forEach(s=>{ ser[s].p.push({m:nowMin,v:tot[s].p}); ser[s].x.push({m:nowMin,v:tot[s].x}); });
  const maxV=Math.max(5,tot.h.p,tot.a.p,tot.h.x,tot.a.x);
  const Xp=m=>ML+(m/nowMin)*pw, Yp=v=>MT+ph-(v/maxV)*ph;
  ctx.strokeStyle='#d5dae2'; ctx.fillStyle='#4a5568'; ctx.font='15px Helvetica,Arial,sans-serif'; ctx.textAlign='right'; ctx.lineWidth=1;
  const step=maxV<=10?2:maxV<=25?5:10;
  for(let v=0;v<=maxV;v+=step){ ctx.beginPath(); ctx.moveTo(ML,Yp(v)); ctx.lineTo(W-MR,Yp(v)); ctx.stroke(); ctx.fillText(v,ML-8,Yp(v)+5); }
  ctx.textAlign='center';
  const xs=nowMin<=20?5:nowMin<=45?10:15;
  for(let m=0;m<=nowMin;m+=xs) ctx.fillText(Math.round(m)+"'",Xp(m),HH-16);
  const path=pts=>{ ctx.beginPath(); pts.forEach((p,i)=>{ if(i===0) ctx.moveTo(Xp(p.m),Yp(p.v)); else { ctx.lineTo(Xp(p.m),Yp(pts[i-1].v)); ctx.lineTo(Xp(p.m),Yp(p.v)); } }); };
  [[hHex,'h'],[aHex,'a']].forEach(([col,s])=>{
    const light=dashHexLum(col)>=200;
    [['x',true],['p',false]].forEach(([k,dash])=>{
      ctx.setLineDash(dash?[14,9]:[]);
      if(light){ ctx.strokeStyle='#9ca3af'; ctx.lineWidth=dash?5:7; path(ser[s][k]); ctx.stroke(); }
      ctx.strokeStyle=col; ctx.lineWidth=dash?3:4; path(ser[s][k]); ctx.stroke(); });
    ctx.setLineDash([]);
  });
  return cv;
}
// ── PDF pitch maps & charts ──────────────────────────────────────────
// Shot / kickout events with coordinates, plus per-team counts of events
// tagged WITHOUT a location (for the starred notes under the maps).
function dashMapData(){
  const up=s=>String(s||'').toUpperCase();
  const out={shots:[],kos:[],shotMiss:{h:0,a:0},koMiss:{h:0,a:0}};
  ALL.forEach(e=>{
    const s=statSide(e); if(!s) return;
    if(/SHOT (OPEN|DEAD)/i.test(e.code||'')){
      const k=up((e.labels||{})['Shot Outcomes']||(e.labels||{})['Outcome']||e.outcome||'');
      const att=up((e.labels||{})['Shot Attempts']||'');
      const scored=(k.includes('POINT')||k.includes('GOAL'))&&!k.includes('DISALLOWED')&&!k.includes('ATTEMPT');
      const shape=(att.includes('GOAL')||k==='GOAL')?'tri':(att.includes('2')||k.includes('2 POINT')||k.includes('TWO'))?'dia':'cir';
      const co=dashCoordOf(e);
      const db=/SHOT DEAD/i.test(e.code||'');
      if(co) out.shots.push({s,x:co.x,y:co.y,scored,shape,db,xp:dashXpOf(e)}); else out.shotMiss[s]++;
    } else if(/KICKOUT|\bKO\b/i.test(e.code||'')){
      const k=up((e.labels||{})['Kickout Outcomes']||(e.labels||{})['PO_Result']||e.outcome||'');
      if(!k) return;
      const won=koWonStr(k,statSide(e));
      const co=dashCoordOf(e);
      if(co) out.kos.push({s,x:co.x,y:co.y,won}); else out.koMiss[s]++;
    }
  });
  return out;
}
// Shared pitch-map SVG (PDF maps, maps image, infographic): both teams in
// their colours. kind 'shot': filled = scored, open = missed; circle 1pt,
// diamond 2pt, triangle goal, square = dead-ball 1pt attempt. kind 'ko':
// dot = retained, X = lost. opts.bg fills the whole viewBox (the pitch art
// itself starts 1.2 units in).
function dashMapSvg(kind,hHex,aHex,pxW,opts){
  opts=opts||{};
  const D=dashMapData();
  // Chart aspect matched to the tracker's own maps (shot 3402x2829, KO 625x685
  // crop): the pitch art is stretched vertically inside a <g>, markers are
  // plotted in the OUTER space so they stay round — and smaller, like the
  // tracker's, so clusters read cleanly.
  const vbH=kind==='shot'?75:89, H2=kind==='shot'?83.2:109.6, STR=H2/vbH;
  const evs=kind==='shot'?D.shots.slice().sort((p,q)=>(q.xp||0)-(p.xp||0)):D.kos;
  const colOf=s=>s==='h'?hHex:aHex;
  const marks=evs.map(m=>{
    const c=colOf(m.s), x=m.x;
    const y=kind==='shot'?m.y*(H2/100):Math.min(H2-1.6, m.y*(137/92)*(H2/100));
    if(kind==='ko'){
      if(m.won) return `<circle cx="${x}" cy="${y}" r="1.35" fill="${c}" stroke="#111" stroke-width=".35"/>`;
      return `<g stroke="#111" stroke-width="1.25"><line x1="${x-1.25}" y1="${y-1.25}" x2="${x+1.25}" y2="${y+1.25}"/><line x1="${x-1.25}" y1="${y+1.25}" x2="${x+1.25}" y2="${y-1.25}"/></g>`
        +`<g stroke="${c}" stroke-width=".75"><line x1="${x-1.25}" y1="${y-1.25}" x2="${x+1.25}" y2="${y+1.25}"/><line x1="${x-1.25}" y1="${y+1.25}" x2="${x+1.25}" y2="${y-1.25}"/></g>`;
    }
    const fill=m.scored?c:'none', stroke=m.scored?'#111':c, sw=m.scored?'.35':'.8';
    // marker size by xP (dashXpScale); same glyphs and colours
    const k=dashXpScale(m.xp), f=v=>(v*k).toFixed(3);
    if(m.shape==='tri') return `<path d="M ${x} ${y-f(1.85)} L ${x+(+f(1.7))} ${y+(+f(1.35))} L ${x-f(1.7)} ${y+(+f(1.35))} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    if(m.shape==='dia') return `<path d="M ${x} ${y-f(1.85)} L ${x+(+f(1.7))} ${y} L ${x} ${y+(+f(1.85))} L ${x-f(1.7)} ${y} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    if(m.db) return `<rect x="${x-f(1.3)}" y="${y-f(1.3)}" width="${f(2.6)}" height="${f(2.6)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    return `<circle cx="${x}" cy="${y}" r="${f(1.4)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }).join('');
  const inner=locPitchSvg(kind)
    .replace(/^<svg[^>]*>/,'')
    .replace('<g id="mapMarks"></g></svg>','');
  const bg=opts.bg?'<rect x="0" y="0" width="100" height="'+vbH+'" fill="'+opts.bg+'"/>':'';
  const pxH=Math.round(pxW*H2/100);
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 '+H2+'" width="'+pxW+'" height="'+pxH+'">'
    +'<g transform="scale(1,'+STR.toFixed(4)+')">'+bg+inner+'</g><g>'+marks+'</g></svg>';
  return {svg,pxH,D};
}
function dashSvgImg(svg){
  return new Promise(res=>{ const im=new Image();
    im.onload=()=>res(im); im.onerror=()=>res(null);
    im.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg); });
}
// Legend glyph matching the map markers (shape: cir / dia / tri / sq).
function dashGlyph(ctx,shape,x,y,r,col,filled,edge){
  ctx.beginPath();
  if(shape==='tri'){ ctx.moveTo(x,y-r*1.3); ctx.lineTo(x+r*1.2,y+r*0.95); ctx.lineTo(x-r*1.2,y+r*0.95); ctx.closePath(); }
  else if(shape==='dia'){ ctx.moveTo(x,y-r*1.3); ctx.lineTo(x+r*1.2,y); ctx.lineTo(x,y+r*1.3); ctx.lineTo(x-r*1.2,y); ctx.closePath(); }
  else if(shape==='sq') ctx.rect(x-r*0.9,y-r*0.9,r*1.8,r*1.8);
  else ctx.arc(x,y,r,0,Math.PI*2);
  if(filled){ ctx.fillStyle=col; ctx.fill(); ctx.strokeStyle=edge||'#111'; ctx.lineWidth=1; ctx.stroke(); }
  else { ctx.strokeStyle=col; ctx.lineWidth=2; ctx.stroke(); }
}
// "SIZE = xP" key: three circles at the map's own marker scale (px per unit).
// Returns the width used.
function dashXpSizeKey(ctx,x,y,unitPx,glyphCol,txtCol,font,up){
  ctx.save(); ctx.font=font; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  let lx=x; const lbl=up?'MARKER SIZE = XP':'MARKER SIZE = xP';
  ctx.fillStyle=txtCol; ctx.fillText(lbl,lx,y); lx+=ctx.measureText(lbl).width+12;
  [0.2,0.6,1.5].forEach(v=>{ const r=1.4*unitPx*dashXpScale(v);
    ctx.beginPath(); ctx.arc(lx+r,y-5,r,0,Math.PI*2); ctx.fillStyle=glyphCol; ctx.fill();
    lx+=2*r+5; ctx.fillStyle=txtCol; ctx.fillText(v.toFixed(1),lx,y); lx+=ctx.measureText(v.toFixed(1)).width+12; });
  ctx.restore(); return lx-x;
}
// Build one combined pitch map (both teams, team colours) as a canvas with
// its legend, on white (PDF / maps image).
function dashBuildMapCanvas(kind,hHex,aHex){
  const {svg,pxH:MH}=dashMapSvg(kind,hHex,aHex,600);
  return new Promise(res=>{
    const im=new Image();
    im.onload=()=>{
      const xpOn=kind==='shot'&&!!dashXpModel();
      const W=640,LEG=xpOn?90:64;
      const cv=document.createElement('canvas'); cv.width=W; cv.height=MH+LEG+20;
      const ctx=cv.getContext('2d');
      ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,cv.width,cv.height);
      ctx.drawImage(im,20,6,600,MH);
      ctx.fillStyle='#555e6a'; ctx.font='600 17px Helvetica,Arial,sans-serif'; ctx.textAlign='left';
      const Hn=(GAME.homeTeam||'HOME').toUpperCase(), An=(GAME.awayTeam||'AWAY').toUpperCase();
      let lx=24, ly=MH+30;
      const dot=(c,filled)=>{ ctx.beginPath(); ctx.arc(lx+6,ly-5,6,0,Math.PI*2);
        if(filled){ ctx.fillStyle=c; ctx.fill(); ctx.strokeStyle='#111'; ctx.lineWidth=1; }
        else { ctx.strokeStyle=c; ctx.lineWidth=2; }
        ctx.stroke(); lx+=17; };
      const word=t=>{ ctx.fillStyle='#555e6a'; ctx.fillText(t,lx,ly); lx+=ctx.measureText(t).width+16; };
      if(kind==='shot'){
        dot(hHex,true); word(Hn); dot(aHex,true); word(An);
        ly+=24; lx=24;
        dot('#8a93a0',true); word('SCORED'); dot('#8a93a0',false); word('MISSED');
        [['cir','1PT'],['dia','2PT'],['tri','GOAL'],['sq','DEADBALL']].forEach(([sh,lb])=>{
          dashGlyph(ctx,sh,lx+6,ly-5,6,'#8a93a0',true); lx+=17; word(lb); });
        if(xpOn) dashXpSizeKey(ctx,24,ly+27,6,'#8a93a0','#555e6a','600 17px Helvetica,Arial,sans-serif');
      } else {
        dot(hHex,true); word(Hn); dot(aHex,true); word(An);
        ly+=24; lx=24;
        dot('#8a93a0',true); word('RETAINED');
        ctx.strokeStyle='#8a93a0'; ctx.lineWidth=2.4;
        ctx.beginPath(); ctx.moveTo(lx,ly-11); ctx.lineTo(lx+11,ly); ctx.moveTo(lx,ly); ctx.lineTo(lx+11,ly-11); ctx.stroke();
        lx+=17; word('LOST');
        ctx.font='600 13px Helvetica,Arial,sans-serif';
        word('TOP = KICKING GOAL · DASHED = HALFWAY');
      }
      res(cv);
    };
    im.onerror=()=>res(null);
    im.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  });
}
// (a) Shot outcome mix — one stacked bar per team.
function dashBuildShotMixCanvas(hHex,aHex){
  const up=s=>String(s||'').toUpperCase();
  const mix=s=>{ const m={scored:0,wide:0,short:0,blocked:0,other:0};
    ALL.forEach(e=>{ if(statSide(e)!==s||!/SHOT (OPEN|DEAD)/i.test(e.code||'')) return;
      const k=up((e.labels||{})['Shot Outcomes']||e.outcome||'');
      if((k.includes('POINT')||k.includes('GOAL'))&&!k.includes('DISALLOWED')&&!k.includes('ATTEMPT')) m.scored++;
      else if(k.includes('WIDE')||k.includes('45')) m.wide++;
      else if(k.includes('SHORT')) m.short++;
      else if(k.includes('BLOCK')||k.includes('SAVE')||k.includes('WOODWORK')||k.includes('POST')) m.blocked++;
      else m.other++; });
    return m; };
  const H=mix('h'), A=mix('a');
  const tot=m=>m.scored+m.wide+m.short+m.blocked+m.other;
  if(!tot(H)&&!tot(A)) return null;
  const W=1000,HT=250;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=HT;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,HT);
  const CATS=[['scored',null,'SCORED'],['wide','#e8734a','WIDE'],['short','#e5b93c','DROPPED SHORT'],['blocked','#9aa3ad','BLOCKED / SAVED'],['other','#c9ced8','OTHER MISS']];
  const rows=[[GAME.homeTeam,H,hHex,60],[GAME.awayTeam,A,aHex,150]];
  ctx.font='700 19px Helvetica,Arial,sans-serif';
  rows.forEach(([nm,m,col,y])=>{
    const t=tot(m); if(!t) return;
    ctx.fillStyle='#3a4250'; ctx.textAlign='left';
    ctx.fillText(String(nm||'').toUpperCase()+'  —  '+m.scored+' scored from '+t+' shots',30,y-12);
    let x=30; const bw=W-60;
    CATS.forEach(([k,c])=>{ const n=m[k]; if(!n) return;
      const w=n/t*bw;
      ctx.fillStyle=c||col; ctx.fillRect(x,y,w,34);
      ctx.strokeStyle='#ffffff'; ctx.lineWidth=2; ctx.strokeRect(x,y,w,34);
      if(w>26){ const lum=parseInt((c||col).slice(1),16); const l=0.2126*((lum>>16)&255)+0.7152*((lum>>8)&255)+0.0722*(lum&255);
        ctx.fillStyle=l>150?'#222':'#fff'; ctx.textAlign='center'; ctx.font='700 17px Helvetica,Arial,sans-serif';
        ctx.fillText(String(n),x+w/2,y+23); ctx.textAlign='left'; ctx.font='700 19px Helvetica,Arial,sans-serif'; }
      x+=w; });
  });
  ctx.font='600 15px Helvetica,Arial,sans-serif'; ctx.fillStyle='#555e6a'; ctx.textAlign='left';
  let lx=30;
  CATS.forEach(([k,c,lbl])=>{ ctx.fillStyle=c||'#4a5568'; ctx.fillRect(lx,HT-32,14,14);
    ctx.fillStyle='#555e6a'; ctx.fillText(lbl+(c?'':' (team colour)'),lx+20,HT-20); lx+=ctx.measureText(lbl+(c?'':' (team colour)')).width+50; });
  return cv;
}
// (d) Possession share doughnut.
function dashBuildPossDoughnut(hHex,aHex){
  const nH=ALL.filter(e=>statSide(e)==='h'&&/TEAM POSSESSION/i.test(e.code||'')).length;
  const nA=ALL.filter(e=>statSide(e)==='a'&&/TEAM POSSESSION/i.test(e.code||'')).length;
  if(!nH&&!nA) return null;
  const W=560,HT=250;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=HT;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,HT);
  const cx=125,cy=125,r=88,ir=52;
  const fH=nH/(nH+nA);
  const seg=(a0,a1,col)=>{ ctx.beginPath(); ctx.arc(cx,cy,r,a0,a1); ctx.arc(cx,cy,ir,a1,a0,true); ctx.closePath();
    ctx.fillStyle=col; ctx.fill(); ctx.strokeStyle='#ffffff'; ctx.lineWidth=3; ctx.stroke(); };
  const start=-Math.PI/2;
  seg(start,start+fH*2*Math.PI,hHex);
  seg(start+fH*2*Math.PI,start+2*Math.PI,aHex);
  ctx.fillStyle='#3a4250'; ctx.textAlign='center';
  ctx.font='800 26px Helvetica,Arial,sans-serif'; ctx.fillText(Math.round(fH*100)+'%',cx,cy-2);
  ctx.font='600 13px Helvetica,Arial,sans-serif'; ctx.fillStyle='#8a93a0'; ctx.fillText('POSSESSIONS',cx,cy+20);
  ctx.textAlign='left';
  const row=(nm,n,pc,col,y)=>{ ctx.fillStyle=col; ctx.fillRect(250,y-14,16,16);
    ctx.fillStyle='#3a4250'; ctx.font='700 18px Helvetica,Arial,sans-serif';
    ctx.fillText(String(nm||'').toUpperCase(),276,y);
    ctx.fillStyle='#555e6a'; ctx.font='600 17px Helvetica,Arial,sans-serif';
    ctx.fillText(n+' possessions ('+pc+'%)',276,y+24); };
  row(GAME.homeTeam,nH,Math.round(fH*100),hHex,88);
  row(GAME.awayTeam,nA,100-Math.round(fH*100),aHex,168);
  return cv;
}
// (c) Kickout retention — by length and by half, mirrored per team.
function dashBuildKoRetentionCanvas(hHex,aHex){
  const up=s=>String(s||'').toUpperCase();
  const koOf=s=>ALL.filter(e=>statSide(e)===s&&/KICKOUT|\bKO\b/i.test(e.code||'')&&up((e.labels||{})['Kickout Outcomes']||e.outcome||''));
  const won=e=>koWonStr(up((e.labels||{})['Kickout Outcomes']||e.outcome||''),statSide(e));
  const lenOf=e=>up((e.labels||{})['Kickout Locations']||'');
  const ROWS=[['ALL KICKOUTS',()=>true],['SHORT',e=>lenOf(e).includes('SHORT')],['MEDIUM',e=>lenOf(e).includes('MEDIUM')],
    ['LONG',e=>lenOf(e).includes('LONG')],['1ST HALF',e=>/1st/i.test(e.half||'')],['2ND HALF',e=>/2nd/i.test(e.half||'')]];
  const kH=koOf('h'), kA=koOf('a');
  if(!kH.length&&!kA.length) return null;
  const W=1000,RH=44,TOP=56,HT=TOP+ROWS.length*RH+16;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=HT;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,HT);
  ctx.font='800 19px Helvetica,Arial,sans-serif'; ctx.fillStyle='#3a4250';
  ctx.textAlign='left'; ctx.fillText(String(GAME.homeTeam||'').toUpperCase(),30,34);
  ctx.textAlign='right'; ctx.fillText(String(GAME.awayTeam||'').toUpperCase(),W-30,34);
  const half=W/2, bw=half-190;
  ROWS.forEach(([lbl,pred],i)=>{
    const y=TOP+i*RH;
    const eH=kH.filter(pred), eA=kA.filter(pred);
    const wH=eH.filter(won).length, wA=eA.filter(won).length;
    ctx.fillStyle='#555e6a'; ctx.font='700 16px Helvetica,Arial,sans-serif'; ctx.textAlign='center';
    ctx.fillText(lbl,half,y+22);
    ctx.fillStyle='#eef0f4'; ctx.fillRect(half-120-bw,y+6,bw,22); ctx.fillRect(half+120,y+6,bw,22);
    if(eH.length){ const f=wH/eH.length; ctx.fillStyle=hHex; ctx.fillRect(half-120-bw*f,y+6,bw*f,22);
      ctx.strokeStyle='#6a7080'; ctx.lineWidth=1; ctx.strokeRect(half-120-bw*f,y+6,bw*f,22); }
    if(eA.length){ const f=wA/eA.length; ctx.fillStyle=aHex; ctx.fillRect(half+120,y+6,bw*f,22);
      ctx.strokeStyle='#6a7080'; ctx.lineWidth=1; ctx.strokeRect(half+120,y+6,bw*f,22); }
    ctx.fillStyle='#3a4250'; ctx.font='700 16px Helvetica,Arial,sans-serif';
    ctx.textAlign='right'; ctx.fillText(eH.length?wH+'/'+eH.length:'—',half-130-bw,y+23);
    ctx.textAlign='left';  ctx.fillText(eA.length?wA+'/'+eA.length:'—',half+130+bw,y+23);
  });
  return cv;
}
// (b) How the scores were built — points by source, mirrored per team.
function dashBuildScoreSourceCanvas(hHex,aHex){
  const up=s=>String(s||'').toUpperCase();
  const pts=t=>t.includes('GOAL')?3:(t.includes('2 POINT')||t.includes('TWO'))?2:1;
  const tally={h:{},a:{}};
  ALL.forEach(e=>{
    const s=statSide(e); if(!s||!/SCORE SOURCE/i.test(e.code||'')) return;
    const src=up((e.labels||{})['Score Source Outcomes']||'')||'UNKNOWN';
    const sc=up((e.labels||{})['Score Source Score Outcomes']||'1 POINT');
    tally[s][src]=(tally[s][src]||0)+pts(sc);
  });
  const SRCS=[['OWN KICKOUT','OWN KICKOUT'],['OPP KICKOUT','OPPOSITION KICKOUT'],['FORCED TURNOVER','TURNOVER FORCED'],
    ['UNFORCED TURNOVER','OPPOSITION ERROR'],['FREE WON','FREE WON'],['THROW-IN','THROW-IN'],['BALL RECOVERED','BALL RECOVERED']]
    .filter(([k])=>tally.h[k]||tally.a[k]);
  if(!SRCS.length) return null;
  const W=1000,RH=42,TOP=56,HT=TOP+SRCS.length*RH+10;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=HT;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,HT);
  ctx.font='800 19px Helvetica,Arial,sans-serif'; ctx.fillStyle='#3a4250';
  ctx.textAlign='left'; ctx.fillText(String(GAME.homeTeam||'').toUpperCase(),30,34);
  ctx.textAlign='right'; ctx.fillText(String(GAME.awayTeam||'').toUpperCase(),W-30,34);
  const maxV=Math.max(1,...SRCS.map(([k])=>Math.max(tally.h[k]||0,tally.a[k]||0)));
  const half=W/2, bw=half-210;
  SRCS.forEach(([k,lbl],i)=>{
    const y=TOP+i*RH, vH=tally.h[k]||0, vA=tally.a[k]||0;
    ctx.fillStyle='#555e6a'; ctx.font='700 15px Helvetica,Arial,sans-serif'; ctx.textAlign='center';
    ctx.fillText(lbl,half,y+21);
    ctx.fillStyle='#eef0f4'; ctx.fillRect(half-140-bw,y+5,bw,20); ctx.fillRect(half+140,y+5,bw,20);
    if(vH){ const w=vH/maxV*bw; ctx.fillStyle=hHex; ctx.fillRect(half-140-w,y+5,w,20);
      ctx.strokeStyle='#6a7080'; ctx.lineWidth=1; ctx.strokeRect(half-140-w,y+5,w,20); }
    if(vA){ const w=vA/maxV*bw; ctx.fillStyle=aHex; ctx.fillRect(half+140,y+5,w,20);
      ctx.strokeStyle='#6a7080'; ctx.lineWidth=1; ctx.strokeRect(half+140,y+5,w,20); }
    ctx.fillStyle='#3a4250'; ctx.font='700 16px Helvetica,Arial,sans-serif';
    ctx.textAlign='right'; ctx.fillText(String(vH),half-148-bw,y+21);
    ctx.textAlign='left';  ctx.fillText(String(vA),half+148+bw,y+21);
  });
  return cv;
}
async function dashExportPDF(){
  const NS=window.jspdf||{};
  if(!NS.jsPDF){ alert('PDF library not loaded — check your connection and reload.'); return; }
  const S=dashComputeStats();
  const doc=new NS.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const PW=210,PH=297,ML=14,MR=14,MT=16,MB=16,CW=PW-ML-MR;
  let y=MT;
  const Hn=GAME.homeTeam||'Home', An=GAME.awayTeam||'Away';
  const packH=cohPackTeam(Hn), packA=cohPackTeam(An);
  const hexToRgb=h=>{ h=String(h||'#888888').replace('#','');
    return [parseInt(h.slice(0,2),16)||0,parseInt(h.slice(2,4),16)||0,parseInt(h.slice(4,6),16)||0]; };
  const rlum=rgb=>0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];
  const safe=rgb=>rlum(rgb)>=200?[122,128,140]:rgb;
  const hexH=GAME.homeColor||(packH&&packH.primary)||cohTeamColourDefault(Hn)||'#2563eb';
  const hexA=GAME.awayColor||(packA&&packA.primary)||cohTeamColourDefault(An)||'#22c55e';
  const colH=safe(hexToRgb(hexH)), colA=safe(hexToRgb(hexA));
  const loadCrest=src=>new Promise(res=>{ if(!src) return res(null);
    const im=new Image(); im.crossOrigin='anonymous'; im.onload=()=>res(im); im.onerror=()=>res(null); im.src=src; });
  await cohCrestsReady();
  const [crImH,crImA]=await Promise.all([loadCrest(cohCrestSrc(Hn,packH)), loadCrest(cohCrestSrc(An,packA))]);
  const C_TEXT=[30,30,40], C_T2=[100,100,115], C_ACC=[2,132,199];
  const up=s=>String(s||'').toUpperCase();
  const checkPage=n=>{ if(y+n>PH-MB){ doc.addPage(); y=MT; } };
  const secHead=t=>{ checkPage(14);
    doc.setFillColor(...C_ACC); doc.roundedRect(ML,y,CW,8,2,2,'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(255,255,255);
    doc.text(t,ML+3,y+5.6); y+=12; };

  // ── header + score boxes ──
  doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(...C_ACC);
  doc.text('COHESION ANALYSIS',ML,y);
  doc.setFontSize(8.5); doc.setTextColor(...C_T2);
  doc.text('MATCH REPORT — FULL GAME',ML+62,y);
  y+=6;
  doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(...C_TEXT);
  const meta=[GAME.competition||'',GAME.round||'',GAME.date||''].filter(Boolean).join('  ·  ');
  doc.text(Hn+' v '+An+(meta?'   ·   '+meta:''),ML,y);
  y+=6;
  const XS=dashXpSummary(null);
  const xpOn=!!(XS&&(XS.h.n||XS.a.n));
  const BOXH=xpOn?30:26;
  const box=(x,w,team,col,crest,sc,shots,scored,ps,xt)=>{
    doc.setFillColor(246,248,252); doc.roundedRect(x,y,w,BOXH,2,2,'F');
    let tx=x+4;
    if(crest){ try{ doc.addImage(crest,'PNG',x+3,y+5.5,15,15); tx=x+21; }catch(_e){} }
    doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(...col);
    doc.text(up(team),tx,y+8);
    doc.setFontSize(15); doc.setTextColor(...C_TEXT);
    doc.text(sc,tx,y+17);
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...C_T2);
    if(xpOn){
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C_TEXT);
      doc.text(xt,tx,y+22.5);
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...C_T2);
      doc.text(scored+'/'+shots+' shots  ·  PSR '+ps,tx,y+27);
    } else doc.text(scored+'/'+shots+' shots  ·  PSR '+ps,tx,y+23);
  };
  const xpLine=t=>t.n?t.score+' from '+dashXpF(t.xp)+' xP  ('+dashXpSigned(t.diff,true)+')':'no located shots - no xP';
  box(ML,CW/2-2,Hn,colH,crImH,S.scH.str,S.shotsH,S.scoredH,S.psrH,xpOn?xpLine(XS.h):'');
  box(ML+CW/2+2,CW/2-2,An,colA,crImA,S.scA.str,S.shotsA,S.scoredA,S.psrA,xpOn?xpLine(XS.a):'');
  y+=BOXH+6;

  // ── per-player scoring tables ──
  const shotEv=ALL.filter(e=>/SHOT (OPEN|DEAD)/i.test(e.code||''));
  const outOf=e=>up((e.labels||{})['Shot Outcomes']||(e.labels||{})['ShotOutcome']||(e.labels||{})['Outcome']||e.outcome||'');
  const anyPlayers=shotEv.some(e=>e.player);
  if(anyPlayers){
    secHead('Shooting by Player');
    [['h',Hn,colH],['a',An,colA]].forEach(([side,team,col])=>{
      const evs=shotEv.filter(e=>statSide(e)===side&&e.player);
      if(!evs.length) return;
      const m={};
      evs.forEach(e=>{ const p=m[e.player]||(m[e.player]={p1:0,p2:0,g:0,shots:0,scored:0,xp:0,xn:0});
        p.shots++;
        const xv=dashXpOf(e); if(xv!=null){ p.xp+=xv; p.xn++; }
        const k=outOf(e);
        if(k.includes('DISALLOWED')||k.includes('ATTEMPT')){}
        else if(k.includes('GOAL')){p.g++;p.scored++;}
        else if(k.includes('2 POINT')||k.includes('TWO')){p.p2++;p.scored++;}
        else if(k.includes('POINT')){p.p1++;p.scored++;}
      });
      const rows=Object.entries(m)
        .sort((x2,y2)=>(y2[1].g*3+y2[1].p2*2+y2[1].p1)-(x2[1].g*3+x2[1].p2*2+x2[1].p1))
        .map(([n,p])=>{ const r=[n,p.p1||'-',p.p2||'-',p.g||'-',p.shots,p.scored,Math.round(p.scored/p.shots*100)+'%'];
          if(xpOn) r.push(p.xn?dashXpF(p.xp)+(p.xn<p.shots?'*':''):'-'); return r; });
      checkPage(22);
      doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...col);
      doc.text(team+' Players',ML,y); y+=2;
      doc.autoTable({ startY:y, margin:{left:ML,right:MR},
        head:[['Player','1pt','2pt','Goal','Shots','Scored','%'].concat(xpOn?['xP']:[])], body:rows,
        styles:{fontSize:7.5,cellPadding:1.3},
        headStyles:{fillColor:hexToRgb(hexH&&side==='h'?hexH:hexA),
          textColor:rlum(hexToRgb(side==='h'?hexH:hexA))>=200?[30,30,40]:[255,255,255],
          lineColor:[180,180,190], lineWidth:rlum(hexToRgb(side==='h'?hexH:hexA))>=200?0.2:0, fontStyle:'bold'},
        theme:'grid' });
      y=doc.lastAutoTable.finalY+6;
    });
  }

  // ── shot & kickout maps — combined pitches, both teams in their colours ──
  const MD2=dashMapData();
  if(MD2.shots.length||MD2.kos.length){
    const [shotCv,koCv]=await Promise.all([
      MD2.shots.length?dashBuildMapCanvas('shot',hexH,hexA):null,
      MD2.kos.length?dashBuildMapCanvas('ko',hexH,hexA):null]);
    if(shotCv||koCv){
      const HW=(CW-6)/2;
      const hOf=cv=>cv?HW*cv.height/cv.width:0;
      const blockH=Math.max(hOf(shotCv),hOf(koCv));
      checkPage(blockH+30);
      secHead('Shot & Kickout Maps');
      doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...C_TEXT);
      if(shotCv) doc.text('SHOT MAP — attacking up the page',ML,y+1);
      if(koCv)   doc.text('KICKOUT LANDING MAP',ML+HW+6,y+1);
      y+=3;
      if(shotCv) doc.addImage(shotCv.toDataURL('image/png'),'PNG',ML,y,HW,hOf(shotCv));
      if(koCv)   doc.addImage(koCv.toDataURL('image/png'),'PNG',ML+HW+6,y,HW,hOf(koCv));
      let ny=y+blockH+4;
      doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(...C_T2);
      const noteTxt=(m,what)=>['h','a'].filter(s2=>m[s2]).map(s2=>(s2==='h'?Hn:An)+' '+m[s2]).join(' · ');
      if(MD2.shotMiss.h||MD2.shotMiss.a) doc.text('* '+noteTxt(MD2.shotMiss)+' shot'+((MD2.shotMiss.h+MD2.shotMiss.a)>1?'s':'')+' with no location tagged',ML,ny);
      if(MD2.koMiss.h||MD2.koMiss.a) doc.text('* '+noteTxt(MD2.koMiss)+' kickout'+((MD2.koMiss.h+MD2.koMiss.a)>1?'s':'')+' with no location tagged',ML+HW+6,ny);
      y=ny+6;
    }
  }

  // ── expected points (xP) — full game ──
  if(xpOn){
    const xpCv=dashBuildXpWormCanvas(hexH,hexA);
    const wh=xpCv?CW*xpCv.height/xpCv.width:0;
    checkPage(70);
    secHead('Expected Points (xP)');
    const t=XS, r2=(lab,fh,fa)=>[lab,fh(t.h),fa?fa(t.a):fh(t.a)];
    const cellC=k=>tt=>{ const c=tt.cat[k]; return c.n?c.pts+' / '+dashXpF(c.xp)+'  ('+c.n+')':'-'; };
    const body=[
      r2('Score (all shots)',tt=>tt.score+' ('+tt.ptsAll+')'),
      r2('xP (located shots with an attempt type)',tt=>tt.n?dashXpF(tt.xp):'n/a'),
      r2('Points from those shots',tt=>tt.n?String(tt.pts):'n/a'),
      r2('Points - xP',tt=>tt.n?dashXpSigned(tt.diff,true):'n/a'),
      r2('xP per shot',tt=>tt.perShot!=null?tt.perShot.toFixed(2):'n/a')];
    DASH_XP_CATS.forEach(([k,lab])=>{ if(t.h.cat[k].n||t.a.cat[k].n) body.push(r2(lab+'  -  pts / xP (shots)',cellC(k))); });
    doc.autoTable({ startY:y, margin:{left:ML,right:MR},
      head:[['',Hn,An]], body,
      styles:{fontSize:7.5,cellPadding:1.4},
      columnStyles:{1:{halign:'center'},2:{halign:'center'}},
      headStyles:{fillColor:C_ACC,textColor:[255,255,255],fontStyle:'bold'},
      theme:'grid' });
    y=doc.lastAutoTable.finalY+4;
    if(xpCv){
      checkPage(wh+12);
      doc.setFont('helvetica','normal'); doc.setFontSize(6.8); doc.setTextColor(...C_T2);
      doc.text('Running score (solid) v running xP (dashed), by minute',ML,y+1); y+=3;
      doc.addImage(xpCv.toDataURL('image/png'),'PNG',ML,y,CW,wh);
      y+=wh+3;
    }
    doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(...C_T2);
    const nt='xP model v'+XS.version+(XS.conv==='sportscode_rot'?'  -  rotated Sportscode coordinates detected':'')
      +'  -  '+(XS.miss?XS.miss+' shot'+(XS.miss>1?'s':'')+' without location/attempt -> not in xP'+(anyPlayers?' (* player xP covers only their modelled shots)':''):'every shot located');
    doc.text(nt,ML,y+1.5);
    y+=8;
  }

  // ── shot outcome mix + possession share ──
  {
    const mixCv=dashBuildShotMixCanvas(hexH,hexA);
    const dnCv=dashBuildPossDoughnut(hexH,hexA);
    if(mixCv||dnCv){
      const wMix=CW*0.62, wDn=CW*0.34;
      const hMix=mixCv?wMix*mixCv.height/mixCv.width:0;
      const hDn=dnCv?wDn*dnCv.height/dnCv.width:0;
      checkPage(Math.max(hMix,hDn)+18);
      secHead('Shot Outcomes & Possession');
      if(mixCv) doc.addImage(mixCv.toDataURL('image/png'),'PNG',ML,y,wMix,hMix);
      if(dnCv)  doc.addImage(dnCv.toDataURL('image/png'),'PNG',ML+wMix+6,y,wDn,hDn);
      y+=Math.max(hMix,hDn)+8;
    }
  }

  // ── kickout analysis ──
  const KOre=/KICKOUT|\bKO\b/i;
  const koOut2=e=>up((e.labels||{})['Kickout Outcomes']||(e.labels||{})['KickoutOutcome']||(e.labels||{})['PO_Result']||e.outcome||'');
  const koLoc=e=>up((e.labels||{})['Kickout Locations']||'');
  const anyKO=ALL.some(e=>KOre.test(e.code||'')&&koOut2(e));
  if(anyKO){
    secHead('Kickout Analysis');
    [['h',Hn,colH],['a',An,colA]].forEach(([side,team,col])=>{
      const own=ALL.filter(e=>statSide(e)===side&&KOre.test(e.code||'')&&koOut2(e));
      if(!own.length) return;
      const won=own.filter(e=>koWonStr(koOut2(e),statSide(e))).length;
      checkPage(12);
      doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...col);
      doc.text(team,ML,y);
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C_TEXT);
      doc.text('Own KO: '+won+'/'+own.length+' won ('+Math.round(won/own.length*100)+'%)',ML+55,y);
      const locs=own.filter(e=>koLoc(e));
      if(locs.length){
        const s=locs.filter(e=>koLoc(e).includes('SHORT')).length;
        const md2=locs.filter(e=>koLoc(e).includes('MEDIUM')).length;
        const l=locs.filter(e=>koLoc(e).includes('LONG')).length;
        doc.setTextColor(...C_T2);
        doc.text('Short '+Math.round(s/locs.length*100)+'%  ·  Medium '+Math.round(md2/locs.length*100)+'%  ·  Long '+Math.round(l/locs.length*100)+'%',ML+110,y);
      }
      y+=6;
    });
    y+=2;
    // retention chart — by length and by half
    const retCv=dashBuildKoRetentionCanvas(hexH,hexA);
    if(retCv){
      const rh=CW*retCv.height/retCv.width;
      checkPage(rh+6);
      doc.addImage(retCv.toDataURL('image/png'),'PNG',ML,y,CW,rh);
      y+=rh+6;
    }
  }

  // ── match stats table (sections from the shared compute) ──
  if(S.sections.length){
    secHead('Match Stats');
    const body=[];
    S.sections.forEach(([title,rows])=>{
      body.push([{content:title,colSpan:3,styles:{fillColor:[235,240,247],textColor:[60,70,90],fontStyle:'bold',halign:'left'}}]);
      rows.forEach(r=>body.push([r.label,r.dH,r.dA]));
    });
    doc.autoTable({ startY:y, margin:{left:ML,right:MR},
      head:[['Stat',Hn,An]], body,
      styles:{fontSize:7.5,cellPadding:1.4},
      columnStyles:{1:{halign:'center'},2:{halign:'center'}},
      headStyles:{fillColor:C_ACC,textColor:[255,255,255],fontStyle:'bold'},
      theme:'grid' });
    y=doc.lastAutoTable.finalY+8;
  }

  // ── how the scores were built — points by source ──
  {
    const ssCv=dashBuildScoreSourceCanvas(hexH,hexA);
    if(ssCv){
      const sh=CW*ssCv.height/ssCv.width;
      checkPage(sh+16);
      secHead('How the Scores Were Built');
      doc.setFont('helvetica','normal'); doc.setFontSize(6.8); doc.setTextColor(...C_T2);
      doc.text('Points by the source of the possession they came from',ML,y+1); y+=3;
      doc.addImage(ssCv.toDataURL('image/png'),'PNG',ML,y,CW,sh);
      y+=sh+6;
    }
  }

  // ── match momentum — directly under the possession/stats table ──
  const mom=dashBuildMomentumCanvas();
  if(mom){
    const mh=CW*mom.height/mom.width;
    checkPage(mh+22);
    secHead('Match Momentum');
    doc.setFont('helvetica','normal'); doc.setFontSize(6.8); doc.setTextColor(...C_T2);
    doc.text('Momentum value per 2-min window — TO won: 1pt · Wide/Missed Shot: 2pts · 1-pointer: 3pts · 2-pointer: 4pts · Goal: 5pts   (up = '+Hn+', down = '+An+')',ML,y+2);
    y+=5;
    doc.addImage(mom.toDataURL('image/png'),'PNG',ML,y,CW,mh);
    y+=mh+4;
    // legend markers drawn as vector shapes (helvetica has no glyphs for these)
    doc.setFontSize(6.5); doc.setTextColor(...C_T2); doc.setLineWidth(0.25);
    const lx=ML+CW/2-30;
    doc.setDrawColor(0,61,45); doc.setFillColor(0,106,78);
    doc.circle(lx,y-1,1.6,'FD');
    doc.setDrawColor(255,255,255); doc.circle(lx,y-1,0.6,'S');
    doc.setDrawColor(85,85,85);
    doc.text('Goal',lx+3.2,y);
    const fx=lx+14;
    doc.setFillColor(249,115,22);
    doc.line(fx,y+1.2,fx,y-3.4);
    doc.triangle(fx,y-3.4,fx+3.4,y-2.2,fx,y-1,'FD');
    doc.text('2-pointer',fx+4.6,y);
    const gx=fx+25;
    doc.setFillColor(244,244,246); doc.setDrawColor(119,119,119);
    doc.line(gx,y+1.2,gx,y-3.4);
    doc.rect(gx,y-3.4,3,2.2,'FD');
    doc.text('1-pointer',gx+4.4,y);
    doc.setDrawColor(0,0,0);
    y+=6;
  }

  // ── scoring timeline ──
  const worm=dashBuildWormCanvas(S,hexH,hexA);
  if(worm){
    const wh=CW*worm.height/worm.width;
    checkPage(wh+16);
    secHead('Scoring Timeline');
    doc.addImage(worm.toDataURL('image/png'),'PNG',ML,y,CW,wh);
    y+=wh+8;
  }

  // ── player details (scores · shots · cards) ──
  const cardEv=ALL.filter(e=>/\bCARD\b/i.test(e.code||''));
  const involved=side=>{
    const m={};
    ALL.forEach(e=>{ if(statSide(e)!==side||!e.player) return;
      const p=m[e.player]||(m[e.player]={g:0,pts:0,shots:0,cards:[]});
      if(/SHOT (OPEN|DEAD)/i.test(e.code||'')){
        p.shots++;
        const k=outOf(e);
        if(k.includes('DISALLOWED')||k.includes('ATTEMPT')){}
        else if(k.includes('GOAL')) p.g++;
        else if(k.includes('2 POINT')||k.includes('TWO')) p.pts+=2;
        else if(k.includes('POINT')) p.pts++;
      }
      if(/\bCARD\b/i.test(e.code||'')){
        const cc=up((e.labels||{})['Card Outcomes']||'');
        p.cards.push(cc.includes('YELLOW')?'Y':cc.includes('BLACK')?'B':cc.includes('RED')?'R':'?');
      }
    });
    return m;
  };
  const anyDetail=['h','a'].some(s=>Object.keys(involved(s)).length);
  if(anyDetail){
    secHead('Player Details');
    [['h',Hn],['a',An]].forEach(([side,team])=>{
      const m=involved(side);
      const names=Object.keys(m); if(!names.length) return;
      const rows=names.sort().map(n=>{ const p=m[n];
        return [n,(p.g||p.pts)?p.g+'-'+p.pts:'—',p.shots||'—',p.cards.join(',')||'—']; });
      checkPage(20);
      doc.setFont('helvetica','bold'); doc.setFontSize(8.5);
      doc.setTextColor(...(side==='h'?colH:colA));
      doc.text(up(team),ML,y); y+=2;
      doc.autoTable({ startY:y, margin:{left:ML,right:MR},
        head:[['Player','Score','Shots','Cards']], body:rows,
        styles:{fontSize:7.5,cellPadding:1.3},
        headStyles:{fillColor:hexToRgb(side==='h'?hexH:hexA),
          textColor:rlum(hexToRgb(side==='h'?hexH:hexA))>=200?[30,30,40]:[255,255,255],
          lineColor:[180,180,190], lineWidth:rlum(hexToRgb(side==='h'?hexH:hexA))>=200?0.2:0, fontStyle:'bold'},
        theme:'grid' });
      y=doc.lastAutoTable.finalY+6;
    });
  }

  // ── substitutions (numbers as recorded in the XML) ──
  const subEv=ALL.filter(e=>/\bSUB\b/i.test(e.code||'')&&(e.labels||{})['Sub Detail']);
  if(subEv.length){
    secHead('Substitutions');
    const rows=subEv.map(e=>[e.gameTime||'',statSide(e)==='h'?Hn:An,(e.labels||{})['Sub Detail']||'']);
    doc.autoTable({ startY:y, margin:{left:ML,right:MR},
      head:[['Time','Team','Substitution']], body:rows,
      styles:{fontSize:7.5,cellPadding:1.3},
      headStyles:{fillColor:C_ACC,textColor:[255,255,255],fontStyle:'bold'},
      theme:'grid' });
    y=doc.lastAutoTable.finalY+6;
  }

  const fname=(String(Hn)+'_v_'+String(An)+'_match_report.pdf').toLowerCase().replace(/[^\w.]+/g,'_');
  if(window.__pdfTest){ window.__pdfTest(doc,fname); return; }
  doc.save(fname);
}
function dashDlBlob(b,fname){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(b); a.download=fname;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}

// ── Shared helpers for the maps image + infographic ──────────────────
// Colour precedence as in the PDF: game colour → imported pack → bundled default.
function dashTeamHexes(){
  const Hn=GAME.homeTeam||'Home', An=GAME.awayTeam||'Away';
  const packH=cohPackTeam(Hn), packA=cohPackTeam(An);
  return {Hn,An,packH,packA,
    hexH:GAME.homeColor||(packH&&packH.primary)||cohTeamColourDefault(Hn)||'#2563eb',
    hexA:GAME.awayColor||(packA&&packA.primary)||cohTeamColourDefault(An)||'#22c55e',
    secA:(packA&&packA.secondary)||dashTeamSecondary(An), secH:(packH&&packH.secondary)||dashTeamSecondary(Hn)};
}
function dashTeamSecondary(name){
  const sl=cohCrestSlug(name);
  const C=window.COHESION_TEAM_COLOURS||{}; return (C[sl]&&C[sl].secondary)||null;
}
function dashLoadImg(src){
  return new Promise(res=>{ if(!src) return res(null);
    const im=new Image(); im.crossOrigin='anonymous'; im.onload=()=>res(im); im.onerror=()=>res(null); im.src=src; });
}
function dashHexLum(x){ try{ const n=parseInt(String(x).replace('#',''),16);
  return 0.2126*((n>>16)&255)+0.7152*((n>>8)&255)+0.0722*(n&255); }catch(_e){ return 0; } }
function dashHexMix(x,y,f){ try{ const a=parseInt(String(x).replace('#',''),16), b=parseInt(String(y).replace('#',''),16);
  const c=(sh)=>Math.round(((a>>sh)&255)*(1-f)+((b>>sh)&255)*f);
  return '#'+((1<<24)+(c(16)<<16)+(c(8)<<8)+c(0)).toString(16).slice(1); }catch(_e){ return x; } }
function dashFileStem(){ const T=dashTeamHexes();
  return (String(T.Hn)+'_v_'+String(T.An)).toLowerCase().replace(/[^\w.]+/g,'_'); }
function dashBusy(btn,on,label){
  if(!btn) return;
  if(on){ btn.dataset.lbl=btn.textContent; btn.textContent='⏳ Building…'; btn.style.pointerEvents='none'; }
  else { btn.textContent=btn.dataset.lbl||label||btn.textContent; btn.style.pointerEvents=''; }
}

// ── MAPS IMAGE — shot map + kickout landing map side by side on a light
// card, the PDF's green pitches with legends and "no location" notes.
async function dashBuildMapsImage(){
  const T=dashTeamHexes(), S=dashComputeStats(), MD=dashMapData();
  await cohCrestsReady();
  const [shotCv,koCv,crH,crA]=await Promise.all([
    MD.shots.length?dashBuildMapCanvas('shot',T.hexH,T.hexA):null,
    MD.kos.length?dashBuildMapCanvas('ko',T.hexH,T.hexA):null,
    dashLoadImg(cohCrestSrc(T.Hn,T.packH)), dashLoadImg(cohCrestSrc(T.An,T.packA))]);
  if(!shotCv&&!koCv) return null;
  try{ await Promise.all(['700 20px "Barlow Condensed"','800 20px "Barlow Condensed"','600 20px "Barlow"'].map(f=>document.fonts.load(f))); }catch(_e){}
  const noteTxt=(m,what)=>{ const n=m.h+m.a; if(!n) return '';
    return '* '+['h','a'].filter(s=>m[s]).map(s=>(s==='h'?T.Hn:T.An)+' '+m[s]).join(' · ')+' '+what+(n>1?'s':'')+' with no location tagged'; };
  const cards=[
    shotCv&&{cv:shotCv,title:'SHOT MAP',sub:'ATTACKING UP THE PAGE · '+MD.shots.length+' LOCATED'+(dashXpModel()?' · SIZE = XP':''),note:noteTxt(MD.shotMiss,'shot')},
    koCv&&{cv:koCv,title:'KICKOUT LANDING MAP',sub:'TOP = KICKING GOAL · '+MD.kos.length+' LOCATED',note:noteTxt(MD.koMiss,'kickout')}
  ].filter(Boolean);
  const PAD=40, GAP=24, CW=680, HEAD=156, CT=58, NOTE=40, FOOT=44;
  const maxH=Math.max(...cards.map(c=>c.cv.height));
  const W=Math.max(PAD*2+cards.length*CW+(cards.length-1)*GAP, 1000);
  const HT=HEAD+CT+maxH+NOTE+FOOT+PAD/2;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=HT;
  const ctx=cv.getContext('2d');
  const CF='"Barlow Condensed","Barlow",Helvetica,Arial,sans-serif', BF='"Barlow",Helvetica,Arial,sans-serif';
  const INK='#1e1e28', MUTE='#5b6070', ACC='#0284c7';
  const onLight=c=>dashHexLum(c)>=200?'#7a808c':c;
  ctx.fillStyle='#eef0f4'; ctx.fillRect(0,0,W,HT);
  ctx.fillStyle=T.hexH; ctx.fillRect(0,0,W/2,8); ctx.fillStyle=T.hexA; ctx.fillRect(W/2,0,W/2,8);
  ctx.textBaseline='alphabetic';
  // title strip
  ctx.textAlign='left'; ctx.font='800 22px '+CF; ctx.fillStyle=ACC;
  ctx.fillText('COHESION ANALYSIS',PAD,46);
  const tw0=ctx.measureText('COHESION ANALYSIS').width;
  ctx.font='700 16px '+CF; ctx.fillStyle=MUTE;
  ctx.fillText('·  SHOT & KICKOUT MAPS  ·  FULL GAME',PAD+tw0+12,46);
  const up=s=>String(s||'').toUpperCase();
  let nfs=40;
  const parts=()=>{ ctx.font='800 '+nfs+'px '+CF; const sf='800 '+nfs+'px '+CF;
    return [ctx.measureText(up(T.Hn)).width, ctx.measureText(S.scH.str).width, ctx.measureText(' v ').width,
            ctx.measureText(S.scA.str).width, ctx.measureText(up(T.An)).width, sf]; };
  let p=parts(), CR=nfs*0.62;
  const rowW=()=>p[0]+p[1]+p[2]+p[3]+p[4]+4*18+(crH?CR*2+12:0)+(crA?CR*2+12:0);
  while(nfs>22 && rowW()>W-PAD*2){ nfs-=2; CR=nfs*0.62; p=parts(); }
  let x=PAD; const by=102;
  const crest=(im,col)=>{ if(!im) return; const cx=x+CR, cy=by-nfs*0.34;
    ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,CR,0,Math.PI*2); ctx.closePath(); ctx.fillStyle='#fff'; ctx.fill(); ctx.clip();
    ctx.drawImage(im,cx-CR,cy-CR,CR*2,CR*2); ctx.restore();
    ctx.beginPath(); ctx.arc(cx,cy,CR,0,Math.PI*2); ctx.strokeStyle='#cfd4dc'; ctx.lineWidth=1.5; ctx.stroke();
    x+=CR*2+12; };
  const put=(s,col)=>{ ctx.font=p[5]; ctx.fillStyle=col; ctx.fillText(s,x,by); x+=ctx.measureText(s).width+18; };
  crest(crH); put(up(T.Hn),onLight(T.hexH)); put(S.scH.str,INK);
  ctx.font='700 '+Math.round(nfs*0.7)+'px '+CF; ctx.fillStyle='#9aa0ad'; ctx.fillText('v',x,by); x+=ctx.measureText('v').width+18;
  put(S.scA.str,INK); put(up(T.An),onLight(T.hexA)); crest(crA);
  const meta=[GAME.competition||'',GAME.round||'',GAME.date||''].filter(Boolean).join('  ·  ');
  ctx.font='600 16px '+BF; ctx.fillStyle=MUTE;
  const XS=dashXpSummary(null);
  const xpTxt=(XS&&(XS.h.n||XS.a.n))?'  ·  xP '+dashXpF(XS.h.xp)+' v '+dashXpF(XS.a.xp):'';
  ctx.fillText(((meta?meta+'  ·  ':'')+S.scoredH+'/'+S.shotsH+' shots (PSR '+S.psrH+')  v  '+S.scoredA+'/'+S.shotsA+' (PSR '+S.psrA+')'+xpTxt),PAD,136);
  // map cards
  const x0=(W-(cards.length*CW+(cards.length-1)*GAP))/2;
  cards.forEach((c,i)=>{
    const cx=x0+i*(CW+GAP), cy=HEAD;
    const ch=CT+maxH+NOTE;
    ctx.fillStyle='#ffffff'; ctx.strokeStyle='#d8dce4'; ctx.lineWidth=1;
    ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(cx,cy,CW,ch,10); else ctx.rect(cx,cy,CW,ch); ctx.fill(); ctx.stroke();
    ctx.fillStyle=ACC; ctx.fillRect(cx+20,cy+20,4,20);
    ctx.font='800 22px '+CF; ctx.fillStyle=INK; ctx.textAlign='left'; ctx.fillText(c.title,cx+32,cy+38);
    const tw=ctx.measureText(c.title).width;
    ctx.font='700 14px '+CF; ctx.fillStyle=MUTE; ctx.fillText('·  '+c.sub,cx+32+tw+10,cy+37);
    ctx.drawImage(c.cv,cx+(CW-c.cv.width)/2,cy+CT-4);
    if(c.note){ ctx.font='500 14px '+BF; ctx.fillStyle=MUTE; ctx.fillText(c.note,cx+24,cy+CT+c.cv.height+18); }
  });
  ctx.font='700 13px '+CF; ctx.fillStyle='#8a90a0'; ctx.textAlign='left';
  ctx.fillText('COHESION ANALYSIS  ·  GENERATED FROM TAGGED MATCH EVENTS  ·  LOCATIONS AS TAGGED',PAD,HT-22);
  return cv;
}
async function dashDownloadMapsImage(btn){
  dashBusy(btn,true);
  try{
    const cv=await dashBuildMapsImage();
    if(!cv){ alert('No shot or kickout locations are tagged in this game.'); return; }
    await new Promise(r=>cv.toBlob(b=>{ if(b) dashDlBlob(b,dashFileStem()+'_maps.png'); r(); },'image/png'));
  } finally { dashBusy(btn,false); }
}

// ── MATCH INFOGRAPHIC — metric definitions ported from the COHESION
// match-infographic skill (gaa_match.py / render.py), computed from the
// game's real events. FULL GAME: period chips are ignored.
function dashInfographicData(S){
  const up=s=>String(s||'').toUpperCase().trim();
  const lab=(e,k)=>{ const L=e.labels||{}; if(L[k]!=null&&L[k]!=='') return L[k];
    const kk=Object.keys(L).find(x=>x.toLowerCase()===k.toLowerCase()); return kk?L[kk]:''; };
  const minOf=e=>{ const m=/^([12])H\s+(\d+):(\d+)/.exec(e.gameTime||''); if(!m) return null;
    const mn=+m[2]+(+m[3])/60; return +m[1]===1?mn:S.h1len+mn; };
  const ev=ALL.map(e=>({e,s:statSide(e),m:minOf(e),c:up(e.code)})).filter(x=>x.s);
  const chron=ev.filter(x=>x.m!=null).sort((a,b)=>a.m-b.m);
  const SIDES=['h','a'];
  const D={h:{},a:{}};
  // shots — PSR = scored / shots; scored = a point, 2-pointer or goal
  const shotOut=e=>up(lab(e,'Shot Outcomes')||lab(e,'ShotOutcome')||lab(e,'Outcome')||e.outcome);
  const isScored=k=>(k.includes('POINT')||k.includes('GOAL'))&&!k.includes('DISALLOWED')&&!k.includes('ATTEMPT');
  const shots=ev.filter(x=>/SHOT (OPEN|DEAD)/.test(x.c)).map(x=>{
    const out=shotOut(x.e), att=up(lab(x.e,'Shot Attempts')), sc=isScored(out);
    const v=!sc?0:out.includes('GOAL')?3:(out.includes('2 POINT')||out.includes('TWO'))?2:1;
    return {...x,out,att,scored:sc,v,two:/2 POINT|TWO POINT/.test(att),player:String(x.e.player||'').trim()}; });
  const attTagged=shots.some(x=>x.att);
  // kickouts — retained on the WON verdict (KT/RT vocabularies as elsewhere)
  const koOut=e=>up(lab(e,'Kickout Outcomes')||lab(e,'KickoutOutcome')||lab(e,'PO_Result')||e.outcome);
  const koWon=(k,s)=>koWonStr(k,s);
  const kos=ev.filter(x=>/KICKOUT|\bKO\b/.test(x.c)).map(x=>({...x,out:koOut(x.e),len:up(lab(x.e,'Kickout Locations'))})).filter(x=>x.out);
  const lenTagged=kos.some(x=>x.len);
  // turnovers
  const tos=ev.filter(x=>/\bTOS?\b|TURNOVER/.test(x.c)).map(x=>({...x,out:up(lab(x.e,'Turnover Outcomes'))}));
  const LOSS=new Set(['SHORT','BLOCKED','SAVE','WOODWORK']);
  // First possession-defining event after a shot decides whether it was conceded.
  const possAfter=sh=>{
    for(const r of chron){
      if(r.m<=sh.m+1e-6) continue;
      if(r.s===sh.s && (r.c.includes('1 POINT')||r.c.includes('2 POINT')||(/\bGOAL$/.test(r.c))
        ||/TEAM POSSESSION$/.test(r.c)||/SHOT (OPEN|DEAD)/.test(r.c))) return 'retained';
      if(r.s!==sh.s && /TEAM POSSESSION$/.test(r.c)) return 'conceded';
    }
    return 'unknown'; };
  const CARD_T=[['YELLOW','Y','#f7cd28'],['BLACK','B','#2e2e3a'],['RED','R','#d62d28']];
  const cards=ev.filter(x=>/\bCARD$/.test(x.c)).map(x=>{ let o=up(lab(x.e,'Card Outcomes')); const assumed=!o; if(!o) o='YELLOW CARD';
    const t=CARD_T.find(c=>o.includes(c[0]))||CARD_T[0]; return {s:x.s,m:x.m,type:t[0],col:t[2],assumed}; });
  SIDES.forEach(s=>{
    const d=D[s], sh=shots.filter(x=>x.s===s);
    d.shots=sh.length; d.scored=sh.filter(x=>x.scored).length; d.psr=d.shots?d.scored/d.shots*100:0;
    d.twoAtt=sh.filter(x=>x.two).length; d.twoMade=sh.filter(x=>x.v===2).length;
    const miss=sh.filter(x=>!x.scored);
    d.mix={scored:d.scored,wide:miss.filter(x=>x.out.includes('WIDE')).length,short:miss.filter(x=>x.out.includes('SHORT')).length};
    d.mix.other=d.shots-d.mix.scored-d.mix.wide-d.mix.short;
    // kickouts by length and half
    const k=kos.filter(x=>x.s===s), w=a=>[a.filter(x=>koWon(x.out,x.s)).length,a.length];
    d.ko={ALL:w(k),SHORT:w(k.filter(x=>x.len.includes('SHORT'))),MEDIUM:w(k.filter(x=>x.len.includes('MEDIUM'))),
          LONG:w(k.filter(x=>x.len.includes('LONG'))),H1:w(k.filter(x=>x.e.half==='1st Half')),H2:w(k.filter(x=>x.e.half==='2nd Half'))};
    d.poss=ev.filter(x=>x.s===s&&/TEAM POSSESSION/.test(x.c)).length;
    d.att=ev.filter(x=>x.s===s&&/\bATTACKS?\b/.test(x.c)).length;
    d.fouls=ev.filter(x=>x.s===s&&/\bFOUL$/.test(x.c)).length;
    // turnovers conceded = in-play TOs (not SHOT ATTEMPT / kickout-lost rows)
    //   + own kickouts lost + shots that handed the ball over
    const to=tos.filter(x=>x.s===s);
    d.toInPlay=to.filter(x=>x.out!=='SHOT ATTEMPT'&&!(x.out==='KICKOUT LOST'||x.out.startsWith('KO LOST'))).length;
    const tagged=to.filter(x=>x.out==='SHOT ATTEMPT'&&x.m!=null);
    const lossSh=sh.filter(x=>LOSS.has(x.out)&&x.m!=null);
    const pairs=[]; tagged.forEach((t,i)=>lossSh.forEach((q,j)=>pairs.push([Math.abs(t.m-q.m)*60,i,j])));
    pairs.sort((a,b)=>a[0]-b[0]);
    const usedT=new Set(), isTag=new Set();
    pairs.forEach(([g,i,j])=>{ if(g>30||usedT.has(i)||isTag.has(j)) return; usedT.add(i); isTag.add(j); });
    d.toShots=lossSh.filter((q,j)=>isTag.has(j)||possAfter(q)==='conceded').length;
    d.toConceded=d.toInPlay+(d.ko.ALL[1]-d.ko.ALL[0])+d.toShots;
    d.toData=to.length>0;
    d.cards={}; CARD_T.forEach(c=>{ d.cards[c[0]]=cards.filter(x=>x.s===s&&x.type===c[0]).length; });
    // top shooters — name variants differing only by punctuation/space/case merged
    const pk=n=>n.replace(/,/g,' ').split(/\s+/).filter(Boolean).join(' ').toLowerCase();
    const spell={}, agg={};
    sh.filter(x=>x.player).forEach(x=>{ const key=pk(x.player);
      (spell[key]=spell[key]||{})[x.player]=(spell[key][x.player]||0)+1;
      const r=agg[key]||(agg[key]={pts:0,goals:0,shots:0,twoMade:0,twoAtt:0});
      r.shots++; if(x.v===3) r.goals++; else r.pts+=x.v; if(x.v===2) r.twoMade++; if(x.two) r.twoAtt++; });
    d.shooters=Object.entries(agg).map(([key,r])=>{
      const nm=Object.entries(spell[key]).sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length)[0][0];
      return {name:nm,...r}; }).sort((a,b)=>(b.goals*3+b.pts)-(a.goals*3+a.pts)||a.shots-b.shots);
    // score sources — each SCORE SOURCE row paired with the score it produced
    // (in order when counts match, else nearest-in-time); the SCORE's value is used
    // abbreviated variants seen in hand-typed rows ("OWN KO") fold into the standard keys
    const srcKey=k=>k.replace(/^(OWN|OPP)\s+KO$/,'$1 KICKOUT').replace(/^OPPOSITION\s+KICKOUT$/,'OPP KICKOUT');
    const srcs=ev.filter(x=>x.s===s&&/SCORE SOURCE/.test(x.c)).map(x=>({m:x.m,src:srcKey(up(lab(x.e,'Score Source Outcomes')))}))
      .sort((a,b)=>(a.m==null?1e9:a.m)-(b.m==null?1e9:b.m));
    const scs=S.scoreEvts.filter(x=>x.s===s);
    let paired=[];
    if(srcs.length===scs.length) paired=srcs.map((x,i)=>[x.src,scs[i].pts]);
    else{
      const pp=[]; srcs.forEach((x,i)=>{ if(x.m==null) return; scs.forEach((q,j)=>pp.push([Math.abs(x.m-q.min),i,j])); });
      pp.sort((a,b)=>a[0]-b[0]); const ui=new Set(), uj=new Set();
      pp.forEach(([g,i,j])=>{ if(ui.has(i)||uj.has(j)) return; ui.add(i); uj.add(j); paired.push([srcs[i].src,scs[j].pts]); });
    }
    d.src={}; paired.forEach(([k,v])=>{ if(k) d.src[k]=(d.src[k]||0)+v; });
    d.srcData=srcs.length>0;
    // half scorelines
    const hs=h=>{ const q=sh.filter(x=>x.scored&&x.e.half===h); const g=q.filter(x=>x.v===3).length, p=q.filter(x=>x.v<3).reduce((a,x)=>a+x.v,0);
      return g+'-'+String(p).padStart(2,'0'); };
    d.h1=hs('1st Half'); d.h2=hs('2nd Half');
    d.total=S[s==='h'?'scH':'scA'].g*3+S[s==='h'?'scH':'scA'].p;
  });
  const SRC_ORDER=['OWN KICKOUT','OPP KICKOUT','FORCED TURNOVER','UNFORCED TURNOVER','FREE WON','BALL RECOVERED','THROW-IN'];
  const SRC_LBL={'OWN KICKOUT':'OWN KICKOUT','OPP KICKOUT':'OPPOSITION KICKOUT','FORCED TURNOVER':'TURNOVER FORCED',
    'UNFORCED TURNOVER':'OPPOSITION ERROR','FREE WON':'FREE WON','BALL RECOVERED':'BALL RECOVERED','THROW-IN':'THROW-IN'};
  const keys=[...SRC_ORDER]; SIDES.forEach(s=>Object.keys(D[s].src).forEach(k=>{ if(!keys.includes(k)) keys.push(k); }));
  const srcRows=keys.map(k=>[k,SRC_LBL[k]||k,D.h.src[k]||0,D.a.src[k]||0]).filter(r=>r[2]||r[3])
    .sort((a,b)=>(b[2]+b[3])-(a[2]+a[3])).slice(0,7);
  // margin worm (home − away), longest unanswered run, early tight spell
  const series=[[0,0]]; let a=0,b=0;
  S.scoreEvts.forEach(x=>{ if(x.s==='h') a+=x.pts; else b+=x.pts; series.push([x.min,a-b,x]); });
  let best=[null,0,0,0,0], cur=[null,0,0,0,0];
  S.scoreEvts.forEach(x=>{ const g=x.pts===3?1:0;
    if(x.s===cur[0]){ cur[1]+=x.pts; cur[3]=x.min; cur[4]+=g; } else cur=[x.s,x.pts,x.min,x.min,g];
    if(cur[1]>best[1]) best=cur.slice(); });
  let tight=0; for(const [m,v] of series){ if(Math.abs(v)>2) break; tight=m; }
  return {D,srcRows,series,run:best,tight,cards,attTagged,lenTagged,
    kosN:kos.length, shotsN:shots.length,
    lastMin:Math.max(60,...S.scoreEvts.map(x=>x.min),...cards.filter(c=>c.m!=null).map(c=>c.m)),
    cardsAssumed:cards.filter(c=>c.assumed).length};
}

// ── MATCH INFOGRAPHIC — 1920×1080 canvas on the dark COHESION background,
// green PDF pitches for the shot and kickout maps.
async function dashBuildInfographic(){
  try{ await Promise.all(['600 20px "Barlow Condensed"','700 20px "Barlow Condensed"','800 20px "Barlow Condensed"',
    '500 20px "Barlow"','600 20px "Barlow"'].map(f=>document.fonts.load(f))); await document.fonts.ready; }catch(_e){}
  const T=dashTeamHexes(), S=dashComputeStats(), I=dashInfographicData(S), D=I.D, MD=dashMapData();
  const W=1920, H=1080;
  // dark COHESION palette (dashboard [data-theme=dark] + cohesion-theme.js)
  const BG='#181820', PANEL='#1e1e28', CARD='#252530', HOVER='#2c2c3a', LINE='#2c2c3a', HEADBG='#14151c',
        T1='#f0f0f5', T2='#8888a0', T3='#52526a', ACC='#4fc3f7', GOLD='#ffd700', PITCH='#256e17';
  const C_WIDE='#e8734a', C_SHORT='#e5b93c', C_OTHER='#6b7080';
  // team colours: nudge a too-dark colour toward white so it reads on dark
  const legible=c=>{ let x=c,n=0; while(dashHexLum(x)<110&&n<12){ x=dashHexMix(x,'#ffffff',0.16); n++; } return x; };
  const CH=legible(T.hexH);
  let CA=legible(T.hexA);
  // two near-identical team colours make every panel unreadable: move the away
  // side to its secondary colour (or a neutral light tone) when they clash
  const rgbOf=h=>{ const n=parseInt(String(h).replace('#',''),16); return [(n>>16)&255,(n>>8)&255,n&255]; };
  const cdist=(a,b)=>{ const x=rgbOf(a), y=rgbOf(b); return Math.hypot(x[0]-y[0],x[1]-y[1],x[2]-y[2]); };
  if(cdist(CH,CA)<90){
    const alt=[T.secA&&legible(T.secA),'#e6e8ef','#4fc3f7'].find(c=>c&&cdist(CH,c)>=90);
    if(alt) CA=alt;
  }
  const onCol=c=>dashHexLum(c)>150?'#14151c':'#ffffff';
  const up=s=>String(s||'').toUpperCase();
  const Hn=up(T.Hn), An=up(T.An);
  // compact name for tight furniture: whole words up to 11 chars, then the
  // initials of the rest ("BÉAL AN M.", "CROSSMOLINA D.R."); never mid-word
  const short=(n,lim)=>{ lim=lim||11; if(n.length<=lim) return n; const w=n.split(/\s+/); let out='', i=0;
    for(;i<w.length;i++){ const c=(out+' '+w[i]).trim(); if(c.length>lim) break; out=c; }
    if(!out) return w[0].slice(0,lim-1)+'.';
    return out+' '+w.slice(i).map(x=>x[0]+'.').join(''); };
  const sH=short(Hn), sA=short(An);

  await cohCrestsReady();
  const [crH,crA]=await Promise.all([dashLoadImg(cohCrestSrc(T.Hn,T.packH)),dashLoadImg(cohCrestSrc(T.An,T.packA))]);
  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d');
  const CF='"Barlow Condensed","Barlow",sans-serif', BF='"Barlow",sans-serif';
  const F=(w,s,b)=>w+' '+s+'px '+(b?BF:CF);
  const LS=v=>{ if('letterSpacing' in ctx) ctx.letterSpacing=(v||0)+'px'; };
  const tw=(s,f,ls)=>{ ctx.font=f; LS(ls); const w=ctx.measureText(s).width; LS(0); return w; };
  const txt=(s,x,y,f,col,al,ls)=>{ ctx.font=f; LS(ls); ctx.fillStyle=col; ctx.textAlign=al||'left'; ctx.textBaseline='top';
    // letterSpacing adds trailing space after the last glyph; compensate for right/centre alignment
    const adj=(ls&&'letterSpacing' in ctx)?(al==='right'?ls:al==='center'?ls/2:0):0;
    ctx.fillText(s,x+adj,y); LS(0); };
  const fit=(s,f,ls,maxw)=>{ if(tw(s,f,ls)<=maxw) return s; let w=s.split(' ');
    while(w.length>1&&tw(w.join(' '),f,ls)>maxw) w.pop(); let o=w.join(' ');
    while(o&&tw(o,f,ls)>maxw) o=o.slice(0,-1); return o; };
  const rr=(x,y,w,h,r,fill,stroke,lw)=>{ ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(x,y,w,h,r); else ctx.rect(x,y,w,h);
    if(fill){ ctx.fillStyle=fill; ctx.fill(); } if(stroke){ ctx.strokeStyle=stroke; ctx.lineWidth=lw||1; ctx.stroke(); } };
  const bar=(x,y,w,h,fill)=>{ if(w<=0) return; rr(x,y,Math.max(w,1.5),h,Math.min(2,h/2),fill); };
  const ln=(x1,y1,x2,y2,col,lw)=>{ ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.strokeStyle=col; ctx.lineWidth=lw||1; ctx.stroke(); };
  const dotKey=(x,y,col,name,al)=>{ // coloured dot + short team name; returns width
    const f=F(700,14); const w=tw(name,f,0.5);
    if(al==='right'){ txt(name,x,y,f,col,'right',0.5); rr(x-w-15,y+3,10,10,5,col); return w+15; }
    rr(x,y+3,10,10,5,col); txt(name,x+15,y,f,col,'left',0.5); return w+15; };
  const panel=(x,y,w,h,title,sub,acc)=>{
    rr(x,y,w,h,8,PANEL,'rgba(255,255,255,0.08)');
    rr(x+16,y+16,3,17,1,acc||ACC);
    txt(title,x+27,y+13,F(700,20),T1,'left',0.8);
    if(sub) txt(sub,x+27+tw(title,F(700,20),0.8)+10,y+18,F(600,14),T2,'left',0.4);
    ln(x+16,y+43,x+w-16,y+43,LINE,1);
    return y+54; };

  ctx.fillStyle=BG; ctx.fillRect(0,0,W,H);

  // ── HEADER ─────────────────────────────────────────────
  const HB=150;
  ctx.fillStyle=HEADBG; ctx.fillRect(0,0,W,HB);
  ctx.fillStyle=T.hexH; ctx.fillRect(0,0,W/2,5); ctx.fillStyle=T.hexA; ctx.fillRect(W/2,0,W/2,5);
  ln(0,HB,W,HB,HOVER,2);
  txt('COHESION',44,32,F(800,32),T1,'left',1.5);
  txt('ANALYSIS',44+tw('COHESION',F(800,32),1.5)+12,32,F(800,32),ACC,'left',1.5);
  txt('MATCH INFOGRAPHIC  ·  FULL GAME',46,76,F(600,16),'#b4b4c6','left',1.6);
  const meta=[GAME.competition||'',GAME.round||'',GAME.date||''].filter(Boolean).join('  ·  ');
  if(meta) txt(fit(up(meta),F(600,16),0.9,500),46,102,F(600,16),T2,'left',0.9);
  const leftEdge=46+Math.max(tw('COHESION ANALYSIS',F(800,32),1.5)+12,tw('MATCH INFOGRAPHIC  ·  FULL GAME',F(600,16),1.6),
    meta?Math.min(500,tw(up(meta),F(600,16),0.9)):0)+36;
  const tH=D.h.total, tA=D.a.total, margin=Math.abs(tH-tA);
  const res=margin===0?'DRAW':((tH>tA?Hn:An)+' WIN BY '+margin);
  txt('FULL TIME',W-44,30,F(800,26),T1,'right',1.6);
  const resF=F(700,19);
  txt(fit(res,resF,1,440),W-44,66,resF,GOLD,'right',1);
  const rt3=I.shotsN+' SHOTS  ·  '+I.kosN+' KICKOUTS';
  txt(rt3,W-44,98,F(600,15),T2,'right',0.6);
  const rightEdge=W-44-Math.max(tw('FULL TIME',F(800,26),1.6),Math.min(440,tw(res,resF,1)),tw(rt3,F(600,15),0.6))-36;
  const cx=W/2, SF=F(800,78);
  txt('V',cx,50,F(700,26),T3,'center');
  txt(S.scH.str,cx-40,26,SF,T1,'right');
  txt(S.scA.str,cx+40,26,SF,T1,'left');
  const scWH=tw(S.scH.str,SF), scWA=tw(S.scA.str,SF);
  // xP under each score: "FROM 22.4 XP" (full game, located shots only)
  const XS=dashXpSummary(null), xpOn=!!(XS&&(XS.h.n||XS.a.n));
  if(xpOn){ const xf=F(700,17);
    [['h',cx-40,'right',scWH],['a',cx+40,'left',scWA]].forEach(([s2,x2,al,wd])=>{ const t=XS[s2];
      txt(fit(t.n?'FROM '+dashXpF(t.xp)+' XP':'NO XP',xf,1,wd+20),x2,112,xf,t.n?'#b4b4c6':T3,al,1); }); }
  const CR=40, cyC=70;
  const drawCrest=(im,x,col,nm)=>{
    ctx.save(); ctx.beginPath(); ctx.arc(x,cyC,CR,0,Math.PI*2); ctx.closePath(); ctx.fillStyle=CARD; ctx.fill(); ctx.clip();
    if(im) ctx.drawImage(im,x-CR,cyC-CR,CR*2,CR*2);
    else{ ctx.fillStyle=col; ctx.fillRect(x-CR,cyC-CR,CR*2,CR*2);
      const ini=nm.split(/\s+/).filter(Boolean).map(w=>w[0]).join('').slice(0,3)||'?';
      ctx.fillStyle=onCol(col); ctx.font=F(800,26); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(ini,x,cyC+1); }
    ctx.restore();
    ctx.beginPath(); ctx.arc(x,cyC,CR,0,Math.PI*2); ctx.strokeStyle='rgba(255,255,255,0.22)'; ctx.lineWidth=2; ctx.stroke(); };
  const crXH=cx-40-scWH-28-CR, crXA=cx+40+scWA+28+CR;
  drawCrest(crH,crXH,T.hexH,Hn); drawCrest(crA,crXA,T.hexA,An);
  // team names: largest size that fits the space beside the crest; wrap to two lines if needed
  const nameFit=(nm,avail)=>{
    const wrap=s=>{ const w=s.split(/\s+/); if(w.length<2) return [s]; let bst=null;
      for(let i=1;i<w.length;i++){ const l1=w.slice(0,i).join(' '), l2=w.slice(i).join(' '), m=Math.max(l1.length,l2.length);
        if(!bst||m<bst.m) bst={m,l:[l1,l2]}; } return bst.l; };
    let lines=[nm], fs=38;
    const widest=(ls,f)=>Math.max(...ls.map(l=>tw(l,F(800,f),1)));
    while(fs>26&&widest(lines,fs)>avail) fs-=2;
    if(widest(lines,fs)>avail){ lines=wrap(nm); fs=36; while(fs>20&&widest(lines,fs)>avail) fs-=2; }
    return {lines,fs}; };
  const nameBlock=(nm,col,edgeX,limitX,al,d,fsCap)=>{
    const avail=Math.abs(edgeX-limitX);
    let {lines,fs}=nameFit(nm,avail);
    if(fsCap&&fs>fsCap) fs=fsCap;   // both names share one size so the header stays balanced
    const lh=fs+2, blockH=lines.length*lh+26, y0=cyC-blockH/2-2;
    lines.forEach((l,i)=>txt(l,edgeX,y0+i*lh,F(800,fs),col,al,1));
    txt(d.scored+'/'+d.shots+' SHOTS  ·  PSR '+Math.round(d.psr)+'%',edgeX,y0+lines.length*lh+6,F(600,16),T2,al,0.8);
  };
  const fsH=nameFit(Hn,Math.abs(crXH-CR-22-leftEdge)), fsA=nameFit(An,Math.abs(crXA+CR+22-rightEdge));
  const fsCap=(fsH.lines.length===fsA.lines.length)?Math.min(fsH.fs,fsA.fs):0;
  nameBlock(Hn,CH,crXH-CR-22,leftEdge,'right',D.h,fsCap);
  nameBlock(An,CA,crXA+CR+22,rightEdge,'left',D.a,fsCap);

  // ── BODY GRID ───────────────────────────────────────────
  const CXs=[40,660,1280], CW=600, Y0=HB+16, Y1=878;

  // A: SHOT MAP + SHOT OUTCOME MIX
  {
    const x=CXs[0];
    const ay=panel(x,Y0,CW,Y1-Y0,'SHOT MAP','· ALL '+I.shotsN+' SHOTS · ATTACKING UP THE PAGE',CH);
    let kx=x+CW-16; kx-=dotKey(kx,Y0+14,CA,sA,'right')+12; dotKey(kx,Y0+14,CH,sH,'right');
    const miss=MD.shotMiss.h+MD.shotMiss.a;
    const tp=I.attTagged&&(D.h.shots||D.a.shots);
    const textLines=(tp?1:0)+(miss?1:0)+(xpOn?1:0);
    const MIXH=168;
    const avail=(Y1-16-MIXH-10)-ay-30-textLines*22;   // 30 = legend row
    let ph=Math.min(avail,Math.round(540*0.832)); const pw=Math.round(ph/0.832); ph=Math.round(pw*0.832);
    const px=x+(CW-pw)/2, py=ay;
    const {svg}=dashMapSvg('shot',CH,CA,pw*2,{bg:PITCH});
    const im=await dashSvgImg(svg);
    ctx.save(); rr(px,py,pw,ph,6); ctx.clip(); ctx.fillStyle=PITCH; ctx.fillRect(px,py,pw,ph); if(im) ctx.drawImage(im,px,py,pw,ph); ctx.restore();
    rr(px,py,pw,ph,6,null,'rgba(255,255,255,0.15)');
    if(!MD.shots.length){ rr(px+pw/2-150,py+ph/2-24,300,48,6,'rgba(20,21,28,0.78)');
      txt('NO SHOT LOCATIONS TAGGED',px+pw/2,py+ph/2-9,F(700,17),T1,'center',1); }
    let ly=py+ph+10; const G='#a8acba';
    let lx=px+2;
    [['cir',true,'SCORED'],['cir',false,'MISSED'],['cir',true,'1PT'],['dia',true,'2PT'],['tri',true,'GOAL'],['sq',true,'DEADBALL']].forEach(([shp,fl,lb])=>{
      dashGlyph(ctx,shp,lx+6,ly+8,5.5,G,fl,BG); lx+=16; txt(lb,lx,ly,F(600,14),T2,'left',0.5); lx+=tw(lb,F(600,14),0.5)+18; });
    ly+=30;
    if(xpOn){ // marker size key at the pitch's own scale (pw px per 100 units)
      const u=pw/100; let kx=px+2;
      txt('MARKER SIZE = XP',kx,ly,F(600,14),T2,'left',0.5); kx+=tw('MARKER SIZE = XP',F(600,14),0.5)+12;
      [0.2,0.6,1.5].forEach(v=>{ const r=1.4*u*dashXpScale(v);
        ctx.beginPath(); ctx.arc(kx+r,ly+8,r,0,Math.PI*2); ctx.fillStyle=G; ctx.fill(); ctx.strokeStyle=BG; ctx.lineWidth=1; ctx.stroke();
        kx+=2*r+6; txt(v.toFixed(1),kx,ly,F(600,14),T2,'left',0.5); kx+=tw(v.toFixed(1),F(600,14),0.5)+14; });
      txt('· BIGGER = BETTER CHANCE',kx,ly,F(600,14),T3,'left',0.5);
      ly+=22; }
    const pc=(n,d)=>d?Math.round(n/d*100):0;
    if(tp){ txt(fit(pc(D.h.twoAtt,D.h.shots)+'% OF '+sH+"'S SHOTS CAME FROM TWO-POINT RANGE — "+sA+' '+pc(D.a.twoAtt,D.a.shots)+'%.',F(600,15),0.3,pw),
      px,ly,F(600,15),T1,'left',0.3); ly+=22; }
    if(miss){ txt(fit('* '+['h','a'].filter(s=>MD.shotMiss[s]).map(s=>(s==='h'?sH:sA)+' '+MD.shotMiss[s]).join(' · ')+' SHOT'+(miss>1?'S':'')+' WITH NO LOCATION TAGGED',F(500,14,1),0.2,pw),
      px,ly,F(500,14,1),T2,'left',0.2); ly+=22; }
    // outcome mix
    const oy=Y1-16-MIXH;
    ln(px,oy,px+pw,oy,LINE,1);
    txt('SHOT OUTCOME MIX',px,oy+10,F(700,17),T1,'left',0.8);
    let lgx=px+pw;
    [['BLOCKED / SAVED / OTHER',C_OTHER],['DROPPED SHORT',C_SHORT],['WIDE',C_WIDE]].forEach(([lb,c])=>{
      lgx-=tw(lb,F(600,12),0.4); txt(lb,lgx,oy+14,F(600,12),T2,'left',0.4); lgx-=14; rr(lgx,oy+15,9,9,2,c); lgx-=16; });
    [['h',CH,Hn],['a',CA,An]].forEach(([s,col,nm],i)=>{
      const o=D[s].mix, tot=D[s].shots, by=oy+60+i*50;
      txt(nm,px,by-21,F(700,15),col,'left',0.7);
      txt(o.scored+' SCORED FROM '+tot+' SHOTS',px+pw,by-20,F(600,13),T2,'right',0.4);
      if(!tot){ rr(px,by,pw,22,3,CARD); return; }
      let c0=px;
      [[o.scored,col,true],[o.wide,C_WIDE],[o.short,C_SHORT],[o.other,C_OTHER]].forEach(([v,c,own])=>{
        const seg=pw*v/tot; if(!v) return;
        rr(c0,by,Math.max(seg-2,2),22,2,c);
        if(seg>28) txt(String(v),c0+seg/2-1,by+3,F(700,16),own?onCol(c):(dashHexLum(c)>150?'#14151c':'#ffffff'),'center');
        c0+=seg; });
    });
    const worst=(D.h.shots-D.h.scored)>=(D.a.shots-D.a.scored)?'h':'a', wd=D[worst];
    if(wd.shots) txt(fit((wd.shots-wd.scored)+' OF '+(worst==='h'?sH:sA)+"'S "+wd.shots+' SHOTS FAILED TO SCORE.',F(600,14),0.3,pw),
      px,oy+140,F(600,14),GOLD,'left',0.3);
  }

  // B: KICKOUT LANDING MAP + KICKOUT RETENTION
  {
    const x=CXs[1];
    const lenRows=I.lenTagged?[['SHORT','SHORT'],['MEDIUM','MEDIUM'],['LONG','LONG']]:[];
    const rows=[['ALL KICKOUTS','ALL'],...lenRows,['1ST HALF','H1'],['2ND HALF','H2']];
    const RH=54+22+rows.length*19+14;
    const KH=(Y1-Y0)-10-RH;
    const ky=panel(x,Y0,CW,KH,'KICKOUT LANDING MAP','· TOP = KICKING GOAL · DASHED = HALFWAY',ACC);
    const ph=KH-(ky-Y0)-16, pw=Math.round(ph/1.096);
    const px=x+22, py=ky;
    const {svg}=dashMapSvg('ko',CH,CA,pw*2,{bg:PITCH});
    const im=await dashSvgImg(svg);
    ctx.save(); rr(px,py,pw,ph,6); ctx.clip(); ctx.fillStyle=PITCH; ctx.fillRect(px,py,pw,ph); if(im) ctx.drawImage(im,px,py,pw,ph); ctx.restore();
    rr(px,py,pw,ph,6,null,'rgba(255,255,255,0.15)');
    if(!MD.kos.length){ rr(px+pw/2-140,py+ph/2-24,280,48,6,'rgba(20,21,28,0.78)');
      txt('NO KICKOUT LOCATIONS TAGGED',px+pw/2,py+ph/2-9,F(700,17),T1,'center',1); }
    // side column: legend + restart counts + unlocated notes
    const sx=px+pw+24, sw=x+CW-20-sx; let sy=py+4;
    txt('LEGEND',sx,sy,F(700,14),T2,'left',1); sy+=26;
    rr(sx,sy+2,11,11,5.5,'#a8acba'); txt('RETAINED',sx+20,sy-1,F(600,15),T1,'left',0.5); sy+=26;
    ln(sx+1,sy+2,sx+11,sy+12,'#a8acba',2.2); ln(sx+1,sy+12,sx+11,sy+2,'#a8acba',2.2); txt('LOST',sx+20,sy-1,F(600,15),T1,'left',0.5); sy+=34;
    [['h',CH,sH],['a',CA,sA]].forEach(([s,col,nm])=>{ rr(sx,sy+3,11,11,5.5,col); txt(fit(nm,F(700,15),0.5,sw-20),sx+20,sy,F(700,15),col,'left',0.5); sy+=26; });
    sy+=16; ln(sx,sy,sx+sw,sy,LINE,1); sy+=14;
    [['h',CH,sH],['a',CA,sA]].forEach(([s,col,nm])=>{
      const k=D[s].ko.ALL;
      txt(fit(nm,F(700,14),0.5,sw),sx,sy,F(700,14),col,'left',0.5); sy+=20;
      txt(String(k[1]),sx,sy,F(800,34),T1,'left'); const w1=tw(String(k[1]),F(800,34));
      txt('OWN RESTARTS',sx+w1+8,sy+15,F(600,13),T2,'left',0.4); sy+=40;
      const loc=MD.kos.filter(m=>m.s===s).length;
      txt(loc+' LOCATED ON MAP',sx,sy,F(600,13),T2,'left',0.4); sy+=30; });
    const km=MD.koMiss.h+MD.koMiss.a;
    if(km){ sy+=4;
      txt('* NO LOCATION TAGGED:',sx,sy,F(500,13,1),T2,'left',0.2); sy+=18;
      ['h','a'].filter(s=>MD.koMiss[s]).forEach(s=>{ txt(fit((s==='h'?sH:sA)+'  '+MD.koMiss[s],F(500,13,1),0.2,sw),sx+9,sy,F(500,13,1),T2,'left',0.2); sy+=18; }); }

    // retention
    const RY=Y0+KH+10;
    const dy=panel(x,RY,CW,RH,'KICKOUT RETENTION','· BY LENGTH AND BY HALF',ACC);
    const rx=x+24, rw=CW-48, GUT=58, bw=rw*0.27;
    txt(sH,rx+GUT,dy-2,F(700,15),CH,'left',0.8);
    txt(sA,rx+rw-GUT,dy-2,F(700,15),CA,'right',0.8);
    let ry=dy+22;
    rows.forEach(([lb,key])=>{
      const big=key==='ALL';
      txt(lb,rx+rw/2,ry,F(big?700:600,big?15:14),big?T1:T2,'center',0.7);
      [['h',CH],['a',CA]].forEach(([s,col],side)=>{
        const [wn,n]=D[s].ko[key];
        const bx=rx+(side===0?GUT:rw-GUT-bw);
        rr(bx,ry+2,bw,13,2,CARD);
        if(n){ const fw=bw*wn/n; bar(side===0?bx+bw-fw:bx,ry+2,fw,13,col); }
        const lbv=n?wn+'/'+n:'—';
        txt(lbv,side===0?bx-8:bx+bw+8,ry-1,F(700,16),n?col:T3,side===0?'right':'left');
      });
      ry+=19; if(big){ ln(rx,ry-1,rx+rw,ry-1,LINE,1); ry+=4; }
    });
  }

  // C: KEY BATTLES / SCORE SOURCES / SHOOTING RETURNS
  {
    const x=CXs[2];
    const pc=(n,d)=>d?Math.round(n/d*100):0;
    const h=D.h, a=D.a;
    // rows: [label, home text, away text, home weight, away weight]; rows the data cannot fill are hidden
    const B=[];
    if(h.shots||a.shots) B.push(['SHOOTING ACCURACY',Math.round(h.psr)+'%',Math.round(a.psr)+'%',Math.max(h.psr,.1),Math.max(a.psr,.1)]);
    if(xpOn) B.push(['EXPECTED POINTS (XP)',XS.h.n?dashXpF(XS.h.xp):'—',XS.a.n?dashXpF(XS.a.xp):'—',Math.max(XS.h.xp,.1),Math.max(XS.a.xp,.1)]);
    if(I.attTagged&&(h.twoAtt||a.twoAtt)) B.push(['TWO-POINT SHOTS',h.twoMade+'/'+h.twoAtt,a.twoMade+'/'+a.twoAtt,Math.max(h.twoMade*10+h.twoAtt,1),Math.max(a.twoMade*10+a.twoAtt,1)]);
    if(h.ko.ALL[1]||a.ko.ALL[1]) B.push(['OWN KICKOUTS WON',(h.ko.ALL[1]?pc(...h.ko.ALL)+'%':'—'),(a.ko.ALL[1]?pc(...a.ko.ALL)+'%':'—'),Math.max(pc(...h.ko.ALL),.1),Math.max(pc(...a.ko.ALL),.1)]);
    if(h.poss||a.poss) B.push(['POSSESSIONS',String(h.poss),String(a.poss),Math.max(h.poss,1),Math.max(a.poss,1)]);
    if(h.att||a.att) B.push(['ATTACKS',String(h.att),String(a.att),Math.max(h.att,1),Math.max(a.att,1)]);
    if((h.toData||a.toData)&&(h.toConceded||a.toConceded)) B.push(['TURNOVERS CONCEDED',String(h.toConceded),String(a.toConceded),Math.max(h.toConceded,1),Math.max(a.toConceded,1)]);
    if(h.fouls||a.fouls) B.push(['FOULS CONCEDED',String(h.fouls),String(a.fouls),Math.max(h.fouls,1),Math.max(a.fouls,1)]);
    const cardsOn=I.cards.length>0;
    const nB=B.length+(cardsOn?1:0);
    const src=I.srcRows;
    const avail=(Y1-Y0)-20;
    const retH=54+24+5*22+8;
    let sb=27, ss=24;
    const bH=()=>54+nB*sb+8, sHt=()=>54+Math.max(src.length,1)*ss+(src.length&&src.length<=6?22:0)+6;
    while(bH()+sHt()+retH>avail&&(sb>22||ss>20)){ if(sb>22) sb--; if(ss>20) ss--; }
    const EH=bH(), FH=sHt(), GY=Y0+EH+10+FH+10, GH=Y1-GY;
    // key battles
    let ey=panel(x,Y0,CW,EH,'THE KEY BATTLES',null,GOLD);
    const hx=x+24, hw=CW-48, hbw=hw*0.25;
    B.forEach(([lb,v1,v2,n1,n2])=>{
      txt(lb,hx+hw/2,ey,F(600,14),T2,'center',0.6);
      const tot=n1+n2, f1=hbw*n1/tot, f2=hbw*n2/tot;
      rr(hx+46,ey+3,hbw,12,2,CARD); bar(hx+46+hbw-f1,ey+3,f1,12,CH);
      rr(hx+hw-46-hbw,ey+3,hbw,12,2,CARD); bar(hx+hw-46-hbw,ey+3,f2,12,CA);
      txt(v1,hx+38,ey-2,F(700,17),CH,'right'); txt(v2,hx+hw-38,ey-2,F(700,17),CA,'left');
      ey+=sb; });
    if(cardsOn){
      txt('CARDS',hx+hw/2,ey,F(600,14),T2,'center',0.6);
      [['h',h],['a',a]].forEach(([s,d],side)=>{
        const tot=d.cards.YELLOW+d.cards.BLACK+d.cards.RED;
        if(!tot){ txt('—',side===0?hx+46+hbw-4:hx+hw-46-hbw+4,ey-2,F(700,17),T3,side===0?'right':'left'); return; }
        let cx2=side===0?hx+46+hbw:hx+hw-46-hbw;
        [['YELLOW','#f7cd28'],['BLACK','#2e2e3a'],['RED','#d62d28']].forEach(([k,col])=>{
          const n=d.cards[k]; if(!n) return;
          const lbl=n>1?'x'+n:'', w=12+(lbl?tw(lbl,F(700,15))+5:0);
          const bx=side===0?cx2-w:cx2;
          rr(bx,ey+1,11,15,2,col,'#9698a6',1);
          if(lbl) txt(lbl,bx+16,ey-1,F(700,15),T1,'left');
          cx2=side===0?cx2-w-8:cx2+w+8; });
      });
    }
    // score sources
    const FY=Y0+EH+10;
    let fy=panel(x,FY,CW,FH,'HOW THE SCORES WERE BUILT','· POINTS BY SOURCE',GOLD);
    const sx=x+24, sw=CW-48, sbw=sw*0.25;
    if(!src.length) txt('NO SCORE-SOURCE TAGS IN THIS GAME',sx+sw/2,fy+4,F(600,14),T3,'center',0.6);
    const mxv=Math.max(1,...src.map(r=>Math.max(r[2],r[3])));
    src.forEach(([k,lb,p1,p2])=>{
      txt(lb,sx+sw/2,fy,F(600,14),T2,'center',0.6);
      rr(sx+36,fy+3,sbw,11,2,CARD); if(p1) bar(sx+36+sbw-sbw*p1/mxv,fy+3,sbw*p1/mxv,11,CH);
      rr(sx+sw-36-sbw,fy+3,sbw,11,2,CARD); if(p2) bar(sx+sw-36-sbw,fy+3,sbw*p2/mxv,11,CA);
      txt(String(p1),sx+28,fy-2,F(700,17),p1?CH:T3,'right'); txt(String(p2),sx+sw-28,fy-2,F(700,17),p2?CA:T3,'left');
      fy+=ss; });
    if(src.length&&src.length<=6){
      const b=src.reduce((m,r)=>Math.max(r[2],r[3])>Math.max(m[2],m[3])?r:m,src[0]);
      const who=b[2]>=b[3]?sH:sA;
      txt(fit('BIGGEST SINGLE SOURCE: '+who+' SCORED '+Math.max(b[2],b[3])+' POINTS OFF '+b[1]+'.',F(600,14),0.2,sw),sx,fy+2,F(600,14),GOLD,'left',0.2);
    }
    // shooting returns
    const gy=panel(x,GY,CW,GH,'SHOOTING RETURNS','· TOP FIVE SHOOTERS',GOLD);
    const gx=x+24, cwid=(CW-48)/2-12;
    const rstep=Math.min(24,Math.floor((GY+GH-14-(gy+22))/5));
    [['h',CH,sH],['a',CA,sA]].forEach(([s,col,nm],side)=>{
      const x0=gx+side*(cwid+24);
      txt(nm,x0,gy-4,F(700,15),col,'left',0.8);
      txt('PTS    SH    2PT',x0+cwid,gy-2,F(600,12),T2,'right',0.4);
      ln(x0,gy+17,x0+cwid,gy+17,LINE,1);
      let yy=gy+24;
      const list=D[s].shooters.slice(0,5);
      if(!list.length) txt('NO SHOOTERS TAGGED',x0,yy,F(600,14),T3,'left',0.4);
      // "D. HURLEY" style; fall back to the full name where two shooters would collide
      const abbr=n=>{ const p=n.replace(/,/g,' ').split(/\s+/).filter(Boolean); return (p.length>1?p[0][0]+'. '+p.slice(1).join(' '):n).toUpperCase(); };
      const abC={}; list.forEach(r=>{ const k=abbr(r.name); abC[k]=(abC[k]||0)+1; });
      list.forEach(r=>{
        const nmS=abC[abbr(r.name)]>1?r.name.replace(/,/g,' ').split(/\s+/).filter(Boolean).join(' ').toUpperCase():abbr(r.name);
        txt(fit(nmS,F(600,15),0.3,cwid-108),x0,yy,F(600,15),T1,'left',0.3);
        const val=r.goals*3+r.pts;
        txt(r.goals+'-'+String(r.pts).padStart(2,'0'),x0+cwid-72,yy,F(700,16),val?col:T3,'right');
        txt(String(r.shots),x0+cwid-40,yy,F(600,15),T2,'right');
        txt(r.twoAtt?r.twoMade+'/'+r.twoAtt:'—',x0+cwid,yy,F(600,15),r.twoAtt?T2:T3,'right');
        yy+=rstep; });
    });
  }

  // ── MATCH MARGIN worm ────────────────────────────────────
  {
    const ty=Y1+12, th=1034-ty;
    panel(40,ty,W-80,th,'MATCH MARGIN',I.cards.length?'· RUNNING LEAD · 2-POINTERS, GOALS AND CARDS MARKED':'· RUNNING LEAD · 2-POINTERS AND GOALS MARKED',CH);
    txt('HALF-TIME '+D.h.h1+' TO '+D.a.h1+'        SECOND HALF '+D.h.h2+' TO '+D.a.h2,W-60,ty+12,F(700,18),T1,'right',0.8);
    const tx0=Math.max(150,60+Math.max(tw(sH,F(700,14),0.6),tw(sA,F(700,14),0.6))+14), tx1=W-130;
    const series=I.series.slice();
    const mmMax=Math.max(I.lastMin+2,62);
    const vals=series.map(p=>p[1]); const hi=Math.max(...vals,1), lo=Math.min(...vals,-1);
    const rTop=ty+74, rBot=ty+th-30, avail=rBot-rTop;
    const rng=Math.max(hi+Math.abs(lo),2), scale=Math.min(9,avail/rng);
    const zy=rTop+(avail-rng*scale)/2+hi*scale, chartTop=zy-hi*scale;
    series.push([mmMax,series[series.length-1][1]]);
    const MX=m=>tx0+(m/mmMax)*(tx1-tx0);
    ln(tx0,zy,tx1,zy,'#3a3a4c',1);
    const step=mmMax<=70?5:10;
    for(let m=0;m<=mmMax;m+=step){ ln(MX(m),zy,MX(m),zy+3,'#4a4a60',1); txt(m+"'",MX(m),ty+th-24,F(600,13),T3,'center'); }
    const pts=[]; let prev=null;
    series.forEach(([m,v])=>{ if(prev!==null) pts.push([MX(m),zy-prev*scale]); pts.push([MX(m),zy-v*scale]); prev=v; });
    for(let i=0;i<pts.length-1;i++){
      const [x1,y1]=pts[i],[x2,y2]=pts[i+1];
      if(Math.abs(y1-zy)<0.1&&Math.abs(y2-zy)<0.1) continue;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x2,zy); ctx.lineTo(x1,zy); ctx.closePath();
      ctx.globalAlpha=(y1+y2)/2<zy?0.32:0.26; ctx.fillStyle=(y1+y2)/2<zy?CH:CA; ctx.fill(); ctx.globalAlpha=1; }
    ctx.beginPath(); pts.forEach(([px2,py2],i)=>i?ctx.lineTo(px2,py2):ctx.moveTo(px2,py2));
    ctx.strokeStyle='#ececf4'; ctx.lineWidth=2; ctx.stroke();
    const hx=MX(S.h1len);
    ln(hx,chartTop-12,hx,zy+(Math.abs(lo)+0.6)*scale,'#60607a',1);
    // 2-pointers and goals
    I.series.slice(1).forEach(([m,v,e])=>{ if(!e||e.pts<2) return;
      const yy=zy-v*scale, r=e.pts===2?4.5:6.5, col=e.s==='h'?CH:CA;
      ctx.beginPath(); ctx.arc(MX(m),yy,r,0,Math.PI*2); ctx.fillStyle=col; ctx.fill(); ctx.strokeStyle=HEADBG; ctx.lineWidth=1.5; ctx.stroke();
      if(e.pts===3){ ctx.beginPath(); ctx.arc(MX(m),yy,2,0,Math.PI*2); ctx.fillStyle=HEADBG; ctx.fill(); } });
    const marginAt=m=>{ let v=0; for(const [t,val] of series){ if(t<=m) v=val; else break; } return v; };
    I.cards.forEach(c=>{ if(c.m==null) return; const yy=zy-marginAt(c.m)*scale;
      rr(MX(c.m)-4.5,yy-6.5,9,13,2,c.col,'#f0f2f8',1); });
    const fin=series[series.length-1][1];
    if(fin===0) txt('LEVEL',tx1+12,zy-10,F(700,16),GOLD,'left');
    else txt((fin>0?'+':'')+fin,tx1+12,zy-fin*scale-11,F(700,19),fin>0?CH:CA,'left');
    txt(sH,tx0-12,chartTop-6,F(700,14),CH,'right',0.6);
    txt(sA,tx0-12,zy+Math.abs(lo)*scale-10,F(700,14),CA,'right',0.6);
    const [rs,rp,r0,r1,rg]=I.run; let runSpan=null;
    if(rs&&rp>=4){
      const yl=chartTop-8;
      ln(MX(r0),yl,MX(r1),yl,GOLD,1); ln(MX(r0),yl,MX(r0),yl+5,GOLD,1); ln(MX(r1),yl,MX(r1),yl+5,GOLD,1);
      const lbl=rg+'-'+String(Math.max(rp-rg*3,0)).padStart(2,'0')+' WITHOUT REPLY ('+(rs==='h'?sH:sA)+')';
      const lw=tw(lbl,F(600,13),0.6), mid=MX((r0+r1)/2);
      txt(lbl,mid,yl-19,F(600,13),GOLD,'center',0.6); runSpan=[mid-lw/2,mid+lw/2]; }
    const htY=chartTop-30;
    if(runSpan&&runSpan[0]<hx+90&&runSpan[1]>hx-90) txt('HALF-TIME',hx-6,htY+2,F(600,12),T2,runSpan[0]<hx?'left':'right',0.6);
    else txt('HALF-TIME',hx+6,htY+2,F(600,12),T2,'left',0.6);
    if(I.tight>=15){
      const subW=27+tw('MATCH MARGIN',F(700,20),0.8)+10+tw(I.cards.length?'· RUNNING LEAD · 2-POINTERS, GOALS AND CARDS MARKED':'· RUNNING LEAD · 2-POINTERS AND GOALS MARKED',F(600,14),0.4);
      txt('LEVEL OR WITHIN TWO POINTS FOR THE FIRST '+Math.floor(I.tight)+' MINUTES',40+subW+30,ty+18,F(600,14),GOLD,'left',0.6);
    }
  }

  // ── FOOTER ───────────────────────────────────────────────
  ln(40,1044,W-40,1044,LINE,1);
  txt('COHESION ANALYSIS',44,1054,F(700,15),T2,'left',1);
  txt(fit(('GENERATED FROM TAGGED MATCH EVENTS'+(meta?'  ·  '+meta:'')).toUpperCase(),F(600,13),0.5,900),44+tw('COHESION ANALYSIS',F(700,15),1)+16,1055,F(600,13),T3,'left',0.5);
  txt('PSR = POINT SCORING RATE  ·  SHOT & KICKOUT LOCATIONS AS TAGGED'+(xpOn?'  ·  XP MODEL V'+XS.version:''),W-44,1055,F(600,13),T3,'right',0.5);
  return cv;
}
async function dashDownloadInfographic(btn){
  dashBusy(btn,true);
  try{
    const cv=await dashBuildInfographic();
    await new Promise(r=>cv.toBlob(b=>{ if(b) dashDlBlob(b,dashFileStem()+'_infographic.png'); r(); },'image/png'));
  } catch(e){ alert('Could not build the infographic: '+e.message); }
  finally { dashBusy(btn,false); }
}

// ── Stats tab: Expected points (xP) section — period-aware via statPred ──
function dashXpChartSvg(S,hC,aC){
  const X=S.X, sh=X.shots.filter(o=>statPred(o.e)&&o.min!=null).sort((p,q)=>p.min-q.min);
  if(!sh.length) return '';
  const mins=ALL.filter(e=>statSide(e)&&statPred(e)).map(e=>{ const m=/^([12])H\s+(\d+):(\d+)/.exec(e.gameTime||''); if(!m) return null;
    const mn=+m[2]+(+m[3])/60; return +m[1]===1?mn:X.h1len+mn; }).filter(v=>v!=null);
  let x0=Math.floor(Math.min(...mins,sh[0].min)), x1=Math.ceil(Math.max(...mins,sh[sh.length-1].min));
  if(x1-x0<5) x1=x0+5;
  const series={h:{p:[[x0,0]],x:[[x0,0]]},a:{p:[[x0,0]],x:[[x0,0]]}}, tot={h:{p:0,x:0},a:{p:0,x:0}};
  sh.forEach(o=>{ const t=tot[o.s], z=series[o.s];
    if(o.pts){ t.p+=o.pts; z.p.push([o.min,t.p]); }
    if(o.xp!=null){ t.x+=o.xp; z.x.push([o.min,t.x]); } });
  ['h','a'].forEach(s=>{ series[s].p.push([x1,tot[s].p]); series[s].x.push([x1,tot[s].x]); });
  const W=320,H=132,ML=24,MR=8,MT=8,MB=18, maxV=Math.max(4,tot.h.p,tot.a.p,tot.h.x,tot.a.x);
  const X_=m=>ML+(m-x0)/(x1-x0)*(W-ML-MR), Y_=v=>MT+(H-MT-MB)*(1-v/maxV);
  const step=pts=>pts.map((p,i)=>(i?'L'+X_(p[0]).toFixed(1)+' '+Y_(pts[i-1][1]).toFixed(1)+' ':'M')+X_(p[0]).toFixed(1)+' '+Y_(p[1]).toFixed(1)).join(' ');
  const ys=maxV<=10?2:maxV<=25?5:10, xs=(x1-x0)<=20?5:(x1-x0)<=45?10:15;
  let g='';
  for(let v=0;v<=maxV;v+=ys) g+=`<line x1="${ML}" x2="${W-MR}" y1="${Y_(v)}" y2="${Y_(v)}" stroke="var(--border)" stroke-width=".6"/><text x="${ML-4}" y="${Y_(v)+3}" font-size="8" text-anchor="end" fill="var(--t3)">${v}</text>`;
  for(let m=Math.ceil(x0/xs)*xs;m<=x1;m+=xs) g+=`<text x="${X_(m)}" y="${H-5}" font-size="8" text-anchor="middle" fill="var(--t3)">${m}'</text>`;
  const line=(d,col,dash)=>`<path d="${d}" fill="none" stroke="${col}" stroke-width="${dash?1.6:2.2}" ${dash?'stroke-dasharray="4 3"':''} stroke-linejoin="round"/>`;
  return `<svg class="stt-xpc" viewBox="0 0 ${W} ${H}" role="img" aria-label="Running points and expected points">${g}`
    +line(step(series.h.x),hC,true)+line(step(series.a.x),aC,true)+line(step(series.h.p),hC,false)+line(step(series.a.p),aC,false)+`</svg>`
    +`<div class="stt-xpleg"><span>━ points</span><span>╌ xP (running)</span></div>`;
}
function dashXpSectionHtml(){
  const S=dashXpSummary(statPred);
  const title='Expected points (xP)';
  if(!S) return statSection(title,'','<div class="stt-none">The xP model did not load.</div>');
  const {h,a}=S;
  if(!h.shots&&!a.shots) return statSection(title,'','');
  const hC=GAME.homeColor||'#2563eb', aC=GAME.awayColor||'#22c55e';
  const H=tc(GAME.homeTeam||'Home'), A=tc(GAME.awayTeam||'Away');
  const line=(t,nm,col)=>{
    if(!t.n) return `<div class="stt-xpl"><b style="color:${col}">${esc(nm)}</b> ${t.score} (${t.ptsAll}) · no located shots, no xP</div>`;
    const d=Math.round(t.diff*10)/10;
    return `<div class="stt-xpl"><b style="color:${col}">${esc(nm)}</b> ${t.score} (${t.ptsAll}) from <b>${dashXpF(t.xp)}</b> xP · <span class="${d>0?'pos':d<0?'neg':''}">${dashXpSigned(t.diff)}</span>${t.miss?` <small style="color:var(--t3)">(${t.pts} of ${t.ptsAll} pts from modelled shots)</small>`:''}</div>`;
  };
  const row=(lab,hv,av,hw,aw)=>{ const m=Math.max(Math.abs(hw),Math.abs(aw),1e-9);
    return `<div class="stt-row xp"><span class="stt-n">${hv}</span><span class="stt-bar r"><span style="width:${Math.abs(hw)/m*100}%;background:${hC}"></span></span><span class="stt-k">${lab}</span><span class="stt-bar"><span style="width:${Math.abs(aw)/m*100}%;background:${aC}"></span></span><span class="stt-n">${av}</span></div>`; };
  let body=line(h,H,hC)+line(a,A,aC);
  body+=row('xP',dashXpF(h.xp),dashXpF(a.xp),h.xp,a.xp);
  body+=row('Points − xP',h.n?dashXpSigned(h.diff):'—',a.n?dashXpSigned(a.diff):'—',h.n?h.diff:0,a.n?a.diff:0);
  body+=row('xP per shot',h.perShot!=null?h.perShot.toFixed(2):'—',a.perShot!=null?a.perShot.toFixed(2):'—',h.perShot||0,a.perShot||0);
  const cell=c=>c.n?`${c.pts} / ${dashXpF(c.xp)} <small>(${c.n})</small>`:'<small>—</small>';
  const cats=DASH_XP_CATS.filter(([k])=>h.cat[k].n||a.cat[k].n);
  if(cats.length) body+=`<table class="stt-xpt"><tr><th>pts / xP (shots)</th><th></th><th>pts / xP (shots)</th></tr>`
    +cats.map(([k,lab])=>`<tr><td>${cell(h.cat[k])}</td><td class="k">${lab}</td><td>${cell(a.cat[k])}</td></tr>`).join('')+`</table>`;
  body+=dashXpChartSvg(S,hC,aC);
  body+=`<div class="stt-xpn">Model v${esc(S.version)}${S.conv==='sportscode_rot'?' · rotated Sportscode coordinates detected':''} · ${S.miss?S.miss+' shot'+(S.miss>1?'s':'')+' without location/attempt → not in xP':'every shot located'}</div>`;
  return statSection(title,'',body);
}
// ═════════════ END — moved unchanged from dashboard.html ═════════════
return { setContext, giSup, statPeriodNow,
  esc, _tnorm, _statSideMap, statSide, statQOf, statPred, setStatPeriod, tallyOutcome, koWonCount, codeCount, statNav, statSection, statRows, pct, sumKeys, locPitchSvg, locShotGlyph, koPlotY, dashCoordOf, dashXpInvalidate, dashCoordConv, dashXpModel, dashXpLevel, dashShotPts, dashXpAll, dashXpOf, DASH_XP_CATS, dashXpSummary, dashXpF, dashXpSigned, dashXpScale, locEvents, openLocMap, closeLocMap, locSetTeam, renderLocMap, cohPacksLoad, cohPacksStore, cohPackTeam, cohTeamColourDefault, cohImportTeamPack, dashComputeStats, dashBuildStatsCanvas, dashShareStatsCard, dashBuildMomentumCanvas, dashBuildWormCanvas, dashBuildXpWormCanvas, dashMapData, dashMapSvg, dashSvgImg, dashGlyph, dashXpSizeKey, dashBuildMapCanvas, dashBuildShotMixCanvas, dashBuildPossDoughnut, dashBuildKoRetentionCanvas, dashBuildScoreSourceCanvas, dashExportPDF, dashDlBlob, dashTeamHexes, dashTeamSecondary, dashLoadImg, dashHexLum, dashHexMix, dashFileStem, dashBusy, dashBuildMapsImage, dashDownloadMapsImage, dashInfographicData, dashBuildInfographic, dashDownloadInfographic, dashXpChartSvg, dashXpSectionHtml };
}
// the names the dashboard keeps as page globals (its inline handlers and its
// Stats / Events views call them directly)
cohesionGraphics.GLOBALS=["esc","_tnorm","_statSideMap","statSide","statQOf","statPred","setStatPeriod","tallyOutcome","koWonCount","codeCount","statNav","statSection","statRows","pct","sumKeys","locPitchSvg","locShotGlyph","koPlotY","dashCoordOf","dashXpInvalidate","dashCoordConv","dashXpModel","dashXpLevel","dashShotPts","dashXpAll","dashXpOf","DASH_XP_CATS","dashXpSummary","dashXpF","dashXpSigned","dashXpScale","locEvents","openLocMap","closeLocMap","locSetTeam","renderLocMap","cohPacksLoad","cohPacksStore","cohPackTeam","cohTeamColourDefault","cohImportTeamPack","dashComputeStats","dashBuildStatsCanvas","dashShareStatsCard","dashBuildMomentumCanvas","dashBuildWormCanvas","dashBuildXpWormCanvas","dashMapData","dashMapSvg","dashSvgImg","dashGlyph","dashXpSizeKey","dashBuildMapCanvas","dashBuildShotMixCanvas","dashBuildPossDoughnut","dashBuildKoRetentionCanvas","dashBuildScoreSourceCanvas","dashExportPDF","dashDlBlob","dashTeamHexes","dashTeamSecondary","dashLoadImg","dashHexLum","dashHexMix","dashFileStem","dashBusy","dashBuildMapsImage","dashDownloadMapsImage","dashInfographicData","dashBuildInfographic","dashDownloadInfographic","dashXpChartSvg","dashXpSectionHtml"];
if(typeof module!=='undefined'&&module.exports) module.exports={cohesionGraphics, cohGfxPrepare, cohGfxApplyVisualSync, cohGfxSortEvents, cohGfxFillTeams, cohGfxTitleCase, cohGfxVisualSyncPeriod};
