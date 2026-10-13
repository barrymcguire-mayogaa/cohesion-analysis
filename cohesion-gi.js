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
 * TURNOVERS (see the TURNOVERS block): a Gaelic Insights "<Team> Turnover Won"
 * names the team that WON the ball, with the third from that team's view. Each
 * gains a "<OTHER TEAM> TOs" row (the team that LOST it, the third flipped to
 * that team's view, 'Turnover Outcomes' left blank to be typed in Code Room);
 * the original stays in place and is superseded, so each turnover counts once.
 * A "Turnover Won" with NO zone label was won in the opposition's third (Gaelic
 * Insights only labels Own / Middle), so its row says DEFENSIVE THIRD.
 * A kickout the kicking team LOST also gains the kicker's "<TEAM> TOs" row with
 * 'Turnover Outcomes' = KICKOUT LOST — never a second one for the same kickout.
 * cohGiThirdFixes lists the rows saved before those two third rules were corrected
 * (11 Oct 2026) — see the THIRDS block.
 *
 * A GIU GAME'S OTHER ROWS (see the GIU: OTHER ROWS block): "<Team> Poss", "<Team> Foul", "<Team> Turnover",
 * "<Team> Solo and Go" and "Throw Up" convert the same way — "<TEAM> TEAM POSSESSION", "<TEAM> FOUL" ('Foul Areas'),
 * "<TEAM> TOs" ('Turnover Locations'; FREE AGAINST when that team's own foul is at the same moment), "<TEAM> SOLO AND
 * GO", "HOP BALL" — originals kept and superseded. Sideline / Out for 45 / Goalkeeper / OP Wide are not converted.
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
  // A kickout the kicking team LOST also gets the kicker's "<TEAM> TOs" /
  // KICKOUT LOST row (see TURNOVERS: Gaelic Insights writes no turnover for it).
  // No FOUL companion: GI and GIU carry their own foul rows.
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

  // ── TURNOVERS ───────────────────────────────────────────────────
  // GI: "<Team> Turnover Won" — the row's team WON the ball; its third
  // ('turnover_zone', stored by the admin import as 'TurnoverZone') is from the
  // WINNER's view and its player is the winner's player. Gaelic Insights writes
  // only "Own Third" and "Middle Third": a turnover won in the OPPOSITION's third
  // carries NO zone label at all (33 real files, 1,155 turnovers: 762 Own, 279
  // Middle, 114 with none, never an "Opp Third"; confirmed from video). COHESION
  // codes the team that LOST it: "<LOSER> TOs" with 'Turnover Locations' from the
  // LOSER's view (Own → ATTACKING THIRD, Middle unchanged, no zone label →
  // DEFENSIVE THIRD, the loser's own defensive third). A zone label that cannot be
  // read stays blank. 'Turnover Outcomes' (the type) is not in a GI
  // file, so it is left blank — never guessed — unless one was typed on the
  // original. The winner's player is kept on the new row under HIS team's
  // "<Team> Player Labels" group (the Sportscode convention: a KERRY TOs row
  // carries the Mayo player who won the ball). A row whose other team cannot be
  // read from the game is left alone. GIU "<Team> Turnover" rows already name
  // the team that lost the ball and are not converted.
  const TO_WON_RE = /^\s*(.+?)\s+turnovers?\s+won\s*$/i;
  const TO_LOC_GROUPS = ['Turnover Locations','Turnover Location','turnover_zone','TurnoverZone','PitchArea'];
  const TO_OUT_GROUPS = ['Turnover Outcomes','Turnover Outcome','TurnoverOutcome'];
  function lblCI(e, names){
    const L = (e && e.labels) || {}, keys = Object.keys(L);
    for(const n of names){ const k = keys.find(x => x.toLowerCase() === n.toLowerCase());
      if(k != null && L[k] != null && String(L[k]).trim()) return String(L[k]).trim(); }
    return '';
  }
  function toThird(txt){
    const K = up(txt);
    return /DEFENSIVE|\bDEF\b|\bOWN\b/.test(K) ? 'DEFENSIVE THIRD' : /MIDDLE|\bMID\b/.test(K) ? 'MIDDLE THIRD'
      : /ATTACKING|OFFENSIVE|\bATT\b|\bOPP/.test(K) ? 'ATTACKING THIRD' : '';
  }
  const flipThird = t => t === 'DEFENSIVE THIRD' ? 'ATTACKING THIRD' : t === 'ATTACKING THIRD' ? 'DEFENSIVE THIRD' : t;
  // → { winner, loser, third (the LOSER's view; no zone label = the winner's attacking third; '' when the label cannot be read), zoned } or null.
  function toMap(e, game){
    if(!e || !e.code || lbl(e, GI_SRC)) return null;
    const m = TO_WON_RE.exec(e.code);
    if(!m) return null;
    const winner = up(e.team) || up(m[1]), loser = koOtherTeam(game, winner);
    if(!winner || !loser) return null;
    const zone = lblCI(e, TO_LOC_GROUPS);
    return { winner, loser, third: zone ? flipThird(toThird(zone)) : 'DEFENSIVE THIRD', zoned: !!zone };
  }
  function isGiTurnover(e, game){ return !!toMap(e, game); }
  // A derived turnover row: "<TEAM> TOs" carrying the link label (from a
  // "Turnover Won" original, or the KICKOUT LOST row of a lost kickout).
  function isDerivedTo(e){ return !!lbl(e, GI_SRC) && /\sTOS\s*$/i.test((e && e.code) || ''); }
  const baseOf = e => { const b = { start:e.start, end:e.end, half:e.half, driveT:e.driveT };
    if(e.gameTime != null) b.gameTime = e.gameTime;
    if(e.videoT != null) b.videoT = e.videoT;
    return b; };
  // Map one GI "Turnover Won" to its COHESION turnover row. Pure.
  function cohGiMapTurnover(e, game){
    const t = toMap(e, game);
    if(!t) return [];
    const L = e.labels || {}, labels = {};
    const type = lblCI(e, TO_OUT_GROUPS);
    if(type) labels['Turnover Outcomes'] = type;
    if(t.third) labels['Turnover Locations'] = t.third;
    const p = String(e.player || L['Player'] || '').trim();
    if(p) labels[t.winner + ' Player Labels'] = p;
    labels[GI_SRC] = String(e.id);
    const row = Object.assign({ id:'gi-'+e.id+'-to', code:t.loser+' TOs', team:t.loser }, baseOf(e), {
      player:p, outcome:type, subtype:'', category:'Turnovers', labels });
    if(p) row.playerTeam = t.winner;
    return [row];
  }
  // The kicker's KICKOUT LOST turnover for a lost kickout. Its third is where the
  // kickout landed, from the kicking team's view (DEFENSIVE = own goal line to own
  // 45 m line, MIDDLE = 45 m line to 45 m line, ATTACKING = beyond the far 45):
  // KO SHORT → DEFENSIVE THIRD, KO MEDIUM → MIDDLE THIRD, KO LONG → MIDDLE THIRD
  // (a long kickout is beyond the 65 m line, which is inside the middle third), and
  // ATTACKING THIRD only for a KO LONG whose MARKED landing is beyond the far 45 m
  // line (Y-KOs is "% of 137 m from the kicking goal"; the far 45 is at 95 m). The
  // tagged length decides defensive v middle even where a marked landing disagrees;
  // no length = no third. Code Room's own rule (crKoLocToThird) — keep the two the same.
  const KO_LEN_THIRD = { SHORT:'DEFENSIVE THIRD', MEDIUM:'MIDDLE THIRD', LONG:'MIDDLE THIRD' };
  const KO_UNIT_M = 137, KO_FAR45_M = 95;
  const koLenOf = ko => { const K = up(lbl(ko, 'Kickout Locations')); return /SHORT/.test(K) ? 'SHORT' : /MEDIUM/.test(K) ? 'MEDIUM' : /LONG/.test(K) ? 'LONG' : ''; };
  const koBeyondFar45 = ko => { const pos = carryPos(ko, 'KOs', ''); return !!pos && pos.y * KO_UNIT_M / 100 > KO_FAR45_M; };
  function koLostThird(ko){
    const len = koLenOf(ko);
    if(len !== 'LONG') return KO_LEN_THIRD[len] || '';
    return koBeyondFar45(ko) ? 'ATTACKING THIRD' : KO_LEN_THIRD.LONG;
  }
  const isKoLostTo = e => /\bTOS?\b/i.test((e && e.code) || '') && /KICK\s*OUT LOST|\bKO LOST\b/.test(up(lblCI(e, TO_OUT_GROUPS) || (e && e.outcome)));
  function koLostRow(srcId, at, team){   // at = the kickout's KO row
    const labels = { 'Turnover Outcomes':'KICKOUT LOST' }, third = koLostThird(at);
    if(third) labels['Turnover Locations'] = third;
    labels[GI_SRC] = String(srcId);
    return Object.assign({ id:'gi-'+srcId+'-koto', code:team+' TOs', team }, baseOf(at), {
      player:'', outcome:'KICKOUT LOST', subtype:'', category:'Turnovers', labels });
  }
  const KO_TO_WINDOW = 2;   // seconds: a KICKOUT LOST row this close to the kickout's start IS that kickout's
  // true when the game already has the KICKOUT LOST row of this kickout (made by an
  // earlier conversion, or by Code Room when the outcome was answered there)
  function hasKoLostTo(list, srcId, team, start){
    return list.some(x => x.team === team && (x.src === String(srcId) || (fin0(start) && fin0(x.start) && Math.abs(x.start - start) <= KO_TO_WINDOW)));
  }
  const fin0 = v => v != null && v !== '' && isFinite(+v);

  // ── GIU: OTHER ROWS ─────────────────────────────────────────────
  // A GIU file's possessions, fouls, turnovers, solo-and-goes and throw-ups, read ONLY in a GIU game (one with a
  // "<Team> Shot (P)/(F)" row, or PossFrom / KODistance labels) and only under the exact names a GIU file writes
  // ("Kerry Foul" — never a COHESION "KERRY FOUL"):
  //   "<Team> Poss"         → "<TEAM> TEAM POSSESSION", same span, PossFrom and PitchArea kept (Analysis counts the
  //                           converted row and reads a shot's source from its PossFrom)
  //   "<Team> Foul"         → "<TEAM> FOUL" — the row's team COMMITTED the foul; 'Foul Areas' from PitchArea, that
  //                           team's view (Own → DEFENSIVE, Middle, Opp → ATTACKING THIRD)
  //   "<Team> Turnover"     → "<TEAM> TOs" — the row's team LOST the ball; 'Turnover Locations' from PitchArea (already
  //                           the loser's view). A type typed on the original is kept; otherwise FREE AGAINST when the
  //                           SAME team's "Foul" row starts within FA_WINDOW seconds (GIU writes Poss → Foul →
  //                           Turnover for a free conceded in possession); otherwise blank, never guessed.
  //   "<Team> Solo and Go"  → "<TEAM> SOLO AND GO"
  //   "Throw Up"            → "HOP BALL" (no team; a hop ball in play — never THROW-IN, which starts a half)
  // "<Team> Sideline", "Out for 45", "Goalkeeper", "OP Wide" have no COHESION meaning defined and are left as they are.
  const FA_WINDOW = 4;
  const GIU_OTHER = [ [/^\s*(.+?)\s+Poss\s*$/, 'poss'], [/^\s*(.+?)\s+Foul\s*$/, 'foul'], [/^\s*(.+?)\s+Turnovers?(?:\s+Lost)?\s*$/, 'to'],
    [/^\s*(.+?)\s+Solo and Go\s*$/, 'solo'] ];
  function isGiuGame(events){
    return (events || []).some(e => e && !lbl(e, GI_SRC) && (/\sshot\s*\(\s*[pf]\s*\)\s*$/i.test(e.code || '') || lbl(e, 'PossFrom') || lbl(e, 'KODistance')));
  }
  // → { kind:'poss'|'foul'|'to'|'solo'|'hop', team } or null. The row's own wording only (see above).
  function giuOther(e){
    if(!e || !e.code || lbl(e, GI_SRC)) return null;
    const C = String(e.code);
    if(/^\s*Throw Up\s*$/.test(C)) return { kind:'hop', team:'' };
    for(const [re, kind] of GIU_OTHER){ const m = re.exec(C); if(!m) continue;
      if(kind === 'foul' && /technical/i.test(C)) return null;
      const team = up(e.team) || up(m[1]); return team ? { kind, team } : null; }
    return null;
  }
  const OTHER_CODE = { poss:'TEAM POSSESSION', foul:'FOUL', to:'TOs', solo:'SOLO AND GO' };
  const OTHER_CAT = { poss:'Possession & Attack', foul:'Fouls', to:'Turnovers', solo:'Other', hop:'Other' };
  // A converted row of this block that is NOT a turnover: "<TEAM> TEAM POSSESSION / FOUL / SOLO AND GO", "HOP BALL".
  function isDerivedOther(e){ return !!lbl(e, GI_SRC) && /(\sTEAM POSSESSION|\sFOUL|\sSOLO AND GO|^\s*HOP BALL)\s*$/i.test((e && e.code) || '') && !/TECHNICAL/i.test(e.code || ''); }
  // Map one such row to its COHESION row. Pure. `fa` true → a turnover with no type becomes FREE AGAINST.
  function cohGiuMapOther(e, fa){
    const k = giuOther(e); if(!k) return [];
    const L = e.labels || {}, labels = {}, third = toThird(L['PitchArea']);
    let outcome = '';
    if(k.kind === 'poss'){ if(L['PossFrom']) labels['PossFrom'] = String(L['PossFrom']).trim(); if(L['PitchArea']) labels['PitchArea'] = String(L['PitchArea']).trim(); }
    else if(k.kind === 'foul'){ if(third) labels['Foul Areas'] = third; }
    else if(k.kind === 'to'){ outcome = lblCI(e, TO_OUT_GROUPS) || (fa ? 'FREE AGAINST' : '');
      if(outcome) labels['Turnover Outcomes'] = outcome; if(third) labels['Turnover Locations'] = third; }
    labels[GI_SRC] = String(e.id);
    return [Object.assign({ id:'gi-'+e.id+'-'+k.kind, code: k.kind === 'hop' ? 'HOP BALL' : k.team+' '+OTHER_CODE[k.kind], team:k.team }, baseOf(e), {
      player:'', outcome, subtype:'', category:OTHER_CAT[k.kind], labels })];
  }

  // Ids of GI originals that already have a derived SHOT, KO or turnover event.
  function cohGiSuperseded(events){
    const s = new Set(), tos = [];
    (events || []).forEach(e => {
      const id = lbl(e, GI_SRC);
      if(!id) return;
      if(/SHOT (OPEN|DEAD)/i.test(e.code || '') || isDerivedKo(e) || isDerivedOther(e)) s.add(id);
      else if(isDerivedTo(e)) tos.push(id);
    });
    // a derived TOs row supersedes a "Turnover Won" original, or a GIU "<Team> Turnover" (a lost kickout's
    // KICKOUT LOST row supersedes nothing: the kickout answers to its KO row)
    if(tos.length){
      const won = new Set();
      (events || []).forEach(e => { if(e && !lbl(e, GI_SRC) && (TO_WON_RE.test(e.code || '') || (giuOther(e) || {}).kind === 'to')) won.add(String(e.id)); });
      tos.forEach(id => { if(won.has(id)) s.add(id); });
    }
    return s;
  }
  // Bare companion created by the conversion (a score or break row — not a
  // shot, a kickout or a turnover in its own right).
  function cohGiIsCompanion(e){
    return !!lbl(e, GI_SRC) && !/SHOT/i.test((e && e.code) || '') && !isDerivedKo(e) && !isDerivedTo(e) && !isDerivedOther(e);
  }
  // Per-event predicate factory: true for an original that is superseded.
  function cohGiSupersededFn(events){
    const s = cohGiSuperseded(events);
    return e => !!(s.size && e && !lbl(e, GI_SRC) && s.has(String(e.id))
      && (isAnyGiShot(e) || /^\s*\S.*\s+kickout\s*$/i.test(e.code || '') || TO_WON_RE.test(e.code || '') || !!giuOther(e)));
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
    // a name that came from a jersey number remembers the number and the name written (pTag / pTagName), so it can
    // follow the team sheet if the player at that number is changed later (cohesion-merge.js cohPTagFixes)
    const pm = /^P\s*(\d+)$/i.exec(tag);
    if(pm && player && player !== tag){ shot.pTag = 'P' + (+pm[1]); shot.pTagName = player; }
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
    { name:'Kickout Locations', re:/\bKO\b|KICKOUT/ }, { name:'Kickout Won By', re:/\bKO\b|KICKOUT/ }, { name:'Kickout Taken By', re:/\bKO\b|KICKOUT/ },
    { name:'Kickout Target', re:/\bKO\b|KICKOUT/ } ];
  const CARRY_WORD = { 'shot attempts':'attempt', 'deadball shot type':'dead-ball type', 'shooting leg':'leg', 'shot side':'side', 'shot pressure':'pressure',
    'assist':'assist', 'kickout locations':'length', 'kickout won by':'won by', 'kickout taken by':'taken by', 'kickout target':'target' };
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

  // ── THIRDS: rows saved before two third rules were corrected (11 Oct 2026) ──
  // cohGiThirdFixes(events, game) lists them. Pure — nothing is changed; running it
  // on the corrected rows finds nothing. Only these exact patterns, never any other value:
  //  'to-zone'   a converted "<TEAM> TOs" row with NO 'Turnover Locations' whose "Turnover
  //              Won" original (the other team's) has no zone label → DEFENSIVE THIRD
  //              (see TURNOVERS). Gaelic Insights games only.
  //  'ko-third'  a KICKOUT LOST turnover row saying ATTACKING THIRD whose kickout is
  //              KO LONG or KO MEDIUM with no marked landing beyond the far 45 m line →
  //              MIDDLE THIRD. LONG: the old rule read it as the attacking third (see
  //              koLostThird). MEDIUM: 45-65 m is the middle third, so ATTACKING is wrong
  //              for it too — the old rule never wrote that, so such a row was left behind
  //              when its kickout's length was changed later, or was set by hand. A SHORT
  //              kickout, or one marked beyond the far 45, is not this pattern.
  //  'ko-foul'   the FOUL row Code Room logs for a free at such a kickout, 'Foul Areas'
  //              from the FOULING team's view: the kicker's own foul (KO FREE LOST)
  //              saying ATTACKING THIRD, or the opposition's (KO FREE WON) saying
  //              DEFENSIVE THIRD → MIDDLE THIRD.
  // The last two are for ANY game (Tracker, Code Room, converted). A row's kickout is
  // found as elsewhere: Code Room's in-session companion link (_shotComp → _rowId; a
  // row tied to something that is not a kickout is left alone), else the derived KO
  // row with the same 'GI Source ID', else the nearest KO row of the right team
  // starting within KO_TO_WINDOW seconds. No kickout found = left alone.
  //   → [{ index, id, kind, group, from ('' = none), to, koIndex + len (LONG | MEDIUM) | originalId }]
  const isKoRow = e => /(^|\s)(KO|KICKOUTS?)\s*$/i.test(String((e && e.code) || '').trim()) && !/\bTOS?\b|TURNOVER/i.test((e && e.code) || '');
  function koOfRow(events, r, game, want){   // want(ko) → is this a kickout the row can belong to
    if(r._shotComp != null){
      const k = events.find(x => x && x._rowId != null && String(x._rowId) === String(r._shotComp));
      return k && isKoRow(k) && want(k) ? k : null;
    }
    const src = lbl(r, GI_SRC);
    if(src){ const k = events.find(x => isDerivedKo(x) && lbl(x, GI_SRC) === src); if(k) return want(k) ? k : null; }
    let best = null, gap = Infinity;
    if(fin0(r.start)) events.forEach(k => { if(!k || k === r || !isKoRow(k) || !fin0(k.start) || !want(k)) return;
      if(!lbl(k, GI_SRC) && koMap(k, game)) return;                       // a Gaelic Insights original: its derived KO row answers for it
      const g = Math.abs(k.start - r.start); if(g <= KO_TO_WINDOW && g < gap){ best = k; gap = g; } });
    return best;
  }
  function cohGiThirdFixes(events, game){
    events = events || [];
    const out = [], byId = new Map(), one = (e, g) => { const v = valsOf(e, g); return v.length === 1 ? up(v[0]) : ''; };
    events.forEach(e => { if(e && !lbl(e, GI_SRC) && e.id != null && !byId.has(String(e.id))) byId.set(String(e.id), e); });
    const longNotBeyond = k => !!k && koLenOf(k) === 'LONG' && koLostThird(k) === 'MIDDLE THIRD';
    // the turnover row: a MEDIUM kickout too (see 'ko-third' above); never one marked beyond the far 45, whatever its length
    const midNotBeyond = k => !!k && (koLenOf(k) === 'LONG' || koLenOf(k) === 'MEDIUM') && !koBeyondFar45(k);
    events.forEach((r, index) => {
      if(!r) return;
      const c = String(r.code || ''), T = up(r.team);
      if(/\bTOS?\s*$/i.test(c) && isKoLostTo(r)){
        if(one(r, 'Turnover Locations') !== 'ATTACKING THIRD') return;
        const k = koOfRow(events, r, game, x => up(x.team) === T);
        if(midNotBeyond(k)) out.push({ index, id:r.id, kind:'ko-third', group:'Turnover Locations', from:'ATTACKING THIRD', to:'MIDDLE THIRD', koIndex:events.indexOf(k), len:koLenOf(k) });
      } else if(isDerivedTo(r)){
        const o = byId.get(lbl(r, GI_SRC)), t = o && toMap(o, game);
        if(t && !t.zoned && t.loser === T && !lblCI(r, ['Turnover Locations','Turnover Location']))
          out.push({ index, id:r.id, kind:'to-zone', group:'Turnover Locations', from:'', to:'DEFENSIVE THIRD', originalId:o.id });
      } else if(/\sFOUL\s*$/i.test(c)){
        if(isDerivedOther(r)) return;                                         // a GIU file's own foul: its third is the file's, not a kickout rule's
        const area = one(r, 'Foul Areas');
        if(area !== 'ATTACKING THIRD' && area !== 'DEFENSIVE THIRD') return;
        const own = area === 'ATTACKING THIRD';                               // the kicker's own foul, or the opposition's
        const k = koOfRow(events, r, game, x => (up(x.team) === T) === own && T && up(x.team)
          && (own ? /FREE LOST/ : /FREE WON/).test(up(lbl(x, 'Kickout Outcomes') || x.outcome)));
        if(longNotBeyond(k)) out.push({ index, id:r.id, kind:'ko-foul', group:'Foul Areas', from:area, to:'MIDDLE THIRD', koIndex:events.indexOf(k), len:koLenOf(k) });
      }
    });
    return out;
  }

  // New events for every GI / GIU shot with no derived event yet. Idempotent.
  // Kickouts and turnovers too: an original whose id already appears as a "GI
  // Source ID" is skipped, so a game whose shots were converted earlier only
  // gains its kickouts and turnovers. opts.kickouts === false / opts.shots ===
  // false / opts.turnovers === false limit the pass. A GIU game's possessions, fouls, solo-and-goes and throw-ups
  // (opts.others === false leaves them) and its "<Team> Turnover" rows (with the turnovers) convert too — see GIU:
  // OTHER ROWS; opts.fa === false leaves their FREE AGAINST type unset. out.freeAgainst = how many were set.
  // KICKOUT LOST rows: a kickout converted in THIS pass gets one when the kicker
  // lost it; a kickout converted EARLIER gets one from its derived KO row as it
  // stands now (its 'Kickout Outcomes' may have been corrected since). Neither is
  // added when the game already has that kickout's KICKOUT LOST row.
  function cohGiConvert(events, game, opts){
    const done = new Set(), koRow = new Map(), koTos = [];
    (events || []).forEach(e => { const id = lbl(e, GI_SRC); if(!id) { if(isKoLostTo(e)) koTos.push({ team:up(e.team), start:+e.start, src:'' }); return; }
      done.add(id);
      if(isDerivedKo(e) && !koRow.has(id)) koRow.set(id, e);
      if(isKoLostTo(e)) koTos.push({ team:up(e.team), start:+e.start, src:id }); });
    const doShots = !(opts && opts.shots === false), doKos = !(opts && opts.kickouts === false), doTos = !(opts && opts.turnovers === false);
    const doOther = !(opts && opts.others === false), doFa = !(opts && opts.fa === false), giuLike = isGiuGame(events);
    // a GIU game's own fouls, by team: a turnover of that team within FA_WINDOW s of one is a FREE AGAINST
    const fouls = giuLike ? (events || []).filter(e => (giuOther(e) || {}).kind === 'foul').map(e => ({ team:giuOther(e).team, start:+e.start })) : [];
    let faN = 0;
    const out = [], plans = [];
    const addKoTo = (srcId, at, team) => { if(!team || hasKoLostTo(koTos, srcId, team, +at.start)) return;
      koTos.push({ team, start:+at.start, src:String(srcId) }); out.push(koLostRow(srcId, at, team)); };
    (events || []).forEach(e => {
      const gi = doShots && isGiShot(e), giu = doShots && !gi && isGiuShot(e);
      const ko = !gi && !giu && isGiKickout(e, game);
      const to = !gi && !giu && !ko && doTos && isGiTurnover(e, game);
      const oth = (!gi && !giu && !ko && !to && giuLike) ? giuOther(e) : null;
      if(oth){                              // GIU: possession / foul / turnover / solo and go / throw-up
        const oid = String(e.id);
        if(!oid || done.has(oid) || (oth.kind === 'to' ? !doTos : !doOther)) return;
        done.add(oid);
        const fa = doFa && oth.kind === 'to' && !lblCI(e, TO_OUT_GROUPS) && fouls.some(f => f.team === oth.team && fin0(e.start) && Math.abs(f.start - e.start) <= FA_WINDOW);
        if(fa) faN++;
        cohGiuMapOther(e, fa).forEach(n => out.push(n));
        return;
      }
      if(!gi && !giu && !ko && !to) return;
      const id = String(e.id);
      if(!id) return;
      if(ko && done.has(id)){           // converted earlier: only its KICKOUT LOST row may be missing
        const d = koRow.get(id);
        if(doTos && d && /LOST/.test(up(lbl(d, 'Kickout Outcomes') || d.outcome))) addKoTo(id, d, up(d.team));
        return;
      }
      if(done.has(id) || (ko && !doKos)) return;
      done.add(id);
      if(to){ cohGiMapTurnover(e, game).forEach(n => out.push(n)); return; }
      const rows = gi ? cohGiMapShot(e) : giu ? cohGiuMapShot(e, game) : cohGiMapKickout(e, game);
      // the shot / KO row (never a score or break companion) takes its original's location and details
      const p = (rows.length && !(opts && opts.carry === false)) ? carryPlan(rows[0], e, game, opts, true) : null;
      if(p){ cohGiCarryApply(rows[0], p); p.derivedId = rows[0].id; plans.push(p); }
      rows.forEach(n => out.push(n));
      // after the carry, so a length or landing marked on the original gives the turnover its third
      if(ko && doTos && rows.length && /LOST/.test(up(rows[0].outcome))) addKoTo(id, rows[0], rows[0].team);
    });
    // what was carried — a property of the returned list (not of any event): see cohGiCounts
    Object.defineProperty(out, 'carried', { value: carryTally(plans), enumerable:false });
    Object.defineProperty(out, 'freeAgainst', { value: faN, enumerable:false });
    return out;
  }
  // Counts for the confirmation text.
  function cohGiCounts(newEvents){
    let shots = 0, scores = 0, kos = 0, breaks = 0, tos = 0, koTos = 0, poss = 0, fouls = 0, solos = 0, hops = 0;
    (newEvents || []).forEach(e => { const c = e.code || '';
      if(/SHOT (OPEN|DEAD)/i.test(c)) shots++; else if(isDerivedKo(e)) kos++;
      else if(isDerivedOther(e)){ if(/TEAM POSSESSION\s*$/i.test(c)) poss++; else if(/FOUL\s*$/i.test(c)) fouls++; else if(/SOLO AND GO\s*$/i.test(c)) solos++; else hops++; }
      else if(isDerivedTo(e)){ if(/-koto$/.test(String(e.id))) koTos++; else tos++; }
      else if(/\sBREAK (WON|LOST)\s*$/i.test(c)) breaks++; else scores++; });
    const k = (newEvents && newEvents.carried) || {};
    return { shots, scores, kos, breaks, tos, koTos, poss, fouls, solos, hops, freeAgainst:(newEvents && newEvents.freeAgainst) || 0, locations:k.locations||0, zones:k.zones||0, details:k.details||0, attempts:k.attempts||0,
      carriedRows:k.rows||0, lenClash:k.lenClash||0, clashes:k.clashes||[] };
  }

  // cohGiIsShot = any original the conversion handles (GI "<Team> Shot" or a GIU shot).
  const api = { cohGiConvert, cohGiSuperseded, cohGiSupersededFn, cohGiIsCompanion, cohGiIsShot:isAnyGiShot,
    cohGiIsKickout:isGiKickout, cohGiIsDerivedKo:isDerivedKo, cohGiMapKickout,
    cohGiIsTurnover:isGiTurnover, cohGiIsDerivedTo:isDerivedTo, cohGiMapTurnover,
    cohGiuOther:giuOther, cohGiIsDerivedOther:isDerivedOther, cohGiuMapOther, cohGiIsGiuGame:isGiuGame,
    cohGiIsGiShot:isGiShot, cohGiIsGiuShot:isGiuShot, cohGiMapShot, cohGiuMapShot, cohGiuRosterName, cohGiCounts,
    cohGiCarryDetails, cohGiCarryApply, cohGiCarryTally:carryTally, cohGiThirdFixes, cohGiKoLostThird:koLostThird, COH_GI_SRC:GI_SRC };
  Object.assign(root, api);
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
