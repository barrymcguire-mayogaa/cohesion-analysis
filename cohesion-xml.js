/* COHESION — shared Sportscode-format XML builder (Code Room's "Export XML",
 * and the Analysis page's Match Reports XML download).
 *
 *   cohXmlBuild(events, {base})   -> the XML text (ALL_INSTANCES file)
 *   cohXmlFileStem(game)          -> a safe file stem from the game's title (or id)
 *   cohXmlLoadOrder(events)       -> events in the order Code Room holds them
 *                                    (video position, then coder clock)
 *   cohZipStore([{name, data}])   -> a store-only .zip (Uint8Array) of several files
 *
 * Writes the events (including custom labels and player tags — every value
 * of a repeated label group as its own <label>) as a
 * Sportscode-shaped ALL_INSTANCES file. Synthesised period markers
 * ("1st Half" etc.) are included so the file re-imports into COHESION (and
 * other Sportscode-style tools) with correct period detection.
 * Time base: "video" (the default) uses the corrected video positions
 * (driveT) — reflecting timing edits; "raw" uses the original coder-clock
 * start/end for a true re-import round-trip.
 *
 * Pure: no DOM, no globals. Also loadable from Node (module.exports).
 */
function cohXmlEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
// the label helpers (cohesion-labels.js): globals on a page, a require in Node
function cohXmlL(){
  if(typeof cohGroupIndex==='function') return {cohGroupIndex, cohGroupResolve, cohPlayerGroupFor, cohTeamCasing, cohLabelKeyEq, cohAssistIndex, cohIsShotRow, cohShotScored, cohIsKoRow, cohIsPlayerGroup, cohPlayerGroupTeam, cohNameKey, cohKoWon, cohOppTeam, cohRowRgb16, cohHexToRgb16, cohGroupCanon};
  if(typeof require==='function') return require('./cohesion-labels.js');
  throw new Error('cohesion-xml.js needs cohesion-labels.js loaded first');
}
// Every value of a label group, in order: e.labelsAll[g] holds them when a
// Sportscode instance repeated the group (cohesion-labels.js); otherwise the
// one value in e.labels[g]. Each is written as its own <label>.
function cohXmlValues(e, g, v){
  const all=e.labelsAll&&e.labelsAll[g];
  if(!Array.isArray(all)||all.length<2) return [v];
  return all[all.length-1]===v ? all : all.slice(0,-1).concat([v]);   // labels[g] edited on its own: it is the last value
}
// The import derived this event's team from its code (or from the player a
// player row is named after) — the source file had no Team Name label, and a
// re-import derives the same team again, so none is written.
function cohXmlTeamImplied(e){
  if(!e.teamDerived||(e.labels&&e.labels['Team Name'])) return false;
  return !!e.playerRow || String(e.code||'').includes(String(e.team||'').toUpperCase());
}
// Kickout player groups are exported team-specific so two players of the same
// name on opposite teams stay apart in Sportscode and a re-import is
// unambiguous: "<Team> Kickout Taken By" and "<Team> Kickout Target" carry the
// row's team; "<Team> Kickout Won By" carries the team that WON the kickout
// (the row's team on a WON outcome, the opposition on a LOST one; with no
// outcome the group stays bare). <Team> is spelt as the game spells it
// (opts.meta home / away team as entered). cohXmlPlainGroup turns them back
// (the import does the same: cohesion-labels.js cohScPlainGroup).
// An 'Assist' is NOT a label in the export: it is written as a row (below).
const COH_XML_TEAM_GROUPS=['Kickout Won By','Kickout Taken By','Kickout Target'];
function cohXmlPlainGroup(g){
  const m=/^(.+) (assist|kickout won by|kickout taken by|kickout target)$/i.exec(String(g||'').trim());
  return m?['Assist'].concat(COH_XML_TEAM_GROUPS).find(n=>n.toLowerCase()===m[2].toLowerCase()):g;
}
function cohXmlTeamGroup(g, e, teams, meta){
  const base=COH_XML_TEAM_GROUPS.find(n=>n.toLowerCase()===String(g||'').trim().toLowerCase());
  const own=String(e&&e.team||'').trim();
  if(!base||!own) return g;
  const cas=t=>meta?cohXmlL().cohTeamCasing(t, meta):t;
  if(base!=='Kickout Won By') return cas(own)+' '+base;
  const L=e.labels||{}, ok=Object.keys(L).find(k=>/^kickout\s*outcomes?$/i.test(k));
  const out=String((ok&&L[ok])||e.outcome||'').toUpperCase();
  if(/WON/.test(out)) return cas(own)+' '+base;
  if(!/LOST/.test(out)) return g;
  const opp=(teams||[]).find(t=>t.toUpperCase()!==own.toUpperCase());
  return opp?cas(opp)+' '+base:g;
}
const COH_XML_PERIODS=['1st Half','2nd Half','ET 1st Half','ET 2nd Half'];
// the match order of a team's rows (= code-room.html CR_TYPE_ORDER)
const COH_ROW_TYPE_ORDER=[
  ['TEAM POSSESSION'],['65M ENTRY'],['ATTACKS','ATTACK'],['SHOT OPEN PLAY'],['SHOT DEAD BALL','SHOT DEADBALL'],
  ['GOAL'],['1 POINT','POINT'],['2 POINT'],['SCORE SOURCE'],['SCORE ASSIST'],
  ['WIDE'],['SHORT'],['BLOCKED'],['WOODWORK'],['SAVE'],["'45",'45'],['MISS'],
  ['SHOT SOURCE'],['SHOT ASSIST'],['KICKOUT','KICKOUTS','KO'],['BREAK WON'],['BREAK LOST'],
  ['TACKLE','TACKLES'],['HIT','HITS'],['FOUL','FOULS'],['TECHNICAL FOUL'],['CARD','CARDS'],
  ['TURNOVER','TURNOVERS','TOS'],['BLOCK DOWN'],['GOAL ATTEMPT','GOAL CHANCE'],
  ['SUB','SUBS','SUBSTITUTION','BLOOD SUB']];
