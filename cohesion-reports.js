/* COHESION — Analysis › REPORTS: three printable A4 reports for a chosen team and a chosen set of games (Barry, Oct 2026).
 * Content modelled on the iGaelicCoach Team Report / Opposition Analysis / Kickout Report; the look is COHESION's (the Player
 * Dashboard print: white A4 pages, Barlow, the team's colours, its crest).
 *
 *   1. TEAM REPORT          — our team over the selected games;
 *   2. OPPOSITION ANALYSIS  — the same figures framed as "the opponent" (their kickout, turnovers, shooting, key players, how
 *                             teams scored against them, game by game, their defeats);
 *   3. KICKOUT REPORT       — ONE game, one team's own kickouts.
 *
 * EVERY FIGURE COMES FROM AN EXISTING ANALYSIS ENGINE — nothing here counts a game again:
 *   · per-game tallies (points, possessions, productivity, shots, goal chances, 2-pointers, kickouts, turnovers, sources):
 *     ssTallyCached → ssAggregate, and ovCompute (Overview: productivity, turnover thirds, score sources);
 *   · kickouts: tkGameKos / tkByLen / tkCompute (Team Trends › Kickouts), who won each: pyKoWho (Players tab);
 *   · shots: pyCompute (Players tab: player, foot, pressure, attempt, xP) and ttGameShots for the shots against;
 *     distance = cohShotDistM (cohesion-shotbands.js = xpForShot(...).parts.dist, radial from the goal-line centre) in the
 *     scoring image's bands (Inside 13m / 13–20 / 20–30 / 30–40 / 40m+); the attempt-type rule: only the games whose MISSED
 *     shots carry an attempt type (ssAttMissGames);
 *   · the shooters table: pyPlayers + pfCompute (games played);
 *   · ranks: the same per-team aggregates for EVERY team with games of the same competition and season that are uploaded
 *     (pfRanks: highest first, ties share), "Nth of N teams with data"; no rank with only one team. The championship
 *     average = the mean of those teams' figures (each team once), read the same way as the ranks.
 * A figure the games cannot supply is "n/a" with the reason, or left out (never 0). No written coaching text: numbers,
 * charts, tables and short factual captions only. Visible to everyone signed in; no staff notes are ever read here.
 * Globals are prefixed rp.
 */

// ═════ games, order, colours ═════
const RP_KINDS=[['team','Team Report'],['opp','Opposition Analysis'],['ko','Kickout Report']];
const RP_DIST=[['Inside 13m',0,13],['13–20m',13,20],['20–30m',20,30],['30–40m',30,40],['40m+',40,Infinity]];
const RP_PROFILE_MIN=5;     // player profiles: the main shooters, 5+ shots
const RP_MISSED_TOP=5;
// round order inside a competition (an undated game is placed by its round)
function rpRoundW(r){ const s=String(r||'').toLowerCase().trim(), m=/(\d+)\s*([a-z]?)\s*$/.exec(s), n=m?+m[1]+(m[2]?0.5:0):0;
  if(/prelim(inary)?\s*quarter/.test(s)) return 60; if(/quarter/.test(s)||/^qf$/.test(s)) return 70; if(/semi/.test(s)||/^sf$/.test(s)) return 80; if(/^final$|^f$/.test(s)) return 90;
  if(/prelim/.test(s)) return 1; if(/group/.test(s)) return 30+n; if(/round|^r\d/.test(s)) return 10+n; return 50; }
function rpOrd(a, b){ const d=rpRoundW(a.round)-rpRoundW(b.round); if(d) return d; const x=ssIsoDate(a.date)||'', y=ssIsoDate(b.date)||''; return x<y?-1:x>y?1:0; }
// the games of competition `comp` in `season` (all teams), oldest first
function rpCompGames(games, season, comp){ return (games||[]).filter(g=>pdSeasonOf(g)===season&&String(g.competition||'').trim()===comp).slice().sort(rpOrd); }
function rpTeamGames(games, T, season, comp){ return rpCompGames(games, season, comp).filter(g=>ssTeamIn(g, T)); }
function rpOpp(g, T){ return ssUC(g.homeTeam)===T?String(g.awayTeam||'').trim():String(g.homeTeam||'').trim(); }
function rpTeamName(T, games){ for(const g of games||[]){ if(ssUC(g.homeTeam)===T) return String(g.homeTeam).trim(); if(ssUC(g.awayTeam)===T) return String(g.awayTeam).trim(); } return titleCase(T); }
function rpPct(n, d){ return d>0?n/d*100:null; }
function rpP(v){ return v==null?'n/a':Math.round(v)+'%'; }
function rpF(v, dp){ return v==null?'n/a':v.toFixed(dp==null?1:dp); }
function rpSg(v, dp){ if(v==null) return 'n/a'; const r=+v.toFixed(dp==null?1:dp); return (r>0?'+':r<0?'−':'±')+Math.abs(r).toFixed(dp==null?1:dp); }
function rpFrac(w, n){ return n?w+'/'+n:'–'; }
function rpPF(w, n){ return n?rpP(rpPct(w, n))+' ('+w+'/'+n+')':'–'; }
function rpGl(n){ return n+' game'+(n===1?'':'s'); }
function rpCov(nWith, n, what){ return !n?'':nWith===n?'all '+rpGl(n)+(what?' ('+what+')':''):nWith?'from '+nWith+' of '+rpGl(n)+(what?' ('+what+')':''):'n/a — no '+(what||'data')+' in these games'; }

// ═════ ranks: every team with games of the competition and season that are uploaded ═════
// k, label, f(aggT, aggO, extra) → value | null (n/a), dp, pct?, signed?, lo (lower is better), basis (the tally that says the
// games behind the figure: 'possGames' …) — the same definitions as Overview / Compare (ssMetrics)
const RP_METRICS=[
  {k:'ppg', l:'Points per game', f:(a)=>a.games?a.pts/a.games:null, dp:1},
  {k:'cpg', l:'Points conceded per game', f:(a,o)=>o.games?o.pts/o.games:null, dp:1, lo:true},
  {k:'prod', l:'Productivity', sub:'points per 10 possessions', f:a=>a.possCount>0?a.ptsPossG/a.possCount*10:null, dp:2, need:'possessions'},
  {k:'conv', l:'Shot-to-score %', f:a=>a.shots?a.scores/a.shots*100:null, pct:true},
  {k:'poss', l:'Possessions per game', f:a=>a.possGames?a.possCount/a.possGames:null, dp:1, need:'possessions'},
  {k:'possShot', l:'Possession-to-shot %', f:a=>a.possCount?a.shotsPossG/a.possCount*100:null, pct:true, need:'possessions'},
  {k:'gch', l:'Goal chances per game', f:a=>(a.attemptData||a.goalCh>0)&&a.games?a.goalCh/a.games:null, dp:1},
  {k:'two', l:'2-pointers per game', f:a=>a.games?a.twoPts/a.games:null, dp:1},
  {k:'ownKo', l:'Own kickouts retained %', f:a=>a.koData&&a.ownKO?a.ownKOWon/a.ownKO*100:null, pct:true, need:'kickout outcomes'},
  {k:'oppKo', l:'Opposition kickouts won %', f:a=>a.koData&&a.oppKO?a.oppKOWonByT/a.oppKO*100:null, pct:true, need:'kickout outcomes'},
  {k:'longKo', l:'Long kickouts retained %', f:(a,o,x)=>x&&x.longKo!=null?x.longKo:null, pct:true, need:'kickout lengths'},
  {k:'netKo', l:'Net points per own kickout', sub:'scored − conceded off own kickouts', f:a=>a.koData&&a.srcData&&a.ownKO>0?(a.ptsFromOwnKO-a.ptsConcededOwnKO)/a.ownKO:null, dp:2, signed:true, need:'score sources'},
  {k:'toW', l:'Turnovers forced per game', sub:'in play', f:a=>a.toGames?a.toWon/a.toGames:null, dp:1, need:'turnover rows'},
  {k:'toL', l:'Turnovers lost per game', sub:'in play', f:a=>a.toGames?a.toLost/a.toGames:null, dp:1, lo:true, need:'turnover rows'},
  {k:'ptsTo', l:'Points from turnovers per game', f:a=>a.srcScoreGames?SS_SRC_TO_KEYS.reduce((s,k)=>s+(a['srcP:'+k]||0),0)/a.srcScoreGames:null, dp:1, need:'score sources'},
  {k:'xpd', l:'Points v expected per game', sub:'located shots', f:a=>a.xpGames?(a.xpPts-a.xp)/a.xpGames:null, dp:1, signed:true, need:'shot locations'},
  {k:'sag', l:'Shots against per game', f:(a,o)=>o.games?o.shots/o.games:null, dp:1, lo:true},
  {k:'oconv', l:'Opposition shot-to-score %', f:(a,o)=>o.shots?o.scores/o.shots*100:null, pct:true, lo:true}];
function rpMetric(k){ return RP_METRICS.find(m=>m.k===k); }
function rpFmt(m, v){ if(v==null) return 'n/a'; if(m.pct) return Math.round(v)+'%'; return m.signed?rpSg(v, m.dp):v.toFixed(m.dp==null?1:m.dp); }
// one team over a list of games: its aggregate, the opposition's, the extras (long kickouts, the distance bands)
function rpTeamAgg(T, games, bundleOf){
  const rows=games.map(g=>{ const b=bundleOf(g.id); if(!b||!b.meta||!Array.isArray(b.events)) return null; const O=ssUC(b.meta.homeTeam)===T?ssUC(b.meta.awayTeam):ssUC(b.meta.homeTeam);
    return {g, b, tT:ssTallyCached(b, T), tO:ssTallyCached(b, O)}; }).filter(r=>r&&r.tT&&r.tO);
  const aT=ssAggregate(rows.map(r=>r.tT)), aO=ssAggregate(rows.map(r=>r.tO));
  const kos=[].concat(...rows.map(r=>{ const K=tkGameKos(r.b.meta, r.b.events); return K?K.kos.filter(k=>k.team===T):[]; })), L=tkByLen(kos);
  const shots=[].concat(...rows.map(r=>ttGameShots(r.b.meta, r.b.events).filter(s=>s.team===T)));
  return {T, n:rows.length, aT, aO, x:{longKo:L.L.n?L.L.pct:null, koLen:L, bands:rpBands(shots)}};
}
// → {teams:[T], of:{k → Map(T → {rank, tie, of})}, val:{T → {k → v}}, avg:{k → v}, games, n (teams)}
function rpRanks(compGames, bundleOf){
  const teams=[...new Set([].concat(...compGames.map(g=>[ssUC(g.homeTeam), ssUC(g.awayTeam)])))].filter(Boolean).sort();
  const val={}, agg={};
  teams.forEach(T=>{ const A=rpTeamAgg(T, compGames.filter(g=>ssTeamIn(g, T)), bundleOf); agg[T]=A; val[T]={};
    if(!A.n) return; RP_METRICS.forEach(m=>{ const v=m.f(A.aT, A.aO, A.x); val[T][m.k]=v==null||!isFinite(v)?null:v; }); });
  const withData=teams.filter(T=>agg[T].n>0), of={}, avg={};
  RP_METRICS.forEach(m=>{ const list=withData.map(T=>({key:T, v:val[T][m.k]==null?null:(m.lo?-val[T][m.k]:val[T][m.k])}));
    of[m.k]=pfRanks(list); const vs=withData.map(T=>val[T][m.k]).filter(v=>v!=null); avg[m.k]=vs.length?vs.reduce((a,b)=>a+b,0)/vs.length:null; });
  // the distance bands: each team's conversion per band, the championship average = the mean of the teams with shots there
  const bandAvg=RP_DIST.map((d,i)=>{ const p=withData.map(T=>agg[T].x.bands.rows[i]).filter(r=>r.shots>0).map(r=>r.pct); return p.length?p.reduce((a,b)=>a+b,0)/p.length:null; });
  const bandAgO=RP_DIST.map((d,i)=>bandAvg[i]);
  const koLenAvg={}; ['S','M','L'].forEach(l=>{ const p=withData.map(T=>agg[T].x.koLen[l]).filter(r=>r.n>0).map(r=>r.pct); koLenAvg[l]=p.length?p.reduce((a,b)=>a+b,0)/p.length:null; });
  const bandTeams=withData.filter(T=>agg[T].x.bands.located>0).length, koLenTeams=withData.filter(T=>['S','M','L'].some(l=>agg[T].x.koLen[l].n>0)).length;
  return {teams:withData, of, val, avg, bandAvg, bandAgO, koLenAvg, bandTeams, koLenTeams, games:compGames.length, loaded:compGames.filter(g=>bundleOf(g.id)).length, n:withData.length, agg};
}
function rpRankOf(RK, T, k){ if(!RK||RK.n<2) return null; const r=RK.of[k]&&RK.of[k].get(T); return r&&r.of>=2?r:null; }
function rpRankTxt(r){ return r?(r.tie?'=':'')+ovOrd(r.rank)+' of '+r.of:''; }

// ═════ shots ═════
function rpDist(s){ const f=typeof cohShotDistM==='function'?cohShotDistM:null; const d=f?f(s):null; return d!=null&&isFinite(d)?d:null; }
function rpTally(list){ const n=list.length, sc=list.filter(s=>s.v>0), xs=list.filter(s=>s.xp!=null), xp=xs.reduce((a,s)=>a+s.xp,0), xpPts=xs.reduce((a,s)=>a+(s.v>0?s.v:0),0);
  return {shots:n, scores:sc.length, pts:sc.reduce((a,s)=>a+s.v,0), pct:rpPct(sc.length, n), xp:xs.length?xp:null, xpShots:xs.length, diff:xs.length?xpPts-xp:null}; }
// the five distance bands of a list of shots (located shots only; a '45 or a penalty with no location is not placed)
function rpBands(shots){ const loc=(shots||[]).map(s=>({s, d:rpDist(s)})).filter(x=>x.d!=null);
  return {rows:RP_DIST.map(([l,a,b])=>Object.assign({label:l}, rpTally(loc.filter(x=>x.d>=a&&x.d<b).map(x=>x.s)))), located:loc.length, total:(shots||[]).length,
    locGames:new Set(loc.map(x=>x.s.gid)).size, avg:loc.length?loc.reduce((a,x)=>a+x.d,0)/loc.length:null}; }
const RP_PR={L:'Low pressure', M:'Medium pressure', H:'High pressure'};
// the wind, only when a game tags it: the value of any label group named "… wind …" on the shot
function rpWind(s){ const L=(s.e&&s.e.labels)||{}; const k=Object.keys(L).find(x=>/wind/i.test(x)&&String(L[x]||'').trim()); return k?String(L[k]).trim():''; }
// the shooting tables of a list of shots. teamShots: the team's shots in those games (decides the games whose misses carry
// the attempt type — ssAttMissGames)
function rpShooting(shots, teamShots){
  const games=new Set(shots.map(s=>s.gid)), okG=ssAttMissGames(teamShots||shots), att=shots.filter(s=>okG.has(s.gid));
  const typeRows=[['1','Point attempts'],['2','2-point attempts'],['G','Goal attempts']].map(([k,l])=>Object.assign({k, label:l}, rpTally(att.filter(s=>s.att===k))));
  const attGames=[...games].filter(g=>okG.has(g)).length;
  const prT=shots.filter(s=>s.pr==='L'||s.pr==='M'||s.pr==='H'), legT=shots.filter(s=>s.leg==='L'||s.leg==='R'||s.leg==='H');
  const sit=[{label:'Open play', ...rpTally(shots.filter(s=>!s.dead))}, {label:'Placed balls (dead ball)', ...rpTally(shots.filter(s=>s.dead))}];
  const press=['L','M','H'].map(k=>Object.assign({k, label:RP_PR[k]}, rpTally(shots.filter(s=>s.pr===k))));
  const foot=[['L','Left foot'],['R','Right foot'],['H','Hand']].map(([k,l])=>Object.assign({k, label:l}, rpTally(shots.filter(s=>s.leg===k))));
  const wv=[...new Set(shots.map(rpWind).filter(Boolean))].sort(), wind=wv.map(v=>Object.assign({label:'Wind: '+v}, rpTally(shots.filter(s=>rpWind(s)===v))));
  return {all:rpTally(shots), games:games.size, typeRows, attGames, attTagged:att.filter(s=>s.att).length, sit, press, prTagged:prT.length, prGames:new Set(prT.map(s=>s.gid)).size,
    foot, legTagged:legT.length, legGames:new Set(legT.map(s=>s.gid)).size, wind, windGames:new Set(shots.filter(rpWind).map(s=>s.gid)).size, bands:rpBands(shots),
    located:shots.filter(s=>s.x!=null&&s.y!=null)};
}
function rpTypeTxt(s){ return s.kind==='P'||s.deadType==='Penalty'?'Penalty':s.att==='G'?'Goal attempt':s.att==='2'?'2-point attempt':s.att==='1'?(s.dead&&s.deadType&&s.deadType!=='Dead ball'?(s.deadType==='45'?'’45':s.deadType):'Point attempt'):(s.dead?(s.deadType==='45'?'’45':s.deadType||'Dead ball'):'Not tagged'); }
// the highest-xP missed shots
function rpMissed(shots, titleOf, n){ return shots.filter(s=>!(s.v>0)&&s.xp!=null).sort((a,b)=>b.xp-a.xp).slice(0, n||RP_MISSED_TOP)
  .map(s=>({player:s.player||'Not tagged', game:titleOf(s.gid), type:rpTypeTxt(s), dist:rpDist(s), pr:RP_PR[s.pr]||'Not tagged', out:s.out?titleCase(s.out):'n/a', xp:s.xp})); }

