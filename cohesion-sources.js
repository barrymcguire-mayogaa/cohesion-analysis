/* COHESION — where a possession, and so a shot or a score, came from (SHARED: analysis.html and code-room.html)
 *
 * ONE rule for the source of a possession. Analysis › Overview › Productivity ("BY WHERE THE BALL CAME FROM") and the
 * source doughnuts read it; Code Room's "Auto-tag sources" writes the missing "<TEAM> SCORE SOURCE" / "SHOT SOURCE"
 * rows from it (cohAutoSourcePlan below). Moved here unchanged from analysis.html (14 Oct 2026) together with the
 * helpers it needs, so the two pages cannot drift apart; Analysis's numbers are byte-identical (cohesion-tests
 * autosrc/analysis_parity.js).
 *
 * Plain script: every name is a global of the page (analysis.html uses them all over its metric engine), and the
 * file loads before the page's own script. Also require()-able in Node (module.exports at the end).
 */

const SS_KO_GROUPS=['Kickout Outcomes','KickoutOutcome','PO_Result'];
// Label lookup: group names are matched trimmed and case-insensitively (real files carry "shot outcomes",
// "Shot Outcomes " …); the first group of `groups` with a value wins, an exact-name hit first.
function ssLbl(e,groups){
  const L=(e&&e.labels)||{}; let ks=null;
  for(const g of groups){
    if(L[g]) return L[g];
    const w=ssUC(g); ks=ks||Object.keys(L);
    for(const k of ks){ if(L[k]&&k!==g&&ssUC(k)===w) return L[k]; }
  }
  return null;
}
function ssL(e,name){ return ssLbl(e,[name]); }
function ssUC(s){ return String(s||'').toUpperCase().trim(); }
function ssSideOf(e, T){
  const t=ssUC(e.team); if(t) return t===T;
  return ssUC(e.code).startsWith(T+' ');
}
function ssIsKO(e){ const c=ssUC(e.code); return /KICKOUT|\bKO\b|\bKOS\b/.test(c)&&!/SOURCE|LOST|WON/.test(c)||e.category==='Kickouts'; }
function ssIsTO(e){ const c=ssUC(e.code); return /\bTOS?\b|TURNOVER/.test(c)&&!/SOURCE/.test(c); }
function ssIsPoss(e){ return /TEAM POSSESSION/.test(ssUC(e.code)); }
function ssKoWon(v){ const K=ssUC(v); return K.includes('RT ')?false:K.includes('KT ')?true:(K.includes('WON')&&!K.includes('LOST')); }
// Did the KICKING team win its own kickout? GIU names the WINNER in the
// outcome ("Kerry Clean", "Donegal Break", "Kerry SL", "Donegal Free" on a
// "Kerry Kickout"), so an outcome that starts with a team's name is decided
// by that name; every other vocabulary (Tracker / Code Room "KO WON CLEAN",
// "KO BREAK LOST" …; Gaelic Insights "KT Won …" / "RT Won …") goes to ssKoWon.
function ssKoKickerWon(out, kicker, other){
  const K=ssUC(out);
  if(other&&(K===other||K.startsWith(other+' '))) return false;
  if(kicker&&(K===kicker||K.startsWith(kicker+' '))) return true;
  return ssKoWon(out);
}
// case-insensitive label lookup (real files carry 'Turnover Locations',
// 'Turnover Location', 'TURNOVER LOCATIONS', 'turnover outcomes' …)
function ssLblCI(e, names){
  const L=e.labels||{};
  for(const n of names){ if(L[n]!=null&&String(L[n]).trim()) return String(L[n]).trim(); }
  const want=names.map(ssUC);
  for(const k of Object.keys(L)){ if(want.includes(ssUC(k))&&String(L[k]||'').trim()) return String(L[k]).trim(); }
  return '';
}
// Sources that count as "after an in-play turnover": FORCED / UNFORCED
// TURNOVER, the plain TURNOVER of a GI game, and FREE WON — in the Tracker a
// Free Against is an in-play turnover and sets the next possession's source to
// FREE WON. (Kickout Lost → OPP KICKOUT and Shot Attempt → BALL RECOVERED are
// not in-play turnovers, so those sources are not counted.)
const SS_SRC_TO_KEYS=['FTO','UTO','TO','FREE'];
function ssSrcCat(txt){
  const S=ssUC(txt); if(!S) return null;
  if(/\bOWN\s+(KICK\s*OUT|KO)S?\b/.test(S)) return 'OWN KO';
  if(/\bOPP(OSITION)?\s+(KICK\s*OUT|KO)S?\b/.test(S)) return 'OPP KO';
  if(/UNFORCED|\bU\/TO\b|OPPOSITION ERROR/.test(S)) return 'UTO';
  if(/FORCED|\bF\/TO\b/.test(S)) return 'FTO';
  if(/FREE/.test(S)) return 'FREE';
  if(/BALL RECOVERED|\bRECOVER/.test(S)) return 'BR';
  if(/THROW[\s-]*(IN|UP)/.test(S)) return 'TI';
  if(/TURNOVER|\bTOS?\b/.test(S)) return 'TO';
  return 'OTHER';
}
const SS_TO_OUT_GROUPS=['Turnover Outcomes','Turnover Outcome','TurnoverOutcome'];
function ssToWinnerCoded(e){ return /(TURNOVERS?|\bTOS?)\s+WON\b/.test(ssUC(e.code)); }
function ssEvT(e){ return e.start!=null?+e.start:(+e.driveT||0); }
function ssToKind(e){
  const K=ssUC(ssLblCI(e,SS_TO_OUT_GROUPS)||e.outcome);
  if(/KICK\s*OUT LOST|\bKO LOST\b/.test(K)) return /^KO LOST\b/.test(K)?'koLen':'ko';
  if(/SHOT ATTEMPT/.test(K)) return 'shot';
  return 'play';
}
function ssToType(e){ const K=ssUC(ssLblCI(e,SS_TO_OUT_GROUPS)||e.outcome); return /UNFORCED/.test(K)?'U':/FORCED/.test(K)?'F':/HANDLING/.test(K)?'H':/FREE AGAINST/.test(K)?'FA':'X'; }
// ═══════════════════════════════════════════════════════════════
//  POSSESSIONS BY SOURCE — where each possession came from (Overview ›
//  Productivity › "BY WHERE THE BALL CAME FROM"). A "<TEAM> TEAM POSSESSION"
//  row carries no source in a Tracker / Code Room game, so it is DERIVED, in
//  this order, and a possession nothing identifies stays "not identified"
//  (never spread over the others):
//   1. LABEL — the row's own 'PossFrom' (a GIU possession, converted or
//      merged: Own Kickout / Opp Kickout / Turnover / Throw Up).
//   2. TAG — the possession's own "<TEAM> SCORE SOURCE" / "SHOT SOURCE" row.
//      The Tracker writes both the possession row and the source rows of its
//      shots from the same possStartSec, and a possession row is one run of
//      entries with the SAME team and source, so every source row that
//      overlaps a possession of its team says that possession's source. Each
//      source row goes to the one possession of its team whose span it matches
//      best (shared time ÷ time covered together).
//      (This is also the tag the POINTS are attributed by, so a score and the
//      possession it came from always land in the same category.)
//   3. START EVENT — a possession with no shot has no source row; it takes
//      the event that handed its team the ball: the team's own kickout that it
//      won (OWN KO), the opposition's kickout it won or the opposition's
//      "KICKOUT LOST" / "KO LOST <length>" turnover row (OPP KO), an opposition
//      in-play turnover row (FORCED → FORCED TO; UNFORCED / HANDLING →
//      UNFORCED TO; FREE AGAINST → FREE WON; untyped → TURNOVER), an opposition
//      "<TEAM> FOUL" row tagged FREE AGAINST (FREE WON), an opposition SHOT
//      ATTEMPT turnover (BALL RECOVERED), or a THROW-IN / throw-up / hop ball
//      row naming the team (THROW-IN) — the mapping the Tracker itself uses
//      for the next possession's source (MD_TO_TYPES). The event must start no
//      later than SS_PSRC_TOL s after the possession starts and end no more
//      than SS_PSRC_LAG s before it, with no other possession row starting in
//      between; each event starts at most ONE possession; the nearest wins (a
//      kickout before any other event at the same distance).
//  Every possession is matched to a start event (rule 3) even when rule 1 or 2
//  decides it, so the event is used up and the two readings can be compared
//  (psBoth / psAgree: the evidence that rule 3 can be trusted).
//  → {H:{…}, A:{…}} per team: n (= possession rows), by {cat: count}, ni,
//    label / tag / start (how many each rule decided), both, agree, list[];
//    fuBoth / fuAgree (possessions whose own tag AND start event both say forced or unforced; how many say the same
//    one), fuStart (possessions whose forced / unforced comes from the start event alone) — see SS_PSTO_*
// ═══════════════════════════════════════════════════════════════
const SS_PSRC_TOL=2;    // seconds an event may start AFTER the possession row does
const SS_PSRC_LAG=10;   // seconds between the event's end and the possession's start (7 real club games: the event's span contains the start for 468 of 493 matched possessions; the rest follow it by 1 – 8 s, mostly a shot attempt gathered)
const SS_PSRC_CACHE=new WeakMap();
// The table's rows, in display order, each a set of the existing source categories (SS_SRC_CATS — no second vocabulary):
// TURNOVER is the page's "after an in-play turnover" set (SS_SRC_TO_KEYS: FORCED TO, UNFORCED TO, the plain TURNOVER of a
// GIU / GI game and FREE WON); BALL RECOVERED (a shot attempt gathered by the other side) and THROW-IN stay their own
// categories, as on the doughnuts. Rows marked extra are shown only when they hold a possession or a point.
const SS_PSRC_ROWS=[
  {k:'OWN KO', label:'Own kickout',        cats:['OWN KO']},
  {k:'OPP KO', label:'Opposition kickout', cats:['OPP KO']},
  {k:'TURN',   label:'Turnover',           cats:SS_SRC_TO_KEYS},
  {k:'BR',     label:'Ball recovered',     cats:['BR'],    extra:true},
  {k:'TI',     label:'Throw-in',           cats:['TI'],    extra:true},
  {k:'OTHER',  label:'Other',              cats:['OTHER'], extra:true},
  {k:'NI',     label:'Not identified',     cats:[],        extra:true}];
