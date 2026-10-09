/* COHESION — Gaelic Insights shot conversion (shared helper)
 *
 * A Gaelic Insights (GI) XML codes every shot as "<Team> Shot" with the
 * labels Player / Assist / Source / Description / Outcome. COHESION's own
 * shot model (Code Room, Match Tracker XMLs, the dashboard's stats and maps)
 * is "<TEAM> SHOT OPEN PLAY" / "<TEAM> SHOT DEADBALL" with "Shot Outcomes",
 * "Shot Attempts", "Deadball Shot Type", X-Shot/Y-Shot … and, for scores, a
 * bare "<TEAM> 1 POINT|2 POINT|GOAL" companion on the same window.
 *
 * cohGiConvert(events, game) returns NEW events only — one derived shot per
 * unconverted GI shot, plus the bare score companion for scores. Every
 * derived event carries the label "GI Source ID" = the original's id, which
 * makes the conversion idempotent. The original GI event is never modified.
 *
 * cohGiSuperseded(events) returns the Set of original ids that already have
 * a derived shot — stats count the derived shot and skip those originals so
 * each shot is counted exactly once. Games that were never converted return
 * an empty set and behave exactly as before.
 *
 * GIU files (Gaelic Insights "GIU" exports with P1/P2 START markers) code
 * shots differently — "<Team> Shot (P)" open play, "<Team> Shot (F)" free,
 * "<Team> Shot Sideline", and "<Team> 45" / "<Team> Penalty" when they carry
 * a ShotOutcome label — with ShotOutcome / ShootingIntent / Player ("P11")
 * labels. They convert the same way (same link label, same companions, same
 * superseded handling); see cohGiuMapShot.
 *
 * KICKOUTS convert the same way (see the KICKOUTS block): each GI / GIU
 * "<Team> Kickout" gains a "<KICKING TEAM> KO" with Code Room's own labels,
 * plus both teams' BREAK WON / BREAK LOST rows for a break ball; the original
 * is superseded, the break rows are companions.
 *
 * Loaded by admin.html, code-room.html, dashboard.html and season-stats.html;
 * also require()-able from node for the headless tests.
 */