// ═════ the TEAM / OPPOSITION model ═════
// T (uppercase), sel = the ticked game metas, ctx = {bundleOf, RK (rpRanks or null), comp, season}
function rpCompute(T, sel, ctx){
  const bo=ctx.bundleOf, games=sel.slice().sort(rpOrd).filter(g=>bo(g.id)), nm=rpTeamName(T, games);
  const ov=ovCompute(T, games, 'all', bo), aT=ov.aggT, aO=ov.aggO, n=ov.n;
  const titleOf=gid=>{ const g=games.find(x=>x.id===gid); return g?String(g.title||(g.homeTeam+' v '+g.awayTeam)):''; };
  // per game
  const per=games.map(g=>{ const b=bo(g.id), O=ssUC(rpOpp(g, T)), tT=ssTallyCached(b, T), tO=ssTallyCached(b, O), m=ovMatch(g, tT, tO, T);
    const K=tkGameKos(b.meta, b.events), own=K?K.kos.filter(k=>k.team===T):[], opp=K?K.kos.filter(k=>k.team!==T):[], LT=tkByLen(own), LO=tkByLen(opp);
    const pto=t=>t.srcScoreGames?SS_SRC_TO_KEYS.reduce((s,k)=>s+(t['srcP:'+k]||0),0):null;
    return {g, O, oppName:rpOpp(g, T), m, tT, tO, res:m.res, date:g.date||'', round:g.round||'',
      poss:tT.possCount>0?tT.possCount:null, possO:tO.possCount>0?tO.possCount:null, prod:tT.possCount>0?tT.pts/tT.possCount*10:null, prodO:tO.possCount>0?tO.pts/tO.possCount*10:null,
      ownKo:tT.koData?{w:tT.ownKOWon, n:tT.ownKO}:null, ownKoO:tO.koData?{w:tO.ownKOWon, n:tO.ownKO}:null,
      longKo:LT.L.n?{w:LT.L.won, n:LT.L.n}:null, longKoO:LO.L.n?{w:LO.L.won, n:LO.L.n}:null,
      toL:tT.toGames?tT.toLost:null, toW:tT.toGames?tT.toWon:null, toLO:tO.toGames?tO.toLost:null, ptsTo:pto(tT), ptsToO:pto(tO)}; });
  const rec={W:per.filter(p=>p.res==='W').length, D:per.filter(p=>p.res==='D').length, L:per.filter(p=>p.res==='L').length};
  // kickouts (Team Trends' tkCompute over exactly these games)
  const KC=tkCompute(T, games, 'all', bo, games);
  // shots: the Players tab's (pyCompute) for and ttGameShots against
  const R=pyCompute(T, games, bo), F=pfCompute(T, games, bo, R);
  const faced=[].concat(...games.map(g=>{ const b=bo(g.id), O=ssUC(rpOpp(g, T)); return ttGameShots(b.meta, b.events).filter(s=>s.team===O).map(s=>Object.assign({}, s, {pr:ssPressLevel(s.e), leg:pyLeg(s.e), side:pySide(s.e)})); }));
  const SH=rpShooting(R.shots, R.shots), SA=rpShooting(faced, faced);
  // the shooters table + profiles
  const okG=ssAttMissGames(R.shots);
  const shooters=pyPlayers(R.shots).filter(r=>r.shots>0).map(r=>{ const mine=R.shots.filter(s=>s.pk===r.key), fp=F.byKey.get(r.key), b=rpBands(mine), a2=mine.filter(s=>okG.has(s.gid)&&s.att==='2');
    return Object.assign({}, r, {gp:fp?fp.gp:r.shotGames, diff:r.xpShots?r.xpPts-r.xp:null, twoAtt:a2.length, twoMade:a2.filter(s=>s.v===2).length, twoTyped:mine.some(s=>okG.has(s.gid)),
      L:mine.filter(s=>s.leg==='L').length, R:mine.filter(s=>s.leg==='R').length, H:mine.filter(s=>s.leg==='H').length, legTagged:mine.filter(s=>s.leg).length, avgM:b.avg, located:b.located, shotsList:mine}); })
    .sort((a,b)=>b.pts-a.pts||b.total-a.total||b.shots-a.shots||(a.name<b.name?-1:1));
  const profiles=shooters.filter(r=>r.shots>=RP_PROFILE_MIN).map(r=>Object.assign({}, r, {S:rpShooting(r.shotsList, R.shots)}));
  // sources: points scored / conceded by where the ball came from (the Overview's categories)
  const srcRows=SS_SRC_CATS.map(c=>({k:c.k, label:RP_SRC_NAME[c.k]||c.label, col:c.col, extra:!!c.extra, sc:aT['srcP:'+c.k]||0, co:aO['srcP:'+c.k]||0})).filter(r=>!r.extra||r.sc||r.co);
  // the opposition's kickouts, from the selected team's side (won = T won them)
  const oppLen=tkByLen(KC.opp.kos, true);
  const RK=ctx.RK, rank=k=>rpRankOf(RK, T, k), V=k=>{ const m=rpMetric(k); const v=m.f(aT, aO, {longKo:KC.own.len.L.n?KC.own.len.L.pct:null}); return v==null||!isFinite(v)?null:v; };
  const dates=games.map(g=>ssIsoDate(g.date)).filter(Boolean).sort();
  return {T, name:nm, games, n, per, rec, ov, aT, aO, KC, oppLen, R, F, SH, SA, faced, shooters, profiles, srcRows, titleOf, RK, rank, V,
    comp:ctx.comp||'', season:ctx.season||'', from:dates[0]||'', to:dates[dates.length-1]||'', noPlayer:R.noPlayer};
}

