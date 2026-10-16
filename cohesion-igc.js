/* COHESION — iGaelicCoach XML (format 'igaelicoach'): detect, import as a new game, merge into a stored game
 *
 * An iGaelicCoach file (likely written by Nacsport) is Sportscode-shaped — <file><ALL_INSTANCES> … <ROWS> — but:
 *   · every <label> has a <text> and NO <group>;
 *   · the two teams are coded "TA …" / "TB …" (TA POSS, TA Shot (P), TA Shot (F), TA Shot Mark, TA 45, TA Penalty,
 *     TA Kickout, TA Turnover — and the same for TB); the team names are not in the file;
 *   · the halves are "Throw In" rows labelled "1st Half" / "2nd Half" (every other row repeats its half as a label).
 * The 30 label values: halves; score value 2 Point / Point / Goal + the flag Score; the thirds Attacking / Middle /
 * Defensive Third; shot outcomes Wide / Save / Block / Post / Short / Out for 45; possession source From KO Own /
 * From KO Opp / From Turnover / From Throw In; Goal Chance; kickout length Long / Short; kickout result Won / Lost;
 * how a kickout was won, naming the team that WON the ball: TA Clean / TA Break / TA SL / TA Free / TB … .
 * A POSS row describes the whole possession (how it started, how it ended, the zone, Goal Chance); a shot row repeats
 * its possession's labels. A possession with no shot outcome ended without a shot (a turnover or similar).
 *
 * THE CONVERSION (cohIgcImport) produces COHESION's own rows — the rows a GIU game gets — through the SAME converter
 * (cohesion-gi.js cohGiConvert): each iGaelicCoach row is first written as the GIU row it corresponds to ("<Team> Poss"
 * with PossFrom / PitchArea, "<Team> Shot (P)/(F)" with ShotOutcome, "<Team> Kickout" with KickoutOutcome
 * "<Winner> Clean|Break|Free|SL" and KODistance, "<Team> Turnover" with PitchArea) and converted:
 *   POSS        → "<TEAM> TEAM POSSESSION" ('PossFrom' Own Kickout / Opp Kickout / Turnover / Throw In, 'PitchArea' the
 *                 zone, plus 'Goal Chance' Yes and 'Possession Outcome' — the shot outcome(s) it ended with, if any)
 *   Shot (P)    → "<TEAM> SHOT OPEN PLAY";  Shot (F) / Shot Mark / 45 / Penalty → "<TEAM> SHOT DEADBALL" with
 *                 'Deadball Shot Type' FREE KICK / MARK / '45 / PENALTY. 'Shot Outcomes' in COHESION's words (1 POINT,
 *                 2 POINT, GOAL, WIDE, SAVE, BLOCKED, WOODWORK, SHORT, '45 = out for a '45). A score also gets the bare
 *                 "<TEAM> 1 POINT|2 POINT|GOAL" row. 'Shot Attempts': Goal Attempt for a penalty or a Goal Chance (the
 *                 Sportscode template's name for a goal attempt; GIU's "For Goal" rule), else the value scored; a miss
 *                 with no Goal Chance stays blank (never guessed). 'Shot Source Outcomes' OWN KICKOUT / OPP KICKOUT /
 *                 TURNOVER (iGaelicCoach does not say forced / unforced — the plain TURNOVER a Gaelic Insights shot gets)
 *                 / THROW-IN; 'PitchArea' the third; 'Goal Chance' Yes. A shot with no outcome stays a shot with none.
 *   Kickout     → "<KICKING TEAM> KO": 'Kickout Outcomes' KO WON CLEAN / KO LOST CLEAN / KO BREAK WON|LOST /
 *                 KO SIDELINE WON|LOST / KO FREE WON|LOST from the kicking team's view (the "TA …/TB …" label names the
 *                 team that WON it), 'Kickout Locations' KO SHORT / KO LONG (no length = none), 'PitchArea' the landing
 *                 third; a break ball also gets both teams' "<TEAM> BREAK WON / BREAK LOST" rows; a kickout the kicker
 *                 LOST also gets his "<TEAM> TOs" / KICKOUT LOST row (third from the length: cohGiKoLostThird).
 *   Turnover    → "<TEAM> TOs" — "TA Turnover" = TA LOST the ball (= a turnover WON by TB). 'Turnover Locations' = the
 *                 file's third, read as the LOSING team's view (iGaelicCoach's own summary counts "turnovers lost" by
 *                 these thirds; nothing in the file says it outright). Type ('Turnover Outcomes') blank: not in the file.
 *   Throw In    → not an event: the period rows (meta.scPeriods, as the Sportscode upload stores them).
 * Every converted row carries 'iGC Source ID' = the iGaelicCoach row's <ID> (the "GI Source ID" link of a Gaelic
 * Insights conversion, renamed: there are no stored originals to supersede). No player names, no x / y: shots stay
 * unplaced, as other location-less sources do.
 *
 * TEAMS: TA = the home team, TB = the away team unless opts.taIs === 'away'.
 *
 * THE MERGE (cohIgcMergePlan → cohIgcMergeOps / cohIgcMergeApply): an iGaelicCoach file of a match that is already
 * stored (from Gaelic Insights, GIU, Sportscode, Code Room …). The two files' clocks differ by more than an offset, so
 * shots and kickouts are lined up IN ORDER within each half — a sequence alignment on (team, shot or kickout, score
 * value) — and the pairs are the anchors. ADD-ONLY:
 *   · the file's possessions are added, retimed onto the game's clock by interpolating between the anchors of their half
 *     ('Merge Source ID' = "igc-<file hash>:<ID>", cohesion-merge.js's marker, so a second run finds them);
 *   · a paired event gains the labels it lacks (third, Goal Chance, source, Shot Attempts, kickout landing third and
 *     length; where the game says only SAVE / SHORT and the file says BLOCKED / WOODWORK / '45, or the game says a
 *     clean / break kickout and the file a sideline / free, the file's word goes in 'Shot Outcome Detail' /
 *     'Kickout Outcome Detail');
 *   · nothing the game has is ever replaced — no value, no player; every disagreement is listed.
 *
 * Loaded by admin.html and batch-upload.html after cohesion-gi.js; require()-able from node.
 */
