/* COHESION — Analysis › PLAYER DASHBOARD and PANEL PRINT-OUT  (MOCKUP: layout, styling and KPIs)
 *
 * Loaded by analysis.html before its inline script. Every figure is computed by the engine the other Analysis tabs
 * already use — nothing is counted twice and nothing is estimated:
 *   · shots, scores, 1-pt / 2-pt / goals, shot attempts, assists (cohShotAssist), xP (cohesion-xp.js): the Players tab's
 *     pyCompute → pyPlayers (the players table), so a total here = the table's total for the same games;
 *   · games played, minutes (cohesion-minutes.js), the squad and its average: the PLAYER PROFILE's pfCompute / pfSquad;
 *   · kickout targets / won: the Players tab's kickout rule (pyKoWho on tkGameKos — the team's OWN kickouts naming him);
 *   · turnovers won / lost: tvGameTos (the Turnover tab's in-play rows), the player on the row under HIS team
 *     (cohEventPlayers: the winning team's player won it, the losing team's player lost it — tvWhoTxt's rule);
 *   · fouls: ssFoulRows (the Defending tab's foul rows), cards: ssIsCard + 'Card Outcomes', tackles: ssIsTackle rows,
 *     possessions: 'Game Involvement Outcomes' = Possession (pyInvolvement's rows), each naming a player of the team;
 *   · kickout chains (print-out): tkGameKos's WHAT FOLLOWED (the tagged shot source after each kickout).
 * A figure the games cannot supply is "n/a" with the reason (pdAvail), never 0.
 *
 * Pure helpers first (headlessly tested: cohesion-tests analysis/test_player_dash.js), then the strings, then the wiring.
 * Globals are prefixed pd (dashboard) and pp (print-out).
 */

// ═════ shared: seasons, ranges, colours ═════
function pdSeasonOf(g){ const y=ssYearOf(g||{}); return /^\d{4}$/.test(y)?y:(/^\d{4}$/.test(String((g&&g.season)||''))?String(g.season):''); }
function pdTeamList(T){ return ovTeamGames(typeof GAMES!=='undefined'?GAMES:[], T); }      // newest first; the shared filter bar does not apply
function pdSeasons(list){ return [...new Set(list.map(pdSeasonOf).filter(Boolean))].sort().reverse(); }
function pdComps(list, season){ return [...new Set(list.filter(g=>!season||pdSeasonOf(g)===season).map(g=>String(g.competition||'').trim()).filter(Boolean))].sort(); }
// a range: {kind:'last5'|'last10'|'season'|'comp'|'game', season, comp, gid} → the games (newest first)
function pdRangeGames(list, r){
  r=r||{}; const L=list||[];
  if(r.kind==='last5') return L.slice(0,5);
  if(r.kind==='last10') return L.slice(0,10);
  if(r.kind==='season') return L.filter(g=>pdSeasonOf(g)===r.season);
  if(r.kind==='comp') return L.filter(g=>pdSeasonOf(g)===r.season&&String(g.competition||'').trim()===r.comp);
  if(r.kind==='game') return L.filter(g=>g.id===r.gid);
  if(r.kind==='opp') return L.filter(g=>pdIsOpp(g, r.opp));   // AGAINST THE OPPOSITION: every uploaded game v that team
  return [];
}
function pdIsOpp(g, opp){ const o=String(opp||'').toUpperCase().trim(); return !!o&&(ssUC(g.homeTeam)===o||ssUC(g.awayTeam)===o); }
// the opponents of team T in its games (most games first, then by name)
function pdOpps(list, T){ const c={}; (list||[]).forEach(g=>{ const o=ssUC(g.homeTeam)===T?ssUC(g.awayTeam):ssUC(g.homeTeam); if(o) c[o]=(c[o]||0)+1; }); return Object.keys(c).sort((a,b)=>c[b]-c[a]||a.localeCompare(b)); }
// the same kind of range in the previous season: {games, season, reason}
function pdPrevRange(list, r, games){
  const cur=(games||[]).map(pdSeasonOf).filter(Boolean)[0]||(r&&r.season)||'';
  if(!/^\d{4}$/.test(cur)) return {games:[], season:'', reason:'the season of these games is not known'};
  // a single game: against the player's OWN average per game over that game's season (savg)
  if(r.kind==='game'||r.kind==='opp'){ const S=(list||[]).filter(g=>pdSeasonOf(g)===cur); return {games:S, season:cur, savg:true, reason:S.length?'':'no '+cur+' games'}; }   // v an opponent: his own average over the season of the latest game v them
  const prev=String(+cur-1), P=(list||[]).filter(g=>pdSeasonOf(g)===prev);
  let out=[];
  if(r.kind==='last5') out=P.slice(0,5); else if(r.kind==='last10') out=P.slice(0,10);
  else if(r.kind==='season') out=P; else if(r.kind==='comp') out=P.filter(g=>String(g.competition||'').trim()===r.comp);
  return {games:out, season:prev, reason:out.length?'':'no '+(r.kind==='comp'?r.comp+' ':'')+'games uploaded for '+prev};
}
function pdCompShort(c){ return String(c||'').split(/\s+/).map(w=>/^[A-Z0-9]{2,}$/.test(w)?w:w.split('-').map(x=>/^\d+$/.test(x)?x:x.charAt(0).toUpperCase()).join('')).join(''); }
function pdRoundShort(r){ const s=String(r||'').trim(), m=/(\d+[A-Z]?)\s*$/i.exec(s);
  if(/^preliminary quarter/i.test(s)) return 'PQF'; if(/quarter/i.test(s)) return 'QF'; if(/semi/i.test(s)) return 'SF'; if(/^final$/i.test(s)) return 'F';
  if(/^group/i.test(s)&&m) return 'G'+m[1]; if(/^round/i.test(s)&&m) return 'R'+m[1]; return s.slice(0,4); }
