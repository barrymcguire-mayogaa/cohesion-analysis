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

  // Ids of GI originals that already have a derived SHOT event.
  function cohGiSuperseded(events){
    const s = new Set();
    (events || []).forEach(e => {
      const id = lbl(e, GI_SRC);
      if(id && /SHOT (OPEN|DEAD)/i.test(e.code || '')) s.add(id);
    });
    return s;
  }
  // Bare companion created by the conversion (not a shot in its own right).
  function cohGiIsCompanion(e){
    return !!lbl(e, GI_SRC) && !/SHOT/i.test((e && e.code) || '');
  }
  // Per-event predicate factory: true for an original that is superseded.
  function cohGiSupersededFn(events){
    const s = cohGiSuperseded(events);
    return e => !!(s.size && e && !lbl(e, GI_SRC) && s.has(String(e.id)) && isAnyGiShot(e));
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
  function cohGiConvert(events, game){
    const done = new Set();
    (events || []).forEach(e => { const id = lbl(e, GI_SRC); if(id) done.add(id); });
    const out = [];
    (events || []).forEach(e => {
      const gi = isGiShot(e);
      if(!gi && !isGiuShot(e)) return;
      const id = String(e.id);
      if(!id || done.has(id)) return;
      done.add(id);
      (gi ? cohGiMapShot(e) : cohGiuMapShot(e, game)).forEach(n => out.push(n));
    });
    return out;
  }
  // Counts for the confirmation text.
  function cohGiCounts(newEvents){
    let shots = 0, scores = 0;
    (newEvents || []).forEach(e => { if(/SHOT (OPEN|DEAD)/i.test(e.code || '')) shots++; else scores++; });
    return { shots, scores };
  }

  // cohGiIsShot = any original the conversion handles (GI "<Team> Shot" or a GIU shot).
  const api = { cohGiConvert, cohGiSuperseded, cohGiSupersededFn, cohGiIsCompanion, cohGiIsShot:isAnyGiShot,
    cohGiIsGiShot:isGiShot, cohGiIsGiuShot:isGiuShot, cohGiMapShot, cohGiuMapShot, cohGiuRosterName, cohGiCounts, COH_GI_SRC:GI_SRC };
  Object.assign(root, api);
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
