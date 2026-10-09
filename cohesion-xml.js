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
// Player-valued label groups are exported team-specific, like "<TEAM> Player
// Labels", so two players of the same name on opposite teams stay apart in
// Sportscode: "<TEAM> Assist", "<TEAM> Kickout Taken By" and "<TEAM> Kickout Target" carry the row's
// team; "<TEAM> Kickout Won By" carries the team that WON the kickout (the
// row's team on a WON outcome, the opposition on a LOST one; with no outcome
// the group stays bare). cohXmlPlainGroup turns them back on import.
const COH_XML_TEAM_GROUPS=['Assist','Kickout Won By','Kickout Taken By','Kickout Target'];
function cohXmlPlainGroup(g){
  const m=/^(.+) (assist|kickout won by|kickout taken by|kickout target)$/i.exec(String(g||'').trim());
  return m?COH_XML_TEAM_GROUPS.find(n=>n.toLowerCase()===m[2].toLowerCase()):g;
}
function cohXmlTeamGroup(g, e, teams){
  const base=COH_XML_TEAM_GROUPS.find(n=>n.toLowerCase()===String(g||'').trim().toLowerCase());
  const own=String(e&&e.team||'').trim();
  if(!base||!own) return g;
  if(base!=='Kickout Won By') return own+' '+base;
  const L=e.labels||{}, ok=Object.keys(L).find(k=>/^kickout\s*outcomes?$/i.test(k));
  const out=String((ok&&L[ok])||e.outcome||'').toUpperCase();
  if(/WON/.test(out)) return own+' '+base;
  if(!/LOST/.test(out)) return g;
  const opp=(teams||[]).find(t=>t.toUpperCase()!==own.toUpperCase());
  return opp?opp+' '+base:g;
}
function cohXmlBuild(events, opts){
  const _xesc=cohXmlEsc;
  const _teams=[]; (events||[]).forEach(e=>{ const t=String(e&&e.team||'').trim(); if(t&&!_teams.some(x=>x.toUpperCase()===t.toUpperCase())) _teams.push(t); });
  const base=(opts&&opts.base)||'video';
  const tOf=e=> base==='raw' ? (e.start!=null?e.start:(e.driveT||0)) : (e.driveT!=null?e.driveT:(e.start||0));
  const endOf=(e,s)=>{ if(base==='raw'&&e.end!=null) return e.end; const dur=(e.end!=null&&e.start!=null)?Math.max(1,e.end-e.start):4; return s+dur; };
  const evs=[...(events||[])].sort((a,b)=>tOf(a)-tOf(b));
  const lines=['<?xml version="1.0" encoding="UTF-8"?>','<file>','<ALL_INSTANCES>'];
  let idc=0;
  // Period boundary markers, positioned at each period's event span.
  const pMap={'1st Half':'1st Half','2nd Half':'2nd Half','ET 1st Half':'ET 1st Half','ET 2nd Half':'ET 2nd Half'};
  const spans={};
  evs.forEach(e=>{ const h=e.half; if(!h||!pMap[h])return; const s=tOf(e), en=endOf(e,s); if(!spans[h]) spans[h]={min:s,max:en}; else { spans[h].min=Math.min(spans[h].min,s); spans[h].max=Math.max(spans[h].max,en); } });
  ['1st Half','2nd Half','ET 1st Half','ET 2nd Half'].forEach(h=>{ if(spans[h]){ lines.push('  <instance>','    <ID>'+(++idc)+'</ID>','    <start>'+spans[h].min.toFixed(4)+'</start>','    <end>'+spans[h].max.toFixed(4)+'</end>','    <code>'+pMap[h]+'</code>','  </instance>'); } });
  // Events
  evs.forEach(e=>{
    const s=tOf(e), en=endOf(e,s);
    lines.push('  <instance>','    <ID>'+(++idc)+'</ID>','    <start>'+(+s).toFixed(4)+'</start>','    <end>'+(+en).toFixed(4)+'</end>','    <code>'+_xesc(e.code||'')+'</code>');
    const labels={...(e.labels||{})};
    if(e.team && !labels['Team Name'] && !cohXmlTeamImplied(e)) labels['Team Name']=e.team;
    if(e.player && !e.playerRow){ const pg=Object.keys(labels).find(k=>/player labels$/i.test(k)); if(!pg) labels[`${(e.team||'').trim()||'Unassigned'} Player Labels`]=e.player; }
    Object.entries(labels).forEach(([g,v])=>{ if(v==null||v==='')return; const xg=cohXmlTeamGroup(g,e,_teams); cohXmlValues(e,g,v).forEach(x=>lines.push('    <label>','      <group>'+_xesc(xg)+'</group>','      <text>'+_xesc(x)+'</text>','    </label>')); });
    lines.push('  </instance>');
  });
  lines.push('</ALL_INSTANCES>','</file>');
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
if(typeof module!=='undefined'&&module.exports) module.exports={cohXmlEsc, cohXmlValues, cohXmlTeamImplied, cohXmlPlainGroup, cohXmlTeamGroup, cohXmlBuild, cohXmlFileStem, cohXmlLoadOrder, cohCrc32, cohZipStore};