(function(root){
  const GI = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./cohesion-gi.js') : root;
  const FORMAT = 'igaelicoach', NAME = 'iGaelicCoach';
  const IGC_SRC = 'iGC Source ID', GI_SRC = 'GI Source ID', MERGE_SRC = 'Merge Source ID';
  const HALVES = ['1st Half','2nd Half','ET 1st Half','ET 2nd Half'], HALF_PFX = { '1st Half':'1H', '2nd Half':'2H', 'ET 1st Half':'ET1', 'ET 2nd Half':'ET2' };
  const up = s => String(s == null ? '' : s).trim().toUpperCase();
  const fin = v => v != null && v !== '' && isFinite(+v);
  const clone = o => JSON.parse(JSON.stringify(o));
  const median = a => { if(!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; };
  const mmss = t => { t = Math.max(0, Math.round(+t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

  // ── reading the file ────────────────────────────────────────────
  function unesc(s){ return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
  function tagOf(block, name){ const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>').exec(block); return m ? unesc(m[1]).trim() : ''; }
  function clean(text){ return String(text == null ? '' : text).replace(/^﻿/, ''); }
  // → [{id, code, start, end, texts:[label text…], groups:n (labels that have a <group>)}]
  function instancesOf(text){
    return (clean(text).match(/<instance(?:\s[^>]*)?>[\s\S]*?<\/instance>/g) || []).map(b => {
      const labels = b.match(/<label(?:\s[^>]*)?>[\s\S]*?<\/label>/g) || [], head = b.replace(/<label(?:\s[^>]*)?>[\s\S]*?<\/label>/g, '');
      return { id: tagOf(head, 'ID'), code: tagOf(head, 'code'), start: parseFloat(tagOf(head, 'start') || 0) || 0, end: parseFloat(tagOf(head, 'end') || 0) || 0,
        texts: labels.map(l => tagOf(l, 'text')).filter(Boolean), groups: labels.filter(l => /<group(?:\s[^>]*)?>/.test(l)).length };
    });
  }
  // <ROWS>: [{code, R, G, B, order}]
  function rowsOf(text){
    const m = /<ROWS(?:\s[^>]*)?>([\s\S]*?)<\/ROWS>/.exec(clean(text)); if(!m) return [];
    return (m[1].match(/<row(?:\s[^>]*)?>[\s\S]*?<\/row>/g) || []).map((b, i) => ({ code: tagOf(b, 'code'), R: tagOf(b, 'R'), G: tagOf(b, 'G'), B: tagOf(b, 'B'),
      order: fin(tagOf(b, 'sort_order')) ? +tagOf(b, 'sort_order') : i })).filter(r => r.code);
  }
  // a half's COHESION name from a label / code ("1st Half", "2nd Half", "ET 1", "Extra Time 2" …), else null
  function halfName(t){
    t = String(t == null ? '' : t).trim(); if(HALVES.indexOf(t) >= 0) return t;
    if(/^(1st|first)\s+half$/i.test(t)) return '1st Half'; if(/^(2nd|second)\s+half$/i.test(t)) return '2nd Half';
    const m = /^(?:ET|EXTRA[\s-]*TIME)\s*(?:-\s*)?(1|2|1ST|2ND|FIRST|SECOND)(?:\s+HALF)?$/i.exec(t);
    return m ? (/^(1|1ST|FIRST)$/i.test(m[1]) ? 'ET 1st Half' : 'ET 2nd Half') : null;
  }
  const isThrowIn = code => /^throw[\s-]*in$/i.test(String(code || '').trim());
  const TATB = /^(TA|TB)\s+(\S.*)$/;

  // ── detection ───────────────────────────────────────────────────
  // The format of a timeline XML, by the upload's own rules, with iGaelicCoach in front of them:
  //   igaelicoach      <ALL_INSTANCES>, no label has a <group>, the rows are "TA …" / "TB …" (≥ 80 % of the rows that are
  //                    not Throw In), and a "Throw In" row labelled "1st Half"
  //   giu              <ALL_INSTANCES> with "P1 START" / "P2 START" rows
  //   sportscode       "1st Half" / "2nd Half" rows (a COHESION Code Room export among them), or no <ALL_INSTANCES>
  //   gaelic-insights  <ALL_INSTANCES> with an "NA Whistle" row, or with grouped labels and none of the markers above
  //   unrecognised     <ALL_INSTANCES>, none of the markers above and no label with a <group> — e.g. a defensive-actions
  //                    file (OPPOSITION PASSES / DEFENSIVE ACTION / PHASE OF PLAY): nothing COHESION can read
  // → { format, name, igc:bool, recognised:bool, message, rows:n, codes:[the most used codes] }
  function cohIgcDetect(text){
    const t = clean(text).trim();
    const out = (format, name, message, more) => Object.assign({ format, name, igc: format === FORMAT, recognised: format !== 'unrecognised' && format !== 'empty' && format !== 'unknown', message: message || '' }, more || {});
    if(!t) return out('empty', 'Empty file', 'This file is empty.');
    if(/^[\[{]/.test(t)) return out('tracker-json', 'Gaelic Tracker JSON');
    if(!/<instance(?:\s[^>]*)?>/i.test(t)) return out('unknown', 'Unknown file', 'Format not recognised: no timeline events (<instance>) were found in this file. Nothing was read from it.');
    const ins = instancesOf(t), all = /<ALL_INSTANCES(?:\s[^>]*)?>/.test(t), grouped = ins.some(i => i.groups > 0);
    const codes = ins.map(i => i.code), freq = new Map(); codes.forEach(c => freq.set(c, (freq.get(c) || 0) + 1));
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0]);
    const nonTi = ins.filter(i => !isThrowIn(i.code)), tatb = nonTi.filter(i => TATB.test(i.code)).length;
    const ti1 = ins.some(i => isThrowIn(i.code) && i.texts.some(x => halfName(x) === '1st Half'));
    const more = { rows: ins.length, codes: top };
    if(all && !grouped && tatb > 0 && tatb >= 0.8 * nonTi.length && ti1) return out(FORMAT, NAME, '', more);
    if(all && codes.some(c => /^P[12] START$/.test(c))) return out('giu', 'GIU XML', '', more);
    if(codes.some(c => /^(?:ET\s)?[12](?:st|nd)\sHalf$/.test(c))) return out('sportscode', 'Sportscode XML', '', more);
    if(!all) return out('sportscode', 'Sportscode XML', '', more);
    if(codes.some(c => c === 'NA Whistle') || grouped) return out('gaelic-insights', 'Gaelic Insights XML', '', more);
    return out('unrecognised', 'Unrecognised XML',
      'Format not recognised: this XML has none of the markers COHESION reads — Sportscode / Code Room “1st Half” rows, Gaelic Insights “NA Whistle”, GIU “P1 START”, or iGaelicCoach “TA …” / “TB …” rows with “Throw In” half markers'
      + (top.length ? ' (its rows are ' + top.join(', ') + ')' : '') + '. Nothing was read from it.', more);
  }

  // ── the file's own figures, per side (for the upload preview, before any team is named) ──
  // → { TA:{poss, shots, scores, goals, points, kickouts, kickoutsWon, turnovers}, TB:{…}, halves:{'1st Half':t,…} }
  function scoreOfTexts(T){ const s = new Set(T); return s.has('Goal') ? 3 : (s.has('Score') && s.has('2 Point')) ? 2 : s.has('Score') ? 1 : 0; }
  function cohIgcSummary(text){
    const ins = instancesOf(text), z = () => ({ poss:0, shots:0, scores:0, goals:0, points:0, kickouts:0, kickoutsWon:0, turnovers:0 }), S = { TA:z(), TB:z(), halves:{} };
    ins.forEach(i => {
      if(isThrowIn(i.code)){ const h = i.texts.map(halfName).find(Boolean); if(h && S.halves[h] == null) S.halves[h] = i.start; return; }
      const m = TATB.exec(i.code); if(!m) return;
      const s = S[m[1]], k = shotKind(m[2]);
      if(/^poss$/i.test(m[2])) s.poss++;
      else if(k){ s.shots++; const v = scoreOfTexts(i.texts); if(v){ s.scores++; if(v === 3) s.goals++; else s.points += v; } }
      else if(/^kickout$/i.test(m[2])){ s.kickouts++; if(i.texts.indexOf('Won') >= 0) s.kickoutsWon++; }
      else if(/^turnover$/i.test(m[2])) s.turnovers++;
    });
    return S;
  }
  // the shot kinds: [dead ball?, Deadball Shot Type]
  function shotKind(rest){
    const r = String(rest || '').trim();
    if(/^shot\s*\(\s*p\s*\)$/i.test(r)) return { dead:false, type:'' };
    if(/^shot\s*\(\s*f\s*\)$/i.test(r)) return { dead:true, type:'FREE KICK' };
    if(/^shot\s+mark$/i.test(r)) return { dead:true, type:'MARK' };
    if(/^'?45$/.test(r)) return { dead:true, type:"'45" };
    if(/^penalty$/i.test(r)) return { dead:true, type:'PENALTY' };
    return null;
  }

  // ── iGaelicCoach words → COHESION / GIU words ──────────────────
  // shot outcomes, most decisive first (a shot can carry two: "Save" + "Post")
  const OUTS = [['Goal','GOAL'], ['2 Point','2 POINT'], ['Point','1 POINT'], ['Save','SAVE'], ['Block','BLOCKED'], ['Post','WOODWORK'], ["Out for 45","'45"], ['Wide','WIDE'], ['Short','SHORT']];
  const GIU_WORD = { 'GOAL':'Goal', '2 POINT':'2 Point', '1 POINT':'Point', 'SAVE':'Save', 'BLOCKED':'Block', 'WOODWORK':'Post', 'WIDE':'Wide', 'SHORT':'Short' };   // ('45 has no GIU word)
  // every outcome a row carries, in COHESION's words, the decisive one LAST (labels[g] = the last value, labelsAll = all)
  function outcomesOf(T){
    const s = new Set(T), list = [];
    if(s.has('Goal')) list.push('GOAL');
    else if(s.has('Score')) list.push(s.has('2 Point') ? '2 POINT' : '1 POINT');
    OUTS.slice(3).forEach(([w, c]) => { if(s.has(w)) list.push(c); });
    return list.reverse();
  }
  const SRC = { 'From KO Own':['Own Kickout','OWN KICKOUT'], 'From KO Opp':['Opp Kickout','OPP KICKOUT'], 'From Turnover':['Turnover','TURNOVER'], 'From Throw In':['Throw In','THROW-IN'] };
  const sourceOf = T => { const k = T.find(x => SRC[x]); return k ? SRC[k] : null; };
  const THIRD = { 'Attacking Third':'ATTACKING THIRD', 'Middle Third':'MIDDLE THIRD', 'Defensive Third':'DEFENSIVE THIRD' };
  const thirdOf = T => { const k = T.find(x => THIRD[x]); return k ? THIRD[k] : ''; };
  const KO_HOW = { Clean:'Clean', Break:'Break', SL:'SL', Free:'Free' };

  /* ── IMPORT ─────────────────────────────────────────────────────
   * cohIgcImport(text, opts)
   *   opts.homeTeam / opts.awayTeam  as typed on the upload form
   *   opts.taIs                      'home' (default) | 'away' — which team the file's TA is
   *   opts.videoStarts               {'1st Half':s, '2nd Half':s, 'ET 1st Half':s|null, 'ET 2nd Half':s|null}: where each
   *                                  period starts on the video (omit: video time = the file's clock)
   * → { events, error, teams:{TA, TB}, periods (meta.scPeriods), rows (meta.rows), markers, stats }
   */
  function cohIgcImport(text, opts){
    opts = opts || {};
    const homeTeam = String(opts.homeTeam || '').trim(), awayTeam = String(opts.awayTeam || '').trim();
    const fail = error => ({ events:[], error, teams:null, periods:[], rows:[], markers:{}, stats:{} });
    const det = cohIgcDetect(text);
    if(!det.igc) return fail(det.message || ('This is not an iGaelicCoach file (' + det.name + ').'));
    if(!homeTeam || !awayTeam) return fail('Enter both team names first: the iGaelicCoach file calls them only TA and TB.');
    if(up(homeTeam) === up(awayTeam)) return fail('The home and away team names are the same.');
    const ta = opts.taIs === 'away' ? awayTeam : homeTeam, tb = opts.taIs === 'away' ? homeTeam : awayTeam;
    const name = { TA:ta, TB:tb }, NAMEU = { TA:up(ta), TB:up(tb) };
    const ins = instancesOf(text);
    // the half markers: the first Throw In labelled with each half
    const refs = {}; HALVES.forEach(h => { refs[h] = null; });
    ins.forEach(i => { if(!isThrowIn(i.code)) return; const h = i.texts.map(halfName).find(Boolean); if(h && refs[h] == null) refs[h] = i.start; });
    if(refs['1st Half'] == null) return fail('Could not find the iGaelicCoach “Throw In” row labelled “1st Half”.');
    if(refs['2nd Half'] == null) return fail('Could not find the iGaelicCoach “Throw In” row labelled “2nd Half”.');
    const vs = opts.videoStarts || null, offsets = {}, stats = { instances: ins.length, events:0, byKind:{}, otherCodes:{}, koConflicts:[], noOutcome:[], noLength:[], etNoVideoStart:[] };
    HALVES.forEach(h => { offsets[h] = vs ? (fin(vs[h]) && refs[h] != null ? +vs[h] - refs[h] : null) : 0; });
    if(vs) ['ET 1st Half','ET 2nd Half'].forEach((h, k) => { if(refs[h] != null && offsets[h] == null){ stats.etNoVideoStart.push(h); offsets[h] = offsets[k ? 'ET 1st Half' : '2nd Half']; } });
    const halfAt = t => { let h = '1st Half'; HALVES.forEach(x => { if(refs[x] != null && t >= refs[x]) h = x; }); return h; };
    // the GIU-shaped rows the shared converter reads (one per iGaelicCoach row) + what the conversion does not carry
    const raw = [], info = new Map(), other = [];
    ins.forEach(i => {
      if(isThrowIn(i.code)) return;
      const T = i.texts, half = T.map(halfName).find(Boolean) || halfAt(i.start), off = offsets[half] != null ? offsets[half] : 0, ref = refs[half] != null ? refs[half] : refs['1st Half'];
      const rel = Math.max(0, Math.round(i.start - ref));
      const base = { id: i.id || String(raw.length + other.length + 1), start: Math.round(i.start), end: Math.round(Math.max(i.start, i.end)), half,
        gameTime: HALF_PFX[half] + ' ' + String(Math.floor(rel / 60)).padStart(2, '0') + ':' + String(rel % 60).padStart(2, '0'),
        videoT: Math.max(0, Math.round(i.start + off)), driveT: Math.max(0, Math.round(i.start + off) - 2), player:'', outcome:'', subtype:'' };
      const m = TATB.exec(i.code);
      if(!m){ other.push(Object.assign(base, { code: i.code, team:'', category:'Other', labels:{} })); stats.otherCodes[i.code] = (stats.otherCodes[i.code] || 0) + 1; return; }
      const side = m[1], rest = m[2].trim(), team = name[side], TEAM = NAMEU[side], k = shotKind(rest), labels = { Half: half }, nfo = { side, rest, texts:T, kind:'' };
      if(/^poss$/i.test(rest)){
        nfo.kind = 'poss'; const s = sourceOf(T); if(s) labels['PossFrom'] = s[0]; const th = thirdOf(T); if(th) labels['PitchArea'] = th;
        raw.push(Object.assign(base, { code: team + ' Poss', team: TEAM, category:'Possession & Attack', labels }));
      } else if(k){
        nfo.kind = 'shot'; nfo.shot = k; nfo.outs = outcomesOf(T);
        const o = nfo.outs[nfo.outs.length - 1]; if(o && GIU_WORD[o]) labels['ShotOutcome'] = GIU_WORD[o];
        if(k.type === 'PENALTY' || T.indexOf('Goal Chance') >= 0) labels['ShootingIntent'] = 'For Goal';
        if(!o) stats.noOutcome.push(base.id);
        raw.push(Object.assign(base, { code: team + (k.dead ? ' Shot (F)' : ' Shot (P)'), team: TEAM, category:'Shots & Scores', labels }));
      } else if(/^kickout$/i.test(rest)){
        nfo.kind = 'ko';
        const how = T.map(x => TATB.exec(x)).find(x => x && KO_HOW[x[2]]), len = T.indexOf('Short') >= 0 ? 'Short' : T.indexOf('Long') >= 0 ? 'Long' : '';
        if(how){ labels['KickoutOutcome'] = name[how[1]] + ' ' + KO_HOW[how[2]];
          const res = T.indexOf('Won') >= 0 ? (how[1] === side) !== true : T.indexOf('Lost') >= 0 ? (how[1] === side) !== false : false;
          if(res) stats.koConflicts.push(base.id); }   // the file's Won / Lost disagrees with the team it says won it: that team stands
        else nfo.result = T.indexOf('Won') >= 0 ? 'Won' : T.indexOf('Lost') >= 0 ? 'Lost' : '';
        if(len) labels['KODistance'] = len; else stats.noLength.push(base.id);
        raw.push(Object.assign(base, { code: team + ' Kickout', team: TEAM, category:'Kickouts', labels }));
      } else if(/^turnover$/i.test(rest)){
        nfo.kind = 'to'; const th = thirdOf(T); if(th) labels['PitchArea'] = th;
        raw.push(Object.assign(base, { code: team + ' Turnover', team: TEAM, category:'Turnovers', labels }));
      } else {   // a row with no meaning defined: the same name in capitals, its labels kept, team known (cohesion-merge.js's rule)
        const L = {}; T.forEach((x, j) => { if(!halfName(x)) L['iGC Label' + (j ? ' ' + (j + 1) : '')] = x; });
        other.push(Object.assign(base, { code: TEAM + ' ' + up(rest), team: TEAM, category:'Other', labels: Object.assign({ [IGC_SRC]: base.id }, L) }));
        stats.otherCodes[i.code] = (stats.otherCodes[i.code] || 0) + 1; return;
      }
      info.set(String(base.id), nfo);
    });
    const game = { homeTeam, awayTeam };
    const conv = GI.cohGiConvert(raw, game, { carry:false, fa:false });
    const events = [];
    conv.forEach(d => {
      const src = String((d.labels || {})[GI_SRC] || ''), nfo = info.get(src) || null, e = clone(d);
      delete e.labels[GI_SRC]; e.labels[IGC_SRC] = src;
      e.id = String(e.id).replace(/^gi-/, 'igc-');
      const C = up(e.code), T = nfo ? nfo.texts : [];
      if(nfo && nfo.kind === 'shot' && /SHOT (OPEN PLAY|DEADBALL)$/.test(C)){
        if(nfo.shot.type){ e.labels['Deadball Shot Type'] = nfo.shot.type; e.subtype = nfo.shot.type; }
        if(nfo.outs.length){ e.labels['Shot Outcomes'] = nfo.outs[nfo.outs.length - 1]; e.outcome = e.labels['Shot Outcomes'];
          if(nfo.outs.length > 1) e.labelsAll = { 'Shot Outcomes': nfo.outs.slice() }; }
        const s = sourceOf(T); if(s) e.labels['Shot Source Outcomes'] = s[1];
        const th = thirdOf(T); if(th) e.labels['PitchArea'] = th;
        if(T.indexOf('Goal Chance') >= 0) e.labels['Goal Chance'] = 'Yes';
      } else if(nfo && nfo.kind === 'ko' && /\sKO$/.test(C)){
        const th = thirdOf(T); if(th) e.labels['PitchArea'] = th;
      } else if(nfo && nfo.kind === 'poss'){
        if(T.indexOf('Goal Chance') >= 0) e.labels['Goal Chance'] = 'Yes';
        const outs = outcomesOf(T); if(outs.length){ e.labels['Possession Outcome'] = outs[outs.length - 1]; if(outs.length > 1) e.labelsAll = { 'Possession Outcome': outs.slice() }; }
      }
      events.push(e);
    });
    // a kickout whose outcome cannot be written in COHESION's words (no "TA/TB Clean|Break|SL|Free" label): kept, with its result
    info.forEach((nfo, id) => { if(nfo.kind !== 'ko' || events.some(e => (e.labels || {})[IGC_SRC] === id && /\sKO$/.test(up(e.code)))) return;
      const r = raw.find(x => String(x.id) === id); if(!r) return;
      const labels = { [IGC_SRC]: id }; if(r.labels['KODistance']) labels['Kickout Locations'] = 'KO ' + up(r.labels['KODistance']); if(nfo.result) labels['Kickout Result'] = nfo.result;
      const th = thirdOf(nfo.texts); if(th) labels['PitchArea'] = th;
      events.push(Object.assign({}, r, { id:'igc-' + id + '-ko', code: r.team + ' KO', outcome:'', subtype: labels['Kickout Locations'] || '', category:'Kickouts', labels })); });
    other.forEach(o => events.push(o));
    // file order: by start, a row's companions straight after it (the converter keeps each row's rows together)
    const order = new Map(); ins.forEach((i, k) => order.set(String(i.id), k));
    const keyOf = e => order.has(String((e.labels || {})[IGC_SRC])) ? order.get(String((e.labels || {})[IGC_SRC])) : 1e9;
    events.forEach((e, k) => { e._k = k; });
    events.sort((a, b) => (a.start - b.start) || (keyOf(a) - keyOf(b)) || (a._k - b._k));
    events.forEach(e => { delete e._k; });
    events.forEach(e => { const c = up(e.code); const kind = /SHOT (OPEN|DEAD)/.test(c) ? 'shots' : /\sKO$/.test(c) ? 'kickouts' : /TEAM POSSESSION$/.test(c) ? 'possessions'
      : /\sTOS$/.test(c) ? 'turnovers' : /BREAK (WON|LOST)$/.test(c) ? 'breakRows' : /\s(1 POINT|2 POINT|GOAL)$/.test(c) ? 'scoreRows' : 'other'; stats.byKind[kind] = (stats.byKind[kind] || 0) + 1; });
    stats.events = events.length;
    // the period rows: from each half's Throw In to the end of its last row (the file has no end-of-half marker)
    const periods = [];
    HALVES.forEach(h => { if(refs[h] == null) return; const inH = ins.filter(i => !isThrowIn(i.code) && (i.texts.map(halfName).find(Boolean) || halfAt(i.start)) === h);
      const end = inH.length ? Math.max.apply(null, inH.map(i => Math.max(i.start, i.end))) : refs[h];
      periods.push({ code:h, start:refs[h], end, fileCode:'Throw In' }); });
    return { events, error:null, teams:{ TA:NAMEU.TA, TB:NAMEU.TB }, periods, rows: rowsFor(text, NAMEU), markers:refs, offsets, stats };
  }
  // The file's <ROWS> (order + colours) under the rows the game now has: "TA POSS" → "<TEAM> TEAM POSSESSION", "TA Shot (P)"
  // → "<TEAM> SHOT OPEN PLAY", the dead balls → "<TEAM> SHOT DEADBALL" (the first one's colour), "TA Kickout" → "<TEAM> KO",
  // "TA Turnover" → "<TEAM> TOs". Throw In is a period row, not a timeline row.
  function rowsFor(text, NAMEU){
    const rows = rowsOf(text).sort((a, b) => a.order - b.order), out = [], seen = new Set();
    const rowOf = (code, r) => { const ch = [r.R, r.G, r.B].map(v => Math.max(0, Math.min(65535, Math.round(+v || 0))));
      const hex = '#' + ch.map(v => { const x = Math.round(v / 257); return (x < 16 ? '0' : '') + x.toString(16); }).join(''), row = { code, colour: hex };
      if(ch.some(v => v % 257)) row.rgb16 = ch; return row; };
    rows.forEach(r => { const m = TATB.exec(r.code); if(!m) return; const T = NAMEU[m[1]], rest = m[2].trim(), k = shotKind(rest);
      const code = /^poss$/i.test(rest) ? T + ' TEAM POSSESSION' : k ? T + (k.dead ? ' SHOT DEADBALL' : ' SHOT OPEN PLAY') : /^kickout$/i.test(rest) ? T + ' KO' : /^turnover$/i.test(rest) ? T + ' TOs' : T + ' ' + up(rest);
      if(seen.has(code)) return; seen.add(code); out.push(rowOf(code, r)); });
    return out;
  }

  /* ── MERGE ──────────────────────────────────────────────────────
   * cohIgcMergePlan(events, game, text, opts) — events = the stored game's events (the rows' data), game = its meta.
   *   opts.taIs  'home' | 'away' — which team the file's TA is; omitted: whichever lines up more shots and kickouts.
   * Nothing is changed. → { ok, error, taIs, auto, tag, halves:[…], matched:[…], onlyGame:[…], onlyIgc:[…], diffs:[…],
   *                          fills:[{index, id, labels:{group:value}, what:[…]}], adds:[rows], already, stats }
   */
  const SHOT_ROW = /SHOT (OPEN PLAY|DEAD ?BALL)\s*$/;
  const isKoRow = e => /(^|\s)(KO|KICKOUTS?)\s*$/i.test(String((e && e.code) || '').trim()) && !/\bTOS?\b|TURNOVER/i.test((e && e.code) || '');
  const keyCI = (L, g) => { if(!L) return null; if(Object.prototype.hasOwnProperty.call(L, g)) return g; const w = String(g).toLowerCase(); for(const k of Object.keys(L)) if(k.toLowerCase() === w) return k; return null; };
  const valCI = (e, names) => { const L = (e && e.labels) || {}; for(const n of names){ const k = keyCI(L, n); if(k != null && L[k] != null && String(L[k]).trim()) return String(L[k]).trim(); } return ''; };
  const OUT_GROUPS = ['Shot Outcomes','ShotOutcome','Outcome'], SRC_GROUPS = ['Shot Source Outcomes','Score Source Outcomes','Source'];
  const KO_OUT_GROUPS = ['Kickout Outcomes','KickoutOutcome','PO_Result'], KO_LEN_GROUPS = ['Kickout Locations','KickoutLength','Kickout_Length','KODistance'];
  // a shot outcome in COHESION's words (Gaelic Insights "Saved" / "Wide Left" …, GIU "Block" …)
  const OUT_CANON = { 'POINT':'1 POINT', '1 POINT':'1 POINT', 'TWO POINTS':'2 POINT', 'TWO POINT':'2 POINT', '2 POINT':'2 POINT', '2 POINTS':'2 POINT', 'GOAL':'GOAL',
    'WIDE':'WIDE', 'WIDE LEFT':'WIDE', 'WIDE RIGHT':'WIDE', 'SHORT':'SHORT', 'SAVE':'SAVE', 'SAVED':'SAVE', 'BLOCK':'BLOCKED', 'BLOCKED':'BLOCKED',
    'POST':'WOODWORK', 'HIT POST':'WOODWORK', 'WOODWORK':'WOODWORK', "'45":"'45", '45':"'45", 'OUT FOR 45':"'45" };
  const outCanon = v => OUT_CANON[up(v)] || up(v);
  const valueOf = o => o === 'GOAL' ? 'G' : o === '2 POINT' ? '2' : o === '1 POINT' ? 'P' : 'M';
  // where the game's word is only the coarse one and the file's says more: the file's goes in a detail label
  const SHOT_REFINE = { 'SAVE':['BLOCKED','WOODWORK'], 'SHORT':["'45",'BLOCKED','WOODWORK'] };
  const SRC_CAT = v => { const S = up(v); if(!S) return ''; if(/\bOWN\s+(KICK\s*OUT|KO)/.test(S)) return 'OWN KO'; if(/\bOPP(OSITION)?\s+(KICK\s*OUT|KO)/.test(S)) return 'OPP KO';
    if(/THROW[\s-]*(IN|UP)/.test(S)) return 'THROW-IN'; if(/FREE/.test(S)) return 'FREE WON'; if(/RECOVER/.test(S)) return 'BALL RECOVERED'; if(/TURNOVER|\bTOS?\b|F\/TO|U\/TO/.test(S)) return 'TURNOVER'; return S; };
  const koWonOf = (out, team, game) => { const K = up(out); if(!K) return null;
    if(/^KT\b/.test(K)) return true; if(/^RT\b/.test(K)) return false;
    const H = up(game && game.homeTeam), A = up(game && game.awayTeam), opp = team === H ? A : team === A ? H : '';
    if(opp && (K === opp || K.indexOf(opp + ' ') === 0)) return false; if(team && (K === team || K.indexOf(team + ' ') === 0)) return true;
    return /LOST/.test(K) ? false : /WON/.test(K) ? true : null; };
  const koTypeOf = out => { const K = up(out); return /SIDELINE|\bSL\b/.test(K) ? 'SIDELINE' : /FREE/.test(K) ? 'FREE' : /BREAK/.test(K) ? 'BREAK' : /CLEAN/.test(K) ? 'CLEAN' : ''; };
  const koLenOf = v => { const K = up(v); return /SHORT|\bSKO\b/.test(K) ? 'SHORT' : /MID|MEDIUM|\bMKO\b/.test(K) ? 'MEDIUM' : /LONG|\bLKO\b/.test(K) ? 'LONG' : ''; };
  function hash6(text){ let h = 0x811c9dc5; const s = String(text || ''); for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('00000000' + h.toString(16)).slice(-8).slice(0, 6); }
  const teamOf = (e, game) => { const t = up(e.team); if(t) return t; const c = up(e.code), H = up(game.homeTeam), A = up(game.awayTeam);
    return H && c.indexOf(H + ' ') === 0 ? H : A && c.indexOf(A + ' ') === 0 ? A : ''; };
  const startOf = e => fin(e.start) ? +e.start : fin(e.driveT) ? +e.driveT : null;

  // the game's shots and kickouts: COHESION's own rows (a converted Gaelic Insights / GIU original is skipped for its
  // converted row; an unconverted one is read itself), never a companion score / break row
  function gameAnchors(events, game){
    const sup = (GI.cohGiSupersededFn ? GI.cohGiSupersededFn(events) : () => false), comp = e => !!GI.cohGiIsCompanion && GI.cohGiIsCompanion(e);
    const out = [];
    (events || []).forEach((e, index) => { if(!e || !e.code || sup(e) || comp(e)) return;
      const C = up(e.code), t = startOf(e); if(t == null) return;
      let kind = '';
      if(SHOT_ROW.test(C) || (GI.cohGiIsShot && GI.cohGiIsShot(e))) kind = 'shot';
      else if(isKoRow(e)) kind = 'ko';
      if(!kind) return;
      const team = teamOf(e, game); if(!team) return;
      const o = kind === 'shot' ? outCanon(valCI(e, OUT_GROUPS) || e.outcome) : '';
      out.push({ index, e, kind, team, t, half: e.half || '', cls: team + '|' + (kind === 'shot' ? 'S' + valueOf(o) : 'KO'), out:o });
    });
    return out;
  }
  function fileAnchors(events){
    return (events || []).filter(e => SHOT_ROW.test(up(e.code)) || /\sKO$/.test(up(e.code))).map(e => {
      const kind = /\sKO$/.test(up(e.code)) ? 'ko' : 'shot', o = kind === 'shot' ? outCanon((e.labels || {})['Shot Outcomes'] || e.outcome) : '';
      return { e, kind, team: up(e.team), t: +e.start, half: e.half, cls: up(e.team) + '|' + (kind === 'shot' ? 'S' + valueOf(o) : 'KO'), out:o, srcId: String((e.labels || {})[IGC_SRC] || '') };
    });
  }
  // global alignment of two event sequences (in time order) — same class +3, otherwise −3, a gap −2; the traceback
  // prefers a pair, then a game-only event, then a file-only event. → [[g|null, f|null], …] in order
  const SC_SAME = 3, SC_DIFF = -3, SC_GAP = -2;
  function align(G, F){
    const n = G.length, m = F.length, D = [];
    for(let i = 0; i <= n; i++){ D.push(new Array(m + 1).fill(0)); D[i][0] = SC_GAP * i; }
    for(let j = 0; j <= m; j++) D[0][j] = SC_GAP * j;
    const sc = (a, b) => a.cls === b.cls ? SC_SAME : SC_DIFF;
    for(let i = 1; i <= n; i++) for(let j = 1; j <= m; j++) D[i][j] = Math.max(D[i-1][j-1] + sc(G[i-1], F[j-1]), D[i-1][j] + SC_GAP, D[i][j-1] + SC_GAP);
    const out = []; let i = n, j = m;
    while(i > 0 || j > 0){
      if(i > 0 && j > 0 && D[i][j] === D[i-1][j-1] + sc(G[i-1], F[j-1])){ out.push([G[i-1], F[j-1]]); i--; j--; }
      else if(i > 0 && D[i][j] === D[i-1][j] + SC_GAP){ out.push([G[i-1], null]); i--; }
      else { out.push([null, F[j-1]]); j--; }
    }
    return out.reverse();
  }
  // how the game's own rows in a half carry driveT and gameTime, relative to start (cohesion-merge.js's rule)
  function halfClock(events, half){
    const dk = [], ref = [];
    (events || []).forEach(e => { if(!e || (half != null && e.half !== half) || !fin(e.start)) return;
      if(fin(e.driveT)) dk.push(+e.driveT - +e.start);
      const m = /^(1H|2H|ET1|ET2)\s+(\d+):(\d\d)$/.exec(String(e.gameTime || '').trim());
      if(m && (half == null || m[1] === HALF_PFX[half])) ref.push(+e.start - (+m[2] * 60 + +m[3])); });
    return { n:dk.length, k: dk.length ? Math.round(median(dk)) : null, ref: ref.length ? Math.round(median(ref)) : null };
  }
  // file time → game time by the anchors of a half (sorted by file time): straight lines between anchors, the nearest
  // anchor's offset outside them
  function retimer(anchors){
    const A = anchors.slice().sort((a, b) => a.ft - b.ft || a.gt - b.gt);
    return t => {
      if(!A.length) return null;
      if(t <= A[0].ft) return t + (A[0].gt - A[0].ft);
      if(t >= A[A.length-1].ft) return t + (A[A.length-1].gt - A[A.length-1].ft);
      for(let k = 1; k < A.length; k++){ const a = A[k-1], b = A[k]; if(t > b.ft) continue;
        if(b.ft === a.ft) return a.gt;
        return a.gt + (t - a.ft) * (b.gt - a.gt) / (b.ft - a.ft); }
      return null;
    };
  }
  const descShot = (e, o) => { const L = (e && e.labels) || {}, dead = /DEAD/.test(up(e.code)), ty = L['Deadball Shot Type'] || L['Description'] || '';
    return (dead ? 'dead ball' + (ty ? ' (' + ty + ')' : '') : 'open play') + ' · ' + (o || 'no outcome'); };
  const descKo = (e, game) => { const o = valCI(e, KO_OUT_GROUPS) || e.outcome || '', len = valCI(e, KO_LEN_GROUPS); return (o || 'no outcome') + (len ? ' · ' + len : ''); };
  const clockOf = e => e.gameTime ? String(e.gameTime) : (e.half ? HALF_PFX[e.half] + ' ' : '') + mmss(e.start);

  function planFor(events, game, text, taIs){
    const conv = cohIgcImport(text, { homeTeam: game.homeTeam, awayTeam: game.awayTeam, taIs });
    if(conv.error) return { error: conv.error };
    const G = gameAnchors(events, game), F = fileAnchors(conv.events);
    const halves = HALVES.filter(h => G.some(g => g.half === h) || F.some(f => f.half === h));
    const pairs = [], hs = [];
    halves.forEach(h => {
      const g = G.filter(x => x.half === h).sort((a, b) => a.t - b.t || a.index - b.index), f = F.filter(x => x.half === h).sort((a, b) => a.t - b.t);
      const al = align(g, f); let same = 0;
      al.forEach(([a, b]) => { if(a && b && a.cls === b.cls){ same++; pairs.push({ half:h, g:a, f:b }); } });
      hs.push({ half:h, game:g.length, file:f.length, slots: al.length, matched: same, al });
    });
    return { conv, G, F, pairs, halves: hs };
  }
  function cohIgcMergePlan(events, game, text, opts){
    opts = opts || {}; events = events || [];
    const fail = (error, more) => Object.assign({ ok:false, error, matched:[], onlyGame:[], onlyIgc:[], diffs:[], fills:[], adds:[] }, more || {});
    const det = cohIgcDetect(text);
    if(!det.igc) return fail(det.message || ('This is not an iGaelicCoach file — it is ' + det.name + '. Only an iGaelicCoach file can be added here.'), { format: det.format });
    if(!game || !game.homeTeam || !game.awayTeam) return fail('The game has no home / away team names.');
    // which team TA is: as asked, else the reading that lines up more shots and kickouts
    const tries = {}, auto = {};
    (opts.taIs ? [opts.taIs] : ['home','away']).forEach(s => { tries[s] = planFor(events, game, text, s); if(tries[s].error) return; auto[s] = tries[s].pairs.length; });
    const firstErr = Object.values(tries).find(x => x.error); if(firstErr && !Object.values(tries).some(x => !x.error)) return fail(firstErr.error);
    const taIs = opts.taIs || ((auto.away || 0) > (auto.home || 0) ? 'away' : 'home'), P = tries[taIs];
    const tag = 'igc-' + hash6(clean(text)), marker = id => tag + ':' + id;
    const TA = P.conv.teams.TA, TB = P.conv.teams.TB;
    if(!P.G.length) return fail('The game has no shots or kickouts to line the file up with.', { taIs, auto });
    // ── matched events: what each would gain, and where the two files disagree ──
    // the game's own SCORE / SHOT SOURCE rows (Tracker, Sportscode, Code Room games)
    const srcRows = []; events.forEach(e => { if(!e || !/(SCORE|SHOT) SOURCE\s*$/.test(up(e.code))) return; const t = startOf(e); if(t == null) return;
      srcRows.push({ team: teamOf(e, game), s:t, en: fin(e.end) ? Math.max(t, +e.end) : t, v: valCI(e, ['Score Source Outcomes','Shot Source Outcomes','Source']) || '(source row)' }); });
    const fills = [], diffs = [], matched = [];
    const addTo = (fl, g, grp, v) => { if(!v) return false; const k = keyCI(g.e.labels, grp); if(k != null && String(g.e.labels[k] == null ? '' : g.e.labels[k]).trim()) return false; if(keyCI(fl.labels, grp) != null) return false; fl.labels[grp] = v; fl.what.push(grp + ': ' + v); return true; };
    P.pairs.forEach(({ half, g, f }) => {
      const fl = { index:g.index, id:g.e.id, labels:{}, what:[] }, dif = [], fe = f.e, FL = fe.labels || {};
      const item = { half, kind:g.kind, team:g.team, game:{ index:g.index, id:g.e.id, code:g.e.code, clock:clockOf(g.e), t:g.t, desc: g.kind === 'shot' ? descShot(g.e, g.out) : descKo(g.e, game) },
        file:{ id:f.srcId, code:fe.code, clock:clockOf(fe), t:f.t, desc: g.kind === 'shot' ? descShot(fe, f.out) : descKo(fe, game) }, adds:fl.what, diffs:dif };
      const diff = (what, kept, other, kind) => { const d = { half, kind:g.kind, team:g.team, what, kept, other, type: kind || 'differs', gameClock:item.game.clock, fileClock:item.file.clock, gameId:g.e.id, fileId:f.srcId }; dif.push(d); diffs.push(d); };
      if(g.kind === 'shot'){
        // the outcome: the same word, a finer word (detail label), or a different one (listed only)
        const fAll = ((fe.labelsAll || {})['Shot Outcomes'] || [f.out]).filter(Boolean);
        if(g.out && f.out && g.out !== f.out){
          const fine = (SHOT_REFINE[g.out] || []).find(x => fAll.indexOf(x) >= 0);
          if(fine){ addTo(fl, g, 'Shot Outcome Detail', fine); diff('shot outcome', g.out, f.out + (fAll.length > 1 ? ' (' + fAll.join(' + ') + ')' : ''), 'refined'); }
          else if(fAll.indexOf(g.out) < 0) diff('shot outcome', g.out, f.out);
        } else if(!g.out && f.out) diff('shot outcome', '(none)', f.out);
        const gd = /DEAD/.test(up(g.e.code)), fd = /DEAD/.test(up(fe.code));
        if(gd !== fd || (gd && fd && valCI(g.e, ['Deadball Shot Type']) && FL['Deadball Shot Type'] && up(valCI(g.e, ['Deadball Shot Type'])) !== up(FL['Deadball Shot Type'])))
          diff('shot type', gd ? 'dead ball' + (valCI(g.e, ['Deadball Shot Type','Description']) ? ' (' + valCI(g.e, ['Deadball Shot Type','Description']) + ')' : '') : 'open play', fd ? 'dead ball (' + (FL['Deadball Shot Type'] || '') + ')' : 'open play');
        // the source
        // the source: the shot's own label, else (a game coded with separate SCORE / SHOT SOURCE rows) the source row of
        // this shot — in such a game the row IS the source, so no label is ever added to a shot there, only differences listed
        const srcRow = srcRows.find(r => r.team === g.team && r.s - 2 <= g.t && g.t <= r.en + 3) || null;
        const gs = valCI(g.e, SRC_GROUPS) || (srcRow ? srcRow.v : ''), fs = FL['Shot Source Outcomes'] || '';
        if(fs){ if(gs){ if(SRC_CAT(gs) !== SRC_CAT(fs)) diff('source', gs, fs); } else if(!srcRows.length) addTo(fl, g, 'Shot Source Outcomes', fs); }
        // goal chance → Goal Attempt where the game has no attempt; the third; the Goal Chance flag
        const ga = valCI(g.e, ['Shot Attempts','Attempt']), fa = FL['Shot Attempts'] || '';
        if(fa){ if(!ga) addTo(fl, g, 'Shot Attempts', fa); else if(up(ga) !== up(fa)) diff('shot attempt', ga, fa); }
        if(FL['PitchArea']) addTo(fl, g, 'PitchArea', FL['PitchArea']);
        if(FL['Goal Chance']) addTo(fl, g, 'Goal Chance', FL['Goal Chance']);
      } else {
        const go = valCI(g.e, KO_OUT_GROUPS) || g.e.outcome || '', fo = FL['Kickout Outcomes'] || '', gw = koWonOf(go, g.team, game), fw = koWonOf(fo, g.team, game);
        if(gw != null && fw != null && gw !== fw) diff('kickout result', go + ' (' + (gw ? 'won' : 'lost') + ')', fo + ' (' + (fw ? 'won' : 'lost') + ')');
        else if(gw === fw && gw != null){ const gt = koTypeOf(go), ft = koTypeOf(fo);
          if(gt && ft && gt !== ft){ if((ft === 'SIDELINE' || ft === 'FREE') && (gt === 'CLEAN' || gt === 'BREAK')){ addTo(fl, g, 'Kickout Outcome Detail', fo); diff('kickout won by', go, fo, 'refined'); }
            else diff('kickout won by', go, fo); } }
        else if(!go && fo) addTo(fl, g, 'Kickout Outcomes', fo);
        const gl = valCI(g.e, KO_LEN_GROUPS), flen = FL['Kickout Locations'] || '';
        if(flen){ if(!gl) addTo(fl, g, 'Kickout Locations', flen); else if(koLenOf(gl) !== koLenOf(flen)) diff('kickout length', gl, flen); }
        if(FL['PitchArea']) addTo(fl, g, 'PitchArea', FL['PitchArea']);
      }
      if(fl.what.length) fills.push(fl);
      matched.push(item);
    });
    // ── only in one of the two ──
    const pairedG = new Set(P.pairs.map(p => p.g)), pairedF = new Set(P.pairs.map(p => p.f));
    const onlyGame = P.G.filter(g => !pairedG.has(g)).map(g => ({ half:g.half, kind:g.kind, team:g.team, id:g.e.id, index:g.index, code:g.e.code, clock:clockOf(g.e), t:g.t, cls:g.cls,
      desc: g.kind === 'shot' ? descShot(g.e, g.out) : descKo(g.e, game) }));
    const onlyIgc = P.F.filter(f => !pairedF.has(f)).map(f => ({ half:f.half, kind:f.kind, team:f.team, id:f.srcId, code:f.e.code, clock:clockOf(f.e), t:f.t, cls:f.cls,
      desc: f.kind === 'shot' ? descShot(f.e, f.out) : descKo(f.e, game) }));
    // the same kind of event left over in both, same half: very likely one event the two files time differently
    onlyGame.forEach(a => { const b = onlyIgc.find(x => !x.twin && x.cls === a.cls && x.half === a.half && (a.kind === 'ko' || !/\|SM$/.test(a.cls)));
      if(b){ a.twin = b.id; b.twin = a.id; a.note = 'iGaelicCoach has ' + (a.kind === 'ko' ? 'a ' : 'the same ') + (a.kind === 'ko' ? 'kickout' : 'score') + ' of ' + a.team + ' at ' + b.clock + ' — not lined up (the two files time it differently)';
        b.note = 'the game has ' + (a.kind === 'ko' ? 'a kickout' : 'the same score') + ' of ' + a.team + ' at ' + a.clock + ' — not lined up'; } });
    // ── the possessions to add, retimed by the anchors of their half ──
    const have = new Set(); events.forEach(e => { const m = e && valCI(e, [MERGE_SRC]); if(m) have.add(m); });
    const adds = [], already = [], noAnchor = [], byHalf = {};
    P.pairs.forEach(p => { (byHalf[p.half] = byHalf[p.half] || []).push({ ft:p.f.t, fe: +p.f.e.end, gt:p.g.t }); });
    const clocks = {};
    P.conv.events.filter(e => /TEAM POSSESSION$/.test(up(e.code))).forEach(e => {
      const id = String((e.labels || {})[IGC_SRC] || ''), mk = marker(id);
      if(have.has(mk)){ already.push(id); return; }
      const A = byHalf[e.half] || [];
      if(A.length < 2){ noAnchor.push(id); return; }
      const c = clocks[e.half] || (clocks[e.half] = halfClock(events, e.half)), all = c.n ? c : halfClock(events, null);
      // kept inside its half: not before the half's 00:00, not into the next half
      const hi0 = HALVES.slice(HALVES.indexOf(e.half) + 1).map(h => clocks[h] || (clocks[h] = halfClock(events, h))).find(x => x.ref != null);
      const lo = c.ref != null ? c.ref : -Infinity, hi = hi0 ? hi0.ref - 1 : Infinity, cl = v => Math.min(hi, Math.max(lo, v));
      const rt = retimer(A), s = Math.round(cl(rt(+e.start))), en = Math.max(s, Math.round(cl(rt(+e.end))));
      const row = clone(e);
      delete row.labels[IGC_SRC]; delete row.videoT; delete row.labels['Half'];
      row.id = 'igcm-' + hash6(clean(text)) + '-' + id; row.start = s; row.end = en;
      row.driveT = Math.max(0, s + (all.k == null ? 0 : all.k));
      if(c.ref != null){ const rel = Math.max(0, s - c.ref); row.gameTime = HALF_PFX[e.half] + ' ' + String(Math.floor(rel / 60)).padStart(2, '0') + ':' + String(rel % 60).padStart(2, '0'); }
      else delete row.gameTime;
      row.labels[MERGE_SRC] = mk;
      adds.push(row);
    });
    const halves = P.halves.map(h => ({ half:h.half, game:h.game, file:h.file, slots:h.slots, matched:h.matched }));
    const stats = { anchorsGame:P.G.length, anchorsFile:P.F.length, slots: halves.reduce((a, h) => a + h.slots, 0), matched: P.pairs.length,
      fills: fills.length, labels: fills.reduce((a, f) => a + f.what.length, 0), possAdd: adds.length, possAlready: already.length, possNoAnchor: noAnchor.length,
      diffs: diffs.length, refined: diffs.filter(d => d.type === 'refined').length };
    return { ok:true, error:'', format: FORMAT, taIs, auto, teams:{ TA, TB }, tag, halves, matched, onlyGame, onlyIgc, diffs, fills, adds, already, noAnchor, stats };
  }
  // the writes for a plan: rows = the stored rows [{id, data}] in the order the plan's events were given
  //   → { updates:[{id, data}] (labels added, nothing replaced), inserts:[data] }
  function cohIgcMergeOps(rows, plan){
    const updates = [], inserts = [];
    if(!plan || !plan.ok) return { updates, inserts };
    (plan.fills || []).forEach(fl => { const r = rows[fl.index]; if(!r || !r.data) return;
      const d = clone(r.data); d.labels = d.labels || {}; let n = 0;
      Object.keys(fl.labels).forEach(g => { const k = keyCI(d.labels, g); if(k != null && String(d.labels[k] == null ? '' : d.labels[k]).trim()) return; d.labels[k != null ? k : g] = fl.labels[g]; n++; });
      if(n) updates.push({ id: r.id, data: d }); });
    (plan.adds || []).forEach(a => inserts.push(clone(a)));
    return { updates, inserts };
  }
  // the same on a plain event list (tests): a NEW list — every event the game had (labels added where planned), then the adds
  function cohIgcMergeApply(events, plan){
    const rows = (events || []).map((d, i) => ({ id: i, data: d })), ops = cohIgcMergeOps(rows, plan), out = (events || []).map(e => e);
    ops.updates.forEach(u => { out[u.id] = u.data; });
    return out.concat(ops.inserts);
  }

  const api = { cohIgcDetect, cohIgcSummary, cohIgcImport, cohIgcMergePlan, cohIgcMergeOps, cohIgcMergeApply, cohIgcInstances: instancesOf, cohIgcAlign: align,
    COH_IGC_FORMAT: FORMAT, COH_IGC_NAME: NAME, COH_IGC_SRC: IGC_SRC };
  Object.assign(root, api);
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
