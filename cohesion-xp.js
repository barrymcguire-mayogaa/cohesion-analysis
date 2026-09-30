/* cohesion-xp.js — COHESION expected points (xP).
 *
 * Scoring:  xpForShot(labels, 'home'|'away', level, {conv, deadball}) -> {p, xp, parts} | null
 * Model:    the PUBLISHED model (admin "Refit xP model", stored server-side) when
 *           available, else the bundled v1 below (fitted Sep 2026 on 45 games /
 *           2,546 shots, validated leave-games-out). Always await cohesionXpReady()
 *           before scoring; window.XP_MODEL.version identifies the model in use.
 * Coordinates: 'tracker' (goal at top, X = lateral %) or 'sportscode_rot'
 *           (older Mayo Sportscode timelines, rotated 90°) — see cohesionXpDetectConv.
 */
window.XP_MODEL_BUNDLED = {"name":"COHESION Gaelic football expected points (xP)","version":"1.0.0","created":"2026-09-30","training_data":{"unique_games":45,"county_games":19,"club_games":26,"shots":2546,"point_attempts":2249,"goal_attempts":297,"penalties":16},"coordinates":{"canonical_frame":"Match Tracker half-pitch image (Half Pitch.jpg 1250x932). Xt = % across the image from the left touchline edge, Yt = % down the image from the goal end (end line at Yt=1.4). Home team uses X-Shot/Y-Shot, away team X-Shot_away/Y-Shot_away; both are tagged on the same attacking-half image, no mirroring.","conventions":{"tracker":"Xt = X-label, Yt = Y-label (GAA Score Tracker exports, Mayo club XMLs, DUB_v_GAL/DUB_v_KER).","sportscode_rot":"Mayo Sportscode timelines (NFL Timelines/*, Senior Challenge files): X-label = 100 - depth%, Y-label = 100 - lateral%, i.e. goal at X=100. Xt = 100 - Y-label, Yt = 100 - X-label (same mapping as mayo-dashboard.html renderShotMap)."},"convention_detection":"Per game, the convention whose implied Shot Zone (tracker shotZoneFromPos bands Yt<31, <70.2; thirds of Xt) agrees best with the tagged 'Shot Zones' label.","depth_knots_Yt":[1.4,21.0,31.0,70.2],"depth_knots_m":[0.0,13.0,20.0,45.0],"depth_extrapolation":"linear beyond the last knot with the slope of the last segment","metres_per_Xt":0.878,"goal_centre_Xt":50.0,"min_depth_m":0.5,"post_half_width_m":3.25,"distance":"sqrt(dx^2 + dy^2), dx = metres_per_Xt*(Xt-50), dy = max(depth_m(Yt),0.5)","goalmouth_angle":"angle subtended by the posts (6.5 m apart): atan2(2*h*dy, dx^2+dy^2-h^2) with h=3.25, +pi if negative (radians)","note":"On this scale the drawn 40m arc sits at ~41.8 m (the drawing's arc is ~4% large relative to its 13/20/45 m lines); tagged 1pt/2pt attempts split exactly on the drawn arc."},"point_attempt_model":{"applies_to":"Shot Attempts = 1 Point Attempt or 2 Point Attempt (open play and dead ball, incl. frees, marks and '45s)","target":"P(score) = P(outcome is 1 POINT, 2 POINT or GOAL)","xp":"P(score) * value, value = 2 for a 2 Point Attempt else 1","simplification":"In the training data no 2-point attempt scored only 1 point (0/693), so P(score full value) is modelled directly; 4 point attempts that went in as goals are counted as scores.","form":"logistic: eta = intercept + sum(coef_i * feature_i); p = 1/(1+exp(-eta))","intercept":3.7427712403551743,"coefficients":{"dist":-0.05187114614894701,"dist_rcs1":-0.05107168464799867,"dist_rcs2":0.2543091705177597,"log_goalmouth_angle":0.8199320074687559,"db_free":2.605130358925806,"db_45":0.46459220110932264,"db_free_x_dist":-0.048793798815786625,"press_high":-0.5687026547992199,"press_missing":-0.13012164441856297},"features":{"dist":"distance to goal centre, metres","dist_rcs1, dist_rcs2":"restricted cubic spline terms of dist (Harrell form) with knots below: ((d-t_j)+^3 - (d-t_{k-1})+^3 (t_k-t_j)/(t_k-t_{k-1}) + (d-t_k)+^3 (t_{k-1}-t_j)/(t_k-t_{k-1})) / (t_k-t_1)^2","log_goalmouth_angle":"natural log of the goal-mouth angle (radians)","db_free":"1 if dead-ball FREE KICK or MARK (marks pooled with frees, n=8), also dead-ball shots with no type","db_45":"1 if '45 (Deadball Shot Type '45 / '45 SHOT / 65M)","db_free_x_dist":"db_free * dist","press_high":"1 if Shot Pressure = High Pressure (reference: Low or Medium)","press_missing":"1 if Shot Pressure not tagged"},"dist_knots":[15,28,38,50],"ridge_lambda_standardised":1.0},"goal_attempt_model":{"applies_to":"Shot Attempts = Goal Attempt, not a penalty","p_goal":{"form":"logistic on log(dist)","intercept":2.184054886732059,"coef_log_dist":-1.2231630094209947},"p_point_given_no_goal":{"form":"constant (logistic intercept)","intercept":-1.7429693050586232,"value":0.14893617021276592},"xp":"3*P(goal) + 1*(1-P(goal))*P(point|no goal)","ridge_lambda_standardised":3.0},"penalty":{"method":"smoothed empirical (Jeffreys-style +0.5 per outcome class: goal/point/no score)","n":16,"goals":7,"points":1,"p_goal":0.42857142857142855,"p_point":0.08571428571428572,"xp":1.3714285714285712,"flag":"n=16 only; treat penalty xP as provisional"},"attempt_inference":{"'45 SHOT (in Shot Attempts)":"1 Point Attempt, dead-ball '45","FREE KICK (in Shot Attempts)":"dead-ball free; 2 Point Attempt if dist > 40.5 m else 1 Point Attempt","other/missing":"not scored (return null)"},"level":"Not used: club/county indicator gave no held-out improvement (CV log-loss 0.6037 v 0.6033 without). Parameter kept in the API for a future refit.","excluded_features":["Shooting Leg / Shot Side (no held-out gain; club-only tags; 'No Leg (Hand Pass Score)' is outcome-dependent)","is_2pt_attempt flag (no gain once distance spline present)"]};
window.XP_MODEL = window.XP_MODEL_BUNDLED;
/* COHESION Gaelic football expected points (xP) — pure JS scorer.
 * Model definition lives in xp_model.json (coefficients, knots, coordinate mapping).
 *
 *   xpForShot(labels, teamSide, level, opts) -> {p, xp, parts} | null
 *
 * labels   : object of Sportscode label groups -> text for ONE shot instance, e.g.
 *            {'Shot Attempts':'1 Point Attempt','Shot Outcomes':'WIDE','X-Shot':'62','Y-Shot':'30',
 *             'Deadball Shot Type':'FREE KICK','Shot Pressure':'High Pressure'}  (group names case-insensitive)
 * teamSide : 'home' (reads X-Shot/Y-Shot) or 'away' (reads X-Shot_away/Y-Shot_away); falls back to whichever pair exists
 * level    : 'club' | 'county' — accepted for the API; model v1 has no level term (no held-out gain)
 * opts     : {conv:'tracker'|'sportscode_rot' (default 'tracker'),
 *             deadball: true/false (from the code "... SHOT DEADBALL"; default = Deadball Shot Type label present),
 *             model: model JSON (default: xpForShot.model / window.XP_MODEL / require('./xp_model.json'))}
 * Returns null when the shot has no usable coordinates or attempt type.
 */
