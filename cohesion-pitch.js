/* COHESION — 📐 lining a GAA pitch up with a video frame (Barry, Nov 2026).
 *
 * The analyst picks 4 or more known points of the pitch (where the 13 / 20 / 45 / 65 m lines meet the sidelines, the
 * rectangles' corners, the goalposts, the penalty spot, the halfway line…) and clicks the same spots on the paused
 * frame. A homography (the camera's view of the flat pitch) is fitted to those pairs; with it COHESION can:
 *   · draw every pitch line in perspective over the picture            linesSvg(model, W, H)
 *   · size a ring or spotlight so it lies on the grass                  groundEllipse(model, x, y, metres)
 *   · measure a distance on the grass                                   groundDist(model, a, b)
 *
 * PITCH COORDINATES (metres): X along the pitch from end A's goal line (0) to end B's (len); Y across from one sideline
 * (0) to the other (wid). Markings follow COHESION's own true-scale pitch art (cohesion-graphics.js shotPitchArt):
 * 13, 20, 45, 65 m lines from each end; large rectangle 19 × 13 m; small rectangle 14 × 4.5 m; goal 6.5 m wide;
 * penalty spot 11 m; the D = 13 m from the middle of the 20 m line (beyond it); the 40 m two-point arc centred on the
 * goal, from the 20 m line out; halfway line. GAA pitches are 130–145 m × 80–90 m: the size is set per drawing.
 *
 * IMAGE COORDINATES: fractions (0–1) of the video's 16:9 picture, as the drawing engine stores shapes. The fit works
 * in a nominal 1600 × 900 frame, so it does not depend on the size the video is shown at.
 *
 * The calibration travels inside the drawing as a shape {type:'pitch', len, wid, pts:[{k, x, y}], show?}
 * (cohesion-tele.js renders it; netlify/lib/telestration.js whitelists it).
 */
