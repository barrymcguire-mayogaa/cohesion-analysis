/* COHESION — label helpers and the Sportscode XML import (shared).
 *
 * STORAGE (backward compatible)
 *   e.labels[group]      one string per group, exactly as before. When a
 *                        Sportscode instance carries the same group several
 *                        times this is the LAST value in the file (the value
 *                        the old import kept), so existing readers see what
 *                        they always saw.
 *   e.labelsAll[group]   [v1, v2, …] in file order — present ONLY for a group
 *                        that has more than one value on that event. Its last
 *                        entry equals e.labels[group].
 *   A single-value writer that only sets e.labels[group] is tolerated: the
 *   readers below treat that as "the last value was changed" (or, if the group
 *   was deleted, as "the group is gone") — the other values are not lost.
 *
 *   cohLabelValues(e, group)            -> every value of the group ([] if none); group match ignores case
 *   cohLabelHas(e, group, value)        -> true if the group holds that value
 *   cohLabelPairs(e)                    -> [[group, value], …] every value of every group
 *   cohLabelSetValues(e, group, values) -> write a group's full list (keeps labels / labelsAll in step)
 *   cohLabelReplace(e, group, from, to) -> replace every `from` in the group (to '' removes it); returns the count
 *   cohLabelsNormalize(e)               -> bring labelsAll back in step with labels (call before a save)
 *
 * PLAYERS
 *   A player's team comes from his label group ("<Team> Player Labels"), not
 *   from the row: a KERRY TOs row can carry a Mayo player.
 *   cohPlayerGroupTeam(group, meta)     -> 'MAYO' when the group is "<home|away> Player Labels", else ''
 *   cohEventPlayers(e, meta)            -> [{name, team, group}] every player on the event
 *   cohPlayerTeam(e, meta)              -> the team of e.player (label group, else e.playerTeam, else e.team)
 *   cohPlayerIndex(events, meta)        -> the game's known players; cohPlayerRowOf(e, index) -> {name, team} for a player row
 *
 * IMPORT (admin upload, re-parse, and the tests — one code path)
 *   cohScDecode(arrayBuffer)            -> text (UTF-16 LE/BE by BOM, else UTF-8)
 *   cohScInstances(xmlText)             -> [{id, code, start, end, labels:[[group,text],…]}]
 *   cohScFromDom(xmlDocument)           -> the same, from a parsed document
 *   cohScImport(instances, opts)        -> {events, error, markers, stats}
 *
 * Pure: no DOM (cohScFromDom aside), no globals needed. Loadable from Node.
 */
function cohLabelKey(obj, group){
  if(!obj||group==null) return null;
  if(Object.prototype.hasOwnProperty.call(obj, group)) return group;
  const g=String(group).toLowerCase();
  for(const k of Object.keys(obj)) if(k.toLowerCase()===g) return k;
  return null;
}
function cohLabelValues(e, group){
  if(!e) return [];
  const L=e.labels||{}, k=cohLabelKey(L, group);
  if(k==null) return [];
  const cur=L[k];
  if(cur==null||cur==='') return [];
  const ak=cohLabelKey(e.labelsAll, k), all=ak!=null?e.labelsAll[ak]:null;
  if(!Array.isArray(all)||all.length<2) return [cur];
  if(all[all.length-1]===cur) return all.slice();
  return all.slice(0,-1).concat([cur]);            // a single-value writer changed the last value
}
function cohLabelHas(e, group, value){ return cohLabelValues(e, group).indexOf(value)>=0; }
function cohLabelPairs(e){
  const out=[]; if(!e||!e.labels) return out;
  Object.keys(e.labels).forEach(g=>cohLabelValues(e, g).forEach(v=>out.push([g, v])));
  return out;
}
function cohLabelSetValues(e, group, values){
  if(!e) return e;
  const vals=(Array.isArray(values)?values:[values]).filter(v=>v!=null&&v!=='');
  const labels=Object.assign({}, e.labels||{}), all=Object.assign({}, e.labelsAll||{});
  const k=cohLabelKey(labels, group), key=k!=null?k:group, ak=cohLabelKey(all, key);
  if(ak!=null) delete all[ak];
  if(!vals.length){ if(k!=null) delete labels[k]; }
  else { labels[key]=vals[vals.length-1]; if(vals.length>1) all[key]=vals.slice(); }
  e.labels=labels;
  if(Object.keys(all).length) e.labelsAll=all; else delete e.labelsAll;
  return e;
}
function cohLabelReplace(e, group, from, to){
  const vals=cohLabelValues(e, group); let n=0;
  const next=[]; vals.forEach(v=>{ if(v===from){ n++; if(to!=null&&to!=='') next.push(to); } else next.push(v); });
  if(n) cohLabelSetValues(e, group, next);
  return n;
}
function cohLabelsNormalize(e){
  if(!e||!e.labelsAll) return e;
  const all={};
  Object.keys(e.labelsAll).forEach(g=>{ const v=cohLabelValues(e, g); if(v.length>1) all[cohLabelKey(e.labels, g)]=v; });
  if(Object.keys(all).length) e.labelsAll=all; else delete e.labelsAll;
  return e;
}

