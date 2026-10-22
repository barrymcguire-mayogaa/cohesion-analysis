/* COHESION — SHOOTING BY DISTANCE: the ONE shot-band rule (Analysis › Players, Player Dashboard, Panel Print-out).
 *
 * BANDS are set by the pitch LINES, straight across the pitch — the shot's DEPTH from the goal line, not its radial
 * distance to goal:
 *     A   inside the 20 m line (a shot ON the 20 m line included)
 *     B   beyond the 20 m line up to the 45 m line (a shot ON the 45 m line included) — split by the shot's tagged
 *         'Shot Attempts' (as the Players tab reads it: ssAttType): B1 = 1-point attempts, B2 = 2-point attempts,
 *         B3 = goal attempts (Goal Attempt, plus penalties — the Players tab's and xP's goal-attempt rule), and
 *         "B other" = attempt not tagged.  B1 + B2 + B3 + other = B.
 *     C   beyond the 45 m line — C1 = 2-point attempts, C2 = goal attempts (a goal attempt can come from anywhere), and
 *         "C other" = not tagged, or tagged 1-point. C1 + C2 + other = C. (Barry: a 1-pointer cannot come from beyond the
 *         45; the only 1-point shot from there is a '45, which is band B.) A shot in C tagged 1-point (not a '45, not a
 *         penalty) is a MIS-TAG: it stays in C ("C other": its location puts it there; nothing is re-tagged) and is listed
 *         in `misC` for a data-check note. Goal attempts and untagged shots in C are never listed.
 *
 * DATA CHECK — 1-point tags beyond the 2-point ARC (Barry, Oct 2026): a shot tagged 1 Point Attempt whose location is
 * beyond the 40 m arc by more than ARC_TOL_M (1 m) is listed too, in whatever band it is (usually B). The distance is the
 * one Code Room uses to auto-set the attempt type (code-room.html crShotDistM / CR_ARC_2PT_M = 40): the xP model's scale,
 * cohesion-xp.js xpForShot(...).parts.dist, from the canonical X / Y (the analysis shot's x / y, rotated games already
 * un-rotated) — Barry, Oct 2026: on his tagged shots that scale agrees with the tags better than the drawn one. The 1 m
 * tolerance is for click and storage precision on the arc. A shot flagged ONLY because it is beyond the drawn 45 m line
 * shows no distance (the two scales can disagree there by ~0.5 m). '45s and penalties are never listed, nor goal attempts.
 *   misTag: [{s, band, dist (m or null), beyond45 (in C), arc (beyond the arc + tolerance)}] — every flagged shot once;
 *   misC = the beyond-45 ones (kept for the C counts).
 * A '45 is ALWAYS band B (it is taken on the 45 m line: cohesion-labels.js cohIs45 on 'Deadball Shot Type', or the
 * Analysis dead-ball type '45'), with or without a location. A PENALTY is always band A (the 11 m spot), with or without a
 * location. Any other shot with no location is in NO band: "unlocated".
 *
 * WHERE THE LINES ARE: exactly where COHESION's true-scale shot pitch DRAWS them. SHOT_LINES / shotMY / shotLabelY below
 * are copied VERBATIM from cohesion-graphics.js (shotPitchArt — the map every tab draws; cohesion-shot45.js keeps the same
 * copy) and test_player_dash.js checks the copies are identical. A shot's stored Y is "% down the 100 x 75 box", so a
 * line at metres m sits at stored Y = shotLabelY(m):  20 m line → 30.533…,  45 m line → 69.333…  (CR_45_Y, the snapped
 * '45, is 69.3).
 * The shot's Y must be in the CANONICAL frame — the one the maps and xP use: Analysis' ttGameShots (ttCoordOf: the first
 * X-/Y- label pair, a rotated Sportscode game un-rotated as cohesionXpDetectConv decides) gives exactly that.
 *
 * ON A LINE (Barry, Oct 2026): a shot within LINE_EPS (0.05 of a stored unit, half the 0.1 step stored positions are rounded
 * to) of a line is ON it. ON the 20 m line → A (inside the 20 m line). ON the 45 m line → B.
 *
 *   cohShotBand(s)          → 'A' | 'B' | 'C' | null      s = {y, is45?, deadType?, e?}
 *   cohShotBandOf(s)        → 'A' | 'B1' | 'B2' | 'B3' | 'Bx' | 'C1' | 'C2' | 'Cx' | null
 *   cohShotBands(shots)     → {rows:{A,B,B1,B2,B3,Bx,C,C1,C2,Cx}, unlocated, total, located, misC:[shot…]}; each row {shots, scores, pts, pct, xp,
 *                              xpShots, xpPts, op:{shots,scores,pct}, db:{shots,scores,pct}}  (xp null when no shot of the
 *                              row has an xP rating)
 *   COH_SHOT_BANDS          the geometry: {y20, y45, eps, lines}
 */