const COH_ROW_TYPE_RANK={}; COH_ROW_TYPE_ORDER.forEach((vs,i)=>vs.forEach(v=>COH_ROW_TYPE_RANK[v]=i));
// A time: a whole second with four decimals, as always; an exact (fractional) file time with every digit, as Sportscode wrote it.
function cohXmlNum(x){ const n=+x||0; return Number.isInteger(n)?n.toFixed(4):String(n); }
/* The <ROWS> section: the file's rows first, in file order with their colours (meta.rows — an untouched game
 * gives back the same R/G/B), then every other code of the export in the order given, with the colour COHESION
 * shows for it.
 *   codes      the codes of the export, in export order
 *   opts.order optional: the order for codes that are not file rows (Code Room's row order)
 *   opts.colourOf(code) optional -> '#rrggbb' (Code Room); default: the colour most events of the code carry,
 *                       else the team colour (meta.homeColor / awayColor), grey for a team-neutral row
 */
function cohXmlRows(events, codes, meta, opts){
  opts=opts||{}; meta=meta||{}; const H=cohXmlL(), out=[], seen=new Set();
  ((Array.isArray(meta.rows))?meta.rows:[]).forEach(r=>{ if(!r||!r.code||seen.has(r.code)) return; seen.add(r.code); out.push({code:r.code, rgb:H.cohRowRgb16(r)}); });
  const HT=String(meta.homeTeam||'').toUpperCase(), AT=String(meta.awayTeam||'').toUpperCase();
  const dflt=code=>{ const cnt=new Map(); let team='';
    (events||[]).forEach(e=>{ if((e.code||'')!==code) return; if(e.color) cnt.set(e.color,(cnt.get(e.color)||0)+1); if(!team&&e.team) team=String(e.team).toUpperCase(); });
    let best='', bn=0; cnt.forEach((n,c)=>{ if(n>bn){ best=c; bn=n; } });
    if(best) return best;
    return !team?'#9ca3af':team===HT?(meta.homeColor||'#4fc3f7'):team===AT?(meta.awayColor||'#22c55e'):'#9ca3af'; };
  const rest=[]; (codes||[]).forEach(c=>{ if(c&&!seen.has(c)){ seen.add(c); rest.push(c); } });
  // period rows, THROW-IN, the home team's rows, the away team's, then the rest — each team's in the match order
  // of COH_ROW_TYPE_ORDER (what Code Room's Timeline shows for a game with no saved row order) …
  const blk=c=>{ const C=String(c).toUpperCase(); if(COH_XML_PERIODS.includes(c)) return [0, COH_XML_PERIODS.indexOf(c)]; if(C==='THROW-IN'||C==='THROW IN') return [1, 0];
    const b=HT&&C.startsWith(HT+' ')?[2, C.slice(HT.length+1)]:AT&&C.startsWith(AT+' ')?[3, C.slice(AT.length+1)]:[4, C]; const r=COH_ROW_TYPE_RANK[b[1]]; return [b[0], r==null?COH_ROW_TYPE_ORDER.length:r]; };
  const first=new Map(rest.map((c,i)=>[c,i]));
  rest.sort((a,b)=>{ const x=blk(a), y=blk(b); return x[0]-y[0]||x[1]-y[1]||first.get(a)-first.get(b); });
  // … unless the caller has an order of its own (Code Room: the rows as the user arranged them); period rows stay first
  if(Array.isArray(opts.order)&&opts.order.length){ const rank=new Map(opts.order.map((c,i)=>[c,i])), rk=c=>COH_XML_PERIODS.includes(c)?-1:rank.has(c)?rank.get(c):1e9; const pos=new Map(rest.map((c,i)=>[c,i])); rest.sort((a,b)=>rk(a)-rk(b)||pos.get(a)-pos.get(b)); }
  rest.forEach(c=>{ const col=(opts.colourOf&&opts.colourOf(c))||dflt(c); out.push({code:c, rgb:H.cohHexToRgb16(col)||H.cohHexToRgb16('#9ca3af')}); });
  return out;
}
/* cohXmlBuild(events, opts)
 *   opts.base        'video' (default) | 'raw'
 *   opts.meta        the game's meta: team-name casing, the file's rows (meta.rows) and period rows (meta.scPeriods)
 *   opts.rows        false = no <ROWS> section
 *   opts.rowOrder / opts.colourOf   see cohXmlRows
 */
