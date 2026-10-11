/* COHESION — '45s on the 45 m line: find every saved '45 that is not on the line, plan the move, apply it, log it.
 *
 * Used by shot-45-line-admin.html (admin only). Everything in this file is PURE except the runner at the bottom
 * (cohShot45.runApply), and that only talks to the `io` object it is given — the page passes the existing gateways
 * (cohesionRead gameBundle · cohesionEventBatch), the tests pass an in-memory one. No new write path.
 *
 * THE RULE (Barry): a '45 is ALWAYS taken on the 45 m line and is ALWAYS a 1 Point Attempt. Code Room snaps a newly
 * marked '45 onto the line (code-room.html CR_45_Y = 69.3); this file does the same for the ones saved before that.
 *
 * WHICH ROWS: a dead-ball shot (code "<TEAM> SHOT DEADBALL" / "DEAD BALL") whose 'Deadball Shot Type' is a '45 by
 * cohIs45 (cohesion-labels.js: '45 · 45 · '45 SHOT). An original superseded by a Gaelic Insights conversion
 * (cohGiSupersededFn) is out; a converted / derived shot row is in like any other.
 *
 * WHERE A SHOT'S LOCATION IS STORED (the readers: dashCoordOf in cohesion-graphics.js, ttCoordOf in analysis.html,
 * crCoordOf in code-room.html, carryPos in cohesion-gi.js, xpForShot in cohesion-xp.js):
 *   own fields    e.x / e.y — always goal at the top, X = % across, Y = % down the drawn half. Read FIRST by every
 *                 map. Written by Code Room to one decimal.
 *   label pair    X-<name> / Y-<name> (X-Shot / Y-Shot, X-Shot_away / Y-Shot_away; any case, '-', '_' or ' ').
 *                 · on a row that also has own fields, and whose pair is the own fields rounded to whole numbers,
 *                   it is Code Room's COPY of them (crSyncCoordGroups / crApplyLocToRow write String(Math.round()))
 *                   — the same frame as the own fields, whatever the game's convention;
 *                 · otherwise it is the location itself, in the GAME's convention (cohesionXpDetectConv):
 *                   'tracker' = as above (depth in the Y label), 'sportscode_rot' = X label = 100 - depth,
 *                   Y label = 100 - across (depth in the X label).
 * ONLY THE DEPTH IS CHANGED, in every form the row has: own y -> 69.3; a copy pair's Y label -> "69" (what Code
 * Room itself writes beside y = 69.3); a pair that is the location -> "69.3" (tracker: the Y label) or "30.7"
 * (rotated: the X label, which un-rotates to 69.3). The across-pitch value is never written.
 * A pair that is the location needs the game's convention; when that cannot be told confidently (convOf) the row is
 * listed as "not changed — convention unclear" and nothing of it is written.
 *
 * ZONE: when the move changes the zone Code Room would give the position (zoneOf = code-room.html crZoneOf) and the
 * row HAS a 'Shot Zones' label, the label is set to the new zone (and e.subtype with it, when it was holding the
 * zone — the denormalised field Code Room's save keeps in step). A row with no zone label gets none.
 * ATTEMPT: a qualifying '45 whose 'Shot Attempts' is blank or not '1 Point Attempt' can be set to it (a separate
 * choice per row; also offered for a '45 that has no location).
 */
