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
    return e => !!(s.size && e && !lbl(e, GI_SRC) && s.has(String(e.id)) && isGiShot(e));
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

  // New events for every GI shot with no derived event yet. Idempotent.
  function cohGiConvert(events, game){
    const done = new Set();
    (events || []).forEach(e => { const id = lbl(e, GI_SRC); if(id) done.add(id); });
    const out = [];
    (events || []).forEach(e => {
      if(!isGiShot(e)) return;
      const id = String(e.id);
      if(!id || done.has(id)) return;
      done.add(id);
      cohGiMapShot(e).forEach(n => out.push(n));
    });
    return out;
  }
  // Counts for the confirmation text.
  function cohGiCounts(newEvents){
    let shots = 0, scores = 0;
    (newEvents || []).forEach(e => { if(/SHOT (OPEN|DEAD)/i.test(e.code || '')) shots++; else scores++; });
    return { shots, scores };
  }

  const api = { cohGiConvert, cohGiSuperseded, cohGiSupersededFn, cohGiIsCompanion, cohGiIsShot:isGiShot, cohGiMapShot, cohGiCounts, COH_GI_SRC:GI_SRC };
  Object.assign(root, api);
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