(function(root){
  const GI_SRC = 'GI Source ID';

  // Outcome label → COHESION "Shot Outcomes" (+ optional Wide Direction).
  // NB: the COHESION '45 OUTCOME means "won a '45"; a GI Description of
  // "Forty Five" means the shot WAS a '45 kick (→ Deadball Shot Type '45).
  const OUTCOME = {
    'POINT':      { out:'1 POINT' },
    'TWO POINTS': { out:'2 POINT' },
    'TWO POINT':  { out:'2 POINT' },
    'GOAL':       { out:'GOAL' },
    'WIDE LEFT':  { out:'WIDE', dir:'Left' },
    'WIDE RIGHT': { out:'WIDE', dir:'Right' },
    'WIDE':       { out:'WIDE' },
    'SHORT':      { out:'SHORT' },
    'SAVED':      { out:'SAVE' },
    'SAVE':       { out:'SAVE' },
    'HIT POST':   { out:'WOODWORK' },
    'BLOCKED':    { out:'BLOCKED' },
  };
  // Description (non-Play) → "Deadball Shot Type".
  const DEADBALL = { 'FREE':'FREE KICK', 'FORTY FIVE':"'45", 'PENALTY':'PENALTY', 'SIDELINE':'SIDELINE', 'MARK':'MARK' };
  // Scores → "Shot Attempts" (misses are left blank; penalties are always a Goal Attempt).
  const ATTEMPT = { '1 POINT':'1 Point Attempt', '2 POINT':'2 Point Attempt', 'GOAL':'Goal Attempt' };
  // GI Source → COHESION "Shot Source Outcomes" vocabulary (cohesion-config.js
  // COHESION_EVENT_LINKS). GI's "Turnover" does not say forced/unforced, so it
  // becomes the plain TURNOVER rather than guessing one of the two.
  const SOURCE = { 'OWN KICKOUT':'OWN KICKOUT', 'OPP KICKOUT':'OPP KICKOUT', 'OPPOSITION KICKOUT':'OPP KICKOUT', 'TURNOVER':'TURNOVER' };
  const SCORES = new Set(['1 POINT','2 POINT','GOAL']);

  const up = s => String(s == null ? '' : s).trim().toUpperCase();
  const lbl = (e, g) => { const L = (e && e.labels) || {}; return L[g] != null ? String(L[g]).trim() : ''; };

  // A GI shot: code "<Team> Shot" (any case), not already a derived event.
  function isGiShot(e){
    if(!e || !e.code) return false;
    if(lbl(e, GI_SRC)) return false;
    return /^\s*\S.*\s+shot\s*$/i.test(e.code) && !/SOURCE|ASSIST/i.test(e.code);
  }
  function giTeamOf(e){
    const t = up(e.team);
    if(t) return t;
    const m = /^\s*(.+?)\s+shot\s*$/i.exec(e.code || '');
    return m ? up(m[1]) : '';
  }
  // ── GIU ─────────────────────────────────────────────────────────
  // Code patterns → [open|dead, Deadball Shot Type, needs a ShotOutcome label].
  // A bare "<Team> 45" (no ShotOutcome) and "<Team> Out for 45" are the
  // award, not the kick; "<Team> Sideline" without "Shot" is a restart.
  const GIU_KINDS = [
    [/^\s*(.+?)\s+shot\s*\(\s*p\s*\)\s*$/i, false, '',          false],
    [/^\s*(.+?)\s+shot\s*\(\s*f\s*\)\s*$/i, true,  'FREE KICK', false],
    [/^\s*(.+?)\s+shot\s+sideline\s*$/i,        true,  'SIDELINE',  false],
    [/^\s*(.+?)\s+45\s*$/i,                      true,  "'45",       true ],
    [/^\s*(.+?)\s+penalty\s*$/i,                 true,  'PENALTY',   true ],
  ];
  // GIU ShotOutcome → COHESION "Shot Outcomes".
  const GIU_OUTCOME = {
    'POINT':'1 POINT', '1 POINT':'1 POINT', '2 POINT':'2 POINT', '2 POINTS':'2 POINT', 'TWO POINT':'2 POINT',
    'GOAL':'GOAL', 'WIDE':'WIDE', 'SHORT':'SHORT', 'SAVE':'SAVE', 'SAVED':'SAVE',
    'BLOCK':'BLOCKED', 'BLOCKED':'BLOCKED', 'POST':'WOODWORK', 'WOODWORK':'WOODWORK',
  };
  function giuKind(e){
    if(!e || !e.code) return null;
    if(lbl(e, GI_SRC)) return null;
    if(/\bout\s+for\s+'?45\b/i.test(e.code)) return null;
    for(const [re, dead, type, needOut] of GIU_KINDS){
      const m = re.exec(e.code);
      if(!m) continue;
      if(needOut && !lbl(e, 'ShotOutcome')) return null;
      return { team: up(m[1]), dead, type };
    }
    return null;
  }
  function isGiuShot(e){ return !!giuKind(e); }
  // Any original this helper converts (GI or GIU).
  function isAnyGiShot(e){ return isGiShot(e) || isGiuShot(e); }

  // GIU "P11" → a player NAME from the game's own roster data, only when the
  // number is unambiguous for the shooting team's side; '' otherwise.
  //  1. game.playerRoster {teamA:{P11:name}, teamB:{…}} — admin's roster editor
  //     (teamA = home, teamB = away); keyed by the tag, so never ambiguous.
  //  2. game.rosters {home:[…], away:[…]} entries that carry a number:
  //     "11 Name", "#11 Name", "11. Name", "Name (11)", or {number|no|num|jersey|shirt, name}.
  //     String entries are returned as stored (that is what Code Room tags as
  //     the player for this roster); used only if exactly one entry has the number.
  function rosterEntry(r){
    if(r == null) return null;
    if(typeof r === 'object'){
      const n = r.number != null ? r.number : r.no != null ? r.no : r.num != null ? r.num : r.jersey != null ? r.jersey : r.shirt;
      const name = String(r.name != null ? r.name : (r.player != null ? r.player : '')).trim();
      const k = parseInt(n, 10);
      return (isFinite(k) && name) ? { num:String(k), name } : null;
    }
    const s = String(r).trim();
    let m = /^#?\s*(\d{1,2})\s*[.\-:)]?\s+(\S.*)$/.exec(s);
    if(m) return { num:String(+m[1]), name:s };
    m = /^(\S.*?)\s*(?:\(\s*#?\s*(\d{1,2})\s*\)|#\s*(\d{1,2}))\s*$/.exec(s);
    if(m) return { num:String(+(m[2] || m[3])), name:s };
    return null;
  }
  function cohGiuRosterName(game, TEAM, tag){
    const m = /^P\s*(\d{1,2})$/i.exec(String(tag || '').trim());
    if(!m || !game) return '';
    const n = String(+m[1]), T = up(TEAM);
    const side = (T && T === up(game.homeTeam)) ? 'home' : (T && T === up(game.awayTeam)) ? 'away' : '';
    if(!side) return '';
    const pr = game.playerRoster && game.playerRoster[side === 'home' ? 'teamA' : 'teamB'];
    if(pr){
      const v = String(pr['P' + n] == null ? '' : pr['P' + n]).trim();
      if(v && !/^P\d+$/i.test(v)) return v;
    }
    const list = game.rosters && game.rosters[side];
    if(Array.isArray(list)){
      const hits = new Set();
      list.forEach(r => { const p = rosterEntry(r); if(p && p.num === n) hits.add(p.name); });
      if(hits.size === 1) return [...hits][0];
    }
    return '';
  }

  // ── KICKOUTS ────────────────────────────────────────────────────
  // GI:  "<Team> Kickout" (row team = the KICKING team), KickoutOutcome
  //      "KT Won Clean|Break" (kicking team won) / "RT Won Clean|Break"
  //      (receiving team won), KickoutLength Short|Mid-Range|Long, and the
  //      row's player = the kickout's TARGET on the kicking team.
  // GIU: "<Team> Kickout", KickoutOutcome "<Winner> Clean|Break|Free|SL"
  //      (the team NAMED won it), KODistance SKO|MKO|LKO, no players.
  // Each converts to "<KICKING TEAM> KO" with Code Room's own labels
  // ('Kickout Outcomes' from the kicker's view, 'Kickout Locations'), plus —
  // break outcomes only — "<WINNER> BREAK WON" and "<LOSER> BREAK LOST".
  // No TOs / FOUL companions: GI and GIU carry their own turnover / foul rows.
  // A row whose outcome cannot be read is left alone (never guessed).
  const KO_LEN = { 'SHORT':'KO SHORT', 'SKO':'KO SHORT', 'MID-RANGE':'KO MEDIUM', 'MID RANGE':'KO MEDIUM', 'MID':'KO MEDIUM',
    'MEDIUM':'KO MEDIUM', 'MKO':'KO MEDIUM', 'LONG':'KO LONG', 'LKO':'KO LONG' };
  const KO_TYPE = { 'CLEAN':'CLEAN', 'BREAK':'BREAK', 'FREE':'FREE', 'SL':'SIDELINE', 'SIDELINE':'SIDELINE' };
  function koOtherTeam(game, TEAM){
    const H = up(game && game.homeTeam), A = up(game && game.awayTeam);
    return TEAM && TEAM === H ? A : TEAM && TEAM === A ? H : '';
  }
  // → { team (kicker), opp, won (by the kicker), type, out, len, gi } or null.
  function koMap(e, game){
    if(!e || !e.code || lbl(e, GI_SRC)) return null;
    const m = /^\s*(.+?)\s+kickout\s*$/i.exec(e.code);
    if(!m) return null;
    const TEAM = up(e.team) || up(m[1]);
    const K = up(lbl(e, 'KickoutOutcome') || lbl(e, 'PO_Result') || e.outcome).replace(/\s+/g, ' ');
    if(!TEAM || !K) return null;
    let opp = koOtherTeam(game, TEAM), won, type, gi = false;
    const g = /^(KT|RT) WON (CLEAN|BREAK)$/.exec(K);
    if(g){ gi = true; won = g[1] === 'KT'; type = g[2]; }
    else {
      const u = /^(.+) (CLEAN|BREAK|FREE|SL|SIDELINE)$/.exec(K);
      if(!u) return null;
      const who = u[1].trim();
      if(who === TEAM) won = true;
      else if(!opp || who === opp){ won = false; opp = who; }
      else return null;                       // names neither team of this game
      type = KO_TYPE[u[2]];
    }
    const out = type === 'CLEAN' ? (won ? 'KO WON CLEAN' : 'KO LOST CLEAN') : 'KO ' + type + (won ? ' WON' : ' LOST');
    const len = KO_LEN[up(lbl(e, 'KickoutLength') || lbl(e, 'Kickout_Length') || lbl(e, 'KODistance'))] || '';
    return { team:TEAM, opp, won, type, out, len, gi };
  }
  function isGiKickout(e, game){ return !!koMap(e, game); }
  // A derived kickout: "<TEAM> KO" carrying the link label.
  function isDerivedKo(e){ return !!lbl(e, GI_SRC) && /\sKO\s*$/i.test((e && e.code) || ''); }
  // Map one GI / GIU kickout to its COHESION kickout (+ both break rows). Pure.
  function cohGiMapKickout(e, game){
    const k = koMap(e, game);
    if(!k) return [];
    const L = e.labels || {};
    const labels = { 'Kickout Outcomes': k.out };
    if(k.len) labels['Kickout Locations'] = k.len;
    // GI's player is the kicking team's target: he WON it only when KT won.
    const p = k.gi ? String(e.player || L['Player'] || '').trim() : '';
    if(p) labels[k.won ? 'Kickout Won By' : 'Kickout Target'] = p;
    labels[GI_SRC] = String(e.id);
    const base = { start:e.start, end:e.end, half:e.half, driveT:e.driveT };
    if(e.gameTime != null) base.gameTime = e.gameTime;
    if(e.videoT != null) base.videoT = e.videoT;
    const out = [Object.assign({ id:'gi-'+e.id+'-ko', code:k.team+' KO', team:k.team }, base, {
      player:'', outcome:k.out, subtype:k.len, category:'Kickouts', labels })];
    if(k.type === 'BREAK'){
      const row = (tm, what, tag) => { if(tm) out.push(Object.assign({ id:'gi-'+e.id+'-'+tag, code:tm+' '+what, team:tm }, base, {
        player:'', outcome:'', subtype:'', category:'Other', labels:{ [GI_SRC]: String(e.id) } })); };
      row(k.won ? k.team : k.opp, 'BREAK WON', 'brkw');
      row(k.won ? k.opp : k.team, 'BREAK LOST', 'brkl');
    }
    return out;
  }

  // Ids of GI originals that already have a derived SHOT or KO event.
  function cohGiSuperseded(events){
    const s = new Set();
    (events || []).forEach(e => {
      const id = lbl(e, GI_SRC);
      if(id && (/SHOT (OPEN|DEAD)/i.test(e.code || '') || isDerivedKo(e))) s.add(id);
    });
    return s;
  }
  // Bare companion created by the conversion (a score or break row — not a
  // shot or a kickout in its own right).
  function cohGiIsCompanion(e){
    return !!lbl(e, GI_SRC) && !/SHOT/i.test((e && e.code) || '') && !isDerivedKo(e);
  }
  // Per-event predicate factory: true for an original that is superseded.
  function cohGiSupersededFn(events){
    const s = cohGiSuperseded(events);
    return e => !!(s.size && e && !lbl(e, GI_SRC) && s.has(String(e.id))
      && (isAnyGiShot(e) || /^\s*\S.*\s+kickout\s*$/i.test(e.code || '')));
  }

  // Map one GI shot to its COHESION shot (+ score companion). Pure.
  function cohGiMapShot(e, seq){
    const L = e.labels || {};
    const TEAM = giTeamOf(e);
    const desc = up(L['Description'] || e.subtype);
    const o = OUTCOME[up(L['Outcome'] || e.outcome)] || null;
    const deadType = (desc && desc !== 'PLAY') ? (DEADBALL[desc] || '') : '';
    const dead = !!(desc && desc !== 'PLAY');
    const code = TEAM + (dead ? ' SHOT DEADBALL' : ' SHOT OPEN PLAY');
    const labels = {};
    if(o) labels['Shot Outcomes'] = o.out;
    if(o && o.dir) labels['Wide Direction'] = o.dir;
    if(deadType) labels['Deadball Shot Type'] = deadType;
    const att = desc === 'PENALTY' ? 'Goal Attempt' : (o ? ATTEMPT[o.out] : '');
    if(att) labels['Shot Attempts'] = att;
    const player = String(e.player || L['Player'] || '').trim();
    if(player) labels[(TEAM || 'Unassigned') + ' Player Labels'] = player;
    if(L['Assist']) labels['Assist'] = String(L['Assist']).trim();
    const src = SOURCE[up(L['Source'])];
    if(src) labels['Shot Source Outcomes'] = src;
    else if(L['Source']) labels['Shot Source Outcomes'] = up(L['Source']);
    labels[GI_SRC] = String(e.id);
    const base = { start:e.start, end:e.end, half:e.half, team:TEAM, driveT:e.driveT };
    if(e.gameTime != null) base.gameTime = e.gameTime;
    if(e.videoT != null) base.videoT = e.videoT;
    const shot = Object.assign({ id:'gi-'+e.id+'-shot'+(seq?'-'+seq:''), code }, base, {
      player, outcome: o ? o.out : '', subtype: deadType,
      category:'Shots & Scores', labels });
    const out = [shot];
    if(o && SCORES.has(o.out)){
      // Shaped like Code Room's crPushCompanion: same window, no player, no labels
      // (bar the link back to the GI original).
      out.push(Object.assign({ id:'gi-'+e.id+'-score'+(seq?'-'+seq:''), code: TEAM+' '+o.out }, base, {
        player:'', outcome:'', subtype:'', category:'Shots & Scores',
        labels:{ [GI_SRC]: String(e.id) } }));
    }
    return out;
  }

  // Map one GIU shot to its COHESION shot (+ score companion). Pure.
  // Shot Attempts: For Goal (and every penalty) → Goal Attempt, even on a
  // miss; otherwise a score gives the attempt by the scored value; a For
  // Point miss stays blank (placing its location in Code Room fills it).
  function cohGiuMapShot(e, game, seq){
    const k = giuKind(e) || { team:'', dead:false, type:'' };
    const L = e.labels || {};
    const TEAM = up(e.team) || k.team;
    const o = GIU_OUTCOME[up(L['ShotOutcome'] || e.outcome)] || '';
    const code = TEAM + (k.dead ? ' SHOT DEADBALL' : ' SHOT OPEN PLAY');
    const labels = {};
    if(o) labels['Shot Outcomes'] = o;
    if(k.type) labels['Deadball Shot Type'] = k.type;
    const forGoal = up(L['ShootingIntent']) === 'FOR GOAL';
    const att = (k.type === 'PENALTY' || forGoal) ? 'Goal Attempt' : (ATTEMPT[o] || '');
    if(att) labels['Shot Attempts'] = att;
    const tag = String(L['Player'] || e.player || '').trim();
    const player = (/^P\s*\d+$/i.test(tag) && cohGiuRosterName(game, TEAM, tag)) || tag;
    if(player) labels[(TEAM || 'Unassigned') + ' Player Labels'] = player;
    labels[GI_SRC] = String(e.id);
    const base = { start:e.start, end:e.end, half:e.half, team:TEAM, driveT:e.driveT };
    if(e.gameTime != null) base.gameTime = e.gameTime;
    if(e.videoT != null) base.videoT = e.videoT;
    const shot = Object.assign({ id:'gi-'+e.id+'-shot'+(seq?'-'+seq:''), code }, base, {
      player, outcome:o, subtype:k.type, category:'Shots & Scores', labels });
    const out = [shot];
    if(SCORES.has(o)){
      out.push(Object.assign({ id:'gi-'+e.id+'-score'+(seq?'-'+seq:''), code: TEAM+' '+o }, base, {
        player:'', outcome:'', subtype:'', category:'Shots & Scores',
        labels:{ [GI_SRC]: String(e.id) } }));
    }
    return out;
  }

  // New events for every GI / GIU shot with no derived event yet. Idempotent.
  // Kickouts too: an original whose id already appears as a "GI Source ID" is
  // skipped, so a game whose shots were converted earlier only gains its
  // kickouts. opts.kickouts === false / opts.shots === false limit the pass.
  function cohGiConvert(events, game, opts){
    const done = new Set();
    (events || []).forEach(e => { const id = lbl(e, GI_SRC); if(id) done.add(id); });
    const doShots = !(opts && opts.shots === false), doKos = !(opts && opts.kickouts === false);
    const out = [];
    (events || []).forEach(e => {
      const gi = doShots && isGiShot(e), giu = doShots && !gi && isGiuShot(e);
      const ko = !gi && !giu && doKos && isGiKickout(e, game);
      if(!gi && !giu && !ko) return;
      const id = String(e.id);
      if(!id || done.has(id)) return;
      done.add(id);
      (gi ? cohGiMapShot(e) : giu ? cohGiuMapShot(e, game) : cohGiMapKickout(e, game)).forEach(n => out.push(n));
    });
    return out;
  }
  // Counts for the confirmation text.
  function cohGiCounts(newEvents){
    let shots = 0, scores = 0, kos = 0, breaks = 0;
    (newEvents || []).forEach(e => { const c = e.code || '';
      if(/SHOT (OPEN|DEAD)/i.test(c)) shots++; else if(isDerivedKo(e)) kos++;
      else if(/\sBREAK (WON|LOST)\s*$/i.test(c)) breaks++; else scores++; });
    return { shots, scores, kos, breaks };
  }

  // cohGiIsShot = any original the conversion handles (GI "<Team> Shot" or a GIU shot).
  const api = { cohGiConvert, cohGiSuperseded, cohGiSupersededFn, cohGiIsCompanion, cohGiIsShot:isAnyGiShot,
    cohGiIsKickout:isGiKickout, cohGiIsDerivedKo:isDerivedKo, cohGiMapKickout,
    cohGiIsGiShot:isGiShot, cohGiIsGiuShot:isGiuShot, cohGiMapShot, cohGiuMapShot, cohGiuRosterName, cohGiCounts, COH_GI_SRC:GI_SRC };
  Object.assign(root, api);
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
