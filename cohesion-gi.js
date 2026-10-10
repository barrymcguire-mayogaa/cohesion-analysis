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
 * LOCATIONS AND DETAILS marked on an original before it is converted are carried
 * onto its derived shot / KO row (see the CARRY block); cohGiCarryDetails does the
 * same for a game converted earlier. Nothing is ever removed from an original.
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

  // ── CARRY: locations and hand-entered details, original → derived row ──
  // A location or a detail (leg, side, pressure, zone, who took / won a kickout …)
  // marked on a GI / GIU ORIGINAL row would otherwise stay on that row, which every
  // reader skips once it is superseded. carryPlan(derived, original) lists what the
  // derived SHOT / KO row lacks and its original carries:
  //   · the LOCATION — the row's own x / y fields and its X-/Y- label pair, written
  //     under the pair name for the DERIVED row's team (X-Shot / Y-Shot, X-KOs / Y-KOs
  //     for the home team or a row with no team, …_away for the away team — the rule
  //     Code Room's own maps use). Taken whole from ONE row: a derived row that has a
  //     location keeps it and nothing of the original's location is mixed in.
  //   · the ZONE label (Shot Zones / Kickout Zones) — it belongs to the location, so
  //     it is only copied onto a row that has no location of its own.
  //   · every COHESION label group that applies to the derived row's code
  //     (cohesion-config.js COHESION_LABEL_GROUPS; the list below when that file is
  //     not loaded), every value of a repeated group (labelsAll).
  // A value the derived row already has is never replaced, with ONE exception at
  // conversion time: a hand-entered "Shot Attempts" on the original wins over the one
  // mapped from the GI outcome. Every other difference is returned as a clash (the
  // derived row's value is kept). opts.attempt(row, x, y, original) → a "Shot
  // Attempts" value for a located shot that still has none (Code Room passes its
  // own inside / outside-the-arc rule, so a copied location behaves like a placed one).
  const CARRY_GROUPS = [
    { name:'Shot Attempts', re:/SHOT (OPEN|DEAD)/ }, { name:'Deadball Shot Type', re:/SHOT DEAD ?BALL/ },
    { name:'Shooting Leg', re:/SHOT (OPEN|DEAD)/ }, { name:'Shot Side', re:/SHOT (OPEN|DEAD)/ },
    { name:'Shot Pressure', re:/SHOT (OPEN|DEAD)/ }, { name:'Assist', re:/SHOT (OPEN|DEAD)/ },
    { name:'Kickout Locations', re:/\bKO\b|KICKOUT/ }, { name:'Kickout Won By', re:/\bKO\b|KICKOUT/ }, { name:'Kickout Taken By', re:/\bKO\b|KICKOUT/ } ];
  const CARRY_WORD = { 'shot attempts':'attempt', 'deadball shot type':'dead-ball type', 'shooting leg':'leg', 'shot side':'side', 'shot pressure':'pressure',
    'assist':'assist', 'kickout locations':'length', 'kickout won by':'won by', 'kickout taken by':'taken by' };
  function carryGroups(code){
    const c = up(code), defs = root && root.COHESION_LABEL_GROUPS;
    const src = (Array.isArray(defs) && defs.length) ? defs.map(g => ({ name:g.name, re:g.appliesTo })) : CARRY_GROUPS;
    return src.filter(g => g.name && (!g.re || g.re.test(c))).map(g => g.name);
  }
  function keyOf(obj, g){
    if(!obj) return null;
    if(Object.prototype.hasOwnProperty.call(obj, g)) return g;
    const w = String(g).toLowerCase();
    for(const k of Object.keys(obj)) if(k.toLowerCase() === w) return k;
    return null;
  }
  // every value of a group, oldest first (cohesion-labels.js cohLabelValues' rule); [] when blank
  function valsOf(e, g){
    const L = (e && e.labels) || {}, k = keyOf(L, g);
    if(k == null) return [];
    const cur = L[k] == null ? '' : String(L[k]).trim();
    if(!cur) return [];
    const ak = keyOf(e.labelsAll, k), all = ak != null ? e.labelsAll[ak] : null;
    if(!Array.isArray(all) || all.length < 2) return [cur];
    const a = all.map(v => String(v == null ? '' : v).trim()).filter(Boolean);
    if(a.length < 2) return [cur];
    return a[a.length-1] === cur ? a : a.slice(0, -1).concat([cur]);
  }
  const sameVals = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const fin = v => v != null && v !== '' && isFinite(+v);
  // where a row's location is stored: its own x / y and / or an X-/Y- label pair
  function carryPos(e, base, suf){
    if(!e) return null;
    const L = e.labels || {}, keys = Object.keys(L), pairs = [];
    keys.forEach(k => { const m = /^x([-_ ].*)$/i.exec(k); if(!m) return;
      const yk = keys.find(k2 => /^y/i.test(k2) && k2.slice(1).toLowerCase() === m[1].toLowerCase());
      if(yk && fin(parseFloat(L[k])) && fin(parseFloat(L[yk]))) pairs.push({ tail:m[1].slice(1).toLowerCase(), xs:String(L[k]).trim(), ys:String(L[yk]).trim() }); });
    const b = String(base || '').toLowerCase(), other = suf ? '' : '_away';
    const pair = pairs.find(p => p.tail === b + (suf || '')) || pairs.find(p => p.tail === b + other) || pairs[0] || null;
    const native = fin(e.x) && fin(e.y);
    if(!native && !pair) return null;
    return { native, x: native ? +e.x : parseFloat(pair.xs), y: native ? +e.y : parseFloat(pair.ys), pair };
  }
  function carryKind(d){ return !d || !lbl(d, GI_SRC) ? null : isDerivedKo(d) ? 'ko' : /SHOT (OPEN|DEAD)/i.test(d.code || '') ? 'shot' : null; }
  // → null, or { x, y (own fields, when the original has them), labels:{group:[values]}, what:[words], clash:[…], auto }
  function carryPlan(d, o, game, opts, atConvert){
    const kind = carryKind(d);
    if(!kind || !o) return null;
    const base = kind === 'ko' ? 'KOs' : 'Shot', zg = kind === 'ko' ? 'Kickout Zones' : 'Shot Zones';
    const T = up(d.team), suf = (!T || T === up(game && game.homeTeam)) ? '' : '_away';
    const plan = { labels:{}, what:[], clash:[], auto:false };
    const dPos = carryPos(d, base, suf), oPos = carryPos(o, base, suf), dZone = valsOf(d, zg), oZone = valsOf(o, zg);
    const copyLoc = !!oPos && !dPos && (!dZone.length || !oZone.length || sameVals(dZone, oZone));
    if(copyLoc){
      if(oPos.native){ plan.x = oPos.x; plan.y = oPos.y; }
      plan.labels['X-'+base+suf] = [oPos.pair ? oPos.pair.xs : String(Math.round(oPos.x))];
      plan.labels['Y-'+base+suf] = [oPos.pair ? oPos.pair.ys : String(Math.round(oPos.y))];
      plan.what.push('location');
    }
    if(oZone.length && !dZone.length && !dPos && (copyLoc || !oPos)){ plan.labels[zg] = oZone; plan.what.push('zone'); }
    carryGroups(d.code).forEach(g => {
      if(g.toLowerCase() === zg.toLowerCase()) return;
      const ov = valsOf(o, g); if(!ov.length) return;
      const dv = valsOf(d, g), word = CARRY_WORD[g.toLowerCase()] || g.toLowerCase();
      if(!dv.length || (atConvert && g === 'Shot Attempts' && !sameVals(dv, ov))){ plan.labels[keyOf(d.labels, g) || g] = ov; plan.what.push(word); }
      else if(!sameVals(dv, ov)) plan.clash.push({ group:g, kept:dv, original:ov });
    });
    if(kind === 'shot' && copyLoc && opts && typeof opts.attempt === 'function'
       && !valsOf(d, 'Shot Attempts').length && !plan.labels[keyOf(plan.labels, 'Shot Attempts') || 'Shot Attempts']){
      const tmp = cohGiCarryApply(JSON.parse(JSON.stringify(d)), plan);
      let a = ''; try{ a = String(opts.attempt(tmp, oPos.x, oPos.y, o) || '').trim(); }catch(_){ a = ''; }
      if(a){ plan.labels['Shot Attempts'] = [a]; plan.what.push('attempt (from location)'); plan.auto = true; }
    }
    return (plan.what.length || plan.clash.length) ? plan : null;
  }
  // Write a plan's changes onto a row (the row is changed in place — pass a copy to keep the source). Returns the row.
  function cohGiCarryApply(row, ch){
    if(!row || !ch) return row;
    if(ch.x != null && ch.y != null){ row.x = ch.x; row.y = ch.y; }
    row.labels = row.labels || {};
    Object.keys(ch.labels || {}).forEach(g => {
      const vals = (ch.labels[g] || []).filter(v => v != null && v !== ''); if(!vals.length) return;
      const k = keyOf(row.labels, g) || g, ak = keyOf(row.labelsAll, k);
      row.labels[k] = vals[vals.length-1];
      if(ak != null) delete row.labelsAll[ak];
      if(vals.length > 1){ row.labelsAll = row.labelsAll || {}; row.labelsAll[k] = vals.slice(); }
      const w = k.toLowerCase();
      if(!row.subtype && (w === 'deadball shot type' || w === 'kickout locations')) row.subtype = vals[vals.length-1];   // the denormalised field the mapping fills
    });
    if(row.labelsAll && !Object.keys(row.labelsAll).length) delete row.labelsAll;
    return row;
  }
  // Totals of a list of plans, for the conversion summary and the recovery button.
  function carryTally(plans){
    const t = { rows:0, locations:0, zones:0, details:0, attempts:0, lenClash:0, clashes:[], auto:[] };
    (plans || []).forEach(p => { if(!p) return;
      if(p.what.length) t.rows++;
      p.what.forEach(w => { if(w === 'location') t.locations++; else if(w === 'zone') t.zones++; else if(/^attempt \(/.test(w)) t.attempts++; else t.details++; });
      (p.clash || []).forEach(c => { t.clashes.push(Object.assign({ derivedId:p.derivedId }, c)); if(c.group === 'Kickout Locations') t.lenClash++; });
      if(p.auto) t.auto.push(p.derivedId); });
    return t;
  }
  // GAMES ALREADY CONVERTED. For every derived shot / KO row: what its original carries
  // and the derived row has NO value for. Never a value the derived row already has, never
  // part of a location onto a row that has one. Pure — nothing is changed; apply each
  // entry with cohGiCarryApply(row, entry.changes). Running it on the result finds nothing.
  //   → [{ derivedId, originalId, index (of the derived row in events), kind, what:[words], changes:{x, y, labels:{group:[values]}}, auto }]
  function cohGiCarryDetails(events, game, opts){
    const byId = new Map();
    (events || []).forEach(e => { if(e && !lbl(e, GI_SRC) && e.id != null && !byId.has(String(e.id))) byId.set(String(e.id), e); });
    const out = [];
    (events || []).forEach((d, index) => {
      const kind = carryKind(d); if(!kind) return;
      const o = byId.get(lbl(d, GI_SRC)); if(!o) return;
      const p = carryPlan(d, o, game, opts, false);
      if(!p || !p.what.length) return;
      const changes = { labels:p.labels }; if(p.x != null){ changes.x = p.x; changes.y = p.y; }
      out.push({ derivedId:d.id, originalId:o.id, index, kind, what:p.what, changes, auto:p.auto });
    });
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
    const out = [], plans = [];
    (events || []).forEach(e => {
      const gi = doShots && isGiShot(e), giu = doShots && !gi && isGiuShot(e);
      const ko = !gi && !giu && doKos && isGiKickout(e, game);
      if(!gi && !giu && !ko) return;
      const id = String(e.id);
      if(!id || done.has(id)) return;
      done.add(id);
      const rows = gi ? cohGiMapShot(e) : giu ? cohGiuMapShot(e, game) : cohGiMapKickout(e, game);
      // the shot / KO row (never a score or break companion) takes its original's location and details
      const p = (rows.length && !(opts && opts.carry === false)) ? carryPlan(rows[0], e, game, opts, true) : null;
      if(p){ cohGiCarryApply(rows[0], p); p.derivedId = rows[0].id; plans.push(p); }
      rows.forEach(n => out.push(n));
    });
    // what was carried — a property of the returned list (not of any event): see cohGiCounts
    Object.defineProperty(out, 'carried', { value: carryTally(plans), enumerable:false });
    return out;
  }
  // Counts for the confirmation text.
  function cohGiCounts(newEvents){
    let shots = 0, scores = 0, kos = 0, breaks = 0;
    (newEvents || []).forEach(e => { const c = e.code || '';
      if(/SHOT (OPEN|DEAD)/i.test(c)) shots++; else if(isDerivedKo(e)) kos++;
      else if(/\sBREAK (WON|LOST)\s*$/i.test(c)) breaks++; else scores++; });
    const k = (newEvents && newEvents.carried) || {};
    return { shots, scores, kos, breaks, locations:k.locations||0, zones:k.zones||0, details:k.details||0, attempts:k.attempts||0,
      carriedRows:k.rows||0, lenClash:k.lenClash||0, clashes:k.clashes||[] };
  }

  // cohGiIsShot = any original the conversion handles (GI "<Team> Shot" or a GIU shot).
  const api = { cohGiConvert, cohGiSuperseded, cohGiSupersededFn, cohGiIsCompanion, cohGiIsShot:isAnyGiShot,
    cohGiIsKickout:isGiKickout, cohGiIsDerivedKo:isDerivedKo, cohGiMapKickout,
    cohGiIsGiShot:isGiShot, cohGiIsGiuShot:isGiuShot, cohGiMapShot, cohGiuMapShot, cohGiuRosterName, cohGiCounts,
    cohGiCarryDetails, cohGiCarryApply, cohGiCarryTally:carryTally, COH_GI_SRC:GI_SRC };
  Object.assign(root, api);
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