(function (root) {
  'use strict';

  function lab(labels, name) {
    const want = name.toLowerCase();
    for (const k in labels) if (k.trim().toLowerCase() === want) return String(labels[k] == null ? '' : labels[k]).trim();
    return '';
  }

  function interp(x, xs, ys) { // numpy.interp semantics (clamped at ends)
    if (x <= xs[0]) return ys[0];
    const n = xs.length;
    if (x >= xs[n - 1]) return ys[n - 1];
    for (let i = 1; i < n; i++) if (x <= xs[i]) {
      return ys[i - 1] + (x - xs[i - 1]) * (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1]);
    }
    return ys[n - 1];
  }

  function depthM(yt, C) {
    const kx = C.depth_knots_Yt, ky = C.depth_knots_m, n = kx.length;
    if (yt > kx[n - 1]) return ky[n - 1] + (yt - kx[n - 1]) * (ky[n - 1] - ky[n - 2]) / (kx[n - 1] - kx[n - 2]);
    return interp(yt, kx, ky);
  }

  function geometry(xt, yt, C) {
    const dx = C.metres_per_Xt * (xt - C.goal_centre_Xt);
    const dy = Math.max(depthM(yt, C), C.min_depth_m);
    const h = C.post_half_width_m;
    const dist = Math.hypot(dx, dy);
    let ang = Math.atan2(h * 2 * dy, dx * dx + dy * dy - h * h);
    if (ang < 0) ang += Math.PI;
    return { dist, dx, dy, ang };
  }

  function rcs(x, t) { // Harrell restricted cubic spline: [x, s1, ..., s_{k-2}]
    const k = t.length, nrm = Math.pow(t[k - 1] - t[0], 2), out = [x];
    const p = u => Math.pow(Math.max(u, 0), 3);
    for (let j = 0; j < k - 2; j++) {
      out.push((p(x - t[j]) - p(x - t[k - 2]) * (t[k - 1] - t[j]) / (t[k - 1] - t[k - 2])
        + p(x - t[k - 1]) * (t[k - 2] - t[j]) / (t[k - 1] - t[k - 2])) / nrm);
    }
    return out;
  }

  const sigmoid = z => 1 / (1 + Math.exp(-z));

  function xpForShot(labels, teamSide, level, opts) {
    opts = opts || {};
    const M = opts.model || xpForShot.model || (typeof root !== 'undefined' && root.XP_MODEL);
    if (!M) throw new Error('xp_model.json not loaded: set xpForShot.model = <json>');
    const C = M.coordinates;
    labels = labels || {};

    // --- coordinates
    const pairs = teamSide === 'away' ? [['X-Shot_away', 'Y-Shot_away'], ['X-Shot', 'Y-Shot']]
                                      : [['X-Shot', 'Y-Shot'], ['X-Shot_away', 'Y-Shot_away']];
    let x = NaN, y = NaN;
    for (const [kx, ky] of pairs) {
      const a = parseFloat(lab(labels, kx)), b = parseFloat(lab(labels, ky));
      if (isFinite(a) && isFinite(b)) { x = a; y = b; break; }
    }
    if (!isFinite(x) || !isFinite(y)) return null;
    const conv = opts.conv || 'tracker';
    const xt = conv === 'sportscode_rot' ? 100 - y : x;
    const yt = conv === 'sportscode_rot' ? 100 - x : y;
    const g = geometry(xt, yt, C);

    // --- shot type
    const attRaw = lab(labels, 'Shot Attempts').toUpperCase();
    const dbRaw = lab(labels, 'Deadball Shot Type').toUpperCase();
    const deadball = opts.deadball != null ? !!opts.deadball : dbRaw !== '';
    let dbType = 'open';
    if (deadball) {
      if (/PENALTY/.test(dbRaw)) dbType = 'penalty';
      else if (/45|65/.test(dbRaw)) dbType = '45';
      else if (/MARK/.test(dbRaw)) dbType = 'mark';
      else dbType = 'free';
    }
    let att = '';
    if (attRaw.startsWith('1 POINT')) att = '1pt';
    else if (attRaw.startsWith('2 POINT')) att = '2pt';
    else if (attRaw.startsWith('GOAL')) att = 'goal';
    else if (attRaw === "'45 SHOT") { att = '1pt'; dbType = '45'; }
    else if (attRaw === 'FREE KICK') att = g.dist > 40.5 ? '2pt' : '1pt';
    if (!att) return null;
    const dbModel = dbType === 'mark' ? 'free' : dbType;

    const prRaw = lab(labels, 'Shot Pressure').toUpperCase();
    const press = prRaw.startsWith('HIGH') ? 'high' : prRaw.startsWith('MED') ? 'medium' : prRaw.startsWith('LOW') ? 'low' : 'missing';

    const parts = { dist: g.dist, dx: g.dx, dy: g.dy, goalmouthAngle: g.ang, xt, yt, conv,
                    attempt: att, dbType, pressure: press, level: level || null };

    if (att === '1pt' || att === '2pt') {
      const P = M.point_attempt_model, c = P.coefficients;
      const s = rcs(g.dist, P.dist_knots);
      const f = {
        dist: s[0], dist_rcs1: s[1], dist_rcs2: s[2],
        log_goalmouth_angle: Math.log(g.ang),
        db_free: dbModel === 'free' ? 1 : 0,
        db_45: dbModel === '45' ? 1 : 0,
        db_free_x_dist: dbModel === 'free' ? g.dist : 0,
        press_high: press === 'high' ? 1 : 0,
        press_missing: press === 'missing' ? 1 : 0
      };
      let eta = P.intercept;
      for (const k in c) eta += c[k] * f[k];
      const p = sigmoid(eta), value = att === '2pt' ? 2 : 1;
      parts.eta = eta; parts.features = f; parts.value = value; parts.model = 'point_attempt';
      return { p, xp: p * value, parts };
    }

    // goal attempts
    let pGoal, pPoint;
    if (dbType === 'penalty') {
      pGoal = M.penalty.p_goal; pPoint = M.penalty.p_point; parts.model = 'penalty_smoothed_rate';
    } else {
      const G = M.goal_attempt_model;
      pGoal = sigmoid(G.p_goal.intercept + G.p_goal.coef_log_dist * Math.log(g.dist));
      pPoint = (1 - pGoal) * sigmoid(G.p_point_given_no_goal.intercept);
      parts.model = 'goal_attempt';
    }
    parts.pGoal = pGoal; parts.pPoint = pPoint; parts.value = 3;
    return { p: pGoal + pPoint, xp: 3 * pGoal + pPoint, parts };
  }

  if (typeof module !== 'undefined' && module.exports) {
    try { xpForShot.model = require('./xp_model.json'); } catch (e) { /* browser or missing */ }
    module.exports = { xpForShot };
  } else {
    root.xpForShot = xpForShot;
  }
})(typeof window !== 'undefined' ? window : globalThis);