function ssPsRowOf(cat){ const r=SS_PSRC_ROWS.find(x=>x.cats.includes(cat)); return r?r.k:'NI'; }
// WHEN FORCED v UNFORCED IS SHOWN FOR A GAME (g.psToOk, the same for both sides). A possession's own SCORE / SHOT
// SOURCE tag is the source the tagger chose. A possession with no shot has only its start event, and the Tracker's
// export writes a turnover row that has NO recorded type as FORCED when the possession that LOST the ball itself came
// from a forced turnover and UNFORCED otherwise (gaa-score-tracker.html, "TURNOVER / FREE AGAINST": e.toType missing →
// e.source==='F/TO'?…) — a label that says nothing about this turnover. Nothing on the row tells the two apart, so the
// game is tested: over the possessions of BOTH sides that carry an own tag AND a turnover-row start event, each saying
// forced or unforced, the two must say the same for at least SS_PSTO_MIN_AGREE of at least SS_PSTO_MIN_BOTH. (A game
// in which no possession takes forced / unforced from a start event passes: nothing rests on the rows.)
// The 7 real club games: Knockmore v Béal an Mhuirthead 6 of 14 the same (43 %; its turnover rows are 22 UNFORCED, 3
// FORCED and no HANDLING / FREE AGAINST — the fallback's signature) → fails; the other six 14/14, 11/12, 9/9, 23/23,
// 13/14, 10/10 (80 of 82, 98 %) → pass. At the failing game's rate, 7 of 8 agreeing by chance is about 1 in 70.
// In a game that fails, ALL its forced and unforced ball (possessions AND points, tagged ones too) goes to "Type not
// recorded": keeping only the tagged possessions would keep only those that ended in a shot, and a productivity
// figure from those alone would be inflated. Free won does not depend on the turnover type and stays.
const SS_PSTO_MIN_BOTH=8, SS_PSTO_MIN_AGREE=0.80;
function ssIsThrowIn(e){ const c=ssUC(e&&e.code); return /THROW[\s-]*(IN|UP)|HOP BALL/.test(c)&&!/SOURCE/.test(c); }
function ssPossSources(events, H, A, skip){
  if(!Array.isArray(events)) return null;
  const hit=SS_PSRC_CACHE.get(events); if(hit&&hit.n===events.length&&hit.v[H]&&hit.v[A]) return hit.v;
  const teamOf=e=>ssSideOf(e,H)?H:ssSideOf(e,A)?A:'', other=t=>t===H?A:H;
  const span=e=>{ const s=ssEvT(e); return [s, e.end!=null?Math.max(s,+e.end):s]; };
  const poss=[], srcRows=[], cands=[];
  events.forEach((e,i)=>{ if(!e||skip(e)) return;
    const team=teamOf(e), c=ssUC(e.code), [s,en]=span(e);
    if(ssIsThrowIn(e)){ const w=ssUC(e.team); if(w===H||w===A) cands.push({e,i,s,en,win:w,cat:'TI',ko:0,used:false}); return; }
    if(!team) return;
    if(ssIsPoss(e)){ poss.push({e,i,team,s,en,cat:null,how:null,tag:null,start:null,ev:null}); return; }
    if(/(SCORE|SHOT) SOURCE/.test(c)){ const cat=ssSrcCat(ssLblCI(e,['Score Source Outcomes','Shot Source Outcomes','Source'])); if(cat) srcRows.push({e,i,team,s,en,cat}); return; }
    if(ssIsKO(e)){ const out=ssLbl(e,SS_KO_GROUPS); if(!out) return;
      const won=ssKoKickerWon(out, team, other(team));
      cands.push({e,i,s,en,win:won?team:other(team),cat:won?'OWN KO':'OPP KO',ko:1,used:false}); return; }
    if(ssIsTO(e)){ const win=ssToWinnerCoded(e)?team:other(team), kind=ssToKind(e), ty=ssToType(e);
      cands.push({e,i,s,en,win,cat:(kind==='ko'||kind==='koLen')?'OPP KO':kind==='shot'?'BR':ty==='F'?'FTO':(ty==='U'||ty==='H')?'UTO':ty==='FA'?'FREE':'TO',ko:(kind==='ko'||kind==='koLen')?1:0,used:false}); return; }
    if(ssIsFoul(e)&&/FREE AGAINST/.test(ssUC(ssLblCI(e,SS_FOUL_AREA_GROUPS)))) cands.push({e,i,s,en,win:other(team),cat:'FREE',ko:0,used:false});
  });
  poss.sort((a,b)=>a.s-b.s||a.i-b.i);
  // rule 2: each source row → the possession of its team whose span it matches best: shared time ÷ the time the two cover
  // together (1 = the same span; touching counts as 0), then the nearer start, then the earlier row. (Plain "most shared
  // time" would hand every source row to a possession row that was left running over several others.)
  srcRows.sort((a,b)=>a.s-b.s||a.i-b.i).forEach(r=>{ let best=null, bo=-1, bd=0;
    poss.forEach(q=>{ if(q.team!==r.team) return; const o=Math.min(q.en,r.en)-Math.max(q.s,r.s); if(o<0) return;
      const u=Math.max(q.en,r.en)-Math.min(q.s,r.s), sc=u>0?o/u:1, d=Math.abs(q.s-r.s);
      if(!best||sc>bo||(sc===bo&&d<bd)){ bo=sc; bd=d; best=q; } });
    if(best){ if(!best.tag) best.tag=r.cat; else if(best.tag!==r.cat) best.tagMixed=true; } });
  // rule 3: the start event (one event → one possession, in time order)
  poss.forEach((q,k)=>{ let best=null, bg=0; const near=[];
    cands.forEach(c=>{ if(c.used||c.win!==q.team||c.s>q.s+SS_PSRC_TOL) return;
      const gap=Math.max(0, q.s-c.en); if(gap>SS_PSRC_LAG) return;
      for(let j=k-1;j>=0&&poss[j].s>c.en;j--){ if(poss[j].s<q.s) return; }   // another possession began after the event ended
      near.push({cat:c.cat, gap, ko:c.ko, e:c.e});                                     // every event that could have started it (read by cohAutoSourcePlan only)
      if(!best||gap<bg||(gap===bg&&(c.ko>best.ko||(c.ko===best.ko&&c.s>best.s)))){ best=c; bg=gap; } });
    q.near=near;
    if(best){ best.used=true; q.start=best.cat; q.ev=best.e; q.gap=bg; } });
  const mk=()=>({n:0, by:{}, ni:0, label:0, tag:0, start:0, both:0, agree:0, mixed:0, fuBoth:0, fuAgree:0, fuStart:0, list:[]});
  const isFU=c=>c==='FTO'||c==='UTO';
  const v={}; v[H]=mk(); v[A]=mk();
  poss.forEach(q=>{ const o=v[q.team], lab=ssSrcCat(ssLblCI(q.e,['PossFrom']));
    if(lab){ q.cat=lab; q.how='label'; o.label++; }
    else if(q.tag){ q.cat=q.tag; q.how='tag'; o.tag++; }
    else if(q.start){ q.cat=q.start; q.how='start'; o.start++; }
    if((lab||q.tag)&&q.start){ o.both++; if(ssPsRowOf(lab||q.tag)===ssPsRowOf(q.start)) o.agree++;
      if(isFU(lab||q.tag)&&isFU(q.start)){ o.fuBoth++; if((lab||q.tag)===q.start) o.fuAgree++; } }   // forced v unforced: own tag v the turnover row
    if(q.how==='start'&&isFU(q.cat)) o.fuStart++;
    if(q.tagMixed) o.mixed++;
    o.n++; if(q.cat) o.by[q.cat]=(o.by[q.cat]||0)+1; else o.ni++;
    o.list.push(q); });
  SS_PSRC_CACHE.set(events, {n:events.length, v});
  return v;
}
const SS_FOUL_AREA_GROUPS=['Foul Areas','Foul Area','PitchArea'];
function ssIsFoul(e){ return /(^|\s)FOULS?$/.test(ssUC(e&&e.code)); }
// The game-wide forced / unforced test above, for both sides of a game: PS = ssPossSources(events, H, A, skip).
// → {fuBoth, fuAgree, fuStart, ok:1|0} (Analysis's g.psFuBoth / psFuAgree / psFuStart / psToOk).
function ssPsToOk(PS, T, O){
  const ps=PS&&PS[T], po=PS&&PS[O], n=k=>(ps?ps[k]:0)+(po?po[k]:0);
  const fuBoth=n('fuBoth'), fuAgree=n('fuAgree'), fuStart=n('fuStart');
  return {fuBoth, fuAgree, fuStart, ok:(fuStart===0||(fuBoth>=SS_PSTO_MIN_BOTH&&fuAgree>=SS_PSTO_MIN_AGREE*fuBoth))?1:0};
}

