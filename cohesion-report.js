/* COHESION — Code Room "Match report": both team sheets and the subs from a newspaper-style match report.
 *
 *   Dublin: Evan Comerford; Seán MacMahon, Eoin Kennedy (0-01), David Byrne; … Cormac Costello (0-04, 0-02f).
 *   Subs: Ross McGarry for Costello 49, … Seán Guiden (0-01) for Basquel 65, …
 *   Galway: …
 *   Subs: … Johnny McGrath for Glynn 60-64 blood, … McGrath for Conroy 67.
 *
 * The text is pasted, or read from a screenshot ON THIS DEVICE by the team-sheet reader (cohesion-teamsheet-reader.js
 * readText — the same Tesseract / pdf.js engine, nothing uploaded). A PREVIEW shows both teams; nothing is written
 * before Apply. Apply writes both team sheets (the Team sheets editor's own save) and puts the subs into the Subs
 * panel's typed list (cohesion-subs.js), which is then opened for "Check one by one" / "Apply all".
 *
 * JERSEY NUMBERS ARE NEVER ASSIGNED BY ORDER. A player's number comes only from the game's existing team sheet (the
 * programme), matched by name (accents / fadas, case, apostrophes ignored; "K. McDonald" ↔ "Kevin McDonald"). The
 * report's order of the starting 15 is kept as the player's POSITION (pos 1–15, stored beside the number on the
 * sheet entry) for a pitch view. A reported player not on the sheet is added with NO number and flagged; with no
 * sheet at all every number stays blank and the preview says to add the programme sheet. A number on the sheet is
 * never changed.
 *
 * Everything above the "UI" banner is pure (no DOM) and is what the Node tests run:
 *   cohReportParse(text, {home, away, level}) → {teams:[team], other:[{heading, text}]}
 *     team = {heading, side:'home'|'away'|'', how, guess, starters:[{pos, name, raw, score}], lines:[n…]|null,
 *             flags:[text], subs:[sub]}
 *     sub  = {i, raw, in:{text, score}, out:{text}, min, ret, blood, key, minOk, minErr, flags:[text]}
 *     score = {raw, g, p, tp, frees:{g,p}|null, pens, s45, marks, other:[text]}
 *   cohReportResolve(parse, {sides, picks, sheets:{home:[rows], away:[rows]}, modes, known:{home:[names], away}}) → per team:
 *     {side, sheetRows, hasSheet, mode, starters:[{pos, name, rep, no, sheet:'match'|'none'|'ask', cands}],
 *      subs:[{…sub, inName, outName, inSt, outSt, inCands, outCands, notes}], questions:[…], flags}
 *     picks: {'<ti>:<i>:in'|'<ti>:<i>:out': name, 'sheet:<ti>:<name key>': sheet name | '' (not on the sheet)}
 *   cohReportPlan(resolved) → {sheets:{home:[rows], away:[rows]}, subs:{home:[{min,out,in,blood,ret}], away}, blocking:[text]}
 *   cohReportScore(text) · cohReportNameMatch(a, b) · cohReportTeamScore(heading, team)
 */
