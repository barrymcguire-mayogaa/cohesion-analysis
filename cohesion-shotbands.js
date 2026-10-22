/* COHESION — SHOOTING BY DISTANCE: the ONE shot-band rule (Analysis › Players, Player Dashboard, Panel Print-out).
 *
 * BANDS are set by the pitch LINES, straight across the pitch — the shot's DEPTH from the goal line, not its radial
 * distance to goal:
 *     A   inside the 20 m line
 *     B   from the 20 m line to the 45 m line — B1 = 1-point attempts, B2 = 2-point attempts (the shot's tagged
 *         'Shot Attempts', as the Players tab reads it: ssAttType); a goal attempt or an untagged shot here is "B other"
 *     C   beyond the 45 m line
 * A '45 is ALWAYS band B (it is taken on the 45 m line: cohesion-labels.js cohIs45 on 'Deadball Shot Type', or the
 * Analysis dead-ball type '45'), with or without a location. Any other shot with no location is in NO band: "unlocated".
 *
 * WHERE THE LINES ARE: exactly where COHESION's true-scale shot pitch DRAWS them. SHOT_LINES / shotMY / shotLabelY below
 * are copied VERBATIM from cohesion-graphics.js (shotPitchArt — the map every tab draws; cohesion-shot45.js keeps the same
 * copy) and test_player_dash.js checks the copies are identical. A shot's stored Y is "% down the 100 x 75 box", so a
 * line at metres m sits at stored Y = shotLabelY(m):  20 m line → 30.533…,  45 m line → 69.333…  (CR_45_Y, the snapped
 * '45, is 69.3).
 * The shot's Y must be in the CANONICAL frame — the one the maps and xP use: Analysis' ttGameShots (ttCoordOf: the first
 * X-/Y- label pair, a rotated Sportscode game un-rotated as cohesionXpDetectConv decides) gives exactly that.
 *
 * ON A LINE: a shot within LINE_EPS (0.05 of a stored unit, half the 0.1 step stored positions are rounded to) of a line
 * is ON it, and a shot on either line is band B — the 20 m line and the 45 m line both belong to "20 m line to 45 m line".
 *
 *   cohShotBand(s)          → 'A' | 'B' | 'C' | null      s = {y, is45?, deadType?, e?}
 *   cohShotBandOf(s)        → 'A' | 'B1' | 'B2' | 'Bx' | 'C' | null
 *   cohShotBands(shots)     → {rows:{A,B,B1,B2,Bx,C}, unlocated, total, located}; each row {shots, scores, pts, pct, xp,
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
  const Y20=shotLabelY(20), Y45=shotLabelY(45), LINE_EPS=0.05;
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
  function cohShotBand(s){
    if(!s) return null;
    if(is45(s)) return 'B';
    const y=s.y; if(y==null||y===''||!isFinite(+y)) return null;
    const v=+y;
    if(v<Y20-LINE_EPS) return 'A';
    if(v>Y45+LINE_EPS) return 'C';
    return 'B';
  }
  function cohShotBandOf(s){ const b=cohShotBand(s); if(b!=='B') return b; return s.att==='1'?'B1':s.att==='2'?'B2':'Bx'; }
  function pct(n, d){ return d>0?n/d*100:null; }
  function cohShotBands(shots){
    const mk=()=>({shots:0, scores:0, pts:0, xp:0, xpShots:0, xpPts:0, op:{shots:0, scores:0}, db:{shots:0, scores:0}});
    const rows={A:mk(), B:mk(), B1:mk(), B2:mk(), Bx:mk(), C:mk()}, total=mk(); let unlocated=0, unlocated45=0;
    const add=(o,s)=>{ o.shots++; if(s.v>0){ o.scores++; o.pts+=s.v; } if(s.xp!=null){ o.xp+=s.xp; o.xpShots++; o.xpPts+=(s.v>0?s.v:0); }
      const p=s.dead?o.db:o.op; p.shots++; if(s.v>0) p.scores++; };
    (shots||[]).forEach(s=>{ add(total, s); const b=cohShotBandOf(s); if(!b){ unlocated++; return; }
      if((s.y==null||!isFinite(+s.y))) unlocated45++;
      add(rows[b.charAt(0)], s); if(b!=='A'&&b!=='C') add(rows[b], s); });
    const fin=o=>Object.assign(o, {pct:pct(o.scores, o.shots), xp:o.xpShots?o.xp:null, op:Object.assign(o.op, {pct:pct(o.op.scores, o.op.shots)}), db:Object.assign(o.db, {pct:pct(o.db.scores, o.db.shots)})});
    Object.keys(rows).forEach(k=>fin(rows[k])); fin(total);
    return {rows, total, located:total.shots-unlocated, unlocated, unlocated45};
  }
  const API={cohShotBand, cohShotBandOf, cohShotBands, COH_SHOT_BANDS:{y20:Y20, y45:Y45, eps:LINE_EPS, lines:SHOT_LINES.slice()}, _shotLabelY:shotLabelY};
  Object.assign(root, API);
  if(typeof module!=='undefined'&&module.exports) module.exports=API;
})(typeof window!=='undefined'?window:globalThis);
