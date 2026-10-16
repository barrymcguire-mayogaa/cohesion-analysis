/* COHESION — minutes played (pure: no DOM, no page globals needed; loadable from Node)
 *
 * Who was on the pitch, and for how long, for ONE team in ONE game. Used by Analysis › Players › PLAYER PROFILE.
 *
 *   cohMinutesGame(o) → result
 *     o.meta      the game's meta (rosters = the team sheets, scPeriods = the file's own period rows, section / teams)
 *     o.events    the game's events
 *     o.team      the team (any case)
 *     o.clockOf   e → {p:'h1'|'h2'|'e1'|'e2', secs} | null — the page's game clock (Analysis passes Momentum's mmClock on
 *                 the period starts of mmStarts: the dashboard's scoreboard rule). Required: this file never invents a clock.
 *     o.keyOf     name → the player key (Analysis: cohPlayerKey, the one key of the page); default cohNameKey
 *
 *   THE RULES (nothing is guessed — a game that cannot be read gives ok:false and a reason, never a number):
 *   · STARTERS come from the team's sheet for the game (meta.rosters[side], read through the shared cohSubSheet:
 *     role 'start' as recorded, or the sheet's own number rule when no role is recorded — the reading Code Room's
 *     Teams panel and cohSubState use). No sheet → ok:false ('no team sheet').
 *   · A POSITION is the sheet entry's pos (1–15, from the match-report paste; cohesion-teamsheet.js posOf) — never a
 *     jersey number, never the order of the rows. Lines: 1 GK · 2–7 backs · 8–9 midfield · 10–15 forwards. A player
 *     who came on takes the line of the player he replaced (that player's own line in this game).
 *   · SUBS are the team's SUB rows (cohIsSubRow), in game-clock order, each read with cohSubInOut (Player Out / Player
 *     In labels, the two player labels, or the Tracker's Sub Detail "#18 ON for #13" through the sheet). A sub row that
 *     does not name BOTH players makes the game unreadable (ok:false): who came on cannot be known.
 *   · A BLOOD SUB (cohIsBloodSubRow) is temporary: with a RETURNED clock (cohSubReturned) the player who went off is
 *     back on from that clock and the blood replacement goes off; without one it stands as a normal sub.
 *   · CARDS: a RED CARD ends the named player's time on the pitch; a BLACK CARD takes him off for 10 minutes of game
 *     time. Only a card row that names exactly one player of the team counts (else it is listed in cardsUnread).
 *   · PERIODS: 1H, 2H and, when played, ET1 / ET2. A period's length is the file's own period row (meta.scPeriods:
 *     end − start) when the game has one, else the clock of the period's last event. Game time runs 1H then 2H then
 *     ET1 then ET2, each period from 0 to its length; a clock past the end of its period is taken as its end.
 *   · A half-time sub (clocked 2H 00:00) gives the player who went off the whole first half.
 *
 *   → { ok, reason, team, side, level, length (seconds), periods:[{p, len, src:'marker'|'events'}],
 *       players:[{key, name, no, started, pos, line, lineFrom:'pos'|'sub'|'', onSheet, squad, secs, min, spells:[[a,b]…],
 *                 cameOn:[{t, for}], wentOff:[{t, why}]}],
 *       subs:n, blood:n, cards:[{key, kind, t}], cardsUnread:n, warnings:[text], total (player-seconds), onCount }
 *     t / spells are seconds of game time (0 = the throw-in).
 *
 *   cohMinutesLine(pos)          1 → 'GK' · 2–7 → 'B' · 8–9 → 'M' · 10–15 → 'F' · else ''
 *   COH_MINUTES_LINES            [['GK','Goalkeeper'],['B','Backs'],['M','Midfield'],['F','Forwards']]
 *   cohMinutesGameTime(c, periods)  {p, secs} → seconds of game time on those periods (null when the period is not played)
 *   cohMinutesSplit(spells, t)   whether game time t falls inside a spell ([a,b): a player is on from a to b)
 */
