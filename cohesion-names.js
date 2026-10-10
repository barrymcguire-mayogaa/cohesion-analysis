/* COHESION — player names across a team's games: audit, likely duplicates, merge plan, log and undo.
 *
 * Used by player-names-admin.html (admin only). Everything in this file is PURE except the two runners at the
 * bottom (cohNames.runMerge / runUndo), and those only talk to the `io` object they are given — the page passes
 * the existing gateways (cohesionRead · cohesionEventBatch · gameAdmin updateMeta · playerPhotos rename/delete),
 * the tests pass an in-memory one. No new write path.
 *
 * WHERE A PLAYER'S NAME IS STORED (every one is read by scanGame and renamed by planGame):
 *   on an event (events.data)
 *     player          e.player — his team is cohPlayerTeam(e, meta): the team of his "<Team> Player Labels" group,
 *                     else e.playerTeam, else e.team (a KERRY TOs row can carry a Mayo player)
 *     label           every value of every "<Team> Player Labels" group, any case, including the repeated values in
 *                     e.labelsAll — team = the group's team, else the row's (cohEventPlayers)
 *     assist          'Assist' (any case: ASSIST, assist)            — the row's team (the shooter's)
 *     koTaken         'Kickout Taken By'                             — the row's team
 *     koTarget        'Kickout Target'                               — the row's team
 *     koWon           'Kickout Won By'                               — the kickout's winner (cohesionPlayersTeam:
 *                     outcome WON = the row's team, LOST = the other team; no outcome = only a name that is known
 *                     for this team and not for the other one in that game, otherwise it is left alone)
 *     subOut / subIn  'Player Out' / 'Player In' (any case)          — the row's team
 *                     (the exported forms "<Team> Kickout Won By" … are read with the team in the name)
 *     plainPlayer     'Player' — the raw Gaelic Insights / GIU row's player label (the row's team)
 *     rowCode         e.code of a Sportscode PLAYER ROW (the code IS the name): playerRow:true, or — games stored
 *                     before the import marked them — a row with no team and no player whose code is a known
 *                     player (cohPlayerRowOf)
 *   on the game (games.meta)
 *     sheet           meta.rosters[side][] — {no, name, role} or a legacy string ("7 Colm Reape")
 *     keeper          meta.keepers[side][].player
 *     ptag            meta.playerRoster[teamA|teamB] — the admin's P-tag → name map (home = teamA); values that are
 *                     names, never the P-tags themselves
 *     rowsMeta        meta.rows[] {code, colour} — the Sportscode file's row list: a player row's entry follows him
 *   player photos     the private bucket's index, keyed by team + cohPhotoKey(name) (photoPlan; moved with the
 *                     playerPhotos function's `rename`)
 *
 * A SPELLING is the stored text exactly (so "COLIN BARRETT" and "Colin Barrett" are two spellings). Spellings are
 * compared with the Players-tab key cohPlayerKey (cohesion-photos.js) — never re-implemented here.
 */