(function(root){
  'use strict';
  // ── shot map geometry: copied VERBATIM from cohesion-graphics.js (the test checks the copies are identical) ──
  const SHOT_VB_H=75, SHOT_M_PER_X=0.878, SHOT_ARC_M=40;
  const SHOT_LINES=[[0,1.2],[13,15.5],[20,22.9],[45,52]];   // [metres from the goal line, viewBox y]
  function shotMY(m){ const A=SHOT_LINES; let i=0; while(i<A.length-2&&m>A[i+1][0]) i++;   // metres from the goal line -> viewBox y
    return A[i][1]+(m-A[i][0])*(A[i+1][1]-A[i][1])/(A[i+1][0]-A[i][0]); }
  function shotLabelY(m){ return shotMY(m)*100/SHOT_VB_H; }                   // metres from the goal line -> stored Y (% down the box)
  // ── end of the copy ──
  // DISTANCE TO GOAL ON THE DRAWN PITCH — kept for the bands' geometry only (the arc check and Code Room use the xP model's
  // distance, cohShotDistM below; Barry, Oct 2026). The inverse of the drawing above: stored X → metres across (SHOT_M_PER_X a unit, goal centre
  // at X 50), stored Y → viewBox y (× 0.75) → metres from the goal line through SHOT_LINES (piecewise linear; beyond the
  // last knot the last segment's slope, as shotMY extrapolates). So the drawn 20 m line is 20 m, the drawn 45 m line 45 m and
  // every point of the drawn 40 m arc (shotLocus(0, 40, 20)) 40 m from the goal centre — exactly. The position must be
  // CANONICAL (a rotated Sportscode game already un-rotated). cohesion-xp.js keeps its own model scale for xP.
  function shotDepthM(vy){ const A=SHOT_LINES; let i=0; while(i<A.length-2&&vy>A[i+1][1]) i++;
    return A[i][0]+(vy-A[i][1])*(A[i+1][0]-A[i][0])/(A[i+1][1]-A[i][1]); }
  function cohShotPitchDistM(x, y){
    if(x==null||y==null||x===''||y===''||!isFinite(+x)||!isFinite(+y)) return null;
    const lat=(+x-50)*SHOT_M_PER_X, d=shotDepthM(+y*SHOT_VB_H/100);
    return Math.hypot(lat, d); }
  const Y20=shotLabelY(20), Y45=shotLabelY(45), LINE_EPS=0.05;
  const CR_ARC_2PT_M=40, ARC_TOL_M=1;   // = code-room.html CR_ARC_2PT_M (the test checks it); the flag tolerance
  // a shot's metres from the goal centre as Code Room's crShotDistM reads it (the xP model's scale, canonical frame, conv
  // tracker); null when the model is not loaded
  function cohShotDistM(s){
    const f=root.xpForShot; if(typeof f!=='function'||!s||s.x==null||s.y==null||!isFinite(+s.x)||!isFinite(+s.y)) return null;
    try{ const r=f({'Shot Attempts':'1 Point Attempt','X-Shot':String(s.x),'Y-Shot':String(s.y)},'home',null,{conv:'tracker'});
      return r&&r.parts&&isFinite(r.parts.dist)?r.parts.dist:null; }catch(_){ return null; } }
  const UC=s=>String(s==null?'':s).toUpperCase().trim();
  function lab(e, g){ const L=(e&&e.labels)||{}; const k=Object.keys(L).find(x=>x.toLowerCase()===g.toLowerCase()); return k?L[k]:''; }
  function is45(s){
    if(!s) return false;
    if(s.is45!=null) return !!s.is45;
    if(s.deadType==='45') return true;
    const v=lab(s.e, 'Deadball Shot Type');
    if(v&&typeof root.cohIs45==='function'&&root.cohIs45(v)) return true;
    return false;
  }
  function isPen(s){ return !!s&&(s.kind==='P'||s.deadType==='Penalty'||/PENALT/i.test(lab(s.e, 'Deadball Shot Type'))); }
  function cohShotBand(s){
    if(!s) return null;
    if(is45(s)) return 'B';
    if(isPen(s)) return 'A';
    const y=s.y; if(y==null||y===''||!isFinite(+y)) return null;
    const v=+y;
    if(v<=Y20+LINE_EPS) return 'A';    // inside the 20 m line, or on it
    if(v>Y45+LINE_EPS) return 'C';     // beyond the 45 m line (on it is B)
    return 'B';
  }
  function cohShotBandOf(s){ const b=cohShotBand(s);
    if(b==='B') return s.att==='1'?'B1':s.att==='2'?'B2':(s.att==='G'||isPen(s))?'B3':'Bx';
    if(b==='C') return s.att==='2'?'C1':s.att==='G'?'C2':'Cx';
    return b; }
  function pct(n, d){ return d>0?n/d*100:null; }
  function cohShotBands(shots){
    const mk=()=>({shots:0, scores:0, pts:0, xp:0, xpShots:0, xpPts:0, op:{shots:0, scores:0}, db:{shots:0, scores:0}});
    const rows={A:mk(), B:mk(), B1:mk(), B2:mk(), B3:mk(), Bx:mk(), C:mk(), C1:mk(), C2:mk(), Cx:mk()}, total=mk(), misC=[], misTag=[]; let unlocated=0, unlocated45=0;
    const add=(o,s)=>{ o.shots++; if(s.v>0){ o.scores++; o.pts+=s.v; } if(s.xp!=null){ o.xp+=s.xp; o.xpShots++; o.xpPts+=(s.v>0?s.v:0); }
      const p=s.dead?o.db:o.op; p.shots++; if(s.v>0) p.scores++; };
    (shots||[]).forEach(s=>{ add(total, s); const b=cohShotBandOf(s); if(!b){ unlocated++; return; }
      if((s.y==null||!isFinite(+s.y))) unlocated45++;
      add(rows[b.charAt(0)], s); if(b!=='A') add(rows[b], s);
      if(s.att==='1'&&!is45(s)&&!isPen(s)){ const d=cohShotDistM(s), beyond45=b==='Cx', arc=d!=null&&d>CR_ARC_2PT_M+ARC_TOL_M;
        if(beyond45) misC.push(s);
        if(beyond45||arc) misTag.push({s, band:b.charAt(0), dist:d, beyond45, arc}); } });
    const fin=o=>Object.assign(o, {pct:pct(o.scores, o.shots), xp:o.xpShots?o.xp:null, op:Object.assign(o.op, {pct:pct(o.op.scores, o.op.shots)}), db:Object.assign(o.db, {pct:pct(o.db.scores, o.db.shots)})});
    Object.keys(rows).forEach(k=>fin(rows[k])); fin(total);
    return {rows, total, located:total.shots-unlocated, unlocated, unlocated45, misC, misTag};
  }
  // a mis-tagged C shot as text: "1-point" / "goal attempt"
  function cohShotMisTagTxt(s){ return '1-point'; }
  const API={cohShotBand, cohShotBandOf, cohShotBands, cohShotMisTagTxt, cohShotDistM, cohShotPitchDistM, COH_SHOT_ARC:{m:CR_ARC_2PT_M, tol:ARC_TOL_M}, COH_SHOT_BANDS:{y20:Y20, y45:Y45, eps:LINE_EPS, lines:SHOT_LINES.slice()}, _shotLabelY:shotLabelY};
  Object.assign(root, API);
  if(typeof module!=='undefined'&&module.exports) module.exports=API;
})(typeof window!=='undefined'?window:globalThis);
