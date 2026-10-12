/* COHESION — game periods (shared helper)
 *
 * ONE copy of the rules that Analysis › Momentum, the dashboard and Code Room
 * all use to decide a game's level and to find EXTRA TIME THE FILE DOES NOT
 * MARK. Some Tracker files mark everything after half-time as "2nd Half", even
 * when the game went to extra time.
 *
 *   cohGameLevel(meta)   'club' | 'county'. A game of the club section is a
 *                        club game; otherwise it is a county game when both
 *                        teams are counties, else a club game.
 *   COH_HALF_MIN         the length of a half: club 30, county 35 minutes.
 *   cohTotalMinutes(meta, tag, secs)   minutes of the whole game at a period clock (the scoreboards' small total).
 *   cohPeriodOf(half)    which period an event's half label means:
 *                        'h1' | 'h2' | 'e1' | 'e2'.
 *   cohUnmarkedET(meta, events, h2, e1)
 *                        → {e1, e2} (times on the events' own time line, e2
 *                        may be null) or null.
 *       h2 = the caller's 2nd-half start; e1 = the caller's ET1 start from the
 *       marked events / the saved game setup (null = none).
 *       THE RULE: only when no event is marked as extra time and no ET start
 *       is known (e1 == null), a THROW-IN more than (half length + 5) minutes
 *       after the 2nd-half throw-in starts ET1, and the next THROW-IN at least
 *       5 minutes later starts ET2. A game without such a throw-in → null, so
 *       every caller behaves exactly as it did before for it.
 *
 *   cohEtClock(half, t, ref)   the game clock the upload writes ("ET1 03:12"): admin.html getGameTime, to the digit.
 *   cohEtFixFind(meta, events, opts)
 *                        → null, or what Code Room's "Mark extra time" repair would do to a SAVED game whose extra
 *                        time was stored as 2nd Half (a Tracker game uploaded before 12 Oct 2026). Pure: changes nothing.
 *       A game needs it only when NO event is marked as extra time AND extra time can be located:
 *         'rows'      the stored stray period rows — events whose code is the file's own name for an ET period
 *                     ("Extra Time 1" / "Extra Time 2": anything cohScPeriodName maps to ET 1st / 2nd Half). Their
 *                     start is the exact period start on the file's clock: an event is in the period when its own
 *                     start is at or after it, and its clock is start − period start — exactly what an upload does.
 *                     An event whose start is missing, or not on the file's clock (coded in Code Room: start = video
 *                     time), is placed by its video time (driveT) against the period row's video time instead.
 *         'throwins'  otherwise the late throw-ins (cohUnmarkedET), on the events' driveT ?? start time line.
 *       → { evidence, starts:{e1,e2} (each {half, file, video, row} or null), strays:[index…], periods:[meta.scPeriods
 *           entries of the stray rows], changes:[{i, half, gameTime, from:{half, gameTime}, clock:'file'|'video'}],
 *           counts:{e1,e2} }
 *       Only half and gameTime are ever proposed (gameTime only where the event has one); a stray row is never in
 *       changes. opts.h2 = the caller's 2nd-half start (default: the earliest 2nd-half THROW-IN); opts.periodName =
 *       cohScPeriodName (default: the global / cohesion-labels.js).
 */