(function (root) {
  'use strict';
  const FW = 1600, FH = 900;
  const DEF_LEN = 140, DEF_WID = 85;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ── the GAA pitch's known points ──
  // id → {X, Y, label}; end A ids start with A, end B with B, halfway with H. Each end's points mirror the other's.
  function keypoints(len, wid) {
    len = +len || DEF_LEN; wid = +wid || DEF_WID;
    const m = wid / 2, out = {};
    const end = (E, f) => {
      const X = d => E === 'A' ? d : len - d, nm = E === 'A' ? 'End A' : 'End B';
      const add = (id, d, y, label) => { out[E + id] = { X: X(d), Y: y, label: nm + ' · ' + label, end: E }; };
      add('c0', 0, 0, 'corner (near side)'); add('c1', 0, wid, 'corner (far side)');
      [13, 20, 45, 65].forEach(d => { add(d + 'a', d, 0, d + ' m line, near sideline'); add(d + 'b', d, wid, d + ' m line, far sideline'); });
      add('gp0', 0, m - 3.25, 'goalpost (near)'); add('gp1', 0, m + 3.25, 'goalpost (far)');
      add('sr0', 0, m - 7, 'small rectangle, goal line (near)'); add('sr1', 0, m + 7, 'small rectangle, goal line (far)');
      add('sf0', 4.5, m - 7, 'small rectangle, front (near)'); add('sf1', 4.5, m + 7, 'small rectangle, front (far)');
      add('lr0', 0, m - 9.5, 'large rectangle, goal line (near)'); add('lr1', 0, m + 9.5, 'large rectangle, goal line (far)');
      add('lf0', 13, m - 9.5, 'large rectangle, front (near)'); add('lf1', 13, m + 9.5, 'large rectangle, front (far)');
      add('pen', 11, m, 'penalty spot');
      add('d0', 20, m - 13, 'D meets the 20 m line (near)'); add('d1', 20, m + 13, 'D meets the 20 m line (far)'); add('dt', 33, m, 'top of the D');
      const a20 = Math.sqrt(40 * 40 - 20 * 20);
      add('ar0', 20, m - a20, '2-pt arc meets the 20 m line (near)'); add('ar1', 20, m + a20, '2-pt arc meets the 20 m line (far)'); add('at', 40, m, 'top of the 2-pt arc');
    };
    end('A'); end('B');
    out.Hh0 = { X: len / 2, Y: 0, label: 'Halfway line, near sideline', end: 'H' };
    out.Hh1 = { X: len / 2, Y: wid, label: 'Halfway line, far sideline', end: 'H' };
    out.Hc = { X: len / 2, Y: m, label: 'Centre of the pitch', end: 'H' };
    return out;
  }

  // ── small linear algebra ──
  function solve(A, b) {                       // Gaussian elimination with partial pivoting; null when singular
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-10) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  const mul3 = (A, B) => { const C = [0, 0, 0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += A[i * 3 + k] * B[k * 3 + j]; C[i * 3 + j] = s; } return C; };
  function inv3(m) {
    const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-14) return null;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  // a normalising similarity (centroid to 0, mean distance √2) — keeps the fit well conditioned
  function norm(P) { const n = P.length, cx = P.reduce((s, p) => s + p[0], 0) / n, cy = P.reduce((s, p) => s + p[1], 0) / n;
    const d = P.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n || 1, k = Math.SQRT2 / d; return [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1]; }
  const ap = (T, p) => [T[0] * p[0] + T[1] * p[1] + T[2], T[3] * p[0] + T[4] * p[1] + T[5]];

  // the homography taking pitch metres [X, Y] to frame pixels [x, y] (least squares over every pair); null when the
  // points do not pin the view down (fewer than 4, or (nearly) all on one line)
  function homography(src, dst) {
    if (src.length < 4) return null;
    const Ts = norm(src), Td = norm(dst), S = src.map(p => ap(Ts, p)), D = dst.map(p => ap(Td, p));
    const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
    const row = (r, v) => { for (let i = 0; i < 8; i++) { Atb[i] += r[i] * v; for (let j = 0; j < 8; j++) AtA[i][j] += r[i] * r[j]; } };
    S.forEach((s, i) => { const [X, Y] = s, [x, y] = D[i]; row([X, Y, 1, 0, 0, 0, -x * X, -x * Y], x); row([0, 0, 0, X, Y, 1, -y * X, -y * Y], y); });
    const h = solve(AtA, Atb); if (!h) return null;
    const Tdi = inv3(Td); if (!Tdi) return null;
    let H = mul3(mul3(Tdi, h.concat([1])), Ts);
    const s = H[8]; if (Math.abs(s) < 1e-14) return null; H = H.map(v => v / s);
    // points (nearly) all on one line fit many views: refuse unless three of them span a real triangle (20 m² or more)
    let big = 0; for (let i = 0; i < src.length && big < 20; i++) for (let j = i + 1; j < src.length && big < 20; j++) for (let k = j + 1; k < src.length; k++) {
      const a = Math.abs((src[j][0] - src[i][0]) * (src[k][1] - src[i][1]) - (src[j][1] - src[i][1]) * (src[k][0] - src[i][0])) / 2; if (a > big) big = a; }
    if (big < 20) return null;
    return H;
  }
  function proj(H, X, Y) { const w = H[6] * X + H[7] * Y + H[8]; if (!(w > 1e-9)) return null; return [(H[0] * X + H[1] * Y + H[2]) / w, (H[3] * X + H[4] * Y + H[5]) / w]; }

  // a calibration shape → its model {len, wid, H (metres → frame px), Hi, err (rms px of 1600), n, kp} or null
  const _cache = new Map();
  function model(p) {
    if (!p || !Array.isArray(p.pts)) return null;
    const key = JSON.stringify([p.len, p.wid, p.pts]);
    if (_cache.has(key)) return _cache.get(key);
    const len = clamp(+p.len || DEF_LEN, 100, 160), wid = clamp(+p.wid || DEF_WID, 60, 100), kp = keypoints(len, wid);
    const pairs = p.pts.filter(q => q && kp[q.k] && Number.isFinite(+q.x) && Number.isFinite(+q.y));
    let M = null;
    if (pairs.length >= 4) {
      const H = homography(pairs.map(q => [kp[q.k].X, kp[q.k].Y]), pairs.map(q => [q.x * FW, q.y * FH]));
      const Hi = H && inv3(H);
      if (H && Hi) {
        const errs = pairs.map(q => { const r = proj(H, kp[q.k].X, kp[q.k].Y); return r ? Math.hypot(r[0] - q.x * FW, r[1] - q.y * FH) : 1e4; });
        M = { len, wid, H, Hi, n: pairs.length, kp, err: Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length), errs };
      }
    }
    if (_cache.size > 50) _cache.clear();
    _cache.set(key, M);
    return M;
  }
  // frame fraction ↔ pitch metres
  function toFrame(M, X, Y) { const r = proj(M.H, X, Y); return r ? [r[0] / FW, r[1] / FH] : null; }
  function toGround(M, x, y) { const w = M.Hi[6] * x * FW + M.Hi[7] * y * FH + M.Hi[8]; if (Math.abs(w) < 1e-12) return null;
    const X = (M.Hi[0] * x * FW + M.Hi[1] * y * FH + M.Hi[2]) / w, Y = (M.Hi[3] * x * FW + M.Hi[4] * y * FH + M.Hi[5]) / w;
    return toFrame(M, X, Y) ? [X, Y] : null; }        // a point above the horizon is not on the grass
  function groundDist(M, a, b) { const g1 = toGround(M, a[0], a[1]), g2 = toGround(M, b[0], b[1]); return g1 && g2 ? Math.hypot(g2[0] - g1[0], g2[1] - g1[1]) : null; }
  // a circle of `metres` radius on the grass at frame point (x, y) → its ellipse on the picture {cx, cy, rx, ry, rot}
  // (rx, ry as fractions of the frame's width / height; rot in degrees) — from the projected circle's principal axes
  function groundEllipse(M, x, y, metres) {
    const g = toGround(M, x, y); if (!g) return null;
    const P = []; for (let i = 0; i < 48; i++) { const a = i / 48 * 2 * Math.PI, q = proj(M.H, g[0] + metres * Math.cos(a), g[1] + metres * Math.sin(a)); if (!q) return null; P.push(q); }
    const c = proj(M.H, g[0], g[1]); if (!c) return null;
    const mx = P.reduce((s, p) => s + p[0], 0) / P.length, my = P.reduce((s, p) => s + p[1], 0) / P.length;
    let sxx = 0, syy = 0, sxy = 0; P.forEach(p => { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; });
    sxx /= P.length; syy /= P.length; sxy /= P.length;
    const tr = (sxx + syy) / 2, df = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy), l1 = tr + df, l2 = Math.max(1e-9, tr - df);
    let rot = 0.5 * Math.atan2(2 * sxy, sxx - syy) * 180 / Math.PI;            // the long axis
    const a = Math.sqrt(2 * l1), b = Math.sqrt(2 * l2);                      // a uniform ring's semi-axes from its variance
    if (rot > 90) rot -= 180; if (rot < -90) rot += 180;
    return { cx: mx / FW, cy: my / FH, gx: c[0] / FW, gy: c[1] / FH, rx: a / FW, ry: b / FH, rot: Math.round(rot * 10) / 10, rpx: a, rpy: b };
  }

  // ── the pitch markings, as polylines in metres ──
  function markings(len, wid) {
    const m = wid / 2, L = [], line = (a, b) => L.push([a, b]);
    line([0, 0], [len, 0]); line([len, 0], [len, wid]); line([len, wid], [0, wid]); line([0, wid], [0, 0]);
    line([len / 2, 0], [len / 2, wid]);
    [0, 1].forEach(e => {
      const X = d => e ? len - d : d, dir = e ? -1 : 1;
      // a curve centred on the centre line `cx` m out from this end, radius r, through angles ±t (0 = straight out)
      const curve = (cx, r, t) => { const pts = []; for (let i = 0; i <= 64; i++) { const a = -t + 2 * t * i / 64; pts.push([X(cx + r * Math.cos(a)), m + r * Math.sin(a)]); } L.push(pts); };
      [13, 20, 45, 65].forEach(d => line([X(d), 0], [X(d), wid]));
      L.push([[X(0), m - 9.5], [X(13), m - 9.5], [X(13), m + 9.5], [X(0), m + 9.5]]);      // large rectangle 19 × 13 m
      L.push([[X(0), m - 7], [X(4.5), m - 7], [X(4.5), m + 7], [X(0), m + 7]]);            // small rectangle 14 × 4.5 m
      curve(20, 13, Math.PI / 2);                                                          // the D, beyond the 20 m line
      curve(0, 40, Math.acos(20 / 40));                                                    // the 2-pt arc, from the 20 m line out
    });
    return L;
  }
  const spots = (len, wid) => [[11, wid / 2], [len - 11, wid / 2], [len / 2, wid / 2]];
  // straight runs are split, so a line crossing the horizon breaks instead of wrapping
  function sample(poly) { const out = []; for (let i = 0; i < poly.length - 1; i++) { const a = poly[i], b = poly[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } out.push(poly[poly.length - 1]); return out; }
  const f1 = v => (Math.round(v * 10) / 10).toString();
  // SVG of the lined-up pitch markings for a W × H picture
  function linesSvg(M, W, H, o) {
    if (!M) return '';
    o = o || {}; const col = o.color || '#ffffff', op = o.opacity != null ? o.opacity : 0.72, k = clamp(H / 480, 0.6, 2.4);
    let d = '';
    markings(M.len, M.wid).forEach(poly => { let pen = false;
      sample(poly).forEach(p => { const r = proj(M.H, p[0], p[1]); const ok = r && r[0] > -FW && r[0] < 2 * FW && r[1] > -FH && r[1] < 2 * FH;
        if (!ok) { pen = false; return; } d += (pen ? 'L' : 'M') + f1(r[0] / FW * W) + ' ' + f1(r[1] / FH * H); pen = true; }); });
    let dots = '';
    spots(M.len, M.wid).forEach(p => { const r = proj(M.H, p[0], p[1]); if (r) dots += '<circle cx="' + f1(r[0] / FW * W) + '" cy="' + f1(r[1] / FH * H) + '" r="' + f1(2.4 * k) + '" fill="' + col + '" fill-opacity="' + op + '"/>'; });
    return '<g class="ct-pitch" pointer-events="none"><path d="' + d + '" fill="none" stroke="#000" stroke-opacity="' + (op * 0.45) + '" stroke-width="' + f1(3.4 * k) + '" stroke-linejoin="round"/>'
      + '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-opacity="' + op + '" stroke-width="' + f1(1.7 * k) + '" stroke-linejoin="round"' + (o.dash ? ' stroke-dasharray="' + f1(7 * k) + ' ' + f1(5 * k) + '"' : '') + '/>' + dots + '</g>';
  }
  // the flat diagram used to pick points: an SVG of the pitch (len × wid scaled to w px wide) with every keypoint
  function diagramSvg(len, wid, w, o) {
    o = o || {}; len = +len || DEF_LEN; wid = +wid || DEF_WID;
    const pad = 8, s = (w - 2 * pad) / len, h = wid * s + 2 * pad, X = v => pad + v * s, Y = v => pad + v * s;
    let d = ''; markings(len, wid).forEach(poly => { d += 'M' + poly.map(p => f1(X(p[0])) + ' ' + f1(Y(p[1]))).join('L'); });
    const kp = keypoints(len, wid), placed = new Set(o.placed || []);
    const dots = Object.keys(kp).map(id => { const p = kp[id], on = id === o.sel, pl = placed.has(id);
      return '<circle class="cp-kp' + (on ? ' sel' : '') + (pl ? ' set' : '') + '" data-k="' + id + '" cx="' + f1(X(p.X)) + '" cy="' + f1(Y(p.Y)) + '" r="' + (on ? 5.2 : 4.2) + '"><title>' + p.label + '</title></circle>'; }).join('');
    return '<svg class="cp-diag" viewBox="0 0 ' + w + ' ' + f1(h) + '" width="' + w + '" height="' + f1(h) + '"><rect x="' + pad + '" y="' + pad + '" width="' + f1(len * s) + '" height="' + f1(wid * s) + '" fill="#2f6b3a" rx="2"/>'
      + '<path d="' + d + '" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1"/>'
      + '<text x="' + f1(X(2)) + '" y="' + f1(Y(wid) + 7) + '" font-size="7.5" fill="#9aa0b4" font-family="Barlow,sans-serif">END A</text><text x="' + f1(X(len) - 2) + '" y="' + f1(Y(wid) + 7) + '" text-anchor="end" font-size="7.5" fill="#9aa0b4" font-family="Barlow,sans-serif">END B</text>'
      + dots + '</svg>';
  }

  // ── COHESION's tagged locations → pitch metres ──
  // Shots: the shot chart (cohesion-graphics.js shotPitchArt) — x across, 0.878 m a unit from the goal's centre (50);
  // y = % down a 75-high chart whose lines sit at these heights: [metres from the goal line, chart y].
  // Kickouts: the kickout chart — y stored as metres from the kicking goal × 100 / 137 (KO_UNIT_M); x across an 84 m
  // chart, 1.2 units of margin each side (koMX). Both charts are drawn as if standing facing that goal.
  const SHOT_LINES = [[0, 1.2], [13, 15.5], [20, 22.9], [45, 52]], SHOT_M_PER_X = 0.878;
  const KO_PM = 1.2, KO_UNIT_M = 137, KO_WIDTH_M = 84, KO_KX = (100 - 2 * KO_PM) / KO_WIDTH_M;
  function shotChartToMetres(x, y) { const v = y * 0.75, A = SHOT_LINES; let i = 0; while (i < A.length - 2 && v > A[i + 1][1]) i++;
    const d = A[i][0] + (v - A[i][1]) * (A[i + 1][0] - A[i][0]) / (A[i + 1][1] - A[i][1]); return { depth: Math.max(0, d), lat: (x - 50) * SHOT_M_PER_X }; }
  function koChartToMetres(x, y) { return { depth: Math.max(0, y * KO_UNIT_M / 100), across: clamp((x - KO_PM) / KO_KX, 0, KO_WIDTH_M) }; }
  // a tagged location (kind 'shot' | 'ko', its chart x / y 0–100) → pitch metres [X, Y], at end 'A' | 'B'.
  // Facing the goal at end A (towards X = 0) your left is the near sideline (Y = 0); at end B it is the far one.
  // mirror swaps left and right (a game tagged the other way round).
  function chartToPitch(len, wid, kind, x, y, end, mirror) {
    const m = wid / 2; let depth, off;
    if (kind === 'shot') { const s = shotChartToMetres(x, y); depth = s.depth; off = s.lat; }
    else { const k = koChartToMetres(x, y); depth = k.depth; off = k.across / KO_WIDTH_M * wid - m; }
    let sg = end === 'B' ? -1 : 1; if (mirror) sg = -sg;
    return [end === 'B' ? len - depth : depth, clamp(m + sg * off, 0, wid)];
  }
  // the end the line-up was made on: the end most of its points belong to
  function seenEnd(p) { let a = 0, b = 0; ((p && p.pts) || []).forEach(q => { if (/^A/.test(q.k)) a++; else if (/^B/.test(q.k)) b++; }); return b > a ? 'B' : 'A'; }

  const API = { DEF_LEN, DEF_WID, FW, FH, keypoints, homography, model, toFrame, toGround, groundDist, groundEllipse, markings, linesSvg, diagramSvg,
    shotChartToMetres, koChartToMetres, chartToPitch, seenEnd };
  root.CohPitch = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
