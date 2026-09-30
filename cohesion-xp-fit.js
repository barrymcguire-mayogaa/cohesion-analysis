/* cohesion-xp-fit.js — refit the COHESION expected-points (xP) model.
 *
 * A dependency-free port of the Python v1 pipeline (parse.py, features.py,
 * xplib.py, final.py, evaluate.py, export_json.py). Runs in the browser
 * (xp-refit.html, admin only) and in node (parity tests).
 *
 *   const F = CohesionXpFit;
 *   const games = [{id, meta, events:[{id, data}|data]}...]   // data.js gameBundle shape
 *   const ds  = F.buildDataset(games);           // parse, de-duplicate, detect conventions, features
 *   const cv  = F.crossValidate(ds, {current: modelJson});   // NEW v CURRENT on the same held-out folds
 *   const fit = F.fitAll(ds.rows);                            // full-data fit
 *   const json= F.toModelJson(fit, ds, {version: F.nextVersion(currentVersion)});
 *
 * Model form (identical to v1):
 *   point attempts : ridge logistic (standardised features, lambda 1) on
 *                    dist RCS (knots 15/28/38/50), log goal-mouth angle,
 *                    db_free, db_45, db_free_x_dist, press_high, press_missing
 *   goal attempts  : P(goal) logistic on log(dist) (lambda 3);
 *                    P(point | no goal) constant; penalties smoothed rate (+0.5)
 */
