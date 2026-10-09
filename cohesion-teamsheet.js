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

  // ── validation: warnings only, nothing is blocked ─────────────
  function validate(rows){
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
    const raw=ev&&ev.labels&&ev.labels['Sub Detail']; if(!raw) return '';
    const out=subDetail(game, ev.team, raw);
    return out!==String(raw)?out:'';
  }

  // The one public hook for reading a team sheet from a photo or PDF:
  // cohTeamSheetFromFile(file, opts) → Promise<{home:{text,lines,confidence}, away:{…}, pages, source, …}>.
  // It is done in the browser by cohesion-teamsheet-reader.js (loaded on first use; the file is not uploaded).
  // A different reader could replace this one function. It never writes to a sheet.
  function fromFile(file, opts){
    if(!root.cohTS||typeof root.cohTS._reader!=='function') return Promise.reject(new Error('Reading a team sheet from a photo or PDF needs a browser.'));
    return root.cohTS._reader().then(R=>R.read(file, opts));
  }

  const API={ tidyName, nameKey, matchKnown, splitNumberName, normEntry, toStored, sideOf, sheet, hasSheet, sortRows, groups,
    validate, parsePaste, mergeMeta, label, orderedNames, sheetFirst, nameForNo, subDetail, subDetailFor, fromFile };
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
.cohts-ph .cohts-hd,.cohts-ph .cohts-row{grid-template-columns:46px 28px minmax(0,1fr) 86px 28px;}
.cohts-ph .cohts-sug{left:86px;}
.cohts-phb{width:28px;height:28px;display:flex;align-items:center;justify-content:center;}
.cohts-pnone{font-size:12px;color:var(--t3,#777);padding:6px 0;}
.cohts-pempty{text-align:center;padding:34px 12px;color:var(--t3,#777);font-size:13px;}
.cohts-pempty .cohts-btn{margin-top:12px;}
.cohts-pick{max-width:420px;}
.cohts-plist{border:1px solid var(--border,#333);border-radius:10px;max-height:min(380px,52vh);overflow-y:auto;margin:10px 0 12px;}
.cohts-pgh{padding:6px 12px 3px;font:700 9.5px 'Barlow Condensed',sans-serif;letter-spacing:.7px;text-transform:uppercase;color:var(--t3,#777);background:var(--card,#252530);}
.cohts-pi{padding:8px 12px;font:600 13.5px Barlow,sans-serif;cursor:pointer;border-bottom:1px solid var(--border,#333);}
.cohts-pi:hover,.cohts-pi.on{background:var(--accent,#4fc3f7);color:#fff;}
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
 *   persist:false,              keep the result in memory only (a local-video session)
 *   onSaved(mergedMeta, sheets) called after a successful save
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
      <div class="cohts-sub">Number, name and starter / sub for each team in this game. Type a name to search that team's known players, or paste a list and check the preview. Rows without a name are not saved. ${persist?'Saved to this game only.':'This is a local session — the sheet is kept until the page closes.'}</div>
      <div class="cohts-bar cohts-rdbar"><label class="cohts-btn cohts-file">📷 Read both teams from one photo / PDF<input type="file" accept="image/*,application/pdf" data-read="both" aria-label="Read both teams from one photo or PDF"></label><span class="cohts-soon">Read on this device — the file is not uploaded. The reader itself is downloaded from a public CDN (jsDelivr) the first time it is used, then kept by the browser.</span></div>
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
    function warnHtml(side){ return T.validate(S[side].rows).map(w=>'⚠ '+esc(w)).join('<br>'); }
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
      c.innerHTML=`<div class="cohts-team"><i style="background:${esc(colr)}"></i><span>${esc(teamName(side))}</span><small></small></div>
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
  T.panelHtml=function(game, o){
    o=o||{}; T._css(); game=game||{};
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
      const mark=r=>{ const l=marks&&marks.get(T.nameKey(r.name)); return l?l.map(x=>` <small class="cohts-sm ${x.type}">${esc(x.text)}</small>`).join(''):''; };
      const line=r=>`<div class="cohts-pl${badge?' ph':''}"><b>${esc(r.no)}</b>${badge?badge(nm, r.name, {size:24, color:colr}):''}<span>${esc(r.name)}${mark(r)}</span></div>`;
      const any=g.start.length+g.sub.length+g.other.length;
      return `<div class="cohts-pcol"><div class="cohts-pteam"><i style="background:${esc(colr)}"></i><span>${esc(nm)}</span></div>`+
        (any?(g.start.map(line).join('')+
          (g.sub.length?'<div class="cohts-pgrp">Subs</div>'+g.sub.map(line).join(''):'')+
          (g.other.length?'<div class="cohts-pgrp">Also listed</div>'+g.other.map(line).join(''):''))
          :'<div class="cohts-pnone">No team sheet added</div>')+'</div>';
    };
    return `<div class="cohts-panel"><div class="cohts-ptop"><div>${esc(o.title||'Team Sheets')}</div>${btn('✏️ Edit')}</div>
      <div class="cohts-pcols">${colHtml('home')}${colHtml('away')}</div></div>`;
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
        (o.sections||[]).forEach(sec=>{
          const items=(sec.items||[]).filter(it=>!q||T.nameKey(it.label).includes(q)||T.nameKey(it.value).includes(q));
          if(!items.length) return;
          if(sec.label) h+=`<div class="cohts-pgh">${esc(sec.label)}</div>`;
          items.forEach(it=>{ h+=`<div class="cohts-pi${it.value===o.current?' on':''}" data-v="${vis.length}">${esc(it.label)}</div>`; vis.push(it.value); });
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
    if(mem[U]) return mem[U];
    const key='coh_ts_known_'+U;
    try{ const c=JSON.parse(root.localStorage.getItem(key)||'null'); if(c&&Array.isArray(c.names)&&Date.now()-(+c.ts||0)<TTL) return (mem[U]=Promise.resolve(c.names)); }catch(_){}
    const all=[], add=n=>{ if(T.nameKey(n)) all.push(String(n).replace(/\s+/g,' ').trim()); };
    return (mem[U]=(async()=>{
      let ok=0;
      try{
        const j=await read({action:'listGames'});
        const games=((j&&j.games)||[]).map(g=>{ const m=Object.assign({}, (g&&g.meta)||g); if(m.id==null&&g&&g.id!=null) m.id=g.id; return m; }).filter(g=>g&&g.id&&(up(g.homeTeam)===U||up(g.awayTeam)===U));
        games.forEach(g=>T.sheet(g, up(g.homeTeam)===U?'home':'away').forEach(r=>add(r.name)));
        const recent=games.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,o.max||15);
        let next=0;
        const worker=async()=>{ while(next<recent.length){ const g=recent[next++];
          try{ const b=await read({action:'getEvents', gameId:g.id}); ok++; T.namesFromEvents(((b&&b.events)||[]).map(r=>r&&r.data), U).forEach(add); }catch(_){} } };
        await Promise.all(Array.from({length:Math.min(3,recent.length)},worker));
      }catch(_){}
      const keys=new Set(), names=[]; all.forEach(n=>{ const k=T.nameKey(n); if(!keys.has(k)){ keys.add(k); names.push(T.matchKnown(n, all)); } });
      names.sort((a,b)=>a.localeCompare(b));
      if(ok){ try{ root.localStorage.setItem(key, JSON.stringify({ts:Date.now(), names})); }catch(_){} } else delete mem[U];
      return names;
    })());
  };
})(typeof window!=='undefined'?window:globalThis);