(function(root){
  'use strict';
  const NODE=typeof module!=='undefined'&&module.exports;
  let L, P, TS, playersTeam;
  if(NODE){
    L=require('./cohesion-labels.js'); P=require('./cohesion-photos.js'); TS=require('./cohesion-teamsheet.js');
    // cohesion-config.js is a browser file (window.*): run it against a stand-in window to get THE winner rule
    const w={}; require('vm').runInNewContext(require('fs').readFileSync(require('path').join(__dirname,'cohesion-config.js'),'utf8'), {window:w, console});
    playersTeam=w.cohesionPlayersTeam;
  } else {
    L=root; P=root; TS=root.cohTS; playersTeam=function(){ return root.cohesionPlayersTeam.apply(root, arguments); };
  }
  const up=s=>String(s==null?'':s).trim().toUpperCase();
  const tidy=s=>String(s==null?'':s).replace(/\s+/g,' ').trim();
  const clone=o=>o==null?o:JSON.parse(JSON.stringify(o));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const pkey=s=>P.cohPlayerKey(s), fkey=s=>P.cohPhotoKey(s);
  const isPTag=s=>/^P\s*\d+$/i.test(String(s==null?'':s).trim());

  // ── which side of a game the chosen team is ───────────────────
  // Teams are matched across games the way the photos / crests pages do (cohPhotoKey: case, spaces, accents);
  // INSIDE a game its own spelling is used, upper-cased, exactly as the events and label groups are.
  function gameCtx(meta, team){
    const k=fkey(team); if(!k||!meta) return null;
    const h=fkey(meta.homeTeam)===k, a=fkey(meta.awayTeam)===k;
    if(h===a) return null;                                   // not in this game (or named on both sides)
    const side=h?'home':'away';
    return {side, T:up(h?meta.homeTeam:meta.awayTeam), O:up(h?meta.awayTeam:meta.homeTeam), H:up(meta.homeTeam), A:up(meta.awayTeam)};
  }

  // ── player-valued label groups ────────────────────────────────
  const PLAIN={'assist':'assist', 'kickout won by':'koWon', 'kickout taken by':'koTaken', 'kickout target':'koTarget',
    'player out':'subOut', 'player in':'subIn', 'player':'plainPlayer'};
  // -> {kind, team} for a label group on event e ('' team = cannot be told, '?' = a kickout winner with no outcome), or null
  function groupInfo(g, e, meta, ctx){
    if(L.cohIsPlayerGroup(g)) return {kind:'label', team:up(L.cohPlayerGroupTeam(g, meta)||e.team)};
    const s=tidy(g).toLowerCase();
    let kind=PLAIN[s], team=up(e.team), named=false;
    if(!kind){
      const m=/^(.+) (assist|kickout won by|kickout taken by|kickout target|player out|player in)$/.exec(s);
      if(!m||(up(m[1])!==ctx.H&&up(m[1])!==ctx.A)) return null;
      kind=PLAIN[m[2]]; team=up(m[1]); named=true;
    }
    if(kind==='koWon'&&!named){
      if(!team) return {kind, team:''};
      const t=playersTeam({playersTeam:'koWinner'}, e.labels, e.outcome);
      team=t==='own'?team:t==='opp'?(team===ctx.H?ctx.A:team===ctx.A?ctx.H:''):'?';
    }
    return {kind, team};
  }

  // ── the ONE walk over a game's events (scan and rename both use it) ──
  // rows: [{id, data}] as the read gateway serves them. index = cohPlayerIndex of the game BEFORE any change.
  // fn(slot) is called for every name of EITHER team — slot = {kind, team, name, group, id, e, pos} — and may
  // return a different name: the walk then writes it IN PLACE (key order kept, so an undo is exact) and records
  // {p:[path], old, new} — the stored value at that path before / after.   -> Map(rowId -> [sets])
  function walkEvents(meta, rows, ctx, index, fn){
    const out=new Map();
    (rows||[]).forEach(r=>{ const e=r&&r.data; if(!e||typeof e!=='object') return;
      const sets=[], ask=(kind, team, name, group, pos)=>{ const v=fn({kind, team, name, group:group||'', id:r.id, e, pos:pos||0}); return (typeof v==='string'&&v!==name)?v:null; };
      // whose row it is and whose player he is are read BEFORE anything on the event changes
      const who=(e.playerRow||(!e.team&&!e.player))?L.cohPlayerRowOf(e, index):null;
      const pTeam=e.player?up(L.cohPlayerTeam(e, meta)):'';
      if(typeof e.player==='string'&&e.player){ const v=ask('player', pTeam, e.player); if(v!=null){ sets.push({p:['player'], old:e.player, new:v}); e.player=v; } }
      if(who&&typeof e.code==='string'&&e.code){ const v=ask('rowCode', up(who.team), e.code); if(v!=null){ sets.push({p:['code'], old:e.code, new:v}); e.code=v; } }
      const LB=e.labels;
      if(LB&&typeof LB==='object') Object.keys(LB).forEach(g=>{
        const gi=groupInfo(g, e, meta, ctx); if(!gi) return;
        let ak=L.cohLabelKey(e.labelsAll, g), vals;
        if(ak!=null&&ak!==g&&own(LB, ak)){ ak=null; vals=(LB[g]==null||LB[g]==='')?[]:[LB[g]]; }   // "ASSIST" and "assist" on one event: each keeps its own value
        else vals=L.cohLabelValues(e, g);
        if(!vals.length) return;
        let ch=false; const next=vals.map((v,i)=>{ const n=typeof v==='string'?ask(gi.kind, gi.team, v, g, i):null; if(n!=null){ ch=true; return n; } return v; });
        if(!ch) return;
        const all=ak!=null?e.labelsAll[ak]:null;
        if(Array.isArray(all)&&all.length>=2){ sets.push({p:['labelsAll', ak], old:all.slice(), new:next.slice()}); e.labelsAll[ak]=next.slice(); }
        const last=next[next.length-1];
        if(LB[g]!==last){ sets.push({p:['labels', g], old:LB[g], new:last}); LB[g]=last; }
      });
      if(sets.length) out.set(r.id, sets);
    });
    return out;
  }

  // ── team sheet entries ────────────────────────────────────────
  function sheetRename(r, ne, name){
    if(r&&typeof r==='object'){ const o=Object.assign({}, r); if(o.name!=null) o.name=name; else o.player=name; return o; }
    const s=String(r), i=s.lastIndexOf(ne.name);
    return i>=0?s.slice(0,i)+name+s.slice(i+ne.name.length):((ne.no?ne.no+' ':'')+name);
  }
  function sheetAdopt(r, ne, no, role){
    const o=(r&&typeof r==='object')?Object.assign({}, r):{no:ne.no===''?null:+ne.no, name:ne.name};
    if(no&&ne.no===''){ const k=['no','number','num','jersey','shirt'].find(x=>o[x]!=null)||'no'; o[k]=+no; }
    if(role&&!ne.role) o.role=role;
    return o;
  }
  // rename, then: the same name twice on one sheet becomes ONE entry — the one that already had the right spelling
  // stays (its number and role win); a number or role it lacks is taken from the entry that goes.
  function sheetWork(list, team, fn){
    const ren=[];
    const out=list.map((r,i)=>{ const ne=TS.normEntry(r); if(!ne) return r;
      const n=fn({kind:'sheet', team, name:ne.name, no:ne.no, group:'', pos:i});
      if(typeof n!=='string'||n===ne.name) return r;
      ren.push(i); return sheetRename(r, ne, n); });
    if(!ren.length) return out;
    const drop=new Set();
    [...new Set(ren.map(i=>TS.normEntry(out[i]).name))].forEach(name=>{
      const hit=out.map((r,i)=>({i, ne:TS.normEntry(r)})).filter(x=>x.ne&&x.ne.name===name);
      if(hit.length<2) return;
      const keep=hit.find(x=>!ren.includes(x.i))||hit[0], rest=hit.filter(x=>x!==keep);
      const no=keep.ne.no||((rest.find(x=>x.ne.no)||{ne:{}}).ne.no||''), role=keep.ne.role||((rest.find(x=>x.ne.role)||{ne:{}}).ne.role||'');
      if(no!==keep.ne.no||role!==keep.ne.role) out[keep.i]=sheetAdopt(out[keep.i], keep.ne, no, role);
      rest.forEach(x=>drop.add(x.i));
    });
    return out.filter((r,i)=>!drop.has(i));
  }
  // = code-room.html crRowsApplyRename (an inline function there): the old row takes the new name where it
  // stands; if the file already lists the new name, the old entry drops out
  function rowsApplyRename(rows, oc, nc){
    const has=rows.some(r=>r&&r.code===nc);
    return has?rows.filter(r=>!(r&&r.code===oc)):rows.map(r=>(r&&r.code===oc)?Object.assign({}, r, {code:nc}):r);
  }

  // ── the walk over a game's meta ───────────────────────────────
  // Same contract as walkEvents. Changes are made on `meta` and returned as pieces
  // [{field:'rosters.home'|'keepers.away'|'playerRoster.teamA'|'rows', before, after}] — only fields that changed.
  function walkMeta(meta, ctx, index, fn){
    const pieces=[];
    const piece=(field, holder, k, work)=>{ const before=holder[k], after=work(clone(before));
      if(!same(before, after)){ pieces.push({field, before:clone(before), after:clone(after)}); holder[k]=after; } };
    const obj=o=>o&&typeof o==='object'&&!Array.isArray(o);
    [['home', ctx.H, 'teamA'], ['away', ctx.A, 'teamB']].forEach(([side, team, ab])=>{
      if(obj(meta.rosters)&&Array.isArray(meta.rosters[side])) piece('rosters.'+side, meta.rosters, side, list=>sheetWork(list, team, fn));
      if(obj(meta.keepers)&&Array.isArray(meta.keepers[side])) piece('keepers.'+side, meta.keepers, side, list=>{
        list.forEach((s,i)=>{ if(!obj(s)||typeof s.player!=='string'||!s.player) return;
          const n=fn({kind:'keeper', team, name:s.player, group:'', pos:i}); if(typeof n==='string'&&n!==s.player) s.player=n; });
        return list; });
      if(obj(meta.playerRoster)&&obj(meta.playerRoster[ab])) piece('playerRoster.'+ab, meta.playerRoster, ab, map=>{
        Object.keys(map).forEach(k=>{ const v=map[k]; if(typeof v!=='string'||!tidy(v)||isPTag(v)) return;
          const n=fn({kind:'ptag', team, name:v, group:k, pos:0}); if(typeof n==='string'&&n!==v) map[k]=n; });
        return map; });
    });
    if(Array.isArray(meta.rows)) piece('rows', meta, 'rows', rows=>{
      const ren=[];
      rows.forEach((r,i)=>{ if(!r||typeof r.code!=='string'||!r.code) return;
        const p=index.get(L.cohNameKey(r.code)); if(!p||p.team==null) return;            // not a player's row
        const n=fn({kind:'rowsMeta', team:up(p.team), name:r.code, group:'', pos:i}); if(typeof n==='string'&&n!==r.code) ren.push([r.code, n]); });
      let out=rows; ren.forEach(x=>{ out=rowsApplyRename(out, x[0], x[1]); });
      return out; });
    return pieces;
  }

  // A kickout winner with no outcome ('?') is this team's only when the name is known for it and not for the other.
  function knownKeys(meta, rows, ctx, index){
    const K={}; K[ctx.T]=new Set(); K[ctx.O]=new Set();
    const fn=s=>{ if(s.team&&s.team!=='?'&&K[s.team]) K[s.team].add(pkey(s.name)); };
    walkEvents(meta, rows, ctx, index, fn); walkMeta(clone(meta), ctx, index, fn);
    return K;
  }
  function slotTeam(s, known, ctx){
    if(s.team!=='?') return s.team;
    const k=pkey(s.name), t=known[ctx.T].has(k), o=known[ctx.O].has(k);
    return t&&!o?ctx.T:o&&!t?ctx.O:'?';
  }

  // ── scan: every spelling used for the team's players in one game ──
  const SELF={player:1, label:1, plainPlayer:1, rowCode:1};          // "the row's player" kinds
  const ZERO=()=>({player:0, assist:0, koWon:0, koTaken:0, koTarget:0, subs:0, sheet:0, keeper:0, ptag:0, rows:0});
  const COUNT_OF={assist:'assist', koWon:'koWon', koTaken:'koTaken', koTarget:'koTarget', subOut:'subs', subIn:'subs', sheet:'sheet', keeper:'keeper', ptag:'ptag', rowsMeta:'rows'};
  // -> {id, side, T, O, names:Map(spelling -> {name, n:{player (EVENTS he is the row's player on), assist, koWon,
  //      koTaken, koTarget, subs, sheet, keeper, ptag, rows}, nos:[sheet numbers], uses}),
  //     left:{opponent, ambiguous, noTeam} (name slots NOT counted for this team)}   | null (team not in the game)
  function scanGame(meta, rows, team){
    const ctx=gameCtx(meta, team); if(!ctx) return null;
    const index=L.cohPlayerIndex((rows||[]).map(r=>r.data), meta), known=knownKeys(meta, rows, ctx, index);
    const names=new Map(), left={opponent:0, ambiguous:0, noTeam:0}, selfEv=new Map();
    const rec=n=>{ let r=names.get(n); if(!r){ r={name:n, n:ZERO(), nos:[], uses:0}; names.set(n, r); } return r; };
    const fn=s=>{ const t=slotTeam(s, known, ctx);
      if(t!==ctx.T){ if(t===ctx.O) left.opponent++; else if(t==='?') left.ambiguous++; else left.noTeam++; return; }
      if(typeof s.name!=='string'||!tidy(s.name)) return;
      if(s.kind==='plainPlayer'&&isPTag(s.name)) return;             // a GIU P-tag is not a name
      const r=rec(s.name);
      if(SELF[s.kind]){ let set=selfEv.get(s.name); if(!set){ set=new Set(); selfEv.set(s.name, set); } set.add(s.id); return; }
      r.n[COUNT_OF[s.kind]]++; r.uses++;
      if(s.kind==='sheet'&&s.no&&!r.nos.includes(s.no)) r.nos.push(s.no); };
    walkEvents(meta, rows, ctx, index, fn); walkMeta(clone(meta), ctx, index, fn);
    selfEv.forEach((set, n)=>{ const r=rec(n); r.n.player=set.size; r.uses+=set.size; });
    return {id:meta.id, side:ctx.side, T:ctx.T, O:ctx.O, names, left};
  }

  // ── a team's spellings over all its games ─────────────────────
  // games: [{meta, events:[{id, data}]}] -> {spellings:[{name, key, fold, n, uses, nos, games:[{id, date, title, opp,
  //   n, uses}]}] sorted by name, games:[{id, date, title, opp, side}] (the team's games, oldest first)}
  function teamNames(games, team){
    const by=new Map(), list=[];
    (games||[]).forEach(g=>{ const sc=g&&g.meta?scanGame(g.meta, g.events||[], team):null; if(!sc) return;
      const m=g.meta, opp=sc.side==='home'?m.awayTeam:m.homeTeam, info={id:m.id, date:m.date||'', title:m.title||'', opp:opp||'', side:sc.side, section:m.section==='club'?'club':'county'};
      list.push(info);
      sc.names.forEach(r=>{ let s=by.get(r.name); if(!s){ s={name:r.name, key:pkey(r.name), fold:fkey(r.name), n:ZERO(), uses:0, nos:[], games:[]}; by.set(r.name, s); }
        Object.keys(r.n).forEach(k=>{ s.n[k]+=r.n[k]; }); s.uses+=r.uses; r.nos.forEach(x=>{ if(!s.nos.includes(x)) s.nos.push(x); });
        s.games.push(Object.assign({}, info, {n:r.n, uses:r.uses, nos:r.nos})); }); });
    const cmp=(a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id));
    list.sort(cmp);
    const spellings=[...by.values()].filter(s=>s.key).sort((a,b)=>a.name.localeCompare(b.name, undefined, {sensitivity:'base'})||(a.name<b.name?-1:1));
    spellings.forEach(s=>{ s.games.sort(cmp); s.nos.sort((a,b)=>a-b); });
    return {spellings, games:list};
  }
  // the spelling a merge proposes: the most-used one (ties: on a team sheet, then the longer, then A–Z), tidied
  function bestSpelling(list){
    const a=(list||[]).slice().sort((x,y)=>y.uses-x.uses||y.n.sheet-x.n.sheet||y.name.length-x.name.length||(x.name<y.name?-1:1));
    return a.length?tidy(a[0].name):'';
  }
  // same Players-tab key = the same player: [{key, spellings:[…most used first], uses}] sorted by name
  function groupsOf(spellings){
    const m=new Map();
    (spellings||[]).forEach(s=>{ let g=m.get(s.key); if(!g){ g={key:s.key, spellings:[], uses:0}; m.set(s.key, g); } g.spellings.push(s); g.uses+=s.uses; });
    const out=[...m.values()];
    out.forEach(g=>{ g.spellings.sort((x,y)=>y.uses-x.uses||(x.name<y.name?-1:1)); g.name=bestSpelling(g.spellings); });
    return out.sort((a,b)=>a.name.localeCompare(b.name, undefined, {sensitivity:'base'}));
  }

  // ── possible duplicates (SUGGESTED only — never merged by themselves) ──
  // Optimal-string-alignment distance (insert, delete, substitute, swap two neighbours), capped at 3.
  function dist(a, b){
    if(a===b) return 0; if(Math.abs(a.length-b.length)>2) return 3;
    const n=a.length, m=b.length, d=[]; for(let i=0;i<=n;i++){ d.push(new Array(m+1).fill(0)); d[i][0]=i; } for(let j=0;j<=m;j++) d[0][j]=j;
    for(let i=1;i<=n;i++) for(let j=1;j<=m;j++){ const c=a[i-1]===b[j-1]?0:1;
      d[i][j]=Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+c);
      if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1]) d[i][j]=Math.min(d[i][j], d[i-2][j-2]+1); }
    return Math.min(3, d[n][m]);
  }
  // first word = first name, the rest = surname ("O Donoghue", "Mc Andrew", "Óg Horkan" read as one word)
  function nameParts(name){ const w=tidy(name).split(' '); return w.length<2?{first:fkey(name), last:''}:{first:fkey(w[0]), last:fkey(w.slice(1).join(' '))}; }
  // short forms that are the same first name (accent-folded). Only used when the surname is the same AND nobody
  // else in the team could be meant.
  const SHORT=[['patrick','paddy','pat','padraig','padraic','podge','paudie'], ['michael','mick','mike','mikey','micheal','mickey'], ['thomas','tom','tommy','tomas'],
    ['james','jim','jimmy','jamie','seamus'], ['joseph','joe','joey'], ['daniel','dan','danny'], ['matthew','matt','mattie'], ['christopher','chris','christy'],
    ['robert','rob','robbie','bob','bobby'], ['william','will','willie','bill','billy'], ['edward','ed','eddie','eamon','eamonn'], ['gerard','ger','gerry','gearoid'],
    ['david','dave','davy','daithi'], ['stephen','steven','steve','stevie'], ['andrew','andy'], ['anthony','tony'], ['nicholas','nick','nicky'], ['alexander','alex'],
    ['benjamin','ben'], ['samuel','sam'], ['joshua','josh'], ['oliver','ollie'], ['charles','charlie'], ['kevin','kev'], ['donal','donie','donall'], ['diarmuid','dermot','diarmaid'],
    ['john','johnny','jack','sean'], ['peter','pete','peadar'], ['brendan','brendy'], ['cathal','charlie'], ['conor','connor','con'], ['darragh','dara','daire'], ['cillian','killian'],
    ['ciaran','kieran'], ['niall','neil'], ['eoin','owen','eoghan'], ['aidan','aiden','aodhan'], ['rory','ruairi','ruaidhri'], ['shane','shay','shea','seaghan']];
  function shortSet(first){ const i=SHORT.findIndex(s=>s.includes(first)); return i; }
  // groups: groupsOf(…). -> [{a:key, b:key, code, reason}] — every pair that LOOKS like one player.
  //   accents   the same letters once accents and punctuation are dropped                  (Seán / Sean)
  //   surname   the same first name; the surname differs by one letter (4+ letters) or two (8+)   (Barret / Barrett)
  //   first     the same surname; the first name differs by one letter, same initial, 4+ letters   (Eamon / Eamonn)
  //   initial   the same surname; one is just an initial and only ONE player of that surname fits it
  //   short     the same surname; a known short form, and only ONE player of that surname fits it  (Tony / Anthony)
  // Sharing a surname is never enough: Ryan / Fionn / Eoin / Shea O'Donoghue and Joe / Bob Tuohy are different people.
  function suggest(groups){
    const G=(groups||[]).map(g=>Object.assign({g, fold:fkey(g.name)}, nameParts(g.name))), out=[];
    const sameLast=(x)=>G.filter(y=>y.last&&y.last===x.last);
    for(let i=0;i<G.length;i++) for(let j=i+1;j<G.length;j++){
      const a=G[i], b=G[j]; let code='', reason='';
      if(a.fold&&a.fold===b.fold){ code='accents'; reason='Same letters — only accents or punctuation differ'; }
      else if(a.last&&b.last&&a.first===b.first&&a.first.length>1){
        const d=dist(a.last, b.last), mn=Math.min(a.last.length, b.last.length);
        if((d===1&&mn>=4)||(d===2&&mn>=8)){ code='surname'; reason='Same first name — the surname differs by '+(d===1?'one letter':'two letters'); }
      }
      else if(a.last&&a.last===b.last){
        const fa=a.first, fb=b.first;
        if(fa.length>=4&&fb.length>=4&&fa[0]===fb[0]&&dist(fa, fb)===1){ code='first'; reason='Same surname — the first name differs by one letter'; }
        else if((fa.length===1)!==(fb.length===1)){
          const ini=fa.length===1?a:b, full=ini===a?b:a;
          if(full.first[0]===ini.first&&sameLast(ini).filter(y=>y.first.length>1&&y.first[0]===ini.first).length===1){ code='initial'; reason='Initial only — the only player of that surname whose first name starts with “'+ini.first.toUpperCase()+'”'; }
        }
        else if(shortSet(fa)>=0&&SHORT.some(s=>s.includes(fa)&&s.includes(fb))){
          const sets=SHORT.filter(s=>s.includes(fa)&&s.includes(fb));
          if(sameLast(a).filter(y=>sets.some(s=>s.includes(y.first))).length===2){ code='short'; reason='Same surname — a short form of the same first name'; }
        }
      }
      if(code) out.push({a:a.g.key, b:b.g.key, code, reason});
    }
    return out;
  }
