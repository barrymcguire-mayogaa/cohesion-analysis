/* COHESION — per-game team sheets (shared by library, dashboard, Code Room).
 *
 * STORE: the game's meta.rosters = { home:[…], away:[…] } — the SAME field
 * Code Room's "+ add to team sheet" has always written (plain name strings)
 * and that the pick lists and cohesion-gi.js already read. This file extends
 * an entry, backward-compatibly, to
 *     { no: 7 | null, name: 'Colm Reape', role: 'start' | 'sub' }
 * Old entries still load: a plain string ("Colm Reape", "7 Colm Reape",
 * "Colm Reape (7)") or an object with name|player and number|no|num|jersey|
 * shirt. An entry with no role recorded has role '' ("not set"). Unknown
 * properties of an old object entry ride along untouched.
 * meta.playerRoster (the admin's P-tag → name map) is a different thing and is
 * never read as a sheet or written here.
 *
 * WRITES: cohTSSave re-reads the game's meta, replaces only rosters[side] for
 * the sides that changed, and sends it through gameAdmin updateMeta (service
 * role, admin only) — the "Align this angle" pattern.
 *
 * Everything above the "UI" banner is pure (no DOM) and is what the tests run.
 */
(function(root){
  'use strict';

  // ── names ─────────────────────────────────────────────────────
  // trim, collapse spaces, straight apostrophes; capitalisation as typed
  function tidyName(s){
    return String(s==null?'':s).replace(/[‘’‛ʼ`´]/g,"'").replace(/\s+/g,' ').trim();
  }
  // comparison key: ignores case, spacing and apostrophe style
  function nameKey(s){ return tidyName(s).toLowerCase().replace(/\s+/g,''); }
  // The existing spelling of `name` among `known`, or ''. `known` may repeat a
  // name once per use: the spelling used most often wins (ties: the first).
  function matchKnown(name, known){
    const k=nameKey(name); if(!k) return '';
    const cnt=new Map();
    for(const n of (known||[])){ if(n!=null&&nameKey(n)===k){ const sp=String(n).replace(/\s+/g,' ').trim(); cnt.set(sp,(cnt.get(sp)||0)+1); } }
    let best='', bn=0; cnt.forEach((c,sp)=>{ if(c>bn){ best=sp; bn=c; } });
    return best;
  }
  function cleanNo(v){
    if(v==null||v==='') return '';
    const m=/^\s*#?\s*(\d{1,3})\s*$/.exec(String(v));
    return m?String(+m[1]):'';
  }
  function cleanRole(r){ r=String(r==null?'':r).toLowerCase(); return r==='start'||r==='starter'?'start':r==='sub'||r==='substitute'?'sub':''; }

  // "7 Name" · "#7 Name" · "7. Name" · "7 - Name" · "Name (7)" · "Name #7" → {no,name}
  function splitNumberName(s){
    s=String(s==null?'':s).replace(/\s+/g,' ').trim();
    let m=/^#?\s*(\d{1,3})\s*(?:[.\-–—:)]+\s*|\s+)(\S.*)$/.exec(s);
    if(m) return {no:String(+m[1]), name:m[2].trim()};
    m=/^(\S.*?)\s*[(\[]\s*#?\s*(\d{1,3})\s*[)\]]$/.exec(s);
    if(m) return {no:String(+m[2]), name:m[1].trim()};
    m=/^(\S.*?)\s+#\s*(\d{1,3})$/.exec(s);
    if(m) return {no:String(+m[2]), name:m[1].trim()};
    m=/^(\S.*?)\s*[\-–—]\s*(\d{1,3})$/.exec(s);
    if(m&&/[A-Za-zÀ-ɏ]/.test(m[1])) return {no:String(+m[2]), name:m[1].trim()};
    return {no:'', name:s};
  }

  // ── entries ───────────────────────────────────────────────────
  // Any stored entry (old or new shape) → {no:'7'|'', name, role:'start'|'sub'|'', extra?}
  // or null when it carries no name.
  const OWN_KEYS={no:1,name:1,role:1,number:1,num:1,jersey:1,shirt:1,player:1};
  function normEntry(r){
    if(r==null) return null;
    if(typeof r==='object'){
      const name=String(r.name!=null?r.name:(r.player!=null?r.player:'')).replace(/\s+/g,' ').trim();
      if(!name) return null;
      const n=r.no!=null?r.no:r.number!=null?r.number:r.num!=null?r.num:r.jersey!=null?r.jersey:r.shirt;
      const out={no:cleanNo(n), name, role:cleanRole(r.role)};
      let extra=null;
      Object.keys(r).forEach(k=>{ if(!OWN_KEYS[k]){ (extra=extra||{})[k]=r[k]; } });
      if(extra) out.extra=extra;
      return out;
    }
    const p=splitNumberName(r);
    return p.name?{no:p.no, name:p.name, role:''}:null;
  }
  // What is written back: {no:Number|null, name, role?} (+ any extra props).
  function toStored(row){
    const o=Object.assign({}, row.extra||{});
    const n=cleanNo(row.no);
    o.no=n===''?null:+n; o.name=tidyKeep(row.name);
    const role=cleanRole(row.role); if(role) o.role=role;
    return o;
  }
  function tidyKeep(s){ return String(s==null?'':s).replace(/\s+/g,' ').trim(); }

  function sideOf(game, team){
    const up=s=>String(s==null?'':s).toUpperCase().trim(), T=up(team);
    if(!game||!T) return '';
    return T===up(game.homeTeam)?'home':T===up(game.awayTeam)?'away':'';
  }
  // The sheet for a side, in stored order.
  function sheet(game, side){
    const list=game&&game.rosters&&!Array.isArray(game.rosters)&&game.rosters[side];
    return Array.isArray(list)?list.map(normEntry).filter(Boolean):[];
  }
  function hasSheet(game, side){
    if(side) return sheet(game, side).length>0;
    return sheet(game,'home').length>0||sheet(game,'away').length>0;
  }
  // starters (number order, blanks last), then subs, then role-not-set
  function sortRows(rows){
    const rk=r=>r.role==='start'?0:r.role==='sub'?1:2, nk=r=>r.no===''?1e6:+r.no;
    return (rows||[]).map((r,i)=>({r,i})).sort((a,b)=>rk(a.r)-rk(b.r)||nk(a.r)-nk(b.r)||a.i-b.i).map(x=>x.r);
  }
  // The role a display uses: recorded role, else by number (1–15 start, >15 sub), else ''.
  function shownRole(r){ return r.role||(r.no===''?'':(+r.no<=15?'start':'sub')); }
  function groups(game, side){
    const rows=sheet(game, side).map(r=>Object.assign({}, r, {role:shownRole(r)}));
    const s=sortRows(rows);
    return {start:s.filter(r=>r.role==='start'), sub:s.filter(r=>r.role==='sub'), other:s.filter(r=>!r.role)};
  }

  // ── jersey number limits (warnings only) ──────────────────────
  // The highest number a game's sheet should carry: inter-county league / championship 26; pre-season (FBD League,
  // O'Byrne Cup, McGrath Cup, McKenna Cup) 30; challenge games, friendlies and club games 40. The game's type is read
  // from its meta: section 'club' → club; section 'u20' → a U20 inter-county game (30); the competition (and round) text → challenge / friendly / pre-season /
  // club competition; teams that are not both counties (cohesion-periods.js cohGameLevel, when loaded) → club;
  // otherwise an inter-county game — league when the competition says league / NFL, else championship.
  function gameKind(meta){
    meta=meta||{};
    const comp=String(meta.competition||'').replace(/\s+/g,' ').trim(), c=(comp+' '+String(meta.round||'')).toLowerCase();
    const K=(kind, limit, label)=>({kind, limit, label});
    if(String(meta.section||'').toLowerCase()==='club') return K('club', 40, 'a club game');
    // U20s section: an inter-county U20 game — 30 (Barry, Oct 2026)
    if(String(meta.section||'').toLowerCase()==='u20') return K('u20', 30, 'a U20 inter-county game');
    if(/\bfriendl/.test(c)) return K('friendly', 40, 'a friendly');
    if(/\bchallenge\b/.test(c)) return K('challenge', 40, 'a challenge game');
    const pre=/\bfbd\b/.test(c)?'FBD League':/\bo[’'‘`]?\s*byrne\b/.test(c)?"O'Byrne Cup":/\bmc\s*grath\b/.test(c)?'McGrath Cup':/\bmc\s*kenna\b/.test(c)?'McKenna Cup':/\bpre[\s-]?season\b/.test(c)?'pre-season':'';
    if(pre) return K('preseason', 30, pre==='pre-season'?'a pre-season game':'a pre-season game ('+pre+')');
    if(/\bclub\b/.test(c)) return K('club', 40, 'a club game');
    if(String(meta.section||'').toLowerCase()!=='county'&&typeof root.cohGameLevel==='function'&&(meta.homeTeam||meta.awayTeam)&&root.cohGameLevel(meta)==='club') return K('club', 40, 'a club game');
    if(/\bleague\b|\bnfl\b|\bdiv(ision)?\s*\d/.test(c)) return K('league', 26, 'an inter-county league game');
    if(/championship|\b[sjim]fc\b|all[\s-]ireland|connacht|leinster|munster|ulster|tailteann|sam maguire/.test(c)) return K('championship', 26, 'an inter-county championship game');
    return K('county', 26, 'an inter-county game');
  }
  function numberLimit(meta){ return gameKind(meta).limit; }

  // ── validation: warnings only, nothing is blocked ─────────────
  // meta (optional) = the game: adds a warning for each number above the game's limit (gameKind)
  function validate(rows, meta){
    const w=[], nos=new Map(), names=new Map(); let starters=0;
    (rows||[]).forEach(r=>{
      const name=tidyKeep(r.name), no=cleanNo(r.no);
      if(!name) return;                      // a row without a name is not saved, so it cannot clash
      if(no!==''){ nos.set(no,(nos.get(no)||[]).concat(name)); }
      { const k=nameKey(name); names.set(k,(names.get(k)||[]).concat(name)); }
      if(cleanRole(r.role)==='start') starters++;
    });
    nos.forEach((l,no)=>{ if(l.length>1) w.push('Number '+no+' is used '+l.length+' times ('+l.join(', ')+').'); });
    names.forEach(l=>{ if(l.length>1) w.push('"'+l[0]+'" is listed '+l.length+' times.'); });
    if(starters>15) w.push(starters+' starters — a team starts 15.');
    if(meta){ const G=gameKind(meta);
      const over=[...nos.keys()].map(Number).filter(n=>n>G.limit).sort((a,b)=>a-b).map(n=>'#'+n);
      if(over.length) w.push((over.length===1?over[0]+' is':over.slice(0,-1).join(', ')+' and '+over[over.length-1]+' are')+' above '+G.limit+' for '+G.label+'.'); }
    return w;
  }

  // ── paste parser ──────────────────────────────────────────────
  // text → {rows:[{no,name,role,adopted?}], skipped:[line]}. opts.known = that
  // team's existing spellings; a row whose name matches one (ignoring case /
  // spacing / apostrophe style) adopts it and records what was typed in
  // row.adopted. A "Subs" heading, or a number above 15, switches the
  // following rows to subs; a "Starting" / "Team" heading switches back.
  const RE_SUBS=/^(?:subs?|substitutes?|substitutions?|replacements?|bench|fir\s+ionaid|ionadaithe)\b\s*[:\-–]?\s*/i;
  const RE_START=/^(?:starting(?:\s+(?:xv|15|team|line[\s-]?up))?|starters?|team|line[\s-]?up|first\s+15|xv)\s*[:\-–]?\s*$/i;
  function parsePaste(text, opts){
    opts=opts||{};
    const rows=[], skipped=[]; let role='start';
    const push=(no,name)=>{
      name=tidyName(name).replace(/^[\-–—.,;:]+\s*/,'').replace(/\s*[,;]+$/,'');
      no=cleanNo(no);
      if(!/[A-Za-zÀ-ɏ]/.test(name)){ return false; }
      if(no!==''&&+no>15) role='sub';
      const row={no, name, role};
      const hit=matchKnown(name, opts.known);
      if(hit){ if(tidyName(hit)!==name) row.adopted=name; row.name=hit; }   // flagged only when more than the apostrophe style changed
      rows.push(row); return true;
    };
    const cell=c=>{ const p=splitNumberName(c); return push(p.no, p.name); };
    String(text==null?'':text).replace(/\r\n?/g,'\n').split('\n').forEach(raw=>{
      let line=raw.replace(/ /g,' ').trim();
      if(!line) return;
      line=line.replace(/^[•·*]+\s*/,'');
      if(RE_START.test(line)){ role='start'; return; }
      const sm=RE_SUBS.exec(line);
      if(sm&&(sm[0].length===line.length||/[:\-–]\s*$/.test(sm[0])||/^[#\d]/.test(line.slice(sm[0].length)))){ role='sub'; line=line.slice(sm[0].length).trim(); if(!line) return; }
      let cells=line.split(/\t+|\s*[;,]\s*/).map(c=>c.trim()).filter(Boolean);
      const isNum=c=>/^#?\d{1,3}[.)]?$/.test(c);
      let any=false;
      if(cells.some(isNum)){
        // number and name in separate cells: "7<TAB>Name" (number first) or "Name<TAB>7"
        const numFirst=isNum(cells[0]), bare=c=>c.replace(/[.)]$/,'');
        for(let i=0;i<cells.length;i++){
          const c=cells[i], n=cells[i+1];
          if(isNum(c)){ if(numFirst&&n!=null&&!isNum(n)){ any=push(bare(c), n)||any; i++; } }   // a stray number is dropped
          else if(!numFirst&&n!=null&&isNum(n)){ any=push(bare(n), c)||any; i++; }
          else any=cell(c)||any;
        }
      } else cells.forEach(c=>{ any=cell(c)||any; });
      if(!any) skipped.push(raw.trim());
    });
    return {rows, skipped};
  }

  // ── meta merge: only rosters[side] of the sides given changes ──
  function mergeMeta(fresh, sheets){
    const m=Object.assign({}, fresh||{});
    const R=Object.assign({}, (m.rosters&&typeof m.rosters==='object'&&!Array.isArray(m.rosters))?m.rosters:{});
    ['home','away'].forEach(side=>{
      if(!sheets||!Array.isArray(sheets[side])) return;
      R[side]=sheets[side].filter(r=>r&&tidyKeep(r.name)).map(toStored);
    });
    m.rosters=R;
    return m;
  }

  // ── pick lists ────────────────────────────────────────────────
  // "7. Colm Reape" when the name is on that side's sheet with a number, else the name.
  function label(game, side, name){
    const k=nameKey(name); if(!k) return String(name==null?'':name);
    const sides=side?[side]:['home','away']; const hits=[];
    sides.forEach(sd=>sheet(game, sd).forEach(r=>{ if(r.no!==''&&nameKey(r.name)===k) hits.push(r.no); }));
    const u=[...new Set(hits)];
    return u.length===1?(u[0]+'. '+name):String(name);
  }
  // Sheet names for a side in display order (starters by number, then subs, then the rest).
  function orderedNames(game, side){
    const g=groups(game, side), seen=new Set(), out=[];
    g.start.concat(g.sub, g.other).forEach(r=>{ const k=nameKey(r.name); if(k&&!seen.has(k)){ seen.add(k); out.push(r.name); } });
    return out;
  }
  // names → the same names, sheet players first (sheet order), the rest as given.
  function sheetFirst(game, side, names){
    const order=new Map(); (side?[side]:['home','away']).forEach(sd=>orderedNames(game, sd).forEach(n=>{ const k=nameKey(n); if(!order.has(k)) order.set(k, order.size); }));
    const a=[], b=[];
    (names||[]).forEach(n=>{ (order.has(nameKey(n))?a:b).push(n); });
    a.sort((x,y)=>order.get(nameKey(x))-order.get(nameKey(y)));
    return a.concat(b);
  }

  // ── substitutions: "#18 ON for #13" → "#18 Name ON for #13 Name" ──
  // Display only. A number is named only when exactly one entry on THAT
  // team's sheet for this game carries it; any other number stays a number.
  function nameForNo(game, side, no){
    no=cleanNo(no); if(no===''||!side) return '';
    const hits=[...new Set(sheet(game, side).filter(r=>r.no===no).map(r=>r.name))];
    return hits.length===1?hits[0]:'';
  }
  function subDetail(game, team, detail){
    const s=String(detail==null?'':detail), side=sideOf(game, team);
    if(!side||!s) return s;
    return s.replace(/#\s*(\d{1,3})(?!\d)/g,(m,n)=>{ const nm=nameForNo(game, side, n); return nm?('#'+(+n)+' '+nm):m; });
  }
  // For an event row: the expanded text, or '' when nothing could be named.
  function subDetailFor(game, ev){
    const vals=(typeof cohLabelGet==='function'&&ev)?cohLabelGet(ev,'Sub Detail'):[ev&&ev.labels&&ev.labels['Sub Detail']].filter(Boolean);
    const raw=vals.join(' · '); if(!raw) return '';   // every value: a blood sub's "#18 ON for #13 · RETURNED 10:47"
    const out=subDetail(game, ev.team, raw);
    return out!==String(raw)?out:'';
  }

  // ── pitch layout (the Teams tab's Pitch view) ─────────────────
  // Starters are drawn BY POSITION, never by number (a starter can wear #23): the entry's pos (1–15, written by the
  // match-report paste, cohesion-report.js — kept in the entry's extra props) when it has one, else the order the
  // starters are on the sheet (the order they were entered). Lines, keeper first:
  //   GK 1 · full-backs 2–4 · half-backs 5–7 · midfield 8–9 · half-forwards 10–12 · full-forwards 13–15.
  // A pos taken twice: the second player is placed as if he had none. Starters past the 15 slots go with the subs.
  // → {lines:[[row…]×6, GK → full-forwards], bench:[row…], starters:n, byPos:n placed by pos, extra:[row…], notes:[…]}
  // Each placed row gets .pos (its slot) and .by ('pos' | 'order').
  const PITCH_LINES=[[1],[2,3,4],[5,6,7],[8,9],[10,11,12],[13,14,15]];
  function posOf(r){ const v=r&&r.extra&&r.extra.pos, n=(v==null||v==='')?NaN:+v; return Number.isInteger(n)&&n>=1&&n<=15?n:0; }
  function pitchLayout(game, side){
    const rows=sheet(game, side).map(r=>Object.assign({}, r, {role:shownRole(r)}));
    const st=rows.filter(r=>r.role==='start'), slot=[], rest=[], extra=[];
    st.forEach(r=>{ const p=posOf(r); if(p&&!slot[p]){ r.pos=p; r.by='pos'; slot[p]=r; } else rest.push(r); });
    let k=1;
    rest.forEach(r=>{ while(k<=15&&slot[k]) k++; if(k<=15){ r.pos=k; r.by='order'; slot[k]=r; } else extra.push(r); });
    const lines=PITCH_LINES.map(L=>L.map(p=>slot[p]).filter(Boolean));
    const subs=sortRows(rows.filter(r=>r.role==='sub')), other=rows.filter(r=>!r.role);
    const byPos=st.filter(r=>r.by==='pos').length, n=st.length, notes=[];
    if(n!==15) notes.push(n+' starter'+(n===1?'':'s')+' on the sheet — a team starts 15'+(n>15?'; the '+(n-15)+' after the first 15 are listed with the substitutes':'; the lines show the positions that are filled')+'.');
    if(n) notes.push(byPos===n?'Positions from the match report.':byPos?byPos+' position'+(byPos===1?'':'s')+' from the match report, the rest in sheet order.':'Positions in the order the starters are on the sheet.');
    return {lines, bench:subs.concat(other, extra), starters:n, byPos, extra, notes};
  }
  // A player's score in GAA format "G-P" (P = points value, a 2-pointer adds 2); '' when he did not score.
  function pitchScore(d){ const g=+(d&&d.g)||0, p=+(d&&d.pts)||0; return (g||p)?g+'-'+p:''; }

  // The one public hook for reading a team sheet from a photo or PDF:
  // cohTeamSheetFromFile(file, opts) → Promise<{home:{text,lines,confidence}, away:{…}, pages, source, …}>.
  // It is done in the browser by cohesion-teamsheet-reader.js (loaded on first use; the file is not uploaded).
  // A different reader could replace this one function. It never writes to a sheet.
  function fromFile(file, opts){
    if(!root.cohTS||typeof root.cohTS._reader!=='function') return Promise.reject(new Error('Reading a team sheet from a photo or PDF needs a browser.'));
    return root.cohTS._reader().then(R=>R.read(file, opts));
  }

  const API={ tidyName, nameKey, matchKnown, splitNumberName, normEntry, toStored, sideOf, sheet, hasSheet, sortRows, groups,
    validate, gameKind, numberLimit, posOf, pitchLayout, pitchScore, parsePaste, mergeMeta, label, orderedNames, sheetFirst, nameForNo, subDetail, subDetailFor, fromFile };
  root.cohTS=API;
  root.cohTeamSheetFromFile=fromFile;
  if(typeof module!=='undefined'&&module.exports) module.exports=API;
})(typeof window!=='undefined'?window:globalThis);

/* ══ UI (browser only): save, editor, dashboard panel, player picker ══ */
(function(){
  'use strict';
  if(typeof window==='undefined'||typeof document==='undefined') return;
  const T=window.cohTS;
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  // Re-read the game's meta, change only rosters[side] of the sides given, write
  // it back through gameAdmin updateMeta (admin only). → the merged meta.
  // io (optional) = {read, write} — defaults to cohesionRead / cohesionAuthFetch.
  T.save=async function(gameId, sheets, io){
    io=io||{};
    const read=io.read||window.cohesionRead, write=io.write||window.cohesionAuthFetch;
    if(!gameId) throw new Error('team sheet not saved — no game');
    let j;
    try{ j=await read({action:'gameBundle', id:gameId}); }
    catch(e){ throw new Error('team sheet not saved — could not re-read the game ('+e.message+')'); }
    let fresh=j&&j.meta; if(typeof fresh==='string'){ try{ fresh=JSON.parse(fresh); }catch(_){ fresh=null; } }
    if(!fresh||typeof fresh!=='object') throw new Error('team sheet not saved — could not read the game\'s current metadata');
    const merged=T.mergeMeta(fresh, sheets);
    try{ await write('gameAdmin', {action:'updateMeta', gameId, meta:merged}); }
    catch(e){ throw new Error('team sheet not saved ('+e.message+')'); }
    return merged;
  };

  let cssDone=false;
  function css(){
    if(cssDone) return; cssDone=true;
    const st=document.createElement('style'); st.id='cohts-css';
    st.textContent=`
.cohts-ov{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;z-index:10020;overflow-y:auto;padding:24px 8px;box-sizing:border-box;}
.cohts-card{background:var(--panel,#1e1e28);color:var(--t1,#eee);border:1px solid var(--border,#333);border-radius:14px;padding:18px;width:100%;max-width:940px;box-sizing:border-box;box-shadow:0 24px 64px rgba(0,0,0,.55);font-family:Barlow,sans-serif;text-align:left;}
.cohts-card *{box-sizing:border-box;}
.cohts-h{font:800 19px 'Barlow Condensed',sans-serif;letter-spacing:.5px;}
.cohts-sub{font-size:12px;color:var(--t2,#999);margin:2px 0 14px;line-height:1.5;}
.cohts-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.cohts-col{min-width:0;border:1px solid var(--border,#333);border-radius:10px;padding:12px;background:var(--bg,transparent);}
.cohts-team{display:flex;align-items:baseline;gap:8px;font:800 15px 'Barlow Condensed',sans-serif;letter-spacing:.6px;text-transform:uppercase;margin-bottom:8px;}
.cohts-team i{width:10px;height:10px;border-radius:50%;flex-shrink:0;align-self:center;}
.cohts-team span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cohts-team small{font:600 11px Barlow,sans-serif;color:var(--t3,#777);text-transform:none;letter-spacing:0;white-space:nowrap;}
.cohts-hd,.cohts-row{display:grid;grid-template-columns:46px minmax(0,1fr) 86px 28px;gap:6px;align-items:center;margin-bottom:5px;position:relative;}
.cohts-hd{font:700 9.5px 'Barlow Condensed',sans-serif;letter-spacing:.6px;text-transform:uppercase;color:var(--t3,#777);margin-bottom:3px;}
.cohts-card input,.cohts-card select,.cohts-card textarea{width:100%;background:var(--card,#252530);border:1px solid var(--border,#333);border-radius:7px;padding:7px 8px;color:var(--t1,#eee);font:600 13px Barlow,sans-serif;outline:none;min-width:0;}
.cohts-card input:focus,.cohts-card select:focus,.cohts-card textarea:focus{border-color:var(--accent,#4fc3f7);}
.cohts-row input.no{text-align:center;padding:7px 2px;}
.cohts-row select{padding:7px 4px;}
.cohts-x{border:none;background:none;color:var(--t3,#777);font-size:14px;cursor:pointer;padding:4px 0;border-radius:6px;}
.cohts-x:hover{color:#ef4444;}
.cohts-adopt{grid-column:2/5;font-size:10.5px;color:var(--accent,#4fc3f7);margin:-2px 0 2px;}
.cohts-sug{position:absolute;left:52px;right:0;top:100%;z-index:5;background:var(--panel,#1e1e28);border:1px solid var(--accent,#4fc3f7);border-radius:8px;max-height:190px;overflow-y:auto;box-shadow:0 12px 30px rgba(0,0,0,.55);}
.cohts-sug div{padding:7px 10px;font:600 13px Barlow,sans-serif;cursor:pointer;border-bottom:1px solid var(--border,#333);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cohts-sug div:last-child{border-bottom:none;}
.cohts-sug div:hover,.cohts-sug div.on{background:var(--accent,#4fc3f7);color:#fff;}
.cohts-btn{padding:7px 12px;border-radius:8px;font:700 12px 'Barlow Condensed',sans-serif;letter-spacing:.5px;cursor:pointer;border:1px solid var(--border,#333);background:var(--card,#252530);color:var(--t1,#eee);white-space:nowrap;}
.cohts-btn:hover:not(:disabled){border-color:var(--accent,#4fc3f7);color:var(--accent,#4fc3f7);}
.cohts-btn.pri{background:var(--accent,#4fc3f7);border-color:var(--accent,#4fc3f7);color:#fff;}
.cohts-btn.pri:hover:not(:disabled){color:#fff;filter:brightness(1.1);}
.cohts-btn:disabled{opacity:.45;cursor:not-allowed;}
.cohts-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;}
.cohts-soon{font-size:10.5px;color:var(--t3,#777);font-style:italic;flex:1;min-width:150px;line-height:1.4;}
.cohts-file{position:relative;display:inline-block;}
.cohts-file input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;padding:0;border:0;font-size:0;}
.cohts-file:focus-within{border-color:var(--accent,#4fc3f7);color:var(--accent,#4fc3f7);}
.cohts-rdbar{margin:-6px 0 12px;}
.cohts-warn{margin-top:8px;font-size:11.5px;line-height:1.5;color:var(--orange,#f59e0b);}
.cohts-paste{margin-bottom:12px;border-bottom:1px dashed var(--border,#333);padding-bottom:10px;}
.cohts-paste textarea{min-height:66px;height:66px;resize:vertical;font:500 12.5px Barlow,sans-serif;line-height:1.45;}
.cohts-lbl{font:700 10px 'Barlow Condensed',sans-serif;letter-spacing:.6px;text-transform:uppercase;color:var(--t3,#777);margin-bottom:4px;}
.cohts-prev{margin-top:8px;border:1px solid var(--border,#333);border-radius:8px;max-height:230px;overflow-y:auto;background:var(--card,#252530);}
.cohts-prow{display:grid;grid-template-columns:30px minmax(0,1fr) 44px;gap:6px;padding:5px 8px;font-size:12.5px;border-bottom:1px solid var(--border,#333);align-items:baseline;}
.cohts-prow:last-child{border-bottom:none;}
.cohts-prow b{text-align:right;color:var(--t2,#999);font-weight:700;}
.cohts-prow em{font:700 9.5px 'Barlow Condensed',sans-serif;letter-spacing:.5px;text-transform:uppercase;color:var(--t3,#777);font-style:normal;text-align:right;}
.cohts-prow em.sub{color:var(--accent,#4fc3f7);}
.cohts-prow small{display:block;font-size:10.5px;color:var(--accent,#4fc3f7);}
.cohts-pskip{padding:6px 8px;font-size:11px;color:var(--orange,#f59e0b);}
.cohts-foot{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap;margin-top:14px;position:sticky;bottom:0;background:var(--panel,#1e1e28);padding:10px 0 2px;border-top:1px solid var(--border,#333);z-index:6;}
.cohts-status{flex:1;min-width:140px;font-size:12px;color:var(--t2,#999);}
.cohts-status.err{color:#ef4444;}
@media(max-width:720px){ .cohts-ov{padding:8px 6px;} .cohts-card{padding:12px;} .cohts-cols{grid-template-columns:1fr;gap:12px;} .cohts-col{padding:10px;} }
.cohts-panel{padding:10px 10px 16px;font-family:Barlow,sans-serif;color:var(--t1,#eee);}
.cohts-ptop{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
.cohts-ptop div{flex:1;font:800 14px 'Barlow Condensed',sans-serif;letter-spacing:.8px;text-transform:uppercase;color:var(--t2,#999);}
.cohts-pcols{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.cohts-pcol{min-width:0;}
.cohts-pteam{display:flex;align-items:center;gap:6px;font:800 13px 'Barlow Condensed',sans-serif;letter-spacing:.6px;text-transform:uppercase;padding-bottom:5px;margin-bottom:4px;border-bottom:2px solid var(--border,#333);}
.cohts-pteam i{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
.cohts-pteam span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cohts-pgrp{font:700 9.5px 'Barlow Condensed',sans-serif;letter-spacing:.7px;text-transform:uppercase;color:var(--t3,#777);margin:9px 0 3px;}
.cohts-pl{display:flex;gap:6px;padding:3px 0;font-size:12.5px;line-height:1.3;border-bottom:1px solid var(--border,#333);}
.cohts-pl b{width:20px;flex-shrink:0;text-align:right;color:var(--t2,#999);font-weight:700;font-variant-numeric:tabular-nums;}
.cohts-pl>span:last-child{min-width:0;overflow-wrap:anywhere;}
.cohts-pl.ph{align-items:center;}
.cohts-sm{display:inline-block;margin-left:5px;padding:0 5px;border-radius:4px;font:700 10px Barlow,sans-serif;letter-spacing:.2px;white-space:nowrap;vertical-align:1px;border:1px solid currentColor;}
.cohts-sm.off{color:#ef4444;} .cohts-sm.on{color:#22c55e;}
.cohts-sm.blood{border-style:dashed;}
.cohts-ph .cohts-hd,.cohts-ph .cohts-row{grid-template-columns:46px 28px minmax(0,1fr) 86px 28px;}
.cohts-ph .cohts-sug{left:86px;}
.cohts-phb{width:28px;height:28px;display:flex;align-items:center;justify-content:center;}
.cohts-pnone{font-size:12px;color:var(--t3,#777);padding:6px 0;}
.cohts-pempty{text-align:center;padding:34px 12px;color:var(--t3,#777);font-size:13px;}
.cohts-pempty .cohts-btn{margin-top:12px;}
.cohts-pick{max-width:420px;}
.cohps-vt{display:inline-flex;border:1px solid var(--border,#333);border-radius:8px;overflow:hidden;flex-shrink:0;}
.cohps-vt button{border:none;background:var(--card,#252530);color:var(--t2,#999);font:700 11px 'Barlow Condensed',sans-serif;letter-spacing:.6px;text-transform:uppercase;padding:6px 10px;cursor:pointer;}
.cohps-vt button.on{background:var(--accent,#4fc3f7);color:#fff;}
.cohps-tabs{display:flex;gap:6px;margin:0 0 10px;flex-wrap:wrap;}
.cohps-tabs button{display:flex;align-items:center;gap:6px;flex:1 1 0;min-width:0;padding:7px 10px;border-radius:8px;border:1px solid var(--border,#333);background:var(--card,#252530);color:var(--t2,#999);font:800 12.5px 'Barlow Condensed',sans-serif;letter-spacing:.6px;text-transform:uppercase;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cohps-tabs button i{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
.cohps-tabs button.on{border-color:var(--accent,#4fc3f7);color:var(--t1,#eee);box-shadow:inset 0 -2px 0 var(--accent,#4fc3f7);}
.cohps-tabs button.cohps-both{flex:0 0 auto;}
.cohps-team{--pitch:#2f6b3a;--pitch2:#2a6135;--line:rgba(255,255,255,.42);}
[data-theme="light"] .cohps-team{--pitch:#3f8c4b;--pitch2:#398244;--line:rgba(255,255,255,.6);}
.cohps-pitch{position:relative;border-radius:10px;overflow:hidden;background:repeating-linear-gradient(180deg,var(--pitch) 0 8.33%,var(--pitch2) 8.33% 16.66%);color:var(--line);padding:4% 1.5%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.25);}
.cohps-lines{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}
.cohps-rows{position:relative;display:grid;grid-template-rows:repeat(6,auto);row-gap:6px;min-height:520px;align-content:space-between;}
.cohps-row{display:flex;justify-content:space-evenly;align-items:flex-start;gap:2px;min-height:72px;}
.cohps-pl{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;width:31%;max-width:132px;min-width:0;padding:0;margin:0;border:none;background:none;color:inherit;font:inherit;text-align:center;}
.cohps-pl.pick{cursor:pointer;}
.cohps-pl.pick:hover .cohps-nm,.cohps-pl.pick:focus-visible .cohps-nm{background:var(--accent,#4fc3f7);color:#fff;}
.cohps-pl:focus-visible{outline:2px solid #fff;outline-offset:2px;border-radius:8px;}
.cohps-shirt{position:relative;display:block;width:44px;height:40px;flex-shrink:0;}
.cohps-shirt>svg{position:absolute;inset:0;width:100%;height:100%;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35));}
.cohps-shirt b{position:absolute;left:0;right:0;top:13px;text-align:center;font:800 16px/1 'Barlow Condensed',sans-serif;font-variant-numeric:tabular-nums;}
.cohps-nm{display:block;max-width:100%;padding:2px 7px;border-radius:999px;background:#fff;color:#14141c;font:700 10.5px/1.2 Barlow,sans-serif;box-shadow:0 1px 2px rgba(0,0,0,.3);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere;}
.cohps-sc{display:inline-block;padding:0 6px;border-radius:5px;background:rgba(0,0,0,.55);color:#ffe27a;font:800 11px/1.45 'Barlow Condensed',sans-serif;letter-spacing:.4px;font-variant-numeric:tabular-nums;}
.cohps-cards{position:absolute;left:calc(100% - 4px);top:-4px;display:flex;gap:2px;}
.cohps-cards i{display:block;width:10px;height:14px;border-radius:1.5px;box-shadow:0 1px 2px rgba(0,0,0,.45);transform:rotate(10deg);}
.cohps-cards i.cY{background:#facc15;} .cohps-cards i.cR{background:#dc2626;} .cohps-cards i.cB{background:#111;outline:1px solid rgba(255,255,255,.8);} .cohps-cards i.cX{background:#9ca3af;}
.cohps-subs{position:absolute;right:calc(100% + 1px);top:-2px;display:flex;flex-direction:column;gap:2px;align-items:flex-start;}
.cohps-sb{display:inline-flex;align-items:center;gap:1px;padding:1px 4px 1px 2px;border-radius:5px;background:#fff;font:800 11.5px/1.2 'Barlow Condensed',sans-serif;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.35);}
.cohps-sb svg{width:11px;height:11px;flex-shrink:0;}
.cohps-sb.off{color:#dc2626;} .cohps-sb.on{color:#16a34a;}
.cohps-sb.blood{outline:1px dashed #dc2626;outline-offset:-1px;}
.cohps-sb .cohps-drop{width:8px;height:10px;margin-right:1px;}
.cohps-bench{margin-top:10px;border-radius:10px;background:var(--pitch2);padding:8px 6px 10px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.25);}
.cohps-bh{font:800 11px 'Barlow Condensed',sans-serif;letter-spacing:.9px;text-transform:uppercase;color:rgba(255,255,255,.85);margin:0 0 8px 4px;}
.cohps-bgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));row-gap:10px;column-gap:4px;justify-items:center;}
.cohps-bgrid .cohps-pl{width:100%;}
.cohps-pl.xs .cohps-nm{outline:1px dashed #14141c;outline-offset:-2px;}
.cohps-note{font-size:11px;color:var(--t3,#777);margin:8px 2px 0;line-height:1.45;}
.cohps-full{max-width:1180px;}
.cohps-fh{display:flex;align-items:center;gap:10px;margin-bottom:12px;} .cohps-fh .cohts-h{flex:1;min-width:0;}
.cohps-two{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
.cohps-col{min-width:0;}
.cohps-full .cohps-rows{min-height:640px;}
.cohps-full .cohps-shirt{width:52px;height:47px;} .cohps-full .cohps-shirt b{top:15px;font-size:19px;} .cohps-full .cohps-nm{font-size:11.5px;}
@media(max-width:860px){ .cohps-two{grid-template-columns:1fr;} .cohps-full .cohps-rows{min-height:520px;} }
.cohts-plist{border:1px solid var(--border,#333);border-radius:10px;max-height:min(380px,52vh);overflow-y:auto;margin:10px 0 12px;}
.cohts-pgh{padding:6px 12px 3px;font:700 9.5px 'Barlow Condensed',sans-serif;letter-spacing:.7px;text-transform:uppercase;color:var(--t3,#777);background:var(--card,#252530);}
.cohts-pi{padding:8px 12px;font:600 13.5px Barlow,sans-serif;cursor:pointer;border-bottom:1px solid var(--border,#333);}
.cohts-pi.tm{background:var(--tc);}
.cohts-pi.tm .cohts-pno{color:var(--t2,#bbb);opacity:.85;}
.cohts-pi:hover,.cohts-pi.on{background:var(--accent,#4fc3f7);color:#fff;}
.cohts-pno{float:right;margin-left:12px;font-weight:600;color:var(--t3,#888);opacity:.75;font-variant-numeric:tabular-nums;}
.cohts-pno.unk{opacity:.5;}
.cohts-pi:hover .cohts-pno,.cohts-pi.on .cohts-pno{color:#fff;opacity:.85;}
`;
    document.head.appendChild(st);
  }
  T._css=css; T._esc=esc;
  // cohesion-teamsheet-reader.js is fetched (from beside this file) only when a file is first chosen
  const here=document.currentScript&&document.currentScript.src;
  let readerP=null;
  T._reader=function(){
    if(window.cohTSReader&&window.cohTSReader.read) return Promise.resolve(window.cohTSReader);
    return readerP||(readerP=new Promise((res,rej)=>{
      const s=document.createElement('script'); s.src=here?here.replace(/cohesion-teamsheet\.js(?=$|[?#])/,'cohesion-teamsheet-reader.js'):'cohesion-teamsheet-reader.js';
      s.onload=()=>{ if(window.cohTSReader&&window.cohTSReader.read) res(window.cohTSReader); else { readerP=null; rej(new Error('The reader did not load. Pasting or typing the list still works.')); } };
      s.onerror=()=>{ readerP=null; s.remove(); rej(new Error('The reader could not be loaded — check the connection and try again. Pasting or typing the list still works.')); };
      document.head.appendChild(s);
    }));
  };
})();

/* ── editor ─────────────────────────────────────────────────────
 * cohTS.openEditor({
 *   game,                       the game's meta (id, homeTeam, awayTeam, rosters…)
 *   known:{home:[],away:[]},    each team's known player names (type-to-search + spelling match)
 *   loadKnown(side)→Promise<[names]>   optional, merged in when it arrives
 *   persist:false,              no database write (a local-video session — the caller keeps it)
 *   onSaved(mergedMeta, sheets) called after a successful save
 *   onReport()                  optional: shows "📋 Match report…" (Code Room — cohesion-report.js); the editor closes first
 *   io:{read,write}             optional replacements for cohesionRead / cohesionAuthFetch
 * }) → {el, close}
 */
(function(){
  'use strict';
  if(typeof window==='undefined'||typeof document==='undefined') return;
  const T=window.cohTS, esc=T._esc;
  const SIDES=['home','away'];

  T.openEditor=function(opts){
    opts=opts||{}; T._css();
    const game=opts.game||{}, persist=opts.persist!==false;
    const known={home:((opts.known&&opts.known.home)||[]).slice(), away:((opts.known&&opts.known.away)||[]).slice()};
    const S={}, base={};
    const stored=side=>JSON.stringify(S[side].rows.filter(r=>String(r.name||'').trim()).map(T.toStored));
    SIDES.forEach(side=>{
      let rows=T.sheet(game, side).map(r=>Object.assign({}, r));
      const had=rows.length>0;
      if(!had) rows=Array.from({length:15},(_,i)=>({no:String(i+1), name:'', role:'start'}));
      S[side]={rows, prev:null, had};
      base[side]=stored(side);
    });
    const dirty=side=>stored(side)!==base[side];
    const teamName=side=>String((side==='home'?game.homeTeam:game.awayTeam)||side);
    const knownAll=side=>known[side].concat(S[side].rows.map(r=>r.name).filter(Boolean));

    const ov=document.createElement('div'); ov.className='cohts-ov';
    // player photo beside each name (signed-in users only) — cohesion-photos.js; without it the rows are as before
    const badge=typeof window.cohPlayerBadgeHTML==='function'?window.cohPlayerBadgeHTML:null;
    const badgeHtml=(side, name)=>(badge&&String(name||'').trim())?badge(teamName(side), T.tidyName(name), {size:26, color:(side==='home'?game.homeColor:game.awayColor)||(side==='home'?'#2563eb':'#22c55e')}):'';
    const card=document.createElement('div'); card.className='cohts-card'+(badge?' cohts-ph':''); ov.appendChild(card);
    card.innerHTML=`<div class="cohts-h">Team sheets — ${esc(game.title||(teamName('home')+' v '+teamName('away')))}</div>
      <div class="cohts-sub">Number, name and starter / sub for each team in this game. Type a name to search that team's known players, or paste a list and check the preview. Rows without a name are not saved. ${persist?'Saved to this game only.':'This is a local session — the sheet is kept in this browser with your events.'}</div>
      <div class="cohts-bar cohts-rdbar"><label class="cohts-btn cohts-file">📷 Read both teams from one photo / PDF<input type="file" accept="image/*,application/pdf" data-read="both" aria-label="Read both teams from one photo or PDF"></label><span class="cohts-soon">Read on this device — the file is not uploaded. The reader itself is downloaded from a public CDN (jsDelivr) the first time it is used, then kept by the browser.</span>${typeof opts.onReport==='function'?'<button class="cohts-btn" data-act="report" title="Paste a newspaper match report (or read a screenshot): both teams\u2019 starters and subs, after a preview">📋 Match report…</button>':''}</div>
      <div class="cohts-rd" data-rd="both"></div>
      <div class="cohts-cols">${SIDES.map(s=>`<div class="cohts-col" data-side="${s}"></div>`).join('')}</div>
      <div class="cohts-foot"><div class="cohts-status" id="cohtsStatus"></div>
        <button class="cohts-btn" data-act="cancel">Cancel</button>
        <button class="cohts-btn pri" data-act="save">Save team sheets</button></div>`;
    const col=side=>card.querySelector('.cohts-col[data-side="'+side+'"]');
    const status=(msg,err)=>{ const el=card.querySelector('#cohtsStatus'); el.textContent=msg||''; el.classList.toggle('err',!!err); };

    function rowHtml(side, r, i){
      const role=r.role||'';
      return `<div class="cohts-row" data-i="${i}">
        <input class="no" inputmode="numeric" maxlength="3" value="${esc(r.no)}" placeholder="#" aria-label="Number">${badge?`
        <div class="cohts-phb">${badgeHtml(side, r.name)}</div>`:''}
        <input class="nm" value="${esc(r.name)}" placeholder="Player name" autocomplete="off" spellcheck="false" aria-label="Name">
        <select class="rl" aria-label="Starter or sub"><option value="start"${role==='start'?' selected':''}>Starter</option><option value="sub"${role==='sub'?' selected':''}>Sub</option>${role?'':'<option value="" selected>Not set</option>'}</select>
        <button class="cohts-x" data-act="del" title="Delete row">✕</button></div>
        <div class="cohts-adopt" data-a="${i}"${r.adopted?'':' style="display:none"'}>${r.adopted?'Matched existing spelling — typed “'+esc(r.adopted)+'”':''}</div>`;
    }
    function summary(side){
      const rows=S[side].rows.filter(r=>String(r.name||'').trim());
      const st=rows.filter(r=>r.role==='start').length, sb=rows.filter(r=>r.role==='sub').length, ns=rows.length-st-sb;
      return rows.length?(st+' starter'+(st===1?'':'s')+' · '+sb+' sub'+(sb===1?'':'s')+(ns?' · '+ns+' not set':'')):'No team sheet added';
    }
    function warnHtml(side){ return T.validate(S[side].rows, game).map(w=>'⚠ '+esc(w)).join('<br>'); }
    function live(side){
      const c=col(side);
      c.querySelector('.cohts-team small').textContent=summary(side);
      c.querySelector('.cohts-warn').innerHTML=warnHtml(side);
    }
    function prevHtml(side){
      const p=S[side].prev; if(!p) return '';
      if(!p.rows.length&&!p.skipped.length) return '';
      const ad=p.rows.filter(r=>r.adopted).length;
      return `<div class="cohts-lbl" style="margin-top:8px;">Preview — ${p.rows.length} player${p.rows.length===1?'':'s'}${ad?' · '+ad+' matched to an existing spelling':''}</div>
        <div class="cohts-prev">${p.rows.map(r=>`<div class="cohts-prow"><b>${esc(r.no)}</b><span>${esc(r.name)}${r.adopted?`<small>existing spelling — pasted “${esc(r.adopted)}”</small>`:''}</span><em class="${r.role==='sub'?'sub':''}">${r.role==='sub'?'Sub':'Start'}</em></div>`).join('')}
        ${p.skipped.length?`<div class="cohts-pskip">Not read (${p.skipped.length}): ${p.skipped.map(esc).join(' · ')}</div>`:''}</div>
        <div class="cohts-bar"><button class="cohts-btn pri" data-act="papply" ${p.rows.length?'':'disabled'}>Replace this sheet</button>
          <button class="cohts-btn" data-act="padd" ${p.rows.length?'':'disabled'}>Add to this sheet</button>
          <button class="cohts-btn" data-act="pclear">Clear</button></div>`;
    }
    function draw(side){
      const c=col(side), colr=(side==='home'?game.homeColor:game.awayColor)||(side==='home'?'#2563eb':'#22c55e');
      const keep=c.querySelector('textarea'), txt=keep?keep.value:'', rd=c.querySelector('.cohts-rd');
      c.innerHTML=`<div class="cohts-team"><i style="background:${esc(T._ink(colr))}"></i><span>${esc(teamName(side))}</span><small></small></div>
        <div class="cohts-paste"><div class="cohts-lbl">Paste a list</div>
          <textarea placeholder="1 Colm Reape&#10;2. Name&#10;Name (3)&#10;Subs&#10;16 Name"></textarea>
          <div class="cohts-pv">${prevHtml(side)}</div>
          <div class="cohts-bar"><label class="cohts-btn cohts-file" title="Read on this device — the file is not uploaded">📷 Read from photo / PDF<input type="file" accept="image/*,application/pdf" data-read="${side}" aria-label="Read this team from a photo or PDF"></label></div>
          <div class="cohts-rd"></div></div>
        <div class="cohts-hd"><div style="text-align:center">No.</div>${badge?'<div></div>':''}<div>Name</div><div>Role</div><div></div></div>
        <div class="cohts-rows">${S[side].rows.map((r,i)=>rowHtml(side,r,i)).join('')}</div>
        <div class="cohts-bar"><button class="cohts-btn" data-act="add">+ Add row</button></div>
        <div class="cohts-warn"></div>`;
      c.querySelector('textarea').value=txt;
      if(rd) c.querySelector('.cohts-rd').replaceWith(rd);          // the reader's panel (source picture, notes) survives a redraw
      live(side);
    }

    // type-to-search list under a name box
    let sug=null;   // {el,input,items,idx}
    function sugHide(){ if(sug&&sug.el.parentNode) sug.el.parentNode.removeChild(sug.el); sug=null; }
    function sugShow(side, inp){
      sugHide();
      const q=T.nameKey(inp.value), taken=new Set(S[side].rows.map(r=>T.nameKey(r.name)));
      const seen=new Set(), items=[];
      known[side].forEach(n=>{ const k=T.nameKey(n); if(!k||seen.has(k)) return; seen.add(k);
        if(k===q||(taken.has(k)&&k!==q)) return; if(q&&!k.includes(q)) return; items.push(String(n).replace(/\s+/g,' ').trim()); });
      if(!items.length) return;
      const el=document.createElement('div'); el.className='cohts-sug';
      el.innerHTML=items.slice(0,40).map((n,i)=>`<div data-s="${i}">${esc(n)}</div>`).join('');
      inp.parentNode.appendChild(el);
      sug={el, input:inp, items:items.slice(0,40), idx:-1, side};
      el.querySelectorAll('div').forEach(d=>{ d.onmousedown=ev=>{ ev.preventDefault(); sugPick(+d.dataset.s); }; });
    }
    function sugPick(i){ if(!sug||i<0||i>=sug.items.length) return; const inp=sug.input, side=sug.side, v=sug.items[i]; sugHide(); inp.value=v; setName(side, inp, true); }
    function rowOf(el){ const r=el.closest('.cohts-row'); return r?+r.dataset.i:-1; }
    function sideOfEl(el){ const c=el.closest('.cohts-col'); return c?c.dataset.side:''; }
    // commit a name box: tidy it and adopt the team's existing spelling
    function setName(side, inp, final){
      const i=rowOf(inp), r=S[side].rows[i]; if(!r) return;
      if(!final){ r.name=inp.value; r.adopted=''; live(side); return; }
      const typed=T.tidyName(inp.value);
      const hit=T.matchKnown(typed, known[side]);
      r.name=hit||typed; r.adopted=(hit&&T.tidyName(hit)!==typed)?typed:'';
      inp.value=r.name;
      const pb=inp.parentNode&&inp.parentNode.querySelector('.cohts-phb'); if(pb) pb.innerHTML=badgeHtml(side, r.name);
      const a=col(side).querySelector('.cohts-adopt[data-a="'+i+'"]');
      if(a){ a.style.display=r.adopted?'':'none'; a.textContent=r.adopted?'Matched existing spelling — typed “'+r.adopted+'”':''; }
      live(side);
    }

    card.addEventListener('input',ev=>{
      const t=ev.target, side=sideOfEl(t); if(!side) return;
      if(t.tagName==='TEXTAREA'){ S[side].prev=t.value.trim()?T.parsePaste(t.value,{known:knownAll(side)}):null; col(side).querySelector('.cohts-pv').innerHTML=prevHtml(side); return; }
      const r=S[side].rows[rowOf(t)]; if(!r) return;
      if(t.classList.contains('no')){ t.value=t.value.replace(/\D/g,''); r.no=t.value?String(+t.value):''; live(side); }
      else if(t.classList.contains('nm')){ setName(side, t, false); sugShow(side, t); }
    });
    card.addEventListener('change',ev=>{
      const t=ev.target, side=sideOfEl(t);
      if(t.type==='file'&&t.dataset.read){ const f=t.files&&t.files[0]; t.value=''; if(f) readFile(t.dataset.read==='both'?'':side, f); return; }
      if(!side||!t.classList.contains('rl')) return;
      const r=S[side].rows[rowOf(t)]; if(r){ r.role=t.value; live(side); }
    });
    card.addEventListener('focusin',ev=>{ const t=ev.target; if(t.classList&&t.classList.contains('nm')) sugShow(sideOfEl(t), t); });
    card.addEventListener('focusout',ev=>{ const t=ev.target; if(t.classList&&t.classList.contains('nm')){ if(sug&&sug.input===t) sugHide(); setName(sideOfEl(t), t, true); } });
    card.addEventListener('keydown',ev=>{
      const t=ev.target; if(!t.classList||!t.classList.contains('nm')) return;
      if(sug&&sug.input===t&&(ev.key==='ArrowDown'||ev.key==='ArrowUp')){ ev.preventDefault();
        sug.idx=Math.max(0,Math.min(sug.items.length-1,sug.idx+(ev.key==='ArrowDown'?1:-1)));
        sug.el.querySelectorAll('div').forEach((d,i)=>d.classList.toggle('on',i===sug.idx));
        const on=sug.el.querySelector('.on'); if(on&&on.scrollIntoView) on.scrollIntoView({block:'nearest'}); return; }
      if(ev.key==='Escape'&&sug){ ev.stopPropagation(); sugHide(); return; }
      if(ev.key==='Enter'){ ev.preventDefault();
        if(sug&&sug.input===t&&sug.idx>=0){ sugPick(sug.idx); return; }
        const side=sideOfEl(t), i=rowOf(t); sugHide(); setName(side, t, true);
        if(i===S[side].rows.length-1) addRow(side);
        const nx=col(side).querySelector('.cohts-row[data-i="'+(i+1)+'"] .nm'); if(nx) nx.focus(); }
    });
    // "Read from photo / PDF": the reader fills the paste box(es); the parser and preview above do the rest
    function readFile(side, file){
      status('');
      T._reader().then(R=>R.attach({card, side, game, known:knownAll, teamName, col}, file)).catch(e=>status(e.message||String(e), true));
    }
    function addRow(side){
      const rows=S[side].rows, last=rows[rows.length-1];
      rows.push({no:(last&&last.no!=='')?String(+last.no+1):'', name:'', role:(last&&last.role)||'start'});
      draw(side);
    }
    card.addEventListener('click',ev=>{
      const b=ev.target.closest('[data-act]'); if(!b||b.disabled) return;
      const act=b.dataset.act, side=sideOfEl(b);
      if(act==='del'){ S[side].rows.splice(rowOf(b),1); draw(side); }
      else if(act==='add'){ addRow(side); const l=col(side).querySelectorAll('.cohts-row .nm'); if(l.length) l[l.length-1].focus(); }
      else if(act==='papply'||act==='padd'){
        const p=S[side].prev; if(!p||!p.rows.length) return;
        const add=p.rows.map(r=>Object.assign({}, r));
        S[side].rows=act==='papply'?add:S[side].rows.filter(r=>String(r.name||'').trim()).concat(add);
        S[side].prev=null; const ta=col(side).querySelector('textarea'); if(ta) ta.value='';
        draw(side);
      }
      else if(act==='pclear'){ S[side].prev=null; const ta=col(side).querySelector('textarea'); if(ta) ta.value=''; col(side).querySelector('.cohts-pv').innerHTML=''; }
      else if(act==='report'){ if((dirty('home')||dirty('away'))&&!window.confirm('Leave the team sheets without saving your changes, and open the match report?')) return; close(); opts.onReport(); }
      else if(act==='cancel'){ if((dirty('home')||dirty('away'))&&!window.confirm('Discard the changes to the team sheets?')) return; close(); }
      else if(act==='save') save(b);
    });
    async function save(btn){
      const sheets={}; SIDES.forEach(s=>{ if(dirty(s)) sheets[s]=S[s].rows.filter(r=>String(r.name||'').trim()).map(r=>({no:r.no, name:r.name, role:r.role, extra:r.extra})); });
      if(!Object.keys(sheets).length){ close(); return; }
      btn.disabled=true; status('Saving…');
      try{
        const merged=persist?await T.save(game.id, sheets, opts.io):T.mergeMeta(game, sheets);
        if(opts.onSaved) await opts.onSaved(merged, sheets);
        close();
      }catch(e){ btn.disabled=false; status(e.message||String(e), true); }
    }
    function close(){ sugHide(); if(ov.parentNode) ov.parentNode.removeChild(ov); if(opts.onClose) opts.onClose(); }

    SIDES.forEach(draw);
    document.body.appendChild(ov);
    if(typeof opts.loadKnown==='function') SIDES.forEach(side=>{
      Promise.resolve().then(()=>opts.loadKnown(side)).then(l=>{ (l||[]).forEach(n=>{ if(n&&!known[side].some(k=>T.nameKey(k)===T.nameKey(n))) known[side].push(n); }); }).catch(()=>{});
    });
    return {el:ov, close, state:S};
  };
})();

/* ── dashboard panel + player picker ────────────────────────────── */
(function(){
  'use strict';
  if(typeof window==='undefined'||typeof document==='undefined') return;
  const T=window.cohTS, esc=T._esc;

  // Both teams side by side: starters in number order, then subs.
  // o = {canEdit, editCall:'jsCall()', title}
  // on-screen shade of a team colour that reads on the page's theme (cohesion-ink.js); display only — the game keeps its colour
  T._ink=function(c){ return window.cohTeamInk?window.cohTeamInk(c):c; };
  function listHtml(game, o, bar){
    const btn=l=>(o.canEdit&&o.editCall)?`<button class="cohts-btn" onclick="${esc(o.editCall)}">${l}</button>`:'';
    if(!T.hasSheet(game)) return `<div class="cohts-panel"><div class="cohts-pempty">No team sheet added${o.canEdit&&o.editCall?'<br>'+btn('+ Add team sheet'):''}</div></div>`;
    // player photo (signed-in users only) over the initials — cohesion-photos.js; without it, the plain line
    const badge=typeof window.cohPlayerBadgeHTML==='function'?window.cohPlayerBadgeHTML:null;
    const colHtml=side=>{
      const g=T.groups(game, side), nm=(side==='home'?game.homeTeam:game.awayTeam)||side;
      const colr=(side==='home'?game.homeColor:game.awayColor)||(side==='home'?'#2563eb':'#22c55e');
      // substituted players (o.events = the game's events): "off 52'" on the player taken off, "on 52'" on the one
      // brought on — only players the shared reader names (cohesion-labels.js cohSubMarks) and this sheet lists
      const marks=(o.events&&typeof cohSubMarks==='function')?cohSubMarks(o.events, game, side):null;
      const mark=r=>{ const l=marks&&marks.get(T.nameKey(r.name)); return l?l.map(x=>` <small class="cohts-sm ${x.type}${x.blood?' blood':''}"${x.blood?' title="Blood sub — not counted in the team’s subs"':''}>${esc(x.text)}</small>`).join(''):''; };
      const line=r=>`<div class="cohts-pl${badge?' ph':''}"><b>${esc(r.no)}</b>${badge?badge(nm, r.name, {size:24, color:colr}):''}<span>${esc(r.name)}${mark(r)}</span></div>`;
      const any=g.start.length+g.sub.length+g.other.length;
      return `<div class="cohts-pcol"><div class="cohts-pteam"><i style="background:${esc(T._ink(colr))}"></i><span>${esc(nm)}</span></div>`+
        (any?(g.start.map(line).join('')+
          (g.sub.length?'<div class="cohts-pgrp">Subs</div>'+g.sub.map(line).join(''):'')+
          (g.other.length?'<div class="cohts-pgrp">Also listed</div>'+g.other.map(line).join(''):''))
          :'<div class="cohts-pnone">No team sheet added</div>')+'</div>';
    };
    return `<div class="cohts-panel"><div class="cohts-ptop"><div>${esc(o.title||'Team Sheets')}</div>${bar||''}${btn('✏️ Edit')}</div>
      <div class="cohts-pcols">${colHtml('home')}${colHtml('away')}</div></div>`;
  };

  // o = {canEdit, editCall:'jsCall()', title, events,
  //      view:'pitch'|'list'   (the Dashboard; without it the List, exactly as before — other pages and old callers)
  //      side:'home'|'away'    the team the Pitch view shows (one team in the panel; "Both teams" opens them side by side)
  //      stateCall:'fn'        fn('view'|'side', value) — the page keeps the choice and redraws
  //      players(side)         → {name: {g, pts, cards:['Y'|'B'|'R'…]}} — the Dashboard's own player figures
  //                              (cohesion-graphics.js dashPlayerDetails, the match report's "Player Details")
  //      playerCall:'fn', canPick(side, name)   a click on a jersey → fn(side, name) (the Dashboard's player filter)}
  T.panelHtml=function(game, o){
    o=o||{}; T._css(); game=game||{};
    const btn=l=>(o.canEdit&&o.editCall)?`<button class="cohts-btn" onclick="${esc(o.editCall)}">${l}</button>`:'';
    if(!T.hasSheet(game)) return `<div class="cohts-panel"><div class="cohts-pempty">No team sheet added${o.canEdit&&o.editCall?'<br>'+btn('+ Add team sheet'):''}</div></div>`;
    if(!o.view) return listHtml(game, o, '');
    T._pitchLast={game, o};
    const sc=(k,v)=>o.stateCall?esc(o.stateCall+'('+JSON.stringify(k)+','+JSON.stringify(v)+')'):'';
    const bar=`<span class="cohps-vt" role="group" aria-label="View"><button class="${o.view==='pitch'?'on':''}" onclick="${sc('view','pitch')}">Pitch</button><button class="${o.view!=='pitch'?'on':''}" onclick="${sc('view','list')}">List</button></span>`;
    if(o.view!=='pitch') return listHtml(game, o, bar);
    const side=o.side==='away'?'away':'home', nm=s=>(s==='home'?game.homeTeam:game.awayTeam)||s;
    const colr=s=>(s==='home'?game.homeColor:game.awayColor)||(s==='home'?'#2563eb':'#22c55e');
    const tabs=`<div class="cohps-tabs">${['home','away'].map(s=>`<button class="${s===side?'on':''}" onclick="${sc('side',s)}"><i style="background:${esc(T._ink(colr(s)))}"></i>${esc(nm(s))}</button>`).join('')}<button class="cohps-both" onclick="cohTS._pitchFull()" title="Both teams side by side">⤢ Both</button></div>`;
    return `<div class="cohts-panel cohps-panel"><div class="cohts-ptop"><div>${esc(o.title||'Team Sheets')}</div>${bar}${btn('✏️ Edit')}</div>${tabs}${T.pitchHtml(game, side, o)}</div>`;
  };

  // ── Pitch view: one team ──
  // shirt in the team's colour (the real colour — the pitch is green on both themes), number in the ink that reads on it
  const SHIRT='M20 3 L26 1 Q32 8 38 1 L44 3 L60 14 L53 28 L46 24 L46 56 L18 56 L18 24 L11 28 L4 14 Z';
  const arrow=(dir)=>`<svg viewBox="0 0 10 10" aria-hidden="true"><path d="${dir==='on'?'M5 1 L9 6 L6.4 6 L6.4 9.2 L3.6 9.2 L3.6 6 L1 6 Z':'M5 9 L9 4 L6.4 4 L6.4 0.8 L3.6 0.8 L3.6 4 L1 4 Z'}" fill="currentColor"/></svg>`;
  const drop='<svg class="cohps-drop" viewBox="0 0 10 12" aria-hidden="true"><path d="M5 0.5 C5 0.5 1 5.4 1 7.8 A4 4 0 0 0 9 7.8 C9 5.4 5 0.5 5 0.5 Z" fill="#ef4444"/></svg>';
  function lum(hex){ const h=String(hex||'').trim().replace(/^#/,''); const x=/^[0-9a-f]{3}$/i.test(h)?h.replace(/./g,c=>c+c):h; if(!/^[0-9a-f]{6}$/i.test(x)) return .5;
    const c=[0,2,4].map(i=>{ const v=parseInt(x.slice(i,i+2),16)/255; return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4); }); return .2126*c[0]+.7152*c[1]+.0722*c[2]; }
  function jersey(r, side, game, D, o, cls){
    const fill=(side==='home'?game.homeColor:game.awayColor)||(side==='home'?'#2563eb':'#22c55e'), L=lum(fill);
    const ink=window.cohInkOn?window.cohInkOn(fill):(L>.4?'#111':'#fff');
    // the outline: dark on a pale shirt, light on a black one, and white on a shirt that would melt into the green pitch
    const onGrass=window.cohContrast?Math.min(window.cohContrast(fill,'#2f6b3a'), window.cohContrast(fill,'#3f8c4b')):9;
    const edge=L>.55?'rgba(0,0,0,.55)':(L<.02||onGrass<1.7)?'rgba(255,255,255,.75)':'rgba(0,0,0,.35)';
    const d=D.get(T.nameKey(r.name))||{}, score=pitchScoreUi(d.stats), cards=(d.stats&&d.stats.cards)||[], marks=d.marks||[];
    const cardHtml=cards.length?`<span class="cohps-cards" title="${esc(cards.map(c=>({Y:'Yellow',B:'Black',R:'Red'})[c]||'Card').join(', ')+' card'+(cards.length>1?'s':''))}">${cards.map(c=>`<i class="c${/^[YBR]$/.test(c)?c:'X'}"></i>`).join('')}</span>`:'';
    const markHtml=marks.length?`<span class="cohps-subs">${marks.map(m=>`<span class="cohps-sb ${m.type}${m.blood?' blood':''}" title="${esc(m.text+(m.blood?' (blood sub)':''))}">${m.blood?drop:''}${arrow(m.type)}${m.min!==''?esc(m.min)+'\'':''}</span>`).join('')}</span>`:'';
    const pick=!!(o.playerCall&&(typeof o.canPick!=='function'||o.canPick(side, r.name)));
    const tag=pick?'button':'div', act=pick?` onclick="${esc(o.playerCall+'('+JSON.stringify(side)+','+JSON.stringify(r.name)+')')}" title="${esc('Show '+r.name+'’s events')}"`:'';
    return `<${tag} class="cohps-pl${cls?' '+cls:''}${pick?' pick':''}"${act} data-name="${esc(r.name)}"${r.pos?` data-pos="${r.pos}"`:''}>
      <span class="cohps-shirt"><svg viewBox="0 0 64 58" aria-hidden="true"><path d="${SHIRT}" fill="${esc(fill)}" stroke="${edge}" stroke-width="1.6" stroke-linejoin="round"/><path d="M26 1 Q32 8 38 1" fill="none" stroke="${edge}" stroke-width="1.2"/></svg><b style="color:${esc(ink)}">${esc(r.no)}</b>${cardHtml}${markHtml}</span>
      <span class="cohps-nm">${esc(r.name)}</span>${score?`<span class="cohps-sc">${esc(score)}</span>`:''}</${tag}>`;
  }
  function pitchScoreUi(d){ return T.pitchScore(d); }
  // the decorations of a side's players by name key: {stats:{g,pts,cards}, marks:[cohSubMarks …]}
  function decorations(game, side, o){
    const D=new Map(), get=k=>{ if(!D.has(k)) D.set(k, {}); return D.get(k); };
    if(typeof o.players==='function'){ let m=null; try{ m=o.players(side); }catch(_){ m=null; }
      Object.keys(m||{}).forEach(n=>{ const k=T.nameKey(n); if(!k) return; const x=get(k), v=m[n]||{};
        x.stats=x.stats?{g:x.stats.g+(+v.g||0), pts:x.stats.pts+(+v.pts||0), cards:x.stats.cards.concat(v.cards||[])}:{g:+v.g||0, pts:+v.pts||0, cards:(v.cards||[]).slice()}; }); }
    if(o.events&&typeof window.cohSubMarks==='function') window.cohSubMarks(o.events, game, side).forEach((l,k)=>{ get(k).marks=l; });
    // cards: most severe first (red, black, yellow)
    D.forEach(x=>{ if(x.stats) x.stats.cards.sort((a,b)=>'RBY?'.indexOf(a)-'RBY?'.indexOf(b)); });
    return D;
  }
  const PITCH_SVG=`<svg class="cohps-lines" viewBox="0 0 100 145" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke">
    <rect x="3" y="2.5" width="94" height="140" vector-effect="non-scaling-stroke"/><line x1="3" y1="72.5" x2="97" y2="72.5" vector-effect="non-scaling-stroke"/>
    ${[[0,1],[145,-1]].map(([y0,d])=>{ const Y=v=>y0+d*(2.5+v); return `<line x1="3" y1="${Y(13*140/145)}" x2="97" y2="${Y(13*140/145)}" vector-effect="non-scaling-stroke"/><line x1="3" y1="${Y(20*140/145)}" x2="97" y2="${Y(20*140/145)}" vector-effect="non-scaling-stroke"/><line x1="3" y1="${Y(45*140/145)}" x2="97" y2="${Y(45*140/145)}" vector-effect="non-scaling-stroke"/>
      <rect x="40" y="${Math.min(Y(0),Y(4.5))}" width="20" height="4.5" vector-effect="non-scaling-stroke"/><rect x="34.5" y="${Math.min(Y(0),Y(13*140/145))}" width="31" height="${13*140/145}" vector-effect="non-scaling-stroke"/>
      <path d="M38 ${Y(20*140/145)} A12 9 0 0 ${d>0?0:1} 62 ${Y(20*140/145)}" vector-effect="non-scaling-stroke"/>
      <line x1="45" y1="${Y(0)}" x2="45" y2="${Y(-2.3)}" vector-effect="non-scaling-stroke"/><line x1="55" y1="${Y(0)}" x2="55" y2="${Y(-2.3)}" vector-effect="non-scaling-stroke"/>`; }).join('')}
    <line x1="47" y1="72.5" x2="53" y2="72.5" stroke-width="3" vector-effect="non-scaling-stroke"/></g></svg>`;
  T.pitchHtml=function(game, side, o){
    o=o||{}; game=game||{}; T._css();
    const nm=(side==='home'?game.homeTeam:game.awayTeam)||side;
    if(!T.hasSheet(game, side)) return `<div class="cohps-team" data-side="${side}"><div class="cohts-pnone">No team sheet added for ${esc(nm)}</div></div>`;
    const P=T.pitchLayout(game, side), D=decorations(game, side, o);
    const lines=P.lines.slice().reverse();   // full-forwards at the top (attacking the top goal), the keeper at the bottom
    const rowHtml=(l,i)=>`<div class="cohps-row" data-line="${['ff','hf','mf','hb','fb','gk'][i]}">${l.map(r=>jersey(r, side, game, D, o)).join('')}</div>`;
    const bench=P.bench.length?`<div class="cohps-bench"><div class="cohps-bh">Substitutes</div><div class="cohps-bgrid">${P.bench.map(r=>jersey(r, side, game, D, o, P.extra.includes(r)?'xs':'')).join('')}</div></div>`:'';
    return `<div class="cohps-team" data-side="${side}">
      <div class="cohps-pitch">${PITCH_SVG}<div class="cohps-rows">${lines.map(rowHtml).join('')}</div></div>
      ${bench}${P.notes.length?`<div class="cohps-note">${P.notes.map(esc).join(' ')}</div>`:''}</div>`;
  };
  // "⤢ Both" — both teams side by side (stacked on a narrow screen), over the page
  T._pitchFull=function(){
    const L=T._pitchLast; if(!L) return;
    const game=L.game, o=Object.assign({}, L.o), prev=document.querySelector('.cohps-ov'); if(prev) prev.remove();
    const ov=document.createElement('div'); ov.className='cohts-ov cohps-ov';
    const close=()=>{ ov.remove(); document.removeEventListener('keydown', key, true); };
    const key=ev=>{ if(ev.key==='Escape'){ ev.stopPropagation(); close(); } };
    if(o.playerCall){ const fn=o.playerCall; o.playerCall='cohTS._pitchPick'; T._pitchPick=(s,n)=>{ close(); const f=window[fn]; if(typeof f==='function') f(s,n); }; }
    const head=s=>{ const c=(s==='home'?game.homeColor:game.awayColor)||(s==='home'?'#2563eb':'#22c55e'); return `<div class="cohts-pteam"><i style="background:${esc(T._ink(c))}"></i><span>${esc((s==='home'?game.homeTeam:game.awayTeam)||s)}</span></div>`; };
    ov.innerHTML=`<div class="cohts-card cohps-full"><div class="cohps-fh"><div class="cohts-h">${esc(game.title||((game.homeTeam||'')+' v '+(game.awayTeam||'')))}</div><button class="cohts-btn" data-x="1" aria-label="Close">✕ Close</button></div>
      <div class="cohps-two">${['home','away'].map(s=>`<div class="cohps-col">${head(s)}${T.pitchHtml(game, s, o)}</div>`).join('')}</div></div>`;
    ov.addEventListener('mousedown', ev=>{ if(ev.target===ov) close(); });
    ov.querySelector('[data-x]').onclick=close;
    document.addEventListener('keydown', key, true);
    document.body.appendChild(ov);
    return ov;
  };

  // A themed pick list with a free-text box. sections:[{label, items:[{value,label}]}]
  // → Promise<chosen value | typed name | null (cancelled)>. The value is the plain name.
  T.pick=function(o){
    o=o||{}; T._css();
    return new Promise(resolve=>{
      const ov=document.createElement('div'); ov.className='cohts-ov'; ov.style.alignItems='center';
      ov.innerHTML=`<div class="cohts-card cohts-pick"><div class="cohts-h">${esc(o.title||'Pick a player')}</div>
        ${o.message?`<div class="cohts-sub" style="margin-bottom:10px;">${esc(o.message)}</div>`:''}
        <input id="cohtsPickIn" placeholder="Type to search, or type any name…" autocomplete="off" spellcheck="false" value="">
        <div class="cohts-plist"></div>
        <div class="cohts-foot" style="margin-top:0;"><button class="cohts-btn" data-a="x">Cancel</button><button class="cohts-btn pri" data-a="ok">Use typed name</button></div></div>`;
      document.body.appendChild(ov);
      const inp=ov.querySelector('#cohtsPickIn'), list=ov.querySelector('.cohts-plist'); let vis=[], idx=-1;
      const done=v=>{ if(ov.parentNode) ov.parentNode.removeChild(ov); resolve(v); };
      const draw=()=>{
        const q=T.nameKey(inp.value); vis=[]; let h='';
        const anyNo=(o.sections||[]).some(sec=>(sec.items||[]).some(it=>{ const L=String(it.label), tail='. '+it.value; return L.length>tail.length&&L.slice(-tail.length)===tail; }));
        (o.sections||[]).forEach(sec=>{
          const items=(sec.items||[]).filter(it=>!q||T.nameKey(it.label).includes(q)||T.nameKey(it.value).includes(q));
          if(!items.length) return;
          // a light wash of the section's team colour (sec.color), so the two teams' players read apart
          let tint=window.cohTeamTint?window.cohTeamTint(sec.color, .2):''; if(!window.cohTeamTint){ let hx=String(sec.color||'').trim().replace(/^#/,''); if(/^[0-9a-f]{3}$/i.test(hx)) hx=hx.replace(/./g,c=>c+c);
            if(/^[0-9a-f]{6}$/i.test(hx)) tint='rgba('+parseInt(hx.slice(0,2),16)+','+parseInt(hx.slice(2,4),16)+','+parseInt(hx.slice(4,6),16)+',.2)'; }
          if(sec.label) h+=`<div class="cohts-pgh">${esc(sec.label)}</div>`;
          items.forEach(it=>{ const L=String(it.label), tail='. '+it.value, no=L.length>tail.length&&L.slice(-tail.length)===tail?L.slice(0,L.length-tail.length):'';
            const num=anyNo?`<span class="cohts-pno${no===''?' unk':''}">#${no===''?'..':esc(no)}</span>`:'';   // "#6" faded on the right; "#.." = no number known
            h+=`<div class="cohts-pi${tint?' tm':''}${it.value===o.current?' on':''}" data-v="${vis.length}"${tint?` style="--tc:${tint}"`:''}>${num}${esc(anyNo?it.value:it.label)}</div>`; vis.push(it.value); });
        });
        list.innerHTML=h||'<div class="cohts-pnone" style="padding:10px 12px;">No match — “Use typed name” keeps what you typed.</div>';
        idx=-1;
        list.querySelectorAll('.cohts-pi').forEach(d=>{ d.onclick=()=>done(vis[+d.dataset.v]); });
      };
      inp.oninput=draw;
      inp.onkeydown=ev=>{
        if(ev.key==='Escape') done(null);
        else if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){ ev.preventDefault(); if(!vis.length) return; idx=Math.max(0,Math.min(vis.length-1,idx+(ev.key==='ArrowDown'?1:-1)));
          list.querySelectorAll('.cohts-pi').forEach((d,i)=>d.classList.toggle('on',i===idx)); const on=list.querySelectorAll('.cohts-pi')[idx]; if(on&&on.scrollIntoView) on.scrollIntoView({block:'nearest'}); }
        else if(ev.key==='Enter'){ if(idx>=0) done(vis[idx]); else if(vis.length===1) done(vis[0]); else { const v=T.tidyName(inp.value); if(v) done(v); } }
      };
      ov.querySelector('[data-a="x"]').onclick=()=>done(null);
      ov.querySelector('[data-a="ok"]').onclick=()=>{ const v=T.tidyName(inp.value); if(v) done(v); };
      ov.addEventListener('mousedown',ev=>{ if(ev.target===ov) done(null); });
      draw(); setTimeout(()=>inp.focus(),0);
    });
  };
})();

/* ── a team's known players across its games ───────────────────────
 * cohTS.loadKnown(team, {exceptId, read, max}) → Promise<[names]>
 * From the app's own read gateway only (cohesionRead → the data function):
 * listGames gives every game's meta (other games' team sheets cost nothing);
 * the tagged names need the events, read for the team's `max` most recent
 * games, three at a time. Cached per team in localStorage for a day.
 * P-tags ("P11") are never names. A failure returns what was found so far.
 */
(function(root){
  'use strict';
  const T=root.cohTS, TTL=864e5, mem={};
  const up=s=>String(s==null?'':s).toUpperCase().trim();
  T.namesFromEvents=function(events, team){
    const U=up(team), out=[];
    // A player belongs to the team of his "<Team> Player Labels" group, not to
    // the row's team (a KERRY TOs row carries the Mayo player who won the
    // ball), and a group may hold several players — cohesion-labels.js
    // (cohEventPlayers; without it, the one value per group as before).
    // Assist names belong to the row's team.
    const push=n=>{ n=String(n==null?'':n).replace(/\s+/g,' ').trim(); if(n&&!/^P\s*\d+$/i.test(n)) out.push(n); };
    const players=root.cohEventPlayers||function(e){ const L=e.labels||{}, r=[];
      Object.keys(L).forEach(k=>{ const m=/^(.*?)\s*player labels$/i.exec(k); if(m&&L[k]) r.push({name:L[k], team:up(m[1])==='UNASSIGNED'||!up(m[1])?e.team:m[1]}); });
      if(e.player&&!r.some(p=>p.name===e.player)) r.unshift({name:e.player, team:e.playerTeam||e.team});
      return r; };
    (events||[]).forEach(e=>{ if(!e) return; const L=e.labels||{};
      players(e).forEach(p=>{ if(up(p.team)===U) push(p.name); });
      if(up(e.team)===U&&L['Assist']) push(L['Assist']); });
    return out;
  };
  T.loadKnown=function(team, o){
    o=o||{}; const U=up(team); if(!U) return Promise.resolve([]);
    const read=o.read||root.cohesionRead; if(typeof read!=='function') return Promise.resolve([]);
    // U20s games are a separate squad: a U20 game's sheet learns only from U20 games, every other game never from them
    // (o.section = the game's section; else the section the page shows). County / club work exactly as before.
    const u20=String(o.section||(typeof root.cohesionSection==='function'?root.cohesionSection():'')||'').toLowerCase()==='u20';
    const isU20=g=>String((g&&g.section)||'').toLowerCase()==='u20';
    const MK=U+(u20?'|u20':'');
    if(mem[MK]) return mem[MK];
    const key='coh_ts_known_'+U+(u20?'_u20':'');
    try{ const c=JSON.parse(root.localStorage.getItem(key)||'null'); if(c&&Array.isArray(c.names)&&Date.now()-(+c.ts||0)<TTL) return (mem[U]=Promise.resolve(c.names)); }catch(_){}
    const all=[], add=n=>{ if(T.nameKey(n)) all.push(String(n).replace(/\s+/g,' ').trim()); };
    return (mem[MK]=(async()=>{
      let ok=0;
      try{
        const j=await read({action:'listGames'});
        const games=((j&&j.games)||[]).map(g=>{ const m=Object.assign({}, (g&&g.meta)||g); if(m.id==null&&g&&g.id!=null) m.id=g.id; return m; }).filter(g=>g&&g.id&&(up(g.homeTeam)===U||up(g.awayTeam)===U)&&isU20(g)===u20);
        games.forEach(g=>T.sheet(g, up(g.homeTeam)===U?'home':'away').forEach(r=>add(r.name)));
        const recent=games.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,o.max||15);
        let next=0;
        const worker=async()=>{ while(next<recent.length){ const g=recent[next++];
          try{ const b=await read({action:'getEvents', gameId:g.id}); ok++; T.namesFromEvents(((b&&b.events)||[]).map(r=>r&&r.data), U).forEach(add); }catch(_){} } };
        await Promise.all(Array.from({length:Math.min(3,recent.length)},worker));
      }catch(_){}
      const keys=new Set(), names=[]; all.forEach(n=>{ const k=T.nameKey(n); if(!keys.has(k)){ keys.add(k); names.push(T.matchKnown(n, all)); } });
      names.sort((a,b)=>a.localeCompare(b));
      if(ok){ try{ root.localStorage.setItem(key, JSON.stringify({ts:Date.now(), names})); }catch(_){} } else delete mem[MK];
      return names;
    })());
  };
})(typeof window!=='undefined'?window:globalThis);