function pdOppShort(n){ return String(n||'').trim().slice(0,3).toUpperCase(); }
function pdRangeTxt(r, games){
  const n=(games||[]).length, gl=n+' game'+(n===1?'':'s');
  if(r.kind==='last5'||r.kind==='last10'){ const S=pdSeasons(games||[]); return 'Last '+(r.kind==='last5'?5:10)+' games'+(S.length?' · '+S.slice().reverse().join('–'):'')+(n<(r.kind==='last5'?5:10)?' ('+gl+')':''); }
  if(r.kind==='season') return r.season+' season · '+gl;
  if(r.kind==='comp') return r.season+' '+r.comp+' · '+gl;
  if(r.kind==='game'){ const g=(games||[])[0]; return g?(g.title||'')+' · '+[g.competition, g.round].filter(Boolean).join(' '):'No game'; }
  if(r.kind==='opp') return 'v '+titleCase(r.opp)+' · '+gl+(games&&games.length?' ('+pdSeasons(games).slice().reverse().join('–')+')':'');
  return gl;
}
// the team's colours: COHESION's stored palette (crests/index.js COHESION_TEAM_COLOURS — cohTeamColourDefault's source) or the
// county list (crests/counties.js), else
// the colour saved on the team's most recent game (ssTeamColor). On screen through cohTeamInk (readable on the dark page).
function pdColours(T){
  const C=(typeof window!=='undefined'&&window.COHESION_TEAM_COLOURS)||{}, sl=typeof cohCrestSlug==='function'?cohCrestSlug(T):String(T||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
  // clubs: the stored palette; counties: the county list (crests/counties.js — read HERE only, never merged into the palette)
  const CC=(typeof window!=='undefined'&&window.COHESION_COUNTY_COLOURS)||{};
  const pal=C[sl]||CC[sl]||null, g=(typeof ssTeamColor==='function')?ssTeamColor(T):null;
  const primary=(pal&&pal.primary)||(g&&g.hex)||'#4fc3f7', secondary=(pal&&pal.secondary)||null;
  // text and marks on the dark page: the same hue lifted to 4.5:1 (WCAG text) against the panels
  const ink=(c,bg)=>(typeof window!=='undefined'&&window.cohTeamInk)?window.cohTeamInk(c, {theme:'dark', bg:bg||'#1b1b25', min:4.5}):c;
  // the HIGHLIGHT: the primary, unless it is black or white (Sligo, Kilkenny, Kildare, Tyrone …) and the secondary is a real
  // colour — then the secondary; black with no colour beside it falls back to the other (white). Lifted to 4.5:1 on the panels.
  const hi=pdAchro(primary)&&secondary&&(!pdAchro(secondary)||pdLum(primary)<0.15)?secondary:primary, lo=hi===primary?(secondary||primary):primary;
  const a=ink(hi), b=ink(lo);
  // the print-out's header bar on white paper: the primary, unless it is (near) white — then the secondary, else charcoal
  const bar=pdLum(primary)>0.85?(secondary&&pdLum(secondary)<0.85?secondary:'#2b2b2b'):primary, tag0=bar===primary?(secondary||'#ffffff'):primary;
  const tag=pdLum(tag0)>0.9?'#e6e9e6':tag0;   // a white position block would vanish on the paper: a pale grey instead (Cork, Offaly, Derry …)
  // BANDS — decoration only (the name underline, the print-out cover stripe, a thin edge on the print-out bars): the stored
  // colours in order, with the optional third (Carlow, Offaly). The third is never a highlight, a bar, an arrow or a marker.
  const tertiary=(pal&&pal.tertiary)||null, bands=[primary].concat(secondary?[secondary]:[], tertiary?[tertiary]:[]);
  return {primary:hi, secondary:lo, a, b, bar, tag, bands, tertiary, stored:{primary, secondary, tertiary}, from:pal?'palette':g?'game':'default'};
}
// a decorative stripe of the team's bands (an outline keeps a white or black band visible on either background)
function pdStripeHTML(col, cls){ return `<div class="pd-stripe ${cls||''}" aria-hidden="true">${col.bands.map(c=>`<i style="background:${ssEsc(c)}"></i>`).join('')}</div>`; }
function pdRgb(h){ const m=/^#?([0-9a-f]{6})$/i.exec(String(h||'').trim()); if(!m) return [128,128,128]; const n=parseInt(m[1],16); return [n>>16&255,n>>8&255,n&255]; }
function pdLum(h){ const c=pdRgb(h); return (0.2126*c[0]+0.7152*c[1]+0.0722*c[2])/255; }
function pdAchro(h){ const c=pdRgb(h); return (Math.max(...c)-Math.min(...c))/255<0.15; }   // black, white or grey

// ═════ per-player figures over a set of games ═════
// pdExtras: what the shot table does not hold — kickout targets, turnovers, fouls, cards, tackles, possessions — per player key,
// plus what the games CAN supply (A: rows seen / rows naming one of the team's players).
function pdExtras(T, games, bundleOf, R){
  const m=new Map(), get=k=>{ let r=m.get(k); if(!r){ r={koT:0, koW:0, toW:0, toL:0, fouls:0, yel:0, blk:0, red:0, tck:0, poss:0}; m.set(k, r); } return r; };
  const A={ownKos:0, koNamed:0, toRows:0, toNamed:0, foulRows:0, foulNamed:0, cardRows:0, cardNamed:0, tckRows:0, tckNamed:0, possRows:0, sheetGames:0, n:0};
  (R&&R.kos||[]).forEach(k=>{ if(k.team!==T) return; A.ownKos++; const w=k.who; if(!w||w.team!==T||!w.key) return; A.koNamed++; const r=get(w.key); r.koT++; if(w.won) r.koW++; });
  const mine=(e, meta)=>(typeof cohEventPlayers==='function'?cohEventPlayers(e, meta):[]).filter(p=>ssUC(p.team||e.team)===T&&pyKey(p.name));
  ovTeamGames(games, T).forEach(g=>{
    const b=bundleOf(g.id); if(!b||!b.meta||!Array.isArray(b.events)) return; A.n++;
    const meta=b.meta, ev=b.events, H=ssUC(meta.homeTeam), O=T===H?ssUC(meta.awayTeam):H;
    const giSup=(typeof cohGiSupersededFn==='function')?cohGiSupersededFn(ev):()=>false, skip=e=>giSup(e)||(typeof cohGiIsCompanion==='function'&&cohGiIsCompanion(e));
    if(meta.rosters&&typeof cohMinutesGame==='function'){ const M=pfMinutes(meta, ev, T); if(M&&M.ok) A.sheetGames++; }
    // turnovers (the in-play rows of tvGameTos): won by the winning team's player, lost by the losing team's player
    const TV=tvGameTos(meta, ev);
    (TV?TV.tos:[]).forEach(x=>{ if(x.winner!==T&&x.loser!==T) return; A.toRows++;
      const ps=(typeof cohEventPlayers==='function'?cohEventPlayers(x.e, meta):[]); let named=false;
      ps.forEach(p=>{ const t=ssUC(p.team||''), k=pyKey(p.name); if(!k||t!==T) return; named=true; const r=get(k); if(x.winner===T) r.toW++; else r.toL++; });
      if(named) A.toNamed++; });
    // fouls conceded by T (ssFoulRows' side 'T')
    ssFoulRows(ev, T, O, skip).forEach(r=>{ if(r.side!=='T') return; A.foulRows++; const ps=mine(r.e, meta); if(ps.length){ A.foulNamed++; get(pyKey(ps[0].name)).fouls++; } });
    ev.forEach(e=>{ if(!e||skip(e)) return;
      if(ssIsCard(e)){ const ps=mine(e, meta); if(!ps.length&&!ssSideOf(e,T)) return; A.cardRows++; if(!ps.length) return; A.cardNamed++;
        const K=ssUC(ssLblCI(e,['Card Outcomes','Card Outcome','Card'])), r=get(pyKey(ps[0].name)); if(/YELLOW/.test(K)) r.yel++; else if(/BLACK/.test(K)) r.blk++; else if(/RED/.test(K)) r.red++; return; }
      if(ssIsTackle(e)){ if(!ssSideOf(e,T)) return; A.tckRows++; const ps=mine(e, meta); if(ps.length){ A.tckNamed++; get(pyKey(ps[0].name)).tck++; } return; }
      const iv=(typeof cohLabelValues==='function')?cohLabelValues(e, 'Game Involvement Outcomes'):[];
      if(iv.length){ const n=iv.filter(v=>/^possession$/i.test(String(v).trim())).length; if(!n) return;
        let who=null; if(e.playerRow||(!e.team&&!e.player)) who=cohPlayerRowOf(e, cohPlayerIndex(ev, meta)); else if(e.player) who={name:e.player, team:ssUC(cohPlayerTeam(e, meta))};
        if(!who||ssUC(who.team)!==T||!pyKey(who.name)) return; A.possRows+=n; get(pyKey(who.name)).poss+=n; }
    });
  });
  return {byKey:m, A};
}
// what the games can supply, per metric: '' = available, else the n/a reason
function pdAvail(R, F, X){
  const A=X.A, n=R.n, gl=n===1?'this game':'these '+n+' games';
  const xpOk=R.shots.some(s=>s.xp!=null);
  const rows=(rows, named, what)=>!rows?'no '+what+' rows in '+gl:!named?rows+' '+what+' row'+(rows===1?'':'s')+' in '+gl+', none names a '+R.team+' player':'';
  return {
    xp:xpOk?'':'no shot in '+gl+' has a pitch location, which xP needs',
    fin:xpOk?'':'no shot in '+gl+' has a pitch location, which xP needs',
    min:F&&F.sheetGames?'':'no team sheet in '+gl+', so minutes are not known',
    koT:A.ownKos?(A.koNamed?'':A.ownKos+' '+R.team+' kickouts, none names a player'):'no '+R.team+' kickouts in '+gl,
    koW:A.ownKos?(A.koNamed?'':A.ownKos+' '+R.team+' kickouts, none names a player'):'no '+R.team+' kickouts in '+gl,
    toW:rows(A.toRows, A.toNamed, 'in-play turnover'), toL:rows(A.toRows, A.toNamed, 'in-play turnover'),
    fouls:rows(A.foulRows, A.foulNamed, 'foul'), tck:rows(A.tckRows, A.tckNamed, 'tackle'),
    yel:rows(A.cardRows, A.cardNamed, 'card'), blk:rows(A.cardRows, A.cardNamed, 'card'), red:rows(A.cardRows, A.cardNamed, 'card'),
    poss:A.possRows?'':'no Possession involvement rows in '+gl,
  };
}
// THE KPI LIST. g = group, low = lower is better (the arrow's colour flips), kind: 'n' count (compared per game), 'r' a rate
// (compared as it is), 'x' a decimal. pf = the PLAYER PROFILE metric it is (its squad average is pfSquad's).
const PD_KPIS=[
  {k:'one', l:'1-Points', g:'sc', kind:'n', pf:'one'}, {k:'two', l:'2-Points', g:'sc', kind:'n', pf:'two'}, {k:'goals', l:'Goals', g:'sc', kind:'n', pf:'goals'},
  {k:'pts', l:'Total points', g:'sc', kind:'n', pf:'pts'}, {k:'ppg', l:'Points per game', g:'sc', kind:'r'}, {k:'shots', l:'Shot attempts', g:'sc', kind:'n', pf:'shots'},
  {k:'gatt', l:'Goal attempts', g:'sc', kind:'n'}, {k:'pct', l:'Shooting %', g:'sc', kind:'r', pf:'pct'}, {k:'xp', l:'xP', g:'sc', kind:'x', pf:'xp'}, {k:'fin', l:'Finishing v xP', g:'sc', kind:'r'},
  {k:'assists', l:'Score assists', g:'pm', kind:'n', pf:'assists'}, {k:'astShots', l:'Shot assists', g:'pm', kind:'n'}, {k:'koT', l:'Kickout targets', g:'pm', kind:'n'}, {k:'koW', l:'Kickouts won', g:'pm', kind:'n'}, {k:'poss', l:'Possessions', g:'pm', kind:'n'},
  {k:'toW', l:'Turnovers won', g:'wr', kind:'n'}, {k:'toL', l:'Turnovers lost', g:'wr', kind:'n', low:true}, {k:'tck', l:'Tackles', g:'wr', kind:'n'}, {k:'fouls', l:'Fouls conceded', g:'wr', kind:'n', low:true},
  {k:'gp', l:'Games', g:'gt', kind:'n', pf:'gp', noPg:true}, {k:'min', l:'Minutes', g:'gt', kind:'n', pf:'min', noPg:true}, {k:'yel', l:'Yellow cards', g:'gt', kind:'n', low:true}, {k:'blk', l:'Black cards', g:'gt', kind:'n', low:true}, {k:'red', l:'Red cards', g:'gt', kind:'n', low:true},
];
const PD_GROUPS=[['sc','SCORING'],['pm','PLAYMAKING'],['wr','WORK RATE / DEFENCE'],['gt','GAME TIME & DISCIPLINE']];
function pdKpi(k){ return PD_KPIS.find(x=>x.k===k)||null; }
// one player's raw figures (null = he did not play in these games)
function pdRow(S, key){
  const f=S.F.byKey.get(key); if(!f) return null;
  const p=S.R.players.find(x=>x.key===key)||null, x=S.X.byKey.get(key)||{}, mine=S.R.shots.filter(s=>s.pk===key);
  const o={key, name:f.name, gp:f.gp, gpMin:f.gpMin, min:f.min, line:f.line,
    one:p?p.one:0, two:p?p.two:0, goals:p?p.goals:0, pts:p?p.pts:0, total:p?p.total:0, shots:p?p.shots:0, gatt:mine.filter(s=>s.att==='G').length,
    pct:p?p.pct:null, xp:p?p.xp:null, xpShots:p?p.xpShots:0, xpPts:p?p.xpPts:0, assists:p?p.assists:0, astShots:p?p.assistShots:0};
  o.ppg=o.gp?o.pts/o.gp:null; o.fin=o.xp!=null?o.xpPts-o.xp:null;
  ['koT','koW','toW','toL','fouls','yel','blk','red','tck','poss'].forEach(k=>{ o[k]=x[k]||0; });
  return o;
}
// the figure a tile shows (null = n/a) and the figure it compares (per game for a count)
function pdVal(S, row, k){ if(!row) return null; if(S.na[k]) return null; const v=row[k]; return v==null?null:v; }
function pdCmpVal(S, row, k){
  const d=pdKpi(k), v=pdVal(S, row, k); if(v==null) return null;
  if(d.kind==='n'&&!d.noPg) return row.gp?v/row.gp:null;
  return v;
}
// squad average on the comparison basis: the PLAYER PROFILE's own (pfSquad, 'pg') for its metrics; the same rule —
// the mean over the squad players who have the figure — for the rest
function pdSquadAvg(S, k){
  if(S.na[k]) return null;
  const d=pdKpi(k);
  if(d.pf==='pct') return S.sq.pg.pct.avg;
  if(d.pf&&!d.noPg) return S.sq.pg[d.pf].avg;
  if(d.pf==='gp'||d.pf==='min') return S.sq.tot[d.pf].avg;
  if(k==='fin') return S.sq.tot.fin.avg;
  const v=S.F.players.map(p=>pdCmpVal(S, S.rows.get(p.key), k)).filter(x=>x!=null&&isFinite(x));
  return v.length?v.reduce((a,x)=>a+x,0)/v.length:null;
}
// everything for team T over `games`: {R (pyCompute), F (pfCompute), X (pdExtras), na (n/a reasons), rows (Map key → pdRow), sq (pfSquad tot / pg)}
const PD_CACHE=new Map();
function pdSummaries(T, games, bundleOf){
  const list=ovTeamGames(games, T), sig=T+'|'+list.map(g=>g.id+':'+((bundleOf(g.id)||{}).events||[]).length).join(',');
  if(PD_CACHE.has(sig)) return PD_CACHE.get(sig);
  const R=pyCompute(T, list, bundleOf), F=pfCompute(T, list, bundleOf, R), X=pdExtras(T, list, bundleOf, R), na=pdAvail(R, F, X);
  const S={T, games:list, R, F, X, na, rows:new Map(), sq:{tot:pfSquad(F,'tot'), pg:pfSquad(F,'pg')}};
  F.players.forEach(p=>S.rows.set(p.key, pdRow(S, p.key)));
  if(PD_CACHE.size>60) PD_CACHE.clear();
  PD_CACHE.set(sig, S); return S;
}
// the tile comparison: {pct, tone, ref, txt} — vs 'prev' (the same player, previous-season range) or 'squad' (the squad average)
function pdCompare(k, S, row, mode, P, prow){
  const d=pdKpi(k), v=pdCmpVal(S, row, k);
  if(v==null) return {pct:null, tone:'na', txt:S.na[k]?'':'n/a'};
  let ref=null, why='';
  if(mode==='squad'){ ref=pdSquadAvg(S, k); if(ref==null) why='no squad average'; }
  else { if(!P||!P.games.length) why=P&&P.reason?P.reason:'no previous season';
    else if(P.S.na[k]) why='n/a in '+P.season;
    else if(!prow) why='did not play in '+P.season;
    else if(P.savg&&k==='gp') return {pct:null, tone:'na', txt:'one game'};   // a game against a season: games played is not a comparison
    else if(P.savg&&k==='min'){ if(prow.min!=null&&prow.gp) ref=prow.min/prow.gp; else why='n/a in '+P.season; }   // minutes: this game v his minutes per game
    else { ref=pdCmpVal(P.S, prow, k); if(ref==null) why='n/a in '+P.season; } }
  if(ref==null) return {pct:null, tone:'na', txt:why||'n/a'};
  const x=pfVs(v, ref), tone=x.tone==='pos'?(d.low?'neg':'pos'):x.tone==='neg'?(d.low?'pos':'neg'):x.tone;
  return {pct:x.pct, tone, ref, dir:x.pct==null?'':x.pct>0?'up':x.pct<0?'down':'', txt:(x.pct==null?(x.tone==='mid'?'=':'n/a'):(x.pct>0?'▲ ':x.pct<0?'▼ ':'= ')+(Math.abs(x.pct)>=100?Math.round(Math.abs(x.pct)):Math.abs(x.pct).toFixed(0))+'%')+' '+(mode==='squad'?'vs squad avg':P.savg?'vs his '+P.season+' average':'vs '+P.season)};
}
// RADAR: each axis 0–100 against the squad (documented in the footnote). An axis the data cannot supply is left out.
const PD_AXES=[
  {k:'ppg', l:'Scoring', how:'points per game'}, {k:'pct', l:'Shooting %', how:'scores ÷ shots', abs:true}, {k:'shots', l:'Shot volume', how:'shots per game'},
  {k:'astShots', l:'Playmaking', how:'shot assists per game'}, {k:'koW', l:'Kickouts', how:'kickouts won per game'}, {k:'toW', l:'Work rate', how:'turnovers won per game'},
  {k:'fouls', l:'Discipline', how:'fouls conceded per game, fewer = higher', inv:true}, {k:'min', l:'Game time', how:'minutes per game with a team sheet'},
];
function pdRadar(S, key){
  const row=S.rows.get(key), axes=[], left=[];
  PD_AXES.forEach(a=>{
    if(S.na[a.k]){ left.push(a.l+' ('+S.na[a.k]+')'); return; }
    const val=r=>{ if(!r) return null; if(a.k==='min') return r.min!=null&&r.gpMin?r.min/r.gpMin:null; return pdCmpVal(S, r, a.k); };   // minutes ÷ the games WITH minutes (a team sheet)
    const all=S.F.players.map(p=>val(S.rows.get(p.key))).filter(v=>v!=null&&isFinite(v));
    if(!all.length){ left.push(a.l+' (no player has the figure)'); return; }
    const max=Math.max(...all), mean=all.reduce((x,y)=>x+y,0)/all.length, v=val(row);
    const sc=x=>x==null?null:a.abs?Math.max(0,Math.min(100,x)):a.inv?(max>0?(1-x/max)*100:100):(max>0?x/max*100:0);
    axes.push({k:a.k, l:a.l, how:a.how, v, avg:mean, max, p:sc(v), t:sc(mean), abs:!!a.abs, inv:!!a.inv});
  });
  return {axes, left};
}
// per-game trend: the player's figure in each game of the range, oldest → newest (null = did not play / n/a)
const PD_TREND=[['pts','Points'],['total','Scores'],['shots','Shot attempts'],['pct','Shooting %'],['one','1-Points'],['two','2-Points'],['goals','Goals'],['assists','Score assists'],['astShots','Shot assists'],['koT','Kickout targets'],['koW','Kickouts won'],['xp','xP'],['toW','Turnovers won'],['fouls','Fouls conceded']];
function pdTrend(T, games, key, k, bundleOf){
  return ovTeamGames(games, T).slice().reverse().map(g=>{ const S=pdSummaries(T, [g], bundleOf), row=S.rows.get(key);
    const m=ovMatch(g, null, null, T);
    return {gid:g.id, opp:m.opp, round:g.round||'', comp:g.competition||'', season:pdSeasonOf(g), played:!!row, v:row?pdVal(S, row, k):null, na:S.na[k]||''}; });
}
// Player v squad bars (per game) and the discipline / possession boxes
// Player v squad: per-game figures only (the tiles hold the totals, Points per game and Shooting % — no figure twice)
const PD_BARS=[['total','Scores per game'],['shots','Shots per game'],['assists','Score assists per game'],['astShots','Shot assists per game'],['koT','Kickout targets per game'],['koW','Kickouts won per game'],['toW','Turnovers won per game'],['fouls','Fouls per game']];

// ═════ dashboard strings ═════
function pdNum(k, v){
  if(v==null) return 'n/a';
  const d=pdKpi(k)||{};
  if(k==='pct') return Math.round(v)+'%';
  if(k==='ppg') return v.toFixed(2);
  if(k==='xp') return v.toFixed(1);
  if(k==='fin') return mrSigned(v);
  if(k==='min') return String(Math.round(v));
  return d.kind==='n'?String(v):String(Math.round(v*100)/100);
}
function pdIcon(g){ const P={sc:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', pm:'<path d="M4 18 L10 10 L14 14 L20 6"/><path d="M15 6h5v5"/>', wr:'<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/>', gt:'<circle cx="12" cy="13" r="7"/><path d="M12 9v4l3 2M9 3h6"/>'};
  return `<svg class="pd-ic" viewBox="0 0 24 24" aria-hidden="true">${P[g]||''}</svg>`; }
function pdTileHTML(d, S, row, mode, P, prow){
  const v=pdVal(S, row, d.k), na=S.na[d.k], c=v==null?null:pdCompare(d.k, S, row, mode, P, prow);
  // Minutes over a range where only some games have a team sheet: say from how many, so it is not read as the range's minutes
  const sub=d.k==='min'&&v!=null&&row&&row.gpMin<row.gp?`<div class="pd-tsub">${row.gpMin} of ${row.gp} games with a team sheet</div>`:'';
  const tip=na?'n/a — '+na:(v==null?'n/a — he did not play in these games':'');
  return `<div class="pd-tile${v==null?' na':''}" data-k="${d.k}"${tip?` title="${ssEsc(tip)}"`:''}>${pdIcon(d.g)}<div class="pd-tl">${ssEsc(d.l)}</div><div class="pd-tv">${ssEsc(pdNum(d.k, v))}</div>${sub}`
    +`<div class="pd-tc ${c?c.tone:'na'}"${c&&c.ref!=null?` title="${ssEsc(pdCmpTxt(d, pdCmpVal(S,row,d.k))+' v '+pdCmpTxt(d, c.ref)+(mode==='squad'?' (squad average)':' ('+P.season+')'))}"`:''}>${ssEsc(v==null?(na?'ⓘ no data — see note':'did not play'):c.txt)}</div></div>`;
}
// the compared figure as text: a count compared per game shows two decimals
function pdCmpTxt(d, v){ if(v==null) return 'n/a'; return d.kind==='n'&&!d.noPg?(Math.round(v*100)/100).toFixed(2)+' per game':pdNum(d.k, v);
}
function pdHeadHTML(V){
  const {T, row, S, col, sheet, rangeTxt}=V, name=row?row.name:V.name, w=String(name||'').trim().split(/\s+/), first=w.length>1?w.slice(0,-1).join(' '):'', last=w.length>1?w[w.length-1]:w[0]||'';
  const crest=typeof cohCrestSrc==='function'?cohCrestSrc(T):null;
  const crestH=crest?`<img class="pd-crest" src="${ssEsc(crest)}" alt="${ssEsc(T)} crest">`:`<span class="pd-crest pd-crest0" title="${ssEsc('No crest stored for '+T)}">${ssEsc(pdOppShort(T))}</span>`;
  const shirt=sheet&&sheet.no!==''&&sheet.no!=null?'#'+sheet.no:'No. n/a', pos=sheet&&sheet.pos?sheet.pos:'Position n/a';
  const sheetTip=sheet?'From the team sheet of '+sheet.game:'n/a — no team sheet in these games lists him';
  return `<div class="pd-head"><div class="pd-photo">${cohPlayerBadgeHTML(T, name, {cls:'pd-badge', color:col.primary})}</div>`
    +`<div class="pd-who"><h2><span>${ssEsc(first)}</span> <b>${ssEsc(last)}</b></h2>${pdStripeHTML(V.col, 'pd-uline')}<div class="pd-team">${crestH}<div><div class="pd-tn">${ssEsc(titleCase(T))}</div><div class="pd-sheet" title="${ssEsc(sheetTip)}">${ssEsc(shirt+' · '+pos)}</div></div></div></div>`
    +`<div class="pd-range"><span>RANGE</span><b>${ssEsc(rangeTxt)}</b></div></div>`;
}
function titleCase(s){ return String(s||'').toLowerCase().replace(/(^|[\s'-])(\S)/g,(m,a,b)=>a+b.toUpperCase()); }
function pdRadarSVG(Rd, col, name){
  const A=Rd.axes, n=A.length; if(n<3) return `<div class="tt-empty">n/a — fewer than three axes have data${Rd.left.length?' ('+ssEsc(Rd.left.join('; '))+')':''}.</div>`;
  const W=360, H=330, cx=W/2, cy=H/2+4, r=112, ang=i=>-Math.PI/2+i*2*Math.PI/n, pt=(i,v)=>[cx+Math.cos(ang(i))*r*v/100, cy+Math.sin(ang(i))*r*v/100];
  let h=`<svg class="pd-radar" viewBox="0 0 ${W} ${H}" role="img" aria-label="${ssEsc(name+' against the team average: '+A.map(a=>a.l+' '+(a.p==null?'n/a':Math.round(a.p))).join(', '))}">`;
  [25,50,75,100].forEach(v=>{ h+=`<polygon points="${A.map((a,i)=>pt(i,v).map(x=>x.toFixed(1)).join(',')).join(' ')}" class="pd-rg"/>`; });
  A.forEach((a,i)=>{ const [x,y]=pt(i,100), [lx,ly]=pt(i,124), anc=Math.abs(lx-cx)<8?'middle':lx<cx?'end':'start';
    h+=`<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="pd-rg"/><text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anc}" class="pd-rl">${ssEsc(a.l)}<tspan x="${lx.toFixed(1)}" dy="13" class="pd-rv">(${a.p==null?'n/a':Math.round(a.p)})</tspan></text>`; });
  const poly=(k,cls,st)=>`<polygon points="${A.map((a,i)=>pt(i,a[k]==null?0:a[k]).map(x=>x.toFixed(1)).join(',')).join(' ')}" class="${cls}" ${st}/>`;
  h+=poly('t','pd-rt','')+poly('p','pd-rp',`style="fill:${ssEsc(col.a)};stroke:${ssEsc(col.a)}"`);
  A.forEach((a,i)=>{ if(a.p==null) return; const [x,y]=pt(i,a.p); h+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" style="fill:${ssEsc(col.a)}"/>`; });
  return h+'</svg>';
}
function pdTrendSVG(rows, k, col){
  const pts=rows.filter(r=>r.v!=null); if(!rows.length) return '<div class="tt-empty">No games.</div>';
  if(!pts.length) return `<div class="tt-empty">${ssEsc('n/a — '+(rows[0].na||'he has no figure in these games'))}</div>`;
  const W=Math.max(380, 46+rows.length*38), H=236, L=34, Rr=14, Tp=22, B=42, max=Math.max(1, ...pts.map(r=>r.v));
  const step=k==='pct'?25:[0.25,0.5,1,2,2.5,5,10,20,25,50,100].find(s=>max*1.12/4<=s)||Math.ceil(max/4), top=k==='pct'?100:step*4;
  const X=i=>L+(rows.length===1?(W-L-Rr)/2:i*(W-L-Rr)/(rows.length-1)), Y=v=>Tp+(H-Tp-B)*(1-v/top);
  let h=`<svg class="pd-trend" viewBox="0 0 ${W} ${H}" style="min-width:${W}px" preserveAspectRatio="xMinYMid meet" role="img" aria-label="${ssEsc('Per game, oldest to newest: '+rows.map(r=>(r.v==null?'n/a':pdNum(k,r.v))).join(', '))}">`;
  for(let i=0;i<=4;i++){ const v=top*i/4, y=Y(v); h+=`<line x1="${L}" x2="${W-Rr}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="pd-tg"/><text x="${L-6}" y="${(y+4).toFixed(1)}" text-anchor="end" class="pd-ta">${k==='pct'?Math.round(v):(Math.round(v*100)/100)}</text>`; }
  let seg=[], path='';
  rows.forEach((r,i)=>{ if(r.v==null){ if(seg.length) path+='M'+seg.join('L'); seg=[]; return; } seg.push(X(i).toFixed(1)+' '+Y(r.v).toFixed(1)); }); if(seg.length) path+='M'+seg.join('L');
  h+=`<path d="${path}" fill="none" style="stroke:${ssEsc(col.a)}" stroke-width="2.4"/>`;
  const multi=new Set(rows.map(r=>r.season)).size>1;   // a range across two seasons: the round carries the year ('25)
  rows.forEach((r,i)=>{ const x=X(i);
    h+=`<text x="${x.toFixed(1)}" y="${H-B+16}" text-anchor="middle" class="pd-ta">${ssEsc(pdRoundShort(r.round)+(multi&&r.season?' ’'+r.season.slice(2):''))}</text><text x="${x.toFixed(1)}" y="${H-B+29}" text-anchor="middle" class="pd-ta">v ${ssEsc(pdOppShort(r.opp))}</text>`;
    if(r.v==null){ h+=`<text x="${x.toFixed(1)}" y="${(H-B-6).toFixed(1)}" text-anchor="middle" class="pd-tdnp">${r.played?'n/a':'–'}</text>`; return; }
    const y=Y(r.v); h+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" style="fill:${ssEsc(col.a)}"/>`+(r.hl?`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="none" stroke-width="2" style="stroke:${ssEsc(col.b)}"/>`:`<text x="${x.toFixed(1)}" y="${(y-9).toFixed(1)}" text-anchor="middle" class="pd-tv2">${ssEsc(pdNum(k, r.v))}</text>`); });
  return h+'</svg>';
}
function pdScoringHTML(row, S, col){
  if(!row) return '<div class="tt-empty">n/a</div>';
  const a=row.one, b=row.two*2, c=row.goals*3, tot=a+b+c, team=S.R.shots.reduce((x,s)=>x+(s.v>0?s.v:0),0);
  if(!tot) return `<div class="tt-empty">No scores in these games.</div>`;
  const seg=(n, pts, lbl, cls)=>pts?`<div class="pd-sb ${cls}" style="flex:${pts} 1 0" title="${ssEsc(lbl+': '+n+' = '+pts+' pts')}"><b>${Math.round(pts/tot*100)}%</b><span>${ssEsc(lbl)}</span></div>`:'';
  const R=44, C=2*Math.PI*R, sh=team?tot/team:0;
  return `<div class="pd-score"><div class="pd-sbar">${seg(row.one, a, '1-pt', 'one')}${seg(row.two, b, '2-pt', 'two')}${seg(row.goals, c, 'Goals', 'gl')}</div>`
    +`<svg class="pd-ring" viewBox="0 0 110 110" role="img" aria-label="${ssEsc(Math.round(sh*100)+'% of '+S.T+'’s points')}"><circle cx="55" cy="55" r="${R}" class="pd-rgb"/><circle cx="55" cy="55" r="${R}" fill="none" stroke-width="9" style="stroke:${ssEsc(col.a)}" stroke-dasharray="${(C*sh).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 55 55)"/><text x="55" y="58" text-anchor="middle" class="pd-rn">${Math.round(sh*100)}%</text><text x="55" y="74" text-anchor="middle" class="pd-rs">of team points</text></svg></div>`
    +`<div class="pd-sleg"><span><i class="one"></i>1-Points</span><span><i class="two"></i>2-Points</span><span><i class="gl"></i>Goals</span></div>`
    +`<div class="dnote">${ssEsc('The bar: the share of his points from 1-pointers, 2-pointers and goals (a 2-pointer counts 2, a goal 3; hover a block for the count). The ring: his points as a share of all '+team+' '+S.T+' points in these games.')}</div>`;
}
// per game (the comparison basis): a count ÷ games played; the squad average = the Player Profile's (pfSquad 'pg') for its metrics,
// the same rule (the mean over the squad players with the figure) for the rest
function pdPg(S, row, k){ if(S.na[k]||!row||!row.gp) return null; const v=row[k]; return v==null?null:v/row.gp; }
function pdPgAvg(S, k){ if(S.na[k]) return null; if(S.sq.pg[k]&&PF_METRICS.some(m=>m[0]===k)) return S.sq.pg[k].avg;
  const v=S.F.players.map(p=>pdPg(S, S.rows.get(p.key), k)).filter(x=>x!=null&&isFinite(x)); return v.length?v.reduce((a,x)=>a+x,0)/v.length:null; }
function pdBarsHTML(S, row, col, one){   // one: a single-game range — his per-game figure IS the tile's total, so it is not printed again
  return PD_BARS.map(([k,l])=>{ const v=pdPg(S, row, k), avg=pdPgAvg(S, k), na=S.na[k];
    if(v==null||avg==null) return `<div class="pd-br na" title="${ssEsc('n/a — '+(na||'no figure'))}"><span>${ssEsc(l)}</span><em>n/a</em></div>`;
    const m=Math.max(v, avg, 1e-9), w=x=>Math.max(1.5, x/m*100).toFixed(1), f=x=>(Math.round(x*100)/100).toFixed(2);
    return `<div class="pd-br" data-k="${k}"><span>${ssEsc(l)}</span><div class="pd-bt"><i style="width:${w(v)}%;background:${ssEsc(col.a)}"></i><i class="sq" style="width:${w(avg)}%"></i></div><b>${one?'':f(v)}<small>${f(avg)}</small></b></div>`; }).join('');
}
// SHOT MAPS: the Players tab's three maps (total / right foot / left foot) for the player over the range — its own view
// (pyView), maps (pyMapsHTML → pyMapSVG / ttShotMark: one marker size, COHESION's colours, rotated games read as the Players tab
// reads them), legend, n/a notes and hover cards (the cards are routed to this view: pdTipState)
function pdShotView(S, key){ const F={types:new Set(), play:'both'}; return {F, V:pyView(S.R, key, F, null, null, S.F)}; }
function pdMapsHTML(S, M, V){
  if(!M.V.player) return '<div class="tt-empty">n/a — he is not in these games.</div>';
  return pdMapsOnly(S, M)+pdBandsHTML(S, M, V);
}
// SHOOTING BY DISTANCE on the dashboard (the shared pyBandsHTML / cohesion-shotbands.js): the player's shots over the range;
// the comparison column follows the toggle — vs squad: the team's % in the same band over the same games; vs previous
// season / season average: his own % in that range
function pdBandsHTML(S, M, V, print){
  if(!V||typeof pyBandsHTML!=='function') return '';
  const mine=S.R.shots.filter(s=>s.pk===V.key);
  let cmp={label:titleCase(S.T)+' %', what:'the whole team (same games)', shots:S.R.shots};
  if(V.mode!=='squad'&&V.P&&V.P.S&&V.prow) cmp={label:(V.P.savg?'His '+V.P.season+' %':'His '+V.P.season+' %'), what:V.P.savg?'his own '+V.P.season+' season':'his own '+V.P.season+' range', shots:V.P.S.R.shots.filter(s=>s.pk===V.key)};
  return pyBandsHTML(mine, cmp, {gameOf:S.R.gameOf, watch:print?null:(k, lab, list)=>pdW('band:'+k, 'pshot', list, list.length+' · '+lab)});
}
function pdMapsOnly(S, M){
  return pyMapsHTML(S.R, M.V, M.F).replace(' The 1-point, 2-point and Goal chips filter by the tagged attempt type (a shot with no attempt type then drops out); a marker’s', ' A marker’s');   // no chips on this tab
}
function pdCtlHTML(V){
  const r=V.range, kinds=[['last5','Last 5'],['last10','Last 10'],['season','Season'],['comp','Competition'],['game','Game'],['opp','v Opponent']];
  const seasons=pdSeasons(V.list), comps=pdComps(V.list, r.season), sel=(id, opts, cur, lab)=>`<label class="pd-f"><span>${lab}</span><select id="${id}">${opts.map(o=>`<option value="${ssEsc(o[0])}"${o[0]===cur?' selected':''}>${ssEsc(o[1])}</option>`).join('')}</select></label>`;
  const players=V.squad.map(p=>[p.key, p.name]);
  let h=`<div class="pd-ctl">${sel('pdPlayer', players, V.key, 'PLAYER')}<div class="pd-f"><span>RANGE</span><div class="seg" id="pdKind" role="group" aria-label="Range">${kinds.map(k=>`<button type="button" data-pdkind="${k[0]}" class="${r.kind===k[0]?'on':''}" aria-pressed="${r.kind===k[0]}">${k[1]}</button>`).join('')}</div></div>`;
  if(r.kind==='season'||r.kind==='comp') h+=sel('pdSeason', seasons.map(s=>[s,s]), r.season, 'SEASON');
  if(r.kind==='comp') h+=sel('pdComp', comps.map(c=>[c,c]), r.comp, 'COMPETITION');
  if(r.kind==='game') h+=sel('pdGame', V.list.map(g=>[g.id, [pdSeasonOf(g), pdCompShort(g.competition), g.round, 'v '+ovMatch(g,null,null,V.T).opp].filter(Boolean).join(' · ')]), r.gid, 'GAME');
  if(r.kind==='opp') h+=sel('pdOpp', pdOpps(V.list, V.T).map(o=>[o, 'v '+titleCase(o)+' ('+V.list.filter(g=>pdIsOpp(g,o)).length+')']), r.opp, 'OPPONENT');
  h+=`<div class="pd-f pd-fprint"><span>&nbsp;</span><button type="button" class="act" data-pdprint="1" title="Lay this dashboard out on landscape A4 and open the print dialog (Save as PDF)">Print / Save PDF</button></div>`;
  h+=`<div class="pd-f"><span>COMPARE</span><div class="seg" id="pdMode" role="group" aria-label="Compare">${[['prev',r.kind==='game'||r.kind==='opp'?'vs season average':'vs previous season'],['squad','vs squad average']].map(m=>`<button type="button" data-pdmode="${m[0]}" class="${V.mode===m[0]?'on':''}" aria-pressed="${V.mode===m[0]}">${m[1]}</button>`).join('')}</div></div></div>`;
  return h;
}
function pdHTML(V){
  const {S, row, col}=V;
  let h=pdCtlHTML(V);
  if(!S.games.length) return h+'<div class="soon"><p>No games in this range.</p></div>';
  h+=pdHeadHTML(V);
  if(!row) h+=`<div class="tt-card tt-empty">n/a — ${ssEsc(V.name||'this player')} is not named on any ${ssEsc(V.T)} event in this range (no minutes and no tagged event).</div>`;
  // a single game: Points per game would repeat Total points, so it is left out
  const myKo=S.R.kos.filter(k=>k.team===S.T&&k.who&&k.who.team===S.T&&k.who.key===V.key), myShots=S.R.shots.filter(s=>s.pk===V.key);
  const gw={sc:pdW('tile:shots', 'pshot', myShots, myShots.length+' shots'), pm:pdW('tile:ko', 'pko', myKo, myKo.length+' kickout targets')};
  if(V.range.kind==='opp') h=h.replace('<div class="pd-range"><span>RANGE</span>', '<div class="pd-range"><span>RANGE</span>'+pdW('opp', 'pshot', myShots, 'v '+titleCase(V.range.opp)+' · '+myShots.length+' shots'));
  h+='<div class="pd-groups">'+PD_GROUPS.map(([g,l])=>`<div class="pd-grp"><h4>${l}${gw[g]?' '+gw[g]:''}</h4><div class="pd-tiles">${PD_KPIS.filter(d=>d.g===g&&!(d.k==='ppg'&&V.range.kind==='game')).map(d=>pdTileHTML(d, S, row, V.mode, V.P, V.prow)).join('')}</div></div>`).join('')+'</div>';
  const Rd=pdRadar(S, V.key), tk=V.trendK, trend=V.trend;
  h+=`<div class="pd-panels"><div class="tt-card pd-p pd-p1"><h4 class="td-ct">PLAYER V TEAM AVERAGE</h4>${row?pdRadarSVG(Rd, col, row.name):'<div class="tt-empty">n/a</div>'}`
    +`<div class="pd-leg"><span><i style="background:${ssEsc(col.a)}"></i>${ssEsc(row?row.name:'Player')}</span><span><i class="sq"></i>Team average</span></div>`
    +`<div class="dnote">${ssEsc('Each axis is scored 0–100 against the '+S.F.players.length+' squad players in this range (everyone named on a '+S.T+' event; with a team sheet, everyone with minutes): player ÷ the squad’s highest × 100, per game; Shooting % is the % itself; Discipline is 100 × (1 − fouls per game ÷ the squad’s highest). The grey shape is the squad average on the same scale. '+Rd.axes.map(a=>a.l+' = '+a.how).join('; ')+'.'+(Rd.axes.some(a=>a.k==='min')&&row&&row.gpMin<row.gp?' Game time comes from '+row.gpMin+' of his '+row.gp+' games — only those have a team sheet.':'')+(Rd.left.length?' Left out (n/a): '+Rd.left.join('; ')+'.':''))}</div></div>`
    +`<div class="tt-card pd-p pd-p2"><div class="pd-ph"><h4 class="td-ct">PER-GAME TREND</h4><select id="pdTrendK" aria-label="Trend figure">${PD_TREND.map(t=>`<option value="${t[0]}"${t[0]===tk?' selected':''}>${t[1]}</option>`).join('')}</select></div><div class="pd-scroll">${pdTrendSVG(trend, tk, col)}</div>`
    +`<div class="dnote">${ssEsc((V.range.kind==='game'?'The '+(V.P&&V.P.season||'')+' season around the selected game (ringed). ':'Oldest → newest across the range. ')+'“–” = not named on any '+S.T+' event in that game; a game without the data shows no point.')}</div></div>`
    +`<div class="tt-card pd-p pd-p3"><h4 class="td-ct">PLAYER V SQUAD</h4><div class="pd-leg"><span><i style="background:${ssEsc(col.a)}"></i>Player</span><span><i class="sq"></i>Squad avg</span></div>${pdBarsHTML(S, row, col, V.range.kind==='game')}<div class="dnote">${V.range.kind==='game'?'This game: his figures are the tiles above; the number is the squad average in this game.':'Per game.'} Squad average as the Player Profile: the mean over the squad players who have the figure. Hover an n/a row for the reason.</div></div>`
    +`<div class="tt-card pd-p pd-p4"><h4 class="td-ct">SCORING BREAKDOWN</h4>${pdScoringHTML(row, S, col)}</div>`
    +'</div>'
    +pdAreasHTML(V);
  const naList=[...new Set(PD_KPIS.filter(d=>S.na[d.k]).map(d=>d.l+': '+S.na[d.k]))];
  h+=`<div class="dnote pd-foot">${ssEsc('Totals are the Players tab’s for the same games (its players table: shots, scores, assists, xP; its kickout lists: targets named on '+S.T+'’s own kickouts). Games = games he is named on an event'+(S.F.sheetGames?', or has minutes on a team sheet':'')+'. ARROWS — what is compared: counts (scores, shots, assists, kickouts, turnovers, fouls, cards) PER GAME; rates (Shooting %, Points per game, Finishing v xP) as they are; Games and Minutes as TOTALS. Against: '+(V.mode==='squad'?'the squad average (the Player Profile’s: the mean over the squad players who have the figure)':V.P&&V.P.savg?'his own average per game over the '+V.P.season+' season ('+V.P.games.length+' games; Minutes: this game against his minutes per game; Games: not compared)':'his own figures in the same kind of range in the previous season ('+(V.P&&V.P.games.length?V.P.season+': '+V.P.games.length+' game'+(V.P.games.length===1?'':'s'):'n/a — '+(V.P?V.P.reason:''))+')')+'. Green = better by more than 3%, red = worse by more than 3% (fewer is better for turnovers lost, fouls and cards), grey within 3%. Score assists = his assists on scores; shot assists = every shot he is named as the assist on. Goal attempts = shots tagged Goal Attempt.'+(naList.length?' N/A in this range — '+naList.join(' · ')+'.':''))}</div>`;
  return h;
}

// ═════ the SHOOTING / BUILD-UP / GAME IMPACT areas — the Players tab's and the PLAYER PROFILE's own code, over the range ═════
// SHOT PRESSURE: conversion under Low / Medium / High (Shot Pressure tag; pfPressure: shots that also carry a Shot Side tag, as
// the Pressure Rating) v the team's over the same games, and the Players tab's side × pressure grid (pyPrHTML, its hover cards)
function pdPressureHTML(S, V, print){
  const mine=S.R.shots.filter(s=>s.pk===V.key), Pm=pfPressure(mine), Pt=pfPressure(S.R.shots);
  let h='<div class="tt-card pd-pr"><h4 class="td-ct">SHOT PRESSURE</h4>';
  if(!mine.length) return h+'<div class="tt-empty">No shots.</div></div>';
  if(!Pm.tagged) return h+`<div class="tt-empty">${ssEsc('n/a — none of his '+mine.length+' shots carries both a Shot Pressure and a Shot Side tag.')}</div></div>`;
  h+=`<table class="tt-ztab pd-dt"><thead><tr><th scope="col">PRESSURE</th><th scope="col">SHOTS</th><th scope="col">SCORES</th><th scope="col">HIS CONV.</th><th scope="col">${ssEsc(titleCase(S.T))}</th><th scope="col"><span class="py-sr">Watch</span></th></tr></thead><tbody>`
    +PY_LEVELS.map(([l, n])=>{ const a=Pm.lv[l], t=Pt.lv[l], x=pfVs(a.pct, t.pct), list=mine.filter(s=>(s.side==='L'||s.side==='C'||s.side==='R')&&s.pr===l);   // = pyPressure's tagged shots
      return `<tr data-pr="${l}"><th scope="row">${ssEsc(n)}</th><td>${a.shots}</td><td>${a.scores}</td><td class="${a.pct==null?'na':x.tone}">${ssEsc(pyPct1(a.pct))}</td><td>${ssEsc(pyPct1(t.pct))}</td><td class="py-bw">${pdW('pr:'+l, 'pshot', list, list.length+' under '+n.toLowerCase()+' pressure')}</td></tr>`; }).join('')+'</tbody></table>'
    +`<div class="dnote">${ssEsc(Pm.tagged+' of his '+Pm.total+' shots carry both tags (the Pressure Rating’s rule); '+titleCase(S.T)+' = the whole team’s conversion over the same games. His % is green more than 3% above it, red more than 3% below.')}</div></div>`;
  return print?h:h+pyPrHTML(V.map.V.pressure);
}
// FREE-TAKING / DEAD BALLS: his dead-ball shots by type (the Analysis dead-ball type: Free, ’45, Mark, Penalty, Sideline) and by
// distance band (cohesion-shotbands.js)
const PD_DEAD=[['Free','Frees'],['45','’45s'],['Mark','Marks'],['Penalty','Penalties'],['Sideline','Sidelines'],['Dead ball','Type not tagged']];
function pdDeadHTML(S, V){
  const dead=S.R.shots.filter(s=>s.pk===V.key&&s.dead);
  let h='<div class="tt-card pd-db"><h4 class="td-ct">FREE-TAKING · DEAD BALLS</h4>';
  if(!dead.length) return h+`<div class="tt-empty">${ssEsc('No dead-ball shots by him in these games.')}</div></div>`;
  const row=(lab, a, k)=>{ const sc=a.filter(s=>s.v>0), xs=a.filter(s=>s.xp!=null), xp=xs.reduce((x,s)=>x+s.xp,0);
    return `<tr${k?` data-db="${ssEsc(k)}"`:''}><th scope="row">${ssEsc(lab)}</th><td>${a.length}</td><td>${sc.length}</td><td>${ssEsc(pyPct1(ovPct(sc.length, a.length)))}</td><td>${sc.reduce((x,s)=>x+s.v,0)}</td><td>${xs.length?xp.toFixed(1):'n/a'}</td><td class="py-bw">${pdW('db:'+k, 'pshot', a, a.length+' '+lab.toLowerCase())}</td></tr>`; };
  const types=PD_DEAD.map(([k,l])=>[l, dead.filter(s=>(s.deadType||'Dead ball')===k), k]).filter(x=>x[1].length);
  h+=`<table class="tt-ztab pd-dt"><thead><tr><th scope="col">TYPE</th><th scope="col">TAKEN</th><th scope="col">SCORED</th><th scope="col">%</th><th scope="col">PTS</th><th scope="col">xP</th><th scope="col"><span class="py-sr">Watch</span></th></tr></thead><tbody>`
    +types.map(([l,a,k])=>row(l,a,k)).join('')+row('All dead balls', dead, 'all')+'</tbody></table>';
  const B=typeof cohShotBands==='function'?cohShotBands(dead):null;
  if(B&&dead.some(s=>s.y!=null)) h+=`<table class="tt-ztab pd-dt"><thead><tr><th scope="col">BY DISTANCE</th><th scope="col">TAKEN</th><th scope="col">SCORED</th><th scope="col">%</th></tr></thead><tbody>`
    +[['A','A Inside the 20m line'],['B','B 20m line to 45m line'],['C','C Beyond the 45m line']].map(([k,l])=>{ const x=B.rows[k]; return `<tr data-dbb="${k}"><th scope="row">${ssEsc(l)}</th><td>${x.shots}</td><td>${x.scores}</td><td>${ssEsc(pyPct1(x.pct))}</td></tr>`; }).join('')+'</tbody></table>'
    +(B.unlocated?`<div class="dnote">${ssEsc(B.unlocated+' of them with no location are in no band.')}</div>`:'');
  else h+='<div class="dnote">By distance: n/a — none of these dead balls has a pitch location (a ’45 alone counts in B).</div>';
  return h+`<div class="dnote">${ssEsc('Dead-ball type from the Deadball Shot Type tag, else the code / description (the Analysis rule). xP only for the shots the model can rate. A ’45 is band B, a penalty band A.')}</div></div>`;
}
function pdAreasHTML(V){
  const {S}=V, fp=S.F.byKey.get(V.key), bo=pdBundleOf, sq=S.sq.tot;
  const na=t=>`<div class="tt-card tt-empty">${ssEsc('n/a — '+(V.name||'he')+' is not named on any '+S.T+' event in these games')}</div>`;
  const mine=S.R.shots.filter(s=>s.pk===V.key);
  const shooting=`<div class="tt-card pd-maps wide"><div class="pd-ph"><h4 class="td-ct">SHOT MAPS · SHOOTING BY DISTANCE</h4><span class="pd-ws">${pdW('shots', 'pshot', mine, mine.length+' shot'+(mine.length===1?'':'s'))}${pdW('scores', 'pshot', mine.filter(s=>s.v>0), mine.filter(s=>s.v>0).length+' score'+(mine.filter(s=>s.v>0).length===1?'':'s'))}</span></div>${pdMapsHTML(S, V.map, V)}</div>`+pdPressureHTML(S, V)+pdDeadHTML(S, V);
  const wrap=(card, btns)=>btns?card.replace(/<\/div>$/, `<div class="pd-wrow">${btns}</div></div>`):card;   // the Watch buttons go at the foot of the reused card
  // assist links: the scores he set up, per team-mate (the card's HE SET UP rows), and every assisted score of his
  const Lk=fp?pfLinks(S.R, V.key):null, setUp=S.R.shots.filter(s=>s.ak===V.key&&s.v>0&&s.pk&&s.pk!==V.key);
  const lnkBtns=Lk?pdW('ast:all', 'pshot', setUp, setUp.length+' score'+(setUp.length===1?'':'s')+' he set up')+Lk.to.map(r=>{ const l=setUp.filter(s=>s.pk===r.key); return pdW('ast:'+r.key, 'pshot', l, 'assists to '+r.name+' ('+l.length+')'); }).join('')
    +pdW('ast:by', 'pshot', mine.filter(s=>s.ak&&s.ak!==V.key&&s.v>0), mine.filter(s=>s.ak&&s.ak!==V.key&&s.v>0).length+' assisted scores of his'):'';
  const whenBtns=fp?PF_BLOCKS.map((B,i)=>{ const l=mine.filter(s=>s.v>0&&pdBlockOf(s)===i); return pdW('when:'+i, 'pshot', l, B[2]+' min ('+l.length+')'); }).join(''):'';
  const build=fp?pfSourcesCardHTML(S.F, fp, sq, S.R, bo)+wrap(pfLinksCardHTML(S.F, fp, sq, S.R, bo), lnkBtns):na();
  const impact=fp?wrap(pfWhenCardHTML(S.F, fp, sq, S.R, bo), whenBtns)+pfOnOffHTML(S.F, fp, sq):na();
  return `<div class="pd-area" data-area="shooting"><h3>SHOOTING</h3><div class="pd-area-g">${shooting}</div></div>`
    +`<div class="pd-area" data-area="build"><h3>BUILD-UP</h3><div class="pd-area-g">${build}</div></div>`
    +`<div class="pd-area" data-area="impact"><h3>GAME IMPACT</h3><div class="pd-area-g">${impact}</div></div>`;
}

// ═════ ▶ WATCH — the clips behind a figure, back to back across the range's games (Analysis' own clip player: cpOpen /
// cpList / ttClipOf — the same clip, pre- and post-roll as "Watch clip" and the playlists; a game with no video is skipped
// and named; "Save all as playlist" = the existing playlists flow). Every button and the player are hidden in print.
let PD_WQ=new Map();
function pdW(key, kind, items, label){
  if(!items||!items.length) return '';
  PD_WQ.set(key, {kind, items:items.slice(), label});
  return `<button type="button" class="pd-w" data-pdwatch="${ssEsc(key)}" title="${ssEsc('Watch the '+items.length+' clip'+(items.length===1?'':'s')+' behind this figure, back to back')}">▶ ${ssEsc(label)}</button>`;
}
// the queue of a button, in the range's game order (oldest first) and time order within a game → {kind, items, list (playable),
// skipped:{n, games:['v Galway'…]}}
function pdWatchQueue(key){
  const q=PD_WQ.get(key); if(!q||!PD_V) return null;
  const R=PD_V.S.R, order=new Map(PD_V.S.games.slice().reverse().map((g,i)=>[g.id, i]));
  const items=q.items.slice().sort((a,b)=>((order.get(a.gid)||0)-(order.get(b.gid)||0))||((a.e&&a.e.driveT||0)-(b.e&&b.e.driveT||0)));
  const list=cpList(items, R.gameOf, cpClip), noVid=items.filter(s=>!cpClip(s));
  const games=[...new Set(noVid.map(s=>{ const m=R.gameOf.get(s.gid); return m?'v '+m.opp:s.gid; }))];
  return {kind:q.kind, label:q.label, items, list, skipped:{n:noVid.length, games}};
}
function pdWatchNote(Q){ return Q.skipped.n?Q.skipped.n+' clip'+(Q.skipped.n===1?'':'s')+' skipped: no video for '+Q.skipped.games.join(', '):''; }
function pdWatch(btn){
  const Q=pdWatchQueue(btn.dataset.pdwatch); if(!Q) return;
  const note=pdWatchNote(Q);
  if(!Q.list.length){ const st=ssEl('pdStatus'); if(st) st.textContent='Nothing to play: '+(note||'no video'); return; }
  cpOpen(Q.kind, Q.list[0].s, btn, Q.items, {ctx:true, note, queue:true});
}
// the scoring 15-minute block of a shot (pfBlocks' rule): 0…4, or -1 with no game clock
function pdBlockOf(s){
  const b=pdBundleOf(s.gid); if(!b) return -1;
  const c=pfClockOf(b.meta, b.events)(s.e), m=c?cohTotalMinutes(b.meta, PF_TAGS[c.p], c.secs):null; if(m==null) return -1;
  return PF_BLOCKS.findIndex(B=>m>=B[0]&&m<B[1]);
}

// ═════ PRINT / SAVE PDF — the dashboard laid out for LANDSCAPE A4 (Barry, Oct 2026): page 1 the overview (header, tiles, radar,
// trend, scoring breakdown, the three shot maps), page 2 the detail (shooting by distance, pressure, free-taking, score sources,
// assist links, when he scores, on / off). Two pages: the whole dashboard on one page would need type under 6 pt. Built as its
// own pages (#pdPrint, outside the screen layout, named page "pdland" = A4 landscape), from the same HTML as the screen — the
// pitch maps stay SVG; no Watch buttons and no controls (the range and the comparison are printed as text); stats only, so no
// staff-only line; a footer "COHESION Analysis · generated <date> · <data source>". The Panel Print-out keeps portrait A4.
function pdShortNa(r){ r=String(r||'');
  if(/none names a/.test(r)) return 'no player named on the rows';
  if(/pitch location/.test(r)) return 'no shot locations';
  if(/team sheet/.test(r)) return 'no team sheet';
  const m=/^no (.+?) rows/.exec(r); if(m) return 'no '+m[1]+' rows';
  return r.replace(/ in (this game|these \d+ games)/,''); }
function pdPrintHTML(V){
  const {S, row, col}=V, today=new Date().toLocaleDateString('en-IE',{day:'numeric', month:'short', year:'numeric'});
  const src=[...new Set(S.games.map(g=>g.source==='gaelic-insights'||(!g.source&&g.file)?'Gaelic Insights XMLs':g.source?g.source.replace(/\s*\(.*$/,''):'uploaded game files'))].join(' + ');
  const foot=n=>`<div class="pdp-foot"><span>COHESION Analysis · generated ${ssEsc(today)} · ${ssEsc(S.games.length+' game'+(S.games.length===1?'':'s')+': '+src)}</span><span>${n} / 2</span></div>`;
  const cmp=V.mode==='squad'?'vs squad average (per game)':V.P&&V.P.savg?'vs his '+V.P.season+' average (per game)':'vs previous season'+(V.P&&V.P.games.length?' ('+V.P.season+', per game)':' — n/a');
  const name=row?row.name:V.name, crest=typeof cohCrestSrc==='function'?cohCrestSrc(V.T):null, sh=V.sheet;
  const head=`<div class="pdp-head"><div class="pdp-badge">${cohPlayerBadgeHTML(V.T, name, {cls:'pd-badge', color:col.primary})}</div><div class="pdp-who"><h1>${ssEsc(name)}</h1>`
    +`<div>${crest?`<img src="${ssEsc(crest)}" alt="" class="pdp-crest">`:''}<b>${ssEsc(titleCase(V.T))}</b> · ${ssEsc(sh&&sh.no!=null&&sh.no!==''?'#'+sh.no:'No. n/a')} · ${ssEsc(sh&&sh.pos?sh.pos:'Position n/a')}</div></div>`
    +`<div class="pdp-meta"><div><span>RANGE</span><b>${ssEsc(V.rangeTxt)}</b></div><div><span>COMPARED</span><b>${ssEsc(cmp)}</b></div><div><span>PRINTED</span><b>${ssEsc(today)}</b></div></div>${pdStripeHTML(col, 'pdp-stripe')}</div>`;
  const tiles='<div class="pdp-tiles">'+PD_GROUPS.map(([g,l])=>`<div class="pdp-grp"><h4>${l}</h4><div class="pdp-tg">${PD_KPIS.filter(d=>d.g===g&&!(d.k==='ppg'&&V.range.kind==='game')).map(d=>pdTileHTML(d, S, row, V.mode, V.P, V.prow)).join('')}</div></div>`).join('')+'</div>';
  const naList=[...new Set(PD_KPIS.filter(d=>S.na[d.k]).map(d=>d.l+' — '+pdShortNa(S.na[d.k])))];
  const p1=`<section class="pdp-page" data-page="1">${head}${tiles}<div class="pdp-row">`
    +`<div class="pdp-card"><h4>PLAYER V TEAM AVERAGE</h4>${row?pdRadarSVG(pdRadar(S, V.key), col, name):'<div class="tt-empty">n/a</div>'}</div>`
    +`<div class="pdp-card pdp-trend"><h4>PER GAME · ${ssEsc((PD_TREND.find(t=>t[0]===V.trendK)||[])[1]||'')}</h4>${pdTrendSVG(V.trend, V.trendK, col)}</div>`
    +`<div class="pdp-card"><h4>SCORING BREAKDOWN</h4>${pdScoringHTML(row, S, col)}</div>`
    +`<div class="pdp-card pdp-maps"><h4>SHOT MAPS</h4>${V.map.V.player?pdMapsOnly(S, V.map):'<div class="tt-empty">n/a</div>'}</div></div>`
    +`<div class="pdp-note">${ssEsc('Arrows: counts per game, rates as they are, Games / Minutes as totals; green / red = more than 3% better / worse. Radar: 0–100 against the squad’s best. '+(row&&row.min!=null&&row.gpMin<row.gp?'Minutes and Game time: from '+row.gpMin+' of his '+row.gp+' games — only those have a team sheet. ':'')+(naList.length?'n/a: '+naList.join(' · ')+'.':''))}</div>${foot(1)}</section>`;
  const fp=S.F.byKey.get(V.key), bo=pdBundleOf, sq=S.sq.tot;
  const card=(cls, html)=>`<div class="pdp-card ${cls}">${html}</div>`;
  const p2=`<section class="pdp-page" data-page="2"><div class="pdp-h2">${ssEsc(name+' · '+titleCase(V.T)+' · '+V.rangeTxt)}</div><div class="pdp-grid">`
    +card('pdp-bands', pdBandsHTML(S, V.map, V, true))
    +card('', pdPressureHTML(S, V, true))+card('', pdDeadHTML(S, V))
    +(fp?card('', pfSourcesCardHTML(S.F, fp, sq, S.R, bo))+card('', pfLinksCardHTML(S.F, fp, sq, S.R, bo))+card('', pfWhenCardHTML(S.F, fp, sq, S.R, bo))+card('pdp-oo', pfOnOffHTML(S.F, fp, sq)):card('wide', '<div class="tt-empty">n/a — not named on any '+ssEsc(S.T)+' event in these games</div>'))
    +`</div><div class="pdp-note">${ssEsc('Bands by depth on the drawn lines (A inside the 20m, B to the 45m, C beyond); a ’45 is B, a penalty A. Pressure: shots tagged with Shot Side + Shot Pressure. Sources: the Overview’s rule. On / off: games with a team sheet, per '+(S.F.basis.unit||'game-length')+' min; under one full game on either side is not ranked.')}</div>${foot(2)}</section>`;
  return p1+p2;
}
// build the print pages and open the browser's print dialog (Save as PDF); pdPrintPrepare alone = the tests' printToPDF
function pdPrintPrepare(){
  if(!PD_V) return 0;
  let host=ssEl('pdPrint'); if(!host){ host=document.createElement('div'); host.id='pdPrint'; document.body.appendChild(host); }
  const ink=c=>(window.cohTeamInk?window.cohTeamInk(c, {theme:'light', bg:'#ffffff', min:4.5}):c);
  host.style.setProperty('--pa', ink(PD_V.col.primary)); host.style.setProperty('--pb', ink(PD_V.col.secondary||PD_V.col.primary)); host.style.setProperty('--pp', PD_V.col.primary); host.style.setProperty('--ps', PD_V.col.secondary||PD_V.col.primary);
  host.innerHTML=pdPrintHTML(Object.assign({}, PD_V, {col:Object.assign({}, PD_V.col, {a:ink(PD_V.col.primary), b:ink(PD_V.col.secondary||PD_V.col.primary)})}));
  // no Watch button and no control in the print: the Watch cells and their header cells are taken out (not only hidden)
  host.querySelectorAll('.pd-w, .pd-wrow, td.py-bw, button, select, input').forEach(e=>e.remove());
  // a comparison that has nothing to compare with (e.g. no previous season uploaded) is said once, in the header — not in every tile
  if(PD_V.mode!=='squad'&&!(PD_V.P&&PD_V.P.games.length)) host.querySelectorAll('.pd-tc.na').forEach(e=>{ e.textContent=''; });
  host.querySelectorAll('th').forEach(th=>{ if(th.querySelector('.py-sr')&&th.textContent.trim()==='Watch') th.remove(); });
  document.body.classList.add('pd-printing');
  return host.querySelectorAll('.pdp-page').length;
}
function pdPrintDone(){ document.body.classList.remove('pd-printing'); }
function pdPrint(){ pdPrintPrepare(); try{ window.print(); }finally{ pdPrintDone(); } }

// ═════ dashboard wiring ═════
let PD_TOKEN=0, PD_TIMER=null, PD_V=null, PD_TEAM=null;
const PD_O={key:null, range:{kind:'season', season:'', comp:'', gid:'', opp:''}, mode:'prev', trendK:'pts', view:'dash'};
function pdSchedule(){ if(typeof TAB==='undefined'||TAB!=='player-dash'||!GAMES_READY) return; clearTimeout(PD_TIMER); PD_TIMER=setTimeout(pdRun, 40); }
function pdBundleOf(id){ return BUNDLES.get(id); }
// the team sheet entry of the player in the newest game of the range that lists him: {no, pos, game}
const PD_POS=['Goalkeeper','Right Corner Back','Full Back','Left Corner Back','Right Half Back','Centre Half Back','Left Half Back','Midfield','Midfield','Right Half Forward','Centre Half Forward','Left Half Forward','Right Corner Forward','Full Forward','Left Corner Forward'];
function pdSheetOf(T, key, games, bundleOf){
  const TS=(typeof window!=='undefined'&&window.cohTS)||null; if(!TS) return null;
  for(const g of games){ const b=bundleOf(g.id); if(!b||!b.meta) continue; const side=TS.sideOf(b.meta, T); if(!side) continue;
    const r=TS.sheet(b.meta, side).find(x=>pyKey(x.name)===key); if(!r) continue;
    const p=TS.posOf(r), role=r.role||'';
    return {no:r.no, pos:p?PD_POS[p-1]:role==='sub'?'Substitute':'', game:(g.title||'')+(g.round?' ('+g.round+')':'')}; }
  return null;
}
async function pdEnsure(T, my, st){
  const need=pdTeamList(T).filter(g=>!BUNDLES.has(g.id));
  if(need.length){ st.textContent='Loading match events… 0/'+need.length; await ovLoad(need, (d,n)=>{ if(my===PD_TOKEN) st.textContent='Loading match events… '+d+'/'+n; }); }
}
async function pdRun(){
  if(TAB!=='player-dash'||!GAMES_READY) return;
  const my=++PD_TOKEN, st=ssEl('pdStatus'), T=ssEl('fTeamO').value;
  if(!T){ ssEl('pdBody').innerHTML=''; st.textContent='No team.'; return; }
  try{ await pdEnsure(T, my, st); }catch(e){ if(my===PD_TOKEN) st.textContent='Could not load games: '+e.message; return; }
  if(my!==PD_TOKEN) return; st.textContent='';
  if(PD_TEAM!==T){ PD_TEAM=T; PD_O.key=null; PD_O.range.season=''; }
  pdSyncView();
  if(PD_O.view==='print'){ ppRender(); return; }
  pdRender();
}
function pdView(){
  const T=PD_TEAM, list=pdTeamList(T), r=PD_O.range, seasons=pdSeasons(list);
  if(!r.season||!seasons.includes(r.season)) r.season=seasons[0]||'';
  const comps=pdComps(list, r.season); if(!comps.includes(r.comp)) r.comp=comps.includes('All-Ireland SFC')?'All-Ireland SFC':comps[0]||'';
  if(!list.some(g=>g.id===r.gid)) r.gid=list[0]?list[0].id:'';
  { const O=pdOpps(list, T); if(!O.includes(r.opp)){ const g=list[0]; r.opp=g?(ssUC(g.homeTeam)===T?ssUC(g.awayTeam):ssUC(g.homeTeam)):''; } }   // default: the latest opponent
  const games=pdRangeGames(list, r), S=pdSummaries(T, games, pdBundleOf);
  // the player list: everyone in the squad over ALL the team's games; default = the most points in the range
  const all=pdSummaries(T, list, pdBundleOf), squad=all.F.players.slice().sort((a,b)=>a.name.localeCompare(b.name));
  if(!PD_O.key||!squad.some(p=>p.key===PD_O.key)){ const top=S.R.players.slice().sort((a,b)=>b.pts-a.pts)[0]||all.R.players.slice().sort((a,b)=>b.pts-a.pts)[0]; PD_O.key=top?top.key:(squad[0]&&squad[0].key)||null; }
  const key=PD_O.key, row=S.rows.get(key)||null, name=(squad.find(p=>p.key===key)||{}).name||'';
  const P=pdPrevRange(list, r, games); P.S=P.games.length?pdSummaries(T, P.games, pdBundleOf):null;
  const prow=P.S?P.S.rows.get(key)||null:null;
  const tg=r.kind==='game'&&P.savg?P.games:games, trend=pdTrend(T, tg, key, PD_O.trendK, pdBundleOf); if(r.kind==='game') trend.forEach(x=>{ x.hl=x.gid===r.gid; });
  return {T, list, range:r, games, S, row, key, name, squad, mode:PD_O.mode, P, prow, col:pdColours(T), trendK:PD_O.trendK, trend, map:pdShotView(S, key),
    sheet:pdSheetOf(T, key, games, pdBundleOf), rangeTxt:pdRangeTxt(r, games)};
}
function pdApplyCol(col){ const p=ssEl('pane-player-dash'); if(!p||!p.style) return; p.style.setProperty('--pa', col.a); p.style.setProperty('--pb', col.b); p.style.setProperty('--pp', col.primary); p.style.setProperty('--ps', col.secondary||col.primary); }
function pdRender(){
  const body=ssEl('pdBody'); if(!body||!PD_TEAM) return;
  pdSyncView();
  try{ PD_V=pdView(); }catch(e){ console.error('player dashboard', e); body.innerHTML='<div class="soon"><p>Could not build the dashboard: '+ssEsc(e.message)+'</p></div>'; return; }
  pdApplyCol(PD_V.col);
  if(typeof ttHideTip==='function') ttHideTip();
  PD_WQ=new Map();
  body.innerHTML=pdHTML(PD_V);
  body.querySelectorAll('.pd-scroll').forEach(x=>{ x.scrollLeft=x.scrollWidth; });   // a long trend: the newest games in view
  body.querySelectorAll('svg.tt-locs').forEach(svg=>{ const w=svg.getBoundingClientRect?svg.getBoundingClientRect().width:0; if(!(w>0)) return; const r=ttHitR(w); svg.querySelectorAll('.tt-mx').forEach(c=>c.setAttribute('r', r)); });   // = pyFitHits
}
// the shot-map hover / pinned cards on this tab read this view (analysis.html pyTipState)
function pdTipState(){ return PD_V&&PD_V.map?{R:PD_V.S.R, V:PD_V.map.V}:{R:null, V:null}; }
// STAFF ONLY (Barry, Oct 2026): the PANEL PRINT-OUT — its tab, the squad picker, the notes, clubs and position labels — is for
// admins: Analysis' own check (mrIsAdmin: an admin sign-in marker AND the admin role). For anyone else the tab is taken OUT
// of the page and nothing of the print-out is built, so no note is ever read into their page. (The live version's notes
// store must check the admin role server-side, as processGame / editEvent do — see the mockup README.)
function pdIsStaff(){ try{ return typeof mrIsAdmin==='function'&&!!mrIsAdmin(); }catch(_){ return false; } }
function pdSyncView(){
  if(!pdIsStaff()){ PD_O.view='dash'; const b=document.querySelector('#pdViews [data-pdview="print"]'); if(b&&b.parentNode) b.parentNode.removeChild(b); const w=ssEl('ppWrap'); if(w) w.innerHTML=''; } document.querySelectorAll('#pdViews button').forEach(b=>{ const on=b.dataset.pdview===PD_O.view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on?'true':'false'); });
  const d=ssEl('pdBody'), p=ssEl('ppWrap'); if(d) d.hidden=PD_O.view!=='dash'; if(p) p.hidden=PD_O.view!=='print'; }
function pdSetView(v){ PD_O.view=v==='print'&&pdIsStaff()?'print':'dash'; pdSyncView(); if(PD_O.view==='print') ppRender(); else pdRender(); }
function pdInit(){
  const pane=ssEl('pane-player-dash'); if(!pane||!pane.addEventListener) return;
  pane.addEventListener('click', e=>{ const t=e.target, c=s=>t&&t.closest?t.closest(s):null; let x;
    if((x=c('[data-pdview]'))){ pdSetView(x.dataset.pdview); return; }
    if((x=c('[data-pdkind]'))){ PD_O.range.kind=x.dataset.pdkind; pdRender(); return; }
    if((x=c('[data-pdmode]'))){ PD_O.mode=x.dataset.pdmode==='squad'?'squad':'prev'; pdRender(); return; }
    if((x=c('[data-pdwatch]'))){ pdWatch(x); return; }
    if((x=c('[data-pdprint]'))){ pdPrint(); return; }
    if(ppClick(e)) return; });
  pane.addEventListener('change', e=>{ const t=e.target; if(!t) return;
    if(t.id==='pdPlayer'){ PD_O.key=t.value; pdRender(); return; }
    if(t.id==='pdSeason'){ PD_O.range.season=t.value; pdRender(); return; }
    if(t.id==='pdComp'){ PD_O.range.comp=t.value; pdRender(); return; }
    if(t.id==='pdGame'){ PD_O.range.gid=t.value; pdRender(); return; }
    if(t.id==='pdOpp'){ PD_O.range.opp=t.value; pdRender(); return; }
    if(t.id==='pdTrendK'){ PD_O.trendK=t.value; pdRender(); return; }
    ppChange(e); });
  pane.addEventListener('input', e=>ppInput(e));
  if(typeof window!=='undefined'&&window.addEventListener){ window.addEventListener('resize', ()=>{ if(PD_O.view==='print') ppFit(); }); window.addEventListener('afterprint', pdPrintDone); }
  pdStyle();
}

// ═════════════════════════════════════════════════════════════════════════════
//  PANEL PRINT-OUT — A4 pages, printed by the browser (window.print → Save as PDF). Cover · goalkeeper page(s) · outfield
//  players two to a page · assists page. Barry picks the squad: each number 1…N gets a player who featured in the season's
//  games, or a name typed in for someone with no data. N = the competition's number limit (cohesion-teamsheet.js
//  gameKind: 26 inter-county league / championship, 30 FBD / O'Byrne / McGrath / McKenna, 40 challenge / club) — a warning
//  only. The position label comes from the SLOT (1 Goalkeeper … 15 Left Corner Forward; a sub: his line, picked here,
//  + "(Sub)") — never from a number on a sheet and never from the order of a list.
//  Notes are drafted from the figures (true figures only), editable on the page, and kept in THIS BROWSER (localStorage,
//  keyed by team + player) — a mockup: no database table.
// ═════════════════════════════════════════════════════════════════════════════
const PP_LINES=[['','Substitute'],['GK','Goalkeeper (Sub)'],['B','Defender (Sub)'],['M','Midfielder (Sub)'],['F','Forward (Sub)']];
const PP_NOTE_KEYS=[['hand','Dominant Hand/Foot'],['style','Style of Play'],['strengths','Strengths'],['watch','Watch Point'],['form','Form']];
function ppStore(k, v){ try{ if(v===undefined){ const s=localStorage.getItem(k); return s?JSON.parse(s):null; } if(v===null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); }catch(_){ } return null; }
function ppPanelKey(T){ return 'coh_panel_v1|'+T; }
function ppNoteKey(T, key){ return 'coh_panel_notes_v1|'+T+'|'+key; }
// the slot's default label (1–15: the slot's position; a sub: his line + "(Sub)"); the label printed = the one typed for this game day, else that
function ppPosLabel(no, line){ return no>=1&&no<=15?PP_POS_NAME(no):(PP_LINES.find(l=>l[0]===(line||''))||PP_LINES[0])[1]; }
function ppSlotLabel(s){ const t=String((s&&s.pos)||'').trim(); return t||ppPosLabel(s.no, s.line); }
function PP_POS_NAME(no){ return PD_POS[no-1]; }
function ppIsKeeper(s){ return s.no===1||(s.no>15&&s.line==='GK'); }
// the competition's limit (cohesion-teamsheet.js gameKind on a game of that competition)
function ppLimit(list, comp){
  const g=list.find(x=>String(x.competition||'').trim()===comp)||list[0]||{};
  const TS=(typeof window!=='undefined'&&window.cohTS)||null;
  return TS?TS.gameKind(g):{kind:'county', limit:26, label:'an inter-county game'};
}
// the panel state of a team (this browser): {season, comp, size, slots:{no:{key, name, free, line}}, cover:{opponent, date}}
let PP=null, PP_TEAM=null;
function ppLoad(T, list){
  const s=ppStore(ppPanelKey(T))||{}, seasons=pdSeasons(list);
  s.season=seasons.includes(s.season)?s.season:(seasons[0]||'');
  const comps=pdComps(list, s.season); s.comp=comps.includes(s.comp)?s.comp:(comps.includes('All-Ireland SFC')?'All-Ireland SFC':comps[0]||'');
  s.slots=s.slots||{}; s.cover=s.cover||{opponent:'', date:''};
  if(!s.size) s.size=ppLimit(list, s.comp).limit;
  return s;
}
function ppSave(){ if(PP&&PP_TEAM) ppStore(ppPanelKey(PP_TEAM), PP); }
// the notes of one player: saved (this browser) or null
function ppNotes(T, key){ return ppStore(ppNoteKey(T, key)); }
// a score line "G-P" (P = points value)
function ppScore(r){ return pyScoreTxt(r.goals, r.one, r.two); }
// DRAFT NOTES from the figures — every number is a count of the games' own rows. ctx = {S (full season), C (competition), T, key, keeper, comp, season}
function ppDraft(ctx){
  const {S, C, T, key}=ctx, r=S.rows.get(key), out={hand:'', style:'', strengths:'', watch:'', form:''};
  if(ctx.keeper){
    const own=S.R.kos.filter(k=>k.team===T), L=tkByLen(own);
    if(own.length) out.style=titleCase(T)+' kickouts in '+ctx.season+' (the files do not name the kicker): '+L.all.n+' taken, '+Math.round(L.all.pct)+'% won'+TK_LENS.filter(l=>L[l[0]].n).map(l=>'; '+l[1]+' '+L[l[0]].n+' ('+Math.round(L[l[0]].pct)+'% won)').join('')+'.';
  }
  if(!r) return out;
  const mine=S.R.shots.filter(s=>s.pk===key), legs=pyLegStats(mine);
  const ft=legs.R.shots+legs.L.shots+legs.H.shots;
  if(ft){ const top=[['R','Right foot'],['L','Left foot'],['H','Hand']].sort((a,b)=>legs[b[0]].shots-legs[a[0]].shots)[0]; out.hand=top[1]+' on '+legs[top[0]].shots+' of the '+ft+' shots with a Shooting Leg tag ('+[['R','right'],['L','left'],['H','hand']].map(x=>legs[x[0]].shots+' '+x[1]).join(', ')+').'; }
  const parts=[];
  if(r.shots) parts.push(ppScore(r)+' from '+r.shots+' shot'+(r.shots===1?'':'s')+(r.pct!=null?' at '+Math.round(r.pct)+'%':''));
  const db=mine.filter(s=>s.dead); if(db.length) parts.push(db.length+' of the shots from dead balls ('+db.filter(s=>s.v>0).length+' scored)');
  if(!S.na.koT&&r.koT) parts.push(r.koT+' kickout target'+(r.koT===1?'':'s')+', '+(r.koW===r.koT?(r.koT===1?'won':'all '+r.koT+' won'):r.koW+' won'));
  if(r.astShots) parts.push(r.assists+' score assist'+(r.assists===1?'':'s')+' from '+r.astShots+' shot assist'+(r.astShots===1?'':'s'));
  if(!ctx.keeper) out.style=parts.length?parts.join('; ')+' ('+ctx.season+', '+r.gp+' game'+(r.gp===1?'':'s')+').':'';
  else if(parts.length) out.style+=(out.style?' ':'')+parts.join('; ')+'.';
  // strengths: where he ranks in the top 3 of the squad, per game
  const ranks=[['ppg','points per game'],['pct','shooting % (5+ shots)'],['astShots','shot assists per game'],['koW','kickouts won per game']].map(([k,l])=>{
    if(S.na[k]) return null; const list=S.F.players.map(p=>S.rows.get(p.key)).filter(x=>x&&(k!=='pct'||x.shots>=5)).map(x=>({key:x.key, v:pdCmpVal(S, x, k)})).filter(x=>x.v!=null&&x.v>0);
    const rk=pfRanks(list).get(key); return rk&&rk.rank<=3?{l, rk, v:list.find(x=>x.key===key).v, k}:null; }).filter(Boolean);
  out.strengths=ranks.map(x=>pfRankTxt(x.rk)+' in the squad for '+x.l+' ('+pdNum(x.k==='pct'?'pct':'ppg', x.v)+')').join('; ')+(ranks.length?'.':'');
  if(C&&C.rows.get(key)){ const c=C.rows.get(key); if(c.shots) out.strengths+=(out.strengths?' ':'')+ctx.comp+': '+ppScore(c)+' from '+c.shots+' shot'+(c.shots===1?'':'s')+' in '+c.gp+' game'+(c.gp===1?'':'s')+'.'; }
  // watch point: his shots by attempt type
  const by=[['1','1-point attempts'],['2','2-point attempts'],['G','goal attempts']].map(([a,l])=>{ const s=mine.filter(x=>x.att===a); return s.length?l+' '+s.filter(x=>x.v>0).length+' of '+s.length+' scored':''; }).filter(Boolean);
  const miss=mine.filter(s=>!(s.v>0)).length;
  out.watch=(by.length?by.join('; ')+'. ':'')+(!mine.length?'':miss?miss+' of his '+mine.length+' shots did not score.':'Every one of his '+mine.length+' shots scored.');
  // form: the last three games of the season he played
  const games=S.F.byKey.get(key).games.slice(-3).reverse().map(gr=>{ const g=S.games.find(x=>x.id===gr.gid), m=g?ovMatch(g,null,null,T):null, sh=S.R.shots.filter(s=>s.pk===key&&s.gid===gr.gid);
    const o={goals:0, one:0, two:0}; sh.forEach(s=>{ if(s.v>=3) o.goals++; else if(s.v===2) o.two++; else if(s.v>0) o.one++; });
    return 'v '+(m?m.opp:'?')+' '+(sh.length?ppScore(o)+' ('+sh.filter(s=>s.v>0).length+' from '+sh.length+')':'no shot'); });
  out.form=r.gp+' game'+(r.gp===1?'':'s')+' in '+ctx.season+(r.min!=null?', '+Math.round(r.min)+' minutes':'')+'. Last '+games.length+': '+games.join(', ')+'.';
  return out;
}
// the kickout chains of the keeper's kickouts by length: {S:{…}, M:{…}, L:{…}} each {taken, won, pct, shots, scores, one, two, goals, value, conv} or null fields n/a
function ppChains(S, T, keeperName){
  let own=S.R.kos.filter(k=>k.team===T);
  const named=own.some(k=>k.takenBy), kk=pyKey(keeperName||''), byKeeper=named&&kk;
  if(byKeeper) own=own.filter(k=>pyKey(k.takenBy)===kk);
  const src=own.some(k=>k.follow);
  const out={byKeeper:!!byKeeper, src, n:own.length};
  TK_LENS.forEach(([l])=>{ const a=own.filter(k=>k.len===l), w=a.filter(k=>k.won), f=w.filter(k=>k.follow);
    const o={taken:a.length, won:w.length, pct:ovPct(w.length, a.length)};
    if(src){ o.shots=f.reduce((x,k)=>x+k.follow.shots,0); o.scores=f.reduce((x,k)=>x+k.follow.scores,0); o.value=f.reduce((x,k)=>x+k.follow.pts,0);
      o.one=f.reduce((x,k)=>x+(k.follow.one||0),0); o.two=f.reduce((x,k)=>x+(k.follow.two||0),0); o.goals=f.reduce((x,k)=>x+(k.follow.goals||0),0); o.conv=ovPct(o.scores, o.shots); }
    out[l]=o; });
  out.located=own.filter(k=>k.x!=null);
  return out;
}
// ASSIST BY FOOTBALLER (every team-mate named as the assist on a shot) and the top link-ups
function ppAssists(S){
  const m=new Map(), L=new Map();
  S.R.shots.forEach(s=>{ if(!s.ak) return; let r=m.get(s.ak); if(!r){ r={key:s.ak, names:{}, shots:0, goals:0, two:0, one:0, pts:0, xp:0, xpShots:0}; m.set(s.ak, r); }
    r.names[s.assist]=(r.names[s.assist]||0)+1; r.shots++; if(s.v>=3) r.goals++; else if(s.v===2) r.two++; else if(s.v>0) r.one++; if(s.v>0) r.pts+=s.v; if(s.xp!=null){ r.xp+=s.xp; r.xpShots++; }
    if(s.pk){ const lk=s.ak+'>'+s.pk; let l=L.get(lk); if(!l){ l={a:s.ak, an:{}, s:s.pk, sn:{}, shots:0, goals:0, two:0, one:0, pts:0}; L.set(lk, l); }
      l.an[s.assist]=(l.an[s.assist]||0)+1; l.sn[s.player]=(l.sn[s.player]||0)+1; l.shots++; if(s.v>=3) l.goals++; else if(s.v===2) l.two++; else if(s.v>0) l.one++; if(s.v>0) l.pts+=s.v; } });
  const nm=k=>{ const p=S.R.players.find(x=>x.key===k); return p?p.name:null; };
  const rows=[...m.values()].map(r=>({key:r.key, name:nm(r.key)||pyBestName(r.names), shots:r.shots, goals:r.goals, two:r.two, one:r.one, pts:r.pts, xp:r.xpShots?r.xp:null, xpAll:r.xpShots===r.shots, q:r.xpShots?r.xp/r.xpShots:null}))
    .sort((a,b)=>b.shots-a.shots||b.pts-a.pts||a.name.localeCompare(b.name));
  const links=[...L.values()].map(l=>({a:nm(l.a)||pyBestName(l.an), s:nm(l.s)||pyBestName(l.sn), shots:l.shots, score:l.goals+'-'+l.two+'-'+l.one+' ('+l.pts+')', pts:l.pts}))
    .sort((a,b)=>b.shots-a.shots||b.pts-a.pts||a.a.localeCompare(b.a));
  return {rows, links:links.slice(0,5), tagged:S.R.shots.filter(s=>s.ak).length, total:S.R.shots.length};
}
// the pages, in order: cover, keeper page(s), outfield pairs, assists → [{kind, slots}]
function ppPages(P){
  const filled=Object.keys(P.slots).map(n=>Object.assign({no:+n}, P.slots[n])).filter(s=>s.name&&String(s.name).trim()).sort((a,b)=>a.no-b.no);
  const gk=filled.filter(ppIsKeeper), out=filled.filter(s=>!ppIsKeeper(s)), pages=[{kind:'cover'}];
  gk.forEach(s=>pages.push({kind:'gk', slots:[s]}));
  for(let i=0;i<out.length;i+=2) pages.push({kind:'out', slots:out.slice(i,i+2)});
  pages.push({kind:'assists', scope:'full'}, {kind:'assists', scope:'comp'});   // the full season, then the competition chosen for the season rows
  return pages;
}
// ── print-out strings ──
function ppBarHTML(s, T, col, club){
  const fg=typeof cohInkOn==='function'?cohInkOn(col.bar):'#fff', fg2=typeof cohInkOn==='function'?cohInkOn(col.tag||col.bar):'#111';
  return `<div class="pp-bar" style="background:${ssEsc(col.bar)};color:${fg}"><div class="pp-no">${s.no}</div><div class="pp-nm"><b>${ssEsc(s.name)}</b><small>${ssEsc(club||'')}</small></div><div class="pp-pos" style="background:${ssEsc(col.tag||col.bar)};color:${fg2}">${ssEsc(ppSlotLabel(s))}</div></div>${col.tertiary?pdStripeHTML(col, 'pp-bedge'):''}`;   // a three-colour county: a thin band edge under the bar
}
function ppSeasonTable(T, key, Sf, Sc, P, col, So){   // So (optional): the OPPONENT RECORD — every uploaded game v P.opp
  const row=(lab, S)=>{ const r=key?S.rows.get(key):null, na=v=>v==null?'n/a':v;
    if(!r) return `<tr><td>${ssEsc(lab)}</td><td colspan="6" class="na">${key?'not named on any '+ssEsc(titleCase(T))+' event':'no data for this name'}</td></tr>`;
    return `<tr><td>${ssEsc(lab)}</td><td>${r.gp}</td><td>${r.min==null?'<span title="no team sheet">n/a</span>':Math.round(r.min)+'\''}</td><td>${r.one}</td><td>${r.two}</td><td>${r.goals}</td><td><b>${na(r.pts)}</b></td></tr>`; };
  return `<table class="pp-st"><thead><tr style="background:${ssEsc(col.bar)};color:${typeof cohInkOn==='function'?cohInkOn(col.bar):'#fff'}"><th>Season</th><th>Games</th><th>Mins</th><th>1-Pts</th><th>2-Pts</th><th>Goals</th><th>Total</th></tr></thead><tbody>`
    +row('Full '+P.season, Sf)+(Sc?row(pdCompShort(P.comp)+' only', Sc):'')+(So?row('v '+titleCase(P.opp)+' (all)', So):'')+'</tbody></table>';
}
function ppNotesTable(T, s, keeper, note){
  const labs=PP_NOTE_KEYS.map(([k,l])=>[k, k==='style'&&keeper?'Kickout Style':k==='form'?PP.season+' Form':l]);
  return `<table class="pp-nt" data-key="${ssEsc(s.key)}"><tbody>${labs.map(([k,l])=>`<tr><th>${ssEsc(l)}</th><td><div class="pp-ed" contenteditable="true" spellcheck="true" data-note="${k}" data-key="${ssEsc(s.key)}" aria-label="${ssEsc(l+' — '+s.name)}">${ssEsc(note[k]||'')}</div></td></tr>`).join('')}</tbody></table>`;
}
function ppShotMap(S, key){
  const mine=S.R.shots.filter(s=>s.pk===key&&s.x!=null);
  if(!mine.length) return `<div class="pp-map na">Shot map n/a<small>${ssEsc(S.R.shots.some(s=>s.x!=null)?'no located shot of his in these games':'no shot in these games has a pitch location')}</small></div>`;
  return `<div class="pp-map">${ttMapSVG(mine, {view:'loc'})}<small>${mine.length} located shot${mine.length===1?'':'s'} · filled = scored</small></div>`;
}
function ppPlayerHTML(T, s, ctx, col){
  const key=pyKey(s.name), real=ctx.Sf.rows.has(key)?key:null, keeper=ppIsKeeper(s);
  const saved=ppNotes(T, key)||{}, draft=ppDraft({S:ctx.Sf, C:ctx.Sc, T, key:real, keeper, comp:PP.comp, season:PP.season}), note={};
  PP_NOTE_KEYS.forEach(([k])=>{ note[k]=saved[k]!=null?saved[k]:draft[k]; });
  const sk=Object.assign({}, s, {key});
  return `<section class="pp-pl${keeper?' gk':''}" data-key="${ssEsc(key)}">${ppBarHTML(s, T, col, saved.club||'')}`
    +`<div class="pp-row"><div class="pp-side">${cohPlayerBadgeHTML(T, s.name, {cls:'pp-badge', color:col.bar})}${keeper?'':ppShotMap(ctx.Sf, real)}`
    +`<label class="pp-noprint pp-club">Club <input type="text" data-club="${ssEsc(key)}" value="${ssEsc(saved.club||'')}" placeholder="type the club"></label>`
    +`<button type="button" class="pp-noprint mini" data-ppreset="${ssEsc(key)}" title="Replace this player’s notes with the draft from the figures">Re-draft notes</button></div>`
    +`<div class="pp-main">${ppSeasonTable(T, real, ctx.Sf, ctx.Sc, PP, col, ctx.So)}${ppNotesTable(T, sk, keeper, note)}${keeper||typeof pyBandsHTML!=='function'?'':pyBandsHTML(ctx.Sf.R.shots.filter(x=>real&&x.pk===real), null, {print:true, gameOf:ctx.Sf.R.gameOf, label:'Full '+PP.season, cmp2:ctx.Sc?{label:pdCompShort(PP.comp)+' only', shots:ctx.Sc.R.shots.filter(x=>real&&x.pk===real)}:null})}</div></div></section>`;
}
function ppChainTable(T, s, ctx, col){
  const A=ppChains(ctx.Sf, T, s.name), B=ctx.Sc?ppChains(ctx.Sc, T, s.name):null, cs=pdCompShort(PP.comp);
  const cols=[]; TK_LENS.forEach(([l,n])=>{ cols.push([A[l], n+' (Full)']); if(B) cols.push([B[l], n+' ('+cs+')']); });
  const src=A.src, f=(o,k)=>o[k]==null?'n/a':(k==='pct'||k==='conv')?(o[k]==null?'n/a':Math.round(o[k])+'%'):o[k];
  const R=[['taken','Kickouts taken'],['pct','Kickout win %'],['shots','Shots generated'],['scores','Scores'],['one','Points'],['two','2-Pts'],['goals','Goals'],['value','Total value'],['conv','Conversion %']];
  const fg=typeof cohInkOn==='function'?cohInkOn(col.bar):'#fff';
  return `<table class="pp-kc"><thead><tr style="background:${ssEsc(col.bar)};color:${fg}"><th>${ssEsc(s.name)} — Kickout Chains</th>${cols.map(c=>`<th>${ssEsc(c[1])}</th>`).join('')}</tr></thead><tbody>`
    +R.map(([k,l])=>`<tr><th>${l}</th>${cols.map((c,i)=>`<td class="${i%2&&B?'cmp':''}">${f(c[0],k)}</td>`).join('')}</tr>`).join('')+'</tbody></table>'
    +`<div class="pp-fn">${ssEsc((A.byKeeper?'His kickouts (Kickout Taken By tags). ':'All '+titleCase(T)+' kickouts — the games do not name the kicker. ')+'Won % = won by '+titleCase(T)+'. Shots generated / scores / value = '+titleCase(T)+'’s shots whose tagged source is Own Kickout after a kickout '+titleCase(T)+' won, before the next kickout (the Kickouts tab’s WHAT FOLLOWED); Points = 1-point scores, Total value = points value. '+(src?'':'n/a: no shot source tags in these games. ')+'Lengths as tagged (Short / Mid-Range / Long).')}</div>`;
}
function ppKoMaps(T, ctx){
  const m=(S, lab)=>{ const A=ppChains(S, T, ''); const k=A.located;
    return `<div class="pp-kmap">${k.length?tkMapSVG(k, null):'<div class="pp-map na">Kickout map n/a<small>no kickout in these games has a landing location</small></div>'}<small>${ssEsc(lab+(k.length?' · '+k.length+' located':''))}</small></div>`; };
  return `<div class="pp-kmaps">${m(ctx.Sf, 'Full '+PP.season)}${ctx.Sc?m(ctx.Sc, PP.comp+' '+PP.season):''}</div>`;
}
function ppCoverHTML(T, ctx, col, list){
  const crest=typeof cohCrestSrc==='function'?cohCrestSrc(T):null, fg=typeof cohInkOn==='function'?cohInkOn(col.bar):'#fff';
  const n=Object.values(PP.slots).filter(s=>s&&s.name).length;
  return `<div class="pp-cover" style="--cp:${ssEsc(col.bar)};--cs:${ssEsc(col.tag||col.bar)}"><div class="pp-cband" style="background:${ssEsc(col.bar)};color:${fg}">`
    +(crest?`<img class="pp-ccrest" src="${ssEsc(crest)}" alt="${ssEsc(T)} crest">`:`<div class="pp-ccrest pp-c0" style="border-color:${ssEsc(col.tag||'#fff')}">${ssEsc(pdOppShort(T))}</div>`)
    +`<h1>${ssEsc(titleCase(T))}</h1><h2>Senior Panel · ${n} players</h2></div>${pdStripeHTML(col.tertiary?col:{bands:[col.tag||col.bar]}, 'pp-cbands')}`
    +`<dl class="pp-cdl"><dt>Competition</dt><dd>${ssEsc(PP.comp+' '+PP.season)}</dd><dt>Opponent</dt><dd><span class="pp-ed" contenteditable="true" data-cover="opponent" aria-label="Opponent">${ssEsc(PP.cover.opponent||'')}</span></dd><dt>Date</dt><dd><span class="pp-ed" contenteditable="true" data-cover="date" aria-label="Date">${ssEsc(PP.cover.date||'')}</span></dd></dl>`
    +`<div class="pp-cfoot">${ssEsc('Figures from '+ctx.Sf.games.length+' '+titleCase(T)+' games in '+PP.season+' ('+ctx.Sf.games.map(g=>pdCompShort(g.competition)).filter((x,i,a)=>a.indexOf(x)===i).join(', ')+'), '+(ctx.Sc?ctx.Sc.games.length+' of them '+PP.comp:'')+'.'+(ctx.So?' Opponent record: the '+ctx.soN+' uploaded game'+(ctx.soN===1?'':'s')+' v '+titleCase(PP.opp)+'.':'')+' “n/a” = the files do not carry it.')}</div></div>`;
}
function ppAssistsHTML(T, S, scope){
  const lab=scope==='comp'?PP.comp+' '+PP.season:'Full '+PP.season;
  if(!S) return `<h3 class="pp-h">Assist by Footballer — ${ssEsc(lab)}:</h3><p class="pp-p">n/a — no ${ssEsc(PP.comp)} games in ${ssEsc(PP.season)}.</p>`;
  const A=ppAssists(S), top=A.rows.slice(0,10), x=v=>v==null?'n/a':v.toFixed(1), q=v=>v==null?'n/a':v.toFixed(2);
  return `<h3 class="pp-h">Assist by Footballer — ${ssEsc(lab)}:</h3><p class="pp-p">${ssEsc('Who is providing the '+titleCase(T)+' shooters and free takers with the most shots ('+lab+', '+S.games.length+' game'+(S.games.length===1?'':'s')+'; '+A.tagged+' of '+A.total+' shots name an assist).')}</p>`
    +`<table class="pp-at"><thead><tr><th>Assist</th><th>Shots</th><th>Goals</th><th>Two Pts</th><th>Pts</th><th>Total Pts</th><th>ExPts</th><th>Avg Shot Quality</th></tr></thead><tbody>`
    +top.map(r=>`<tr><td>${ssEsc(r.name)}</td><td>${r.shots}</td><td>${r.goals}</td><td>${r.two}</td><td>${r.one}</td><td>${r.pts}</td><td>${x(r.xp)}</td><td>${q(r.q)}</td></tr>`).join('')+'</tbody></table>'
    +`<div class="pp-fn">${ssEsc('Top '+top.length+' of '+A.rows.length+' by shots assisted. Pts = 1-point scores; Total Pts = points value. ExPts / Avg Shot Quality (ExPts ÷ shots) need xP, which needs a pitch location'+(A.rows.some(r=>r.xp!=null)?'':': n/a, no shot in these games has one')+'.')}</div>`
    +`<p class="pp-p">The top 5 link-ups — which player assists whom the most.</p><table class="pp-at pp-lk"><thead><tr><th>Rank</th><th>Assist -&gt; Shooter</th><th>Shots</th><th>Score</th></tr></thead><tbody>`
    +A.links.map((l,i)=>`<tr><td>${i+1}</td><td>${ssEsc(l.a+' -> '+l.s)}</td><td>${l.shots}</td><td>${ssEsc(l.score)}</td></tr>`).join('')+'</tbody></table>'
    +'<div class="pp-fn">Score = goals-two pointers-points (points value).</div>';
}
function ppPagesHTML(T, ctx, col, list){
  const pages=ppPages(PP);
  return pages.map((p,i)=>{ let h='';
    if(p.kind==='cover') h=ppCoverHTML(T, ctx, col, list);
    else if(p.kind==='gk') h=ppPlayerHTML(T, p.slots[0], ctx, col)+ppChainTable(T, p.slots[0], ctx, col)+ppKoMaps(T, ctx);
    else if(p.kind==='out') h=p.slots.map(s=>ppPlayerHTML(T, s, ctx, col)).join('');
    else h=ppAssistsHTML(T, p.scope==='comp'?ctx.Sc:ctx.Sf, p.scope);
    return `<div class="pp-page pp-${p.kind}" data-kind="${p.kind}"${p.scope?` data-scope="${p.scope}"`:''}><div class="pp-in">${h}</div><div class="pp-pn"><span class="pp-staff">Staff only – not for circulation</span> · ${i+1} / ${pages.length}</div></div>`; }).join('');
}
function ppPickerHTML(T, ctx, list, lim){
  const squad=ctx.Sf.F.players.slice().sort((a,b)=>a.name.localeCompare(b.name)), N=Math.max(15, +PP.size||lim.limit);
  const used=new Map(); Object.keys(PP.slots).forEach(n=>{ const s=PP.slots[n]; if(s&&s.key) used.set(s.key, +n); });
  const seasons=pdSeasons(list), comps=pdComps(list, PP.season), over=Object.keys(PP.slots).filter(n=>+n>lim.limit&&PP.slots[n]&&PP.slots[n].name);
  let h=`<div class="pp-ctl pp-noprint"><label class="pd-f"><span>SEASON</span><select id="ppSeason">${seasons.map(s=>`<option${s===PP.season?' selected':''}>${s}</option>`).join('')}</select></label>`
    +`<label class="pd-f"><span>ONE COMPETITION</span><select id="ppComp">${comps.map(c=>`<option${c===PP.comp?' selected':''}>${ssEsc(c)}</option>`).join('')}</select></label>`
    +`<label class="pd-f"><span>OPPONENT RECORD</span><select id="ppOpp"><option value="">— none —</option>${pdOpps(list, T).map(o=>`<option value="${ssEsc(o)}"${o===PP.opp?' selected':''}>v ${ssEsc(titleCase(o))} (${list.filter(g=>pdIsOpp(g,o)).length})</option>`).join('')}</select></label>`
    +`<label class="pd-f"><span>PANEL SIZE</span><select id="ppSize">${[26,30,40].map(n=>`<option value="${n}"${n===N?' selected':''}>${n}</option>`).join('')}</select></label>`
    +`<button type="button" class="act primary" data-ppprint="1">Print / Save as PDF</button><button type="button" class="act" data-ppclear="1">Clear the squad</button></div>`
    +`<div class="pp-warn pp-noprint">${ssEsc(PP.comp+' is '+lim.label+': numbers up to '+lim.limit+'.')}${N>lim.limit?' <b>⚠ The panel size ('+N+') is above that limit.</b>':''}${over.length?' <b>⚠ Number'+(over.length===1?' ':'s ')+over.join(', ')+' '+(over.length===1?'is':'are')+' above '+lim.limit+'.</b>':''}</div>`;
  h+=`<details class="pp-pick pp-noprint" open><summary>SQUAD — pick a player for each number (${Object.values(PP.slots).filter(s=>s&&s.name).length} of ${N} filled)</summary><div class="pp-slots">`;
  for(let n=1;n<=N;n++){ const s=PP.slots[n]||{}, free=!!s.free;
    const opts=`<option value="">—</option>`+squad.map(p=>`<option value="${ssEsc(p.key)}"${s.key===p.key&&!free?' selected':''}${used.has(p.key)&&used.get(p.key)!==n?' disabled':''}>${ssEsc(p.name)}</option>`).join('')+`<option value="__free"${free?' selected':''}>Type a name…</option>`;
    h+=`<div class="pp-slot${n===16?' first-sub':''}"><b>${n}</b><div class="pp-sf"><select data-ppslot="${n}" aria-label="Number ${n}">${opts}</select>`
      +(free?`<input type="text" data-ppfree="${n}" value="${ssEsc(s.name||'')}" placeholder="name (no data)" aria-label="Name for number ${n}">`:'')
      +(n>15?`<select data-ppline="${n}" aria-label="Line of number ${n}" title="The sub’s line: a goalkeeper gets the goalkeeper page">${PP_LINES.map(l=>`<option value="${l[0]}"${(s.line||'')===l[0]?' selected':''}>${l[1]}</option>`).join('')}</select>`:'')
      +`<input type="text" class="pp-posin" data-pppos="${n}" value="${ssEsc(s.pos||'')}" placeholder="${ssEsc(ppPosLabel(n, s.line))}" aria-label="Position label for number ${n}" title="The position printed for this game day (empty = ${ssEsc(ppPosLabel(n, s.line))})"></div></div>`; }
  h+=`</div><div class="dnote">The list: everyone named on a ${ssEsc(titleCase(T))} event in ${ssEsc(PP.season)} (a player is on one number only). “Type a name…” adds someone with no data. The POSITION box is the label printed for this game day — type over it; left empty it is the slot’s (1 Goalkeeper … 15 Left Corner Forward; a sub: his line + “(Sub)”). A sub picked as a goalkeeper gets the goalkeeper page. The squad, the labels, clubs, the cover’s opponent and date and every note are kept in this browser only.</div></details>`;
  return h;
}
function ppRender(){
  const wrap=ssEl('ppWrap'); if(!wrap||!PD_TEAM||!pdIsStaff()) return;   // staff only: nothing of the print-out (notes included) for anyone else
  const T=PD_TEAM, list=pdTeamList(T);
  if(PP_TEAM!==T){ PP_TEAM=T; PP=ppLoad(T, list); }
  const seasons=pdSeasons(list); if(!seasons.includes(PP.season)) PP.season=seasons[0]||'';
  const comps=pdComps(list, PP.season); if(!comps.includes(PP.comp)) PP.comp=comps[0]||'';
  const games=pdRangeGames(list, {kind:'season', season:PP.season}), cg=pdRangeGames(list, {kind:'comp', season:PP.season, comp:PP.comp});
  if(PP.opp&&!pdOpps(list, T).includes(PP.opp)) PP.opp='';
  const og=PP.opp?pdRangeGames(list, {kind:'opp', opp:PP.opp}):[];
  const ctx={Sf:pdSummaries(T, games, pdBundleOf), Sc:cg.length?pdSummaries(T, cg, pdBundleOf):null, So:og.length?pdSummaries(T, og, pdBundleOf):null, soN:og.length}, col=pdColours(T), lim=ppLimit(list, PP.comp);
  pdApplyCol(col);
  wrap.innerHTML=ppPickerHTML(T, ctx, list, lim)+`<div class="pp-pages" id="ppPages">${ppPagesHTML(T, ctx, col, list)}</div>`;
  ppFit();
}
function ppFit(){ const p=ssEl('ppPages'); if(!p||!p.style) return; const w=p.parentNode&&p.parentNode.clientWidth||0; const z=w>0?Math.min(1, w/800):1; p.style.zoom=String(+z.toFixed(3)); }
function ppSlotSet(n, v){
  if(!PP) return; const cur=PP.slots[n]||{};
  if(!v){ if(cur.pos) PP.slots[n]={pos:cur.pos}; else delete PP.slots[n]; }
  else if(v==='__free'){ PP.slots[n]={key:'', name:cur.free?cur.name:'', free:true, line:cur.line||''}; if(cur.pos) PP.slots[n].pos=cur.pos; }
  else { const S=pdSummaries(PD_TEAM, pdRangeGames(pdTeamList(PD_TEAM), {kind:'season', season:PP.season}), pdBundleOf), p=S.F.byKey.get(v);
    PP.slots[n]={key:v, name:p?p.name:v, free:false, line:cur.line||(n>15&&p&&p.line?p.line:'')}; if(cur.pos) PP.slots[n].pos=cur.pos; }
  ppSave(); ppRender();
}
function ppClick(e){
  if(!pdIsStaff()) return false;
  const t=e.target, c=s=>t&&t.closest?t.closest(s):null; let x;
  if((x=c('[data-ppprint]'))){ ppFit(); const p=ssEl('ppPages'); if(p) p.style.zoom='1'; try{ window.print(); }finally{ ppFit(); } return true; }
  if((x=c('[data-ppclear]'))){ PP.slots={}; ppSave(); ppRender(); return true; }
  if((x=c('[data-ppreset]'))){ const k=x.dataset.ppreset, n=ppNotes(PD_TEAM, k)||{}; ppStore(ppNoteKey(PD_TEAM, k), n.club?{club:n.club}:null); ppRender(); return true; }
  return false;
}
function ppChange(e){
  const t=e.target; if(!t||!PP||!pdIsStaff()) return;
  if(t.id==='ppSeason'){ PP.season=t.value; ppSave(); ppRender(); return; }
  if(t.id==='ppComp'){ PP.comp=t.value; PP.size=ppLimit(pdTeamList(PD_TEAM), PP.comp).limit; ppSave(); ppRender(); return; }
  if(t.id==='ppSize'){ PP.size=+t.value; ppSave(); ppRender(); return; }
  if(t.id==='ppOpp'){ PP.opp=t.value; if(PP.opp&&!String(PP.cover.opponent||'').trim()) PP.cover.opponent=titleCase(PP.opp); ppSave(); ppRender(); return; }   // the record v the next opponent: a row in every season table
  if(t.dataset&&t.dataset.ppslot){ ppSlotSet(+t.dataset.ppslot, t.value); return; }
  if(t.dataset&&t.dataset.pppos){ const n=+t.dataset.pppos, v=String(t.value||'').replace(/\s+/g,' ').trim(); PP.slots[n]=Object.assign(PP.slots[n]||{}, {pos:v}); if(!v) delete PP.slots[n].pos; if(!Object.keys(PP.slots[n]).length) delete PP.slots[n]; ppSave(); ppRender(); return; }
  if(t.dataset&&t.dataset.ppline){ const n=+t.dataset.ppline; if(PP.slots[n]){ PP.slots[n].line=t.value; ppSave(); ppRender(); } return; }
  if(t.dataset&&t.dataset.ppfree){ const n=+t.dataset.ppfree; if(PP.slots[n]){ PP.slots[n].name=String(t.value||'').replace(/\s+/g,' ').trim(); PP.slots[n].key=pyKey(PP.slots[n].name); ppSave(); ppRender(); } return; }
  if(t.dataset&&t.dataset.club!=null){ ppNoteSet(t.dataset.club, 'club', t.value); return; }
}
// a note / club typed in: saved at once (this browser). The note keeps every field (a field never edited keeps its draft).
function ppNoteSet(key, field, val){
  if(!PD_TEAM||!key) return;
  const T=PD_TEAM, cur=ppNotes(T, key)||{};
  if(field!=='club'&&!PP_NOTE_KEYS.every(([k])=>cur[k]!=null)){
    // first edit of this player: keep the other fields as drafted now, so they do not change under him later
    const games=pdRangeGames(pdTeamList(T), {kind:'season', season:PP.season}), cg=pdRangeGames(pdTeamList(T), {kind:'comp', season:PP.season, comp:PP.comp});
    const S=pdSummaries(T, games, pdBundleOf), slot=Object.values(PP.slots).find(s=>s&&pyKey(s.name)===key)||{no:0};
    const d=ppDraft({S, C:cg.length?pdSummaries(T, cg, pdBundleOf):null, T, key:S.rows.has(key)?key:null, keeper:ppIsKeeper(slot), comp:PP.comp, season:PP.season});
    PP_NOTE_KEYS.forEach(([k])=>{ if(cur[k]==null) cur[k]=d[k]; });
  }
  cur[field]=String(val==null?'':val);
  ppStore(ppNoteKey(T, key), cur);
  if(field==='club'){ document.querySelectorAll('.pp-pl[data-key="'+(window.CSS&&CSS.escape?CSS.escape(key):key)+'"] .pp-nm small').forEach(x=>{ x.textContent=cur.club; }); }
}
function ppInput(e){
  const t=e.target; if(!t||!t.dataset||!pdIsStaff()) return;
  if(t.dataset.note&&t.dataset.key){ ppNoteSet(t.dataset.key, t.dataset.note, t.innerText.replace(/\n+$/,'')); return; }
  if(t.dataset.cover&&PP){ PP.cover[t.dataset.cover]=t.innerText.trim(); ppSave(); }
}

// ═════ styles (screen + print) ═════
function pdStyle(){
  if(typeof document==='undefined'||!document.head||document.getElementById('pdCss')) return;
  const s=document.createElement('style'); s.id='pdCss'; s.textContent=PD_CSS; document.head.appendChild(s);
}
const PD_CSS=`
#pane-player-dash{--pa:var(--accent);--pb:#c9c9d4;--pp:#4fc3f7;--ps:#4fc3f7;}
.pd-views{display:flex;justify-content:center;margin:0 0 14px;} .pd-views .seg button{padding:10px 18px;font-size:14px;}
#pane-player-dash .seg button.on{background:var(--pa);color:#0b0b10;}
.pd-ctl,.pp-ctl{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:flex-end;background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:12px 14px;margin-bottom:14px;}
.pd-f{display:flex;flex-direction:column;gap:5px;min-width:0;} .pd-f>span{font:700 10px 'Barlow Condensed',sans-serif;letter-spacing:.12em;color:var(--t3);} .pd-f select{max-width:100%;}
.pd-f .seg{flex-wrap:wrap;}
.pd-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:18px;align-items:center;background:linear-gradient(120deg,color-mix(in srgb,var(--pp) 30%,var(--panel)) 0%,var(--panel) 55%);border:1px solid var(--border);border-radius:16px;padding:16px 18px;margin-bottom:14px;border-left:5px solid var(--pa);}
.pd-photo .coh-pb{--pbs:112px;width:112px;height:112px;font-size:38px;border-radius:14px;}
.pd-who h2{margin:0;font:800 40px/1.02 'Barlow',sans-serif;letter-spacing:-.01em;} .pd-who h2 span{color:var(--t1);} .pd-who h2 b{color:var(--pa);}
.pd-stripe{display:flex;} .pd-stripe i{flex:1 1 0;display:block;}
.pd-uline{width:120px;height:5px;margin-top:8px;gap:2px;} .pd-uline i{border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,.22);}
.pp-cbands{height:6mm;} .pp-cbands i{box-shadow:inset 0 0 0 .3mm rgba(0,0,0,.18);}
.pp-bedge{height:1.4mm;} .pp-bedge i{box-shadow:inset 0 0 0 .2mm rgba(0,0,0,.18);}
.pd-team{display:flex;gap:12px;align-items:center;margin-top:10px;} .pd-crest{width:44px;height:44px;object-fit:contain;flex:none;}
.pd-crest0{display:grid;place-items:center;border-radius:50%;border:2px solid var(--pb);background:var(--pp);color:#fff;font:800 13px 'Barlow Condensed',sans-serif;}
.pd-tn{font:700 19px 'Barlow',sans-serif;} .pd-sheet{color:var(--t2);font-size:.95rem;cursor:help;}
.pd-range{border:1px solid var(--border);background:var(--card);border-radius:12px;padding:10px 14px;display:flex;flex-direction:column;gap:3px;max-width:300px;} .pd-range span{font:700 10px 'Barlow Condensed',sans-serif;letter-spacing:.14em;color:var(--t3);} .pd-range b{font:700 16px 'Barlow',sans-serif;}
.pd-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:14px;}
.pd-grp{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:10px 12px;min-width:0;} .pd-grp h4{margin:2px 2px 8px;font:800 13px 'Barlow Condensed',sans-serif;letter-spacing:.14em;color:var(--pa);}
.pd-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;}
.pd-tile{background:var(--card);border:1px solid var(--border);border-radius:11px;padding:9px 8px 8px;text-align:center;min-width:0;}
.pd-tile.na{opacity:.72;} .pd-tile.na .pd-tv{color:var(--t3);}
.pd-ic{width:20px;height:20px;fill:none;stroke:var(--pa);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
.pd-tl{font-size:.78rem;color:var(--t2);margin-top:2px;} .pd-tv{font:800 26px/1.1 'Barlow',sans-serif;margin:3px 0;}
.pd-tc{font:700 .72rem 'Barlow',sans-serif;color:var(--t3);line-height:1.25;overflow-wrap:anywhere;} .pd-tc.pos{color:var(--green);} .pd-tc.neg{color:var(--red);} .pd-tc.mid{color:var(--t2);} .pd-tc.na{font-weight:400;font-size:.66rem;}
.pd-panels{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr) minmax(0,1fr);grid-template-areas:'a b c' 'a d c';gap:12px;}
.pd-maps .py-maps{margin-top:4px;}
.pd-area{margin-top:18px;} .pd-area>h3{margin:0 2px 10px;font:800 15px 'Barlow Condensed',sans-serif;letter-spacing:.16em;color:var(--pa);border-bottom:1px solid var(--border);padding-bottom:6px;}
.pd-area-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;} .pd-area-g>.tt-card{min-width:0;} .pd-area-g .wide{grid-column:1/-1;}
.pd-area .pf-pat,.pd-area .pf-oo{margin:0;} .pd-area .td-ct{color:var(--pa);}
.pd-dt{width:100%;} .pd-dt tr.sub th{padding-left:18px;font-weight:400;color:var(--t2);}
.pd-p1{grid-area:a;} .pd-p2{grid-area:b;} .pd-p3{grid-area:c;} .pd-p4{grid-area:d;} .pd-p5{grid-area:e;}
.pd-p .td-ct{color:var(--pa);}
.pd-ph{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;} .pd-ph .td-ct{margin:0;}
.pd-radar{display:block;width:100%;height:auto;max-width:420px;margin:0 auto;} .pd-rg{fill:none;stroke:#34343f;stroke-width:1;} .pd-rl{font:600 11.5px 'Barlow',sans-serif;fill:var(--t1);} .pd-rv{fill:var(--t3);font-weight:400;}
.pd-rp{fill-opacity:.28;stroke-width:2.2;} .pd-rt{fill:rgba(200,200,212,.08);stroke:#b8b8c4;stroke-width:1.4;stroke-dasharray:4 3;}
.pd-leg{display:flex;gap:14px;flex-wrap:wrap;font-size:.8rem;color:var(--t2);margin:6px 0;} .pd-leg i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:-1px;} .pd-leg i.sq{background:#8a8a96;}
.pd-scroll{overflow-x:auto;} .pd-trend{display:block;width:100%;height:auto;} .pd-tg{stroke:#2c2c38;} .pd-ta{font:500 11px 'Barlow',sans-serif;fill:var(--t2);} .pd-tv2{font:700 12px 'Barlow',sans-serif;fill:var(--t1);} .pd-tdnp{font:600 11px 'Barlow',sans-serif;fill:var(--t3);}
.pd-br{display:grid;grid-template-columns:minmax(0,130px) minmax(0,1fr) 46px;gap:8px;align-items:center;margin:9px 0;font-size:.85rem;} .pd-br.na{grid-template-columns:minmax(0,1fr) auto;color:var(--t3);} .pd-br em{font-style:normal;}
.pd-bt{display:flex;flex-direction:column;gap:3px;} .pd-bt i{display:block;height:8px;border-radius:4px;} .pd-bt i.sq{background:#6d6d7a;height:6px;}
.pd-br b{text-align:right;font-size:.85rem;} .pd-br b small{display:block;color:var(--t3);font-weight:400;font-size:.72rem;}
.pd-score{display:grid;grid-template-columns:minmax(0,1fr) 116px;gap:14px;align-items:center;}
.pd-sbar{display:flex;height:66px;border-radius:10px;overflow:hidden;} .pd-sb{display:flex;flex-direction:column;justify-content:center;align-items:center;color:#fff;min-width:34px;}
.pd-sb b{font:800 21px 'Barlow',sans-serif;} .pd-sb span{font-size:.74rem;font-weight:700;}
.pd-sb.one,.pd-sleg i.one{background:color-mix(in srgb,var(--pp) 80%,#000);} .pd-sb.two,.pd-sleg i.two{background:#b8892b;} .pd-sb.gl,.pd-sleg i.gl{background:#c8343b;}
.pd-sleg{display:flex;gap:14px;flex-wrap:wrap;font-size:.8rem;color:var(--t2);margin-top:10px;} .pd-sleg i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;}
.pd-ring{width:110px;height:110px;} .pd-rgb{fill:none;stroke:#2c2c38;stroke-width:9;} .pd-rn{font:800 26px 'Barlow',sans-serif;fill:var(--t1);} .pd-rs{font:600 9.5px 'Barlow',sans-serif;fill:var(--t2);}
.pd-boxes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;} .pd-box{display:flex;gap:10px;align-items:center;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:8px 10px;min-width:0;}
.pd-box span{display:block;font-size:.74rem;color:var(--t2);} .pd-box b{font:800 20px 'Barlow',sans-serif;} .pd-box.na b{color:var(--t3);font-size:15px;}
.pd-bx{flex:none;width:16px;height:22px;border-radius:3px;background:var(--pa);} .pd-bx.yel{background:#f2c200;} .pd-bx.blk{background:#111;border:1px solid #555;} .pd-bx.red{background:#e0303a;} .pd-bx.fouls,.pd-bx.toL{background:#a0a0ae;border-radius:50%;width:18px;height:18px;} .pd-bx.toW,.pd-bx.poss,.pd-bx.tck{border-radius:50%;width:18px;height:18px;}
.pd-foot{margin:12px 4px 0;} .pd-tsub{font-size:.68rem;color:var(--amber);line-height:1.2;margin:-1px 0 2px;}
.pd-w{background:transparent;border:1px solid var(--pa);color:var(--pa);border-radius:999px;padding:3px 9px;font:700 11px 'Barlow',sans-serif;cursor:pointer;white-space:nowrap;margin:2px 4px 2px 0;}
.pd-w:hover,.pd-w:focus-visible{background:var(--pa);color:#0b0b10;} .pd-grp h4 .pd-w{margin-left:8px;letter-spacing:0;}
.pd-wrow{margin-top:8px;display:flex;flex-wrap:wrap;gap:2px;} .pd-ws{display:flex;flex-wrap:wrap;gap:2px;} .py-bw{text-align:right;white-space:nowrap;}
.pd-range .pd-w{align-self:flex-start;}
@media (max-width:1100px){ .pd-panels{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-areas:'a b' 'c d';} .pd-area-g{grid-template-columns:minmax(0,1fr);} }
@media (max-width:760px){ .pd-head{grid-template-columns:auto minmax(0,1fr);} .pd-range{grid-column:1/-1;max-width:none;} .pd-who h2{font-size:28px;} .pd-photo .coh-pb{--pbs:76px;width:76px;height:76px;font-size:26px;}
  .pd-groups{grid-template-columns:minmax(0,1fr);} .pd-panels{grid-template-columns:minmax(0,1fr);grid-template-areas:'a' 'b' 'c' 'd';} .pd-tiles{grid-template-columns:repeat(2,minmax(0,1fr));} .pd-score{grid-template-columns:minmax(0,1fr);justify-items:center;} .pd-sbar{width:100%;}
  .pd-f .seg button{padding:9px 8px;} .pd-f select{width:100%;} .pd-f{flex:1 1 140px;} }
/* ── PANEL PRINT-OUT ── */
.pp-warn{font-size:.82rem;color:var(--t2);margin:-6px 4px 10px;} .pp-warn b{color:var(--amber);}
.pp-pick{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:6px 14px 12px;margin-bottom:16px;} .pp-pick summary{cursor:pointer;font:700 12px 'Barlow Condensed',sans-serif;letter-spacing:.08em;color:var(--t2);padding:8px 0;}
.pp-slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:6px 14px;}
.pp-slot{display:grid;grid-template-columns:28px minmax(0,1fr);gap:6px;align-items:center;font-size:.85rem;} .pp-sf{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;min-width:0;} .pp-slot b{text-align:right;color:var(--pa);} .pp-slot select,.pp-slot input{min-width:0;width:100%;padding:6px 6px;font-size:.82rem;}
.pp-slot input{background:var(--card);border:1px solid var(--border);border-radius:8px;color:var(--t1);}
.pp-slot.first-sub{grid-column:1/-1;border-top:1px solid var(--border);padding-top:8px;margin-top:4px;} .pp-sl{color:var(--t3);font-size:.78rem;}
.pp-pages{display:flex;flex-direction:column;align-items:center;gap:18px;transform-origin:top left;}
.pp-page{width:210mm;height:297mm;background:#fff;color:#161616;position:relative;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.5);font-family:'Barlow',Arial,sans-serif;}
.pp-in{padding:14mm 12mm 12mm;height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:5mm;}
.pp-pn{position:absolute;right:10mm;bottom:6mm;font-size:9px;color:#888;} .pp-staff{font-weight:700;color:#8b1a1a;letter-spacing:.02em;}
.pp-bar{display:grid;grid-template-columns:22mm minmax(0,1fr) 58mm;min-height:13mm;align-items:stretch;}
.pp-no{display:grid;place-items:center;font:800 15px 'Barlow',sans-serif;border-right:1px solid rgba(255,255,255,.25);} .pp-nm{padding:2mm 4mm;display:flex;flex-direction:column;justify-content:center;} .pp-nm b{font:800 16px 'Barlow',sans-serif;} .pp-nm small{font-size:10px;opacity:.85;min-height:12px;}
.pp-pos{display:grid;place-items:center;font:700 13px 'Barlow',sans-serif;text-align:center;padding:0 3mm;}
.pp-row{display:grid;grid-template-columns:44mm minmax(0,1fr);gap:5mm;margin-top:3mm;}
.pp-side{display:flex;flex-direction:column;gap:3mm;align-items:center;} .pp-side .coh-pb{--pbs:40mm;width:40mm;height:40mm;font-size:36px;border-radius:6px;}
.pp-st,.pp-nt,.pp-kc,.pp-at{width:100%;border-collapse:collapse;font-size:11px;}
.pp-st th{font:600 13px 'Barlow',sans-serif;text-align:left;padding:1.5mm 2mm;border:1px solid #fff;} .pp-st td{border:1px solid #cfd4cf;padding:1mm 2mm;text-align:center;font-size:12px;} .pp-st td:first-child{text-align:left;} .pp-st tr:nth-child(2) td{background:#eef2ee;} .pp-st td.na{color:#888;font-size:10.5px;}
.pp-nt{margin-top:3mm;} .pp-nt th{width:32mm;text-align:left;vertical-align:middle;border:1px solid #cfd4cf;padding:1.1mm 2mm;font:700 12px 'Barlow',sans-serif;} .pp-nt td{border:1px solid #cfd4cf;padding:1.5mm 2mm;vertical-align:top;} .pp-nt tr:nth-child(even){background:#eef2ee;}
.pp-ed{min-height:4.5mm;font-size:10px;line-height:1.32;outline:none;white-space:pre-wrap;} .pp-ed:focus{background:#fff8d6;box-shadow:0 0 0 1px #e0c35a;}
.pp-pl.gk .pp-ed{font-size:10.5px;}
.pp-out .pp-pl{height:132mm;overflow:hidden;} .pp-out .pp-pl+.pp-pl{margin-top:4mm;}
.pp-map{width:42mm;text-align:center;font-size:9px;color:#555;} .pp-map .tt-pitch{width:100%;height:auto;display:block;border-radius:3px;} .pp-map small{display:block;margin-top:1mm;}
.pp-map.na{border:1px dashed #bbb;border-radius:4px;padding:5mm 2mm;color:#666;font-size:10px;font-weight:700;} .pp-map.na small{font-weight:400;}
.pp-club{display:flex;flex-direction:column;font-size:10px;color:#444;width:42mm;} .pp-club input{border:1px solid #bbb;border-radius:4px;padding:1mm 2mm;font-size:11px;}
.pp-side .mini{font-size:10px;}
.pp-kc th,.pp-kc td{border:1px solid #d9ddd9;padding:1.4mm 1.5mm;text-align:center;font-size:10px;} .pp-kc tbody th{text-align:left;font-weight:700;} .pp-kc td.cmp{color:#8b1a1a;} .pp-kc thead th{font-size:9.5px;}
.pp-fn{font-size:8.5px;color:#555;line-height:1.35;}
.pp-bt{width:100%;border-collapse:collapse;font-size:9px;line-height:1.15;margin-top:2mm;} .pp-bt th,.pp-bt td{border:1px solid #d9ddd9;padding:.35mm 1.5mm;text-align:center;} .pp-bt tbody th{text-align:left;font-weight:600;} .pp-bt tr.bsub th{padding-left:4mm;font-weight:400;color:#444;} .pp-bt thead th{background:#f0f2f0;}
.pp-misc{color:#8a5a00;} .pp-bands.na{margin-top:2.5mm;font-size:9.5px;font-weight:700;color:#555;border:1px dashed #bbb;border-radius:3px;padding:1.5mm 2mm;} .pp-bands.na small{font-weight:400;}
.pp-kmaps{display:flex;gap:6mm;justify-content:center;} .pp-kmap{width:60mm;text-align:center;font-size:9px;color:#555;} .pp-kmap .tt-pitch{width:100%;height:auto;} .pp-kmap .pp-map.na{width:auto;}
.pp-h{color:var(--pp);font:800 15px 'Barlow',sans-serif;margin:0;} .pp-p{font-size:13px;margin:0;color:#222;}
.pp-at th{background:#111;color:#fff;padding:2.2mm 2mm;text-align:right;font:700 11.5px 'Barlow',sans-serif;} .pp-at th:first-child,.pp-at td:first-child{text-align:left;} .pp-at td{border:1px solid #777;padding:2mm;text-align:right;font-size:12px;}
.pp-lk th:nth-child(2),.pp-lk td:nth-child(2){text-align:left;}
.pp-cover .pp-in{padding:0;} .pp-cband{padding:30mm 16mm 16mm;display:flex;flex-direction:column;align-items:flex-start;gap:4mm;} .pp-ccrest{width:34mm;height:34mm;object-fit:contain;}
.pp-c0{display:grid;place-items:center;border:3px solid;border-radius:50%;font:800 26px 'Barlow',sans-serif;}
.pp-cband h1{font:800 46px 'Barlow',sans-serif;margin:4mm 0 0;} .pp-cband h2{font:600 20px 'Barlow',sans-serif;margin:0;opacity:.9;} .pp-cstripe{height:5mm;}
.pp-cdl{display:grid;grid-template-columns:40mm minmax(0,1fr);gap:4mm 6mm;padding:14mm 16mm;font-size:17px;margin:0;} .pp-cdl dt{font-weight:700;color:#555;} .pp-cdl dd{margin:0;min-height:7mm;border-bottom:1px solid #ddd;}
.pp-cdl .pp-ed{font-size:inherit;display:block;min-height:7mm;}
.pp-cfoot{position:absolute;left:16mm;right:16mm;bottom:14mm;font-size:10px;color:#666;}
/* ── the dashboard's LANDSCAPE print (#pdPrint) ── */
#pdPrint{display:none;}
@page pdland{size:A4 landscape;margin:0;}
#pdPrint{--panel:#ffffff;--card:#f5f6f5;--border:#d4d7d4;--t1:#141414;--t2:#3a3a3a;--t3:#5c5c5c;--accent:var(--pa);font-family:'Barlow',Arial,sans-serif;color:#141414;}
.pdp-page{page:pdland;width:297mm;height:210mm;box-sizing:border-box;padding:7mm 8mm 9mm;position:relative;overflow:hidden;background:#fff;break-after:page;page-break-after:always;display:flex;flex-direction:column;gap:2.4mm;font-size:7.5pt;}
.pdp-page:last-child{break-after:auto;page-break-after:auto;}
.pdp-page *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.pdp-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:4mm;align-items:center;position:relative;padding-bottom:2.2mm;}
.pdp-head .coh-pb{--pbs:16mm;width:16mm;height:16mm;font-size:18pt;border-radius:3mm;}
.pdp-who h1{margin:0;font:800 18pt 'Barlow',sans-serif;color:var(--pa);} .pdp-who div{font-size:9pt;display:flex;align-items:center;gap:2mm;} .pdp-crest{width:7mm;height:7mm;object-fit:contain;}
.pdp-meta{display:flex;gap:5mm;} .pdp-meta div{display:flex;flex-direction:column;} .pdp-meta span{font:700 6pt 'Barlow Condensed',sans-serif;letter-spacing:.12em;color:#666;} .pdp-meta b{font-size:8.5pt;}
.pdp-stripe{position:absolute;left:0;right:0;bottom:0;height:1.2mm;} .pdp-stripe i{box-shadow:inset 0 0 0 .2mm rgba(0,0,0,.15);}
.pdp-tiles{display:grid;grid-template-columns:1.7fr 1.3fr 1fr 1.3fr;gap:2mm;align-items:start;}
.pdp-grp{border:1px solid #d4d7d4;border-radius:2mm;padding:1.2mm 1.5mm;break-inside:avoid;} .pdp-grp h4{margin:0 0 1mm;font:800 7pt 'Barlow Condensed',sans-serif;letter-spacing:.12em;color:var(--pa);}
.pdp-tg{display:grid;grid-template-columns:repeat(auto-fill,minmax(17mm,1fr));gap:1mm;}
.pdp-tg .pd-tile{padding:.8mm .6mm;border-radius:1.2mm;background:#f5f6f5;border:1px solid #e1e4e1;} .pdp-tg .pd-ic{display:none;}
.pdp-tg .pd-tl{font-size:6.3pt;color:#3a3a3a;margin:0;} .pdp-tg .pd-tv{font-size:11pt;margin:.2mm 0;color:#141414;} .pdp-tg .pd-tc{font-size:6pt;} .pdp-tg .pd-tile.na{opacity:1;} .pdp-tg .pd-tile.na .pd-tc{display:none;}
.pdp-tg .pd-tsub{font-size:6pt;color:#8a5a00;margin:0;} .pdp-tg .pd-tc.pos{color:#157a35;} .pdp-tg .pd-tc.neg{color:#b42318;}
.pdp-row{display:grid;grid-template-columns:60mm minmax(0,1fr) 44mm 98mm;gap:2mm;height:74mm;flex:none;} .pdp-row .pd-radar{overflow:visible;}
.pdp-card{border:1px solid #d4d7d4;border-radius:2mm;padding:1.5mm 2mm;min-width:0;overflow:hidden;break-inside:avoid;background:#fff;}
.pdp-card h4,.pdp-card .td-ct{margin:0 0 1mm;font:800 7.5pt 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:var(--pa);}
.pdp-card .tt-card{background:transparent;border:0;padding:0;border-radius:0;}
.pdp-card .pd-radar{max-width:100%;} .pdp-card .pd-trend{min-width:0 !important;width:100%;} .pd-rl{fill:#141414;} .pd-rg{stroke:#cfd2cf;} .pd-tg{stroke:#e3e5e3;}
.pdp-card .pd-score{grid-template-columns:minmax(0,1fr);justify-items:center;gap:1mm;} .pdp-card .pd-sbar{height:10mm;width:100%;} .pdp-card .pd-ring{width:22mm;height:22mm;} .pdp-card .pd-rgb{stroke:#e3e5e3;} .pdp-card .pd-rn{fill:#141414;}
.pdp-maps .py-maps{display:grid !important;grid-template-columns:repeat(3,minmax(0,1fr)) !important;gap:1.5mm;} .pdp-maps .py-map{grid-column:auto !important;min-width:0;} .pdp-maps .tt-pitch{width:100%;height:auto;max-height:48mm;display:block;} .pdp-maps .py-map h3{font-size:6.5pt;margin:0;} .pdp-maps .py-maph{display:flex;justify-content:space-between;gap:1mm;font-size:6pt;} .pdp-maps .py-nomap{min-height:0;height:auto;padding:2mm;font-size:6.5pt;}
.pdp-maps .tt-key{font-size:6pt;gap:1.5mm;flex-wrap:wrap;}
#pdPrint .dnote,#pdPrint .pd-w,#pdPrint .pd-wrow,#pdPrint .py-bw,#pdPrint .py-misc small,#pdPrint .pd-sleg{display:none !important;}
.pdp-note{font-size:6pt;color:#555;line-height:1.3;}
.pdp-foot{position:absolute;left:8mm;right:8mm;bottom:3.5mm;display:flex;justify-content:space-between;font-size:6pt;color:#777;}
.pdp-h2{font:800 10pt 'Barlow',sans-serif;color:var(--pa);border-bottom:1.2mm solid var(--pp);padding-bottom:1mm;}
.pdp-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2mm;flex:1 1 auto;min-height:0;align-content:start;}
.pdp-grid .pdp-bands{grid-column:span 2;} .pdp-grid .wide{grid-column:1/-1;}
#pdPrint table{width:100%;border-collapse:collapse;font-size:7pt;} #pdPrint th,#pdPrint td{padding:.5mm 1mm;border-bottom:1px solid #e3e5e3;color:#141414;} #pdPrint thead th{font-size:6.3pt;color:#555;}
#pdPrint .py-bt,#pdPrint table{min-width:0 !important;} #pdPrint .pdp-oo{grid-column:span 2;} #pdPrint .py-bb{display:none;} #pdPrint .py-misc{background:#fff8e6;border-color:#e0b860;color:#5a4410;padding:1mm 2mm;font-size:6.5pt;margin:1mm 0 0;}
#pdPrint .py-bh{font-size:7.5pt;margin:0 0 1mm;} #pdPrint .py-scroll{overflow:visible;} #pdPrint .tt-ztab td.pos,#pdPrint .py-bt td.pos{color:#157a35;} #pdPrint .tt-ztab td.neg,#pdPrint .py-bt td.neg{color:#b42318;}
#pdPrint .pf-ll li{font-size:7pt;} #pdPrint .pf-l2 h5{font-size:6.5pt;margin:0 0 .5mm;} #pdPrint .pf-oohd b{font-size:12pt;} #pdPrint .tt-empty{padding:2mm;font-size:7pt;}
#pdPrint .pf-pat,#pdPrint .pf-oo{margin:0;}
@media print{
  body.pd-printing > *:not(#pdPrint){display:none !important;}
  body.pd-printing #pdPrint{display:block !important;}
  body:not(.pd-printing) #pdPrint{display:none !important;}
  @page{size:A4;margin:0;}
  html,body{background:#fff !important;overflow:visible !important;}
  header,.tabs,.filters,#gamesPick,#status,#pdStatus,.pd-views,#pdBody,.pp-noprint,.pane:not(#pane-player-dash){display:none !important;}
  html body[data-tab=player-dash] #ovCtl.only-team{display:none !important;}
  .pd-w,.pd-wrow,.cp-modal,#mockSources{display:none !important;}
  .wrap{max-width:none !important;margin:0 !important;padding:0 !important;}
  .pp-pages{zoom:1 !important;gap:0;display:block;} .pp-page{box-shadow:none;break-after:page;page-break-after:always;} .pp-page:last-child{break-after:auto;page-break-after:auto;}
  .pp-ed:focus{background:none;box-shadow:none;}
}
`;