// ═══════════════════════════════════════════════════════════════
//  AUTO-TAG SOURCES (Code Room) — the missing "<TEAM> SCORE SOURCE" / "<TEAM> SHOT SOURCE" row of every shot, from
//  the shooting team's TEAM POSSESSION that contains it, by the rule above (ssPossSources) — nothing else.
//
//  THE SHOTS: every "<TEAM> SHOT OPEN PLAY / DEADBALL" row (cohIsShotRow) of the home or away team; a Gaelic Insights
//  original superseded by its conversion, and the conversion's bare companions, are skipped exactly as Analysis skips
//  them. Scored (cohShotScored) → SCORE SOURCE with 'Score Source Outcomes' = the source and 'Score Source Score
//  Outcomes' = 1 POINT / 2 POINT / GOAL; otherwise (no outcome too) → SHOT SOURCE with 'Shot Source Outcomes'.
//
//  ALREADY TAGGED — never changed. A source row belongs to a shot of its team when the shot starts inside the row's span
//  (from COH_AS_ROW_LEAD s before its start to COH_AS_ROW_LAG s after its end — the window Code Room's score-source
//  value fill uses), or ends inside it (the row of a shot taken seconds after the ball was won starts after the shot
//  row); per team the rows and shots are paired in time order (cohAlign: the most pairs, then the smallest |row end − shot end|, a SCORE row with a scored shot and a SHOT row with a missed one before a cross
//  pairing). The Tracker writes ONE SHOT SOURCE row for a run of misses in a possession (its export "collapsed: only
//  the LAST miss in a consecutive run"), so a miss left unpaired that starts inside a SHOT SOURCE row of its team is
//  covered too — when the row's own shot is a later miss of the same possession (or the row has no shot of its own).
//  The Tracker's row runs from the possession's start to the shot's end (the same second), so pairing
//  by end is exact on its files.
//
//  THE POSSESSION: the shooting team's TEAM POSSESSION rows (as ssPossSources reads them) whose span holds the shot's
//  start, COH_AS_POSS_TOL s either side (whole-second rounding); of two, the one that started LATER (the most recent).
//  None → the possession that holds the shot's END and started after the shot's start (a shot within a few seconds
//  of winning the ball: the Tracker's shot row starts 9 s before the shot). Still none → review.
//
//  ITS SOURCE — the possession's category from ssPossSources: 1 its PossFrom label, 2 an existing source row in that
//  possession (another shot's), 3 the event that won the ball (≤ SS_PSRC_LAG s before / SS_PSRC_TOL s after its start).
//  CLEAR when it is one of OWN KO / OPP KO / FTO / UTO / BR / TI / FREE and:
//   · rule 3 decided it: no other event the rule cannot separate from it (same distance, same kickout priority — its
//     own tie-break is a kickout first) names a different category; FORCED / UNFORCED only in a game whose forced /
//     unforced marking passes Analysis's test (ssPsToOk). A game with too few source rows to run that test (fewer than
//     SS_PSTO_MIN_BOTH possessions with both — any game with no source rows) cannot pass it: its forced / unforced
//     shots go to review ('fuUnchecked') and are never written from the turnover rows alone — written as source rows
//     they would then 'pass' the very test that checks them;
//   · rule 1 or 2 decided it: it is not contradicted (the possession's own source rows do not disagree with each other,
//     and the event that won the ball, if any, names the same Productivity row — ssPsRowOf).
//  Everything else goes to the REVIEW list with its reason.
//
//  Also already tagged: a shot carrying its own source label (a converted Gaelic Insights shot). And in a game whose
//  shot sources Analysis reads from the possessions' PossFrom labels (GIU: no source row or label anywhere) nothing is
//  added at all — one row would switch Analysis to reading rows only (counts.possFrom, status 'possfrom').
//
//  DISAGREEMENTS: a tagged shot whose possession's source by label / start event (never its own row) is clear and is
//  not the row's value. Listed only; nothing changes.
//
//  THE NEW ROW: code = the shot's team prefix + SCORE SOURCE / SHOT SOURCE (the game's own spelling of that code when it
//  has one), team = the shot's team, half = the shot's half; start = the possession's start, end = the shot's end
//  (as the Tracker writes them); driveT = the possession row's driveT (its video second); gameTime = the possession's.
//  Label groups and values in the game's own spelling (cohGroupResolve / cohValueOptions) when the game has them.
//
//  cohAutoSourcePlan(events, meta) → {items:[…one per shot…], add:[rows to write], review, disagree, covered, counts}
// ═══════════════════════════════════════════════════════════════
const COH_SRC_TEXT={'OWN KO':'OWN KICKOUT','OPP KO':'OPP KICKOUT','FTO':'FORCED TURNOVER','UTO':'UNFORCED TURNOVER','BR':'BALL RECOVERED','TI':'THROW-IN','FREE':'FREE WON'};
const COH_SRC_VALUES=['OWN KICKOUT','OPP KICKOUT','FORCED TURNOVER','UNFORCED TURNOVER','BALL RECOVERED','THROW-IN','FREE WON'];
const COH_AS_POSS_TOL=2, COH_AS_ROW_LEAD=2, COH_AS_ROW_LAG=3;
const COH_AS_SRC_LABELS=['Shot Source Outcomes','Score Source Outcomes','Source'];   // a source label on a shot itself (Analysis's SS_SRC_LABELS)
const COH_AS_REASONS={      // the summary's words for each reason ({T} = the shooting team)
  noPoss:'shot not inside a possession of {T}',
  noStart:'possession has no event that won the ball within '+SS_PSRC_LAG+' s',
  toUntyped:'turnover not marked forced or unforced',
  fuUnchecked:'turnover marked forced / unforced, but this game has too few source rows to check that marking (Analysis’s test)',
  fuUnreliable:'this game’s forced / unforced marking is unreliable (Analysis’s test fails)',
  other:'the event that won the ball is not one of the seven sources',
  disagree:'two candidate events disagree',
  tagMixed:'the possession’s existing source rows disagree',
  labelStart:'the possession’s own source and the event that won the ball disagree'};
