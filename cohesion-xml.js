/* COHESION — shared Sportscode-format XML builder (Code Room's "Export XML",
 * and the Analysis page's Match Reports XML download).
 *
 *   cohXmlBuild(events, {base})   -> the XML text (ALL_INSTANCES file)
 *   cohXmlFileStem(game)          -> a safe file stem from the game's title (or id)
 *   cohXmlLoadOrder(events)       -> events in the order Code Room holds them
 *                                    (video position, then coder clock)
 *
 * Writes the events (including custom labels and player tags) as a
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
function cohXmlBuild(events, opts){
  const _xesc=cohXmlEsc;
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
    if(e.team && !labels['Team Name']) labels['Team Name']=e.team;
    if(e.player){ const pg=Object.keys(labels).find(k=>/player labels$/i.test(k)); if(!pg) labels[`${(e.team||'').trim()||'Unassigned'} Player Labels`]=e.player; }
    Object.entries(labels).forEach(([g,v])=>{ if(v==null||v==='')return; lines.push('    <label>','      <group>'+_xesc(g)+'</group>','      <text>'+_xesc(v)+'</text>','    </label>'); });
    lines.push('  </instance>');
  });
  lines.push('</ALL_INSTANCES>','</file>');
  return lines.join('\n');
}
function cohXmlFileStem(game){ game=game||{}; return String(game.title||game.id||'game').replace(/[^\w]+/g,'_').replace(/^_+|_+$/g,''); }
// A copy of the events in Code Room's load order (the gateway returns rows in
// physical table order): video position, then coder clock.
function cohXmlLoadOrder(events){ return [...(events||[])].sort((a,b)=>(a.driveT??0)-(b.driveT??0)||(a.start??0)-(b.start??0)); }
if(typeof module!=='undefined'&&module.exports) module.exports={cohXmlEsc, cohXmlBuild, cohXmlFileStem, cohXmlLoadOrder};