// ── players ───────────────────────────────────────────────────
const COH_PLAYER_GROUP_RE=/^(.*?)\s*player labels$/i;
function cohIsPlayerGroup(g){ return COH_PLAYER_GROUP_RE.test(String(g||'')); }
function cohPlayerGroupTeam(group, meta){
  const m=COH_PLAYER_GROUP_RE.exec(String(group||'')); if(!m) return '';
  const x=m[1].trim().toUpperCase(); if(!x||x==='UNASSIGNED') return '';
  if(!meta) return x;
  const h=String(meta.homeTeam||'').trim().toUpperCase(), a=String(meta.awayTeam||'').trim().toUpperCase();
  return x===h?h:x===a?a:'';
}
function cohEventPlayers(e, meta){
  const out=[]; if(!e) return out;
  Object.keys(e.labels||{}).forEach(g=>{ if(!cohIsPlayerGroup(g)) return;
    const t=cohPlayerGroupTeam(g, meta)||e.team||'';
    cohLabelValues(e, g).forEach(v=>out.push({name:v, team:t, group:g})); });
  if(e.player && !out.some(p=>p.name===e.player)) out.unshift({name:e.player, team:e.playerTeam||e.team||'', group:''});
  return out;
}
function cohPlayerTeam(e, meta){
  if(!e) return '';
  if(e.player){
    for(const g of Object.keys(e.labels||{})){
      if(cohIsPlayerGroup(g) && cohLabelHas(e, g, e.player)){ const t=cohPlayerGroupTeam(g, meta); if(t) return t; }
    }
  }
  return e.playerTeam||e.team||'';
}
// ── player rows of games already stored (derive on read) ──────
// A Sportscode "player row" is an instance whose code is a player's name. The
// import marks it (playerRow:true, player, team); events stored before that
// have team '' and player ''. cohPlayerIndex(events, meta) lists the game's
// known players (every value of every "<Team> Player Labels" group, then the
// team sheet) and cohPlayerRowOf(e, index) says whose row an event is:
//   -> {name, team} | null     (team upper-case; '' when it cannot be told)
function cohPlayerIndex(events, meta){
  meta=meta||{};
  const insts=(events||[]).map(e=>({labels:cohLabelPairs(e)}));
  return cohScPlayerIndex(insts, {homeTeam:meta.homeTeam, awayTeam:meta.awayTeam, rosters:meta.rosters});
}
function cohPlayerRowOf(e, index){
  if(!e) return null;
  if(e.playerRow) return e.player?{name:e.player, team:String(e.playerTeam||e.team||'').toUpperCase()}:null;
  if(e.team||e.player||!index) return null;
  const p=index.get(cohNameKey(e.code));
  return (p&&p.team!==null)?{name:p.name, team:p.team||''}:null;
}
// comparison key for a person's name: ignores case, spacing and apostrophe style
function cohNameKey(s){ return String(s==null?'':s).replace(/[‘’‛ʼ`´]/g,"'").toLowerCase().replace(/\s+/g,''); }

// ── Sportscode XML import ─────────────────────────────────────
// COHESION exports "<Team> Kickout Won By / Kickout Taken By / Kickout Target"
// (cohesion-xml.js): the import reads them back as the plain group.
const COH_SC_TEAM_GROUPS=['Assist','Kickout Won By','Kickout Taken By','Kickout Target'];
function cohScPlainGroup(g){
  const m=/^(.+) (assist|kickout won by|kickout taken by|kickout target)$/i.exec(String(g||'').trim());
  return m?COH_SC_TEAM_GROUPS.find(n=>n.toLowerCase()===m[2].toLowerCase()):g;
}
const COH_SC_PERIODS=['1st Half','2nd Half','ET 1st Half','ET 2nd Half'];
const COH_SC_SKIP=new Set(COH_SC_PERIODS.concat(['Count']));          // never stored as events
const COH_SC_NEUTRAL=new Set(['THROW-IN','Count']);                    // never a player row
function cohScDecode(buffer){
  const u8=new Uint8Array(buffer.buffer?buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset+buffer.byteLength):buffer);
  let text;
  if(u8[0]===0xFF && u8[1]===0xFE)      text=new TextDecoder('utf-16le').decode(u8);
  else if(u8[0]===0xFE && u8[1]===0xFF) text=new TextDecoder('utf-16be').decode(u8);
  else                                  text=new TextDecoder('utf-8').decode(u8);
  return text.replace(/^﻿/,'');
}
function cohScUnesc(s){
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/&#x([0-9a-f]+);/gi,(m,h)=>String.fromCodePoint(parseInt(h,16))).replace(/&#(\d+);/g,(m,d)=>String.fromCodePoint(+d))
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
}
function cohScTag(block, name){ const m=new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+name+'>').exec(block); return m?cohScUnesc(m[1]).trim():''; }
function cohScInstances(xmlText){
  const out=[];
  (String(xmlText||'').match(/<instance(?:\s[^>]*)?>[\s\S]*?<\/instance>/g)||[]).forEach(b=>{
    const labels=[];
    (b.match(/<label(?:\s[^>]*)?>[\s\S]*?<\/label>/g)||[]).forEach(l=>labels.push([cohScTag(l,'group'), cohScTag(l,'text')]));
    const head=b.replace(/<label(?:\s[^>]*)?>[\s\S]*?<\/label>/g,'');
    out.push({id:cohScTag(head,'ID'), code:cohScTag(head,'code'), start:parseFloat(cohScTag(head,'start')||0), end:parseFloat(cohScTag(head,'end')||0), labels});
  });
  return out;
}
function cohScFromDom(doc){
  const txt=(n, sel)=>{ const x=n.querySelector(sel); return x&&x.textContent?x.textContent.trim():''; };
  return Array.from(doc.querySelectorAll('instance')).map(inst=>({
    id:txt(inst,'ID'), code:txt(inst,'code'), start:parseFloat(txt(inst,'start')||0), end:parseFloat(txt(inst,'end')||0),
    labels:Array.from(inst.querySelectorAll('label')).map(l=>[txt(l,'group'), txt(l,'text')]) }));
}
// ── <ROWS>: the file's row order and row colours ─────────────────
// Sportscode writes 16-bit channels (0–65535). A row is kept as
//   {code, colour:'#rrggbb'}            when every channel is a multiple of 257 (8-bit exact), else
//   {code, colour:'#rrggbb', rgb16:[r,g,b]}   so the export can give the same numbers back.
function cohRgb16ToHex(r, g, b){ return '#'+[r,g,b].map(v=>{ const x=Math.max(0, Math.min(255, Math.round((+v||0)/257))); return (x<16?'0':'')+x.toString(16); }).join(''); }
function cohHexToRgb16(hex){
  let h=String(hex||'').trim().replace(/^#/,''); if(/^[0-9a-f]{3}$/i.test(h)) h=h.replace(/./g,'$&$&');
  if(!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)*257);
}
function cohScRowOf(code, r, g, b){
  const ch=[r,g,b].map(v=>Math.max(0, Math.min(65535, Math.round(+v||0))));
  const row={code:String(code||''), colour:cohRgb16ToHex(ch[0],ch[1],ch[2])};
  if(ch.some(v=>v%257)) row.rgb16=ch;
  return row;
}
function cohScRows(xmlText){
  const m=/<ROWS(?:\s[^>]*)?>([\s\S]*?)<\/ROWS>/.exec(String(xmlText||'')); if(!m) return [];
  return (m[1].match(/<row(?:\s[^>]*)?>[\s\S]*?<\/row>/g)||[]).map(b=>cohScRowOf(cohScTag(b,'code'), cohScTag(b,'R'), cohScTag(b,'G'), cohScTag(b,'B'))).filter(r=>r.code);
}
function cohScRowsFromDom(doc){
  const txt=(n, sel)=>{ const x=n.querySelector(sel); return x&&x.textContent?x.textContent.trim():''; };
  return Array.from(doc.querySelectorAll('ROWS > row')).map(n=>cohScRowOf(txt(n,'code'), txt(n,'R'), txt(n,'G'), txt(n,'B'))).filter(r=>r.code);
}
// the 16-bit channels a row is exported with: its stored rgb16 while the colour is still the one read with it
function cohRowRgb16(row){
  if(row&&Array.isArray(row.rgb16)&&row.rgb16.length===3&&cohRgb16ToHex(row.rgb16[0],row.rgb16[1],row.rgb16[2])===String(row.colour||'').toLowerCase()) return row.rgb16.slice();
  return cohHexToRgb16(row&&row.colour)||[40092,41891,44975];   // #9ca3af
}
// meta.rows -> Map(code -> '#rrggbb'): the file's colour of a row
function cohRowColours(meta){ const m=new Map(); ((meta&&Array.isArray(meta.rows))?meta.rows:[]).forEach(r=>{ if(r&&r.code&&r.colour&&!m.has(r.code)) m.set(r.code, r.colour); }); return m; }
// Merge-only-your-field: a fresh copy of the game's meta with rows set (nothing else touched)
function cohRowsMergeMeta(meta, rows){ const m=Object.assign({}, meta||{}); if(Array.isArray(rows)&&rows.length) m.rows=rows.map(r=>Object.assign({}, r)); else delete m.rows; return m; }
function cohScCategory(code){
  if(/SHOT|1 POINT|2 POINT|WIDE|GOAL|SAVE|BLOCKED|SHORT|WOODWORK/.test(code)) return 'Shots & Scores';
  if(/KO/.test(code) && !/SCORE|ATTACK/.test(code)) return 'Kickouts';
  if(/FOUL|CARD|TECHNICAL/.test(code)) return 'Fouls';
  if(/TOs|TURNOVER/.test(code)) return 'Turnovers';
  if(/TACKLE/.test(code)) return 'Tackles';
  if(/ATTACKS|ENTRY|POSSESSION|SCORE SOURCE|SCORE ASSIST|SHOT SOURCE|SHOT ASSIST/.test(code)) return 'Possession & Attack';
  if(/SUB/.test(code)) return 'Other';
  return 'Player Actions';
}
// a team-sheet entry (string "7 Name" / "Name (7)" / {name|player}) -> the bare name
function cohScSheetName(x){
  let s=x&&typeof x==='object'?(x.name!=null?x.name:x.player):x;
  s=String(s==null?'':s).replace(/\s+/g,' ').trim();
  return s.replace(/^#?\s*\d{1,3}\s*(?:[.\-–—:)]+\s*|\s+)(?=\S)/,'').replace(/\s*[(\[]\s*#?\s*\d{1,3}\s*[)\]]$/,'').trim();
}
// Every known player of the file: nameKey -> {name (spelling used most), team ('' unknown, null = on both teams)}
function cohScPlayerIndex(insts, opts){
  const meta={homeTeam:opts.homeTeam, awayTeam:opts.awayTeam}, idx=new Map();
  const add=(name, team)=>{ const k=cohNameKey(name); if(!k) return;
    let r=idx.get(k); if(!r){ r={name:'', team:team, sp:new Map()}; idx.set(k, r); }
    else if(r.team!==team){ if(!r.team&&r.team!==null) r.team=team; else if(team&&r.team!==null) r.team=null; }
    const s=String(name).replace(/\s+/g,' ').trim(); r.sp.set(s,(r.sp.get(s)||0)+1); };
  (insts||[]).forEach(i=>(i.labels||[]).forEach(l=>{ if(l[1]&&cohIsPlayerGroup(l[0])) add(l[1], cohPlayerGroupTeam(l[0], meta)); }));
  const ro=opts.rosters||{};
  [['home',opts.homeTeam],['away',opts.awayTeam]].forEach(([side, t])=>(Array.isArray(ro[side])?ro[side]:[]).forEach(x=>{
    const n=cohScSheetName(x); if(n) add(n, String(t||'').trim().toUpperCase()); }));
  idx.forEach(r=>{ let bn=0; r.sp.forEach((c, s)=>{ if(c>bn){ bn=c; r.name=s; } }); delete r.sp; });
  return idx;
}
/* cohScImport(instances, opts) — the Sportscode branch of the admin upload.
 *   opts.homeTeam / opts.awayTeam   as typed on the upload form
 *   opts.videoStarts                {'1st Half':s, '2nd Half':s, 'ET 1st Half':s|null, 'ET 2nd Half':s|null}
 *                                   video second of each period start (omit: video time = coder clock)
 *   opts.gameTime(half, start, refs) -> the "1H 12:34" string (omit: no gameTime field)
 *   opts.category(code)             default cohScCategory
 *   opts.rosters                    the game's team sheet {home:[…], away:[…]} if it has one
 * Returns {events, error, markers, stats}. Per instance:
 *   labels[g]  = the LAST value of the group (unchanged behaviour), labelsAll[g] = every value when there are several
 *   team       = the Team Name label, else the team named in the code           (teamDerived:true when not from a label)
 *   player     = the (last) value of the first "<X> Player Labels" group; playerTeam = X when X is the home or away team
 *   a row whose code is a known player's name (and names no team) is a PLAYER ROW:
 *     player = that name, team = playerTeam = his team, playerRow:true, category 'Player Involvement'
 */
function cohScImport(insts, opts){
  opts=opts||{}; insts=insts||[];
  const homeTeam=String(opts.homeTeam||''), awayTeam=String(opts.awayTeam||''), HOME=homeTeam.toUpperCase(), AWAY=awayTeam.toUpperCase();
  const meta={homeTeam, awayTeam}, category=opts.category||cohScCategory;
  const refs={'1st Half':null,'2nd Half':null,'ET 1st Half':null,'ET 2nd Half':null};
  insts.forEach(i=>{ if(Object.prototype.hasOwnProperty.call(refs, i.code) && refs[i.code]===null) refs[i.code]=i.start; });
  const stats={instances:insts.length, events:0, labelValues:0, multiValueEvents:0, extraValues:0, playerRows:0, playerTeamOtherRow:0, unmatchedCodes:{}};
  if(refs['1st Half']===null) return {events:[], error:'Could not find "1st Half" marker in the XML.', markers:refs, stats};
  if(refs['2nd Half']===null) return {events:[], error:'Could not find "2nd Half" marker in the XML.', markers:refs, stats};
  const vs=opts.videoStarts||null;
  const offsets={}; COH_SC_PERIODS.forEach(h=>{ offsets[h]=vs ? (vs[h]!=null&&refs[h]!==null ? vs[h]-refs[h] : null) : 0; });
  const players=cohScPlayerIndex(insts, opts);
  const events=[];
  insts.forEach(inst=>{
    const code=inst.code||'';
    if(COH_SC_SKIP.has(code)) return;
    const start=inst.start||0, end=inst.end||0;
    const labels={}, lists={};
    (inst.labels||[]).forEach(l=>{ const g=cohScPlainGroup(l[0])||'NO_GROUP', t=l[1]||''; if(!t) return; labels[g]=t; (lists[g]=lists[g]||[]).push(t); });
    let half='1st Half';
    if(refs['ET 2nd Half']!==null && start>=refs['ET 2nd Half']) half='ET 2nd Half';
    else if(refs['ET 1st Half']!==null && start>=refs['ET 1st Half']) half='ET 1st Half';
    else if(refs['2nd Half']!==null && start>=refs['2nd Half']) half='2nd Half';
    const offset=offsets[half]||0;
    const driveT=Math.max(0, Math.round(start+offset)-2);
    let team=labels['Team Name'] || (code.includes(HOME)?HOME: code.includes(AWAY)?AWAY:'');
    const teamDerived=!!team && !labels['Team Name'];
    // Player comes ONLY from a dedicated "<Team> Player Labels" group.
    const playerGroupKey=Object.keys(labels).find(k=>/player labels$/i.test(k));
    let player=playerGroupKey ? labels[playerGroupKey] : '';
    let playerTeam=playerGroupKey ? cohPlayerGroupTeam(playerGroupKey, meta) : '';
    const outcome=labels['Shot Outcomes']||labels['Game Involvement Outcomes']||labels['Kickout Outcomes']||labels['Turnover Outcomes']||labels['Tackle Outcomes']||'';
    const subtype=labels['Deadball Shot Type']||labels['Shot Zones']||labels['Kickout Locations']||'';
    // Keep EVERY label group (ungrouped values under 'General'); Team Name is promoted to team.
    const kept={}, all={};
    Object.keys(labels).forEach(g=>{ if(g==='Team Name') return; const k=g==='NO_GROUP'?'General':g; kept[k]=labels[g]; stats.labelValues+=lists[g].length; if(lists[g].length>1){ all[k]=lists[g].slice(); stats.extraValues+=lists[g].length-1; } });
    const ev={ id:inst.id||String(events.length+1), start:start, end:end, half };   // exact file times (driveT stays a whole video second)
    if(opts.gameTime) ev.gameTime=opts.gameTime(half, start, refs);
    let cat=category(code), playerRow=false;
    if(!team && !COH_SC_NEUTRAL.has(code)){
      const p=players.get(cohNameKey(code));
      if(p && p.team!==null){ playerRow=true; if(!player) player=p.name; team=p.team||''; playerTeam=p.team||''; cat='Player Involvement'; stats.playerRows++; }
      else stats.unmatchedCodes[code]=(stats.unmatchedCodes[code]||0)+1;
    }
    Object.assign(ev, { code, team, player, outcome, subtype, category:cat, driveT, labels:kept });
    if(Object.keys(all).length){ ev.labelsAll=all; stats.multiValueEvents++; }
    if(playerTeam) ev.playerTeam=playerTeam;
    if(playerTeam && team && playerTeam!==team) stats.playerTeamOtherRow++;
    if(playerRow){ ev.playerRow=true; if(team) ev.teamDerived=true; }
    else if(teamDerived) ev.teamDerived=true;
    if(kept[COH_BREAK_NOTE_GROUP]===COH_BREAK_NOTE&&cohIsBreakRow(ev)) ev.derived='break-pair';   // a break row COHESION added, back from its own export
    events.push(ev);
  });
  // the opposition's break row of every break-ball kickout (the template logs only the kicking team's)
  stats.breakPairs={kickouts:0, had:0, added:0, both:0};
  if(opts.breakPairs!==false){
    const bp=cohScBreakPairs(events, {homeTeam, awayTeam, category});
    stats.breakPairs=bp.stats;
    bp.added.forEach(r=>{ const kid=String(r.id).replace(/^bp-/,'').replace(/-[wl]$/,''); let at=events.findIndex(e=>String(e.id)===kid&&cohIsKoRow(e));   // straight after its kickout: the file's order is kept
      if(at<0) at=events.length-1; while(at+1<events.length&&events[at+1].derived==='break-pair'&&String(events[at+1].id).indexOf('bp-'+kid+'-')===0) at++;
      events.splice(at+1, 0, r); });
  }
  stats.events=events.length;
  // the file's own period rows (code, start, end), so a raw-clock export can give them back exactly: meta.scPeriods
  const periods=insts.filter(i=>Object.prototype.hasOwnProperty.call(refs, i.code)).map(i=>({code:i.code, start:i.start, end:i.end}));
  return {events, error:null, markers:refs, offsets, stats, periods};
}

if(typeof module!=='undefined'&&module.exports) module.exports={cohLabelKey, cohLabelValues, cohLabelHas, cohLabelPairs, cohLabelSetValues, cohLabelReplace, cohLabelsNormalize,
  cohIsPlayerGroup, cohPlayerGroupTeam, cohEventPlayers, cohPlayerTeam, cohPlayerIndex, cohPlayerRowOf, cohNameKey,
  cohScDecode, cohScInstances, cohScFromDom, cohScCategory, cohScSheetName, cohScPlayerIndex, cohScImport, COH_SC_PERIODS,
  cohScPlainGroup, cohRgb16ToHex, cohHexToRgb16, cohScRows, cohScRowsFromDom, cohRowRgb16, cohRowColours, cohRowsMergeMeta};

/* ── Existing games: bring back the label values the old import dropped ──
 * cohScRestore(rows, instances) — rows = the game's stored events ([{id, data}]),
 * instances = cohScInstances() of the ORIGINAL Sportscode file. ADD-ONLY and
 * strict: nothing is deleted, replaced or re-timed.
 *   · a stored event is matched to its instance by <ID> + code + start second
 *     (an event that was re-coded, moved in time or created later is skipped);
 *   · for a group the file repeats on that instance, labelsAll[g] is added ONLY
 *     when the stored labels[g] is still the file's last value (the one the old
 *     import kept) — a group edited or removed since is left exactly as it is;
 *   · if under 80% of the game's file-born events match, the file is taken
 *     to be the wrong one and nothing is proposed.
 *   · opts.times: also put back the file's exact start / end (see below) — safe because it
 *     only replaces a value that is still round(file value).
 * Returns {ok, reason, updates:[{id, data}], stats}. The caller writes updates.
 */
function cohScRestore(rows, insts, opts){
  const wantTimes=!!(opts&&opts.times);
  const stats={stored:(rows||[]).length, matched:0, notInFile:0, moved:0, recoded:0, events:0, values:0, already:0, editedGroups:0, fileExtraValues:0, times:0, timeEvents:0};
  const byId=new Map(); (insts||[]).forEach(i=>{ if(!COH_SC_SKIP.has(i.code||'')) byId.set(String(i.id), i); });
  const updates=[];
  (rows||[]).forEach(r=>{
    const d=r&&r.data; if(!d) return;
    const inst=byId.get(String(d.id));
    if(!inst){ stats.notInFile++; return; }
    if(inst.code!==d.code){ stats.recoded++; return; }
    if(Math.round(inst.start||0)!==Math.round(+d.start||0)){ stats.moved++; return; }   // whole seconds on both sides: a stored start may be exact or rounded
    stats.matched++;
    const lists={}; (inst.labels||[]).forEach(l=>{ const g=l[0]||'NO_GROUP'; if(!l[1]||g==='Team Name') return; const k=g==='NO_GROUP'?'General':g; (lists[k]=lists[k]||[]).push(l[1]); });
    let nd=null;
    Object.keys(lists).forEach(g=>{ const v=lists[g]; if(v.length<2) return;
      const cur=cohLabelValues(d, g);
      if(cur.length===v.length && cur.every((x,i)=>x===v[i])){ stats.already+=v.length-1; return; }
      if(cur.length!==1 || !Object.prototype.hasOwnProperty.call(d.labels||{}, g) || d.labels[g]!==v[v.length-1]){ stats.editedGroups++; return; }
      if(!nd) nd=Object.assign({}, d, {labelsAll:Object.assign({}, d.labelsAll||{})});
      nd.labelsAll[g]=v.slice(); stats.values+=v.length-1; });
    const labelled=!!nd;
    // exact times (opts.times): the stored start / end is put back to the file's value ONLY while it still is
    // that value rounded to a whole second — an event dragged, resized or sync-shifted since is left alone.
    // driveT (the video position) is never touched.
    if(wantTimes){ let n=0; const fs=+inst.start||0, fe=+inst.end||0;
      const set=(k, v)=>{ if(typeof d[k]==='number'&&d[k]!==v&&d[k]===Math.round(v)){ if(!nd) nd=Object.assign({}, d); nd[k]=v; n++; } };
      set('start', fs); set('end', fe);
      if(n){ stats.times+=n; stats.timeEvents++; } }
    if(nd){ updates.push({id:r.id, data:nd}); if(labelled) stats.events++; }
  });
  (insts||[]).forEach(i=>{ if(COH_SC_SKIP.has(i.code||'')) return; const c={}; (i.labels||[]).forEach(l=>{ if(l[1]&&l[0]!=='Team Name') c[l[0]]=(c[l[0]]||0)+1; }); Object.values(c).forEach(n=>{ stats.fileExtraValues+=n-1; }); });
  const born=stats.matched+stats.moved+stats.recoded;
  if(!byId.size) return {ok:false, reason:'The file has no Sportscode instances.', updates:[], stats};
  if(!born || stats.matched/Math.max(1, byId.size)<0.8) return {ok:false, reason:'This does not look like the file the game was imported from: only '+stats.matched+' of its '+byId.size+' instances match a stored event (ID, code and start time).', updates:[], stats};
  return {ok:true, reason:'', updates, stats};
}
if(typeof module!=='undefined'&&module.exports) module.exports.cohScRestore=cohScRestore;

/* ── Names and values follow the game's own template ─────────────
 * A game imported from Sportscode already has its own spelling of every label
 * group ("Mayo Player Labels", "Turnover Location"); COHESION must write into
 * THAT group, never a twin ("MAYO Player Labels", "Turnover Locations").
 *   cohGroupCanon(name)                 comparison key: case, spacing and a trailing plural "s" ignored; known misspellings folded
 *   cohGroupIndex(events)               Map(canon -> Map(spelling -> uses)) of the game's groups
 *   cohGroupResolve(src, name)          the spelling the game already uses for `name` (most used; never a known
 *                                       misspelling), else `name` itself. src = events or a cohGroupIndex
 *   cohPlayerGroupFor(src, team, meta)  the game's "<Team> Player Labels" group for the team (any case), else
 *                                       "<team as entered in the game's meta> Player Labels"
 *   cohLabelKeyEq(labels, name)         the key of an equivalent group on one event (exact, then any case, then canon)
 *   cohLabelGet(e, name) / cohLabelVal  every value / the last value of the group under ANY equivalent spelling
 *   cohValueCanon(group, value)         comparison key of a value ('45 and '45 SHOT are one Deadball Shot Type)
 *   cohValueOptions(src, group, opts)   dropdown list: the config options (in the game's spelling where it has an
 *                                       equivalent) followed by the game's other values of that group
 */
const COH_GROUP_ALIAS={'shot asisst outcome':'shot assist outcome', 'score asisst outcome':'score assist outcome'};
function cohGroupKey0(g){ return String(g==null?'':g).replace(/\s+/g,' ').trim().toLowerCase().replace(/s$/,''); }
function cohGroupCanon(g){ const k=cohGroupKey0(g); return COH_GROUP_ALIAS[k]||k; }
function cohGroupMisspelt(g){ return Object.prototype.hasOwnProperty.call(COH_GROUP_ALIAS, cohGroupKey0(g)); }
function cohGroupIndex(events){
  const idx=new Map();
  (events||[]).forEach(e=>{ const L=(e&&e.labels)||{}; Object.keys(L).forEach(g=>{ if(L[g]==null||L[g]==='') return;
    const k=cohGroupCanon(g); let m=idx.get(k); if(!m){ m=new Map(); idx.set(k, m); } m.set(g, (m.get(g)||0)+1); }); });
  return idx;
}
function cohGroupResolve(src, name){
  const idx=src instanceof Map?src:cohGroupIndex(src), m=idx.get(cohGroupCanon(name));
  let best=null, bn=0;
  if(m) m.forEach((n, g)=>{ if(cohGroupMisspelt(g)) return; if(n>bn||(n===bn&&g===name)){ best=g; bn=n; } });
  return best||name;
}
function cohTeamCasing(team, meta){
  const T=String(team||'').trim(), U=T.toUpperCase(), h=String((meta&&meta.homeTeam)||'').trim(), a=String((meta&&meta.awayTeam)||'').trim();
  return U&&U===h.toUpperCase()?h:U&&U===a.toUpperCase()?a:T;
}
function cohPlayerGroupFor(src, team, meta){
  const T=String(team||'').trim(); if(!T) return 'Unassigned Player Labels';
  const idx=src instanceof Map?src:cohGroupIndex(src); let best=null, bn=0;
  idx.forEach(m=>m.forEach((n, g)=>{ const x=COH_PLAYER_GROUP_RE.exec(g); if(x&&x[1].trim().toUpperCase()===T.toUpperCase()&&n>bn){ best=g; bn=n; } }));
  return best||(cohTeamCasing(T, meta)+' Player Labels');
}
function cohLabelKeyEq(obj, group){
  const k=cohLabelKey(obj, group); if(k!=null||!obj||group==null) return k;
  const c=cohGroupCanon(group); let hit=null;
  for(const x of Object.keys(obj)){ if(cohGroupCanon(x)!==c) continue; if(obj[x]==null||obj[x]==='') continue; if(!cohGroupMisspelt(x)) return x; if(hit==null) hit=x; }
  return hit;
}
function cohLabelGet(e, group){ const k=cohLabelKeyEq(e&&e.labels, group); return k==null?[]:cohLabelValues(e, k); }
function cohLabelVal(e, group){ const v=cohLabelGet(e, group); return v.length?v[v.length-1]:''; }
function cohValueCanon(group, v){
  const s=String(v==null?'':v).replace(/[‘’‛ʼ`´]/g,"'").replace(/\s+/g,' ').trim().toUpperCase();
  if(cohGroupCanon(group)==='deadball shot type' && /^'?45(\s+SHOT)?$/.test(s)) return "'45";
  return s;
}
// a 45 as a Deadball Shot Type value, however the game spells it: '45 · 45 · '45 SHOT
function cohIs45(v){ return cohValueCanon('Deadball Shot Type', v)==="'45"; }
function cohValueOptions(src, group, options){
  const events=Array.isArray(src)?src:[], c=cohGroupCanon(group), seen=new Map();   // value canon -> Map(spelling -> uses)
  events.forEach(e=>{ const L=(e&&e.labels)||{}; Object.keys(L).forEach(g=>{ if(cohGroupCanon(g)!==c) return;
    cohLabelValues(e, g).forEach(v=>{ const k=cohValueCanon(group, v); let m=seen.get(k); if(!m){ m=new Map(); seen.set(k, m); } m.set(v, (m.get(v)||0)+1); }); }); });
  const spell=(k, dflt)=>{ const m=seen.get(k); if(!m) return dflt; let best=dflt, bn=0; m.forEach((n, v)=>{ if(n>bn||(n===bn&&v===dflt)){ best=v; bn=n; } }); return best; };
  const out=[], done=new Set();
  (options||[]).forEach(o=>{ const k=cohValueCanon(group, o); if(done.has(k)) return; done.add(k); out.push(spell(k, o)); });
  [...seen.keys()].filter(k=>!done.has(k)).map(k=>[spell(k, k), [...seen.get(k).values()].reduce((a,b)=>a+b,0)]).sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))).forEach(x=>out.push(x[0]));
  return out;
}
if(typeof module!=='undefined'&&module.exports) Object.assign(module.exports, {cohGroupCanon, cohGroupMisspelt, cohGroupIndex, cohGroupResolve, cohTeamCasing, cohPlayerGroupFor, cohLabelKeyEq, cohLabelGet, cohLabelVal, cohValueCanon, cohIs45, cohValueOptions});