(function (root) {
  'use strict';

  // ── constants (features.py / final.py) ──────────────────────────────────
  const KNOT_Y = [1.4, 21.0, 31.0, 70.2], KNOT_M = [0.0, 13.0, 20.0, 45.0];
  const SX = 0.878, X0 = 50.0, POST_HALF = 3.25, MIN_DEPTH = 0.5;
  const DIST_KNOTS = [15, 28, 38, 50];
  const LAMP = 1.0, LAMG = 3.0, LAMPT = 1.0, PEN_PRIOR = 0.5;
  const P_NAMES = ['dist', 'dist_rcs1', 'dist_rcs2', 'log_goalmouth_angle', 'db_free', 'db_45',
                   'db_free_x_dist', 'press_high', 'press_missing'];
  const COUNTIES = new Set(('ANTRIM ARMAGH CARLOW CAVAN CLARE CORK DERRY DONEGAL DOWN DUBLIN FERMANAGH GALWAY ' +
    'KERRY KILDARE KILKENNY LAOIS LEITRIM LIMERICK LONGFORD LOUTH MAYO MEATH MONAGHAN OFFALY ROSCOMMON SLIGO ' +
    'TIPPERARY TYRONE WATERFORD WESTMEATH WEXFORD WICKLOW LONDON').split(' ').concat(['NEW YORK']));
  const SHOT_RE = /^(.*?)\s*SHOT (OPEN PLAY|DEAD ?BALL)\s*$/i;
  const DUP_SIM = 0.75;

  const normTeam = t => String(t || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const sigmoid = z => 1 / (1 + Math.exp(-z));

  // ── 1. PARSE: COHESION events -> tracker-format shots (parse.py) ─────────
  function labelMap(labels) {             // lower-cased group -> text (first non-empty wins)
    const L = {};
    for (const k in (labels || {})) {
      const g = String(k).trim().toLowerCase(), t = labels[k] == null ? '' : String(labels[k]).trim();
      if (g && !(g in L)) L[g] = t;
    }
    return L;
  }
  const num = v => { if (v == null || String(v).trim() === '') return null; const f = Number(v); return isFinite(f) ? f : null; };

  /** game = {id, meta, events:[{id,data}] | [data]} -> parsed game summary with shots. */
  function parseGame(game) {
    const events = (game.events || []).map(e => (e && e.data && typeof e.data === 'object' && !e.code) ? e.data : e);
    const meta = game.meta || {};
    let nTracker = 0, nGi = 0;
    const raw = [];
    for (const ev of events) {
      if (!ev) continue;
      const code = String(ev.code || '').trim();
      const m = SHOT_RE.exec(code);
      if (!m) { if (/\bSHOT\b/i.test(code)) nGi++; continue; }
      nTracker++;
      const L = labelMap(ev.labels);
      let side = null, x = null, y = null;
      if ('x-shot' in L && 'y-shot' in L) { side = 'home'; x = L['x-shot']; y = L['y-shot']; }
      else if ('x-shot_away' in L && 'y-shot_away' in L) { side = 'away'; x = L['x-shot_away']; y = L['y-shot_away']; }
      x = num(x); y = num(y); if (x == null || y == null) { x = y = null; }
      raw.push({
        team: normTeam(m[1]), deadball: /DEAD/i.test(m[2]), side, x, y,
        attempt: (L['shot attempts'] || '').trim(), outcome: (L['shot outcomes'] || '').trim(),
        dbtype: (L['deadball shot type'] || '').trim(), zone: L['shot zones'] || '',
        pressure: L['shot pressure'] || '', leg: L['shooting leg'] || '',
        player: String(ev.player || '').trim() || null, start: Number(ev.start) || 0
      });
    }
    // within-game duplicate instances (same team/time/outcome/attempt/xy/player)
    const seen = new Set(), shots = [];
    for (const s of raw) {
      const k = [s.team, Math.round(s.start * 10) / 10, s.outcome, s.attempt, s.x, s.y, s.player].join('\u0001');
      if (seen.has(k)) continue; seen.add(k); shots.push(s);
    }
    const nxy = shots.filter(s => s.x != null).length;
    let excluded = null;
    if (nTracker === 0) excluded = nGi > 0 ? 'Gaelic Insights-style "<Team> Shot" codes (no coordinates)' : 'no shot events';
    else if (nxy === 0) excluded = 'tracker-format shots but no X/Y coordinates';
    const teams = Array.from(new Set(shots.map(s => s.team))).sort();
    const section = meta.section === 'club' ? 'club' : 'county';
    return {
      id: game.id != null ? game.id : meta.id, meta, section,
      title: meta.title || teams.join(' v '), date: meta.date || '',
      shots, n: shots.length, nxy, teams, excluded, dupWithin: raw.length - shots.length,
      nPlayer: shots.filter(s => s.player).length, tagged: shots.filter(s => s.pressure).length,
      order: game.order != null ? game.order : 0
    };
  }

  // ── difflib.SequenceMatcher(None, a, b, autojunk=False).ratio() ─────────
  function seqRatio(a, b) {
    const la = a.length, lb = b.length;
    if (!la && !lb) return 1;
    const b2j = new Map();
    b.forEach((e, j) => { if (!b2j.has(e)) b2j.set(e, []); b2j.get(e).push(j); });
    function longest(alo, ahi, blo, bhi) {
      let besti = alo, bestj = blo, bestsize = 0, j2len = new Map();
      for (let i = alo; i < ahi; i++) {
        const nj = new Map(), js = b2j.get(a[i]) || [];
        for (const j of js) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          nj.set(j, k);
          if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
        }
        j2len = nj;
      }
      while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
      while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
      return [besti, bestj, bestsize];
    }
    let matched = 0;
    const queue = [[0, la, 0, lb]];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const [i, j, k] = longest(alo, ahi, blo, bhi);
      if (k) {
        matched += k;
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    return 2 * matched / (la + lb);
  }
  const seqOf = g => g.shots.map(s => s.team + '\u0001' + String(s.outcome).toUpperCase());

  /** Compact, storable shot-sequence fingerprint of a game: {teams, o:[outcomes], s:'AbC…'}
   *  (upper case = first team, lower case = second; letter = outcome index). Used to tell which
   *  games a published model was trained on, so NEW v CURRENT can be compared on unseen games. */
  function fingerprint(g) {
    const teams = g.teams.slice(), o = [];
    let str = '';
    for (const sh of g.shots) {
      const out = String(sh.outcome).toUpperCase();
      let k = o.indexOf(out); if (k < 0) { o.push(out); k = o.length - 1; }
      if (k > 25) return null;
      str += String.fromCharCode((teams.indexOf(sh.team) === 0 ? 65 : 97) + k);
    }
    return { id: g.id, title: g.title, date: g.date, teams, o, s: str };
  }
  function seqFromFingerprint(fp) {
    return Array.from(fp.s).map(ch => {
      const c = ch.charCodeAt(0), lo = c >= 97;
      return fp.teams[lo ? 1 : 0] + '\u0001' + fp.o[c - (lo ? 97 : 65)];
    });
  }
  /** Ids of dataset games that appear in a model's training fingerprints (id match or same game by sequence). */
  function trainedGameIds(ds, training) {
    const seen = new Set();
    if (!training || !training.length) return seen;
    const fps = training.filter(t => t && t.s != null && t.teams).map(t => ({ teams: t.teams.join('|'), seq: seqFromFingerprint(t) }));
    const ids = new Set(training.filter(t => t && t.id != null).map(t => String(t.id)));
    for (const g of ds.games) {
      if (ids.has(String(g.id))) { seen.add(g.id); continue; }
      if (!g.fp) continue;
      const seq = seqFromFingerprint(g.fp), tk = g.teams.join('|');
      if (fps.some(f => f.teams === tk && seqRatio(seq, f.seq) >= DUP_SIM)) seen.add(g.id);
    }
    return seen;
  }
  /** The 45 games the bundled v1 (1.0.0) was fitted on (from the Python fit's shots_raw.csv). */
  const V1_TRAINING = [{"title":"2026 AISFC Final - Mayo v Kerry 2","teams":["KERRY","MAYO"],"o":["1 POINT","SHORT","WIDE","GOAL","2 POINT","BLOCKED","SAVE","WOODWORK"],"s":"AbCAAacbbADAeCCBCbAeaaCaAbaaAafgaCdCAcceBAbcAcAcAaAaacCebhEACBa"},{"title":"2026 AISFC QF - Mayo v Cork 2","teams":["CORK","MAYO"],"o":["1 POINT","'45","SAVE","WIDE","2 POINT","BLOCKED","SHORT","WOODWORK"],"s":"aaBACDDDdAadDEAdDaADADeaFADfdDAfeGdAeaeDDdgAAaAAdhaeDafEDaDACaaDaAf"},{"title":"2026 AISFC R1 - Mayo v Monaghan","teams":["MAYO","MONAGHAN"],"o":["2 POINT","1 POINT","WIDE","SAVE","WOODWORK","BLOCKED","SHORT","GOAL"],"s":"ABCdefgBccbCCbdBeAAbcAbbcHbBbcBCaAABdbgcdcBdbdeBcaBCgCbhFbFBfgbBahBa"},{"title":"2026 AISFC R2 - Mayo v Tyrone","teams":["MAYO","TYRONE"],"o":["WIDE","1 POINT","WOODWORK","SHORT","'45","SAVE","BLOCKED","2 POINT","GOAL"],"s":"abcdBeabBBbbBFAbaGBBBGbbAaBDaGaGbCbdHbAfbabbBabHbGGBGIabBbgBbAbDBebBhD"},{"title":"2026 AISFC Rd3 - Mayo v Meath","teams":["MAYO","MEATH"],"o":["WIDE","1 POINT","SHORT","SAVE","GOAL","BLOCKED","2 POINT"],"s":"abcBdbbbbaBaeAAbFbDBecBBbcBCBAbaAbaGBbAFBBDAbBcBGABBdbGBacBaC"},{"title":"2026 AISFC SF - Mayo v Louth (full)","teams":["LOUTH","MAYO"],"o":["WIDE","1 POINT","SHORT","SAVE","GOAL","BLOCKED","2 POINT","WOODWORK"],"s":"aBcdeBbbBAFaaGGbbBgbCfbcBAGAbCfeAhcgAAbbddbccebaHfaBbBbCagbAAGbAg"},{"title":"2026 CSFC QF - Mayo v London (full)","teams":["LONDON","MAYO"],"o":["1 POINT","SHORT","2 POINT","WIDE","BLOCKED","SAVE","GOAL","WOODWORK"],"s":"AbcAadddcAAcccdbAdDdddEAafacecdGaaDaDbaCAdaBahaaBaDaaaCaCCa"},{"title":"2026 CSFC SF - Mayo v Roscommon (FULL)","teams":["MAYO","ROSCOMMON"],"o":["WIDE","1 POINT","WOODWORK","GOAL","2 POINT","SHORT","BLOCKED"],"s":"aAABBBBaAcdAbBEBFbabADBbbBbbbBabebffbbBbGfBfeBBbbgbbbbbAAbABEdAaaFAA"},{"title":"2026 NFL Div.1 Rd.1 - Mayo v Galway","teams":["GALWAY","MAYO"],"o":["1 POINT","2 POINT","SHORT","BLOCKED","WIDE","GOAL","WOODWORK","SAVE"],"s":"AbCaaAdacaAeeAABfaAGCbAaggDbAbEcEafeAAhebcCEAAFEHADAEfEFaeecHHB"},{"title":"2026 NFL Div.1 Rd.2 - Mayo v Dublin (Full)","teams":["DUBLIN","MAYO"],"o":["1 POINT","GOAL","WIDE","'45","SHORT","2 POINT","SAVE","BLOCKED","WOODWORK"],"s":"aaBcCDAcEfAacgEfcCCCcAahACcCageceAaCIacCcgCEebEaaFcBaAacaCacaCcAE"},{"title":"2026 NFL Div.1 Rd.3 - Mayo v Donegal (Full)","teams":["DONEGAL","MAYO"],"o":["WIDE","1 POINT","SHORT","2 POINT","SAVE","GOAL"],"s":"ABcBABaaBdABcBcBbaBbBBbaBecbbeDBbeFBBababaCbeCBCbBbbBaAAaC"},{"title":"2026 NFL Div.1 Rd.4 - Mayo V Monaghan","teams":["MAYO","MONAGHAN"],"o":["1 POINT","WOODWORK","2 POINT","WIDE","SHORT","BLOCKED","GOAL","SAVE"],"s":"abaCDCAAdAadAeaDadCAAAdeEaCDCAdDedfEeaAgaDeeAAaGAHAeAAcGgeCDeAADDAdh"},{"title":"2026 NFL Div.1 Rd.5 - Mayo v Armagh","teams":["ARMAGH","MAYO"],"o":["WIDE","1 POINT","GOAL","SHORT","WOODWORK","BLOCKED","SAVE","2 POINT"],"s":"abcdAdEbDFBGAABhBGABhahahDBbagbBBbbHHfFADBBdBcBBbBBAHdbDbBB"},{"title":"2026 NFL Div.1 Rd.6 - Mayo v Kerry (full)","teams":["KERRY","MAYO"],"o":["1 POINT","2 POINT","BLOCKED","WIDE","SHORT","SAVE","GOAL"],"s":"AbAaccAaabdAdEbAAeAADAdAAeffAdaAbBdGEBeAAaddddaBdGedABBdAebbdBa"},{"title":"2026 NFL Div.1 Rd.7 - Mayo v Roscommon","teams":["MAYO","ROSCOMMON"],"o":["1 POINT","WOODWORK","SAVE","SHORT","BLOCKED","WIDE","GOAL","2 POINT"],"s":"aBCDAeaFfAAFfCAEAgAGGFaAfaHCFAGaAGAfAADCAcAEAgaAfAadfAAaAfAeBhdfAbHa"},{"title":"2026 Senior Challenge - Mayo v Kildare","teams":["KILDARE","MAYO"],"o":["1 POINT","WIDE","SAVE","GOAL","WOODWORK","SHORT","2 POINT","BLOCKED"],"s":"AaabcdcAaaEaFBBcbGaAGaaAdEAbgcaAbgadBbaAfBbBggbaAAfAfGhhDFaAfaaAfDbBaafBHBf"},{"title":"2026 Senior Challenge - Mayo v Meath","teams":["MAYO","MEATH"],"o":["SHORT","BLOCKED","2 POINT","1 POINT","WOODWORK","WIDE","SAVE","GOAL"],"s":"AbccDcAcaCdaDcEdFdfFffdfGDFFCaFDffDFDfDhaAfDBFdCfddfd"},{"title":"Ballintubber_v_Aghamore-2","teams":["AGHAMORE","BALLINTUBBER"],"o":["WIDE","1 POINT","SHORT","2 POINT","BLOCKED","GOAL"],"s":"abBbbCdEBafBbABbABbcBCFbcbBBCEFbCAaBBcaaAbaBB"},{"title":"Aghamore_v_Castlebar_Mitchels-2","teams":["AGHAMORE","CASTLEBAR MITCHELS"],"o":["1 POINT","WIDE","WOODWORK","2 POINT","SHORT","SAVE","GOAL","BLOCKED"],"s":"AbaaAbbacAaAadBaEAECaaBdeabbbfBEGaaBbEBBbAHDaaBBeHDaaB"},{"title":"AGH_v_CDR_2026-08-22","teams":["AGHAMORE","CROSSMOLINA DEEL ROVERS"],"o":["WIDE","1 POINT","BLOCKED","SHORT","GOAL","2 POINT"],"s":"AABaaCBBBAdBbaBdEbbAaabCAabbBaBBbBfAcbABfAbAbAaBDbBbDB"},{"title":"BALLA_v_BALLINA_STEPHENITES_local_video","teams":["BALLA","BALLINA STEPHENITES"],"o":["WOODWORK","SHORT","1 POINT","WIDE","2 POINT","SAVE","BLOCKED","GOAL"],"s":"AbCCdcbceDAbDCCddbDbccDFDEDbDcDgdcHcbcDdcBCCcCchFBeGcCcBHcE"},{"title":"Balla_v_Castlebar_Mitchels","teams":["BALLA","CASTLEBAR MITCHELS"],"o":["WIDE","1 POINT","2 POINT","BLOCKED","WOODWORK","GOAL","SHORT","SAVE"],"s":"AAbbcabbDBDbBbbbcDeBfbABabGAbBGBGAfgabBACADHB"},{"title":"BAL_v_BAL_2026-08-13","teams":["BALLINROBE","BALLYHAUNIS"],"o":["2 POINT","WIDE","1 POINT","SHORT","BLOCKED","GOAL","'45"],"s":"ABbcBBCcadebcCCdCBfDbBdccaCdcBaFBcBDaGBBdDCbB"},{"title":"B_al_an_Mhuirthead_v_Breaffy-3","teams":["BREAFFY","B\u00c9AL AN MHUIRTHEAD"],"o":["1 POINT","WIDE","2 POINT","GOAL","SHORT","SAVE","BLOCKED"],"s":"AbcAbbBcABaAdbBEABfBfegABAEBCAgaEaAAeeCbAggfGaE"},{"title":"Breaffy_v_Knockmore-2","teams":["BREAFFY","KNOCKMORE"],"o":["SHORT","1 POINT","2 POINT","WIDE","BLOCKED","SAVE","GOAL"],"s":"ABBBbBBCdCabcaaCcbaBDaDbabCdbCbDaCBeBBdbbdbFBg"},{"title":"Breaffy_v_Westport","teams":["BREAFFY","WESTPORT"],"o":["1 POINT","SHORT","WIDE","WOODWORK","2 POINT","GOAL","BLOCKED"],"s":"AbaAcDAbaaCaEaaEAAaeFGCcAacCcccceCECaECacbCaAaAAaFcCaCAcB"},{"title":"Ballina_Stephenites_v_Garrymore","teams":["BALLINA STEPHENITES","GARRYMORE"],"o":["WIDE","SHORT","2 POINT","1 POINT","WOODWORK","SAVE","BLOCKED","GOAL"],"s":"AbaaACBdEabAaddcAfadGFFaBBDcCAAAADDDdDadahbBaBAdDDBdGAB"},{"title":"Ballaghaderreen_v_B_al_an_Mhuirthead-2","teams":["BALLAGHADERREEN","B\u00c9AL AN MHUIRTHEAD"],"o":["WIDE","GOAL","2 POINT","1 POINT","SHORT","WOODWORK","SAVE"],"s":"aabCddDAdAedfCbaCDdDabedDdfadddgaaADDEBGdDdEdGBEcdEbAd"},{"title":"Ballaghaderreen_v_Knockmore","teams":["BALLAGHADERREEN","KNOCKMORE"],"o":["WIDE","BLOCKED","SHORT","1 POINT","2 POINT","GOAL"],"s":"AAbaCDAAadeCddeCddfddEbcddFdcDdaDddAddddadCEaAcddaEB"},{"title":"Breaffy_v_Ballaghaderreen-3","teams":["BALLAGHADERREEN","BREAFFY"],"o":["SHORT","WIDE","1 POINT","2 POINT","'45","BLOCKED","SAVE"],"s":"ABabBCBdCEDcBcbbfCdCbcACBddacAAbCDbdgCbccdccBACAfd"},{"title":"Charlestown_Sarsfields_v_Claremorris","teams":["CHARLESTOWN SARSFIELDS","CLAREMORRIS"],"o":["2 POINT","WIDE","SHORT","1 POINT","GOAL","BLOCKED"],"s":"aBcABdddAEBDcdBaDcaDdCDcadDdafddCBbDfDbbdBbDF"},{"title":"CLA_v_WES_2026-08-23","teams":["CLAREMORRIS","WESTPORT"],"o":["BLOCKED","1 POINT","2 POINT","GOAL","WIDE","DISALLOWED GOAL","SHORT","'45"],"s":"ABCBBdBeBFbgbdBBEdgGgBCCCCecgBcBhgdbEBDagEECEeAcebEebdBBBBhgeEEdBe"},{"title":"Castlebar_Mitchels_v_Ballina_Stephenites","teams":["BALLINA STEPHENITES","CASTLEBAR MITCHELS"],"o":["WIDE","1 POINT","GOAL","SHORT","BLOCKED","2 POINT"],"s":"aBABbbaaCdBbEDAbbabBBBbffDaAaBbaBAdFfdabDbaAbc"},{"title":"Castlebar_Mitchels_v_Garrymore","teams":["CASTLEBAR MITCHELS","GARRYMORE"],"o":["1 POINT","'45","SHORT","2 POINT","WIDE","BLOCKED","WOODWORK"],"s":"aAbcaaaDaaAAAeeaFAeaeagDeCcaaAdaFeGAdeEAeAEaECCdA"},{"title":"Charlestown_Sarsfields_v_Kilmeena-3","teams":["CHARLESTOWN SARSFIELDS","KILMEENA"],"o":["WIDE","2 POINT","SHORT","1 POINT","GOAL","'45","WOODWORK","BLOCKED","SAVE"],"s":"aBCaCdADEaAfaFAadDagccahdBdBaeAddIcadDaDbIDAabEA"},{"title":"Charlestown_Sarsfields_v_Ballaghaderreen","teams":["BALLAGHADERREEN","CHARLESTOWN SARSFIELDS"],"o":["WIDE","1 POINT","GOAL","SHORT","SAVE","2 POINT","BLOCKED","'45"],"s":"abCDbcAbdccABbBBBeDcaBfbAbAADAcGBAAHAabFFADGFDDAEbA"},{"title":"Claremorris_v_B_al_an_Mhuirthead-2","teams":["B\u00c9AL AN MHUIRTHEAD","CLAREMORRIS"],"o":["WOODWORK","1 POINT","GOAL","WIDE","SHORT","SAVE","2 POINT","BLOCKED"],"s":"AbBCbbbabbdCddBBBbdddbdeDEddbCBbDFCbedBebbbGFhdDBfFgDCdBdffbDGbgBd"},{"title":"Crossmolina_Deel_Rovers_v_Ballintubber","teams":["BALLINTUBBER","CROSSMOLINA DEEL ROVERS"],"o":["2 POINT","1 POINT","WIDE","SHORT","BLOCKED","WOODWORK","GOAL"],"s":"abBABabBBBBbbbbcbBbcbDCbdecADbcbCbCDeFdgaAaDBcAcBCcAbBbBbBbb"},{"title":"DUB_v_GAL_2026-07-05","teams":["DUBLIN","GALWAY"],"o":["1 POINT","WIDE","SHORT","2 POINT","WOODWORK","SAVE","GOAL","BLOCKED"],"s":"aABaAcDAaBdBABAaCadAaABaABcABdAbBcdaeaBbDbabBbAaafgAAAGeHeeaDAAA"},{"title":"DUB_v_KER_2026-07-13","teams":["DUBLIN","KERRY"],"o":["2 POINT","SAVE","GOAL","WIDE","1 POINT","BLOCKED","65M","SHORT","WOODWORK"],"s":"AbcDeFEeeDAeGEeDhEDeEeDEhdEEeDEEEfIHhcEaDefdaEaDddDBBEdehEDDeEEe"},{"title":"Garrymore_v_Balla-2","teams":["BALLA","GARRYMORE"],"o":["BLOCKED","SHORT","1 POINT","GOAL","WIDE","WOODWORK","2 POINT"],"s":"abCdEefcBcEeCGeEAecEefcCgEggCECeeGEECEceEEEce"},{"title":"Garrymore_v_Crossmolina_Deel_Rovers-2","teams":["CROSSMOLINA DEEL ROVERS","GARRYMORE"],"o":["2 POINT","1 POINT","SHORT","WIDE","BLOCKED","'45","WOODWORK"],"s":"abcBcDaEcfcDcBbCADBbdBEBabgddBdbBdDdBBgBgbbDDdbEDD"},{"title":"Kilmeena_v_Westport","teams":["KILMEENA","WESTPORT"],"o":["WIDE","1 POINT","2 POINT","SHORT","GOAL","SAVE","BLOCKED"],"s":"AbaCAbbBbAbdBAaBBbAebDCAEAfbEbBADFAbdcCfAdgBgeFbCAgaBa"},{"title":"Knockmore_v_B_al_an_Mhuirthead","teams":["B\u00c9AL AN MHUIRTHEAD","KNOCKMORE"],"o":["WIDE","'45","1 POINT","2 POINT","SHORT","SAVE","BLOCKED","WOODWORK","GOAL"],"s":"aABCcdeFeeGAccEaaEaAeHAaDicDBCEEDaEAcIdIHCaga"},{"title":"Mayo_Gaels_v_Balla","teams":["BALLA","MAYO GAELS"],"o":["WIDE","1 POINT","SHORT","2 POINT","SAVE"],"s":"ABCBABbCADcBbCbAbBBAAABaAbAACbbbbaAbbEBbEacAabCBabb"}];

  /** Cluster copies of the same game: same teams and >= 0.75 shot-sequence similarity.
   *  Keeps the most complete copy (most coordinates, then players, then pressure tags, then latest). */
  function dedupeGames(parsed) {
    const clusters = [];
    const seqs = new Map(parsed.map(g => [g, seqOf(g)]));
    for (const g of parsed) {
      let placed = false;
      for (const c of clusters) {
        if (c[0].teams.join('|') !== g.teams.join('|')) continue;
        if (Math.max(...c.map(h => seqRatio(seqs.get(g), seqs.get(h)))) >= DUP_SIM) { c.push(g); placed = true; break; }
      }
      if (!placed) clusters.push([g]);
    }
    const key = g => [g.nxy, g.nPlayer, g.tagged, g.order];
    const better = (a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] > kb[i]; return false; };
    return clusters.map(c => {
      let best = c[0];
      for (const g of c) if (better(g, best)) best = g;
      return { kept: best, dropped: c.filter(g => g !== best), sims: c.filter(g => g !== best).map(g => seqRatio(seqs.get(g), seqs.get(best))) };
    });
  }

  // ── 2. COORDINATES (features.py) ─────────────────────────────────────────
  function interp(x, xs, ys) {
    if (x <= xs[0]) return ys[0];
    const n = xs.length;
    if (x >= xs[n - 1]) return ys[n - 1];
    for (let i = 1; i < n; i++) if (x <= xs[i]) return ys[i - 1] + (x - xs[i - 1]) * (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[n - 1];
  }
  function depthM(yt) {
    const n = KNOT_Y.length;
    if (yt > KNOT_Y[n - 1]) return KNOT_M[n - 1] + (yt - KNOT_Y[n - 1]) * (KNOT_M[n - 1] - KNOT_M[n - 2]) / (KNOT_Y[n - 1] - KNOT_Y[n - 2]);
    return interp(yt, KNOT_Y, KNOT_M);
  }
  function geometry(xt, yt) {
    const dx = SX * (xt - X0), dy = Math.max(depthM(yt), MIN_DEPTH);
    const dist = Math.hypot(dx, dy);
    let ang = Math.atan2(POST_HALF * 2 * dy, dx * dx + dy * dy - POST_HALF * POST_HALF);
    if (ang < 0) ang += Math.PI;
    return { dist, dx, dy, ang };
  }
  function zoneFromPos(X, Y) {
    const band = Y < 31 ? 0 : Y < 70.2 ? 1 : 2, col = X < 33.3 ? 0 : X < 66.7 ? 1 : 2;
    return 'Zone ' + (band * 3 + col + 1);
  }
  /** Per game: the convention whose implied Shot Zone agrees best with the tagged Shot Zones label. */
  function detectConv(shots) {
    const s = shots.filter(v => v.x != null);
    if (!s.length) return { conv: 'tracker', agreeTracker: 0, agreeRot: 0 };
    let a = 0, b = 0;
    for (const v of s) {
      const z = v.zone == null ? '' : String(v.zone);
      if (zoneFromPos(v.x, v.y) === z) a++;
      if (zoneFromPos(100 - v.y, 100 - v.x) === z) b++;
    }
    a /= s.length; b /= s.length;
    return { conv: b > a ? 'sportscode_rot' : 'tracker', agreeTracker: a, agreeRot: b };
  }

  function rcs(x, t) {
    const k = t.length, nrm = Math.pow(t[k - 1] - t[0], 2), out = [x];
    const p = u => Math.pow(Math.max(u, 0), 3);
    for (let j = 0; j < k - 2; j++) {
      out.push((p(x - t[j]) - p(x - t[k - 2]) * (t[k - 1] - t[j]) / (t[k - 1] - t[k - 2])
        + p(x - t[k - 1]) * (t[k - 2] - t[j]) / (t[k - 1] - t[k - 2])) / nrm);
    }
    return out;
  }

  /** features.build + xplib.load for one shot. Returns null when not modellable (+ reason). */
  function featurize(s, conv, level, gameId) {
    if (s.x == null || s.y == null) return { skip: 'no coordinates' };
    const r = conv === 'sportscode_rot';
    const xt = r ? 100 - s.y : s.x, yt = r ? 100 - s.x : s.y;
    const g = geometry(xt, yt);
    const a = String(s.attempt || '').trim().toUpperCase(), o = String(s.outcome || '').trim().toUpperCase();
    const db = String(s.dbtype || '').toUpperCase();
    let dbt = !s.deadball ? 'open' : /PENALTY/.test(db) ? 'penalty' : /45|65/.test(db) ? '45' : /MARK/.test(db) ? 'mark' : 'free';
    if (a.includes('45 SHOT')) dbt = '45';
    let att = a.startsWith('1 POINT') ? '1pt' : a.startsWith('2 POINT') ? '2pt' : a.startsWith('GOAL') ? 'goal' : '';
    if (a === "'45 SHOT") att = '1pt';
    if (a === 'FREE KICK') att = g.dist > 40.5 ? '2pt' : '1pt';
    if (!att) return { skip: a ? 'unrecognised Shot Attempts "' + s.attempt + '"' : 'no Shot Attempts label' };
    const pts = o === 'GOAL' ? 3 : o === '2 POINT' ? 2 : o === '1 POINT' ? 1 : 0;
    const pr = String(s.pressure || '').toUpperCase();
    const press = pr.startsWith('HIGH') ? 'high' : pr.startsWith('MED') ? 'medium' : pr.startsWith('LOW') ? 'low' : 'missing';
    return {
      game_id: gameId, team: s.team, level, conv, zone: s.zone == null ? '' : String(s.zone),
      xt, yt, dist: g.dist, dx: g.dx, dy: g.dy, ang: g.ang,
      dbt, dbt2: dbt === 'mark' ? 'free' : dbt, att, pts, scored: pts > 0 ? 1 : 0, goal: o === 'GOAL' ? 1 : 0,
      press, value: att === '2pt' ? 2 : att === 'goal' ? 3 : 1, player: s.player || null,
      isPt: att === '1pt' || att === '2pt', isPen: att === 'goal' && dbt === 'penalty', isGa: att === 'goal' && dbt !== 'penalty'
    };
  }
  function pointRow(f) {
    const s = rcs(f.dist, DIST_KNOTS);
    return [s[0], s[1], s[2], Math.log(f.ang), f.dbt2 === 'free' ? 1 : 0, f.dbt2 === '45' ? 1 : 0,
            f.dbt2 === 'free' ? f.dist : 0, f.press === 'high' ? 1 : 0, f.press === 'missing' ? 1 : 0];
  }

  /** Games -> modelling dataset. opts.levelOf(game) overrides the level rule. */
  function buildDataset(games, opts) {
    opts = opts || {};
    const parsed = games.map((g, i) => parseGame(Object.assign({ order: i }, g)));
    const excludedGames = parsed.filter(g => g.excluded).map(g => ({ id: g.id, title: g.title, date: g.date, reason: g.excluded }));
    const cand = parsed.filter(g => !g.excluded);
    const clusters = opts.noDedupe ? cand.map(g => ({ kept: g, dropped: [], sims: [] })) : dedupeGames(cand);
    const rows = [], gamesOut = [], skipped = {};
    for (const c of clusters) {
      const g = c.kept;
      // Level: club section → club; otherwise county when both teams are counties (parse.py rule).
      const level = opts.levelOf ? opts.levelOf(g) :
        (g.section === 'club' ? 'club' : (g.teams.every(t => COUNTIES.has(t)) ? 'county' : 'club'));
      const cv = opts.convOf ? { conv: opts.convOf(g) } : detectConv(g.shots);
      let used = 0;
      for (const s of g.shots) {
        const f = featurize(s, cv.conv, level, g.id);
        if (f.skip) { skipped[f.skip] = (skipped[f.skip] || 0) + 1; continue; }
        f.px = f.isPt ? pointRow(f) : null;
        rows.push(f); used++;
      }
      gamesOut.push({ id: g.id, title: g.title, date: g.date, teams: g.teams, level, section: g.section,
        conv: cv.conv, agreeTracker: cv.agreeTracker, agreeRot: cv.agreeRot, shots: g.n, nxy: g.nxy, used,
        dupWithin: g.dupWithin, fp: fingerprint(g), dropped: c.dropped.map((d, i) => ({ id: d.id, title: d.title, date: d.date, nxy: d.nxy, n: d.n, sim: c.sims[i] })) });
    }
    const n = a => rows.filter(a).length;
    const summary = {
      gamesFetched: games.length, gamesExcluded: excludedGames.length, duplicatesDropped: gamesOut.reduce((t, g) => t + g.dropped.length, 0),
      uniqueGames: gamesOut.length, countyGames: gamesOut.filter(g => g.level === 'county').length, clubGames: gamesOut.filter(g => g.level === 'club').length,
      shots: rows.length, pointAttempts: n(r => r.isPt), goalAttempts: n(r => r.att === 'goal'), penalties: n(r => r.dbt === 'penalty'),
      countyShots: n(r => r.level === 'county'), clubShots: n(r => r.level === 'club'),
      shotsSkipped: skipped, dupInstancesRemoved: gamesOut.reduce((t, g) => t + g.dupWithin, 0),
      convCounts: { tracker: gamesOut.filter(g => g.conv === 'tracker').length, sportscode_rot: gamesOut.filter(g => g.conv === 'sportscode_rot').length }
    };
    return { rows, games: gamesOut, excludedGames, summary };
  }

  // ── 3. RIDGE LOGISTIC (xplib.fit_logit) ──────────────────────────────────
  function solve(A, b) {               // Gaussian elimination, partial pivoting
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
      const d = M[c][c];
      if (d === 0) throw new Error('singular Hessian');
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / d; if (!f) continue;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    return x;
  }
  /** X: array of rows (length p, may be 0); y: 0/1. Returns [b0, b(raw scale)]. */
  function fitLogit(X, y, lam, iters) {
    iters = iters || 100;
    const n = y.length, p = n ? X[0].length : 0;
    const mu = new Array(p).fill(0), sd = new Array(p).fill(0);
    for (const r of X) for (let j = 0; j < p; j++) mu[j] += r[j];
    for (let j = 0; j < p; j++) mu[j] /= n;
    for (const r of X) for (let j = 0; j < p; j++) sd[j] += (r[j] - mu[j]) ** 2;
    for (let j = 0; j < p; j++) { sd[j] = Math.sqrt(sd[j] / n); if (sd[j] === 0) sd[j] = 1; }
    const Z = X.map(r => { const z = [1]; for (let j = 0; j < p; j++) z.push((r[j] - mu[j]) / sd[j]); return z; });
    const ym = y.reduce((a, v) => a + v, 0) / n;
    const b = new Array(p + 1).fill(0); b[0] = Math.log((ym + 1e-3) / (1 - ym + 1e-3));
    for (let it = 0; it < iters; it++) {
      const g = new Array(p + 1).fill(0), H = Array.from({ length: p + 1 }, () => new Array(p + 1).fill(0));
      for (let i = 0; i < n; i++) {
        const z = Z[i]; let eta = 0;
        for (let j = 0; j <= p; j++) eta += z[j] * b[j];
        const pr = 1 / (1 + Math.exp(-eta)), w = pr * (1 - pr), res = y[i] - pr;
        for (let j = 0; j <= p; j++) { g[j] += z[j] * res; const wz = w * z[j]; for (let k = 0; k <= p; k++) H[j][k] += wz * z[k]; }
      }
      for (let j = 1; j <= p; j++) { g[j] -= lam * b[j]; H[j][j] += lam; }
      const step = solve(H, g);
      let mx = 0;
      for (let j = 0; j <= p; j++) { b[j] += step[j]; mx = Math.max(mx, Math.abs(step[j])); }
      if (mx < 1e-10) break;
    }
    const braw = [], b0 = b[0] - b.slice(1).reduce((a, v, j) => a + (v / sd[j]) * mu[j], 0);
    for (let j = 0; j < p; j++) braw.push(b[j + 1] / sd[j]);
    return [b0, braw];
  }
  const predictLogit = (fit, x) => { let e = fit[0]; for (let j = 0; j < x.length; j++) e += fit[1][j] * x[j]; return sigmoid(e); };

  // ── 4. FIT + PREDICT (final.py fit_all / predict) ────────────────────────
  function fitAll(rows, train) {
    const tr = train || rows.map(() => true);
    const P = rows.filter((r, i) => tr[i] && r.isPt), G = rows.filter((r, i) => tr[i] && r.isGa);
    const M = {};
    M.p = fitLogit(P.map(r => r.px), P.map(r => r.scored), LAMP);
    M.g = fitLogit(G.map(r => [Math.log(r.dist)]), G.map(r => r.goal), LAMG);
    const G0 = G.filter(r => r.goal === 0);
    M.pt = fitLogit(G0.map(() => []), G0.map(r => r.pts > 0 ? 1 : 0), LAMPT);
    const Pen = rows.filter((r, i) => tr[i] && r.isPen), n = Pen.length;
    const gg = Pen.filter(r => r.goal === 1).length, pp = Pen.filter(r => r.goal === 0 && r.pts > 0).length;
    M.pen = { n, goals: gg, points: pp, p_goal: (gg + PEN_PRIOR) / (n + 3 * PEN_PRIOR), p_point: (pp + PEN_PRIOR) / (n + 3 * PEN_PRIOR) };
    M.p_names = P_NAMES.slice();
    return M;
  }
  /** -> per-row {p, xp, pg, ppt} from a fitted M. */
  function predictRow(M, r) {
    if (r.isPt) { const p = predictLogit(M.p, r.px); return { p, xp: p * (r.att === '2pt' ? 2 : 1), pg: 0, ppt: 0 }; }
    let pg, ppt;
    if (r.isPen) { pg = M.pen.p_goal; ppt = M.pen.p_point; }
    else { pg = predictLogit(M.g, [Math.log(r.dist)]); ppt = (1 - pg) * sigmoid(M.pt[0]); }
    return { p: pg + ppt, xp: 3 * pg + ppt, pg, ppt };
  }
  /** Model JSON (xp_model.json schema) -> M usable by predictRow. */
  function fromModelJson(J) {
    const P = J.point_attempt_model, G = J.goal_attempt_model;
    const knots = P.dist_knots || DIST_KNOTS;
    const same = knots.length === DIST_KNOTS.length && knots.every((k, i) => k === DIST_KNOTS[i]);
    const names = Object.keys(P.coefficients);
    return {
      p: [P.intercept, P_NAMES.map(k => P.coefficients[k] || 0)],
      g: [G.p_goal.intercept, [G.p_goal.coef_log_dist]],
      pt: [G.p_point_given_no_goal.intercept, []],
      pen: { p_goal: J.penalty.p_goal, p_point: J.penalty.p_point },
      compatible: same && names.every(k => P_NAMES.includes(k))
    };
  }

  // ── 5. CROSS-VALIDATION + METRICS (final.py / evaluate.py) ───────────────
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  /** Grouped folds stratified by level (xplib.game_folds; JS RNG, not numpy's). */
  function gameFolds(rows, k, seed) {
    const byLevel = {};
    for (const r of rows) { (byLevel[r.level] = byLevel[r.level] || []); if (!byLevel[r.level].includes(r.game_id)) byLevel[r.level].push(r.game_id); }
    const rnd = mulberry32((seed || 0) + 1), f = {};
    for (const lev of Object.keys(byLevel).sort()) {
      const gs = byLevel[lev].slice();
      for (let i = gs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = gs[i]; gs[i] = gs[j]; gs[j] = t; }
      gs.forEach((g, i) => { f[g] = i % k; });
    }
    return f;
  }
  const clip = p => Math.min(Math.max(p, 1e-12), 1 - 1e-12);
  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
  function corr(a, b) {
    const ma = mean(a), mb = mean(b); let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return sab / Math.sqrt(saa * sbb);
  }
  const binLL = (y, p) => mean(y.map((v, i) => { const q = clip(p[i]); return -(v * Math.log(q) + (1 - v) * Math.log(1 - q)); }));
  const binBrier = (y, p) => mean(y.map((v, i) => (p[i] - v) ** 2));
  const cls3 = r => r.goal === 1 ? 0 : r.pts > 0 ? 1 : 2;
  function mc3(rows, P3) {
    let ll = 0, br = 0;
    rows.forEach((r, i) => {
      const c = cls3(r), q = P3[i].map(v => Math.min(Math.max(v, 1e-12), 1));
      ll += -Math.log(q[c]); br += q.reduce((s, v, j) => s + (v - (j === c ? 1 : 0)) ** 2, 0);
    });
    return { logloss: ll / rows.length, brier: br / rows.length };
  }

  /** Baseline predictions for held-out rows (final.py + evaluate.py). */
  function baselines(rows, trainIdx, testIdx) {
    const T = trainIdx.map(i => rows[i]);
    const r = {}, rs = {}, cnt = {};
    for (const t of T) { cnt[t.att] = (cnt[t.att] || 0) + 1; r[t.att] = (r[t.att] || 0) + t.pts; rs[t.att] = (rs[t.att] || 0) + t.scored; }
    for (const a in cnt) { r[a] /= cnt[a]; rs[a] /= cnt[a]; }
    const zk = t => (t.zone || 'NA') + '\u0001' + t.att, Z = {};
    for (const t of T) { const k = zk(t); const z = Z[k] || (Z[k] = { s: 0, sc: 0, n: 0 }); z.s += t.pts; z.sc += t.scored; z.n++; }
    // goal attempts (incl. penalties), 3-class: overall rates and zone table (empty zone matches nothing)
    const TG = T.filter(t => t.att === 'goal');
    const g0 = mean(TG.map(t => t.goal === 1 ? 1 : 0)), p0 = mean(TG.map(t => t.goal === 0 && t.pts > 0 ? 1 : 0));
    const GZ = {};
    for (const t of TG) { if (!t.zone) continue; const z = GZ[t.zone] || (GZ[t.zone] = { g: 0, p: 0, n: 0 }); z.n++; if (t.goal === 1) z.g++; else if (t.pts > 0) z.p++; }
    const out = {};
    for (const i of testIdx) {
      const t = rows[i], z = Z[zk(t)];
      const o = { xpA: r[t.att], pA: rs[t.att], xpZ: z ? (z.s + 2 * r[t.att]) / (z.n + 2) : r[t.att], pZ: z ? (z.sc + 2 * rs[t.att]) / (z.n + 2) : rs[t.att] };
      if (t.att === 'goal') {
        o.g3A = [g0, p0, 1 - g0 - p0];
        const gz = t.zone ? GZ[t.zone] : null, n = gz ? gz.n : 0;
        const g = ((gz ? gz.g : 0) + 2 * g0) / (n + 2), p = ((gz ? gz.p : 0) + 2 * p0) / (n + 2);
        o.g3Z = [g, p, 1 - g - p];
      }
      out[i] = o;
    }
    return out;
  }

  /** Metrics for one set of per-row predictions (pred[i] = {p, xp, pg, ppt}). */
  function metricsFor(rows, pred, base) {
    const idx = rows.map((_, i) => i);
    const pt = idx.filter(i => rows[i].isPt), ga = idx.filter(i => rows[i].att === 'goal');
    const y = pt.map(i => rows[i].scored);
    const point = { n: pt.length, logloss: binLL(y, pt.map(i => pred[i].p)), brier: binBrier(y, pt.map(i => pred[i].p)), byAtt: {} };
    for (const a of ['1pt', '2pt']) {
      const s = pt.filter(i => rows[i].att === a);
      point.byAtt[a] = { n: s.length, logloss: binLL(s.map(i => rows[i].scored), s.map(i => pred[i].p)) };
    }
    const gRows = ga.map(i => rows[i]);
    const goal = Object.assign({ n: ga.length }, mc3(gRows, ga.map(i => [pred[i].pg, pred[i].ppt, 1 - pred[i].pg - pred[i].ppt])));
    // headline: mean -log P(observed class) over ALL shots (binary for point attempts, 3-class for goal attempts)
    const all = (point.logloss * point.n + goal.logloss * goal.n) / (point.n + goal.n);
    const mse = mean(idx.map(i => (pred[i].xp - rows[i].pts) ** 2));
    // calibration: deciles of xP, pandas qcut(rank(method='first'), 10)
    const order = idx.slice().sort((a, b) => (pred[a].xp - pred[b].xp) || (a - b));
    const n = idx.length, dec = new Array(n);
    order.forEach((i, r) => { const rk = r + 1; let d = 0; for (let k = 1; k <= 10; k++) if (rk > 1 + (n - 1) * k / 10) d = k; dec[i] = Math.min(d, 9); });
    const calibration = [];
    for (let d = 0; d < 10; d++) {
      const s = idx.filter(i => dec[i] === d);
      calibration.push({ decile: d + 1, n: s.length, meanXp: mean(s.map(i => pred[i].xp)), meanActual: mean(s.map(i => rows[i].pts)),
        sumXp: s.reduce((t, i) => t + pred[i].xp, 0), sumActual: s.reduce((t, i) => t + rows[i].pts, 0) });
    }
    const totals = { all: { xp: 0, actual: 0, n: 0 } };
    for (const i of idx) {
      for (const k of ['all', 'att:' + rows[i].att, 'level:' + rows[i].level, 'dbt:' + rows[i].dbt]) {
        const t = totals[k] || (totals[k] = { xp: 0, actual: 0, n: 0 }); t.xp += pred[i].xp; t.actual += rows[i].pts; t.n++;
      }
    }
    // team-game aggregates
    const tg = new Map();
    idx.forEach(i => {
      const r = rows[i], k = r.game_id + '\u0001' + r.team;
      const a = tg.get(k) || { game_id: r.game_id, team: r.team, level: r.level, shots: 0, actual: 0, xp: 0, xpA: 0, xpZ: 0 };
      a.shots++; a.actual += r.pts; a.xp += pred[i].xp; if (base) { a.xpA += base[i].xpA; a.xpZ += base[i].xpZ; }
      tg.set(k, a);
    });
    const agg = Array.from(tg.values()), act = agg.map(a => a.actual);
    const tgm = c => ({ corr: corr(agg.map(a => a[c]), act), mae: mean(agg.map(a => Math.abs(a[c] - a.actual))), bias: mean(agg.map(a => a[c] - a.actual)) });
    const teamGame = { n: agg.length, model: tgm('xp') };
    const out = { point, goal, allShotsLogloss: all, mse, calibration, totals, teamGame };
    if (base) {
      const yb = k => pt.map(i => base[i][k]);
      out.baselines = {
        pointAtt: { logloss: binLL(y, yb('pA')), brier: binBrier(y, yb('pA')) },
        pointZone: { logloss: binLL(y, yb('pZ')), brier: binBrier(y, yb('pZ')) },
        goalRate: mc3(gRows, ga.map(i => base[i].g3A)),
        goalZone: mc3(gRows, ga.map(i => base[i].g3Z)),
        mseAtt: mean(idx.map(i => (base[i].xpA - rows[i].pts) ** 2)),
        mseZone: mean(idx.map(i => (base[i].xpZ - rows[i].pts) ** 2)),
        teamGameAtt: tgm('xpA'), teamGameZone: tgm('xpZ'),
        teamGameShotsCorr: corr(agg.map(a => a.shots), act)
      };
    }
    return out;
  }

  /**
   * Grouped leave-games-out K-fold CV. NEW = refit on the training folds; CURRENT = the
   * published model JSON scored on the same held-out shots (fixed coefficients).
   * opts: {k:5, seed:0, folds:{game_id:fold} (inject, e.g. Python's), current: modelJson,
   *        currentTraining: [fingerprints|{id}] of the games CURRENT was fitted on (optional; adds a fair
   *        comparison on games CURRENT never saw — on the others CURRENT's score is in-sample, i.e. optimistic)}
   */
  function crossValidate(ds, opts) {
    opts = opts || {};
    const rows = ds.rows, k = opts.k || 5;
    const folds = opts.folds || gameFolds(rows, k, opts.seed || 0);
    const f = rows.map(r => folds[r.game_id]);
    const oof = new Array(rows.length), base = new Array(rows.length);
    const perFold = [];
    for (let j = 0; j < k; j++) {
      const tr = f.map(v => v !== j), te = [], trI = [];
      f.forEach((v, i) => (v === j ? te : trI).push(i));
      if (!te.length) continue;
      const M = fitAll(rows, tr);
      for (const i of te) oof[i] = predictRow(M, rows[i]);
      Object.assign(base, baselines(rows, trI, te));
      perFold.push({ fold: j, games: new Set(te.map(i => rows[i].game_id)).size, shots: te.length });
    }
    const res = { k, folds, perFold, oof, base, new: metricsFor(rows, oof, base) };
    if (opts.current) {
      const C = fromModelJson(opts.current);
      const cur = rows.map(r => predictRow(C, r));
      res.currentPred = cur;
      res.current = metricsFor(rows, cur, base);
      res.currentCompatible = C.compatible;
      if (opts.currentTraining && opts.currentTraining.length) {
        const seen = trainedGameIds(ds, opts.currentTraining);
        const keep = rows.map((r, i) => i).filter(i => !seen.has(rows[i].game_id));
        res.currentSeenGames = seen.size;
        res.unseen = { games: new Set(keep.map(i => rows[i].game_id)).size, shots: keep.length };
        if (keep.length) {
          const sub = keep.map(i => rows[i]);
          res.unseen.new = metricsFor(sub, keep.map(i => oof[i]));
          res.unseen.current = metricsFor(sub, keep.map(i => cur[i]));
        }
      }
      res.verdict = verdict(res);
    }
    return res;
  }

  /** Plain-language recommendation. Fair basis = games CURRENT never saw (when its training games are
   *  known); otherwise all games, where CURRENT's score is partly in-sample (the verdict says so). */
  const MIN_UNSEEN_SHOTS = 150;
  function verdict(res) {
    let n = res.new, c = res.current, basis = 'all', pre = '', post = '';
    if (res.unseen) {
      if (res.unseen.shots < MIN_UNSEEN_SHOTS) {
        return { recommend: false, relImprovement: null, basis: 'unseen',
          text: (res.unseen.games ? 'Only ' + res.unseen.games + ' game' + (res.unseen.games === 1 ? '' : 's') + ' (' + res.unseen.shots + ' shots) ' : 'No games ') +
            'are new since the current model was fitted — too little new data to show a real improvement. Keep current and refit after more games.' };
      }
      n = res.unseen.new; c = res.unseen.current; basis = 'unseen';
      pre = 'On the ' + res.unseen.games + ' games the current model has never seen, the new model ';
    } else {
      pre = 'New model ';
      post = ' (the current model may have been trained on some of these games, which flatters it)';
    }
    const rel = (c.allShotsLogloss - n.allShotsLogloss) / c.allShotsLogloss;
    const pct = Math.abs(rel * 100).toFixed(1);
    const maeWorse = n.teamGame.n >= 10 ? n.teamGame.model.mae - c.teamGame.model.mae : 0;
    let recommend = false, text;
    if (rel >= 0.01 && maeWorse <= 0.1) { recommend = true; text = pre + 'predicts held-out games ' + pct + '% better — recommended to publish.'; }
    else if (rel >= 0.01) text = pre + 'scores shots ' + pct + '% better but team-game totals get worse (MAE +' + maeWorse.toFixed(2) + ') — keep current.';
    else if (rel > -0.01) text = 'No meaningful improvement (' + pct + '% ' + (rel >= 0 ? 'better' : 'worse') + ')' + post + ' — keep current.';
    else text = pre + 'predicts held-out games ' + pct + '% worse' + post + ' — keep current.';
    return { recommend, relImprovement: rel, basis, text };
  }

  // ── 6. MODEL JSON (export_json.py schema) ────────────────────────────────
  function nextVersion(v) {
    const m = /^(\d+)\.(\d+)/.exec(String(v || '1.0.0'));
    return m ? m[1] + '.' + (Number(m[2]) + 1) + '.0' : '1.1.0';
  }
  function toModelJson(M, ds, opts) {
    opts = opts || {};
    const rows = ds.rows, g = ds.games;
    const co = {}; P_NAMES.forEach((k, i) => { co[k] = M.p[1][i]; });
    const n2 = rows.filter(r => r.att === '2pt').length, n2one = rows.filter(r => r.att === '2pt' && r.pts === 1).length;
    const n2goal = rows.filter(r => r.isPt && r.pts === 3).length;
    const nMark = rows.filter(r => r.dbt === 'mark').length;
    return {
      name: 'COHESION Gaelic football expected points (xP)', version: opts.version || '1.1.0',
      created: opts.created || new Date().toISOString().slice(0, 10),
      training_data: {
        unique_games: g.length, county_games: g.filter(x => x.level === 'county').length, club_games: g.filter(x => x.level === 'club').length,
        shots: rows.length, point_attempts: rows.filter(r => r.isPt).length, goal_attempts: rows.filter(r => r.att === 'goal').length,
        penalties: rows.filter(r => r.dbt === 'penalty').length
      },
      coordinates: {
        canonical_frame: 'Match Tracker half-pitch image (Half Pitch.jpg 1250x932). Xt = % across the image from the left touchline edge, Yt = % down the image from the goal end (end line at Yt=1.4). Home team uses X-Shot/Y-Shot, away team X-Shot_away/Y-Shot_away; both are tagged on the same attacking-half image, no mirroring.',
        conventions: {
          tracker: 'Xt = X-label, Yt = Y-label (GAA Score Tracker exports, Mayo club XMLs, DUB_v_GAL/DUB_v_KER).',
          sportscode_rot: 'Mayo Sportscode timelines (NFL Timelines/*, Senior Challenge files): X-label = 100 - depth%, Y-label = 100 - lateral%, i.e. goal at X=100. Xt = 100 - Y-label, Yt = 100 - X-label (same mapping as mayo-dashboard.html renderShotMap).'
        },
        convention_detection: "Per game, the convention whose implied Shot Zone (tracker shotZoneFromPos bands Yt<31, <70.2; thirds of Xt) agrees best with the tagged 'Shot Zones' label.",
        depth_knots_Yt: KNOT_Y.slice(), depth_knots_m: KNOT_M.slice(),
        depth_extrapolation: 'linear beyond the last knot with the slope of the last segment',
        metres_per_Xt: SX, goal_centre_Xt: X0, min_depth_m: MIN_DEPTH, post_half_width_m: POST_HALF,
        distance: 'sqrt(dx^2 + dy^2), dx = metres_per_Xt*(Xt-50), dy = max(depth_m(Yt),0.5)',
        goalmouth_angle: 'angle subtended by the posts (6.5 m apart): atan2(2*h*dy, dx^2+dy^2-h^2) with h=3.25, +pi if negative (radians)',
        note: "On this scale the drawn 40m arc sits at ~41.8 m (the drawing's arc is ~4% large relative to its 13/20/45 m lines); tagged 1pt/2pt attempts split exactly on the drawn arc."
      },
      point_attempt_model: {
        applies_to: "Shot Attempts = 1 Point Attempt or 2 Point Attempt (open play and dead ball, incl. frees, marks and '45s)",
        target: 'P(score) = P(outcome is 1 POINT, 2 POINT or GOAL)',
        xp: 'P(score) * value, value = 2 for a 2 Point Attempt else 1',
        simplification: (n2one === 0 ? 'In the training data no 2-point attempt scored only 1 point (0/' + n2 + '), so P(score full value) is modelled directly; '
          : 'In the training data ' + n2one + '/' + n2 + ' 2-point attempts scored only 1 point; P(score) is still modelled directly with value 2; ') + n2goal + ' point attempts that went in as goals are counted as scores.',
        form: 'logistic: eta = intercept + sum(coef_i * feature_i); p = 1/(1+exp(-eta))',
        intercept: M.p[0], coefficients: co,
        features: {
          dist: 'distance to goal centre, metres',
          'dist_rcs1, dist_rcs2': 'restricted cubic spline terms of dist (Harrell form) with knots below: ((d-t_j)+^3 - (d-t_{k-1})+^3 (t_k-t_j)/(t_k-t_{k-1}) + (d-t_k)+^3 (t_{k-1}-t_j)/(t_k-t_{k-1})) / (t_k-t_1)^2',
          log_goalmouth_angle: 'natural log of the goal-mouth angle (radians)',
          db_free: '1 if dead-ball FREE KICK or MARK (marks pooled with frees, n=' + nMark + '), also dead-ball shots with no type',
          db_45: "1 if '45 (Deadball Shot Type '45 / '45 SHOT / 65M)",
          db_free_x_dist: 'db_free * dist',
          press_high: '1 if Shot Pressure = High Pressure (reference: Low or Medium)',
          press_missing: '1 if Shot Pressure not tagged'
        },
        dist_knots: DIST_KNOTS.slice(), ridge_lambda_standardised: LAMP
      },
      goal_attempt_model: {
        applies_to: 'Shot Attempts = Goal Attempt, not a penalty',
        p_goal: { form: 'logistic on log(dist)', intercept: M.g[0], coef_log_dist: M.g[1][0] },
        p_point_given_no_goal: { form: 'constant (logistic intercept)', intercept: M.pt[0], value: sigmoid(M.pt[0]) },
        xp: '3*P(goal) + 1*(1-P(goal))*P(point|no goal)', ridge_lambda_standardised: LAMG
      },
      penalty: {
        method: 'smoothed empirical (Jeffreys-style +0.5 per outcome class: goal/point/no score)',
        n: M.pen.n, goals: M.pen.goals, points: M.pen.points, p_goal: M.pen.p_goal, p_point: M.pen.p_point,
        xp: 3 * M.pen.p_goal + M.pen.p_point, flag: 'n=' + M.pen.n + ' only; treat penalty xP as provisional'
      },
      attempt_inference: {
        "'45 SHOT (in Shot Attempts)": "1 Point Attempt, dead-ball '45",
        'FREE KICK (in Shot Attempts)': 'dead-ball free; 2 Point Attempt if dist > 40.5 m else 1 Point Attempt',
        'other/missing': 'not scored (return null)'
      },
      level: 'Not used: club/county indicator gave no held-out improvement (CV log-loss 0.6037 v 0.6033 without). Parameter kept in the API for a future refit.',
      excluded_features: ["Shooting Leg / Shot Side (no held-out gain; club-only tags; 'No Leg (Hand Pass Score)' is outcome-dependent)",
                          'is_2pt_attempt flag (no gain once distance spline present)']
    };
  }

  /** Compact, storable validation summary (what publishXpModel saves alongside the model). */
  function validationSummary(cv) {
    const pick = m => m && ({ allShotsLogloss: m.allShotsLogloss, point: { n: m.point.n, logloss: m.point.logloss, brier: m.point.brier },
      goal: m.goal, mse: m.mse, teamGame: m.teamGame, calibration: m.calibration.map(c => ({ decile: c.decile, n: c.n, meanXp: c.meanXp, meanActual: c.meanActual })),
      seasonXp: m.totals.all.xp, seasonActual: m.totals.all.actual });
    return { k: cv.k, new: pick(cv.new), current: pick(cv.current), baselines: cv.new.baselines,
      unseen: cv.unseen ? { games: cv.unseen.games, shots: cv.unseen.shots, new: pick(cv.unseen.new), current: pick(cv.unseen.current) } : null,
      verdict: cv.verdict || null };
  }

  const api = { parseGame, seqRatio, dedupeGames, detectConv, featurize, buildDataset, fitLogit, fitAll, predictRow,
    fromModelJson, gameFolds, fingerprint, trainedGameIds, V1_TRAINING, crossValidate, metricsFor, verdict, nextVersion, toModelJson, validationSummary,
    P_NAMES, COUNTIES, SHOT_RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CohesionXpFit = api;
})(typeof window !== 'undefined' ? window : globalThis);
