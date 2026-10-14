/* COHESION — Code Room "Subs": substitution times from a match report.
 *
 * The analyst types each team's subs as a report gives them — the MINUTE, the player going OFF, the player coming
 * ON — checks each one against the video, and they become ordinary SUB rows ("<TEAM> SUB" + Player Out / Player In,
 * Sub Detail kept in step in a game that records it), queued with the session like any other edit.
 *
 * Everything above the "UI" banner is pure (no DOM, no page globals) and is what the Node tests run.
 *
 *   cohSubsParseMinute(text, level)  level 'county' | 'club' (cohesion-periods.js cohGameLevel)
 *       → {ok:true, period:'1H'|'2H'|'ET1'|'ET2', secs, label}   secs = the period's own clock
 *       → {ok:true, ht:true, label:'HT'}
 *       → {ok:false, error, empty?}
 *     THE RULES (H = the half: county 35, club 30 — COH_HALF_MIN; extra time: two 10-minute periods — COH_ET_MIN):
 *       · a minute covers a whole minute and lands at its START: minute m of a period is that period's clock (m-1):00.
 *       · a plain whole-game minute:  1..H → 1H · H+1..2H → 2H · 2H+1..2H+10 → ET1 · 2H+11..2H+20 → ET2
 *           county 52' → 2H 16:00 · 37' → 2H 01:00 · 75' → ET1 04:00 · 85' → ET2 04:00
 *           club   47' → 2H 16:00 · 65' → ET1 04:00
 *       · added time is written on the END of a period: H+x, 2H+x, (2H+10)+x, (2H+20)+x → that period's (len+x-1):00
 *           county 35+2 → 1H 36:00 · 70+1 → 2H 35:00 · 80+2 → ET1 11:00 · club 30+3 → 1H 32:00 · 60+2 → 2H 31:00
 *       · a period named:  "2H 16" (its 16th minute → 2H 15:00) · "ET1 5" → ET1 04:00 · "ET2 10+1" → ET2 10:00
 *       · an exact clock:  "2H 16:30" · "ET1 03:12"
 *       · "HT" (h/t, half time, half-time): placed 5 s before the 2nd-half start (its throw-in) — see cohSubsToVideo.
 *       Quote marks (' ’ ′) and "min"/"mins" are ignored.
 *   cohSubsStarts({events, setup, halves, et, meta})
 *       the period starts the scoreboard uses (code-room.html sbHalves() / sbET(): halves {h1,h2}, et {e1,e2,inferred})
 *       labelled with where each came from → {h1:{t,src}, h2, e1, e2}; src 'throw-in' | 'setup' (the game's / angle's
 *       start times) | 'events' (the scoreboard fell back to the period's first event — a guess: NOT used here) | ''.
 *   cohSubsToVideo(p, starts)  → {ok, t, period, clock, half} | {ok:false, error}   video (drive) time = start + clock
 *   cohSubsPeriodAt(t, starts) → '1H'|'2H'|'ET1'|'ET2' — the scoreboard's period at a video time (sbTick)
 *   cohSubsClock(period, secs) → "2H 16:00" (the upload's game-clock format)
 *   cohSubsResolve(text, sheet, known) → {name, no, err}   a typed player: a name, "#18" / "18" (named through the
 *       team sheet), "18 Name"; a known spelling is adopted
 *   cohSubsMatch(report, existing) → {pairs:[{rep, row, how, dt}], repOnly:[id], rowOnly:[rowId]}
 *       report [{id, side, t|null, out:{name,no}|null, in}], existing [{rowId, side, t, out, in}] — per side:
 *         1 'players' both players the same (a name, or the number when a side has only numbers) — nearest in time first
 *         2 'one'     one of the two players the same, within 5 minutes
 *         3 'time'    anything left within 90 seconds (an existing row with other / unknown players)
 */