/* ── Assists logged as rows (the Sportscode template) ─────────────
 * The template logs a shot's assist as its own row: "<TEAM> SCORE ASSIST" for a
 * shot that scored, "<TEAM> SHOT ASSIST" for one that did not; the assister is
 * the row's player (the team's Player Labels group) and the type is its
 * "Score Assist Outcomes" / "Shot Assist Outcomes" label. Derived on read —
 * stored shots are never rewritten.
 *   cohAssistIndex(events, meta) -> {byShot:Map(shot -> {row, name, type}), byRow:Map(row -> shot), unlinked:[rows], stats}
 *   cohShotAssist(shot, index)   -> {name, type, source:'label'|'row', row} | null
 *       the shot's own 'Assist' label always wins; else its linked row's player.
 * LINK RULE (per team, one row per shot, never crossing in time within a kind):
 *   · SCORE ASSIST rows pair with shots that scored, SHOT ASSIST rows with shots that did not;
 *   · a row and a shot pair when their windows overlap, or — a free / 45 won before a
 *     dead-ball shot — when the row ends up to COH_ASSIST_GAP seconds before a DEAD BALL shot starts;
 *   · among the allowed pairings the one that links the most rows wins, then the least time apart.
 */
const COH_SHOT_RE=/SHOT\s+(OPEN|DEAD)/i, COH_ASSIST_ROW_RE=/\b(SHOT|SCORE)\s+ASSIST\s*$/i, COH_ASSIST_GAP=180;
function cohUp(s){ return String(s==null?'':s).trim().toUpperCase(); }
function cohIsShotRow(e){ const c=String((e&&e.code)||''); return COH_SHOT_RE.test(c)&&!/SOURCE|ASSIST/i.test(c); }
function cohIsAssistRow(e){ return COH_ASSIST_ROW_RE.test(String((e&&e.code)||'')); }
// true scored · false not · null no outcome
function cohShotScored(e){ const o=cohUp(cohLabelVal(e,'Shot Outcomes')||(e&&e.outcome)); return !o?null:/^(1 POINT|2 POINT|POINT|GOAL)$/.test(o); }
// the first player of `team` on a row (his label group names the team), else the row's own player when the row is that team's
function cohRowPlayerOf(row, team, meta){
  const T=cohUp(team), P=cohEventPlayers(row, meta), hit=P.find(p=>p.group&&cohUp(p.team)===T)||P.find(p=>cohUp(p.team)===T);
  return hit?hit.name:'';
}
function cohAssistType(row){ return cohLabelVal(row, /SCORE/i.test(row.code||'')?'Score Assist Outcomes':'Shot Assist Outcomes')||cohLabelVal(row,'Score Assist Outcomes')||cohLabelVal(row,'Shot Assist Outcomes')||''; }
// order-preserving best pairing of two time-sorted lists; cost(a, b) -> seconds apart, or null when not allowed
function cohAlign(A, B, cost){
  const n=A.length, m=B.length, BIG=1e7, S=[], W=[];
  for(let i=0;i<=n;i++){ S.push(new Float64Array(m+1)); W.push(new Uint8Array(m+1)); }
  for(let i=1;i<=n;i++) for(let j=1;j<=m;j++){
    let best=S[i-1][j], w=1; if(S[i][j-1]>best){ best=S[i][j-1]; w=2; }
    const c=cost(A[i-1], B[j-1]); if(c!=null){ const v=S[i-1][j-1]+BIG-c; if(v>best){ best=v; w=3; } }
    S[i][j]=best; W[i][j]=w;
  }
  const out=[]; let i=n, j=m;
  while(i>0&&j>0){ const w=W[i][j]; if(w===3){ out.push([A[i-1], B[j-1]]); i--; j--; } else if(w===1) i--; else j--; }
  return out.reverse();
}
function cohAssistIndex(events, meta){
  const idx={byShot:new Map(), byRow:new Map(), unlinked:[], stats:{}};
  const byTeam=new Map(), teamOf=e=>cohUp(e.team), T0=e=>+(e.start!=null?e.start:e.driveT)||0, T1=e=>+(e.end!=null?e.end:T0(e)+4)||0;
  (events||[]).forEach(e=>{ if(!e||!e.team) return; const s=cohIsShotRow(e), a=!s&&cohIsAssistRow(e); if(!s&&!a) return;
    let t=byTeam.get(teamOf(e)); if(!t){ t={shots:[], rows:[]}; byTeam.set(teamOf(e), t); } (s?t.shots:t.rows).push(e); });
  const cost=(row, shot)=>{
    if(row.half&&shot.half&&row.half!==shot.half) return null;
    const a0=T0(row), a1=T1(row), b0=T0(shot), b1=T1(shot);
    if(a0<b1&&a1>b0) return Math.abs(a0-b0)/1000;                       // overlapping windows
    const gap=b0-a1; if(gap<0) return null;                             // an assist never follows its shot
    if(gap<=5) return gap;
    return (/DEAD/i.test(shot.code||'')&&gap<=COH_ASSIST_GAP)?gap:null;  // free / 45 won, then the dead ball
  };
  byTeam.forEach((t, team)=>{
    t.shots.sort((a,b)=>T0(a)-T0(b)); t.rows.sort((a,b)=>T0(a)-T0(b));
    const link=(row, shot)=>{ idx.byRow.set(row, shot); idx.byShot.set(shot, {row, name:cohRowPlayerOf(row, team, meta), type:cohAssistType(row)}); };
    [[true, /SCORE\s+ASSIST/i], [false, /SHOT\s+ASSIST/i]].forEach(([sc, re])=>
      cohAlign(t.rows.filter(r=>re.test(r.code||'')), t.shots.filter(s=>cohShotScored(s)===sc), cost).forEach(p=>link(p[0], p[1])));
    // shots with no outcome yet: whatever rows are left, overlap only
    cohAlign(t.rows.filter(r=>!idx.byRow.has(r)), t.shots.filter(s=>cohShotScored(s)===null&&!idx.byShot.has(s)), (r, s)=>{ const c=cost(r, s); return c!=null&&c<1?c:null; }).forEach(p=>link(p[0], p[1]));
    t.rows.forEach(r=>{ if(!idx.byRow.has(r)) idx.unlinked.push(r); });
    idx.stats[team]={shots:t.shots.length, rows:t.rows.length, linked:t.rows.filter(r=>idx.byRow.has(r)).length, shotsLinked:t.shots.filter(s=>idx.byShot.has(s)).length};
  });
  return idx;
}
const COH_AS_CACHE=(typeof WeakMap!=='undefined')?new WeakMap():null;
// for readers whose events array is not edited in place (Analysis, dashboard statistics)
function cohAssistIndexCached(events, meta){
  if(!COH_AS_CACHE||!events||typeof events!=='object') return cohAssistIndex(events, meta);
  const sig=events.length+'|'+((meta&&meta.homeTeam)||'')+'|'+((meta&&meta.awayTeam)||''), c=COH_AS_CACHE.get(events);
  if(c&&c.sig===sig) return c.idx;
  const idx=cohAssistIndex(events, meta); COH_AS_CACHE.set(events, {sig, idx}); return idx;
}
function cohShotAssist(shot, idx){
  if(!shot) return null;
  const lab=cohLabelVal(shot,'Assist'), l=idx&&idx.byShot?idx.byShot.get(shot):null;
  if(lab) return {name:lab, type:(l&&l.type)||cohLabelVal(shot,'Assist Type')||'', source:'label', row:l?l.row:null};
  if(l&&(l.name||l.type)) return {name:l.name||'', type:l.type||'', source:'row', row:l.row};
  return null;
}
if(typeof module!=='undefined'&&module.exports) Object.assign(module.exports, {cohIsShotRow, cohIsAssistRow, cohShotScored, cohRowPlayerOf, cohAssistType, cohAlign, cohAssistIndex, cohAssistIndexCached, cohShotAssist, COH_ASSIST_GAP});