// Resolve once: try the published model through the read gateway, fall back
// to the bundled one silently (offline, not signed in, none published yet).
(function(){
  let _p=null;
  window.cohesionXpReady=function(){
    if(_p) return _p;
    _p=(async()=>{
      try{
        if(typeof window.cohesionRead==='function'){
          const j=await window.cohesionRead({action:'xpModel'});
          const m=j&&j.model;
          if(m&&m.point_attempt_model&&m.goal_attempt_model&&m.coordinates) window.XP_MODEL=m;
        }
      }catch(_){ /* keep bundled */ }
      window.xpForShot.model=window.XP_MODEL;
      return window.XP_MODEL;
    })();
    return _p;
  };
})();

// Coordinate convention per game: 'tracker' (goal at top, X = lateral %) or
// 'sportscode_rot' (older Mayo Sportscode timelines: X = 100 - depth%,
// Y = 100 - lateral%). Port of the validation rule (parse.py): read every
// located shot both ways, map each reading to the tracker's Shot Zone
// (bands Yt<31 / <70.2 / beyond; thirds of Xt) and keep the reading that
// agrees more often with the tagged "Shot Zones" label. Defaults to
// 'tracker' when there are no zone labels, too few shots, or a tie.
// events: COHESION events ({code, labels}) or raw {labels} objects.
(function(){
  const SHOT=/SHOT (OPEN|DEAD)/i, MIN_SHOTS=6;
  const lab=(L,name)=>{ const w=name.toLowerCase(); for(const k in L) if(k.trim().toLowerCase()===w) return String(L[k]==null?'':L[k]).trim(); return ''; };
  const zoneOf=(xt,yt)=>{ const band=yt<31?0:yt<70.2?1:2, col=xt<33.3?0:xt<66.7?1:2; return band*3+col+1; };
  function detail(events){
    let n=0, agreeT=0, agreeR=0;
    (events||[]).forEach(e=>{
      if(!e) return;
      if(e.code!=null&&!SHOT.test(String(e.code))) return;
      const L=e.labels||e;
      const zm=/ZONE\s*(\d+)/i.exec(lab(L,'Shot Zones')); if(!zm) return;
      const z=+zm[1];
      let x=NaN, y=NaN;
      for(const [kx,ky] of [['X-Shot','Y-Shot'],['X-Shot_away','Y-Shot_away']]){
        const a=parseFloat(lab(L,kx)), b=parseFloat(lab(L,ky));
        if(isFinite(a)&&isFinite(b)){ x=a; y=b; break; }
      }
      if(!isFinite(x)||!isFinite(y)) return;
      n++;
      if(zoneOf(x,y)===z) agreeT++;
      if(zoneOf(100-y,100-x)===z) agreeR++;
    });
    const conv=(n>=MIN_SHOTS&&agreeR>agreeT)?'sportscode_rot':'tracker';
    return {conv, n, agreeTracker:n?agreeT/n:null, agreeRot:n?agreeR/n:null};
  }
  window.cohesionXpDetectConv=function(events){ return detail(events).conv; };
  window.cohesionXpDetectConv.detail=detail;
  window.cohesionXpDetectConv.MIN_SHOTS=MIN_SHOTS;
})();