(function(root){
  'use strict';
  const SUBS=root.cohSubsParseMinute?root:(typeof require==='function'?(function(){ try{ return require('./cohesion-subs.js'); }catch(_){ return {}; } })():{});
  const parseMin=(t, lv)=>SUBS.cohSubsParseMinute?SUBS.cohSubsParseMinute(t, lv):{ok:false, error:'minute reader not loaded'};

  // ── names ─────────────────────────────────────────────────────
  const tidy=s=>String(s==null?'':s).replace(/[‘’‛ʼ`´]/g,"'").replace(/ /g,' ').replace(/\s+/g,' ').trim();
  const fold=s=>String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[‘’‛ʼ`´']/g,'').toLowerCase();
  const toks=s=>fold(s).replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(Boolean);
  const nkey=s=>toks(s).join('');
  // a = what the report says ("Costello", "Ó Laoi", "J McGrath", "Eoin Kennedy"); b = a full name
  // → 'exact' (same name, accents / case / apostrophes / spacing ignored) | 'part' (surname, or initial + surname) | ''
  function nameMatch(a, b){
    const t=toks(a), c=toks(b); if(!t.length||!c.length) return '';
    if(t.join('')===c.join('')) return 'exact';
    const tj=t.join('');
    for(let j=1;j<c.length;j++) if(c.slice(j).join('')===tj) return 'part';
    if(t.length>=2&&t[0].length===1){ const rest=t.slice(1).join('');
      for(let j=1;j<c.length;j++) if(c.slice(j).join('')===rest&&c[0][0]===t[0]) return 'part'; }
    return '';
  }
  // a name that only gives the surname (or an initial and the surname)
  const partial=s=>{ const t=toks(s); return t.length<2||t[0].length===1&&!/^o$/.test(t[0])||(t.length===2&&t[0]==='o'); };

  // ── scores: "1-07, 1-0 pen, 0-03f" · "0-04, 2 tp" · "0-02f" · "0-01 45" ──
  function kindOf(t){
    t=String(t||'').trim().toLowerCase().replace(/[.()']/g,'').trim();
    if(!t) return '';
    if(/^(f|fs|frees?)$/.test(t)) return 'frees';
    if(/^(pen|pens|penalty|penalties)$/.test(t)) return 'pens';
    if(/^45s?$/.test(t)) return 's45';
    if(/^(m|marks?)$/.test(t)) return 'marks';
    if(/^(tps?|2pts?)$/.test(t)) return 'tpScore';
    return null;
  }
  function cohReportScore(s){
    s=tidy(s).replace(/[–—]/g,'-'); if(!/\d/.test(s)) return null;
    const r={raw:s, g:null, p:null, tp:0, frees:null, pens:null, s45:null, marks:null, other:[]};
    const parts=s.split(/\s*[,;]\s*/).filter(Boolean); let any=false;
    const add=(k, v)=>{ if(k==='tpScore'){ r.tp+=Math.round(v.p/2)||1; return; } r[k]=r[k]?{g:r[k].g+v.g, p:r[k].p+v.p}:v; };
    parts.forEach(pt=>{
      let m=/^(\d{1,2})\s*-\s*(\d{1,2})\s*(.*)$/.exec(pt);
      if(m){ const v={g:+m[1], p:+m[2]}, k=kindOf(m[3]);
        if(k===''){ if(r.g==null){ r.g=v.g; r.p=v.p; } else r.other.push(pt); any=true; return; }
        if(k){ add(k, v); if(r.g==null&&parts.length===1){ r.g=v.g; r.p=v.p; } any=true; return; }
        r.other.push(pt); return; }
      m=/^(\d{1,2})?\s*(tps?|2\s*-?\s*pt(?:er)?s?|two[- ]?point(?:er)?s?|2[- ]?pointers?)$/i.exec(pt);
      if(m){ r.tp+=m[1]?+m[1]:1; any=true; return; }
      m=/^(\d{1,2})\s*(f|frees?|pens?|45s?|marks?)$/i.exec(pt);
      if(m){ const k=kindOf(m[2]); if(k&&k!=='tpScore'){ add(k, k==='pens'?{g:+m[1], p:0}:{g:0, p:+m[1]}); any=true; return; } }
      r.other.push(pt);
    });
    return any&&r.g!=null||any&&r.tp?r:null;
  }
  const scoreTxt=sc=>{ if(!sc) return ''; const gp=v=>v.g+'-'+String(v.p).padStart(2,'0'), b=[];
    if(sc.g!=null) b.push(gp(sc)); if(sc.tp) b.push(sc.tp+' tp'); if(sc.frees) b.push(gp(sc.frees)+'f'); if(sc.pens) b.push(gp(sc.pens)+' pen'); if(sc.s45) b.push(gp(sc.s45)+' 45'); if(sc.marks) b.push(gp(sc.marks)+' m');
    return b.join(', '); };

  // ── team headings → home / away ────────────────────────────────
  const IRISH={aontroim:'antrim', ardmhacha:'armagh', ceatharlach:'carlow', cabhan:'cavan', clar:'clare', corcaigh:'cork', doire:'derry',
    dunnangall:'donegal', dun:'down', athcliath:'dublin', baileathacliath:'dublin', fearmanach:'fermanagh', gaillimh:'galway', ciarrai:'kerry',
    cilldara:'kildare', cillchainnigh:'kilkenny', liatroim:'leitrim', luimneach:'limerick', longfort:'longford', lu:'louth', maigheo:'mayo',
    mhi:'meath', mi:'meath', muineachan:'monaghan', uibhfhaili:'offaly', roscomain:'roscommon', sligeach:'sligo', tiobraidarann:'tipperary',
    tireoghain:'tyrone', portlairge:'waterford', iarmhi:'westmeath', lochgarman:'wexford', cillmhantain:'wicklow', londain:'london',
    nuaeabhrac:'newyork', dubs:'dublin', kingdom:'kerry', tribesmen:'galway', rebels:'cork', royals:'meath', lilywhites:'kildare'};
  const headKey=h=>{ const t=toks(String(h||'').replace(/\([^)]*\)/g,' ').replace(/\d+\s*-\s*\d+/g,' ')); if(t.length>1&&t[0]==='an') t.shift(); return t.join(''); };
  function cohReportTeamScore(heading, team){
    const hk=headKey(heading), tk=nkey(team); if(!hk||!tk) return 0;
    if(hk===tk) return 4;
    if(IRISH[hk]===tk) return 3;
    const inner=/\(([^)]*)\)/.exec(String(heading||'')); if(inner){ const ik=headKey(inner[1]); if(ik&&(ik===tk||IRISH[ik]===tk)) return 3; }
    if(hk.length>=4&&(tk.startsWith(hk)||hk.startsWith(tk))) return 2;
    if(hk.length===3&&tk.startsWith(hk)) return 1;
    return 0;
  }

  // ── splitting the text ────────────────────────────────────────
  const SUBS_RE=/^(subs?|substitutes?|substitutions?|replacements?|bench|subs used|fir ionaid|ionadaithe)$/i;
  const OTHER_RE=/(referee|^ref$|umpire|linesm|official|man of the match|player of the match|motm|attendance|venue|scorers?|half[- ]?time|full[- ]?time|^ht$|^ft$|^score|result|weather|not used|unused|booked|black card|red card|yellow card|sent off|stats?$|numbers)/i;
  // the words of a list, split at top-level separators (a comma inside brackets is not one)
  function splitTop(s, seps){
    const out=[]; let d=0, cur='';
    for(const ch of s){ if(ch==='('||ch==='[') d++; else if((ch===')'||ch===']')&&d>0) d--;
      if(d===0&&seps.includes(ch)){ out.push(cur); cur=''; } else cur+=ch; }
    out.push(cur); return out.map(x=>x.trim()).filter(Boolean);
  }
  // the list stops at the end of its sentence: a full stop after a word of 3+ letters or a bracket ("Costello (0-04).")
  function cutSentence(s){
    let d=0;
    for(let i=0;i<s.length;i++){ const ch=s[i]; if(ch==='('||ch==='[') d++; else if((ch===')'||ch===']')&&d>0) d--;
      else if(ch==='.'&&d===0&&(i===s.length-1||/\s/.test(s[i+1]))){ const before=s.slice(0,i), w=/([A-Za-zÀ-ɏ']+|\)|\d+)\s*$/.exec(before);
        if(w&&(w[1]===')'||/^\d+$/.test(w[1])||w[1].length>=3)) return {body:before, rest:s.slice(i+1)}; } }
    return {body:s, rest:''};
  }
  function prepText(text){
    return String(text==null?'':text).replace(/\r\n?/g,'\n').replace(/ /g,' ').replace(/[‘’‛ʼ`´]/g,"'").replace(/[­]/g,'')
      .replace(/([a-zà-ÿ])-\n([a-zà-ÿ])/g,'$1$2').replace(/[ \t]+/g,' ').trim();
  }
  function segments(text){
    const s=prepText(text), re=/(^|[\n.;)]\s*|\s{2,})([A-Za-zÀ-ɏ'][A-Za-zÀ-ɏ'.\- &]{0,40}?)\s*[:：]/g, H=[]; let m;
    while((m=re.exec(s))){ const h=m[2].trim(); if(!h||/^\d/.test(h)) continue;
      const start=m.index+m[1].length; H.push({heading:h, start, end:re.lastIndex}); }
    return H.map((h,i)=>({heading:h.heading, body:s.slice(h.end, i+1<H.length?H[i+1].start:s.length).trim()}));
  }

  // ── one sub: "Seán Guiden (0-01) for Basquel 65" · "Johnny McGrath for Glynn 60-64 blood" · "X for Y (49)" ──
  const T_RE="(?:(?:ET\\s*[12]|[12]\\s*H)\\s*)?\\d{1,3}(?:\\s*\\+\\s*\\d{1,2})?\\s*(?:['′]|mins?\\.?)?";
  const HT_RE="h\\/t|ht|half[- ]?time";
  const RANGE_END=new RegExp('[\\s,]*('+T_RE+')\\s*[-–—]\\s*('+T_RE+')\\s*$','i');
  const ONE_END=new RegExp('[\\s,]*('+T_RE+'|\\b(?:'+HT_RE+'))\\s*$','i');
  const LEAD=new RegExp('^('+T_RE+'|(?:'+HT_RE+'))\\s*[:\\-–]?\\s+(?=[A-Za-zÀ-ɏ])','i');
  const cleanMin=t=>tidy(String(t||'').replace(/['′]/g,'').replace(/\bmins?\.?/i,'')).replace(/\s*\+\s*/g,'+');
  const minKey=(min, lv)=>{ const p=parseMin(min, lv); if(!p.ok) return null; if(p.ht) return 1000-0.5; return ({'1H':0,'2H':1,'ET1':2,'ET2':3}[p.period])*1000+p.secs/60; };
  function parseSub(raw, lv, i){
    let s=tidy(raw).replace(/^[\-–—•·*]+\s*/,'').replace(/[.;,]+$/,'').trim();
    const S={i, raw:tidy(raw), blood:false, min:'', ret:'', in:{text:'', score:null}, out:{text:''}, flags:[]};
    if(/\bblood\b/i.test(s)){ S.blood=true;
      s=s.replace(/\bblood(?:\s*sub(?:stitut(?:e|ion))?)?\b/ig,' ').replace(/\(\s*[,;]\s*/g,'(').replace(/\s*[,;]\s*\)/g,')').replace(/\(\s*\)/g,' ').replace(/\s+/g,' ').trim(); }
    let lead=LEAD.exec(s); if(lead){ S.min=cleanMin(lead[1]); s=s.slice(lead[0].length); }
    const fm=/\s+(?:on\s+)?for\s+/i.exec(s);
    if(!fm){ S.flags.push('Not read as “<player> for <player> <minute>”'); S.in.text=s; S.bad=true; return S; }
    let left=s.slice(0, fm.index), right=s.slice(fm.index+fm[0].length);
    // the player coming on: brackets after his name are his score (or, rarely, the minute)
    left=left.replace(/\(([^)]*)\)/g,(m0, inner)=>{ const sc=cohReportScore(inner); if(sc&&!S.in.score){ S.in.score=sc; return ' '; }
      const tm=new RegExp('^\\s*('+T_RE+'|'+HT_RE+')\\s*$','i').exec(inner); if(tm&&!S.min){ S.min=cleanMin(tm[1]); return ' '; } return ' '; });
    S.in.text=tidy(left).replace(/[,;:]+$/,'');
    right=right.replace(/[()]/g,' ').replace(/\s+/g,' ').trim();
    let m=RANGE_END.exec(right);
    if(m){ if(!S.min) S.min=cleanMin(m[1]); S.ret=cleanMin(m[2]); right=right.slice(0, m.index);
      if(!S.blood){ S.blood=true; S.flags.push('“'+m[1].trim()+'-'+m[2].trim()+'” read as a blood sub (off and back on)'); } }
    else if((m=ONE_END.exec(right))&&!S.min){ S.min=cleanMin(m[1]); right=right.slice(0, m.index); }
    S.out.text=tidy(right).replace(/[,;:]+$/,'');
    if(/^(h\/t|ht|half[- ]?time)$/i.test(S.min)) S.min='HT';
    if(!S.min){ S.flags.push('No minute'); S.minOk=false; S.minErr='No minute'; }
    else { const p=parseMin(S.min, lv); S.minOk=!!p.ok; S.minErr=p.ok?'':p.error; S.p=p; }
    if(S.ret){ const p=parseMin(S.ret, lv); S.retOk=!!(p.ok&&!p.ht); S.retP=p; if(!S.retOk) S.flags.push('Return minute “'+S.ret+'”: '+(p.error||'not a minute')); }
    S.key=minKey(S.min, lv);
    if(!S.in.text) S.flags.push('No player coming on'); if(!S.out.text) S.flags.push('No player going off');
    return S;
  }
  function parseStarters(body){
    const T={starters:[], lines:null, flags:[]};
    let groups=splitTop(body, [';']);
    const semis=groups.length>1;
    let items;
    if(semis) items=groups.map(g=>splitTop(g, [',']));
    else { const flat=splitTop(body, [',']); items=[flat.length>1?flat:splitTop(body.replace(/\n/g,'\u0001'), ['\u0001'])]; }
    items=items.map(g=>g.map(x=>x.replace(/\n/g,' ')));
    let pos=0;
    items.forEach(g=>g.forEach(it=>{
      let score=null, notes=[];
      const name=tidy(it.replace(/[\(\[]([^\)\]]*)[\)\]]/g,(m0, inner)=>{ const sc=cohReportScore(inner); if(sc&&!score) score=sc; else if(inner.trim()) notes.push(inner.trim()); return ' '; }))
        .replace(/^\d{1,2}\s*[.)\-:]?\s+(?=[A-Za-zÀ-ɏ])/,'').replace(/^(and|&)\s+/i,'').replace(/[,;:.]+$/,'').trim();
      if(!/[A-Za-zÀ-ɏ]/.test(name)) return;
      pos++; T.starters.push({pos, name, raw:tidy(it), score, notes});
    }));
    if(semis) T.lines=items.map(g=>g.filter(it=>/[A-Za-zÀ-ɏ]/.test(it)).length);
    const n=T.starters.length;
    if(n!==15) T.flags.push(n+' starters read — a team starts 15 (positions given in report order)');
    if(semis&&T.lines.join('/')!=='1/3/3/2/3/3') T.flags.push('Lines read as '+T.lines.join('/')+' — the usual shape is 1/3/3/2/3/3 (positions still given in report order)');
    if(!semis&&n) T.flags.push('No semicolons between the lines — positions are the report order (the 1/3/3/2/3/3 shape could not be checked)');
    return T;
  }

  function cohReportParse(text, o){
    o=o||{}; const lv=o.level==='club'?'club':'county';
    const segs=segments(text), teams=[], other=[]; let cur=null;
    segs.forEach(sg=>{
      const h=sg.heading, {body, rest}=cutSentence(sg.body);
      if(SUBS_RE.test(h.trim())){
        if(!cur){ other.push({heading:h, text:sg.body, why:'subs before any team'}); return; }
        splitTop(body, [',',';']).forEach(it=>cur.subs.push(parseSub(it, lv, cur.subs.length)));
        if(rest.trim()) other.push({heading:'', text:rest.trim()});
        return; }
      const sc={home:cohReportTeamScore(h, o.home), away:cohReportTeamScore(h, o.away)};
      if(OTHER_RE.test(h)&&!sc.home&&!sc.away){ other.push({heading:h, text:sg.body}); cur=null; return; }
      const st=parseStarters(body);
      if(st.starters.length<8&&!sc.home&&!sc.away){ other.push({heading:h, text:sg.body}); cur=null; return; }
      cur={heading:h, score:sc, side:'', how:'', guess:'', starters:st.starters, lines:st.lines, flags:st.flags, subs:[]};
      teams.push(cur);
      if(rest.trim()) other.push({heading:'', text:rest.trim()});
    });
    // sides: the best match, one team per side
    teams.forEach(t=>{ const h=t.score.home, a=t.score.away; if(h>a){ t.side='home'; t.how=h; } else if(a>h){ t.side='away'; t.how=a; } });
    ['home','away'].forEach(sd=>{ const L=teams.filter(t=>t.side===sd).sort((x,y)=>y.how-x.how); L.slice(1).forEach(t=>{ t.side=''; t.how=''; }); });
    const free=['home','away'].filter(sd=>!teams.some(t=>t.side===sd)), un=teams.filter(t=>!t.side);
    if(free.length===1&&un.length===1) un[0].guess=free[0];
    teams.forEach(t=>{ t.how=t.side?({4:'name',3:'Irish name',2:'name',1:'short name'}[t.how]||''):''; delete t.score; });
    return {teams, other, level:lv};
  }

  // ── resolving the players: the report's own lists, then the team sheet's numbers ──
  function cohReportResolve(P, o){
    o=o||{}; const picks=o.picks||{}, sides=o.sides||{}, sheets=o.sheets||{}, modes=o.modes||{};
    const lv=P.level||'county';
    return P.teams.map((t, ti)=>{
      const side=sides[ti]!=null&&sides[ti]!==''?sides[ti]:t.side;
      const R={ti, heading:t.heading, side, how:sides[ti]?'chosen':t.how, guess:t.guess, flags:t.flags.slice(), questions:[], lines:t.lines};
      const starters=t.starters.map(p=>({pos:p.pos, name:p.name, rep:p.name, score:p.score, notes:p.notes}));
      const fullIns=t.subs.map(s=>(!s.bad&&s.in.text&&!partial(s.in.text))?s.in.text:'');
      // the subs, in report order; a player going off is one of the 15 or a player who came on earlier
      const subs=t.subs.map(s=>Object.assign({}, s, {inName:'', outName:'', inSt:'', outSt:'', inCands:[], outCands:[], notes:[]}));
      const pickOf=k=>picks[ti+':'+k];
      subs.forEach((s, i)=>{
        if(s.bad) return;
        // coming on
        const poolIn=starters.map(p=>p.name).concat(subs.filter((x,j)=>j!==i&&x.inName&&x.inSt!=='ambiguous').map(x=>x.inName), fullIns.filter((n,j)=>j!==i&&n));
        const uniq=a=>{ const seen=new Set(); return a.filter(n=>{ const k=nkey(n); if(!k||seen.has(k)) return false; seen.add(k); return true; }); };
        if(s.in.text){ const ex=uniq(poolIn).filter(n=>nameMatch(s.in.text, n)==='exact');
          if(ex.length){ s.inName=ex[0]; s.inSt='ok'; }
          else if(!partial(s.in.text)){ s.inName=s.in.text; s.inSt='new'; }
          else { const c=uniq(poolIn).filter(n=>nameMatch(s.in.text, n)==='part'); s.inCands=c;
            if(c.length===1){ s.inName=c[0]; s.inSt='ok'; }
            else if(c.length>1){ const pk=pickOf(i+':in'); if(pk&&c.some(n=>n===pk)){ s.inName=pk; s.inSt='picked'; } else s.inSt='ambiguous'; }
            else { s.inName=s.in.text; s.inSt='unknown'; } } }
        // going off
        const poolOut=uniq(starters.map(p=>p.name).concat(subs.slice(0,i).filter(x=>x.inName&&x.inSt!=='ambiguous').map(x=>x.inName)));
        if(s.out.text){ const ex=poolOut.filter(n=>nameMatch(s.out.text, n)==='exact');
          if(ex.length){ s.outName=ex[0]; s.outSt='ok'; }
          else { const c=poolOut.filter(n=>nameMatch(s.out.text, n)==='part'); s.outCands=c;
            if(c.length===1){ s.outName=c[0]; s.outSt='ok'; }
            else if(c.length>1){ const pk=pickOf(i+':out'); if(pk&&c.some(n=>n===pk)){ s.outName=pk; s.outSt='picked'; } else s.outSt='ambiguous'; }
            else { s.outName=s.out.text; s.outSt='unknown'; } } }
      });
      // who is on the pitch at a minute (by this report): starters, the subs before it, blood returns before it
      const onAt=(key, upto)=>{ const on=new Set(starters.map(p=>nkey(p.name))), ev=[];
        subs.forEach((s,j)=>{ if(j===upto||s.bad||s.key==null||!s.inName||!s.outName||s.inSt==='ambiguous'||s.outSt==='ambiguous') return;
          ev.push({k:s.key, j, off:s.outName, on:s.inName});
          if(s.blood&&s.retOk){ const rk=minKey(s.ret, lv); if(rk!=null) ev.push({k:rk, j, off:s.inName, on:s.outName, back:true}); } });
        ev.filter(e=>key!=null&&e.k<key||key!=null&&e.k===key&&e.j<upto).sort((a,b)=>a.k-b.k||a.j-b.j).forEach(e=>{ on.delete(nkey(e.off)); on.add(nkey(e.on)); });
        return on; };
      const minTxt=s=>s.min==='HT'?'HT':s.min+"'";
      subs.forEach((s, i)=>{
        if(s.bad||s.key==null) return;
        const on=onAt(s.key, i);
        const note=(n, which)=>{ const k=nkey(n), came=subs.some((x,j)=>j!==i&&x.inName&&nkey(x.inName)===k&&x.key!=null&&x.key<s.key), st=starters.some(p=>nkey(p.name)===k);
          if(on.has(k)) return which==='in'?'already on the pitch at '+minTxt(s):'on the pitch at '+minTxt(s);
          return (which==='in'?'':'not on the pitch at '+minTxt(s)+' · ')+(st?'started, went off earlier':came?'came on earlier, off again by '+minTxt(s):'on the bench at '+minTxt(s)); };
        s.inNotes=s.inCands.map(n=>note(n,'in')); s.outNotes=s.outCands.map(n=>note(n,'out'));
        if(s.outName&&s.outSt!=='ambiguous'&&s.outSt!=='unknown'&&!on.has(nkey(s.outName))) s.notes.push(s.outName+' is not on the pitch at '+minTxt(s)+' by this report');
        if(s.inName&&s.inSt!=='ambiguous'&&on.has(nkey(s.inName))) s.notes.push(s.inName+' is already on the pitch at '+minTxt(s)+' by this report');
      });
      subs.forEach((s,i)=>{
        if(s.inSt==='ambiguous') R.questions.push({key:ti+':'+i+':in', text:'Which '+s.in.text+' came on ('+minTxt(s)+')?', cands:s.inCands});
        if(s.outSt==='ambiguous') R.questions.push({key:ti+':'+i+':out', text:'Which '+s.out.text+' went off ('+minTxt(s)+')?', cands:s.outCands}); });
      // the team sheet: numbers only from it
      const sheetRows=(side&&Array.isArray(sheets[side])?sheets[side]:[]).filter(r=>r&&tidy(r.name)).map(r=>Object.assign({}, r, {no:r.no==null?'':String(r.no)}));
      R.sheetRows=sheetRows; R.hasSheet=sheetRows.length>0;
      R.mode=R.hasSheet?(modes[ti]||''):'update';
      const used=new Map();
      // a player not on the sheet: the spelling the team's earlier games use (o.known — accents / fadas, case,
      // apostrophes ignored), so an OCR'd "Sean" becomes the known "Seán"; else as the report has it
      const knownL=(o.known&&side&&Array.isArray(o.known[side]))?o.known[side]:[];
      const spell=name=>{ const k=nkey(name), hit=knownL.find(n=>nkey(n)===k); return hit?tidy(hit):name; };
      const none=(name, x)=>Object.assign({sheet:'none', no:'', name:spell(name), cands:[]}, x||{});
      const toSheet=name=>{
        if(!R.hasSheet) return none(name);
        const k=nkey(name), pk=picks['sheet:'+ti+':'+k];
        const ex=sheetRows.filter(r=>nameMatch(name, r.name)==='exact');
        let c=ex.length?ex:sheetRows.filter(r=>nameMatch(name, r.name)==='part'||nameMatch(r.name, name)==='part');
        if(pk!=null){ if(pk==='') return none(name, {cands:c, picked:true}); const r=sheetRows.find(x=>x.name===pk); if(r) return {sheet:'match', no:r.no, name:r.name, row:r, cands:c, picked:true}; }
        if(c.length===1) return {sheet:'match', no:c[0].no, name:c[0].name, row:c[0], cands:c};
        if(c.length>1){ R.questions.push({key:'sheet:'+ti+':'+k, text:'Which player on the team sheet is “'+name+'”?', cands:c.map(r=>r.name), sheet:true}); return {sheet:'ask', no:'', name, cands:c}; }
        return none(name);
      };
      R.starters=starters.map(p=>Object.assign(p, toSheet(p.name)));
      const subMap=new Map();
      subs.forEach(s=>{ ['in','out'].forEach(w=>{ const n=s[w+'Name'], st=s[w+'St']; if(!n||st==='ambiguous') return; const k=nkey(n);
        if(!subMap.has(k)){ const st0=R.starters.find(p=>nkey(p.rep)===k); subMap.set(k, st0?{sheet:st0.sheet, no:st0.no, name:st0.name, row:st0.row}:toSheet(n)); }
        const m=subMap.get(k); s[w+'Sheet']=m; }); });
      R.subs=subs;
      // the players who came on and are not among the 15: the sheet's subs
      R.subsOn=[]; const seen=new Set(R.starters.map(p=>nkey(p.rep)));
      subs.forEach(s=>{ if(!s.inName||s.inSt==='ambiguous') return; const k=nkey(s.inName); if(seen.has(k)) return; seen.add(k); R.subsOn.push(Object.assign({rep:s.inName}, s.inSheet||{name:s.inName, no:'', sheet:'none'})); });
      R.notOnSheet=R.hasSheet?R.starters.concat(R.subsOn).filter(p=>p.sheet==='none').map(p=>p.name):[];
      if(R.hasSheet&&!R.mode) R.questions.push({key:'mode:'+ti, text:'The team sheet already has players: use the report’s 15 and subs, or only add the missing players?', mode:true});
      if(!side) R.questions.unshift({key:'side:'+ti, text:'Which team is “'+t.heading+'”?', side:true});
      return R;
    });
  }

  // ── what Apply writes ──────────────────────────────────────────
  function cohReportPlan(RR){
    const out={sheets:{}, subs:{}, blocking:[], notes:[]};
    const sideCount={home:0, away:0}; RR.forEach(R=>{ if(R.side) sideCount[R.side]++; });
    RR.forEach(R=>{
      R.questions.forEach(q=>out.blocking.push(q.text));
      if(!R.side) return;
      if(sideCount[R.side]>1){ out.blocking.push('Two lists are set to the same team ('+R.side+')'); return; }
      if(R.questions.length) return;
      const k=n=>nkey(n), extraOf=r=>{ const e=Object.assign({}, r.extra||{}); delete e.pos; return e; };
      let rows;
      const posOf=new Map(R.starters.filter(p=>p.sheet==='match').map(p=>[p.row, p.pos])), subOf=new Set(R.subsOn.filter(p=>p.sheet==='match').map(p=>p.row));
      if(R.mode==='add') rows=R.sheetRows.map(r=>({no:r.no, name:r.name, role:r.role, extra:r.extra}));
      else rows=R.sheetRows.map(r=>{ const e=extraOf(r);
        if(posOf.has(r)){ e.pos=posOf.get(r); return {no:r.no, name:r.name, role:'start', extra:e}; }
        if(subOf.has(r)) return {no:r.no, name:r.name, role:'sub', extra:e};
        return {no:r.no, name:r.name, role:r.role==='start'?'sub':r.role, extra:e}; });
      const have=new Set(rows.map(r=>k(r.name)));
      R.starters.forEach(p=>{ if(p.sheet==='match'||have.has(k(p.name))) return; have.add(k(p.name)); rows.push({no:'', name:p.name, role:'start', extra:{pos:p.pos}}); });
      R.subsOn.forEach(p=>{ if(p.sheet==='match'||have.has(k(p.name))) return; have.add(k(p.name)); rows.push({no:'', name:p.name, role:'sub', extra:{}}); });
      out.sheets[R.side]=rows.map(r=>{ const x={no:r.no==null?'':String(r.no), name:r.name, role:r.role||''}; if(r.extra&&Object.keys(r.extra).length) x.extra=r.extra; return x; });
      out.subs[R.side]=R.subs.filter(s=>!s.bad).map(s=>({min:s.min||'', out:(s.outSheet&&s.outSheet.name)||s.outName||s.out.text, in:(s.inSheet&&s.inSheet.name)||s.inName||s.in.text, blood:!!s.blood, ret:s.blood?(s.ret||''):''}));
    });
    return out;
  }

  const api={cohReportParse, cohReportResolve, cohReportPlan, cohReportScore, cohReportNameMatch:nameMatch, cohReportTeamScore, cohReportScoreText:scoreTxt, cohReportKey:nkey};
  Object.assign(root, api);
  if(typeof module!=='undefined'&&module.exports) module.exports=api;

  /* ═══════════════════════════════ UI ═══════════════════════════════
   * cohReportOpen(ctx) — ctx = {
   *   game,                         the game's meta (homeTeam, awayTeam, rosters, colours …)
   *   level:'county'|'club', known:{home:[names], away:[names]} | side→[names]   each team's known spellings (earlier games)
   *   starts()→ cohSubsStarts result     the period starts the Subs panel uses
   *   fmt(t)→'58:02', seek(t)       video time text / go there
   *   reader()→Promise<cohTSReader>  the on-device reader (cohTS._reader)
   *   save(sheets)→Promise           writes the team sheets (the editor's save path)
   *   subs({home:[…], away:[…]})     puts the subs into the Subs panel's typed list and opens it
   * } → {el, close, state}
   */
  if(typeof document==='undefined') return;
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const CSS=`
.cohrp-card{max-width:1080px;}
.cohrp-card .cohts-foot{bottom:-24px;padding-bottom:26px;}   /* the overlay's 24px padding: nothing shows under the sticky footer */
.cohrp-card textarea{min-height:120px;height:150px;resize:vertical;font:500 12.5px Barlow,sans-serif;line-height:1.45;}
.cohrp-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px;}
.cohrp-col{min-width:0;border:1px solid var(--border,#333);border-radius:10px;padding:10px;border-top:3px solid var(--tc,var(--border,#333));}
.cohrp-p,.cohrp-s{font-size:12.5px;line-height:1.4;padding:3px 0;border-bottom:1px solid var(--border,#333);}
.cohrp-p{display:grid;grid-template-columns:30px 22px minmax(0,1fr);gap:6px;align-items:baseline;}
.cohrp-p b{text-align:right;font-variant-numeric:tabular-nums;}
.cohrp-p b.unk{color:var(--t3,#777);font-weight:600;}
.cohrp-p i{font-style:normal;font-size:10px;color:var(--t3,#777);text-align:right;}
.cohrp-sc{font-size:10.5px;color:var(--t3,#888);margin-left:5px;white-space:nowrap;}
.cohrp-fl{display:block;font-size:10.5px;color:var(--orange,#f59e0b);}
.cohrp-ok{display:block;font-size:10.5px;color:var(--t3,#888);}
.cohrp-err{display:block;font-size:11px;color:#ef4444;}
.cohrp-q{background:rgba(245,158,11,.12);border:1px solid var(--orange,#f59e0b);border-radius:7px;padding:6px 8px;margin:6px 0;font-size:12px;}
.cohrp-q select{margin-top:4px;}
.cohrp-q label{display:block;margin-top:3px;cursor:pointer;}
.cohrp-q label input{width:auto;margin-right:6px;accent-color:var(--accent,#4fc3f7);}
.cohrp-tm{font-family:'DM Mono',monospace;font-size:11px;color:var(--t2,#aaa);}
.cohrp-go{color:var(--accent,#4fc3f7);font-weight:700;cursor:pointer;}
.cohrp-blood{display:inline-block;font:700 9.5px 'Barlow Condensed',sans-serif;letter-spacing:.6px;text-transform:uppercase;border:1px dashed #ef4444;color:#ef4444;border-radius:4px;padding:0 4px;margin-right:4px;}
.cohrp-info{font-size:11.5px;color:var(--t2,#999);margin:4px 0;line-height:1.45;}
.cohrp-warn{font-size:11.5px;color:var(--orange,#f59e0b);margin:4px 0;line-height:1.45;}
.cohrp-other{margin-top:10px;font-size:11px;color:var(--t3,#777);}
@media(max-width:720px){ .cohrp-cols{grid-template-columns:1fr;} .cohrp-card .cohts-foot{bottom:-8px;padding-bottom:10px;} }
`;
  function css(){ if(document.getElementById('cohrp-css')) return; const s=document.createElement('style'); s.id='cohrp-css'; s.textContent=CSS; document.head.appendChild(s); }
  const PNAME={'1H':'1st half','2H':'2nd half','ET1':'Extra-time 1st half','ET2':'Extra-time 2nd half'};

  function cohReportOpen(ctx){
    ctx=ctx||{}; if(root.cohTS&&root.cohTS._css) root.cohTS._css(); css();
    const G=ctx.game||{}, lv=ctx.level==='club'?'club':'county', fmt=ctx.fmt||(t=>String(Math.round(t)));
    const S={text:'', P:null, R:null, plan:null, picks:{}, sides:{}, modes:{}, busy:false, status:'', err:false};
    root.cohReportState=S;
    const teamName=sd=>String((sd==='home'?G.homeTeam:G.awayTeam)||sd);
    const sheetOf=sd=>(root.cohTS&&root.cohTS.sheet)?root.cohTS.sheet(G, sd):[];
    const ov=document.createElement('div'); ov.className='cohts-ov'; ov.id='cohReport';
    const card=document.createElement('div'); card.className='cohts-card cohrp-card'; ov.appendChild(card);
    card.innerHTML=`<div class="cohts-h">Match report — ${esc(teamName('home'))} v ${esc(teamName('away'))}</div>
      <div class="cohts-sub">Paste the report's team lists (“Dublin: Evan Comerford; … Subs: Ross McGarry for Costello 49, …”) or read them from a screenshot. Check the preview, answer any questions, then Apply: both team sheets are saved and the subs go into the Subs panel to check against the video. Nothing is saved before Apply. Jersey numbers come only from this game's team sheet — never from the report's order.</div>
      <textarea id="cohrpText" placeholder="Dublin: Evan Comerford; Seán MacMahon, Eoin Kennedy (0-01), David Byrne; …&#10;Subs: Ross McGarry for Costello 49, …&#10;&#10;Galway: Conor Gleeson; …&#10;Subs: …" spellcheck="false"></textarea>
      <div class="cohts-bar"><label class="cohts-btn cohts-file" title="Read on this device — the picture is not uploaded">📷 Read from screenshot<input type="file" accept="image/*,application/pdf" id="cohrpFile" aria-label="Read the report from a screenshot or PDF"></label><span class="cohts-soon" id="cohrpRd">Read on this device — the picture is not uploaded (the reader is fetched from jsDelivr the first time).</span></div>
      <div id="cohrpPrev"></div>
      <div class="cohts-foot"><div class="cohts-status" id="cohrpStatus"></div><button class="cohts-btn" data-act="cancel">Cancel</button><button class="cohts-btn pri" data-act="apply" disabled>Apply</button></div>`;
    const $=id=>card.querySelector('#'+id);
    const status=(m, e)=>{ S.status=m||''; S.err=!!e; const el=$('cohrpStatus'); el.textContent=S.status; el.classList.toggle('err', S.err); };

    function compute(){
      S.P=S.text.trim()?cohReportParse(S.text, {home:G.homeTeam, away:G.awayTeam, level:lv}):null;
      if(!S.P){ S.R=null; S.plan=null; return; }
      S.R=cohReportResolve(S.P, {picks:S.picks, sides:S.sides, modes:S.modes, known:typeof ctx.known==='function'?{home:ctx.known('home'), away:ctx.known('away')}:(ctx.known||{}), sheets:{home:sheetOf('home'), away:sheetOf('away')}});
      S.plan=cohReportPlan(S.R);
    }
    function timeHtml(s, st){
      if(!s.min) return '<span class="cohrp-err">⚠ no minute</span>';
      if(!s.minOk) return '<span class="cohrp-err">⚠ '+esc(s.min)+': '+esc(s.minErr)+'</span>';
      const v=SUBS.cohSubsToVideo?SUBS.cohSubsToVideo(s.p, st):{ok:false, error:''};
      const lab=s.p.ht?'HT':esc(s.p.label);
      if(!v.ok){ const per=s.p.ht?'2H':s.p.period, src=st&&st[{'1H':'h1','2H':'h2','ET1':'e1','ET2':'e2'}[per]];
        return lab+' → <span class="cohrp-tm">'+esc(s.p.ht?'2H 00:00':SUBS.cohSubsClock(s.p.period, s.p.secs))+'</span><span class="cohrp-err">⚠ '+esc(PNAME[per])+' start not set'+(src&&src.src==='events'?' (only guessed from the first event)':'')+' — tag the '+esc(PNAME[per])+' throw-in or set it in game setup. Not placed on the video yet.</span>'; }
      return lab+' → <span class="cohrp-tm">'+esc(v.clock)+'</span> · <span class="cohrp-go" data-seek="'+v.t+'" title="Go to this moment in the video">▶ video '+esc(fmt(v.t))+'</span>'+(v.note?' <span class="cohrp-ok">'+esc(v.note)+'</span>':'');
    }
    function retHtml(s, st){
      if(!s.blood) return '';
      if(!s.ret) return '<span class="cohrp-fl">🩸 blood sub — the report gives no return minute</span>';
      if(!s.retOk) return '<span class="cohrp-err">⚠ return “'+esc(s.ret)+'” is not a minute</span>';
      const v=SUBS.cohSubsToVideo?SUBS.cohSubsToVideo(s.retP, st):{ok:false};
      return '<span class="cohrp-ok">🩸 back on '+esc(s.retP.label)+' → '+esc(SUBS.cohSubsClock(s.retP.period, s.retP.secs))+(v.ok?' · <span class="cohrp-go" data-seek="'+v.t+'">▶ '+esc(fmt(v.t))+'</span>':'')+'</span>';
    }
    const noHtml=p=>p.no!==''&&p.no!=null?'<b>#'+esc(p.no)+'</b>':'<b class="unk" title="Number unknown">#–</b>';
    function nameSel(q, s, which){
      const cands=which==='in'?s.inCands:s.outCands, notes=(which==='in'?s.inNotes:s.outNotes)||[], cur=S.picks[q]||'';
      return '<div class="cohrp-q">'+esc(which==='in'?'Which '+s.in.text+' came on?':'Which '+s.out.text+' went off?')+'<select data-pick="'+esc(q)+'"><option value="">— choose —</option>'+cands.map((n,i)=>'<option value="'+esc(n)+'"'+(cur===n?' selected':'')+'>'+esc(n)+(notes[i]?' — '+esc(notes[i]):'')+'</option>').join('')+'</select></div>';
    }
    function sheetFlag(R, p){
      const sp=p.sheet==='none'&&p.rep&&p.name!==p.rep?'<span class="cohrp-ok">spelling from earlier games — report “'+esc(p.rep)+'”</span>':'';
      if(!R.hasSheet) return sp;
      if(p.sheet==='none') return '<span class="cohrp-fl">not on the team sheet — number unknown</span>'+sp;
      if(p.sheet==='ask'){ const q='sheet:'+R.ti+':'+nkey(p.rep||p.name), cur=S.picks[q];
        return '<div class="cohrp-q">Which player on the team sheet is “'+esc(p.rep||p.name)+'”?<select data-pick="'+esc(q)+'"><option value=""'+(cur==null?' selected':'')+' disabled>— choose —</option>'+p.cands.map(r=>'<option value="'+esc(r.name)+'"'+(cur===r.name?' selected':'')+'>#'+esc(r.no||'–')+' '+esc(r.name)+'</option>').join('')+'<option value="__none"'+(cur===''?' selected':'')+'>not on the sheet (no number)</option></select></div>'; }
      if(p.name!==p.rep) return '<span class="cohrp-ok">sheet spelling — report “'+esc(p.rep)+'”</span>';
      return '';
    }
    function colHtml(R, st){
      const sd=R.side, col=sd?((sd==='home'?G.homeColor:G.awayColor)||''):'', ink=col&&root.cohTeamInk?root.cohTeamInk(col):col;
      let h='<div class="cohrp-col" data-ti="'+R.ti+'" style="--tc:'+esc(ink||'var(--border,#333)')+'"><div class="cohts-team"><span>'+esc(sd?teamName(sd):R.heading)+'</span><small>from “'+esc(R.heading)+':”'+(R.how&&sd?' · '+esc(R.how):'')+'</small></div>';
      if(!sd||S.sides[R.ti]) h+='<div class="cohrp-q">Which team is “'+esc(R.heading)+'”?<select data-side="'+R.ti+'"><option value="">— choose —</option><option value="home"'+(sd==='home'?' selected':'')+'>'+esc(teamName('home'))+'</option><option value="away"'+(sd==='away'?' selected':'')+'>'+esc(teamName('away'))+'</option></select>'+(R.guess&&!sd?'<div class="cohrp-ok">(the other list is '+esc(teamName(R.guess==='home'?'away':'home'))+')</div>':'')+'</div>';
      if(sd){
        if(!R.hasSheet) h+='<div class="cohrp-warn">No team sheet — add the programme sheet (👕 Team sheets → 📷 Read from photo) to get numbers. Names, starters / subs, positions and the subs list are still applied; numbers stay blank.</div>';
        else { const n=R.sheetRows.length, m=R.mode;
          h+='<div class="'+(m?'cohrp-info':'cohrp-q')+'">The team sheet has '+n+' player'+(n===1?'':'s')+'. Numbers are taken from it.'
            +'<label><input type="radio" name="cohrpMode'+R.ti+'" data-mode="'+R.ti+'" value="update"'+(m==='update'?' checked':'')+'>Use the report’s 15 and subs — starters / subs set from the report (sheet players not in the 15 become subs; every number stays)</label>'
            +'<label><input type="radio" name="cohrpMode'+R.ti+'" data-mode="'+R.ti+'" value="add"'+(m==='add'?' checked':'')+'>Only add the missing players (the sheet’s rows are left as they are)</label></div>';
          if(R.notOnSheet.length) h+='<div class="cohrp-warn">Not on the team sheet (added with no number): '+R.notOnSheet.map(esc).join(', ')+'</div>'; }
      }
      R.flags.forEach(f=>{ h+='<div class="cohrp-warn">⚠ '+esc(f)+'</div>'; });
      h+='<div class="cohts-lbl" style="margin-top:8px">Starting 15 <span style="text-transform:none;letter-spacing:0;font-weight:500">· position in the report · number from the sheet</span></div>';
      R.starters.forEach(p=>{ h+='<div class="cohrp-p">'+noHtml(p)+'<i title="Position in the report">'+p.pos+'</i><span>'+esc(p.name)+(p.score?'<span class="cohrp-sc">'+esc(scoreTxt(p.score))+'</span>':'')+sheetFlag(R, p)+'</span></div>'; });
      h+='<div class="cohts-lbl" style="margin-top:10px">Subs ('+R.subs.length+')</div>';
      if(!R.subs.length) h+='<div class="cohrp-info">No “Subs:” line for this team.</div>';
      R.subs.forEach((s,i)=>{
        h+='<div class="cohrp-s">';
        if(s.bad){ h+='<span class="cohrp-err">⚠ “'+esc(s.raw)+'” — '+esc(s.flags.join(' · '))+'</span></div>'; return; }
        const pn=(nm, sh)=>(sh&&sh.no?'#'+sh.no+' ':'')+((sh&&sh.name)||nm);
        h+=(s.blood?'<span class="cohrp-blood">blood</span>':'')+'<b>'+esc(s.inSt==='ambiguous'?s.in.text+' ?':pn(s.inName, s.inSheet))+'</b>'+(s.in.score?'<span class="cohrp-sc">'+esc(scoreTxt(s.in.score))+'</span>':'')
          +' for <b>'+esc(s.outSt==='ambiguous'?s.out.text+' ?':pn(s.outName, s.outSheet))+'</b><br>'+timeHtml(s, st)+retHtml(s, st);
        if(s.inSt==='ambiguous') h+=nameSel(R.ti+':'+i+':in', s, 'in');
        if(s.outSt==='ambiguous') h+=nameSel(R.ti+':'+i+':out', s, 'out');
        if(s.inSt==='unknown') h+='<span class="cohrp-fl">“'+esc(s.in.text)+'” — only a surname, and no player of that name in this list: kept as written</span>';
        if(s.outSt==='unknown') h+='<span class="cohrp-fl">“'+esc(s.out.text)+'” is not among the 15 or the players who came on before — kept as written</span>';
        if(s.inSt==='picked'||s.outSt==='picked') h+='<span class="cohrp-ok">chosen by you</span>';
        if(R.hasSheet){ if(s.inSheet&&s.inSheet.sheet==='none'&&s.inSt!=='ambiguous'&&!R.starters.some(p=>p.rep===s.inName)) h+='<span class="cohrp-fl">'+esc(s.inName)+': not on the team sheet — number unknown</span>';
          if(s.inSheet&&s.inSheet.sheet==='ask'&&!R.starters.some(p=>p.rep===s.inName)) h+=sheetFlag(R, Object.assign({rep:s.inName}, s.inSheet)); }
        s.notes.forEach(n=>{ h+='<span class="cohrp-fl">'+esc(n)+'</span>'; });
        s.flags.forEach(n=>{ h+='<span class="cohrp-fl">'+esc(n)+'</span>'; });
        h+='</div>'; });
      return h+'</div>';
    }
    function render(){
      const host=$('cohrpPrev'), ap=card.querySelector('[data-act=apply]');
      if(!S.P){ host.innerHTML=''; ap.disabled=true; if(!S.busy) status(''); return; }
      if(!S.R.length){ host.innerHTML='<div class="cohrp-warn">No team list found. A list starts with the team name and a colon (“Dublin: Evan Comerford; …”).</div>'; ap.disabled=true; return; }
      let st=null; try{ st=ctx.starts?ctx.starts():null; }catch(_){}
      const order=S.R.slice().sort((a,b)=>(a.side==='away'?1:a.side==='home'?0:2)-(b.side==='away'?1:b.side==='home'?0:2));
      const sc=host.scrollTop;
      host.innerHTML='<div class="cohrp-cols">'+order.map(R=>colHtml(R, st)).join('')+'</div>'
        +(S.P.other.length?'<div class="cohrp-other">Not used: '+S.P.other.map(o=>esc((o.heading?o.heading+': ':'')+o.text.slice(0,60))+(o.text.length>60?'…':'')).join(' · ')+'</div>':'');
      host.scrollTop=sc;
      const B=S.plan.blocking, sides=Object.keys(S.plan.sheets);
      ap.disabled=!!B.length||!sides.length;
      if(!S.busy) status(B.length?(B.length+' question'+(B.length===1?'':'s')+' to answer before Apply: '+B[0]+(B.length>1?' …':'')):(sides.length<2?'Only one team found — Apply writes '+sides.map(teamName).join('')+' only.':'Ready — Apply saves both team sheets and fills the Subs panel.'));
    }
    let tmr=null;
    card.addEventListener('input', ev=>{ if(ev.target.id!=='cohrpText') return; S.text=ev.target.value; clearTimeout(tmr); tmr=setTimeout(()=>{ compute(); render(); }, 200); });
    card.addEventListener('change', ev=>{ const t=ev.target;
      if(t.id==='cohrpFile'){ const f=t.files&&t.files[0]; t.value=''; if(f) readShot(f); return; }
      if(t.dataset.side!=null){ S.sides[t.dataset.side]=t.value; }
      else if(t.dataset.mode!=null){ S.modes[t.dataset.mode]=t.value; }
      else if(t.dataset.pick){ const v=t.value; if(/^sheet:/.test(t.dataset.pick)) S.picks[t.dataset.pick]=v==='__none'?'':v; else if(v) S.picks[t.dataset.pick]=v; else delete S.picks[t.dataset.pick]; }
      else return;
      compute(); render(); });
    card.addEventListener('click', ev=>{ const sk=ev.target.closest('[data-seek]'); if(sk){ try{ ctx.seek&&ctx.seek(+sk.dataset.seek); }catch(_){} return; }
      const b=ev.target.closest('[data-act]'); if(!b||b.disabled) return;
      if(b.dataset.act==='cancel') close(); else if(b.dataset.act==='apply') apply(b); });
    ov.addEventListener('keydown', ev=>{ ev.stopPropagation(); if(ev.key==='Escape'){ close(); } });
    async function readShot(file){
      const rd=$('cohrpRd'); S.busy=true; status('Reading the picture on this device…');
      try{
        const R=await (ctx.reader?ctx.reader():Promise.reject(new Error('The reader is not available here.')));
        if(!R.readText) throw new Error('This reader cannot read plain text.');
        const res=await R.readText(file, {onProgress:p=>{ if(rd) rd.textContent=(p.stage==='load'?'Loading the reader… ':'Reading… ')+Math.round((p.pct||0)*100)+'%'; }});
        const ta=$('cohrpText'); ta.value=(ta.value.trim()?ta.value.trim()+'\n\n':'')+res.text; S.text=ta.value;
        if(rd) rd.textContent='Read from “'+(res.source&&res.source.name||'the picture')+'” ('+((res.source&&res.source.engine)||'')+(res.confidence!=null?', '+Math.round(res.confidence)+'% sure':'')+') — check the text above: a misread letter can change a name.';
        S.busy=false; compute(); render();
      }catch(e){ S.busy=false; status((e&&e.message)||String(e), true); if(rd) rd.textContent='Could not read it — paste the text instead.'; }
    }
    async function apply(btn){
      compute(); const plan=S.plan; if(plan.blocking.length){ render(); return; }
      btn.disabled=true; S.busy=true; status('Saving the team sheets…');
      try{
        const sheets={}; Object.keys(plan.sheets).forEach(sd=>{ sheets[sd]=plan.sheets[sd]; });
        if(ctx.save) await ctx.save(sheets);
        const n=(plan.subs.home||[]).length+(plan.subs.away||[]).length;
        close();
        if(ctx.subs) ctx.subs(plan.subs, {n});
      }catch(e){ S.busy=false; btn.disabled=false; status((e&&e.message)||String(e), true); }
    }
    function close(){ clearTimeout(tmr); if(ov.parentNode) ov.parentNode.removeChild(ov); if(root.cohReportState===S) root.cohReportState=null; if(ctx.onClose) ctx.onClose(); }
    document.body.appendChild(ov);
    if(ctx.text){ $('cohrpText').value=ctx.text; S.text=ctx.text; compute(); }
    render();
    setTimeout(()=>{ try{ $('cohrpText').focus(); }catch(_){} }, 0);
    return {el:ov, close, state:S, render:()=>{ compute(); render(); }};
  }
  root.cohReportOpen=cohReportOpen;
})(typeof window!=='undefined'?window:globalThis);