/* ── Kickout players and break rows (the Sportscode template) ─────
 * On a team's own kickout row the FIRST player of that team is the kicker and
 * the SECOND is the player who gathered possession; a player of the OTHER team
 * on a kickout or break row won it for his team. Break rows carry winners too:
 * the players of the team that won the kickout on any break row tied to it.
 * Derived on read; an explicit 'Kickout Taken By' / 'Kickout Won By' label always wins.
 *   cohIsKoRow(e) / cohIsBreakRow(e)
 *   cohKoWon(e)                 true (kicking team kept it) · false · null (no COHESION-style outcome)
 *   cohBreakTies(events)        {byKo:Map(ko -> [break rows]), byRow:Map(row -> ko)} — a break row belongs to the
 *                               kickout its window overlaps most
 *   cohKoIndex(events, meta)    Map(ko -> {takenBy, wonBy, wonByTeam, second, winners:[…], target, src:{takenBy, wonBy}})
 *   cohKoInfo(e, index)         one kickout's entry (or null)
 * The kicker / second-player reading needs the whole player list of the row, so it is used only in a game
 * whose import kept every label value (some event has labelsAll): an older import kept only the LAST player
 * of a row, and that one name cannot be told apart from a kicker. Run "Restore missing label values" first.
 */
const COH_BREAK_ROW_RE=/\bBREAK\s+(WON|LOST)\s*$/i;
function cohIsKoRow(e){ const c=String((e&&e.code)||''); return /(\bKO\b|KICKOUT)/i.test(c)&&!/\bTOS?\b|TURNOVER|SOURCE|ASSIST|SCORE|ATTACK/i.test(c); }
function cohIsBreakRow(e){ return COH_BREAK_ROW_RE.test(String((e&&e.code)||'')); }
function cohKoOutcome(e){ return cohUp(cohLabelVal(e,'Kickout Outcomes')||(e&&e.outcome)); }
function cohKoWon(e){ const o=cohKoOutcome(e); if(!o||/^(KT|RT)\b/.test(o)) return null; return /LOST/.test(o)?false:/WON/.test(o)?true:null; }
function cohBreakTies(events){
  const T0=e=>+(e.start!=null?e.start:e.driveT)||0, T1=e=>+(e.end!=null?e.end:T0(e)+4)||0;
  const kos=(events||[]).filter(e=>e&&e.team&&cohIsKoRow(e)), byKo=new Map(), byRow=new Map();
  (events||[]).forEach(r=>{ if(!r||!cohIsBreakRow(r)) return; let best=null, bo=-Infinity;
    kos.forEach(k=>{ if(r.half&&k.half&&r.half!==k.half) return; const ov=Math.min(T1(r), T1(k)+2)-Math.max(T0(r), T0(k)-2); if(ov>0&&ov>bo){ bo=ov; best=k; } });
    if(best){ byRow.set(r, best); if(!byKo.has(best)) byKo.set(best, []); byKo.get(best).push(r); } });
  return {byKo, byRow};
}
function cohOppTeam(team, meta){ const T=cohUp(team), h=cohUp(meta&&meta.homeTeam), a=cohUp(meta&&meta.awayTeam); return T&&T===h?a:T&&T===a?h:''; }
function cohKoIndex(events, meta){
  const idx=new Map(), full=(events||[]).some(e=>e&&e.labelsAll), ties=cohBreakTies(events);
  (events||[]).forEach(k=>{ if(!k||!k.team||!cohIsKoRow(k)) return;
    const T=cohUp(k.team), O=cohOppTeam(T, meta), won=cohKoWon(k), P=cohEventPlayers(k, meta).filter(p=>p.group);
    const own=P.filter(p=>cohUp(p.team)===T).map(p=>p.name), oth=P.filter(p=>p.team&&cohUp(p.team)!==T).map(p=>p.name);
    const tb=cohLabelVal(k,'Kickout Taken By'), wb=cohLabelVal(k,'Kickout Won By'), tg=cohLabelVal(k,'Kickout Target');
    const kicker=tb||(full?(own[0]||''):''), rest=tb?own.filter(n=>cohNameKey(n)!==cohNameKey(tb)):own.slice(1);
    const winT=won===true?T:won===false?O:'', winners=[], add=n=>{ if(n&&cohNameKey(n)!==cohNameKey(kicker)&&!winners.some(x=>cohNameKey(x)===cohNameKey(n))) winners.push(n); };
    if(won===true&&full) rest.forEach(add);
    if(won===false) oth.forEach(add);
    if(winT) (ties.byKo.get(k)||[]).forEach(r=>cohEventPlayers(r, meta).forEach(p=>{ if(cohUp(p.team)===winT) add(p.name); }));
    idx.set(k, {takenBy:kicker, wonBy:wb||winners[0]||'', wonByTeam:winT, second:full?(rest[0]||''):'', winners:wb?[wb].concat(winners.filter(n=>cohNameKey(n)!==cohNameKey(wb))):winners, target:tg,
      src:{takenBy:tb?'label':kicker?'row':'', wonBy:wb?'label':winners.length?'row':''}, breakRows:ties.byKo.get(k)||[]});
  });
  return idx;
}
const COH_KO_CACHE=(typeof WeakMap!=='undefined')?new WeakMap():null;
function cohKoIndexCached(events, meta){
  if(!COH_KO_CACHE||!events||typeof events!=='object') return cohKoIndex(events, meta);
  const sig=events.length+'|'+((meta&&meta.homeTeam)||'')+'|'+((meta&&meta.awayTeam)||''), c=COH_KO_CACHE.get(events);
  if(c&&c.sig===sig) return c.idx;
  const idx=cohKoIndex(events, meta); COH_KO_CACHE.set(events, {sig, idx}); return idx;
}
function cohKoInfo(e, idx){ return (idx&&e&&idx.get(e))||null; }