// ═════ the KICKOUT model: one game, one team's own kickouts ═════
const RP_KO_TYPE={clean:'C', break:'B', sideline:'SL', free:'F', unspecified:'–'};
const RP_KO_TYPE_NAME={clean:'Clean catch', break:'Break', sideline:'Sideline', free:'Free', unspecified:'Not tagged'};
const RP_KO_OPT=[['contested','Contested By'],['oppContested','Opp Contested By'],['nums','Numbers At Drop'],['press','Press Shape']];
function rpKoDepth(d){ return d==null?null:d<45?'Up to 45m':d<65?'45–65m':d<=70?'65m–half':'Opp half'; }
function rpKoSide(x){ return x==null?null:x<33.3?'Left':x<66.7?'Centre':'Right'; }
function rpClock(t){ if(t==null||!isFinite(t)) return 'n/a'; const s=Math.max(0, Math.round(t)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
function rpHalfOf(e){ const h=ssUC(e&&e.half); return /^ET\s*2|^ET.*2ND|EXTRA.*2/.test(h)?'ET2':/^ET|EXTRA/.test(h)?'ET1':/^2/.test(h)?'2':/^1/.test(h)?'1':''; }
function rpKoCompute(T, g, ctx){
  const b=ctx.bundleOf(g.id); if(!b) return null;
  const K=tkGameKos(b.meta, b.events), KI=typeof cohKoIndexCached==='function'?cohKoIndexCached(b.events, b.meta):null;
  const all=K?K.kos:[], O=ssUC(rpOpp(g, T));
  const kos=all.filter(k=>k.team===T).map((k,i)=>{ const who=pyKoWho(k, KI), opt={};
    RP_KO_OPT.forEach(([key, grp])=>{ const v=ssLblCI(k.e, [grp]); if(v&&String(v).trim()) opt[key]=String(v).trim(); });
    return Object.assign({}, k, {no:i+1, half:rpHalfOf(k.e), who:who&&who.role==='winner'?who:null, target:(typeof tkTargetOf==='function'?tkTargetOf(k):'')||(who&&who.role==='target'?who.name:''), takenBy:ssLblCI(k.e,['Kickout Taken By'])||'',
      depth:rpKoDepth(k.dist), side:rpKoSide(k.x), opt, video:rpClock(k.e&&k.e.start), clock:String((k.e&&k.e.gameTime)||'').trim()}); });
  const L=tkByLen(kos), types={}; Object.keys(RP_KO_TYPE).forEach(t=>{ const a=kos.filter(k=>k.type===t); types[t]={n:a.length, won:a.filter(k=>k.won).length}; });
  const cell=(len, t)=>{ const a=kos.filter(k=>(len==='all'||k.len===len)&&(t==='all'||k.type===t)); return {n:a.length, won:a.filter(k=>k.won).length}; };
  const lens=['S','M','L'].concat(kos.some(k=>!k.len)?['X']:[]);
  const grid=lens.map(l=>({len:l, cells:Object.keys(RP_KO_TYPE).map(t=>cell(l==='X'?null:l, t)), all:cell(l==='X'?null:l, 'all')}));
  const gridAll={cells:Object.keys(RP_KO_TYPE).map(t=>cell('all', t)), all:cell('all','all')};
  const located=kos.filter(k=>k.x!=null&&k.dist!=null);
  const depth=['Up to 45m','45–65m','65m–half','Opp half'].map(d=>{ const a=located.filter(k=>k.depth===d); return {label:d, n:a.length, won:a.filter(k=>k.won).length}; });
  const side=['Left','Centre','Right'].map(s=>{ const a=located.filter(k=>k.side===s); return {label:s, n:a.length, won:a.filter(k=>k.won).length}; });
  // who won each: the 'Kickout Won By' player, grouped by his team
  const wonBy=side2=>{ const m=new Map(); let none=0; kos.forEach(k=>{ const mine=k.won===(side2==='T'); if(!mine) return; if(!k.who||!k.who.name){ none++; return; }
      const key=pyKey(k.who.name); let r=m.get(key); if(!r){ r={names:{}, n:0, clean:0, brk:0, lens:{S:0,M:0,L:0,X:0}}; m.set(key, r); } r.names[k.who.name]=(r.names[k.who.name]||0)+1; r.n++; if(k.type==='clean') r.clean++; if(k.type==='break') r.brk++; r.lens[k.len||'X']++; });
    return {rows:[...m.values()].map(r=>({name:pyBestName(r.names), n:r.n, clean:r.clean, brk:r.brk, lens:r.lens})).sort((a,b)=>b.n-a.n||(a.name<b.name?-1:1)), none}; };
  const halves=[...new Set(kos.map(k=>k.half))];
  const follow=K&&K.srcTagged?{sc:kos.filter(k=>k.won&&k.follow).reduce((a,k)=>a+k.follow.pts,0), co:kos.filter(k=>!k.won&&k.follow).reduce((a,k)=>a+k.follow.pts,0)}:null;
  const opts=RP_KO_OPT.filter(([key])=>kos.some(k=>k.opt[key]));
  return {T, name:rpTeamName(T, [g]), g, O, oppName:rpOpp(g, T), kos, n:kos.length, won:kos.filter(k=>k.won).length, L, types, grid, gridAll, located:located.length, depth, side,
    wonByT:wonBy('T'), wonByO:wonBy('O'), halves, follow, opts, srcFrom:K?K.srcFrom:null, oppKos:all.filter(k=>k.team!==T).length};
}

// ═════ the KICKOUT model over SEVERAL games: the single-game models, summed ═════
// Each game is rpKoCompute's own model (so a game's figures are exactly its single-game report's); the totals are their
// sums. Timing bands and the next kickout after a loss: the Team Trends engine (tkCompute → tkTimingCompute) over the games.
function rpKoMultiCompute(T, sel, ctx){
  const bo=ctx.bundleOf, games=sel.slice().sort(rpOrd).filter(g=>bo(g.id)), per=games.map(g=>rpKoCompute(T, g, ctx)).filter(Boolean);
  const kos=[].concat(...per.map((K,gi)=>K.kos.map(k=>Object.assign({}, k, {gi}))));
  const sum=f=>per.reduce((a,K)=>a+f(K),0), L=tkByLen(kos), types={};
  Object.keys(RP_KO_TYPE).forEach(t=>{ types[t]={n:sum(K=>K.types[t].n), won:sum(K=>K.types[t].won)}; });
  const depth=per[0]?per[0].depth.map((d,i)=>({label:d.label, n:sum(K=>K.depth[i].n), won:sum(K=>K.depth[i].won)})):[];
  const side=per[0]?per[0].side.map((d,i)=>({label:d.label, n:sum(K=>K.side[i].n), won:sum(K=>K.side[i].won)})):[];
  const merge=k=>{ const m=new Map(); let none=0; per.forEach(K=>{ none+=K[k].none; K[k].rows.forEach(r=>{ const key=pyKey(r.name); let q=m.get(key); if(!q){ q={names:{}, n:0, clean:0, brk:0, lens:{S:0,M:0,L:0,X:0}}; m.set(key, q); }
      q.names[r.name]=(q.names[r.name]||0)+r.n; q.n+=r.n; q.clean+=r.clean; q.brk+=r.brk; ['S','M','L','X'].forEach(l=>{ q.lens[l]+=r.lens[l]; }); }); });
    return {rows:[...m.values()].map(r=>({name:pyBestName(r.names), n:r.n, clean:r.clean, brk:r.brk, lens:r.lens})).sort((a,b)=>b.n-a.n||(a.name<b.name?-1:1)), none}; };
  const fg=per.filter(K=>K.follow), follow=fg.length?{sc:fg.reduce((a,K)=>a+K.follow.sc,0), co:fg.reduce((a,K)=>a+K.follow.co,0), games:fg.length, n:fg.reduce((a,K)=>a+K.n,0)}:null;
  const R=tkCompute(T, games, 'all', bo, games), TM=tkTimingCompute(R, bo), targets=tkTargetRows(TM.own.filter(k=>k.tgt));
  const rows=per.map(K=>({g:K.g, opp:K.oppName, date:K.g.date||'', n:K.n, won:K.won, L:K.L, brk:K.types.break, follow:K.follow, located:K.located}));
  return {multi:true, T, name:rpTeamName(T, games), games, per, rows, kos, n:kos.length, won:kos.filter(k=>k.won).length, L, types, located:sum(K=>K.located), depth, side,
    wonByT:merge('wonByT'), wonByO:merge('wonByO'), follow, opts:RP_KO_OPT.filter(([key])=>kos.some(k=>k.opt[key])), R, TM, targets};
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDERING — strings only, every interpolated value escaped. A4 portrait pages (210 × 297 mm), white paper.
// ═════════════════════════════════════════════════════════════════════════════
const rpE=s=>ssEsc(s);
function rpInk(c){ return (typeof window!=='undefined'&&window.cohTeamInk)?window.cohTeamInk(c, {theme:'light', bg:'#ffffff', min:4.5}):c; }
// the team's colours on paper (the Player Dashboard's pdColours): a = text / marks, b = the second colour, bar = the header bar
function rpCol(T){ const c=pdColours(T); const bar=c.bar||c.primary, onBar=pdLum(bar)>0.6?'#141414':'#ffffff';
  return Object.assign({}, c, {a:rpInk(c.primary), b:rpInk(c.secondary||c.primary), bar, onBar, mid:'#b8bcc2'}); }
function rpToday(){ return new Date().toLocaleDateString('en-IE',{day:'numeric', month:'short', year:'numeric'}); }
function rpGameDate(g){ return ovShortDate(g.date)||'date n/a'; }
function rpRoundShort(g){ const r=String(g.round||'').trim(); return r||'—'; }
function rpCrest(T, cls){ const src=typeof cohCrestSrc==='function'?cohCrestSrc(T):null; return src?`<img class="${cls||'rp-crest'}" src="${rpE(src)}" alt="">`:''; }
// ── page frame ──
function rpVars(M){ return `--pa:${M.col.a};--pb:${M.col.b};--pbar:${M.col.bar};--ponbar:${M.col.onBar}`; }
function rpPage(M, body, o){ o=o||{};
  return `<section class="rp-page${o.cls?' '+o.cls:''}" data-sec="${rpE(o.sec||'')}" style="${rpE(rpVars(M))}"><div class="rp-hd"><div class="rp-hl">${rpCrest(M.T,'rp-hcrest')}<div><b>${rpE(M.name.toUpperCase())} · ${rpE(M.kindName.toUpperCase())}</b><span>${rpE(M.subTxt)}</span></div></div>`
    +`<div class="rp-logo">CO<span>HE</span>SION</div></div><div class="rp-stripe">${M.col.bands.map(c=>`<i style="background:${rpE(c)}"></i>`).join('')}</div>`
    +`<div class="rp-body">${o.sec?`<div class="rp-sec">${rpE(o.sec)}</div>`:''}${o.h?`<h2 class="rp-h">${rpE(o.h)}</h2>`:''}${o.cap?`<p class="rp-cap">${rpE(o.cap)}</p>`:''}${body}</div>`
    +`<footer class="rp-ft"><span>COHESION Analysis · ${rpE(M.name)} · ${rpE(M.kindName)} · generated ${rpE(rpToday())}</span><span class="rp-pn"></span></footer></section>`; }
function rpTile(v, label, sub, cls){ return `<div class="rp-tile${cls?' '+cls:''}"><b>${rpE(v)}</b><span>${rpE(label)}</span>${sub?`<i>${rpE(sub)}</i>`:''}</div>`; }
function rpMTile(M, k, o){ o=o||{}; const m=rpMetric(k), v=M.V(k), r=M.rank(k); return rpTile(rpFmt(m, v), (o.label||m.l).toUpperCase(), v==null?'n/a — no '+(m.need||'data')+' in these games':(r?rpRankTxt(r):'')+(o.sub?(r?' · ':'')+o.sub:'')); }
const RP_SRC_NAME={'OWN KO':'Own kickout','OPP KO':'Opposition kickout','FTO':'Forced turnover','UTO':'Unforced turnover','FREE':'Free won','BR':'Ball recovered','TI':'Throw-in','TO':'Turnover (type not recorded)','OTHER':'Other'};
function rpTable(head, rows, o){ o=o||{};
  return `<table class="rp-t${o.cls?' '+o.cls:''}"><thead><tr>${head.map((h,i)=>`<th${i===0?' class="l"':''}>${rpE(h)}</th>`).join('')}</tr></thead><tbody>`
    +rows.map(r=>`<tr${r.cls?` class="${rpE(r.cls)}"`:''}>${(r.cells||r).map((c,i)=>`<td${i===0?' class="l"':''}>${c==null?'<span class="na">n/a</span>':rpE(c)}</td>`).join('')}</tr>`).join('')+'</tbody></table>'; }
function rpNote(t){ return t?`<p class="rp-note">${rpE(t)}</p>`:''; }
// ── charts (inline SVG, drawn in mm-ish user units) ──
// horizontal bars: rows [{label, bars:[{v, txt, col}]}], max; each row has one bar per series
function rpHBars(rows, o){ o=o||{}; const W=o.w||88, lw=o.lw||22, bh=o.bh||3.2, gap=o.gap||1, rg=o.rg||2.6, vw=o.vw||13;
  const nB=Math.max(1, ...rows.map(r=>r.bars.length)), rh=nB*bh+(nB-1)*gap, H=rows.length*(rh+rg)+(o.legend?6:1)+(o.axis?5:0);
  const max=o.max||Math.max(1e-9, ...rows.map(r=>Math.max(...r.bars.map(b=>b.v||0)))), bw=W-lw-vw, X=v=>lw+Math.max(0, (v||0))/max*bw;
  let h=`<svg class="rp-svg" viewBox="0 0 ${W} ${H.toFixed(1)}" width="${W}mm" height="${H.toFixed(1)}mm" role="img" aria-label="${rpE(o.label||'bar chart')}">`;
  let y=o.legend?6:1;
  if(o.legend) h+=o.legend.map((l,i)=>`<rect x="${lw+i*30}" y="1" width="3" height="3" fill="${rpE(l.col)}"/><text x="${lw+i*30+4}" y="3.6" class="rp-sl">${rpE(l.label)}</text>`).join('');
  rows.forEach(r=>{ h+=`<text x="${lw-1.5}" y="${(y+rh/2+1.1).toFixed(2)}" text-anchor="end" class="rp-sl">${rpE(r.label)}</text>`;
    r.bars.forEach((b,i)=>{ const by=y+i*(bh+gap); if(b.v!=null) h+=`<rect x="${lw}" y="${by.toFixed(2)}" width="${Math.max(0.3, X(b.v)-lw).toFixed(2)}" height="${bh}" fill="${rpE(b.col)}"${b.bg?` stroke="${rpE(b.bg)}" stroke-width=".2"`:''}/>`;
      h+=`<text x="${(b.v!=null?X(b.v):lw)+1}" y="${(by+bh-0.75).toFixed(2)}" class="rp-sv">${rpE(b.txt!=null?b.txt:'n/a')}</text>`; });
    y+=rh+rg; });
  if(o.axis){ h+=`<line x1="${lw}" y1="${y-1}" x2="${lw+bw}" y2="${y-1}" class="rp-ax"/>`; for(let v=0; v<=max+1e-9; v+=o.axis) h+=`<text x="${X(v).toFixed(2)}" y="${y+3}" text-anchor="middle" class="rp-sl">${rpE(String(+v.toFixed(1)))}${o.pct?'%':''}</text>`; }
  return h+'</svg>'; }
// scored / shots bars: the bar is the shots, the filled part the scores
function rpSBars(rows, o){ o=o||{}; const W=o.w||88, lw=22, bh=3.4, rg=2, H=rows.length*(bh+rg)+2, max=Math.max(1, ...rows.map(r=>r.shots)), bw=W-lw-18, X=v=>v/max*bw;
  let h=`<svg class="rp-svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" role="img" aria-label="${rpE(o.label||'scored of shots by distance')}">`;
  rows.forEach((r,i)=>{ const y=1+i*(bh+rg); h+=`<text x="${lw-1.5}" y="${y+bh-0.8}" text-anchor="end" class="rp-sl">${rpE(r.label)}</text>`
    +`<rect x="${lw}" y="${y}" width="${Math.max(0.01, X(r.shots)).toFixed(2)}" height="${bh}" fill="#d9dcdf"/><rect x="${lw}" y="${y}" width="${X(r.scores).toFixed(2)}" height="${bh}" fill="${rpE(o.col)}"/>`
    +`<text x="${lw+X(r.shots)+1}" y="${y+bh-0.8}" class="rp-sv">${r.shots?rpE(r.scores+'/'+r.shots):'–'}</text>`; });
  return h+'</svg>'; }
// game by game: scored / conceded bars, productivity line (right axis) when the games have possessions
function rpGameChart(M){ const P=M.per, W=180, H=58, L=10, Rr=12, T=6, B=11, n=P.length; if(!n) return '';
  const pts=P.map(p=>p.m.data?[p.m.team.t, p.m.opposition.t]:[null,null]), max=Math.max(5, ...pts.flat().filter(v=>v!=null)), top=Math.ceil(max/5)*5, Y=v=>T+(H-T-B)*(1-v/top);
  const cw=(W-L-Rr)/n, bw=Math.min(14, cw*0.32), prod=P.map(p=>p.prod), pmax=Math.max(10, ...prod.filter(v=>v!=null)), PY=v=>T+(H-T-B)*(1-v/Math.ceil(pmax));
  let h=`<svg class="rp-svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" role="img" aria-label="Points scored and conceded per game">`;
  for(let v=0; v<=top; v+=5) h+=`<line x1="${L}" y1="${Y(v).toFixed(2)}" x2="${W-Rr}" y2="${Y(v).toFixed(2)}" class="rp-grid"/><text x="${L-1.5}" y="${(Y(v)+1).toFixed(2)}" text-anchor="end" class="rp-sl">${v}</text>`;
  P.forEach((p,i)=>{ const cx=L+cw*(i+0.5), [a,b]=pts[i];
    if(a!=null){ h+=`<rect x="${(cx-bw-0.4).toFixed(2)}" y="${Y(a).toFixed(2)}" width="${bw}" height="${(Y(0)-Y(a)).toFixed(2)}" fill="${rpE(M.col.a)}"/><text x="${(cx-bw/2-0.4).toFixed(2)}" y="${(Y(a)-1).toFixed(2)}" text-anchor="middle" class="rp-sv b">${a}</text>`
      +`<rect x="${(cx+0.4).toFixed(2)}" y="${Y(b).toFixed(2)}" width="${bw}" height="${(Y(0)-Y(b)).toFixed(2)}" fill="#c9cdd2"/><text x="${(cx+bw/2+0.4).toFixed(2)}" y="${(Y(b)-1).toFixed(2)}" text-anchor="middle" class="rp-sv">${b}</text>`; }
    else h+=`<text x="${cx}" y="${Y(top/2)}" text-anchor="middle" class="rp-sl">score n/a</text>`;
    h+=`<text x="${cx.toFixed(2)}" y="${H-6}" text-anchor="middle" class="rp-sl">v ${rpE(p.oppName)}</text><text x="${cx.toFixed(2)}" y="${H-2.6}" text-anchor="middle" class="rp-sl">${rpE(ovShortDate(p.date).replace(/ \d{4}$/,'')||rpRoundShort(p.g))}</text>`; });
  const pp=P.map((p,i)=>p.prod!=null?[L+cw*(i+0.5), PY(p.prod)]:null);
  if(pp.some(Boolean)){ h+=`<polyline points="${pp.filter(Boolean).map(q=>q[0].toFixed(2)+','+q[1].toFixed(2)).join(' ')}" fill="none" stroke="#d4a017" stroke-width=".6"/>`+pp.filter(Boolean).map(q=>`<circle cx="${q[0].toFixed(2)}" cy="${q[1].toFixed(2)}" r="1" fill="#d4a017"/>`).join('');
    for(let v=0; v<=Math.ceil(pmax); v+=Math.max(1, Math.ceil(pmax/5))) h+=`<text x="${W-Rr+1.5}" y="${(PY(v)+1).toFixed(2)}" class="rp-sl">${v}</text>`; }
  h+=`<rect x="${L}" y="0" width="3" height="3" fill="${rpE(M.col.a)}"/><text x="${L+4}" y="2.6" class="rp-sl">Scored</text><rect x="${L+20}" y="0" width="3" height="3" fill="#c9cdd2"/><text x="${L+24}" y="2.6" class="rp-sl">Conceded</text>`
    +(pp.some(Boolean)?`<line x1="${L+44}" y1="1.5" x2="${L+48}" y2="1.5" stroke="#d4a017" stroke-width=".6"/><text x="${L+49}" y="2.6" class="rp-sl">Productivity (pts per 10 possessions, right axis)</text>`:'');
  return h+'</svg>'; }
// the shot map: the Analysis map (ttMapSVG) of the located shots, and its key
function rpMap(shots){ const loc=(shots||[]).filter(s=>s.x!=null&&s.y!=null); return loc.length?ttMapSVG(loc, {view:'loc'}):'<div class="rp-nomap">n/a — no shot locations in these games</div>'; }
function rpMapKey(){ return '<div class="rp-key">'+[['1','1-point'],['2','2-point'],['G','Goal'],['P','Penalty']].map(([k,l])=>`<span><i style="background:${TT_MK_COL[k]}"></i>${rpE(l)}</span>`).join('')+'<span><i class="o"></i>Missed (hollow)</span><span><i class="sq"></i>Dead ball (square)</span></div>'; }

// ═════ TEAM REPORT / OPPOSITION ANALYSIS ═════
function rpScoreTxt(p){ return p.m.data?ovScoreTxt(p.m.team)+' – '+ovScoreTxt(p.m.opposition):'n/a'; }
function rpRecTxt(r){ return r.W+'-'+r.D+'-'+r.L+' (W-D-L)'; }
function rpRecShort(r){ return 'won '+r.W+', drew '+r.D+', lost '+r.L; }
function rpCover(M, tiles){
  const opps=M.per.map(p=>'v '+p.oppName+(p.res?' ('+p.res+')':'')).join(' · ');
  return `<section class="rp-page rp-cover" data-sec="cover" style="${rpE(rpVars(M))}"><div class="rp-cband" style="background:${rpE(M.col.bar)};color:${rpE(M.col.onBar)}"><div class="rp-ckind">${rpE(M.kindName.toUpperCase())}</div>`
    +`${rpCrest(M.T,'rp-ccrest')}<h1>${rpE(M.coverTitle)}</h1><h2>${rpE(M.subTxt)}</h2></div><div class="rp-stripe rp-cstripe">${M.col.bands.map(c=>`<i style="background:${rpE(c)}"></i>`).join('')}</div>`
    +`<div class="rp-cbody"><p class="rp-copps">${rpE(opps)}</p><p class="rp-crec">${rpE(rpGl(M.n)+' · '+M.SH.all.shots+' shots · record '+rpRecTxt(M.rec))}</p><div class="rp-tiles c4">${tiles}</div>`
    +rpTable(['Date','Round','Opponent','Result','Score'], M.per.map(p=>[rpGameDate(p.g), rpRoundShort(p.g), p.oppName, p.res||'–', rpScoreTxt(p)]), {cls:'num'})
    +`<p class="rp-note">${rpE(M.rkNote)}</p></div><div class="rp-clogo">CO<span>HE</span>SION <small>ANALYSIS</small></div>`
    +`<footer class="rp-ft"><span>COHESION Analysis · generated ${rpE(rpToday())}</span><span class="rp-pn"></span></footer></section>`; }
function rpHeadlinePage(M, opp){
  const ks=['ppg','cpg','prod','conv','poss','possShot','gch','two','ownKo','oppKo','netKo','toW'];
  const tiles=ks.map(k=>rpMTile(M, k, k==='prod'?{sub:'pts per 10 possessions'}:{})).join('');
  // where the team ranks highest / lowest (every ranked metric; 3 each)
  const rk=RP_METRICS.map(m=>({m, v:M.V(m.k), r:M.rank(m.k)})).filter(x=>x.r&&x.v!=null);
  const hi=rk.slice().sort((a,b)=>a.r.rank-b.r.rank||(a.m.l<b.m.l?-1:1)).slice(0,3), lo=rk.slice().sort((a,b)=>(b.r.rank/b.r.of)-(a.r.rank/a.r.of)||(a.m.l<b.m.l?-1:1)).filter(x=>!hi.includes(x)).slice(0,3);
  const li=l=>'<ul>'+l.map(x=>`<li>${rpE(x.m.l+': '+rpFmt(x.m, x.v)+' — '+rpRankTxt(x.r))}</li>`).join('')+'</ul>';
  const lead=M.shooters.slice(0,3).filter(r=>r.pts>0).map(r=>r.name+' ('+r.pts+' pts)').join(', ');
  const ranks=rk.length?`<div class="rp-two"><div><h4 class="rp-h4 pos">HIGHEST RANKS</h4>${li(hi)}</div><div><h4 class="rp-h4 neg">LOWEST RANKS</h4>${li(lo)}</div></div>`:'';
  const head=['Date','Opponent','Res','Score','Poss','Shots','Scores','Prod','Own KO','TO lost','TO forced'];
  const rows=M.per.map(p=>[rpGameDate(p.g), p.oppName, p.res||'–', rpScoreTxt(p), p.poss, p.tT.shots, p.tT.scores, p.prod==null?null:p.prod.toFixed(1), p.ownKo?p.ownKo.w+'/'+p.ownKo.n:null, p.toL, p.toW]);
  const body=`<div class="rp-tiles c4">${tiles}</div>${ranks}${lead?`<p class="rp-p">Leading scorers: ${rpE(lead)}.</p>`:''}`
    +rpNote('Ranks compare per-game averages (or percentages) of every team with '+M.comp+' '+M.season+' games uploaded ('+M.rkNote.replace(/^Ranks: /,'').replace(/\.$/,'')+'). Productivity = points ÷ possessions × 10 (goal 3, 2-pointer 2). Net pts per own KO = points scored off own kickouts − points conceded off them, per own kickout. Turnovers = in play.')
    +(opp?'':`<h3 class="rp-h3">Game by game</h3>${rpGameChart(M)}${rpTable(head, rows, {cls:'num'})}${rpNote('n/a = the game’s file has no possession rows / kickout outcomes / turnover rows. Score = goals-points (total).')}`);
  return rpPage(M, body, {sec:'SECTION 01', h:opp?'At a glance':'The headline', cap:M.name+' played '+rpGl(M.n)+' ('+rpRecShort(M.rec)+'), scoring '+rpF(M.V('ppg'))+' and conceding '+rpF(M.V('cpg'))+' points a game.'});
}
function rpKoLenTable(len, who){ const r=l=>[TK_LENS.find(x=>x[0]===l)[1], len[l].n, len[l].won, rpP(len[l].pct)];
  return rpTable(['Length','Kickouts', who, 'Won %'], ['S','M','L'].map(r).concat(len.X.n?[['No length', len.X.n, len.X.won, rpP(len.X.pct)]]:[]).concat([{cls:'tot', cells:['All', len.all.n, len.all.won, rpP(len.all.pct)]}]), {cls:'num'}); }
// length × how the ball was won: the kicking team's won % (w/n) — flip: read from the receiving (selected) team's side
function rpKoGrid(kos, flip){ const ty=['clean','break','sideline','free','unspecified'], has=t=>kos.some(k=>k.type===t);
  const cols=ty.filter(t=>t!=='unspecified'||has(t)), c=(l,t)=>{ const a=kos.filter(k=>(l==='all'||(k.len||'X')===l)&&(t==='all'||k.type===t)), w=a.filter(k=>tkWon(k, flip)).length; return rpPF(w, a.length); };
  const lens=['S','M','L'].concat(kos.some(k=>!k.len)?['X']:[]);
  return rpTable(['Length'].concat(cols.map(t=>RP_KO_TYPE_NAME[t])).concat(['All']), lens.map(l=>[l==='X'?'No length':TK_LENS.find(x=>x[0]===l)[1]].concat(cols.map(t=>c(l,t))).concat([c(l,'all')]))
    .concat([{cls:'tot', cells:['All'].concat(cols.map(t=>c('all',t))).concat([c('all','all')])}]), {cls:'num'}); }
function rpKoPage(M, opp){
  const K=M.KC, own=K.own.len, RK=M.RK, oppL=M.oppLen;
  const avg=RK&&RK.n>1?RK.koLenAvg:null;
  const bars=rpHBars(['S','M','L'].map(l=>({label:TK_LENS.find(x=>x[0]===l)[1], bars:[{v:own[l].n?own[l].pct:null, txt:own[l].n?rpP(own[l].pct)+' ('+own[l].won+'/'+own[l].n+')':'none', col:M.col.a}].concat(avg?[{v:avg[l], txt:avg[l]==null?'n/a':rpP(avg[l]), col:'#c9cdd2'}]:[])})),
    {w:86, max:100, axis:25, pct:true, legend:[{label:M.name, col:M.col.a}].concat(avg?[{label:'Championship average', col:'#c9cdd2'}]:[]), label:'Own kickouts retained by length'});
  const a=M.aT, net=a.koData&&a.srcData?a.ptsFromOwnKO-a.ptsConcededOwnKO:null;
  const tab=rpTable(['', 'Kickouts', 'Short', 'Short won', 'Medium', 'Medium won', 'Long', 'Long won', 'Won', 'Per game'], [
    [M.name+' kickouts', own.all.n, own.S.n, rpP(own.S.pct), own.M.n, rpP(own.M.pct), own.L.n, rpP(own.L.pct), rpP(own.all.pct), K.own.koGames?(own.all.n/K.own.koGames).toFixed(1):null],
    ['Opposition kickouts', oppL.all.n, oppL.S.n, rpP(oppL.S.pct), oppL.M.n, rpP(oppL.M.pct), oppL.L.n, rpP(oppL.L.pct), rpP(oppL.all.pct), K.opp.koGames?(oppL.all.n/K.opp.koGames).toFixed(1):null]], {cls:'num'});
  const r=M.rank('ownKo'), r2=M.rank('oppKo');
  const cap=(opp?M.name+' keep ':M.name+' retained ')+rpP(own.all.pct)+' of '+(opp?'their':'their')+' own kickouts'+(r?' ('+rpRankTxt(r)+')':'')+' and won '+rpP(oppL.all.pct)+' of the opposition’s'+(r2?' ('+rpRankTxt(r2)+')':'')+'.';
  const body=tab+rpNote('“Won” on the opposition row = won by '+M.name+'. Lengths as tagged (Short / Medium / Long); kickouts with no length: '+(own.X.n+oppL.X.n)+'. Coverage: '+rpCov(K.own.koGames, M.n, 'kickout outcomes')+'.')
    +`<div class="rp-two"><div><h3 class="rp-h3">Win rate v championship average</h3>${bars}${avg?rpNote('Championship average = the mean of the '+RK.koLenTeams+' teams with kickout lengths (each team once).'):rpNote('Championship average n/a — no other team’s games of this competition are uploaded.')}</div>`
    +`<div><h3 class="rp-h3">Net value of own kickouts</h3>${net==null?rpNote('n/a — no score sources in these games.'):`<div class="rp-tiles c2">${rpTile(String(a.ptsFromOwnKO),'POINTS SCORED OFF THEM')}${rpTile(String(a.ptsConcededOwnKO),'POINTS CONCEDED OFF THEM')}${rpTile(rpSg(net,0),'NET')}${rpMTile(M,'netKo',{label:'Net per own kickout'})}</div>`}</div></div>`
    +`<h3 class="rp-h3">Length × reception — ${rpE(M.name)} kickouts (kicking team won)</h3>${rpKoGrid(K.own.kos, false)}`
    +`<h3 class="rp-h3">Length × reception — opposition kickouts (won by ${rpE(M.name)})</h3>${rpKoGrid(K.opp.kos, true)}`
    +rpNote('Clean / Break / Sideline / Free = how the ball was won at the kickout (the kickout outcome tag). Cells: won % (won / kickouts).');
  return rpPage(M, body, {sec:'SECTION 02', h:opp?'Their kickout':'Kickouts', cap});
}
function rpToPage(M, opp){
  const T=M.ov.to, a=M.aT, o=M.aO, g=T.locGames, nm={DEF:'Defensive third', MID:'Middle third', ATT:'Attacking third'};
  const bars=g?rpHBars(['ATT','MID','DEF'].map(k=>{ const t=T.thirds.find(x=>x.k===k); return {label:(opp?'Their ':'Our ')+nm[k].toLowerCase(), bars:[{v:t.lost/g, txt:(t.lost/g).toFixed(1), col:'#c0392b'},{v:t.won/g, txt:(t.won/g).toFixed(1), col:M.col.a}]}; }),
    {w:88, lw:30, legend:[{label:'Lost', col:'#c0392b'},{label:'Forced', col:M.col.a}], label:'Turnovers by third per game'}):rpNote('n/a — no turnover thirds in these games.');
  const tg=a.srcScoreGames, tp=a.srcPtsTagged||0, op=o.srcPtsTagged||0;
  const srcBars=tg?rpHBars(M.srcRows.filter(r=>r.sc||r.co).map(r=>({label:r.k==='TO'?'Turnover (no type)':r.label, bars:[{v:r.sc/tg, txt:(r.sc/tg).toFixed(1), col:M.col.a},{v:r.co/(o.srcScoreGames||tg), txt:(r.co/(o.srcScoreGames||tg)).toFixed(1), col:'#c9cdd2'}]})),
    {w:86, legend:[{label:'Scored', col:M.col.a},{label:'Conceded', col:'#c9cdd2'}], label:'Points per game by source', lw:32}):rpNote('n/a — no score sources in these games.');
  const rows=M.srcRows.map(r=>[r.label, r.sc, rpP(rpPct(r.sc, tp)), r.co, rpP(rpPct(r.co, op))]).concat([{cls:'tot', cells:['All sourced points', tp, tp?'100%':'–', op, op?'100%':'–']}]);
  const r=M.rank('ptsTo');
  const ptsTo=M.V('ptsTo');
  const cap=M.name+' lost '+rpF(M.V('toL'))+' and forced '+rpF(M.V('toW'))+' turnovers a game'+(ptsTo!=null?', and scored '+rpF(ptsTo)+' points a game from turnovers'+(r?' ('+rpRankTxt(r)+')':''):'')+'.';
  const body=`<div class="rp-tiles c4">${rpMTile(M,'toL')}${rpMTile(M,'toW')}${rpMTile(M,'ptsTo')}${rpTile(String(T.team.lostKo), 'KICKOUTS LOST', 'not in the in-play figures')}</div>`
    +`<div class="rp-two"><div><h3 class="rp-h3">Turnovers by third (per game)</h3>${bars}</div><div><h3 class="rp-h3">Where the points come from (per game)</h3>${srcBars}</div></div>`
    +rpTable(['Points from…', 'Scored', '% of '+(opp?'theirs':'ours'), 'Conceded', '% of opponents’'], rows, {cls:'num'})
    +rpNote('Thirds read from '+M.name+'’s side of the pitch: lost in their attacking third = lost near the opposition goal; forced in their defensive third = won near their own goal. Coverage: '+rpCov(g, M.n, 'turnover thirds')+'. Sources: the Overview’s score-source categories, '+rpCov(tg, M.n, 'score sources')+' — '+tp+' of '+a.pts+' points carry a source. Kickouts lost and shots turned over are not in-play turnovers.');
  return rpPage(M, body, {sec:'SECTION 03', h:opp?'Turnovers':'Turnovers and score origin', cap});
}
function rpSitRows(S, team){ const r=x=>[x.label, x.shots, x.scores, rpP(x.pct), x.diff==null?null:rpSg(x.diff)];
  const out=S.sit.map(r);
  if(S.prTagged) S.press.forEach(x=>out.push(r(x)));
  if(S.legTagged) S.foot.forEach(x=>out.push(r(x)));
  S.wind.forEach(x=>out.push(r(x)));
  return out; }
function rpSitNote(S){ return [S.prTagged?'Pressure (Shot Pressure tag) on '+S.prTagged+' of '+S.all.shots+' shots, '+S.prGames+' of '+rpGl(S.games):'Pressure n/a — no Shot Pressure tags in these games',
  S.legTagged?'foot (Shooting Leg tag) on '+S.legTagged+' of '+S.all.shots+' shots, '+S.legGames+' of '+rpGl(S.games):'foot n/a — no Shooting Leg tags',
  S.wind.length?'wind tagged in '+rpGl(S.windGames):'wind is not tagged in these games'].join('; ')+'. +/- xP = points − expected points over the shots the model rates (located shots).'; }
function rpTypeTable(S){ return rpTable(['Shot type','Shots','Scored','Conv','Points','Pts/shot','xP','+/-'], S.typeRows.map(x=>[x.label, x.shots, x.scores, rpP(x.pct), x.pts, x.shots?(x.pts/x.shots).toFixed(2):'–', x.xp==null?null:x.xp.toFixed(1), x.diff==null?null:rpSg(x.diff)]), {cls:'num'})
  +rpNote(S.attGames?'Attempt types '+rpCov(S.attGames, S.games, 'attempt types on missed shots')+': only games whose MISSED shots carry the attempt type count (a file that types only its scores would read close to 100%).':'Attempt types n/a — no game in this selection tags the attempt type on its missed shots.'); }
function rpDistBars(S, avg, col, who, avgN){ const B=S.bands; if(!B.located) return rpNote('Conversion by distance n/a — no shot locations in these games.');
  return rpHBars(B.rows.map((r,i)=>({label:r.label, bars:[{v:r.shots?r.pct:null, txt:r.shots?rpP(r.pct)+' ('+r.scores+'/'+r.shots+')':'no shots', col}].concat(avg?[{v:avg[i], txt:avg[i]==null?'n/a':rpP(avg[i]), col:'#c9cdd2'}]:[])})),
    {w:86, max:100, axis:25, pct:true, legend:[{label:who, col}].concat(avg?[{label:'Championship average', col:'#c9cdd2'}]:[]), label:'Conversion by distance'})
    +rpNote('Distance = straight line from the centre of the goal line (the xP model’s scale). '+B.located+' of '+B.total+' shots located, '+rpCov(B.locGames, S.games, 'shot locations')+'.'+(avg?' Championship average = the mean of the '+avgN+' teams with located shots (each team once).':'')); }
function rpShootPage(M, opp){
  const S=M.SH, a=S.all, RK=M.RK, avg=RK&&RK.n>1?RK.bandAvg:null;
  const miss=rpMissed(M.R.shots, M.titleOf);
  const cap=a.shots+' shots, '+a.scores+' scores ('+rpP(a.pct)+'), '+a.pts+' points'+(a.xp!=null?'; on the '+a.xpShots+' located shots, '+rpSg(a.diff)+' v expected ('+a.xp.toFixed(1)+' xP)':'')+'.';
  const body=`<div class="rp-two"><div><h3 class="rp-h3">Every shot</h3><div class="rp-mapw">${rpMap(M.R.shots)}</div>${rpMapKey()}</div><div><h3 class="rp-h3">Conversion by distance v championship</h3>${rpDistBars(S, avg, M.col.a, M.name, RK&&RK.bandTeams)}</div></div>`
    +rpTypeTable(S)
    +rpTable(['Situation','Shots','Scored','Conv','+/- xP'], rpSitRows(S), {cls:'num'})+rpNote(rpSitNote(S))
    +(miss.length?rpTable(['Biggest chances missed','Game','Type','Dist','Pressure','Outcome','xP'], miss.map(x=>[x.player, x.game, x.type, x.dist==null?null:Math.round(x.dist)+'m', x.pr, x.out, x.xp.toFixed(2)]), {cls:'num'})
      +rpNote('The missed shots with the highest expected points (xP: what an average shooter scores from the same spot, angle and pressure).'):rpNote('Biggest chances missed: n/a — no rated (located) missed shots.'));
  return rpPage(M, body, {sec:'SECTION 04', h:opp?'Their shooting':'Shooting', cap});
}
function rpAgainstPage(M, opp){
  const S=M.SA, a=S.all, RK=M.RK, avg=RK&&RK.n>1?RK.bandAgO:null, n=M.n;
  const in20=S.bands.located?S.bands.rows.slice(0,2).reduce((s,r)=>s+r.shots,0):null, two=S.typeRows.find(x=>x.k==='2');
  const cap='Opponents took '+rpF(n?a.shots/n:null)+' shots a game against '+M.name+' and scored '+rpP(a.pct)+' of them'+(a.diff!=null?' ('+rpSg(a.diff)+' v expected)':'')+'.';
  const body=`<div class="rp-tiles c4">${rpMTile(M,'sag')}${rpMTile(M,'oconv')}${rpTile(in20==null?'n/a':(in20/(S.bands.locGames||1)).toFixed(1),'SHOTS INSIDE 20M / GAME', in20==null?'n/a — no shot locations':rpCov(S.bands.locGames, n, 'shot locations'))}${rpTile(S.attGames?two.scores+'/'+two.shots:'n/a','2-POINTERS AGAINST', S.attGames?'scored / attempted · '+rpCov(S.attGames, S.games, 'attempt types'):'n/a — attempt types not tagged on misses')}</div>`
    +`<div class="rp-two"><div><h3 class="rp-h3">Every shot against</h3><div class="rp-mapw">${rpMap(M.faced)}</div>${rpMapKey()}</div><div><h3 class="rp-h3">Opposition conversion by distance</h3>${rpDistBars(S, avg, '#7a7f87', 'Opponents', RK&&RK.bandTeams)}</div></div>`
    +rpTable(['Opponents’ shots','Shots','Scored','Conv','+/- xP'], rpSitRows(S).concat(S.typeRows.filter(()=>S.attGames).map(x=>[x.label, x.shots, x.scores, rpP(x.pct), x.diff==null?null:rpSg(x.diff)])), {cls:'num'})+rpNote(rpSitNote(S));
  return rpPage(M, body, {sec:opp?'SECTION 07':'SECTION 05', h:opp?'How teams have scored against them':'Shots against', cap});
}
function rpShootersPages(M, sec){
  const head=['Player','G','Shots','Scored','Conv','Pts','xP','+/-','Goals','2pt','L/R/H','Avg m'];
  const row=r=>[r.name, r.gp, r.shots, r.total, rpP(r.pct), r.pts, r.xp==null?null:r.xp.toFixed(1), r.diff==null?null:rpSg(r.diff), r.goals, r.twoTyped?r.twoMade+'/'+r.twoAtt:null, r.legTagged?r.L+'/'+r.R+'/'+r.H:null, r.avgM==null?null:Math.round(r.avgM)];
  const per=34, out=[]; for(let i=0;i<Math.max(1, M.shooters.length);i+=per) out.push(M.shooters.slice(i, i+per));
  return out.map((ch,i)=>rpPage(M, rpTable(head, ch.map(row), {cls:'num rp-split'})+(i===out.length-1?rpNote('G = games played (named on an event or on the team sheet). 2pt = 2-pointers scored / 2-point attempts (games whose misses carry the attempt type). L/R/H = shots off the left foot / right foot / hand (Shooting Leg tag). Avg m = mean distance of his located shots. n/a = not tagged in his games.'+(M.noPlayer?' Shots with no player named ('+M.noPlayer+') are left out.':'')):''),
    {sec:i?'':sec, h:i?'The shooters (continued)':'The shooters', cap:i?'':'Every named player who took a shot, ranked by points scored.'})); }
function rpProfileHTML(M, r){ const S=r.S, t=k=>{ const x=S.typeRows.find(y=>y.k===k); return S.attGames?rpFrac(x.scores, x.shots):'n/a'; };
  const rows=[['Point attempts', t('1')], ['2-point attempts', t('2')], ['Goal attempts', t('G')], ['Placed balls', rpFrac(S.sit[1].scores, S.sit[1].shots)], ['Open play', rpFrac(S.sit[0].scores, S.sit[0].shots)]]
    .concat(S.prTagged?S.press.map(x=>[x.label, rpFrac(x.scores, x.shots)]):[['Pressure', 'n/a — not tagged']])
    .concat([['Left / right foot / hand', S.legTagged?S.foot.map(x=>rpFrac(x.scores, x.shots)).join(' · '):'n/a — not tagged']]);
  const sum=r.shots+' shots · '+r.total+' scores ('+rpP(r.pct)+') · '+r.pts+' pts'+(r.diff!=null?' · '+rpSg(r.diff)+' v expected':'')+(r.avgM!=null?' · avg '+Math.round(r.avgM)+'m':'');
  return `<div class="rp-prof"><h3 class="rp-pname">${rpE(r.name)}</h3><p class="rp-psum">${rpE(sum)}</p><div class="rp-two"><div><div class="rp-mapw sm">${rpMap(r.shotsList)}</div></div>`
    +`<div>${rpTable(['Breakdown','Scored / shots'], rows)}<h4 class="rp-h4">Scored / shots by distance</h4>${S.bands.located?rpSBars(S.bands.rows, {col:M.col.a, w:86}):rpNote('n/a — no located shots')}</div></div></div>`; }
function rpProfilePages(M, sec, h){ const P=M.profiles, out=[]; for(let i=0;i<P.length;i+=2) out.push(P.slice(i,i+2));
  if(!out.length) return [rpPage(M, rpNote('No player has '+RP_PROFILE_MIN+' or more shots in these games.'), {sec, h})];
  return out.map((pair,i)=>rpPage(M, pair.map(r=>rpProfileHTML(M, r)).join('')+(i===0?'':''), {sec:i?'':sec, h:i?'':h, cap:i?'':'The '+P.length+' main shooters ('+RP_PROFILE_MIN+'+ shots), two to a page.'})); }
function rpDefeatsHTML(M){ const L=M.per.filter(p=>p.res==='L'); if(!L.length) return `<h3 class="rp-h3">Defeats</h3>`+rpNote(M.name+' lost none of these games.');
  return L.map(p=>{ const k=o=>o?o.w+'/'+o.n+' ('+rpP(rpPct(o.w,o.n))+')':null;
    return `<h3 class="rp-h3">Defeat: v ${rpE(p.oppName)}, ${rpE(rpGameDate(p.g))}</h3>`+rpTable(['', p.oppName, M.name], [
      ['Score', p.m.data?ovScoreTxt(p.m.opposition):null, p.m.data?ovScoreTxt(p.m.team):null], ['Possessions', p.possO, p.poss], ['Shots', p.tO.shots, p.tT.shots],
      ['Own kickouts kept', k(p.ownKoO), k(p.ownKo)], ['Long kickouts kept', k(p.longKoO), k(p.longKo)], ['Turnovers lost (in play)', p.toLO, p.toL], ['Points from turnovers', p.ptsToO, p.ptsTo]], {cls:'num'}); }).join(''); }
function rpOppGamesPage(M){
  const head=['Date','Opponent','Res','Score','Poss','Shots','Own KO kept','TO forced','Pts from TO'];
  const rows=M.per.map(p=>[rpGameDate(p.g), p.oppName, p.res||'–', rpScoreTxt(p), p.poss, p.tT.shots, p.ownKo?p.ownKo.w+'/'+p.ownKo.n:null, p.toW, p.ptsTo]);
  return rpPage(M, rpGameChart(M)+rpTable(head, rows, {cls:'num'})+rpNote('n/a = the game’s file has no possession rows / kickout outcomes / score sources. Pts from TO = points scored from turnovers (forced, unforced, free won, type not recorded).')+rpDefeatsHTML(M), {sec:'SECTION 02', h:'Game by game', cap:'Won '+M.rec.W+', drew '+M.rec.D+', lost '+M.rec.L+' in '+rpGl(M.n)+': '+rpF(M.V('ppg'))+' scored and '+rpF(M.V('cpg'))+' conceded a game.'}); }
function rpGamesPage(M){
  const f=(ok)=>ok?'✓':'–';
  const rows=M.per.map(p=>{ const b=M.bundleOf(p.g.id), sh=M.R.shots.filter(s=>s.gid===p.g.id), K=tkGameKos(b.meta, b.events);
    return [rpGameDate(p.g), rpRoundShort(p.g), 'v '+p.oppName, rpScoreTxt(p), f(p.tT.possCount>0), f(sh.some(s=>s.x!=null)), f(sh.some(s=>s.pr==='L'||s.pr==='M'||s.pr==='H')), f(sh.some(s=>s.leg)), f(ssAttMissGames(sh).has(p.g.id)), f(K&&K.kos.some(k=>k.len)), f(p.tT.srcScoreGames>0), f(!!(b.meta.rosters&&(b.meta.rosters.home||[]).concat(b.meta.rosters.away||[]).length)), [p.g.source, p.g.file?p.g.file+(p.g.fileDate?' ('+p.g.fileDate+')':''):''].filter(Boolean).join(': ')||'—']; });
  return rpPage(M, rpTable(['Date','Round','Opponent','Score','Poss','Loc','Press','Foot','Att','KO len','Src','Sheet','File'], rows, {cls:'num sm'})
    +rpNote('What each game’s file carries (✓) — Poss = possession rows; Loc = shot locations; Press = Shot Pressure tags; Foot = Shooting Leg tags; Att = attempt types on missed shots; KO len = kickout lengths; Src = score sources; Sheet = team sheet. A figure that needs a tag a game lacks is computed from the games that have it, and says so.')
    +rpNote(M.rkNote), {sec:'APPENDIX', h:'Games in this report'}); }
// the whole report → {html, pages, M}
function rpBuildTeam(M, opp){
  const tiles=opp?[rpMTile(M,'ppg'), rpMTile(M,'cpg'), rpMTile(M,'ownKo'), rpTile(M.aT.srcPtsTagged?rpP(rpPct(SS_SRC_TO_KEYS.reduce((s,k)=>s+(M.aT['srcP:'+k]||0),0), M.aT.srcPtsTagged)):'n/a', 'OF POINTS FROM TURNOVERS', M.aT.srcPtsTagged?'of sourced points':'n/a — no score sources')].join('')
    :[rpMTile(M,'ppg'), rpMTile(M,'prod',{sub:'pts per 10 possessions'}), rpMTile(M,'ownKo'), rpMTile(M,'conv')].join('');
  const pages=[rpCover(M, tiles)];
  if(opp){ pages.push(rpHeadlinePage(M, true).replace(/SECTION 01/g,'SECTION 01')); pages.push(rpOppGamesPage(M)); pages.push(rpKoPage(M, true).replace(/SECTION 02/g,'SECTION 03')); pages.push(rpToPage(M, true).replace(/SECTION 03/g,'SECTION 04'));
    pages.push(rpShootPage(M, true).replace(/SECTION 04/g,'SECTION 05')); rpProfilePages(M, 'SECTION 06', 'Key players').forEach(p=>pages.push(p)); pages.push(rpAgainstPage(M, true)); rpShootersPages(M, 'SECTION 08').forEach(p=>pages.push(p)); }
  else { pages.push(rpHeadlinePage(M, false)); pages.push(rpKoPage(M, false)); pages.push(rpToPage(M, false)); pages.push(rpShootPage(M, false)); pages.push(rpAgainstPage(M, false)); rpShootersPages(M, 'SECTION 06').forEach(p=>pages.push(p)); rpProfilePages(M, 'SECTION 07', 'Player profiles').forEach(p=>pages.push(p)); }
  pages.push(rpGamesPage(M));
  return pages.join('');
}

// ═════ KICKOUT REPORT ═════
function rpKoStrip(K){ const hn=h=>h==='1'?'1st half':h==='2'?'2nd half':h==='ET1'?'Extra time 1':h==='ET2'?'Extra time 2':'Half not known';
  return K.halves.map(h=>`<div class="rp-shalf"><div class="rp-shl">${rpE(hn(h).toUpperCase())}</div><div class="rp-strip">`+K.kos.filter(k=>k.half===h).map(k=>
    `<div class="rp-kb ${k.won?'kept':'lost'}"><b>${rpE(k.len||'–')}</b><i>${rpE(RP_KO_TYPE[k.type])}</i><span>${k.no}</span></div>`).join('')+'</div></div>').join(''); }
function rpKoMap(K){ const L=K.kos.filter(k=>k.x!=null&&k.dist!=null); if(!L.length) return '<div class="rp-nomap">n/a — no kickout landing locations in this game</div>';
  const mk=k=>{ const x=tkPX(k.x), y=tkPY(k.dist), c=k.won?'#1f9d55':'#c0392b', s=2.1;
    const shp=k.len==='S'?`<circle cx="${x}" cy="${y}" r="${s}" fill="${c}" stroke="#fff" stroke-width=".35"/>`:k.len==='M'?`<path d="M${x} ${(y-s*1.25).toFixed(2)}L${(x+s*1.25).toFixed(2)} ${y}L${x} ${(y+s*1.25).toFixed(2)}L${(x-s*1.25).toFixed(2)} ${y}Z" fill="${c}" stroke="#fff" stroke-width=".35"/>`:`<rect x="${(x-s).toFixed(2)}" y="${(y-s).toFixed(2)}" width="${2*s}" height="${2*s}" fill="${c}" stroke="#fff" stroke-width=".35"/>`;
    return shp+`<text x="${x}" y="${(y+1.05).toFixed(2)}" text-anchor="middle" class="rp-kn">${k.no}</text>`; };
  const lab=(d,t)=>`<text x="97.6" y="${(tkPY(d)-0.8).toFixed(2)}" text-anchor="end" class="rp-kl">${t}</text>`;
  return tkPitchOpen('rp-kmap','Kickout landings from the kicking team’s 20m line (top), numbered as in the log')+lab(45,'45m')+lab(65,'65m')+'<g>'+L.map(mk).join('')+'</g></svg>'; }
function rpKoReport(K, M){
  const tl=K.kos, h1=tl.filter(k=>k.half==='1').length, h2=tl.filter(k=>k.half==='2').length, L=K.L, ty=K.types;
  const lenT=l=>L[l].n?rpTile(rpP(L[l].pct), (TK_LENS.find(x=>x[0]===l)[1]+' kept').toUpperCase(), L[l].won+'/'+L[l].n):rpTile('–', (TK_LENS.find(x=>x[0]===l)[1]+' kept').toUpperCase(), 'none taken');
  const dead=ty.sideline.n-ty.sideline.won+ty.free.n-ty.free.won;
  const tiles=rpTile(String(K.n), 'KICKOUTS', h1+' 1st half · '+h2+' 2nd'+(K.n-h1-h2?' · '+(K.n-h1-h2)+' other':''))+rpTile(rpP(rpPct(K.won, K.n)), 'KEPT', K.won+'/'+K.n)+lenT('S')+lenT('M')+lenT('L')
    +rpTile(ty.clean.n?rpP(rpPct(ty.clean.won, ty.clean.n)):'–', 'CLEAN CATCH KEPT', ty.clean.n?ty.clean.won+'/'+ty.clean.n:'none')+rpTile(ty.break.n?rpP(rpPct(ty.break.won, ty.break.n)):'–', 'BREAKS WON', ty.break.n?ty.break.won+'/'+ty.break.n:'none')
    +rpTile(String(dead), 'LOST TO SIDELINE / FREE', 'dead-ball concessions');
  const g=K.g, dt=ovShortDate(g.date)||'date n/a';
  const cap=K.name+' kept '+K.won+' of their '+K.n+' kickouts ('+rpP(rpPct(K.won, K.n))+').';
  const optNote=K.opts.length===RP_KO_OPT.length?'':'Contested by (us v them), numbers at the drop and the opposition press shape: '+(K.opts.length?'only '+K.opts.map(o=>o[1]).join(', ')+' tagged':'not tagged')+' — add the labels '+RP_KO_OPT.filter(o=>!K.opts.includes(o)).map(o=>'‘'+o[1]+'’').join(', ')+' in Code Room to include them.';
  const p1=rpPage(M, `<div class="rp-tiles c4">${tiles}</div><h3 class="rp-h3">Kickout by kickout</h3>${rpKoStrip(K)}`
    +rpNote('Green = kept, red = lost. Big letter = Short / Medium / Long (as tagged); small = how it was won (C clean, B break, SL sideline, F free, – not tagged). Numbers match the map and the kickout log.')
    +(K.follow?`<h3 class="rp-h3">What followed</h3><div class="rp-tiles c4">${rpTile(String(K.follow.sc),'POINTS SCORED','off kickouts '+K.name+' kept')}${rpTile(String(K.follow.co),'POINTS CONCEDED','off kickouts '+K.name+' lost')}${rpTile(rpSg(K.follow.sc-K.follow.co,0),'NET')}${rpTile(K.n?rpSg((K.follow.sc-K.follow.co)/K.n,2):'n/a','NET PER KICKOUT')}</div>`+rpNote('From the tagged score sources (Own KO / Opp KO) up to the next kickout.'+(K.srcFrom==='poss'?' Sources derived from the possession rows (GIU).':'')):rpNote('Points after the kickouts: n/a — this game has no score sources.'))
    +rpNote(optNote), {sec:'SECTION 01', h:'The headline', cap});
  const dB=rpHBars(K.depth.map(d=>({label:d.label, bars:[{v:d.n?rpPct(d.won,d.n):null, txt:d.n?rpP(rpPct(d.won,d.n))+' ('+d.won+'/'+d.n+')':'none', col:M.col.a}]})), {w:84, max:100, axis:25, pct:true, label:'Kept by depth'});
  const sB=rpHBars(K.side.map(d=>({label:d.label, bars:[{v:d.n?rpPct(d.won,d.n):null, txt:d.n?rpP(rpPct(d.won,d.n))+' ('+d.won+'/'+d.n+')':'none', col:M.col.a}]})), {w:84, max:100, axis:25, pct:true, label:'Kept by side'});
  const p2=rpPage(M, `<div class="rp-two kmap"><div><div class="rp-kmapw">${rpKoMap(K)}</div><div class="rp-key"><span><i style="background:#1f9d55"></i>Kept</span><span><i style="background:#c0392b"></i>Lost</span><span><i class="o"></i>Short (circle)</span><span>◇ Medium</span><span><i class="sq"></i>Long (square)</span><span>dashed line = half-way</span></div></div>`
    +`<div><h4 class="rp-h4">Kept by depth (from ${rpE(K.name)}’s goal)</h4>${K.located?dB:rpNote('n/a — no landing locations')}<h4 class="rp-h4">Kept by side (facing out)</h4>${K.located?sB:rpNote('n/a — no landing locations')}`
    +rpNote(K.located+' of '+K.n+' kickouts have a landing location. Depth: up to the 45m line, 45–65m, 65m to half-way (70m), the opposition half. Side: the kicker’s left / centre / right third.')+`</div></div>`
    +`<h3 class="rp-h3">Length × how the ball was won (kept / kickouts)</h3>${rpKoGrid(K.kos, false)}`+rpNote('Clean catch / Break / Sideline / Free = the kickout outcome tag. A sideline or free lost = the ball went dead or a free was given against at the drop.'),
    {sec:'SECTION 02', h:'Where and how they were won', cap:'Every kickout plotted from '+K.name+'’s own goal; numbers match the kickout log.'});
  const wb=(W, who)=>W.rows.length||W.none?rpTable(['Won by — '+who,'Kickouts','Clean','Breaks','Lengths'], W.rows.map(r=>[r.name, r.n, r.clean, r.brk, ['S','M','L','X'].filter(l=>r.lens[l]).map(l=>r.lens[l]+' '+(l==='X'?'no length':TK_LENS.find(x=>x[0]===l)[1].toLowerCase())).join(', ')])
    .concat(W.none?[{cls:'tot', cells:['(no player tagged)', W.none, '', '', '']}]:[]), {cls:'num'}):rpNote('None.');
  const who=`<div class="rp-two"><div>${wb(K.wonByT, K.name)}</div><div>${wb(K.wonByO, K.oppName)}</div></div>`+rpNote('Won by = the ‘Kickout Won By’ player of each kickout, under the team that won it.');
  const hasT=tl.some(k=>k.target), head=['#','Half','Video','Clock','Length','How won','Kept'].concat(hasT?['Target']:[]).concat(['Won by','Where']).concat(K.opts.map(o=>o[1]));
  const row=k=>[k.no, k.half||'–', k.video, k.clock.replace(/^(1H|2H|ET1|ET2)\s*/,'')||'n/a', k.len?TK_LENS.find(x=>x[0]===k.len)[1]:'n/a', RP_KO_TYPE_NAME[k.type], k.won?'Yes':'No'].concat(hasT?[k.target||'–']:[]).concat([k.who?k.who.name:(k.type==='sideline'?'(sideline ball)':'–'), k.depth?k.depth+' · '+k.side:'n/a']).concat(K.opts.map(o=>k.opt[o[0]]||'–'));
  const first=Math.max(0, 40-Math.ceil(Math.max(K.wonByT.rows.length+(K.wonByT.none?1:0), K.wonByO.rows.length+(K.wonByO.none?1:0))*1.3)), per=44, chunks=[tl.slice(0, first)]; for(let i=first;i<tl.length;i+=per) chunks.push(tl.slice(i,i+per));
  const logs=chunks.map((ch,i)=>rpPage(M, (i===0?who+`<h3 class="rp-h3">Kickout log</h3>`:'')+(ch.length?rpTable(head, ch.map(row), {cls:'num sm rp-split'}):'')+(i===chunks.length-1?rpNote((hasT?'Target = the intended receiver (‘Kickout Target’; a won kickout with none: its winner). ':'')+'Video = time on the game video (m:ss); Clock = the game clock of the half. Source: '+(K.g.source||'the uploaded game file')+'. '+(K.oppKos?K.oppName+'’s own '+K.oppKos+' kickouts are in their own Kickout Report.':'')+' '+optNote):''),
    {sec:i?'':'SECTION 03', h:i?'Kickout log (continued)':'Who won them, and the log', cap:i?'':'Who came away with each of '+K.name+'’s '+K.n+' kickouts, then every kickout in order.'}));
  return [p1, p2].concat(logs).join('');
}

// ═════ KICKOUT REPORT over several games ═════
function rpKoMultiMap(K){ const L=K.kos.filter(k=>k.x!=null&&k.dist!=null); if(!L.length) return '<div class="rp-nomap">n/a — no kickout landing locations in these games</div>';
  const many=L.length>40, s=many?1.15:2.1;
  const mk=k=>{ const x=tkPX(k.x), y=tkPY(k.dist), c=k.won?'#1f9d55':'#c0392b', w=many?.2:.35;
    const shp=k.len==='S'?`<circle cx="${x}" cy="${y}" r="${s}" fill="${c}" stroke="#fff" stroke-width="${w}"/>`:k.len==='M'?`<path d="M${x} ${(y-s*1.25).toFixed(2)}L${(x+s*1.25).toFixed(2)} ${y}L${x} ${(y+s*1.25).toFixed(2)}L${(x-s*1.25).toFixed(2)} ${y}Z" fill="${c}" stroke="#fff" stroke-width="${w}"/>`:`<rect x="${(x-s).toFixed(2)}" y="${(y-s).toFixed(2)}" width="${2*s}" height="${2*s}" fill="${c}" stroke="#fff" stroke-width="${w}"/>`;
    return shp+(many?'':`<text x="${x}" y="${(y+1.05).toFixed(2)}" text-anchor="middle" class="rp-kn">${k.no}</text>`); };
  const lab=(d,t)=>`<text x="97.6" y="${(tkPY(d)-0.8).toFixed(2)}" text-anchor="end" class="rp-kl">${t}</text>`;
  return tkPitchOpen('rp-kmap','Kickout landings from the kicking team’s 20m line (top), every selected game')+lab(45,'45m')+lab(65,'65m')+'<g>'+L.map(mk).join('')+'</g></svg>'; }
function rpKoStripRow(K){ const byH=K.halves.map(h=>K.kos.filter(k=>k.half===h));
  return `<div class="rp-shalf rp-sgame"><div class="rp-shl">${rpE('v '+K.oppName)}<br><span>${rpE(ovShortDate(K.g.date)||rpRoundShort(K.g))}</span></div><div class="rp-strip">`
    +byH.map((l,i)=>(i?'<div class="rp-hsep" title="half-time"></div>':'')+l.map(k=>`<div class="rp-kb ${k.won?'kept':'lost'}"><b>${rpE(k.len||'–')}</b><i>${rpE(RP_KO_TYPE[k.type])}</i><span>${k.no}</span></div>`).join('')).join('')+'</div></div>'; }
function rpKoMultiReport(K, M, o){ o=o||{};
  const L=K.L, ty=K.types, lenN=l=>TK_LENS.find(x=>x[0]===l)[1];
  const lenT=l=>L[l].n?rpTile(rpP(L[l].pct), (lenN(l)+' kept').toUpperCase(), L[l].won+'/'+L[l].n):rpTile('–', (lenN(l)+' kept').toUpperCase(), 'none taken');
  const dead=ty.sideline.n-ty.sideline.won+ty.free.n-ty.free.won;
  const tiles=rpTile(String(K.n), 'KICKOUTS', rpGl(K.games.length)+' · '+(K.games.length?(K.n/K.games.length).toFixed(1):'0')+' a game')+rpTile(rpP(rpPct(K.won, K.n)), 'KEPT', K.won+'/'+K.n)+lenT('S')+lenT('M')+lenT('L')
    +rpTile(ty.clean.n?rpP(rpPct(ty.clean.won, ty.clean.n)):'–', 'CLEAN CATCH KEPT', ty.clean.n?ty.clean.won+'/'+ty.clean.n:'none')+rpTile(ty.break.n?rpP(rpPct(ty.break.won, ty.break.n)):'–', 'BREAKS WON', ty.break.n?ty.break.won+'/'+ty.break.n:'none')
    +rpTile(String(dead), 'LOST TO SIDELINE / FREE', 'dead-ball concessions');
  const kept=x=>x.n?rpP(x.pct)+' ('+x.won+'/'+x.n+')':'–';
  const gt=rpTable(['Opponent','Date','Kickouts','Kept','Short kept','Medium kept','Long kept','Breaks won','Net per KO'], K.rows.map(r=>['v '+r.opp, ovShortDate(r.date)||rpRoundShort(r.g), r.n, rpP(rpPct(r.won, r.n)), kept(r.L.S), kept(r.L.M), kept(r.L.L), r.brk.n?r.brk.won+'/'+r.brk.n:'–', r.follow&&r.n?rpSg((r.follow.sc-r.follow.co)/r.n, 2):null])
    .concat([{cls:'tot', cells:['All', '', K.n, rpP(rpPct(K.won, K.n)), kept(L.S), kept(L.M), kept(L.L), ty.break.n?ty.break.won+'/'+ty.break.n:'–', K.follow&&K.follow.n?rpSg((K.follow.sc-K.follow.co)/K.follow.n, 2):null]}]), {cls:'num'});
  const F=K.follow, fol=F?`<h3 class="rp-h3">What followed</h3><div class="rp-tiles c4">${rpTile(String(F.sc),'POINTS SCORED','off kickouts '+K.name+' kept')}${rpTile(String(F.co),'POINTS CONCEDED','off kickouts '+K.name+' lost')}${rpTile(rpSg(F.sc-F.co,0),'NET')}${rpTile(F.n?rpSg((F.sc-F.co)/F.n,2):'n/a','NET PER KICKOUT')}</div>`
      +rpNote('From the tagged score sources (Own KO / Opp KO) up to the next kickout; '+rpCov(F.games, K.games.length, 'score sources')+(F.games<K.games.length?' ('+F.n+' of '+K.n+' kickouts)':'')+'. n/a in the table = no score sources in that game.')
    :rpNote('Points after the kickouts: n/a — no score sources in these games.');
  const cap=K.name+' kept '+K.won+' of their '+K.n+' kickouts ('+rpP(rpPct(K.won, K.n))+') over '+rpGl(K.games.length)+'.';
  const optNote=K.opts.length===RP_KO_OPT.length?'':'Contested by (us v them), numbers at the drop and the opposition press shape: '+(K.opts.length?'only '+K.opts.map(o=>o[1]).join(', ')+' tagged':'not tagged')+' — add the labels '+RP_KO_OPT.filter(o=>!K.opts.includes(o)).map(o=>'‘'+o[1]+'’').join(', ')+' in Code Room to include them.';
  const p1=rpPage(M, `<div class="rp-tiles c4">${tiles}</div><h3 class="rp-h3">Game by game</h3>${gt}${rpNote('Kept = won by the kicking team. Lengths as tagged. Net per KO = points scored off kept kickouts − points conceded off lost ones, per kickout (games with score sources).')}${fol}${rpNote(optNote)}`, {sec:'SECTION 01', h:'The headline', cap});
  const strips=rpPage(M, `<div class="rp-flowc">${K.per.map(rpKoStripRow).join('')}</div>`+rpNote('One row per game. Green = kept, red = lost. Big letter = Short / Medium / Long (as tagged); small = how it was won (C clean, B break, SL sideline, F free, – not tagged). The grey bar = half-time. Numbers = the kickout’s number in that game’s log.'),
    {sec:'SECTION 02', h:'Kickout by kickout', cap:'Every '+K.name+' kickout, game by game.'});
  const bars=list=>rpHBars(list.map(d=>({label:d.label, bars:[{v:d.n?rpPct(d.won,d.n):null, txt:d.n?rpP(rpPct(d.won,d.n))+' ('+d.won+'/'+d.n+')':'none', col:M.col.a}]})), {w:84, max:100, axis:25, pct:true, label:'Kept'});
  const many=K.located>40;
  const p2=rpPage(M, `<div class="rp-two kmap"><div><div class="rp-kmapw">${rpKoMultiMap(K)}</div><div class="rp-key"><span><i style="background:#1f9d55"></i>Kept</span><span><i style="background:#c0392b"></i>Lost</span><span><i class="o"></i>Short (circle)</span><span>◇ Medium</span><span><i class="sq"></i>Long (square)</span><span>dashed line = half-way</span></div></div>`
    +`<div><h4 class="rp-h4">Kept by depth (from ${rpE(K.name)}’s goal)</h4>${K.located?bars(K.depth):rpNote('n/a — no landing locations')}<h4 class="rp-h4">Kept by side (facing out)</h4>${K.located?bars(K.side):rpNote('n/a — no landing locations')}`
    +rpNote('Landing from '+K.located+' of '+K.n+' kickouts (located), '+K.per.filter(x=>x.located).length+' of '+rpGl(K.games.length)+'. '+(many?'Small markers, not numbered (more than 40 kickouts). ':'Numbers = the kickout’s number in its game’s log (they repeat across games). ')+'Depth: up to the 45m line, 45–65m, 65m to half-way (70m), the opposition half. Side: the kicker’s left / centre / right third.')+`</div></div>`
    +`<h3 class="rp-h3">Length × how the ball was won (kept / kickouts)</h3>${rpKoGrid(K.kos, false)}`+rpNote('Totals across the '+rpGl(K.games.length)+'. Clean catch / Break / Sideline / Free = the kickout outcome tag.'),
    {sec:'SECTION 03', h:'Where and how they were won', cap:'Every located kickout of the '+rpGl(K.games.length)+', kept v lost.'});
  const wb=(W, who)=>W.rows.length||W.none?rpTable(['Won by — '+who,'Kickouts','Clean','Breaks','Lengths'], W.rows.map(r=>[r.name, r.n, r.clean, r.brk, ['S','M','L','X'].filter(l=>r.lens[l]).map(l=>r.lens[l]+' '+(l==='X'?'no length':lenN(l).toLowerCase())).join(', ')])
    .concat(W.none?[{cls:'tot', cells:['(no player tagged)', W.none, '', '', '']}]:[]), {cls:'num rp-split'}):rpNote('None.');
  const TM=K.TM, tg=K.targets;
  const tgt=tg.length?rpTable(['Intended target','Uses','Won','Retention'], tg.map(r=>[r.name, r.uses, r.won, rpP(r.pct)]).concat(TM.own.length-TM.tagged?[{cls:'tot', cells:['(target not tagged)', TM.own.length-TM.tagged, TM.own.filter(k=>!k.tgt&&k.won).length, rpP(rpPct(TM.own.filter(k=>!k.tgt&&k.won).length, TM.own.length-TM.tagged))]}]:[]), {cls:'num rp-split'})
      +rpNote('Intended target = the Kickout Target tag, else Kickout Won By on a kept kickout (Team Trends’ rule); '+TM.tagged+' of '+TM.own.length+' kickouts, '+rpCov(TM.tagGames, K.games.length, 'targets')+'.')
    :rpNote('Intended targets: n/a — no Kickout Target / Won By tags in these games.');
  const p3=rpPage(M, `<div class="rp-two"><div>${wb(K.wonByT, K.name)}</div><div>${wb(K.wonByO, K.games.length>1?'opponents':K.per[0].oppName)}</div></div>`+rpNote('Won by = the ‘Kickout Won By’ player of each kickout, under the team that won it.')
    +`<h3 class="rp-h3">Intended targets</h3>${tgt}`, {sec:'SECTION 04', h:'Who won them', cap:'Who came away with '+K.name+'’s kickouts, and who they were aimed at.'});
  const bandRows=TM.bands.map(b=>[b.label, b.n, b.all.won, rpP(b.all.pct), b.rows.length?b.rows.slice(0,3).map(r=>r.name+' '+r.won+'/'+r.uses).join(', '):'–']);
  const Bt=TM.B, nxt=Bt.rows.map(r=>[r.name, r.uses, r.won, rpP(r.pct), r.avg==null?'–':r.avg.toFixed(1)+' s']).concat(Bt.other?[['Other targets ('+Bt.other.names+')', Bt.other.uses, Bt.other.won, rpP(Bt.other.pct), Bt.other.avg==null?'–':Bt.other.avg.toFixed(1)+' s']]:[])
    .concat(Bt.notTagged.n?[['(target not tagged)', Bt.notTagged.n, Bt.notTagged.won, rpP(Bt.notTagged.pct), '–']]:[]).concat([{cls:'tot', cells:['All next kickouts', Bt.all.n, Bt.all.won, rpP(Bt.all.pct), Bt.allAvg==null?'–':Bt.allAvg.toFixed(1)+' s']}]);
  const un=TM.untimed, unTxt=['noshot','over','neg','noend'].filter(k=>un[k]).map(k=>un[k]+' '+({noshot:'with no shot before them in the half', over:'more than '+TK_TIME_MAX+' s after the shot', neg:'tagged before the shot ended', noend:'after a shot with no end time'})[k]).join(', ');
  const p4=rpPage(M, `<h3 class="rp-h3">Time from ball dead to kick</h3>`+rpTable(['Band','Kickouts','Kept','Retention','Top targets (kept / uses)'], bandRows.concat([{cls:'tot', cells:['All timed', TM.timed, TM.bands.reduce((a,b)=>a+b.all.won,0), rpP(rpPct(TM.bands.reduce((a,b)=>a+b.all.won,0), TM.timed)), '']}]), {cls:'num'})
    +rpNote('Timing = from the end of the previous shot (a score or a wide, either team) to the kickout, as tagged — the Team Trends rule and bands; '+TM.timed+' of '+TM.own.length+' kickouts timed'+(unTxt?' (untimed: '+unTxt+')':'')+'. '+(TM.bands[0].under7?TM.bands[0].under7+' kickouts under 7 s are counted in 7–13 s.':''))
    +`<h3 class="rp-h3">The next kickout after a lost one</h3>`+rpTable(['Next intended target','Uses','Kept','Retention','Avg time'], nxt, {cls:'num'})
    +rpNote(Bt.lost+' kickouts lost; the next '+K.name+' kickout of the same game and half followed '+Bt.all.n+' of them'+(Bt.noNext?' ('+Bt.noNext+' had none)':'')+'.'),
    {sec:'SECTION 05', h:'Timing and the next kickout', cap:'Retention by the time from the ball going dead to the kick, and after a lost kickout.'});
  const pages=[p1, strips, p2, p3, p4];
  if(o.log!==false){
    const hasT=K.kos.some(k=>k.target), head=['#','Half','Video','Clock','Length','How won','Kept'].concat(hasT?['Target']:[]).concat(['Won by','Where']).concat(K.opts.map(x=>x[1]));
    const row=k=>`<tr><td class="l">${k.no}</td>`+[k.half||'–', k.video, k.clock.replace(/^(1H|2H|ET1|ET2)\s*/,'')||'n/a', k.len?lenN(k.len):'n/a', RP_KO_TYPE_NAME[k.type], k.won?'Yes':'No'].concat(hasT?[k.target||'–']:[]).concat([k.who?k.who.name:(k.type==='sideline'?'(sideline ball)':'–'), k.depth?k.depth+' · '+k.side:'n/a']).concat(K.opts.map(x=>k.opt[x[0]]||'–')).map(c=>`<td>${rpE(c)}</td>`).join('')+'</tr>';
    const body=K.per.map(G=>`<tr class="rp-grp"><td class="l" colspan="${head.length}">${rpE('v '+G.oppName+' · '+(ovShortDate(G.g.date)||'date n/a')+' · '+[G.g.competition, G.g.round].filter(Boolean).join(' ')+' · '+G.n+' kickouts, '+G.won+' kept')}</td></tr>`+G.kos.map(row).join('')).join('');
    pages.push(rpPage(M, `<table class="rp-t num sm rp-split"><thead><tr>${head.map((h,i)=>`<th${i===0?' class="l"':''}>${rpE(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`
      +rpNote((hasT?'Target = the intended receiver (‘Kickout Target’; a won kickout with none: its winner). ':'')+'Video = time on the game video (m:ss); Clock = the game clock of the half; # = the kickout’s number in its game. '+optNote),
      {sec:'APPENDIX', h:'Kickout log', cap:'All '+K.n+' '+K.name+' kickouts, game by game.'}));
  }
  return pages.join('');
}

// ═════════════════════════════════════════════════════════════════════════════
//  WIRING — the REPORTS tab: report type, team, season / competition, the games (all ticked), Build report → the pages on
//  screen, Download PDF → the browser's print-to-PDF (A4, @page), file name <Team>_<Report>_<range>.pdf
// ═════════════════════════════════════════════════════════════════════════════
const RP_O={kind:'team', team:'', season:'', comp:'', off:new Set(), ko:'', koLog:true, built:null};
// the games, most recent first: by date; a game with no date takes the date of the game before it in the list (the round
// order), and comes after it — so an undated Semi-Final sits between the dated Quarter-Final and the Final
function rpRecent(games){ let last=''; return (games||[]).map((g,i)=>{ const d=ssIsoDate(g.date)||''; if(d) last=d; return {g, i, d:d||last}; })
  .sort((a,b)=>a.d===b.d?b.i-a.i:(a.d<b.d?1:-1)).map(x=>x.g); }
// quick select: 'all' | 'none' | N (the N most recent ticked, the rest unticked)
function rpQuick(q){ const games=rpTeamGames(GAMES, RP_O.team, RP_O.season, RP_O.comp); RP_O.off.clear();
  if(q==='none') games.forEach(g=>RP_O.off.add(g.id));
  else if(q!=='all'){ const keep=new Set(rpRecent(games).slice(0, +q).map(g=>g.id)); games.forEach(g=>{ if(!keep.has(g.id)) RP_O.off.add(g.id); }); } }
let RP_TIMER=null, RP_TOKEN=0;
function rpBundleOf(id){ return BUNDLES.get(id); }
function rpSchedule(){ if(typeof TAB==='undefined'||TAB!=='reports'||!GAMES_READY) return; clearTimeout(RP_TIMER); RP_TIMER=setTimeout(rpRenderCtl, 30); }
function rpTeams(){ const s=new Set(); GAMES.forEach(g=>{ [g.homeTeam, g.awayTeam].forEach(t=>{ const u=ssUC(t); if(u) s.add(u); }); }); return [...s].sort(); }
// the defaults: the team chosen elsewhere in Analysis, its latest season and the competition of its latest game
function rpEnsure(){
  const teams=rpTeams(); if(!teams.length) return false;
  if(!teams.includes(RP_O.team)){ let t=''; try{ t=ssUC(sessionStorage.getItem('cohesion_analysis_team')||''); }catch(_){ } RP_O.team=teams.includes(t)?t:teams[0]; RP_O.season=''; RP_O.comp=''; }
  const list=ovTeamGames(GAMES, RP_O.team), seasons=pdSeasons(list);
  if(!seasons.includes(RP_O.season)){ RP_O.season=seasons[0]||''; RP_O.comp=''; }
  const comps=pdComps(list, RP_O.season);
  if(!comps.includes(RP_O.comp)){ const latest=list.find(g=>pdSeasonOf(g)===RP_O.season); RP_O.comp=latest&&comps.includes(String(latest.competition||'').trim())?String(latest.competition).trim():comps[0]||''; }
  const games=rpTeamGames(GAMES, RP_O.team, RP_O.season, RP_O.comp);
  if(!games.some(g=>g.id===RP_O.ko)) RP_O.ko=games.length?games[games.length-1].id:'';
  return true;
}
function rpSel(){ return rpTeamGames(GAMES, RP_O.team, RP_O.season, RP_O.comp).filter(g=>!RP_O.off.has(g.id)); }
function rpCtlHTML(){
  const teams=rpTeams(), list=ovTeamGames(GAMES, RP_O.team), seasons=pdSeasons(list), comps=pdComps(list, RP_O.season), games=rpTeamGames(GAMES, RP_O.team, RP_O.season, RP_O.comp);
  const opt=(v,l,on)=>`<option value="${rpE(v)}"${on?' selected':''}>${rpE(l)}</option>`, nm=rpTeamName(RP_O.team, list);
  const gl=g=>(ovShortDate(g.date)||'date n/a')+' · '+(g.round?g.round+' · ':'')+'v '+rpOpp(g, RP_O.team);
  const nOn=games.filter(g=>!RP_O.off.has(g.id)).length;
  const pick=`<div class="fg rp-fg rp-gfg"><label>GAMES <span class="fnote">(${nOn} of ${games.length})</span></label>`
      +`<div class="msbar rp-quick">${[['3','Last 3'],['5','Last 5'],['10','Last 10'],['all','All'],['none','None']].map(([q,l])=>`<button type="button" class="mini" data-rpq="${q}">${l}</button>`).join('')}</div><div class="rp-glist" id="rpGames">`
      +games.map(g=>`<label class="gitem"><input type="checkbox" data-rpg="${rpE(g.id)}"${RP_O.off.has(g.id)?'':' checked'}> ${rpE(gl(g))}</label>`).join('')+`</div>`
      +(RP_O.kind==='ko'?`<label class="gitem rp-logopt"><input type="checkbox" id="rpKoLog"${RP_O.koLog?' checked':''}> Include full kickout log <span class="fnote">(several games)</span></label>`:'')+`</div>`;
  return `<div class="filters rp-ctl"><div class="fg rp-fg"><label for="rpKind">REPORT</label><select id="rpKind">${RP_KINDS.map(([k,l])=>opt(k, l, k===RP_O.kind)).join('')}</select></div>`
    +`<div class="fg rp-fg"><label for="rpTeam">TEAM</label><select id="rpTeam">${teams.map(t=>opt(t, rpTeamName(t, ovTeamGames(GAMES, t)), t===RP_O.team)).join('')}</select></div>`
    +`<div class="fg rp-fg"><label for="rpSeason">SEASON</label><select id="rpSeason">${seasons.map(s=>opt(s, s, s===RP_O.season)).join('')||opt('','—',true)}</select></div>`
    +`<div class="fg rp-fg"><label for="rpComp">COMPETITION</label><select id="rpComp">${comps.map(c=>opt(c, c, c===RP_O.comp)).join('')||opt('','—',true)}</select></div>${pick}`
    +`<div class="fg rp-fg rp-acts"><label>&nbsp;</label><div><button type="button" class="act primary" id="rpBuild">Build report</button> <button type="button" class="act" id="rpPdf"${RP_O.built?'':' disabled'}>⬇ Download PDF</button></div></div></div>`
    +`<p class="fnote rp-what">${rpE(RP_O.kind==='ko'?nm+'’s own kickouts: one game ticked = that game’s report; several = all of them together (no ranks).':RP_O.kind==='opp'?'The same figures as the Team Report, framed as the opponent: '+nm+'’s kickout, turnovers, shooting, key players, how teams scored against them, their defeats.':nm+' over the ticked games.')} ${RP_O.kind==='ko'?'':'Ranks compare every team with games of the same competition and season uploaded. '}Stats only — no notes.</p>`;
}
function rpRenderCtl(){ const c=ssEl('rpCtlWrap'); if(!c) return; if(!rpEnsure()){ c.innerHTML='<div class="tt-empty">No games uploaded.</div>'; return; } c.innerHTML=rpCtlHTML(); }
function rpFileName(M){ const clean=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’']/g,'').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'');
  const range=M.kind==='ko'&&!M.K.multi?'v_'+M.oppName+'_'+(ssIsoDate(M.g.date)||M.g.round||''):M.season+'_'+M.comp+'_'+rpGl(M.n);
  return [M.name, M.kindName, range].map(clean).filter(Boolean).join('_'); }
// fetch the games a report needs (the team's, and every game of the competition for the ranks), four at a time
async function rpLoad(ids, st){ const need=ids.filter(id=>!BUNDLES.has(id)); for(let i=0;i<need.length;i+=4){ if(st) st.textContent='Loading games… '+Math.min(i+4, need.length)+'/'+need.length; await Promise.all(need.slice(i,i+4).map(id=>fetchBundle(id).catch(()=>null))); } }
function rpModelBase(T, kind, extra){ const col=rpCol(T); return Object.assign({T, kind, kindName:RP_KINDS.find(k=>k[0]===kind)[1], col, bundleOf:rpBundleOf}, extra); }
async function rpBuild(){
  const tok=++RP_TOKEN, st=ssEl('rpStatus'), out=ssEl('rpPages'), t0=Date.now(); if(!out) return;
  const T=RP_O.team, kind=RP_O.kind; out.innerHTML=''; RP_O.built=null; const pdf=ssEl('rpPdf'); if(pdf) pdf.disabled=true;
  try{
    let html='', M;
    if(kind==='ko'&&rpSel().length===1){
      const g=rpSel()[0];
      await rpLoad([g.id], st); if(tok!==RP_TOKEN) return;
      const K=rpKoCompute(T, g, {bundleOf:rpBundleOf}); if(!K){ st.textContent='This game could not be loaded.'; return; }
      M=rpModelBase(T, 'ko', {name:K.name, oppName:K.oppName, g, subTxt:'v '+K.oppName+' · '+[g.competition, g.round].filter(Boolean).join(' ')+' · '+(ovShortDate(g.date)||'date n/a'), n:1, K});
      html=K.n?rpKoReport(K, M):rpPage(M, rpNote(M.name+' have no kickouts with an outcome in this game.'), {h:'Kickout Report'});
    } else if(kind==='ko'){
      const sel=rpSel(); if(!sel.length){ st.textContent='Tick at least one game.'; return; }
      await rpLoad(sel.map(g=>g.id), st); if(tok!==RP_TOKEN) return;
      const K=rpKoMultiCompute(T, sel, {bundleOf:rpBundleOf});
      M=rpModelBase(T, 'ko', {name:K.name, season:RP_O.season, comp:RP_O.comp, n:K.games.length, K, subTxt:RP_O.comp+' '+RP_O.season+' · '+rpGl(K.games.length)});
      html=K.n?rpKoMultiReport(K, M, {log:RP_O.koLog}):rpPage(M, rpNote(M.name+' have no kickouts with an outcome in these games.'), {h:'Kickout Report'});
    } else {
      const sel=rpSel(); if(!sel.length){ st.textContent='Tick at least one game.'; return; }
      const compG=rpCompGames(GAMES, RP_O.season, RP_O.comp);
      await rpLoad(compG.map(g=>g.id), st); if(tok!==RP_TOKEN) return;
      st.textContent='Computing…'; await new Promise(r=>setTimeout(r, 0));
      const RK=rpRanks(compG, rpBundleOf), base=rpCompute(T, sel, {bundleOf:rpBundleOf, RK, comp:RP_O.comp, season:RP_O.season});
      const rkNote=RK.n>1?'Ranks: '+RK.n+' teams with data, '+RK.loaded+' '+RP_O.comp+' '+RP_O.season+' games uploaded.':'Ranks: n/a — only '+RK.n+' team has '+RP_O.comp+' '+RP_O.season+' games uploaded.';
      M=Object.assign(base, rpModelBase(T, kind, {}), {name:base.name, rkNote, subTxt:RP_O.comp+' '+RP_O.season+' · '+rpGl(base.n), coverTitle:kind==='opp'?base.name:base.name});
      html=rpBuildTeam(M, kind==='opp');
    }
    if(tok!==RP_TOKEN) return;
    out.innerHTML=html; out.style.setProperty('--pa', M.col.a); out.style.setProperty('--pb', M.col.b); out.style.setProperty('--pbar', M.col.bar); out.style.setProperty('--ponbar', M.col.onBar);
    rpPaginate(out);
    const pages=out.querySelectorAll('.rp-page'); pages.forEach((p,i)=>{ const n=p.querySelector('.rp-pn'); if(n) n.textContent=(i+1)+' / '+pages.length; });
    RP_O.built={M, file:rpFileName(M), pages:pages.length, ms:Date.now()-t0};
    rpFit(); if(pdf) pdf.disabled=false;
    st.textContent=pages.length+' pages · built in '+((Date.now()-t0)/1000).toFixed(1)+' s · '+rpGl(M.n)+(M.RK?' · '+M.rkNote:'');
  }catch(e){ st.textContent='Could not build the report: '+e.message; if(typeof console!=='undefined') console.error(e); }
}
// A long table (the shooters, the kickout log) that does not fit its page: the rows that do not fit go to a continuation page
// (the same frame, the table's heading row repeated) — measured on the page itself, so a wrapped name never runs off the paper
function rpPaginate(root){
  const over=b=>b.scrollHeight>b.clientHeight+1;
  // the splittable block of a page: the last long table's rows, or a .rp-flowc block's children (the kickout strips)
  const unit=b=>{ const l=[...b.querySelectorAll('table.rp-split, .rp-flowc')].filter(x=>x.matches('.rp-flowc')?x.children.length>1:x.querySelector('tbody')&&x.querySelector('tbody').rows.length>1); return l[l.length-1]||null; };
  for(let guard=0; guard<300; guard++){
    const page=[...root.querySelectorAll('.rp-page')].find(p=>{ const b=p.querySelector('.rp-body'); return b&&over(b)&&unit(b); }); if(!page) return;
    const body=page.querySelector('.rp-body'), t=unit(body), flow=t.matches('.rp-flowc'), box=flow?t:t.querySelector('tbody'), moved=[];
    // everything after the block (its notes, later blocks) goes with the last part
    let top=t; while(top.parentNode!==body) top=top.parentNode;
    const after=[]; let n=top.nextSibling; while(n){ after.push(n); n=n.nextSibling; } after.forEach(x=>x.remove());
    const kids=()=>flow?box.children:box.rows;
    while(over(body)&&kids().length>1) moved.unshift(box.removeChild(kids()[kids().length-1]));
    // a group heading row never ends a page on its own
    if(!flow){ while(kids().length>1&&kids()[kids().length-1].classList.contains('rp-grp')) moved.unshift(box.removeChild(kids()[kids().length-1])); }
    if(!moved.length){ after.forEach(x=>body.appendChild(x)); return; }
    const np=page.cloneNode(true), nb=np.querySelector('.rp-body'); nb.innerHTML='';
    const h=page.querySelector('.rp-h'); if(h){ const h2=document.createElement('h2'); h2.className='rp-h'; h2.textContent=h.textContent.replace(/ \(continued\)$/,'')+' (continued)'; nb.appendChild(h2); }
    let nt;
    if(flow){ nt=t.cloneNode(false); moved.forEach(r=>nt.appendChild(r)); }
    else { nt=t.cloneNode(false); nt.appendChild(t.querySelector('thead').cloneNode(true)); const ntb=document.createElement('tbody'); moved.forEach(r=>ntb.appendChild(r)); nt.appendChild(ntb); }
    if(top!==t){ const wrap=top.cloneNode(false); wrap.appendChild(nt); nb.appendChild(wrap); } else nb.appendChild(nt);
    after.forEach(x=>nb.appendChild(x)); np.dataset.sec=''; page.after(np);
  }
}
// the preview: the A4 pages scaled to the pane's width
function rpFit(){ const out=ssEl('rpPages'); if(!out||!out.clientWidth) return; const w=out.clientWidth, z=Math.min(1, (w-4)/(210*96/25.4)); out.style.setProperty('--rpz', z.toFixed(4)); }
// print: the pages into #rpPrint (a child of <body>), everything else hidden; the title is the PDF's default file name
function rpPrintPrepare(){ const B=RP_O.built, src=ssEl('rpPages'); if(!B||!src) return 0;
  let host=ssEl('rpPrint'); if(!host){ host=document.createElement('div'); host.id='rpPrint'; document.body.appendChild(host); }
  host.innerHTML=src.innerHTML; ['--pa','--pb','--pbar','--ponbar'].forEach(k=>host.style.setProperty(k, src.style.getPropertyValue(k)));
  RP_O.title=document.title; document.title=B.file; document.body.classList.add('rp-printing');
  return host.querySelectorAll('.rp-page').length; }
function rpPrintDone(){ document.body.classList.remove('rp-printing'); if(RP_O.title!=null){ document.title=RP_O.title; RP_O.title=null; } }
function rpPrint(){ if(!rpPrintPrepare()) return; try{ window.print(); }finally{ setTimeout(rpPrintDone, 0); } }
function rpInit(){
  const pane=ssEl('pane-reports'); if(!pane||!pane.addEventListener) return;
  pane.addEventListener('change', e=>{ const t=e.target; if(!t) return; const inval=()=>{ RP_O.built=null; };
    if(t.id==='rpKind'){ RP_O.kind=t.value; inval(); rpRenderCtl(); return; }
    if(t.id==='rpTeam'){ RP_O.team=t.value; RP_O.season=''; RP_O.comp=''; RP_O.off.clear(); inval(); rpRenderCtl(); return; }
    if(t.id==='rpSeason'){ RP_O.season=t.value; RP_O.comp=''; RP_O.off.clear(); inval(); rpRenderCtl(); return; }
    if(t.id==='rpComp'){ RP_O.comp=t.value; RP_O.off.clear(); inval(); rpRenderCtl(); return; }
    if(t.id==='rpKo'){ RP_O.ko=t.value; inval(); rpRenderCtl(); return; }
    if(t.id==='rpKoLog'){ RP_O.koLog=!!t.checked; inval(); return; }
    if(t.dataset&&t.dataset.rpg){ if(t.checked) RP_O.off.delete(t.dataset.rpg); else RP_O.off.add(t.dataset.rpg); inval(); rpRenderCtl(); } });
  pane.addEventListener('click', e=>{ const t=e.target, c=s=>t&&t.closest?t.closest(s):null; let x;
    if((x=c('#rpBuild'))){ rpBuild(); return; }
    if((x=c('#rpPdf'))){ if(!x.disabled) rpPrint(); return; }
    if((x=c('[data-rpq]'))){ rpQuick(x.dataset.rpq); RP_O.built=null; rpRenderCtl(); return; }
    if((x=c('[data-rpall]'))){ const on=x.dataset.rpall==='1'; rpTeamGames(GAMES, RP_O.team, RP_O.season, RP_O.comp).forEach(g=>{ if(on) RP_O.off.delete(g.id); else RP_O.off.add(g.id); }); RP_O.built=null; rpRenderCtl(); } });
  if(typeof window!=='undefined'&&window.addEventListener){ window.addEventListener('resize', rpFit); window.addEventListener('afterprint', rpPrintDone); }
  const s=document.createElement('style'); s.id='rpCss'; s.textContent=RP_CSS; document.head.appendChild(s);
}
const RP_CSS=`
#pane-reports .rp-ctl{align-items:flex-start;flex-wrap:wrap;}
.rp-fg select{min-width:150px;} .rp-gfg{min-width:260px;flex:1 1 300px;} .rp-glist{max-height:150px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:4px 8px;background:var(--card);}
.rp-glist .gitem{display:block;font-size:13px;padding:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rp-quick{margin:0 0 4px;flex-wrap:wrap;} .rp-logopt{display:block;margin-top:6px;font-size:13px;}
.rp-sgame{border-bottom:1px solid #e3e6e8;padding-bottom:1.2mm;} .rp-sgame .rp-shl{flex:0 0 22mm;font:700 7pt/1.2 'Barlow',sans-serif;color:#2b2f33;letter-spacing:0;padding-top:1mm;} .rp-sgame .rp-shl span{font-weight:600;color:#5b6067;}
.rp-hsep{width:.8mm;align-self:stretch;background:#9aa0a6;border-radius:.4mm;margin:0 .6mm;} .rp-t tr.rp-grp td{background:#e9ecee !important;font-weight:700;text-align:left;}
.rp-acts > div{display:flex;gap:8px;flex-wrap:wrap;} .rp-what{margin:4px 2px 10px;}
#rpStatus{margin:6px 2px 10px;color:var(--t2);font-size:13px;min-height:1.2em;}
#rpPages{--rpz:1;display:flex;flex-direction:column;align-items:center;gap:14px;overflow:hidden;padding:0 0 30px;}
#rpPages .rp-page{zoom:var(--rpz);box-shadow:0 4px 24px rgba(0,0,0,.45);}
/* ── the A4 page ── */
.rp-page{width:210mm;height:297mm;box-sizing:border-box;padding:0;position:relative;overflow:hidden;background:#fff;color:#16181b;font:8.6pt/1.32 'Barlow',Arial,sans-serif;display:flex;flex-direction:column;break-after:page;page-break-after:always;flex:none;}
.rp-page:last-child{break-after:auto;page-break-after:auto;}
.rp-page *{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box;}
.rp-hd{display:flex;justify-content:space-between;align-items:center;padding:5mm 12mm 4mm;background:var(--pbar);color:var(--ponbar);}
.rp-hl{display:flex;align-items:center;gap:3mm;} .rp-hl b{display:block;font:800 11pt 'Barlow',sans-serif;letter-spacing:.02em;} .rp-hl span{font-size:8.5pt;opacity:.9;}
.rp-hcrest{width:10mm;height:10mm;object-fit:contain;background:#fff;border-radius:1.5mm;padding:.6mm;}
.rp-logo{font:800 13pt 'Barlow Condensed',sans-serif;letter-spacing:.06em;} .rp-logo span{opacity:.7;}
.rp-stripe{display:flex;height:1.6mm;} .rp-stripe i{flex:1;box-shadow:inset 0 0 0 .15mm rgba(0,0,0,.12);}
.rp-body{flex:1 1 auto;min-height:0;padding:6mm 12mm 12mm;display:flex;flex-direction:column;gap:2.6mm;overflow:hidden;}
.rp-sec{font:800 8pt 'Barlow Condensed',sans-serif;letter-spacing:.14em;color:#9a6b00;}
.rp-h{font:800 20pt/1.05 'Barlow',sans-serif;margin:0;color:#111;} .rp-cap{font:600 10.5pt/1.3 'Barlow',sans-serif;color:var(--pa);margin:0;}
.rp-h3{font:800 10.5pt 'Barlow',sans-serif;margin:1.5mm 0 0;color:#111;} .rp-h4{font:800 8pt 'Barlow Condensed',sans-serif;letter-spacing:.1em;margin:1mm 0 .6mm;color:var(--pa);} .rp-h4.pos{color:#157a35;} .rp-h4.neg{color:#b42318;}
.rp-p{margin:0;font-size:9pt;} .rp-note{margin:0;font-size:6.9pt;line-height:1.3;color:#5b6067;}
.rp-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:5mm;align-items:start;} .rp-two ul{margin:0;padding-left:4mm;font-size:8.6pt;}
.rp-tiles{display:grid;gap:1.6mm;} .rp-tiles.c4{grid-template-columns:repeat(4,minmax(0,1fr));} .rp-tiles.c2{grid-template-columns:repeat(2,minmax(0,1fr));}
.rp-tile{background:#f2f4f3;border-radius:1.5mm;padding:2mm 1.5mm 1.6mm;text-align:center;min-width:0;} .rp-tile b{display:block;font:800 16pt/1.05 'Barlow',sans-serif;color:var(--pa);}
.rp-tile span{display:block;font:600 6.6pt/1.2 'Barlow',sans-serif;letter-spacing:.03em;color:#2b2f33;margin-top:.6mm;} .rp-tile i{display:block;font:600 6.6pt/1.2 'Barlow',sans-serif;font-style:normal;color:#9a6b00;margin-top:.4mm;}
.rp-t{width:100%;border-collapse:collapse;font-size:7.8pt;} .rp-t th{background:#16181b;color:#fff;font:700 7.4pt 'Barlow',sans-serif;padding:1.1mm 1.3mm;text-align:center;} .rp-t td{padding:.9mm 1.3mm;text-align:center;border-bottom:1px solid #e3e6e8;}
.rp-t th.l,.rp-t td.l{text-align:left;} .rp-t tbody tr:nth-child(even) td{background:#f6f7f7;} .rp-t tr.tot td{font-weight:700;border-top:1px solid #16181b;} .rp-t .na{color:#9aa0a6;}
.rp-t.sm{font-size:7pt;} .rp-t.sm td{padding:.6mm 1mm;} .rp-t td{overflow-wrap:anywhere;}
.rp-svg{display:block;max-width:100%;height:auto;overflow:visible;font-family:'Barlow',Arial,sans-serif;} .rp-sl{font-size:2.5px;fill:#3a3f45;} .rp-sv{font-size:2.4px;fill:#16181b;font-weight:600;} .rp-sv.b{font-weight:800;}
.rp-ax{stroke:#9aa0a6;stroke-width:.2;} .rp-grid{stroke:#e6e8ea;stroke-width:.2;}
.rp-mapw .tt-pitch{border-radius:1.5mm;display:block;width:100%;height:auto;} .rp-mapw.sm{max-width:80mm;}
.rp-nomap{border:1px dashed #c9cdd2;border-radius:1.5mm;padding:8mm 3mm;text-align:center;color:#5b6067;font-size:8pt;}
.rp-key{display:flex;flex-wrap:wrap;gap:1mm 3mm;font-size:6.6pt;color:#3a3f45;margin-top:1mm;} .rp-key span{display:inline-flex;align-items:center;gap:1mm;} .rp-key i{display:inline-block;width:2.4mm;height:2.4mm;border-radius:50%;border:.2mm solid #16181b;}
.rp-key i.o{background:transparent;} .rp-key i.sq{border-radius:0;background:#c9cdd2;}
.rp-prof{border-top:.5mm solid var(--pa);padding-top:2mm;margin-bottom:3mm;} .rp-pname{font:800 13pt 'Barlow',sans-serif;margin:0;} .rp-psum{margin:0 0 1.5mm;font:600 9pt 'Barlow',sans-serif;color:var(--pa);}
/* kickout report */
.rp-shalf{display:flex;gap:2mm;align-items:flex-start;margin-bottom:1.5mm;} .rp-shl{flex:0 0 14mm;font:700 6.5pt 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:#5b6067;padding-top:2.5mm;}
.rp-strip{display:flex;flex-wrap:wrap;gap:1mm;align-items:flex-end;flex:1;}
.rp-ht{display:flex;align-items:flex-end;align-self:stretch;border-left:.4mm dashed #9aa0a6;padding:0 .6mm 0 1mm;margin-left:.6mm;} .rp-ht.first{border-left:0;margin-left:0;padding-left:0;}
.rp-ht span{font:700 6pt 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:#5b6067;writing-mode:vertical-rl;transform:rotate(180deg);}
.rp-kb{width:8mm;display:flex;flex-direction:column;align-items:center;} .rp-kb b,.rp-kb i{display:block;width:8mm;text-align:center;color:#fff;font-style:normal;}
.rp-kb b{font:800 10pt/1.3 'Barlow',sans-serif;border-radius:1mm 1mm 0 0;} .rp-kb i{font:600 6.5pt/1.5 'Barlow',sans-serif;border-radius:0 0 1mm 1mm;} .rp-kb span{font-size:6.5pt;color:#3a3f45;}
.rp-kb.kept b,.rp-kb.kept i{background:#1f9d55;} .rp-kb.lost b,.rp-kb.lost i{background:#c0392b;}
.rp-kmapw .tt-pitch{border-radius:1.5mm;display:block;width:100%;height:auto;} .rp-kn{font:800 2.2px 'Barlow',sans-serif;fill:#fff;} .rp-kl{font:600 2.4px 'Barlow',sans-serif;fill:rgba(255,255,255,.75);}
/* cover */
.rp-cover{display:flex;flex-direction:column;} .rp-cband{padding:26mm 16mm 14mm;display:flex;flex-direction:column;align-items:flex-start;gap:3mm;}
.rp-ckind{font:800 9pt 'Barlow Condensed',sans-serif;letter-spacing:.2em;opacity:.9;} .rp-ccrest{width:30mm;height:30mm;object-fit:contain;background:#fff;border-radius:3mm;padding:1.5mm;}
.rp-cband h1{font:800 40pt/1 'Barlow',sans-serif;margin:2mm 0 0;} .rp-cband h2{font:600 15pt 'Barlow',sans-serif;margin:0;opacity:.92;} .rp-cstripe{height:4mm;}
.rp-cbody{padding:10mm 16mm;display:flex;flex-direction:column;gap:4mm;} .rp-copps{font:600 10pt 'Barlow',sans-serif;margin:0;color:#2b2f33;} .rp-crec{font:700 11pt 'Barlow',sans-serif;margin:0;color:var(--pa);}
.rp-cover .rp-tile b{font-size:22pt;} .rp-clogo{margin-top:auto;padding:0 16mm 16mm;font:800 22pt 'Barlow Condensed',sans-serif;letter-spacing:.06em;color:#16181b;} .rp-clogo span{color:var(--pa);} .rp-clogo small{font-size:10pt;letter-spacing:.2em;color:#5b6067;margin-left:2mm;}
.rp-ft{position:absolute;left:12mm;right:12mm;bottom:5mm;display:flex;justify-content:space-between;font-size:6.6pt;color:#7a7f87;border-top:1px solid #e3e6e8;padding-top:1.2mm;}
#rpPrint{display:none;}
@media print{
  body.rp-printing > *:not(#rpPrint){display:none !important;}
  body.rp-printing #rpPrint{display:block !important;}
  body:not(.rp-printing) #rpPrint{display:none !important;}
  body.rp-printing{background:#fff !important;margin:0 !important;}
  body.rp-printing #rpPrint .rp-page{zoom:1;box-shadow:none;}
}
@media (max-width:600px){ .rp-fg select{min-width:0;width:100%;} #pane-reports .rp-ctl .fg{flex:1 1 100%;} }
`;
if(typeof module!=='undefined'&&module.exports) module.exports={rpCompute, rpKoCompute, rpRanks, rpTeamAgg, rpBands, rpShooting, rpCompGames, rpTeamGames, rpOrd, rpRoundW, RP_METRICS, RP_DIST};