(function(root){
  const COH_COUNTIES=new Set(('ANTRIM ARMAGH CARLOW CAVAN CLARE CORK DERRY DONEGAL DOWN DUBLIN FERMANAGH GALWAY KERRY KILDARE KILKENNY LAOIS LEITRIM LIMERICK LONGFORD LOUTH MAYO MEATH MONAGHAN OFFALY ROSCOMMON SLIGO TIPPERARY TYRONE WATERFORD WESTMEATH WEXFORD WICKLOW LONDON').split(' ').concat(['NEW YORK']));
  const COH_HALF_MIN={county:35, club:30};
  const uc=s=>String(s||'').toUpperCase().trim();
  function cohGameLevel(meta){
    if(String((meta&&meta.section)||'').toLowerCase()==='club') return 'club';
    return [meta&&meta.homeTeam, meta&&meta.awayTeam].every(t=>COH_COUNTIES.has(uc(t)))?'county':'club';
  }
  function cohPeriodOf(half){
    const h=String(half||'');
    if(/ET/i.test(h)||/extra/i.test(h)) return /2nd|\b2\b|ET\s*2/i.test(h)?'e2':'e1';
    return /2nd|\b2H\b/i.test(h)?'h2':'h1';
  }
  function cohUnmarkedET(meta, events, h2, e1){
    if(e1!=null||h2==null) return null;
    const L=events||[], tOf=e=>(e.driveT??e.start)??0, isTI=e=>/THROW.?IN$/i.test(String(e.code||''));
    for(let i=0;i<L.length;i++){ const e=L[i]; if(!e) continue; const k=cohPeriodOf(e.half); if(k==='e1'||k==='e2') return null; }   // extra time IS marked
    const lim=h2+(COH_HALF_MIN[cohGameLevel(meta)]+5)*60; let x1=null, x2=null;
    L.forEach(e=>{ if(!e||!isTI(e)) return; const t=tOf(e); if(t>lim&&(x1==null||t<x1)) x1=t; });
    if(x1==null) return null;
    L.forEach(e=>{ if(!e||!isTI(e)) return; const t=tOf(e); if(t>=x1+300&&(x2==null||t<x2)) x2=t; });
    return {e1:x1, e2:x2};
  }
  // Minutes of the whole game at a point of a period's own clock, on the NOMINAL period lengths (added time is not carried
  // forward): 2H 10:00 is 40 for a club game (30-minute halves) and 45 for a county game (35). Extra time: two 10-minute
  // periods after the two halves. tag = '1H' | '2H' | 'ET1' | 'ET2'; secs = seconds into that period.
  const COH_ET_MIN=10;
  function cohTotalMinutes(meta, tag, secs){
    const half=COH_HALF_MIN[cohGameLevel(meta)], base={'1H':0, '2H':half, 'ET1':2*half, 'ET2':2*half+COH_ET_MIN}[String(tag||'').toUpperCase()];
    return base==null?null:base+Math.floor(Math.max(0, +secs||0)/60);
  }
  // The upload's game clock (admin.html getGameTime), to the digit: the same arithmetic on the same numbers.
  const COH_HALF_PFX={'1st Half':'1H','2nd Half':'2H','ET 1st Half':'ET1','ET 2nd Half':'ET2'};
  function cohEtClock(half, t, ref){
    const mins=(t-(ref||0))/60, m=Math.floor(mins), s=Math.round((mins-m)*60);
    return (COH_HALF_PFX[half]||'ET2')+' '+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  }
  const COH_ET_HALVES=['ET 1st Half','ET 2nd Half'];
  function cohEtFixFind(meta, events, opts){
    opts=opts||{}; const L=events||[];
    for(let i=0;i<L.length;i++){ const e=L[i]; if(!e) continue; const k=cohPeriodOf(e.half); if(k==='e1'||k==='e2') return null; }   // extra time IS marked
    let nameOf=opts.periodName||root.cohScPeriodName;
    if(!nameOf&&typeof require==='function'){ try{ nameOf=require('./cohesion-labels.js').cohScPeriodName; }catch(_){} }
    const num=v=>(v!=null&&v!==''&&isFinite(+v))?+v:null, tOf=e=>(e.driveT??e.start)??0, isTI=e=>/THROW.?IN$/i.test(String(e.code||''));
    // (a) the stray period rows
    const strays=[], ref=[null,null];
    if(nameOf) L.forEach((e,i)=>{ if(!e) return; const k=COH_ET_HALVES.indexOf(nameOf(e.code)); if(k<0) return; strays.push(i);
      const f=num(e.start), v=num(e.driveT); if(f==null&&v==null) return;
      if(!ref[k]||(f??Infinity)<(ref[k].file??Infinity)) ref[k]={half:COH_ET_HALVES[k], file:f, video:v, row:i}; });
    let evidence=null, starts={e1:null, e2:null};
    if(ref[0]||ref[1]){ evidence='rows'; starts={e1:ref[0], e2:ref[1]}; }
    else if(!strays.length){
      let h2=num(opts.h2);
      if(h2==null) L.forEach(e=>{ if(e&&isTI(e)&&cohPeriodOf(e.half)==='h2'){ const t=tOf(e); if(h2==null||t<h2) h2=t; } });
      const U=cohUnmarkedET(meta, L, h2, null); if(!U) return null;
      const at=t=>{ if(t==null) return null; const i=L.findIndex(e=>e&&isTI(e)&&tOf(e)===t); return {file:i>=0?num(L[i].start):null, video:t, row:i>=0?i:null}; };
      evidence='throwins'; starts={e1:Object.assign({half:COH_ET_HALVES[0]}, at(U.e1)), e2:U.e2==null?null:Object.assign({half:COH_ET_HALVES[1]}, at(U.e2))};
    } else return null;
    const skip=new Set(strays), changes=[], counts={e1:0, e2:0};
    // where an event stands against a period start: on the file's clock when both have one and the event's two clocks
    // sit together the way the period row's do (an upload's event), else on the video.
    const pos=(e, S)=>{
      if(!S) return null;
      if(evidence==='throwins') return {d:tOf(e)-S.video, clock:'video'};
      const f=num(e.start), v=num(e.driveT);
      if(S.file!=null&&f!=null&&(S.video==null||v==null||Math.abs((v-f)-(S.video-S.file))<=2)) return {d:f-S.file, clock:'file'};
      if(S.video!=null&&v!=null) return {d:v-S.video, clock:'video'};
      return null;
    };
    L.forEach((e,i)=>{ if(!e||skip.has(i)) return;
      const p2=pos(e, starts.e2), p1=pos(e, starts.e1), k=(p2&&p2.d>=0)?1:(p1&&p1.d>=0)?0:-1; if(k<0) return;
      const P=k?p2:p1, S=k?starts.e2:starts.e1, half=COH_ET_HALVES[k], c={i, half, from:{half:e.half, gameTime:e.gameTime}, clock:P.clock};
      if(typeof e.gameTime==='string'&&e.gameTime) c.gameTime=P.clock==='file'?cohEtClock(half, +e.start, S.file):cohEtClock(half, P.d, 0);
      changes.push(c); counts[k?'e2':'e1']++; });
    if(!changes.length) return null;
    const periods=evidence==='rows'?ref.filter(Boolean).map(r=>{ const e=L[r.row], p={code:r.half, start:e.start, end:e.end}; if(e.code!==r.half) p.fileCode=e.code; return p; }).filter(p=>isFinite(+p.start)&&isFinite(+p.end)&&p.start!=null&&p.end!=null):[];
    return {evidence, starts, strays, periods, changes, counts};
  }
  const api={ COH_COUNTIES, COH_HALF_MIN, COH_ET_MIN, cohGameLevel, cohPeriodOf, cohUnmarkedET, cohTotalMinutes, cohEtClock, cohEtFixFind };
  Object.assign(root, api);
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