function cohXmlBuild(events, opts){
  opts=opts||{};
  const _xesc=cohXmlEsc, H=cohXmlL(), meta=opts.meta||null;
  const _teams=[]; (events||[]).forEach(e=>{ const t=String(e&&e.team||'').trim(); if(t&&!_teams.some(x=>x.toUpperCase()===t.toUpperCase())) _teams.push(t); });
  const base=opts.base||'video';
  const tOf=e=> base==='raw' ? (e.start!=null?e.start:(e.driveT||0)) : (e.driveT!=null?e.driveT:(e.start||0));
  const endOf=(e,s)=>{ if(base==='raw'&&e.end!=null) return e.end; const dur=(e.end!=null&&e.start!=null)?Math.max(1,e.end-e.start):4; return s+dur; };
  const evs=[...(events||[])].sort((a,b)=>tOf(a)-tOf(b));
  const lines=['<?xml version="1.0" encoding="UTF-8"?>','<file>','<ALL_INSTANCES>'], codes=[];
  let idc=0;
  // Period boundary markers: the file's own rows on the raw clock when the import kept them (meta.scPeriods),
  // else positioned at each period's event span.
  const pMap={'1st Half':'1st Half','2nd Half':'2nd Half','ET 1st Half':'ET 1st Half','ET 2nd Half':'ET 2nd Half'};
  const spans={}, filePer={};
  if(base==='raw'&&meta&&Array.isArray(meta.scPeriods)) meta.scPeriods.forEach(p=>{ if(p&&pMap[p.code]&&filePer[p.code]==null&&isFinite(+p.start)&&isFinite(+p.end)) filePer[p.code]=p; });
  evs.forEach(e=>{ const h=e.half; if(!h||!pMap[h])return; const s=tOf(e), en=endOf(e,s); if(!spans[h]) spans[h]={min:s,max:en}; else { spans[h].min=Math.min(spans[h].min,s); spans[h].max=Math.max(spans[h].max,en); } });
  const periods=[];
  ['1st Half','2nd Half','ET 1st Half','ET 2nd Half'].forEach(h=>{ if(filePer[h]) periods.push({code:h, start:+filePer[h].start, end:+filePer[h].end, file:true}); else if(spans[h]) periods.push({code:h, start:spans[h].min, end:spans[h].max}); });
  // Group names follow the game's own template; assists are written as rows.
  const gidx=H.cohGroupIndex(events), aidx=H.cohAssistIndex(events||[], meta||{}), nk=H.cohNameKey;
  const playerGroup=team=>H.cohPlayerGroupFor(gidx, team, meta||{});
  const rowAssist=new Map();   // an existing assist row whose shot's Assist label names someone else: the label is what is written
  const groupsOf=e=>{   // -> [[group, [values…]], …] as written
    const labels={...(e.labels||{})}, out=[];
    if(e.team && !labels['Team Name'] && !cohXmlTeamImplied(e)) labels['Team Name']=e.team;
    if(e.player && !e.playerRow){ const pg=Object.keys(labels).find(k=>/player labels$/i.test(k)); if(!pg) labels[playerGroup(e.team)]=e.player; }
    Object.entries(labels).forEach(([g,v])=>{ if(v==null||v==='')return; out.push([g, cohXmlValues(e,g,v).slice()]); });
    return out;
  };
  const setFirst=(list, g, name)=>{ let r=list.find(x=>x[0]===g); if(!r){ r=[g, []]; list.push(r); } const i=r[1].findIndex(x=>nk(x)===nk(name)); if(i===0) return; if(i>0) r[1].splice(i,1); r[1].unshift(name); };
  const addAfter=(list, g, name)=>{ let r=list.find(x=>x[0]===g); if(!r){ r=[g, []]; list.push(r); } if(!r[1].some(x=>nk(x)===nk(name))) r[1].push(name); };
  const write=(code, s, en, list)=>{
    lines.push('  <instance>','    <ID>'+(++idc)+'</ID>','    <start>'+cohXmlNum(s)+'</start>','    <end>'+cohXmlNum(en)+'</end>','    <code>'+_xesc(code||'')+'</code>');
    list.forEach(([g, vals])=>vals.forEach(x=>lines.push('    <label>','      <group>'+_xesc(g)+'</group>','      <text>'+_xesc(x)+'</text>','    </label>')));
    lines.push('  </instance>'); codes.push(code||'');
  };
  // which shots need an assist row written, and which existing rows are re-pointed
  const newAssist=new Map();
  evs.forEach(e=>{ if(!e||!H.cohIsShotRow(e)) return; const ak=H.cohLabelKeyEq(e.labels, 'Assist'); const a=ak!=null?String(e.labels[ak]||'').trim():''; if(!a) return;
    const l=aidx.byShot.get(e);
    if(l){ if(nk(l.name)!==nk(a)) rowAssist.set(l.row, {name:a, team:e.team}); }
    else newAssist.set(e, a); });
  // synthesised markers lead the file as before; the file's own period rows sit where they were, in time order
  const inTime=periods.filter(p=>p.file).sort((a,b)=>a.start-b.start);
  periods.filter(p=>!p.file).forEach(p=>write(p.code, p.start, p.end, []));
  evs.forEach(e=>{
    const s=tOf(e), en=endOf(e,s); let list=groupsOf(e);
    while(inTime.length&&inTime[0].start<=s){ const p=inTime.shift(); write(p.code, p.start, p.end, []); }
    if(H.cohIsShotRow(e)){ const ak=H.cohLabelKeyEq(e.labels, 'Assist'); if(ak!=null) list=list.filter(x=>x[0]!==ak&&x[0]!=='Assist Type'); }
    if(rowAssist.has(e)){ const o=rowAssist.get(e), pg=playerGroup(o.team); list=list.filter(x=>!(H.cohIsPlayerGroup(x[0])&&H.cohPlayerGroupTeam(x[0])===String(o.team||'').toUpperCase())); list.push([pg, [o.name]]); }
    if(e.team&&H.cohIsKoRow(e)){
      // the template's order: the kicker first, then the player who won it, each in HIS team's player group —
      // and the explicit team-specific groups as well, so a re-import cannot misread them
      const val=n=>{ const k=H.cohLabelKeyEq(e.labels, n); return k!=null?String(e.labels[k]||'').trim():''; };
      const tb=val('Kickout Taken By'), wb=val('Kickout Won By'), won=H.cohKoWon(e);
      if(tb) setFirst(list, playerGroup(e.team), tb);
      if(wb&&won!==null){ const wt=won?e.team:(_teams.find(t=>t.toUpperCase()!==String(e.team).toUpperCase())||''); if(wt&&(tb||!won)) addAfter(list, playerGroup(wt), wb); }
      list=list.map(x=>[cohXmlTeamGroup(x[0], e, _teams, meta), x[1]]);
    }
    write(e.code, s, en, list);
    if(newAssist.has(e)){
      const scored=H.cohShotScored(e)===true, pre=String(e.code||'').replace(/\s*SHOT\s+(OPEN|DEAD).*$/i,''), code=(pre?pre+' ':'')+(scored?'SCORE':'SHOT')+' ASSIST', al=[];
      if(e.team&&!String(code).includes(String(e.team).toUpperCase())) al.push(['Team Name', [e.team]]);
      const tk=H.cohLabelKeyEq(e.labels, 'Assist Type'); if(tk!=null&&e.labels[tk]) al.push([H.cohGroupResolve(gidx, scored?'Score Assist Outcomes':'Shot Assist Outcomes'), [e.labels[tk]]]);
      al.push([playerGroup(e.team), [newAssist.get(e)]]);
      write(code, s, en, al);
    }
  });
  inTime.forEach(p=>write(p.code, p.start, p.end, []));
  lines.push('</ALL_INSTANCES>');
  if(opts.rows!==false){
    const rows=cohXmlRows(events, codes, meta, {order:opts.rowOrder, colourOf:opts.colourOf});
    lines.push('<ROWS>'); rows.forEach(r=>lines.push('  <row>','    <code>'+_xesc(r.code)+'</code>','    <R>'+r.rgb[0]+'</R>','    <G>'+r.rgb[1]+'</G>','    <B>'+r.rgb[2]+'</B>','  </row>')); lines.push('</ROWS>');
  }
  lines.push('</file>');
  return lines.join('\n');
}
function cohXmlFileStem(game){ game=game||{}; return String(game.title||game.id||'game').replace(/[^\w]+/g,'_').replace(/^_+|_+$/g,''); }
// A copy of the events in Code Room's load order (the gateway returns rows in
// physical table order): video position, then coder clock.
function cohXmlLoadOrder(events){ return [...(events||[])].sort((a,b)=>(a.driveT??0)-(b.driveT??0)||(a.start??0)-(b.start??0)); }

