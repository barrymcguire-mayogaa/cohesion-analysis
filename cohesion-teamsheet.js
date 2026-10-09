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
  // The existing spelling of `name` among `known` (first wins), or ''.
  function matchKnown(name, known){
    const k=nameKey(name); if(!k) return '';
    for(const n of (known||[])){ if(n!=null&&nameKey(n)===k) return String(n).replace(/\s+/g,' ').trim(); }
    return '';
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
      if(!name&&no==='') return;
      if(!name) w.push('No. '+no+' has no name — it will not be saved.');
      if(no!==''){ nos.set(no,(nos.get(no)||[]).concat(name||'?')); }
      if(name){ const k=nameKey(name); names.set(k,(names.get(k)||[]).concat(name)); }
      if(name&&cleanRole(r.role)==='start') starters++;
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
      if(hit&&hit!==name){ row.adopted=name; row.name=hit; }
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
      let cells=line.split(/\t+|\s*[;,]\s*|\s{3,}/).map(c=>c.trim()).filter(Boolean);
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

  // The automatic reader is not built: it needs a decision that is still open
  // (an API key held server-side). Nothing is uploaded or called from here.
  function fromFile(/* file */){
    return Promise.reject(new Error('Reading a team sheet from a photo or PDF is coming soon.'));
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
.cohts-soon{font-size:10.5px;color:var(--t3,#777);font-style:italic;}
.cohts-warn{margin-top:8px;font-size:11.5px;line-height:1.5;color:var(--orange,#f59e0b);}
.cohts-paste{margin-top:10px;border-top:1px dashed var(--border,#333);padding-top:10px;}
.cohts-paste textarea{min-height:92px;resize:vertical;font:500 12.5px Barlow,sans-serif;line-height:1.45;}
.cohts-lbl{font:700 10px 'Barlow Condensed',sans-serif;letter-spacing:.6px;text-transform:uppercase;color:var(--t3,#777);margin-bottom:4px;}
.cohts-prev{margin-top:8px;border:1px solid var(--border,#333);border-radius:8px;max-height:230px;overflow-y:auto;background:var(--card,#252530);}
.cohts-prow{display:grid;grid-template-columns:30px minmax(0,1fr) 44px;gap:6px;padding:5px 8px;font-size:12.5px;border-bottom:1px solid var(--border,#333);align-items:baseline;}
.cohts-prow:last-child{border-bottom:none;}
.cohts-prow b{text-align:right;color:var(--t2,#999);font-weight:700;}
.cohts-prow em{font:700 9.5px 'Barlow Condensed',sans-serif;letter-spacing:.5px;text-transform:uppercase;color:var(--t3,#777);font-style:normal;text-align:right;}
.cohts-prow em.sub{color:var(--accent,#4fc3f7);}
.cohts-prow small{display:block;font-size:10.5px;color:var(--accent,#4fc3f7);}
.cohts-pskip{padding:6px 8px;font-size:11px;color:var(--orange,#f59e0b);}
.cohts-foot{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap;margin-top:14px;}
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
.cohts-pl span{min-width:0;overflow-wrap:anywhere;}
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
})();
