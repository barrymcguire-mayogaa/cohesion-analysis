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