(function(root){
  'use strict';
  const HALF=()=>(root.COH_HALF_MIN||{county:35, club:30});
  const ET_MIN=()=>(root.COH_ET_MIN||10);
  const PERIOD_HALF={'1H':'1st Half','2H':'2nd Half','ET1':'ET 1st Half','ET2':'ET 2nd Half'};
  const PERIOD_KEY={'1H':'h1','2H':'h2','ET1':'e1','ET2':'e2'};
  const PERIOD_NAME={'1H':'1st-half','2H':'2nd-half','ET1':'extra-time 1st-half','ET2':'extra-time 2nd-half'};
  const HT_LEAD=5;   // seconds: a half-time sub sits this long before the 2nd-half start
  const pad=n=>String(n).padStart(2,'0');

  function cohSubsClock(period, secs){ const s=Math.max(0, Math.floor(+secs||0)); return period+' '+pad(Math.floor(s/60))+':'+pad(s%60); }

  function normPeriod(s){ s=String(s||'').toLowerCase().replace(/\s+/g,''); return s==='1h'?'1H':s==='2h'?'2H':s==='et1'?'ET1':s==='et2'?'ET2':''; }
  function cohSubsParseMinute(text, level){
    const H=HALF()[level==='club'?'club':'county'], E=ET_MIN();
    let s=String(text==null?'':text).replace(/[‘’′'`´"″]/g,'').replace(/\bmins?\b\.?/gi,'').replace(/\s+/g,' ').trim().toLowerCase();
    if(!s) return {ok:false, empty:true, error:'Type the minute (52 · 35+2 · HT · ET1 5)'};
    if(/^(ht|h\/t|half ?-?time)$/.test(s)) return {ok:true, ht:true, label:'HT'};
    const len=p=>(p==='1H'||p==='2H')?H:E;
    // an exact clock: "2H 16:30"
    let m=/^(1h|2h|et ?1|et ?2)\s*(\d{1,2}):(\d{2})$/.exec(s);
    if(m){ const p=normPeriod(m[1]), mm=+m[2], ss=+m[3]; if(ss>59) return {ok:false, error:'Seconds must be 00–59'};
      return {ok:true, period:p, secs:mm*60+ss, label:cohSubsClock(p, mm*60+ss)}; }
    // a period named: "2H 16" · "ET1 5" · "ET2 10+1"
    m=/^(1h|2h|et ?1|et ?2)\s*(\d{1,3})(?:\s*\+\s*(\d{1,2}))?$/.exec(s);
    if(m){ const p=normPeriod(m[1]), mi=+m[2], x=m[3]!=null?+m[3]:null, L=len(p);
      if(x!=null&&x>0){ if(mi!==L) return {ok:false, error:'Added time is written on the end of the period: '+p+' '+L+'+'+x};
        return {ok:true, period:p, secs:(L+x-1)*60, label:p+' '+L+'+'+x+"'"}; }
      if(mi<1) return {ok:false, error:'Minute 1 is the first minute of a period'};
      if(mi>L) return {ok:false, error:p+' has '+L+' minutes — write added time as '+L+'+'+(mi-L)};
      return {ok:true, period:p, secs:(mi-1)*60, label:p+' '+mi+"'"}; }
    if(/^et\s*\d/.test(s)) return {ok:false, error:'Say which half of extra time: ET1 5 or ET2 5'};
    // a whole-game minute, with or without added time
    m=/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?$/.exec(s);
    if(!m) return {ok:false, error:'Not a minute: use 52 · 35+2 · HT · ET1 5 · 2H 16:30'};
    const mi=+m[1], x=m[2]!=null?+m[2]:0;
    const ends=[[H,'1H',H],[2*H,'2H',H],[2*H+E,'ET1',E],[2*H+2*E,'ET2',E]];
    if(x>0){ const end=ends.find(r=>r[0]===mi);
      if(!end) return {ok:false, error:'Added time goes on the end of a period: '+ends.map(r=>r[0]+'+'+x).join(' · ')};
      return {ok:true, period:end[1], secs:(end[2]+x-1)*60, label:mi+'+'+x+"'"}; }
    if(mi<1) return {ok:false, error:'Minute 1 is the first minute of the game'};
    if(mi<=H) return {ok:true, period:'1H', secs:(mi-1)*60, label:mi+"'"};
    if(mi<=2*H) return {ok:true, period:'2H', secs:(mi-H-1)*60, label:mi+"'"};
    if(mi<=2*H+E) return {ok:true, period:'ET1', secs:(mi-2*H-1)*60, label:mi+"'"};
    if(mi<=2*H+2*E) return {ok:true, period:'ET2', secs:(mi-2*H-E-1)*60, label:mi+"'"};
    return {ok:false, error:mi+"' is after the end of extra time ("+(2*H+2*E)+"')"};
  }

  const isTI=e=>/THROW.?IN$/i.test(String((e&&e.code)||''));
  const tOf=e=>+((e.driveT!=null?e.driveT:e.start)||0);
  const periodOf=h=>(root.cohPeriodOf?root.cohPeriodOf(h):(/ET|extra/i.test(String(h||''))?(/2nd|\b2\b|ET\s*2/i.test(h)?'e2':'e1'):(/2nd|\b2H\b/i.test(String(h||''))?'h2':'h1')));
  const num=v=>(v!=null&&v!==''&&isFinite(+v))?+v:null;
  function cohSubsStarts(o){
    o=o||{}; const L=o.events||[], A=o.setup||{}, H=o.halves||{}, X=o.et||{}, meta=o.meta||{};
    const ti=k=>L.filter(e=>e&&isTI(e)).filter(e=>{ const p=periodOf(e.half); return k==='h'?(p==='h1'||p==='h2'):(p===k); }).map(tOf);
    const tiH=ti('h'), allTI=L.filter(e=>e&&isTI(e)).map(tOf);
    const setupUsed=num(A.half1Start)!=null&&!!(num(A.half1Start)||num(A.half2Start));
    const src=(t, fromTI, setupVal)=>t==null?'':fromTI.some(x=>x===t)?'throw-in':(setupVal!=null&&t===setupVal)?'setup':'events';
    const h1=num(H.h1), h2=num(H.h2);
    const res={
      h1:{t:h1, src:h1==null?'':tiH.some(x=>x===h1)?'throw-in':setupUsed&&h1===num(A.half1Start)?'setup':'events'},
      h2:{t:h2, src:h2==null?'':tiH.some(x=>x===h2)?'throw-in':setupUsed&&h2===num(A.half2Start)?'setup':'events'} };
    ['e1','e2'].forEach(k=>{ let t=num(X[k]);
      if(t!=null&&(h2==null||t<=h2)) t=null;   // the scoreboard counts extra time only once it starts after the 2nd half
      const sv=num(A[k==='e1'?'et1Start':'et2Start']!=null?A[k==='e1'?'et1Start':'et2Start']:meta[k==='e1'?'et1Start':'et2Start']);
      res[k]={t, src:t==null?'':X.inferred?'throw-in':src(t, allTI, sv)}; });
    return res;
  }
  const usable=s=>!!s&&s.t!=null&&(s.src==='throw-in'||s.src==='setup');
  const SRC_TXT={'throw-in':'throw-in', setup:'game setup', events:'first event only'};
  function cohSubsToVideo(p, starts){
    if(!p||!p.ok) return {ok:false, error:(p&&p.error)||'No minute'};
    const S=starts||{};
    if(p.ht){ if(!usable(S.h2)) return {ok:false, error:'HT: the 2nd-half start is not found ('+(S.h2&&S.h2.src==='events'?'no 2nd-half THROW-IN and no start time in the game setup':'no 2nd-half THROW-IN')+')'};
      return {ok:true, ht:true, t:Math.max(0, S.h2.t-HT_LEAD), period:'2H', clock:'2H 00:00', half:'2nd Half', note:HT_LEAD+' s before the 2nd-half '+(S.h2.src==='throw-in'?'throw-in':'start (game setup)')}; }
    const s=S[PERIOD_KEY[p.period]];
    if(!usable(s)) return {ok:false, error:'The '+PERIOD_NAME[p.period]+' start is not found'+(s&&s.src==='events'?' (no THROW-IN and no start time in the game setup — the scoreboard only guesses it from the first event)':p.period[0]==='E'?' (this game has no extra time marked)':' (no THROW-IN)')};
    return {ok:true, t:s.t+p.secs, period:p.period, clock:cohSubsClock(p.period, p.secs), half:PERIOD_HALF[p.period]};
  }
  function cohSubsPeriodAt(t, starts){
    const S=starts||{}, v=k=>S[k]&&S[k].t!=null?S[k].t:null, h2=v('h2');
    const okE=x=>x!=null&&t>=x&&(h2==null||x>h2);
    return okE(v('e2'))?'ET2':okE(v('e1'))?'ET1':(h2!=null&&t>=h2)?'2H':'1H';
  }
  // the game clock at a video time, or '' when that period's start is not a real one
  function cohSubsClockAt(t, starts){
    const p=cohSubsPeriodAt(t, starts), s=(starts||{})[PERIOD_KEY[p]];
    if(p==='1H'&&(!s||s.t==null)) return '';
    return usable(s)?cohSubsClock(p, Math.max(0, t-s.t)):'';
  }

  // ── players ─────────────────────────────────────────────────
  const key=s=>String(s==null?'':s).replace(/[‘’‛ʼ`´]/g,"'").toLowerCase().replace(/\s+/g,'');
  const tidy=s=>String(s==null?'':s).replace(/[‘’‛ʼ`´]/g,"'").replace(/\s+/g,' ').trim();
  // sheet: [{no, name}] (cohSubSheet); known: names to adopt the spelling of
  function cohSubsResolve(text, sheet, known){
    const s=tidy(text); if(!s) return {name:'', no:'', err:''};
    const rows=sheet||[], noOf=n=>{ const k=key(n), u=[...new Set(rows.filter(r=>r.no!==''&&r.no!=null&&key(r.name)===k).map(r=>String(r.no)))]; return u.length===1?u[0]:''; };
    let m=/^#?\s*(\d{1,3})$/.exec(s);
    if(m){ const no=String(+m[1]), u=[...new Set(rows.filter(r=>String(r.no)===no).map(r=>r.name))];
      return u.length===1?{name:u[0], no, err:''}:{name:'', no, err:u.length?'#'+no+' is two players on the team sheet':'#'+no+' is not on the team sheet'}; }
    let name=s, no='';
    m=/^#?\s*(\d{1,3})\s*(?:[.\-–—:)]+\s*|\s+)(\S.*)$/.exec(s); if(m){ name=m[2].trim(); no=String(+m[1]); }
    const k=key(name), hit=rows.find(r=>key(r.name)===k)||null;
    if(hit) name=hit.name; else { const kn=(known||[]).find(n=>key(n)===k); if(kn) name=tidy(kn); }
    return {name, no:noOf(name)||(hit?'':no), err:''};
  }
  const same=(a,b)=>!!a&&!!b&&((a.name&&b.name)?key(a.name)===key(b.name):(!!a.no&&!!b.no&&String(a.no)===String(b.no)));
  function cohSubsMatch(report, existing){
    const R=(report||[]).slice(), X=(existing||[]).slice(), usedR=new Set(), usedX=new Set(), pairs=[];
    const dtOf=(r,x)=>(r.t==null||x.t==null)?null:Math.abs(r.t-x.t);
    const pass=(how, ok, lim)=>{
      const c=[]; R.forEach(r=>{ if(usedR.has(r.id)) return; X.forEach(x=>{ if(usedX.has(x.rowId)||x.side!==r.side) return;
        if(!ok(r,x)) return; const dt=dtOf(r,x); if(lim!=null&&(dt==null||dt>lim)) return; c.push({r,x,dt}); }); });
      c.sort((a,b)=>(a.dt==null?1e9:a.dt)-(b.dt==null?1e9:b.dt));
      c.forEach(({r,x,dt})=>{ if(usedR.has(r.id)||usedX.has(x.rowId)) return; usedR.add(r.id); usedX.add(x.rowId); pairs.push({rep:r.id, row:x.rowId, how, dt}); });
    };
    pass('players', (r,x)=>same(r.out,x.out)&&same(r.in,x.in), null);
    pass('one', (r,x)=>same(r.out,x.out)||same(r.in,x.in), 300);
    pass('time', ()=>true, 90);
    return {pairs, repOnly:R.filter(r=>!usedR.has(r.id)).map(r=>r.id), rowOnly:X.filter(x=>!usedX.has(x.rowId)).map(x=>x.rowId)};
  }
  const cohSubsSamePlayer=same;

  const api={cohSubsParseMinute, cohSubsStarts, cohSubsToVideo, cohSubsPeriodAt, cohSubsClock, cohSubsClockAt, cohSubsResolve, cohSubsMatch, cohSubsSamePlayer, COH_SUBS_HT_LEAD:HT_LEAD, COH_SUBS_PERIOD_HALF:PERIOD_HALF};
  Object.assign(root, api);
  if(typeof module!=='undefined'&&module.exports) module.exports=api;

  /* ═══════════════════════════════ UI (Code Room) ═══════════════════════════════
   * Uses Code Room's own globals at call time (GAME, EVENTS, undoStack, crBackup, crUpdatePending, acShow, vNow,
   * vSeekDrive, sbHalves, sbET, crAngles, crSubG, crKprSubCheck …). The typed list is kept in this browser per game
   * (localStorage 'coh_cr_subs_<game id>') until "Clear list" — so it survives a reload, also in a local session.
   * Nothing is written to the game until a sub is confirmed (Check) or the list applied; those changes are then queued
   * like any other edit (pending until "Close session & save all"; one Undo each).
   */
  if(typeof document==='undefined') return;
  const g=n=>root[n]!==undefined?root[n]:(function(){ try{ return (0,eval)(n); }catch(_){ return undefined; } })();   // a page `let` (EVENTS …) is not on window
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const S={open:false, gid:null, list:{home:[], away:[]}, check:null, status:'', seq:0, timer:null, focus:null};
  root.crSubsState=S;
  const GAMEv=()=>g('GAME'), EV=()=>g('EVENTS')||[];
  const fmtT=t=>(typeof root.fmt==='function'?root.fmt(t):String(Math.round(t)));
  function storeKey(){ const G=GAMEv(); return 'coh_cr_subs_'+((G&&G.id)||''); }
  function load(){
    const G=GAMEv(); if(!G) return; if(S.gid===G.id) return;
    S.gid=G.id; S.list={home:[], away:[]}; S.check=null; S.status=''; S.seq=0;
    try{ const raw=localStorage.getItem(storeKey()); if(raw){ const o=JSON.parse(raw); ['home','away'].forEach(sd=>{ if(Array.isArray(o[sd])) S.list[sd]=o[sd].filter(x=>x&&typeof x==='object').map(x=>({id:String(x.id||''), min:String(x.min||''), out:String(x.out||''), in:String(x.in||''), t:num(x.t), useTime:!!x.useTime, fixPlayers:!!x.fixPlayers})); }); } }catch(_){}
    ['home','away'].forEach(sd=>S.list[sd].forEach(x=>{ x.id='s'+(++S.seq); }));
  }
  function persist(){
    try{ const n=S.list.home.length+S.list.away.length, any=S.list.home.concat(S.list.away).some(x=>x.min||x.out||x.in);
      if(n&&any) localStorage.setItem(storeKey(), JSON.stringify(S.list)); else localStorage.removeItem(storeKey()); }catch(_){}
  }
  function level(){ const G=GAMEv(); return typeof root.cohGameLevel==='function'?root.cohGameLevel(G):'county'; }
  function starts(){
    const G=GAMEv(); let H={}, X={}, A={};
    try{ H=g('sbHalves')(); }catch(_){} try{ X=g('sbET')(); }catch(_){} try{ A=(g('crAngles')()[0])||{}; }catch(_){}
    return cohSubsStarts({events:EV(), setup:A, halves:H, et:X, meta:G||{}});
  }
  function sheetOf(side){ const G=GAMEv(); return (typeof root.cohSubSheet==='function'&&G)?root.cohSubSheet(G, side):[]; }
  function knownOf(side){ try{ return g('crAssistSuggest')([side], '', false).items; }catch(_){ return []; } }
  function teamOf(side){ const G=GAMEv(); return String((G&&(side==='home'?G.homeTeam:G.awayTeam))||'').toUpperCase(); }
  // every typed sub, worked out: minute → time, players, its match among the stored SUB rows
  function evaluate(){
    const st=starts(), lv=level(), rep=[], info=new Map();
    ['home','away'].forEach(side=>{ const sh=sheetOf(side), kn=knownOf(side);
      S.list[side].forEach(x=>{ const p=cohSubsParseMinute(x.min, lv), v=p.ok?cohSubsToVideo(p, st):{ok:false, error:p.error};
        const o=cohSubsResolve(x.out, sh, kn), i=cohSubsResolve(x.in, sh, kn), t=x.t!=null?x.t:(v.ok?v.t:null);
        const it={x, side, p, v, out:o, in:i, t, blank:!x.min&&!x.out&&!x.in};
        info.set(x.id, it); if(!it.blank) rep.push({id:x.id, side, t, out:(o.name||o.no)?o:null, in:(i.name||i.no)?i:null}); }); });
    const rows=EV().filter(e=>e&&typeof root.cohIsSubRow==='function'&&root.cohIsSubRow(e)).map(e=>{ const io=g('crSubIO')(e), side=g('crSideOf')(e.team);
      return {rowId:e._rowId, side, t:+((e.driveT!=null?e.driveT:e.start)||0), out:io.out, in:io.in, e}; })
      .filter(r=>teamOf(r.side)===String(r.e.team||'').toUpperCase());
    const M=cohSubsMatch(rep, rows), byRow=new Map(rows.map(r=>[String(r.rowId), r]));
    M.pairs.forEach(p=>{ const it=info.get(p.rep); it.row=byRow.get(String(p.row)); it.how=p.how; });
    info.forEach(it=>{
      it.complete=!!(it.out.name&&it.in.name);
      if(it.row){ it.sameT=it.t!=null&&Math.abs(it.row.t-it.t)<0.5; it.sameP=cohSubsSamePlayer(it.out, it.row.out)&&cohSubsSamePlayer(it.in, it.row.in);
        it.done=it.sameT&&it.sameP; }
      else it.done=false;
    });
    return {st, info, rowOnly:M.rowOnly.map(id=>byRow.get(String(id))), rows};
  }
  function findSub(id){ for(const sd of ['home','away']){ const x=S.list[sd].find(y=>y.id===id); if(x) return {x, side:sd}; } return null; }

  // ── writing the SUB rows ──
  function labelKey(e, canon){ const L=e.labels||{}; return Object.keys(L).find(k=>k.toLowerCase()===canon.toLowerCase())||g('crSubG')(canon==='Player Out'?'out':'in'); }
  function newRow(it, t, st){
    const G=GAMEv(), side=it.side, TEAM=g('codeTeamName')(side), code=TEAM+' '+g('crCodeAlias')('SUB');
    const ht=!!(it.v&&it.v.ht), half=ht?'2nd Half':PERIOD_HALF[cohSubsPeriodAt(t, st)];   // a half-time sub belongs to the 2nd half
    const tmp='tmp-'+((0,eval)('++crTmpCounter'));
    const row={id:'manual-'+Date.now()+'-'+tmp, start:t, end:t+5, half, code, team:TEAM, player:'', outcome:'', subtype:'', category:(g('catOf')(code)||'Other'),
      driveT:t, labels:{}, _manual:true, _rowId:tmp, _new:true};
    const clock=ht?'2H 00:00':cohSubsClockAt(t, st); if(clock) row.gameTime=clock;
    row.labels[g('crSubG')('out')]=it.out.name; row.labels[g('crSubG')('in')]=it.in.name;
    const sd=typeof root.cohSubDetailText==='function'?root.cohSubDetailText(row, G, EV(), it.out.name, it.in.name):''; if(sd) row.labels['Sub Detail']=sd;
    const cp=g('codeColorPref'); if(cp&&cp['SUB']) row.color=cp['SUB'];
    EV().push(row); return row;
  }
  function fixRow(e, it, t, useTime, fixPlayers){
    if(useTime&&t!=null) e.driveT=t;
    if(fixPlayers&&it.complete){
      const before={o:root.cohLabelVal(e,'Player Out'), i:root.cohLabelVal(e,'Player In')};
      e.labels=Object.assign({}, e.labels||{});
      e.labels[labelKey(e,'Player Out')]=it.out.name; e.labels[labelKey(e,'Player In')]=it.in.name;
      if(e.labelsAll){ ['Player Out','Player In'].forEach(c=>{ const k=Object.keys(e.labelsAll).find(x=>x.toLowerCase()===c.toLowerCase()); if(k) delete e.labelsAll[k]; }); }
      if(before.o!==it.out.name||before.i!==it.in.name){ const sd=root.cohSubDetailText(e, GAMEv(), EV(), it.out.name, it.in.name);
        if(sd){ const k=Object.keys(e.labels).find(x=>x.toLowerCase()==='sub detail')||'Sub Detail'; e.labels[k]=sd; } }
    }
    if(!e._new) e._dirty=true;
  }
  // apply: [{id, t, useTime, fixPlayers}] → one Undo for all of them
  async function apply(items, why){
    const E=evaluate(), st=E.st, added=[], snaps=[], touched=[], skipped=[];
    items.forEach(a=>{ const it=E.info.get(a.id); if(!it||it.blank) return;
      const t=a.t!=null?a.t:it.t;
      if(it.row){ const useT=!!a.useTime&&t!=null&&!it.sameT, fixP=!!a.fixPlayers&&it.complete&&!it.sameP;
        if(!useT&&!fixP) return;
        snaps.push({id:it.row.e._rowId, data:g('crClone')(it.row.e)}); fixRow(it.row.e, it, t, useT, fixP); touched.push(it.row.e); return; }   // (asked once per row, as on an Edit-panel save)
      if(!it.complete){ skipped.push((it.x.min||'?')+': '+(it.out.err||it.in.err||'both players are needed')); return; }
      if(t==null){ skipped.push((it.x.min||'?')+': '+(it.v.error||'no time')); return; }
      const r=newRow(it, Math.round(t), st); added.push(r._rowId); touched.push(r); });
    if(!added.length&&!snaps.length) return {n:0, skipped};
    const us=g('undoStack'); us.push({type:'merge', rowIds:added, snaps, dels:[], subs:why||'subs'});
    EV().sort((a,b)=>(a.driveT??0)-(b.driveT??0)||(a.start??0)-(b.start??0));
    ['refreshDatalists','crBackup','crUpdatePending','renderList'].forEach(f=>{ try{ g(f)(); }catch(_){} });
    render();
    for(const e of touched){ try{ await g('crKprSubCheck')(e); }catch(_){} }   // a keeper going off asks about the new keeper
    render();
    return {n:added.length+snaps.length, added:added.length, changed:snaps.length, skipped};
  }

  // ── the panel ──
  const CSS=`
.crsb{width:780px;max-height:calc(100vh - 90px);overflow:auto;z-index:9991;}
.crsb.chk{width:400px;}
.crsb-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.crsb-team{border-top:3px solid var(--tc,var(--border));padding-top:6px;min-width:0;}
.crsb-th{display:flex;align-items:baseline;gap:8px;margin-bottom:4px;}
.crsb-th b{font:800 13px 'Barlow Condensed',sans-serif;letter-spacing:.6px;text-transform:uppercase;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.crsb-th span{font-size:11px;color:var(--t3);white-space:nowrap;}
.crsb-hd{display:grid;grid-template-columns:62px 1fr 14px 1fr 18px;gap:4px;font:700 9.5px 'Barlow Condensed',sans-serif;letter-spacing:.8px;color:var(--t3);text-transform:uppercase;margin:2px 0 3px;}
.crsb-sub{border:1px solid var(--border);border-radius:8px;padding:5px 6px 4px;margin-bottom:6px;background:var(--card);}
.crsb-sub.done{border-color:var(--green);}
.crsb-sub.cur{box-shadow:0 0 0 2px var(--accent);}
.crsb-r{display:grid;grid-template-columns:62px 1fr 14px 1fr 18px;gap:4px;align-items:center;}
.crsb-r input{min-width:0;width:100%;box-sizing:border-box;background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:6px 7px;color:var(--t1);font:13px 'Barlow',sans-serif;outline:none;}
.crsb-r input:focus{border-color:var(--accent);}
.crsb-r input.min{font-family:'DM Mono',monospace;font-size:12px;text-align:center;padding:6px 3px;}
.crsb-r input.bad{border-color:var(--red);}
.crsb-ar{color:var(--t3);text-align:center;font-size:12px;}
.crsb-x{cursor:pointer;color:var(--t3);font-weight:700;text-align:center;user-select:none;}
.crsb-x:hover{color:var(--red);}
.crsb-i{font-size:11px;color:var(--t2);margin-top:4px;line-height:1.45;}
.crsb-i .mono{font-family:'DM Mono',monospace;font-size:10.5px;color:var(--t1);}
.crsb-i .go{cursor:pointer;color:var(--accent);font-weight:700;}
.crsb-i .go:hover{text-decoration:underline;}
.crsb-tag{display:inline-block;font:700 9.5px 'Barlow Condensed',sans-serif;letter-spacing:.7px;text-transform:uppercase;border-radius:4px;padding:1px 5px;margin-right:4px;border:1px solid var(--border);color:var(--t2);}
.crsb-tag.new{border-color:var(--accent);color:var(--accent);}
.crsb-tag.ok{border-color:var(--green);color:var(--green);}
.crsb-tag.warn{border-color:var(--orange);color:var(--orange);}
.crsb-tag.err{border-color:var(--red);color:var(--red);}
.crsb-err{color:var(--red);}
.crsb-ex{margin-top:3px;padding:4px 6px;border-left:3px solid var(--orange);background:var(--panel);border-radius:0 6px 6px 0;}
.crsb-ex.same{border-left-color:var(--green);}
.crsb-ck{display:inline-flex;align-items:center;gap:3px;margin-right:10px;cursor:pointer;user-select:none;color:var(--t1);}
.crsb-ck input{accent-color:var(--accent);margin:0;}
.crsb-add{width:100%;margin-top:2px;}
.crsb-orph{margin-top:6px;padding:5px 7px;border:1px dashed var(--orange);border-radius:8px;font-size:11px;color:var(--t2);}
.crsb-starts{font-size:11px;color:var(--t2);margin-bottom:8px;display:flex;flex-wrap:wrap;gap:4px 12px;}
.crsb-starts b{color:var(--t1);font-weight:700;}
.crsb-starts .miss{color:var(--red);}
.crsb-card{border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:var(--card);margin-bottom:8px;}
.crsb-card .who{font:800 15px 'Barlow Condensed',sans-serif;letter-spacing:.3px;margin:4px 0;}
.crsb-card .who .o{color:var(--red);} .crsb-card .who .n{color:var(--green);}
.crsb-big{font:700 13px 'DM Mono',monospace;}
.crsb-now{font:700 13px 'DM Mono',monospace;color:var(--accent);margin:6px 0;}
.crsb-nudge{display:flex;gap:4px;margin:4px 0 8px;}
.crsb-nudge .cbtn{flex:1;padding:6px 0;}
.crsb-go{display:flex;flex-wrap:wrap;gap:6px;}
.crsb-go .cbtn{padding:7px 10px;}
.crsb-go .pri{background:var(--green);border-color:var(--green);color:#fff;}
.crsb-go .pri:hover{filter:brightness(1.08);color:#fff;}
`;
  function ensureCss(){ if(document.getElementById('crsbCss')) return; const s=document.createElement('style'); s.id='crsbCss'; s.textContent=CSS; document.head.appendChild(s); }
  function build(){
    let p=document.getElementById('crSubs'); if(p) return p;
    ensureCss();
    p=document.createElement('div'); p.id='crSubs'; p.className='crfr crsb'; p.setAttribute('role','dialog'); p.setAttribute('aria-label','Subs');
    p.addEventListener('mousedown', onClick);
    p.addEventListener('focusin', ev=>{ const t=ev.target; if(!S.restoring&&t&&t.dataset&&t.dataset.f&&t.dataset.f!=='min') openList(t, true); });
    p.addEventListener('input', ev=>{ const t=ev.target; if(t&&t.dataset&&t.dataset.f&&t.dataset.f!=='min') openList(t, false); });
    p.addEventListener('focusout', ev=>{ const t=ev.target; if(!(t&&t.dataset&&t.dataset.f)) return;
      setTimeout(()=>{ if(g('acInput')===t) g('acHide')(); commit(t); }, 150); });
    p.addEventListener('change', ev=>{ const t=ev.target; if(t&&t.dataset&&t.dataset.ck){ const f=findSub(t.dataset.id); if(f){ f.x[t.dataset.ck]=!!t.checked; persist(); render(); } } });
    document.body.appendChild(p); return p;
  }
  function openList(inp, all){
    const side=inp.dataset.side; try{ g('crAssistLoadOther')(teamOf(side)); }catch(_){}
    const s=g('crAssistSuggest')([side], '', false);
    g('acShow')(inp, s.items, v=>{ inp.value=v; commit(inp); }, {tag:n=>s.tags.get(n), label:n=>g('crTSLabel')(n, side), sides:[side], tagBlock:true, all:!!all, max:200});
  }
  function commit(inp){
    if(!S.open||!inp||inp.isConnected===false) return;
    const f=findSub(inp.dataset.id); if(!f) return;
    const k=inp.dataset.f; let v=String(inp.value||'').replace(/\s+/g,' ').trim();
    if(k!=='min'&&v){ const r=cohSubsResolve(v, sheetOf(f.side), knownOf(f.side)); if(r.name&&!r.err) v=r.name; }   // "13" → the sheet's name; a known spelling
    if(inp.value!==v) inp.value=v;   // the box shows what was taken (a redraw keeps a focused box's text)
    if(f.x[k]===v) return;
    f.x[k]=v; if(k==='min') f.x.t=null;   // a new minute: the time is worked out again (a confirmed time is dropped)
    persist(); render();
  }
  function addSub(side){ const x={id:'s'+(++S.seq), min:'', out:'', in:'', t:null, useTime:false, fixPlayers:false}; S.list[side].push(x); S.focus={id:x.id, f:'min'}; persist(); render(); }
  function rmSub(id){ ['home','away'].forEach(sd=>{ S.list[sd]=S.list[sd].filter(x=>x.id!==id); }); persist(); render(); }
  function seek(t){ if(t==null) return; try{ g('vSeekDrive')(t); }catch(_){} live(); }
  // the subs to step through: every non-blank one, both teams, in time order (no time: at the end, in list order)
  function order(E){ const L=[]; ['home','away'].forEach(sd=>S.list[sd].forEach((x,i)=>{ const it=E.info.get(x.id); if(it&&!it.blank) L.push({id:x.id, t:it.t, k:L.length}); }));
    return L.sort((a,b)=>(a.t==null?1e12:a.t)-(b.t==null?1e12:b.t)||a.k-b.k).map(a=>a.id); }
  // the Check order is fixed when Check starts (a confirmed time never reshuffles the cards); removed subs drop out
  function ids(E){ if(!S.check) return order(E); S.check.ids=S.check.ids.filter(id=>{ const it=E.info.get(id); return it&&!it.blank; }); return S.check.ids; }
  function checkGo(i, fresh){ const E=evaluate(); if(fresh||!S.check) S.check={ids:order(E), i:0}; const L=ids(E); if(!L.length){ S.check=null; S.status='Nothing to check — type the subs first.'; render(); return; }
    i=Math.max(0, Math.min(L.length-1, i)); S.check.i=i; const it=E.info.get(L[i]); try{ const Y=g('YTP'); if(Y&&Y.pauseVideo) Y.pauseVideo(); }catch(_){}
    if(it&&it.t!=null) seek(it.t); S.status=''; render(); }
  async function confirmNow(keep){
    if(!S.check) return; const E=evaluate(), L=ids(E), id=L[S.check.i], it=E.info.get(id); if(!it) return;
    let t; if(keep&&it.row) t=it.row.t; else { t=Math.round(g('vNow')()); }
    it.x.t=t; persist();
    const r=await apply([{id, t, useTime:!keep, fixPlayers:it.x.fixPlayers}], 'check');
    S.status=(r.skipped&&r.skipped.length)?r.skipped.join(' · '):(keep?'Kept the existing time':'Set to '+fmtT(t))+(r.n?' — queued (Undo undoes it)':'');
    if(!S.check) return; const L2=ids(evaluate()), at=L2.indexOf(id);
    if(at>=0&&at<L2.length-1) checkGo(at+1); else { if(at>=0) S.check.i=at; S.status+=' · that was the last one'; render(); }
  }
  async function applyAll(){
    const E=evaluate(); const items=[]; E.info.forEach(it=>{ if(!it.blank&&!it.done) items.push({id:it.x.id, t:it.t, useTime:it.x.useTime, fixPlayers:it.x.fixPlayers}); });
    const r=await apply(items, 'apply');
    S.status=r.n?('Queued: '+(r.added?r.added+' new SUB row'+(r.added===1?'':'s'):'')+(r.added&&r.changed?', ':'')+(r.changed?r.changed+' changed':'')+' — one Undo undoes them all.'):'Nothing to apply.';
    if(r.skipped&&r.skipped.length) S.status+=' Not applied: '+r.skipped.join(' · ');
    render();
  }
  function onClick(ev){
    const t=ev.target&&ev.target.closest?ev.target.closest('[data-act]'):null; if(!t) return;
    if(t.tagName==='INPUT') return;
    if(ev.preventDefault) ev.preventDefault();
    const ae=document.activeElement, p=document.getElementById('crSubs');
    if(ae&&ae.dataset&&ae.dataset.f&&p&&p.contains(ae)){ try{ g('acHide')(); }catch(_){} commit(ae); }
    const act=t.dataset.act, id=t.dataset.id, side=t.dataset.side;
    if(t.disabled) return;
    if(act==='close') crSubsClose();
    else if(act==='add') addSub(side);
    else if(act==='rm') rmSub(id);
    else if(act==='seek') seek(+t.dataset.t);
    else if(act==='check'){ const E=evaluate(), L=order(E); const first=L.findIndex(x=>!E.info.get(x).done); checkGo(first<0?0:first, true); }
    else if(act==='apply') applyAll();
    else if(act==='clear'){ S.list={home:[], away:[]}; S.check=null; S.status='List cleared (rows already queued stay — Undo removes them).'; persist(); render(); }
    else if(act==='list'){ S.check=null; render(); }
    else if(act==='prev') checkGo(S.check?S.check.i-1:0);
    else if(act==='next') checkGo(S.check?S.check.i+1:0);
    else if(act==='set') confirmNow(false);
    else if(act==='keep') confirmNow(true);
    else if(act==='fixck'){ const f=findSub(id); if(f){ f.x.fixPlayers=!f.x.fixPlayers; persist(); render(); } }
    else if(act==='vs') { try{ g('vseek')(+t.dataset.d); }catch(_){} live(); }
    else if(act==='vf') { try{ g('vframe')(+t.dataset.d); }catch(_){} live(); }
    else if(act==='vp') { try{ g('vtoggle')(); }catch(_){} }
  }
  function pl(p){ return p&&(p.name||p.no)?((p.no?'#'+p.no+' ':'')+(p.name||'')).trim():'?'; }
  function clockOf(t, st){ const c=cohSubsClockAt(t, st); return c?' ('+c+')':''; }
  function infoHtml(it, st){
    const x=it.x, bits=[];
    if(it.blank) return '';
    const err=[]; if(!it.p.ok&&!it.p.empty) err.push(it.p.error); else if(it.p.ok&&!it.v.ok) err.push(it.v.error);
    if(it.out.err) err.push('OFF: '+it.out.err); if(it.in.err) err.push('ON: '+it.in.err);
    if(it.p.empty) err.push('Type the minute');
    let when='';
    if(x.t!=null) when='<span class="crsb-tag ok">checked</span><span class="go" data-act="seek" data-t="'+x.t+'">▶ '+fmtT(x.t)+'</span>'+esc(clockOf(x.t, st));
    else if(it.v.ok) when=esc(it.p.label)+' → <span class="mono">'+esc(it.v.clock)+'</span> · <span class="go" data-act="seek" data-t="'+it.v.t+'" title="Go to this moment in the video">▶ '+fmtT(it.v.t)+'</span>'+(it.v.note?' · '+esc(it.v.note):'');
    if(when) bits.push(when);
    if(it.row){ const r=it.row, rt='<span class="go" data-act="seek" data-t="'+r.t+'">▶ '+fmtT(r.t)+'</span>'+esc(clockOf(r.t, st));
      if(it.done) bits.push('<span class="crsb-tag ok">✓ in the game</span>SUB row at '+rt);
      else { const how={players:'same players', one:'one player the same', time:'near in time'}[it.how]||'';
        bits.push('<div class="crsb-ex'+(it.sameP?' same':'')+'"><span class="crsb-tag warn">existing</span>'+esc(how)+' · '+rt+'<br>'+esc(g('cohSubText')(r)||'no players on the row')
          +'<br>'+(it.sameT?'<span class="crsb-ck">✓ same time</span>':'<label class="crsb-ck"><input type="checkbox" data-ck="useTime" data-id="'+x.id+'"'+(x.useTime?' checked':'')+'>use the new time</label>')
          +(it.sameP?'<span class="crsb-ck">✓ same players</span>':it.complete?'<label class="crsb-ck"><input type="checkbox" data-ck="fixPlayers" data-id="'+x.id+'"'+(x.fixPlayers?' checked':'')+'>fix the players</label>':'')
          +(!x.useTime&&!(x.fixPlayers&&!it.sameP)?'<span style="color:var(--t3)">keeping the row as it is</span>':'')+'</div>'); } }
    else if(!err.length&&it.complete) bits.push('<span class="crsb-tag new" title="Not in the game yet — a SUB row is added when you set its time (Check) or Apply all">new row</span>'+esc('OUT '+pl(it.out)+' → IN '+pl(it.in)));
    else if(!err.length&&!it.complete) bits.push('<span class="crsb-tag">players</span>type both players');
    if(err.length) bits.push('<span class="crsb-err">⚠ '+err.map(esc).join(' · ')+'</span>');
    return '<div class="crsb-i">'+bits.join('<br>')+'</div>';
  }
  function teamHtml(side, E){
    const G=GAMEv(), T=teamOf(side)||side, col0=(side==='home'?G.homeColor:G.awayColor), col=col0?(typeof cohTeamInk==='function'?cohTeamInk(col0):col0):'var(--border)';   // readable on the theme (cohesion-ink.js)
    const L=S.list[side], done=L.filter(x=>{ const it=E.info.get(x.id); return it&&it.done; }).length;
    const curId=S.check?ids(E)[S.check.i]:null;
    const box=(x,f,ph)=>'<input data-f="'+f+'" data-id="'+x.id+'" data-side="'+side+'" class="'+(f==='min'?'min':'nm')+(f==='min'&&x.min&&!(E.info.get(x.id)||{}).p.ok?' bad':'')+'" value="'+esc(x[f])+'" placeholder="'+ph+'" autocomplete="off" spellcheck="false">';
    const orph=E.rowOnly.filter(r=>r.side===side);
    return '<div class="crsb-team" style="--tc:'+esc(col)+'"><div class="crsb-th"><b>'+esc(T)+'</b><span>'+L.length+' sub'+(L.length===1?'':'s')+(done?' · '+done+' ✓':'')+'</span></div>'
      +(L.length?'<div class="crsb-hd"><span>Minute</span><span>Player off</span><span></span><span>Player on</span><span></span></div>':'')
      +L.map(x=>{ const it=E.info.get(x.id);
        return '<div class="crsb-sub'+(it&&it.done?' done':'')+(curId===x.id?' cur':'')+'"><div class="crsb-r">'+box(x,'min',"52'")+box(x,'out','Off…')+'<span class="crsb-ar">→</span>'+box(x,'in','On…')
          +'<span class="crsb-x" data-act="rm" data-id="'+x.id+'" title="Remove from the list">✕</span></div>'+(it?infoHtml(it, E.st):'')+'</div>'; }).join('')
      +'<button class="cbtn mini crsb-add" data-act="add" data-side="'+side+'">+ Add '+esc(T)+' sub</button>'
      +(orph.length?'<div class="crsb-orph"><b>SUB rows in the game not in this list</b>'+orph.map(r=>'<div><span class="crsb-tag warn">not in report</span><span class="go" style="cursor:pointer;color:var(--accent);font-weight:700" data-act="seek" data-t="'+r.t+'">▶ '+fmtT(r.t)+'</span>'+esc(clockOf(r.t, E.st))+' · '+esc(g('cohSubText')(r)||'no players on the row')+'</div>').join('')+'</div>':'')
      +'</div>';
  }
  function startsHtml(st){
    const one=(k,lbl)=>{ const s=st[k]; if(!s||s.t==null) return k[0]==='e'?'':'<span class="miss">'+lbl+' start not found</span>';
      if(s.src==='events') return '<span class="miss">'+lbl+' start not found (only the first event: '+fmtT(s.t)+')</span>';
      return '<span>'+lbl+' <b>'+fmtT(s.t)+'</b> · '+(SRC_TXT[s.src]||s.src)+'</span>'; };
    return '<div class="crsb-starts">'+[one('h1','1H'),one('h2','2H'),one('e1','ET1'),one('e2','ET2')].filter(Boolean).join('')+'</div>';
  }
  function checkHtml(E){
    const L=ids(E), id=L[S.check.i], it=E.info.get(id); if(!it) return '';
    const T=teamOf(it.side), st=E.st, x=it.x;
    const target=x.t!=null?'checked at <span class="crsb-big">'+fmtT(x.t)+'</span>'+esc(clockOf(x.t, st))
      :it.v.ok?esc(it.p.label)+' → <span class="crsb-big">'+esc(it.v.clock)+'</span> · video <span class="go" data-act="seek" data-t="'+it.v.t+'" style="cursor:pointer;color:var(--accent);font-weight:700">▶ '+fmtT(it.v.t)+'</span>'+(it.v.note?'<br>'+esc(it.v.note):'')
      :'<span class="crsb-err">⚠ '+esc(it.p.ok?it.v.error:it.p.error)+' — find it in the video and set it</span>';
    let ex='';
    if(it.row){ const r=it.row; ex='<div class="crsb-i"><div class="crsb-ex'+(it.done?' same':'')+'"><span class="crsb-tag '+(it.done?'ok':'warn')+'">'+(it.done?'✓ in the game':'existing SUB row')+'</span><span class="go" data-act="seek" data-t="'+r.t+'" style="cursor:pointer;color:var(--accent);font-weight:700">▶ '+fmtT(r.t)+'</span>'+esc(clockOf(r.t, st))+'<br>'+esc(g('cohSubText')(r)||'no players on the row')
      +(!it.sameP&&it.complete?'<br><label class="crsb-ck"><input type="checkbox" data-ck="fixPlayers" data-id="'+x.id+'"'+(x.fixPlayers?' checked':'')+'>also fix the players to the report’s</label>':'')+'</div></div>'; }
    else if(it.complete) ex='<div class="crsb-i"><span class="crsb-tag new">new</span>no SUB row in the game yet — one is added when you set the time</div>';
    const can=it.complete||!!it.row;
    return '<div class="crsb-card"><div class="crsb-th"><b style="color:var(--t1)">'+esc(T)+'</b><span>sub '+(S.check.i+1)+' of '+L.length+'</span></div>'
      +'<div class="who"><span class="o">▼ '+esc(pl(it.out))+'</span> &nbsp;→&nbsp; <span class="n">▲ '+esc(pl(it.in))+'</span></div>'
      +'<div class="crsb-i" style="margin-top:0">'+target+'</div>'+ex
      +((it.out.err||it.in.err)?'<div class="crsb-i crsb-err">⚠ '+esc([it.out.err,it.in.err].filter(Boolean).join(' · '))+'</div>':'')
      +'<div class="crsb-now" id="crSubsNow"></div>'
      +'<div class="crsb-nudge"><button class="cbtn" data-act="vs" data-d="-5">« 5s</button><button class="cbtn" data-act="vs" data-d="-1">‹ 1s</button><button class="cbtn" data-act="vf" data-d="-1">‹ fr</button><button class="cbtn" data-act="vp">▶ ❚❚</button><button class="cbtn" data-act="vf" data-d="1">fr ›</button><button class="cbtn" data-act="vs" data-d="1">1s ›</button><button class="cbtn" data-act="vs" data-d="5">5s »</button></div>'
      +'<div class="crsb-go"><button class="cbtn pri" data-act="set"'+(can?'':' disabled')+' title="This sub happens at the video’s current moment">✓ Set to current video time</button>'
      +(it.row?'<button class="cbtn" data-act="keep" title="The existing row’s time is right">Keep existing time</button>':'')
      +'</div><div class="crsb-go" style="margin-top:6px"><button class="cbtn mini" data-act="prev"'+(S.check.i?'':' disabled')+'>‹ Previous</button><button class="cbtn mini" data-act="next"'+(S.check.i<L.length-1?'':' disabled')+'>Skip ›</button><button class="cbtn mini" data-act="list" style="margin-left:auto">Back to the list</button></div></div>';
  }
  function render(){
    syncBtn();
    if(!S.open||!GAMEv()) return;
    load();
    const p=build(), G=GAMEv(), lv=level();
    // a box being typed in keeps its text, focus and caret through the redraw (its value is taken into the list first)
    const ae=document.activeElement, keep=(ae&&p.contains(ae)&&ae.dataset&&ae.dataset.f)?{id:ae.dataset.id, f:ae.dataset.f, a:ae.selectionStart, b:ae.selectionEnd, list:g('acInput')===ae}:null;
    if(keep){ const f=findSub(keep.id), v=String(ae.value||''); if(f&&f.x[keep.f].replace(/\s+/g,' ').trim()!==v.replace(/\s+/g,' ').trim()){ f.x[keep.f]=v; if(keep.f==='min') f.x.t=null; } }
    const E=evaluate();
    p.classList.toggle('chk', !!S.check);
    const nTodo=[...E.info.values()].filter(it=>!it.blank&&!it.done&&(it.row?((it.x.useTime&&it.t!=null&&!it.sameT)||(it.x.fixPlayers&&it.complete&&!it.sameP)):(it.complete&&it.t!=null))).length, nAll=[...E.info.values()].filter(it=>!it.blank).length;
    const head='<div class="crfr-h"><span>SUBS</span><span class="crfr-sub">'+(S.check?'check each sub against the video':'from the match report · '+esc(G.homeTeam||'')+' v '+esc(G.awayTeam||''))+'</span><span class="crfr-x" data-act="close" title="Close (Esc)">✕</span></div>';
    if(S.check){ p.innerHTML=head+checkHtml(E)+'<div class="crfr-status" id="crSubsStatus">'+esc(S.status||'')+'</div>'; live(); return; }
    const H=HALF()[lv];
    p.innerHTML=head
      +'<div class="crlc-note">Minute as the report gives it: <b>52</b> · <b>35+2</b> · <b>HT</b> · <b>ET1 5</b> · or a clock <b>2H 16:30</b>. '+(lv==='club'?'Club game: '+H+'-minute halves':'County game: '+H+'-minute halves')+'; a minute lands at its start (<b>'+(H+17)+"'</b> = 2H 16:00). HT = "+HT_LEAD+' s before the 2nd-half throw-in. Players: pick from the team sheet, or type a number.</div>'
      +startsHtml(E.st)
      +'<div class="crsb-cols">'+teamHtml('home', E)+teamHtml('away', E)+'</div>'
      +'<div class="crfr-row crfr-btns" style="margin-top:8px;flex-wrap:wrap"><button class="cbtn mini crfr-all" data-act="check"'+(nAll?'':' disabled')+' title="Step through the subs: the video jumps to each one; nudge to the exact moment and set it">▶ Check one by one</button>'
      +'<button class="cbtn mini" data-act="apply"'+(nTodo?'':' disabled')+' title="Add / change every sub not yet in the game, at the times shown (one Undo)">Apply all ('+nTodo+')</button>'
      +'<button class="cbtn mini" data-act="clear"'+(nAll||S.list.home.length+S.list.away.length?'':' disabled')+'>Clear list</button>'
      +'<span class="crlc-note" style="margin:0 0 0 auto">'+(G._local?'Local session — rows go into the XML you export.':'Queued with the session — saved by “Close session &amp; save all”.')+' This list is kept in this browser.</span></div>'
      +'<div class="crfr-status" id="crSubsStatus">'+esc(S.status||'')+'</div>';
    const f=S.focus; S.focus=null;
    if(f){ const inp=p.querySelector('input[data-id="'+f.id+'"][data-f="'+f.f+'"]'); if(inp&&inp.focus) inp.focus(); }
    else if(keep){ const inp=p.querySelector('input[data-id="'+keep.id+'"][data-f="'+keep.f+'"]');
      if(inp&&inp.focus){ S.restoring=true; inp.focus(); S.restoring=false; try{ inp.setSelectionRange(keep.a, keep.b); }catch(_){} if(keep.list) openList(inp, false); } }
  }
  function live(){ const el=document.getElementById('crSubsNow'); if(!el||!S.open) return; let t=0; try{ t=g('vNow')(); }catch(_){}
    el.textContent='Video now  '+fmtT(t)+(function(){ const c=cohSubsClockAt(t, starts()); return c?'  ·  '+c:''; })(); }
  function syncBtn(){ const b=document.getElementById('crSubsBtn'); if(!b) return; const G=GAMEv(); let n=0;
    try{ if(G&&S.gid===G.id) n=S.list.home.length+S.list.away.length; }catch(_){} b.textContent='🔁 Subs'+(n?' ('+n+')':''); }
  function crSubsOpen(){ if(!GAMEv()) return false; load(); const p=build(); p.style.display=''; S.open=true; S.status='';
    if(!S.list.home.length&&!S.list.away.length){ S.list.home.push({id:'s'+(++S.seq), min:'', out:'', in:'', t:null}); S.list.away.push({id:'s'+(++S.seq), min:'', out:'', in:'', t:null}); }
    if(!S.timer) S.timer=setInterval(live, 400); render(); return true; }
  function crSubsClose(){ const p=document.getElementById('crSubs'), ae=document.activeElement;
    if(ae&&p&&p.contains(ae)&&ae.dataset&&ae.dataset.f){ commit(ae); if(ae.blur) ae.blur(); }
    if(p) p.style.display='none'; S.open=false; S.check=null; try{ g('acHide')(); }catch(_){}
    if(S.timer){ clearInterval(S.timer); S.timer=null; } syncBtn(); }
  function crSubsToggle(){ if(S.open) crSubsClose(); else crSubsOpen(); }
  // after an Undo / a game change: redraw (the list's state is worked out from the rows each time)
  function crSubsRefresh(){ const G=GAMEv(); if(S.open&&G&&S.gid!==G.id){ S.check=null; } render(); }
  // keys typed in the panel never reach the coding hot-keys (window capture, like Goalkeepers)
  window.addEventListener('keydown', e=>{
    if(!S.open) return;
    const p=document.getElementById('crSubs'), t=e.target;
    if(!(p&&t&&p.contains&&p.contains(t))) return;
    e.stopPropagation();
    const isNm=t.dataset&&(t.dataset.f==='out'||t.dataset.f==='in');
    const dd=document.getElementById('acDrop'), open=isNm&&g('acInput')===t&&dd&&dd.style.display!=='none';
    if(open&&(e.key==='ArrowDown'||e.key==='ArrowUp'||(e.key==='Enter'&&g('acIdx')>=0))){ g('acKey')(e); return; }
    if(isNm&&e.key==='ArrowDown'){ e.preventDefault(); openList(t, true); return; }
    if(e.key==='Enter'&&t.tagName==='INPUT'&&t.dataset.f){ e.preventDefault(); g('acHide')();
      const f=findSub(t.dataset.id), nx={min:'out', out:'in', in:null}[t.dataset.f];
      commit(t);
      if(nx){ S.focus={id:t.dataset.id, f:nx}; render(); }
      else if(f){ const L=S.list[f.side], i=L.findIndex(x=>x.id===f.x.id); if(i===L.length-1) addSub(f.side); else { S.focus={id:L[i+1].id, f:'min'}; render(); } }
      return; }
    if(e.key==='Escape'){ e.preventDefault(); if(open){ g('acHide')(); return; } crSubsClose(); }
  }, true);
  Object.assign(root, {crSubsOpen, crSubsClose, crSubsToggle, crSubsRefresh, crSubsRender:render, crSubsApply:apply, crSubsEvaluate:evaluate});
})(typeof window!=='undefined'?window:globalThis);