(function(root){
  'use strict';
  const NODE=typeof module!=='undefined'&&module.exports;
  let L, GI;
  if(NODE){ L=require('./cohesion-labels.js'); GI=require('./cohesion-gi.js'); } else { L=root; GI=root; }
  const clone=o=>o==null?o:JSON.parse(JSON.stringify(o));
  const r1=v=>Math.round(v*10)/10;
  const fin=v=>v!=null&&v!==''&&isFinite(+v);

  // ── shot map geometry: copied VERBATIM from code-room.html / cohesion-graphics.js (the test checks the copies
  //    are identical) — the stored Y that plots on the drawn 45 m line ──
  const SHOT_VB_H=75, SHOT_M_PER_X=0.878, SHOT_ARC_M=40;
  const SHOT_LINES=[[0,1.2],[13,15.5],[20,22.9],[45,52]];   // [metres from the goal line, viewBox y]
  function shotMY(m){ const A=SHOT_LINES; let i=0; while(i<A.length-2&&m>A[i+1][0]) i++;   // metres from the goal line -> viewBox y
    return A[i][1]+(m-A[i][0])*(A[i+1][1]-A[i][1])/(A[i+1][0]-A[i][0]); }
  function shotLabelY(m){ return shotMY(m)*100/SHOT_VB_H; }                   // metres from the goal line -> stored Y (% down the box)
  const CR_45_Y=Math.round(shotLabelY(45)*10)/10;   // 69.3
  // ── Code Room's zone-from-position rule: copied VERBATIM from code-room.html (the test checks it) ──
  function crZoneOf(x,y){
    const col = x<33.34?0 : x<66.67?1 : 2;
    const row = y<31?0 : y<70.2?1 : 2;   // 20m line / 45m line (measured off the chart)
    return 'Zone '+(row*3+col+1);
  }
  const LINE_Y=CR_45_Y, ONE_PT='1 Point Attempt';
  const SHOT_DEAD_RE=/SHOT DEAD ?BALL/i;                 // = cohesion-config.js: the rows 'Deadball Shot Type' applies to
  const SHOT_PAIR_RE=/^[-_ ]shots?([-_ ]away)?$/i;       // the tail of a shot's X-/Y- label pair

  // metres from the goal line of a stored depth, on the xP model's scale (cohesion-xp.js geometry, as Code Room's
  // crShotDistM asks for it); null when the model is not loaded
  function depthM(y){
    const f=root.xpForShot; if(typeof f!=='function'||!fin(y)) return null;
    try{ const r=f({'Shot Attempts':ONE_PT, 'X-Shot':'50', 'Y-Shot':String(y)}, 'home', null, {conv:'tracker'});
      return r&&r.parts&&isFinite(r.parts.dy)?r.parts.dy:null; }catch(_){ return null; }
  }

  // ── the game's coordinate convention, and whether it is SURE ──
  // cohesionXpDetectConv.detail = what every reader uses ({conv, n, agreeTracker, agreeRot}); it falls back to
  // 'tracker' when there are few zone-labelled shots or a tie. That fallback is fine for drawing, not for
  // rewriting a stored value, so here the convention only counts when at least MIN_SHOTS located shots carry a
  // zone label, the winning reading agrees with SURE_AGREE of them and beats the other by SURE_MARGIN.
  const SURE_AGREE=0.6, SURE_MARGIN=0.25;
  function convOf(events){
    const f=root.cohesionXpDetectConv, d=(f&&f.detail)?f.detail(events):null;
    if(!d) return {conv:'tracker', sure:false, n:0, why:'the convention check (cohesion-xp.js) is not loaded'};
    const min=f.MIN_SHOTS||6, a=d.conv==='sportscode_rot'?d.agreeRot:d.agreeTracker, b=d.conv==='sportscode_rot'?d.agreeTracker:d.agreeRot;
    const out={conv:d.conv, n:d.n, agreeTracker:d.agreeTracker, agreeRot:d.agreeRot, sure:false, why:''};
    if(d.n<min) out.why='only '+d.n+' located shot'+(d.n===1?'':'s')+' with a zone label (at least '+min+' needed)';
    else if(!(a>=SURE_AGREE)||!(a-b>=SURE_MARGIN)) out.why='the zone labels fit neither reading clearly (goal at the top '+Math.round(100*d.agreeTracker)+'%, rotated '+Math.round(100*d.agreeRot)+'%)';
    else out.sure=true;
    return out;
  }

  // every X-/Y- label pair of a row, in label order (= crCoordPairs / dashCoordOf / carryPos)
  function pairsOf(e){
    const Lb=(e&&e.labels)||{}, keys=Object.keys(Lb), out=[];
    keys.forEach(k=>{ const m=/^x([-_ ].*)$/i.exec(k); if(!m) return;
      const yk=keys.find(k2=>/^y/i.test(k2)&&k2.slice(1).toLowerCase()===m[1].toLowerCase());
      if(!yk) return;
      const x=parseFloat(Lb[k]), y=parseFloat(Lb[yk]);
      if(isFinite(x)&&isFinite(y)) out.push({xg:k, yg:yk, x, y, tail:m[1]}); });
    return out;
  }
  const isShot45=e=>!!e&&SHOT_DEAD_RE.test(String(e.code||''))&&L.cohIs45(L.cohLabelVal(e, 'Deadball Shot Type'));
  const clamp=v=>Math.max(0, Math.min(100, v));

  // One qualifying row -> what is stored, where it plots, and what would change. cv = convOf(the game's events).
  //   status  'move'     not on the line: `sets` lists every depth value to write
  //           'online'   every stored form is on the line already
  //           'noloc'    no location at all (attempt check only)
  //           'unclear'  a label pair holds the location and the game's convention is not sure — nothing written
  //           'odd'      the location is stored in a way the readers do not agree on — nothing written (`why`)
  function planRow(e, cv){
    const own=(e.x!=null&&e.y!=null)?{x:+e.x, y:+e.y}:null, pairs=pairsOf(e), rot=cv.conv==='sportscode_rot';
    const it={status:'', why:'', own:!!own, across:null, depth:null, newDepth:null, sets:[], zone:null, zoneNote:'', attempt:null};
    // attempt (asked of every qualifying '45, located or not)
    const ak=L.cohLabelKeyEq(e.labels, 'Shot Attempts'), cur=String(L.cohLabelVal(e, 'Shot Attempts')||'').replace(/\s+/g,' ').trim();
    if(cur.toLowerCase()!==ONE_PT.toLowerCase()) it.attempt={key:ak!=null?ak:'Shot Attempts', old:cur, new:ONE_PT};
    if(!own&&!pairs.length){ it.status='noloc'; return it; }
    if(own&&(!isFinite(own.x)||!isFinite(own.y))){ it.status='odd'; it.why='its own x / y fields are not numbers'; return it; }
    if(pairs.length&&!SHOT_PAIR_RE.test(pairs[0].tail)){ it.status='odd'; it.why='its first location labels ('+pairs[0].xg+' / '+pairs[0].yg+') are not a shot’s'; return it; }
    // each form: is it the location in the game's convention, or Code Room's rounded copy of the own fields?
    const forms=pairs.filter(p=>SHOT_PAIR_RE.test(p.tail)).map(p=>Object.assign({copy:!!own&&p.x===Math.round(own.x)&&p.y===Math.round(own.y)}, p));
    const needConv=forms.some(p=>!p.copy);
    // where the row plots now (dashCoordOf: own fields first, else the first pair, un-rotated and clamped)
    const first=pairs[0];
    const at=own?{x:own.x, y:own.y}:(rot?{x:clamp(100-first.y), y:clamp(100-first.x)}:{x:clamp(first.x), y:clamp(first.y)});
    it.across=at.x; it.depth=at.y; it.newDepth=LINE_Y;
    if(needConv&&!cv.sure){ it.status='unclear'; it.why=cv.why; return it; }
    if(own&&r1(own.y)!==LINE_Y) it.sets.push({field:'y', old:e.y, new:LINE_Y});
    forms.forEach(p=>{
      if(p.copy){ const want=Math.round(LINE_Y); if(p.y!==want&&r1(p.y)!==LINE_Y) it.sets.push({field:'labels.'+p.yg, label:p.yg, old:e.labels[p.yg], new:String(want)}); }
      else { const g=rot?p.xg:p.yg, v=rot?p.x:p.y, want=rot?r1(100-LINE_Y):LINE_Y, w=own?Math.round(want):want;   // beside own fields a label is written whole, as Code Room does
        if(r1(v)!==want&&!(own&&v===w)) it.sets.push({field:'labels.'+g, label:g, old:e.labels[g], new:String(w)}); }
    });
    if(!it.sets.length){ it.status='online'; return it; }
    it.status='move';
    // zone: only when the MOVE changes the zone Code Room gives the position, and the row has a zone label
    const zk=L.cohLabelKeyEq(e.labels, 'Shot Zones'), zv=zk!=null?String(L.cohLabelVal(e, zk)||'').trim():'';
    const zOld=crZoneOf(at.x, at.y), zNew=crZoneOf(at.x, LINE_Y);
    if(zv){
      if(zOld!==zNew&&zv.toLowerCase()!==zNew.toLowerCase()) it.zone={key:zk, old:zv, new:zNew, subtype:e.subtype===zv};
      else if(zv.toLowerCase()!==zNew.toLowerCase()) it.zoneNote='tagged '+zv+'; the position is '+zNew+' before and after — left as tagged';
    }
    return it;
  }

  // One game -> {id, title, date, home, away, conv, items:[…]}; rows = [{id, data}] as the read gateway returns them.
  function planGame(meta, rows){
    meta=meta||{}; rows=(rows||[]).filter(r=>r&&r.data&&typeof r.data==='object');
    const events=rows.map(r=>r.data), sup=typeof GI.cohGiSupersededFn==='function'?GI.cohGiSupersededFn(events):()=>false;
    const g={id:meta.id, title:meta.title||((meta.homeTeam||'')+' v '+(meta.awayTeam||'')), date:meta.date||'', home:meta.homeTeam||'', away:meta.awayTeam||'', conv:null, items:[]};
    const hits=rows.filter(r=>isShot45(r.data)&&!sup(r.data));
    if(!hits.length) return g;
    g.conv=convOf(events);
    hits.forEach(r=>{ const e=r.data, it=planRow(e, g.conv);
      g.items.push(Object.assign(it, {id:r.id, eid:e.id, code:e.code||'', team:e.team||'', player:e.player||'', half:e.half||'', start:e.start, type:L.cohLabelVal(e, 'Deadball Shot Type')})); });
    g.items.sort((a,b)=>(+a.start||0)-(+b.start||0));
    return g;
  }
  const wantsMove=it=>it.status==='move';
  const planEmpty=g=>!g.items.some(it=>wantsMove(it)||it.attempt);

  // The row's data with the chosen parts applied. pick = {move, attempt}. Nothing else is touched.
  function rowAfter(data, it, pick){
    const d=clone(data);
    if(pick.move&&wantsMove(it)){
      it.sets.forEach(s=>{ if(s.field==='y') d.y=s.new; else L.cohLabelSetValues(d, s.label, [s.new]); });
      if(it.zone){ L.cohLabelSetValues(d, it.zone.key, [it.zone.new]); if(it.zone.subtype) d.subtype=it.zone.new; }
    }
    if(pick.attempt&&it.attempt) L.cohLabelSetValues(d, it.attempt.key, [it.attempt.new]);
    return d;
  }
  // every value that differs between two versions of a row: [{field, old, new}] (labels and labelsAll one level down)
  function diffData(a, b){
    const out=[], same=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
    new Set(Object.keys(a||{}).concat(Object.keys(b||{}))).forEach(k=>{
      if(k==='labels'||k==='labelsAll'){ const x=a[k]||{}, y=b[k]||{};
        new Set(Object.keys(x).concat(Object.keys(y))).forEach(g=>{ if(!same(x[g], y[g])) out.push({field:k+'.'+g, old:x[g]===undefined?null:x[g], new:y[g]===undefined?null:y[g]}); }); }
      else if(!same(a[k], b[k])) out.push({field:k, old:a[k]===undefined?null:a[k], new:b[k]===undefined?null:b[k]}); });
    return out;
  }

  // ── the log: every value written, old and new — the only record of where each '45 was ──
  function newLog(by){ return {v:1, kind:'shot45-line', id:'s45-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7), at:new Date().toISOString(), by:by||'', lineY:LINE_Y, status:'running', games:[]}; }
  function logTotals(log){ const g=(log&&log.games)||[]; return {games:g.filter(x=>x.rows.length).length, rows:g.reduce((a,x)=>a+x.rows.length,0), values:g.reduce((a,x)=>a+x.rows.reduce((n,r)=>n+r.changes.length,0),0), failed:g.filter(x=>x.error).length}; }
  function logCsv(log){
    const q=v=>{ const s=v==null?'':(typeof v==='object'?JSON.stringify(v):String(v)); return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
    const lines=[['game id','game','date','event row id','event id','team','player','half','video time (s)','field','old value','new value'].join(',')];
    ((log&&log.games)||[]).forEach(g=>g.rows.forEach(r=>r.changes.forEach(c=>lines.push([g.id, g.title, g.date, r.id, r.eid, r.team, r.player, r.half, r.start, c.field, c.old, c.new].map(q).join(',')))));
    return lines.join('\r\n')+'\r\n';
  }

  // ── the runner (the only part that saves — through io) ─────────
  // io = { bundle(id) -> {meta, events:[{id, data}]}        the game, FRESH (cohesionRead gameBundle)
  //        saveEvents(ops) -> {results:[{ref, ok, error}]}  cohesionEventBatch
  //        saveLog(log)                                     keep the log (called after every game) }
  // job = { order:[game ids], picks:{gameId:{rowId:{move, attempt}}}, log }
  // Game by game. Each game is read again and planned afresh, so a row edited meanwhile is planned as it is NOW
  // and a row that is already on the line is never written. A game that fails is reported and the next one is
  // still done. -> {games:[{id, title, date, ok, rows, skipped, error}], ok}
  const CHUNK=100;
  async function applyGame(job, id, io){
    const b=await io.bundle(id), g=planGame(b.meta, b.events), by=new Map((b.events||[]).map(r=>[String(r.id), r]));
    const picks=job.picks[id]||{}, todo=[]; let skipped=0;
    g.items.forEach(it=>{ const p=picks[it.id]; if(!p) return;
      const pick={move:!!p.move&&wantsMove(it), attempt:!!p.attempt&&!!it.attempt};
      if(!pick.move&&!pick.attempt){ skipped++; return; }
      const old=by.get(String(it.id)).data, data=rowAfter(old, it, pick), changes=diffData(old, data);
      if(changes.length) todo.push({it, data, changes}); else skipped++; });
    const lg={id, title:g.title, date:g.date, rows:[], error:''};
    job.log.games.push(lg);
    let bad=0, why='';
    for(let i=0;i<todo.length;i+=CHUNK){
      const part=todo.slice(i, i+CHUNK), res=await io.saveEvents(part.map(c=>({action:'update', id:c.it.id, data:c.data, ref:c.it.id})));
      const rs=(res&&Array.isArray(res.results))?res.results:[];
      part.forEach((c,k)=>{ const r=rs.find(x=>String(x.ref)===String(c.it.id))||rs[k];
        if(r&&r.ok) lg.rows.push({id:c.it.id, eid:c.it.eid, team:c.it.team, player:c.it.player, half:c.it.half, start:c.it.start, changes:c.changes});
        else { bad++; if(!why&&r&&r.error) why=r.error; } });
      io.saveLog(job.log);
    }
    if(bad) throw new Error(bad+' of '+todo.length+' row(s) were not saved'+(why?' ('+why+')':''));
    if(lg.rows.length){                                                 // read back: what was written is there
      const b2=await io.bundle(id), g2=planGame(b2.meta, b2.events), left=g2.items.filter(it=>{ const p=picks[it.id]; return p&&lg.rows.some(r=>String(r.id)===String(it.id))&&((p.move&&wantsMove(it))||(p.attempt&&it.attempt)); });
      if(left.length) throw new Error(left.length+' row(s) read back unchanged after saving');
    }
    return {rows:lg.rows.length, skipped};
  }
  async function runApply(job, io, progress){
    progress=progress||function(){}; const out=[];
    for(let i=0;i<job.order.length;i++){ const id=job.order[i];
      progress({step:'game', id, i, n:job.order.length});
      let res;
      try{ const r=await applyGame(job, id, io); res={id, ok:true, rows:r.rows, skipped:r.skipped, error:''}; }
      catch(e){ const lg=job.log.games.find(x=>x.id===id), msg=(e&&e.message)||String(e); if(lg) lg.error=msg; else job.log.games.push({id, title:String(id), date:'', rows:[], error:msg});
        res={id, ok:false, rows:lg?lg.rows.length:0, skipped:0, error:msg}; }
      out.push(res); io.saveLog(job.log); progress({step:'done', id, i, n:job.order.length, res});
    }
    job.log.status=out.every(r=>r.ok)?'applied':'partial'; io.saveLog(job.log);
    return {ok:out.every(r=>r.ok), games:out};
  }

  const API={LINE_Y, ONE_PT, zoneOf:crZoneOf, shotLabelY, depthM, convOf, pairsOf, isShot45, planRow, planGame, planEmpty, wantsMove, rowAfter, diffData,
    newLog, logTotals, logCsv, applyGame, runApply, CHUNK, SURE_AGREE, SURE_MARGIN};
  if(NODE) module.exports=API; else root.cohShot45=API;
})(typeof window!=='undefined'?window:globalThis);