const COH_AS_REASONS_SHORT={   // …and each review item's
  noPoss:'not inside a possession of {T}',
  noStart:'nothing won the ball within '+SS_PSRC_LAG+' s of the possession start',
  toUntyped:'turnover not marked forced or unforced',
  fuUnchecked:'forced / unforced cannot be checked in this game',
  fuUnreliable:'forced / unforced marking unreliable in this game',
  other:'the event that won the ball is not one of the seven sources',
  disagree:'two candidate events disagree',
  tagMixed:'the possession’s source rows disagree',
  labelStart:'the possession’s own source and its start event disagree'};
function cohAsDep(name){
  if(typeof globalThis!=='undefined'&&typeof globalThis[name]==='function') return globalThis[name];
  if(typeof require==='function'){ for(const f of ['./cohesion-labels.js','./cohesion-gi.js']){ try{ const m=require(f); if(m&&typeof m[name]==='function') return m[name]; }catch(_){} } }
  return null;
}
function cohAsScoreText(shot){
  const lab=cohAsDep('cohLabelVal'), o=ssUC((lab?lab(shot,'Shot Outcomes'):ssL(shot,'Shot Outcomes'))||shot.outcome);
  return o==='GOAL'?'GOAL':o==='2 POINT'?'2 POINT':(o==='1 POINT'||o==='POINT')?'1 POINT':'';
}
function cohAutoSourcePlan(events, meta, opts){
  opts=opts||{};
  const isShot=cohAsDep('cohIsShotRow'), scored=cohAsDep('cohShotScored'), align=cohAsDep('cohAlign');
  const supFn=cohAsDep('cohGiSupersededFn'), comp=cohAsDep('cohGiIsCompanion'), resolve=cohAsDep('cohGroupResolve'), valOpts=cohAsDep('cohValueOptions');
  const H=ssUC(meta&&meta.homeTeam), A=ssUC(meta&&meta.awayTeam), list=(events||[]).filter(Boolean);
  const sup=supFn?supFn(list):()=>false, skip=e=>sup(e)||(!!comp&&comp(e));
  const out={items:[], add:[], review:[], disagree:[], covered:[], counts:{shots:0, tagged:0, folded:0, labelled:0, possFrom:0, clear:0, review:0, disagree:0, bySource:{}, byReason:{}}, psToOk:1, possFromMode:false};
  if(!H||!A||!isShot) return out;
  const teamOf=e=>ssSideOf(e,H)?H:ssSideOf(e,A)?A:'';
  const T0=e=>ssEvT(e), T1=e=>e.end!=null?Math.max(T0(e),+e.end):T0(e);
  // the rule, on a fresh array (ssPossSources caches per array; Code Room edits its rows in place)
  const PS=ssPossSources(list.slice(), H, A, skip), F=ssPsToOk(PS, H, A); out.psToOk=F.ok; out.fu=F;
  const shots=list.filter(e=>!skip(e)&&isShot(e)&&teamOf(e)), rows=list.filter(e=>!skip(e)&&teamOf(e)&&/(SCORE|SHOT) SOURCE\s*$/.test(ssUC(e.code)));
  // A game Analysis reads its shot sources from the POSSESSIONS' PossFrom labels (a GIU game: no source row and no
  // source label anywhere — ssPossSrc): one added row would switch Analysis to reading rows only, and every shot not
  // tagged would lose the source it has now. Nothing is added there.
  const live=list.filter(e=>!skip(e));
  out.possFromMode=!live.some(e=>/(SCORE|SHOT) SOURCE/.test(ssUC(e.code))||!!ssLblCI(e, COH_AS_SRC_LABELS))
    &&live.some(e=>/\s(POSS|TEAM POSSESSION)$/.test(ssUC(e.code))&&!!ssLblCI(e,['PossFrom']));
  // ── the possession of each shot ──
  const possOf=T=>((PS&&PS[T]&&PS[T].list)||[]);
  const pickPoss=x=>{ const T=teamOf(x), s=T0(x), en=T1(x), L=possOf(T);
    let c=L.filter(q=>q.s-COH_AS_POSS_TOL<=s&&s<=q.en+COH_AS_POSS_TOL);
    if(!c.length) c=L.filter(q=>q.s>=s&&q.s<=en&&en<=q.en+COH_AS_POSS_TOL);
    return c.sort((a,b)=>b.s-a.s)[0]||null; };
  // ── already tagged: rows ↔ shots ──
  const rowOf=new Map(), folded=new Map();
  [H,A].forEach(T=>{
    const sh=shots.filter(e=>teamOf(e)===T).sort((a,b)=>T1(a)-T1(b)||T0(a)-T0(b)), rw=rows.filter(e=>teamOf(e)===T).sort((a,b)=>T1(a)-T1(b)||T0(a)-T0(b));
    const inRow=(r,x)=>T0(x)>=T0(r)-COH_AS_ROW_LEAD&&T0(x)<=T1(r)+COH_AS_ROW_LAG;                       // the shot starts inside the row
    const meets=(r,x)=>inRow(r,x)||(T1(x)>=T0(r)&&T1(x)<=T1(r)+COH_AS_ROW_LAG);                            // …or ends inside it (a shot within seconds of winning the ball: its row starts after the shot row does)
    const cost=(r,x)=>{ if(!meets(r,x)) return null; const kind=/SCORE SOURCE/.test(ssUC(r.code))===(scored(x)===true); return Math.abs(T1(r)-T1(x))+(kind?0:1000); };
    (align?align(rw, sh, cost):[]).forEach(p=>rowOf.set(p[1], p[0]));
    // a run of misses under one row: the row's own shot is a later miss of the SAME possession (or the row has no shot)
    const shotOf=new Map(); rowOf.forEach((r,x)=>shotOf.set(r,x));
    sh.forEach(x=>{ if(rowOf.has(x)||scored(x)===true) return; const q=pickPoss(x);
      const r=rw.find(r=>{ if(!/SHOT SOURCE/.test(ssUC(r.code))||!inRow(r,x)) return false; const y=shotOf.get(r); return !y||(scored(y)!==true&&T1(y)>=T1(x)&&!!q&&pickPoss(y)===q); });
      if(r) folded.set(x, r); });
  });
  const oppPossAt=x=>{ const T=teamOf(x), O=T===H?A:H, s=T0(x); return possOf(O).find(q=>q.s<=s&&s<=q.en)||null; };
  const clearCat=c=>!!COH_SRC_TEXT[c];
  // a possession's source, judged: {cat, how, ok, reason}
  const judge=(q)=>{
    const lab=ssSrcCat(ssLblCI(q.e,['PossFrom']));
    // the events the rule cannot separate: the same distance AND the same kickout priority as the one it took
    const near=(q.near||[]).filter(n=>n.gap===q.gap), topKo=near.reduce((m,n)=>Math.max(m,n.ko),0), cats=[...new Set(near.filter(n=>n.ko===topKo).map(n=>n.cat))];
    if(lab||q.tag){ const cat=lab||q.tag;
      if(!lab&&q.tagMixed) return {cat, how:'tag', ok:false, reason:'tagMixed'};
      if(q.start&&ssPsRowOf(q.start)!==ssPsRowOf(cat)) return {cat, how:lab?'label':'tag', ok:false, reason:'labelStart'};
      if(!clearCat(cat)) return {cat, how:lab?'label':'tag', ok:false, reason:cat==='TO'?'toUntyped':'other'};
      return {cat, how:lab?'label':'tag', ok:true}; }
    if(!q.start) return {cat:null, how:null, ok:false, reason:'noStart'};
    const cat=q.start;
    if(cats.length>1) return {cat, how:'start', ok:false, reason:'disagree', alts:cats};
    if(cat==='TO') return {cat, how:'start', ok:false, reason:'toUntyped'};
    if(!clearCat(cat)) return {cat, how:'start', ok:false, reason:'other'};
    if((cat==='FTO'||cat==='UTO')&&!F.ok) return {cat, how:'start', ok:false, reason:F.fuBoth>=SS_PSTO_MIN_BOTH?'fuUnreliable':'fuUnchecked'};
    return {cat, how:'start', ok:true};
  };
  // the possession's source WITHOUT its own source rows (for a tagged shot: label, else the start event)
  const judgeUntagged=q=>judge(Object.assign({}, q, {tag:null, tagMixed:false}));
  const codeIdx=new Map(); list.forEach(e=>{ const k=ssUC(e.code).replace(/\s+/g,' '); if(k&&!codeIdx.has(k)) codeIdx.set(k, e.code); });
  const codeFor=(x, base)=>{ const c=String(x.code||'').replace(/\s+(SHOT\s+(OPEN|DEAD).*)$/i,'').trim()||String(x.team||''), want=(c+' '+base).toUpperCase().replace(/\s+/g,' ');
    return codeIdx.get(want)||(c+' '+base); };
  const G=n=>resolve?resolve(list, n):n, V=(g,v)=>{ const o=valOpts?valOpts(list, g, [v]):[v]; return o[0]||v; };
  // the row a shot gets for a source category (cat from COH_SRC_TEXT) and a possession (or none: the shot's own span)
  const rowFor=(x, cat, q)=>{
    const sc=scored(x)===true, base=sc?'SCORE SOURCE':'SHOT SOURCE', code=codeFor(x, base), labels={};
    if(sc){ const g=G('Score Source Outcomes'); labels[g]=V(g, COH_SRC_TEXT[cat]); const v=cohAsScoreText(x); if(v){ const g2=G('Score Source Score Outcomes'); labels[g2]=V(g2, v); } }
    else { const g=G('Shot Source Outcomes'); labels[g]=V(g, COH_SRC_TEXT[cat]); }
    const pe=q?q.e:x, st=q?q.s:T0(x);
    const r={code, team:x.team||teamOf(x), start:st, end:T1(x), half:x.half||pe.half||'', driveT:(pe.driveT!=null?pe.driveT:st), labels, player:'', outcome:'', subtype:''};
    if(pe.gameTime) r.gameTime=pe.gameTime;
    return r;
  };
  out.rowFor=rowFor;
  shots.forEach(x=>{
    const T=teamOf(x), q=pickPoss(x), it={shot:x, team:T, scored:scored(x)===true, poss:q};
    out.counts.shots++;
    // a shot that carries its own source label (a converted Gaelic Insights shot): already tagged, Analysis reads it there
    const own=ssLblCI(x, COH_AS_SRC_LABELS);
    if(own){ it.status='tagged'; it.labelled=true; it.existing=ssSrcCat(own); out.counts.tagged++; out.counts.labelled=(out.counts.labelled||0)+1; out.covered.push(it); out.items.push(it); return; }
    if(out.possFromMode){ it.status='possfrom'; out.counts.possFrom=(out.counts.possFrom||0)+1; out.items.push(it); return; }
    const have=rowOf.get(x)||folded.get(x);
    if(have){ it.status='tagged'; it.row=have; it.folded=!rowOf.has(x); out.counts.tagged++; if(it.folded) out.counts.folded++;
      it.existing=ssSrcCat(ssLblCI(have,['Score Source Outcomes','Shot Source Outcomes','Source']));
      if(q){ const j=judgeUntagged(q); it.derived=j;
        if(j.ok&&it.existing&&j.cat!==it.existing){ it.status='disagree'; out.disagree.push(it); out.counts.disagree++; } }
      out.covered.push(it); out.items.push(it); return; }
    if(!q){ const op=oppPossAt(x); it.status='review'; it.reason='noPoss'; it.text=COH_AS_REASONS_SHORT.noPoss.replace('{T}', T)+(op?' (it falls in a '+op.team+' possession)':'');
      out.review.push(it); out.counts.review++; out.counts.byReason.noPoss=(out.counts.byReason.noPoss||0)+1; out.items.push(it); return; }
    const j=judge(q); it.derived=j;
    if(j.ok){ it.status='clear'; it.cat=j.cat; it.add=rowFor(x, j.cat, q); out.add.push(it.add); out.counts.clear++; out.counts.bySource[j.cat]=(out.counts.bySource[j.cat]||0)+1; }
    else { it.status='review'; it.reason=j.reason; it.text=COH_AS_REASONS_SHORT[j.reason]+(j.reason==='disagree'?' ('+j.alts.map(c=>COH_SRC_TEXT[c]||c).join(' / ')+')':'');
      out.review.push(it); out.counts.review++; out.counts.byReason[j.reason]=(out.counts.byReason[j.reason]||0)+1; }
    out.items.push(it);
  });
  return out;
}

if(typeof module!=='undefined'&&module.exports) module.exports={ssUC, ssLbl, ssL, ssLblCI, ssSideOf, ssEvT, ssIsKO, ssIsTO, ssIsPoss, ssKoWon, ssKoKickerWon, ssSrcCat,
  ssToWinnerCoded, ssToKind, ssToType, ssIsFoul, ssIsThrowIn, ssPsRowOf, ssPossSources, ssPsToOk, SS_KO_GROUPS, SS_TO_OUT_GROUPS, SS_FOUL_AREA_GROUPS,
  SS_SRC_TO_KEYS, SS_PSRC_ROWS, SS_PSRC_TOL, SS_PSRC_LAG, SS_PSTO_MIN_BOTH, SS_PSTO_MIN_AGREE,
  COH_SRC_TEXT, COH_SRC_VALUES, COH_AS_POSS_TOL, COH_AS_ROW_LEAD, COH_AS_ROW_LAG, COH_AS_REASONS, COH_AS_REASONS_SHORT, cohAutoSourcePlan};