// ── A tiny store-only ZIP writer (no compression, no dependency) for sending
// several XML files as one download.
//   cohZipStore([{name, data}], date?) -> Uint8Array
// data is a string (written as UTF-8) or a Uint8Array; names are UTF-8
// (general-purpose bit 11). XML is small, so storing is fine. No ZIP64:
// fewer than 65,535 files and under 4 GB in total.
let _cohCrcT=null;
function cohCrc32(u8){
  if(!_cohCrcT){ _cohCrcT=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); _cohCrcT[n]=c>>>0; } }
  let c=0xFFFFFFFF;
  for(let i=0;i<u8.length;i++) c=_cohCrcT[(c^u8[i])&0xFF]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
}
function cohZipStore(files, date){
  const enc=new TextEncoder(), d=date||new Date();
  const dosT=((d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1))&0xFFFF;
  const dosD=(((Math.max(1980,d.getFullYear())-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate())&0xFFFF;
  const ents=(files||[]).map(f=>{ const data=typeof f.data==='string'?enc.encode(f.data):(f.data||new Uint8Array(0));
    return {name:enc.encode(String(f.name||'file')), data, crc:cohCrc32(data)}; });
  let size=22; ents.forEach(e=>{ size+=30+e.name.length+e.data.length+46+e.name.length; });
  const out=new Uint8Array(size), dv=new DataView(out.buffer);
  let p=0;
  ents.forEach(e=>{                                   // local file header + data
    e.off=p;
    dv.setUint32(p,0x04034b50,true); dv.setUint16(p+4,20,true); dv.setUint16(p+6,0x0800,true); dv.setUint16(p+8,0,true);
    dv.setUint16(p+10,dosT,true); dv.setUint16(p+12,dosD,true); dv.setUint32(p+14,e.crc,true);
    dv.setUint32(p+18,e.data.length,true); dv.setUint32(p+22,e.data.length,true); dv.setUint16(p+26,e.name.length,true); dv.setUint16(p+28,0,true);
    out.set(e.name,p+30); out.set(e.data,p+30+e.name.length); p+=30+e.name.length+e.data.length;
  });
  const cd=p;
  ents.forEach(e=>{                                   // central directory
    dv.setUint32(p,0x02014b50,true); dv.setUint16(p+4,20,true); dv.setUint16(p+6,20,true); dv.setUint16(p+8,0x0800,true); dv.setUint16(p+10,0,true);
    dv.setUint16(p+12,dosT,true); dv.setUint16(p+14,dosD,true); dv.setUint32(p+16,e.crc,true);
    dv.setUint32(p+20,e.data.length,true); dv.setUint32(p+24,e.data.length,true); dv.setUint16(p+28,e.name.length,true);
    dv.setUint16(p+30,0,true); dv.setUint16(p+32,0,true); dv.setUint16(p+34,0,true); dv.setUint16(p+36,0,true); dv.setUint32(p+38,0,true); dv.setUint32(p+42,e.off,true);
    out.set(e.name,p+46); p+=46+e.name.length;
  });
  dv.setUint32(p,0x06054b50,true); dv.setUint16(p+4,0,true); dv.setUint16(p+6,0,true); dv.setUint16(p+8,ents.length,true); dv.setUint16(p+10,ents.length,true);
  dv.setUint32(p+12,p-cd,true); dv.setUint32(p+16,cd,true); dv.setUint16(p+20,0,true);
  return out;
}
if(typeof module!=='undefined'&&module.exports) module.exports={cohXmlEsc, cohXmlValues, cohXmlTeamImplied, cohXmlPlainGroup, cohXmlTeamGroup, cohXmlNum, cohXmlRows, cohXmlBuild, cohXmlFileStem, cohXmlLoadOrder, cohCrc32, cohZipStore};
