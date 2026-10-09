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