/* ── The opposition's break row (import) ──────────────────────────
 * The template logs ONE break row per break-ball kickout, on the kicking team;
 * COHESION's standard is both teams' rows. cohScBreakPairs adds the missing
 * one(s) on the kickout's window, with the kickout's tags and — on the
 * winner's BREAK WON row — the player who won the break. Added rows are marked
 * derived:'break-pair' and carry the visible label COH_BREAK_NOTE. Idempotent:
 * a kickout that already has both rows gets nothing.
 *   cohScBreakPairs(events, {homeTeam, awayTeam, category}) -> {added:[events], stats:{kickouts, had, added, both}}
 */
const COH_BREAK_NOTE_GROUP='COHESION', COH_BREAK_NOTE='Added break row';
function cohScBreakPairs(events, opts){
  opts=opts||{}; const meta={homeTeam:opts.homeTeam, awayTeam:opts.awayTeam}, category=opts.category||cohScCategory;
  const stats={kickouts:0, had:0, added:0, both:0}, added=[], ties=cohBreakTies(events), kidx=cohKoIndex(events, meta), gidx=cohGroupIndex(events);
  // how the game writes a team at the start of a code ("KERRY KO"): the spelling of an existing code, else as the kicker's
  const prefix=(team, like)=>{ const U=cohUp(team); for(const e of events){ const c=String(e.code||''); if(cohUp(e.team)===U&&c.toUpperCase().startsWith(U+' ')) return c.slice(0, U.length); }
    return like===like.toUpperCase()?U:cohTeamCasing(U, meta); };
  (events||[]).forEach(k=>{ if(!k||!k.team||!cohIsKoRow(k)) return;
    const out=cohKoOutcome(k), won=/BREAK WON/.test(out)?true:/BREAK LOST/.test(out)?false:null; if(won===null||/^(KT|RT)\b/.test(out)) return;
    const T=cohUp(k.team), O=cohOppTeam(T, meta); stats.kickouts++;
    const kp=String(k.code||'').slice(0, T.length), have=ties.byKo.get(k)||[];
    const want=[[T, kp, won?'WON':'LOST']]; if(O) want.push([O, prefix(O, kp), won?'LOST':'WON']);
    const info=kidx.get(k)||{}; let n=0;
    want.forEach(([team, pre, what])=>{
      if(have.some(r=>cohUp(r.team||'')===team&&new RegExp('BREAK\\s+'+what+'\\s*$','i').test(r.code||''))){ stats.had++; return; }
      if(have.some(r=>!r.team&&cohUp(r.code).startsWith(team+' ')&&new RegExp('BREAK\\s+'+what+'\\s*$','i').test(r.code||''))){ stats.had++; return; }
      const code=pre+' BREAK '+what, labels={};
      Object.keys(k.labels||{}).forEach(g=>{ const c=cohGroupCanon(g); if(c==='kickout outcome'||c==='kickout location'||c==='kickout zone'||/^[xy]-ko/i.test(g)) labels[g]=k.labels[g]; });
      const ev={ id:'bp-'+k.id+'-'+(what==='WON'?'w':'l'), start:k.start, end:k.end, half:k.half };
      if(k.gameTime!=null) ev.gameTime=k.gameTime;
      let player='';
      if(what==='WON'&&info.wonBy&&cohUp(info.wonByTeam)===team){ player=info.wonBy; labels[cohPlayerGroupFor(gidx, team, meta)]=player; }
      labels[COH_BREAK_NOTE_GROUP]=COH_BREAK_NOTE;
      Object.assign(ev, { code, team, player, outcome:'', subtype:'', category:category(code), driveT:k.driveT, labels, derived:'break-pair', teamDerived:true });
      if(player) ev.playerTeam=team;
      added.push(ev); n++; });
    stats.added+=n; if(n===want.length&&n>1) stats.both++;
  });
  return {added, stats};
}
if(typeof module!=='undefined'&&module.exports) Object.assign(module.exports, {cohIsKoRow, cohIsBreakRow, cohKoOutcome, cohKoWon, cohBreakTies, cohOppTeam, cohKoIndex, cohKoIndexCached, cohKoInfo, cohScBreakPairs, COH_BREAK_NOTE_GROUP, COH_BREAK_NOTE});