(function(root){
  'use strict';
  const need=n=>{ if(typeof root[n]==='function') return root[n]; if(typeof globalThis!=='undefined'&&typeof globalThis[n]==='function') return globalThis[n];
    if(typeof require==='function') for(const f of ['./cohesion-labels.js','./cohesion-periods.js']){ try{ const L=require(f); if(typeof L[n]==='function') return L[n]; }catch(_){} }
    return null; };
  const PER=['h1','h2','e1','e2'], PER_CODE={h1:'1st Half', h2:'2nd Half', e1:'ET 1st Half', e2:'ET 2nd Half'};
  const LINES=[['GK','Goalkeeper'],['B','Backs'],['M','Midfield'],['F','Forwards']];
  const BLACK_SECS=600;
  const up=s=>String(s==null?'':s).toUpperCase().trim();
  function line(pos){ const n=+pos; return !Number.isInteger(n)?'':n===1?'GK':n>=2&&n<=7?'B':n>=8&&n<=9?'M':n>=10&&n<=15?'F':''; }
  function posOf(r){ const v=r&&(r.pos!=null?r.pos:(r.extra&&r.extra.pos)), n=(v==null||v==='')?NaN:+v; return Number.isInteger(n)&&n>=1&&n<=15?n:0; }
  function gameTime(c, periods){
    if(!c) return null; let off=0;
    for(const P of periods){ if(P.p===c.p) return off+Math.max(0, Math.min(P.len, +c.secs||0)); off+=P.len; }
    return null;
  }
  function inSpell(spells, t){ return (spells||[]).some(s=>t>=s[0]&&t<s[1]); }
  // the sheet with each row's pos (cohSubSheet drops the extra props, so pos is read from the stored entries by name)
  function sheetRows(meta, side){
    const sub=need('cohSubSheet'); const rows=sub?sub(meta, side):[];
    const raw=(meta&&meta.rosters&&!Array.isArray(meta.rosters)&&Array.isArray(meta.rosters[side]))?meta.rosters[side]:[];
    const nk=need('cohNameKey')||(s=>String(s||'').toLowerCase().replace(/\s+/g,''));
    const posBy=new Map();
    raw.forEach(r=>{ if(!r||typeof r!=='object') return; const n=String(r.name!=null?r.name:(r.player!=null?r.player:'')).replace(/\s+/g,' ').trim(), p=posOf(r); if(n&&p&&!posBy.has(nk(n))) posBy.set(nk(n), p); });
    return rows.map(r=>Object.assign({}, r, {pos:posBy.get(nk(r.name))||0}));
  }
  function cohMinutesGame(o){
    o=o||{}; const meta=o.meta||{}, events=o.events||[], T=up(o.team);
    const keyOf=o.keyOf||need('cohNameKey')||(s=>String(s||'').toLowerCase().replace(/\s+/g,''));
    const res={ok:false, reason:'', team:T, side:'', level:'', length:0, periods:[], players:[], subs:0, blood:0, cards:[], cardsUnread:0, warnings:[], total:0, onCount:0};
    const lvl=need('cohGameLevel'); res.level=lvl?lvl(meta):'';
    const side=T&&T===up(meta.homeTeam)?'home':T&&T===up(meta.awayTeam)?'away':''; res.side=side;
    if(!side){ res.reason='the team is not in this game'; return res; }
    if(typeof o.clockOf!=='function'){ res.reason='no game clock'; return res; }
    const sheet=sheetRows(meta, side);
    if(!sheet.length){ res.reason='no team sheet'; return res; }
    const starters=sheet.filter(r=>r.role==='start');
    if(!starters.length){ res.reason='the team sheet names no starters'; return res; }
    // ── periods ──
    const clocks=new Map(), maxS={h1:null,h2:null,e1:null,e2:null};
    events.forEach(e=>{ if(!e) return; const c=o.clockOf(e); if(!c||PER.indexOf(c.p)<0) return; clocks.set(e, c); if(maxS[c.p]==null||c.secs>maxS[c.p]) maxS[c.p]=c.secs; });
    const marks=Array.isArray(meta.scPeriods)?meta.scPeriods:[];
    PER.forEach(p=>{ const m=marks.find(x=>x&&x.code===PER_CODE[p]&&isFinite(+x.start)&&isFinite(+x.end)&&+x.end>+x.start);
      if(m) res.periods.push({p, len:+m.end-(+m.start), src:'marker'});
      else if(maxS[p]!=null&&maxS[p]>0) res.periods.push({p, len:maxS[p], src:'events'}); });
    if(!res.periods.some(P=>P.p==='h1')||!res.periods.some(P=>P.p==='h2')){ res.reason='the game clock does not reach both halves'; return res; }
    // a later period only after the ones before it (ET2 without ET1 is not a game)
    for(let i=0;i<res.periods.length;i++) if(res.periods[i].p!==PER[i]){ res.reason='the periods are not in order ('+res.periods.map(P=>P.p).join(', ')+')'; return res; }
    res.length=res.periods.reduce((a,P)=>a+P.len, 0);
    const GT=e=>gameTime(clocks.get(e), res.periods);
    // ── players ──
    const P=new Map(), nameOf=n=>String(n||'').replace(/\s+/g,' ').trim();
    const get=(name, no)=>{ const k=keyOf(name); if(!k) return null; let r=P.get(k); if(!r){ r={key:k, name:nameOf(name), no:no||'', started:false, pos:0, line:'', lineFrom:'', onSheet:false, squad:false, spells:[], cameOn:[], wentOff:[], _on:null}; P.set(k, r); } return r; };
    sheet.forEach(r=>{ const p=get(r.name, r.no); if(!p) return; p.onSheet=true; p.squad=true; if(r.role==='start'){ p.started=true; p.pos=r.pos||0; p.line=line(p.pos); p.lineFrom=p.line?'pos':''; p._cur=p.line; p._on=0; } });
    // ── moves: subs, blood returns, cards ──
    const isSub=need('cohIsSubRow'), io=need('cohSubInOut'), isBlood=need('cohIsBloodSubRow'), returned=need('cohSubReturned'), evPlayers=need('cohEventPlayers');
    const mine=e=>up(e.team)===T;
    const moves=[], bad=[];
    events.forEach((e,i)=>{ if(!e||!mine(e)) return;
      if(isSub&&isSub(e)){ const x=io?io(e, meta):{}, t=GT(e);
        if(t==null){ bad.push('a sub row has no game clock'); return; }
        if(!(x.out&&x.out.name)||!(x.in&&x.in.name)){ bad.push('the sub row at '+fmt(t)+' does not name both players'+(x.out||x.in?' ('+((x.out&&(x.out.name||('#'+x.out.no)))||'?')+' → '+((x.in&&(x.in.name||('#'+x.in.no)))||'?')+')':'')); return; }
        const blood=!!(isBlood&&isBlood(e)); res.subs++; if(blood) res.blood++;
        moves.push({t, i, k:0, type:'sub', out:x.out.name, in:x.in.name, outNo:x.out.no, inNo:x.in.no, blood});
        if(blood&&returned){ const r=returned(e), c0=clocks.get(e);
          if(r&&r.secs!=null){ const per={'1H':'h1','2H':'h2','ET1':'e1','ET2':'e2'}[r.period]||(c0&&c0.p);
            const rt=gameTime({p:per, secs:r.secs}, res.periods);
            if(rt==null) res.warnings.push('a blood sub’s return ('+r.text+') is in a period this game does not have');
            else moves.push({t:Math.max(t, rt), i, k:1, type:'return', out:x.out.name, in:x.in.name}); } }
        return; }
      if(/(^|\s)CARDS?$/i.test(String(e.code||''))){
        const kind=/RED/i.test(String((e.labels&&(e.labels['Card Outcomes']||e.labels['Card Outcome']))||e.outcome||''))?'red':/BLACK/i.test(String((e.labels&&(e.labels['Card Outcomes']||e.labels['Card Outcome']))||e.outcome||''))?'black':'';
        if(!kind) return;
        const who=(evPlayers?evPlayers(e, meta):[]).filter(p=>!p.team||up(p.team)===T).map(p=>p.name).filter((n,j,a)=>a.findIndex(m=>keyOf(m)===keyOf(n))===j);
        const t=GT(e);
        if(who.length!==1||t==null){ res.cardsUnread++; return; }
        moves.push({t, i, k:2, type:kind, who:who[0]});
        if(kind==='black') moves.push({t:Math.min(res.length, t+BLACK_SECS), i, k:3, type:'binback', who:who[0]});
      }
    });
    if(bad.length){ res.reason=bad[0]+(bad.length>1?' (+'+(bad.length-1)+' more)':''); res.warnings=bad; return res; }
    moves.sort((a,b)=>a.t-b.t||a.i-b.i||a.k-b.k);
    const goOff=(p, t, why)=>{ if(!p) return false; if(p._on==null) return false; if(t>p._on) p.spells.push([p._on, t]); p._on=null; p.wentOff.push({t, why}); return true; };
    const goOn=(p, t)=>{ if(!p) return false; if(p._on!=null) return false; p._on=t; return true; };
    moves.forEach(m=>{
      if(m.type==='sub'){ const po=get(m.out, m.outNo), pi=get(m.in, m.inNo); if(!po||!pi) return;
        if(!goOff(po, m.t, m.blood?'blood':'sub')) res.warnings.push(po.name+' is not on the pitch at '+fmt(m.t)+' (sub row: '+po.name+' → '+pi.name+')');
        pi.squad=true; if(!goOn(pi, m.t)) res.warnings.push(pi.name+' is already on the pitch at '+fmt(m.t));
        pi.cameOn.push({t:m.t, for:po.key, blood:m.blood});
        // the line he comes on in: the line the player he replaces is playing in now (a starter's position, else the
        // line that player himself came on in)
        if(!pi.started&&po._cur){ (pi._lines=pi._lines||[]).push(po._cur); pi._cur=po._cur; }
        return; }
      if(m.type==='return'){ const po=get(m.out), pi=get(m.in); goOff(pi, m.t, 'blood return'); goOn(po, m.t); return; }
      if(m.type==='red'){ const p=get(m.who); res.cards.push({key:p.key, kind:'red', t:m.t}); goOff(p, m.t, 'red card'); return; }
      if(m.type==='black'){ const p=get(m.who); res.cards.push({key:p.key, kind:'black', t:m.t}); p._bin=goOff(p, m.t, 'black card'); return; }
      if(m.type==='binback'){ const p=get(m.who); if(p._bin){ goOn(p, m.t); p._bin=false; } }
    });
    P.forEach(p=>{ if(p._on!=null){ if(res.length>p._on) p.spells.push([p._on, res.length]); p._on=null; }
      if(!p.started&&p._lines&&p._lines.length){ const c={}; p._lines.forEach(l=>{ c[l]=(c[l]||0)+1; }); p.line=Object.keys(c).sort((a,b)=>c[b]-c[a]||p._lines.indexOf(a)-p._lines.indexOf(b))[0]; p.lineFrom='sub'; }
      delete p._lines; delete p._bin; delete p._on; delete p._cur;
      p.secs=p.spells.reduce((a,s)=>a+(s[1]-s[0]), 0); p.min=p.secs/60; res.total+=p.secs; });
    res.players=[...P.values()];
    res.onCount=starters.length;
    if(starters.length!==15) res.warnings.push(starters.length+' starters on the sheet (a team starts 15)');
    res.ok=true;
    return res;
  }
  function fmt(t){ const s=Math.round(+t||0); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
  const api={cohMinutesGame, cohMinutesLine:line, cohMinutesGameTime:gameTime, cohMinutesSplit:inSpell, cohMinutesPosOf:posOf, COH_MINUTES_LINES:LINES, COH_MINUTES_BLACK_SECS:BLACK_SECS};
  Object.assign(root, api);
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
