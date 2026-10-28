/* COHESION — telestration engine (Barry, Oct 2026): broadcast-style drawing on a video's 16:9 picture.
 *
 * Shapes are stored in FRACTIONS (0–1) of the video's 16:9 content rectangle, so a drawing stays glued to the pitch
 * at any player size or full screen; line widths and text scale with the picture (k = height / 480). The server
 * (netlify/lib/telestration.js) whitelists exactly these types and fields:
 *   free{pts}  line / arrow / darrow{x1,y1,x2,y2}  carrow{x1,y1,x2,y2,cx,cy}  rect / ellipse{x1,y1,x2,y2,fill}
 *   poly{pts,closed,fill}  spot{cx,cy,rx,ry,beam}  tag{x,y,px,py,name,team,no}  link{pts,closed,fill}
 *   text{x,y,text,style:'plain'|'dark'|'box',size}  pen{nodes:[{x,y,ix?,iy?,ox?,oy?}],closed,fill}
 *   every shape: color? (#rrggbb — absent = the layer's colour, e.g. its comment's), w (1–16), alpha?
 *   fill: 'solid' | 'hatch' (true = solid, from the first version)
 * All text is rendered ESCAPED (esc below); colours are re-checked as #rrggbb before they reach the SVG.
 *
 *   CohTele.render(layers, W, H, opts) → SVG markup for [{shapes, color}] (opts.photo(team, name) → image URL or null)
 *   CohTele.editor(svg, opts) → the drawing editor on an <svg> (see EDITOR below)
 */
(function () {
  'use strict';
  const HEX = /^#[0-9a-f]{6}$/i;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const colOf = (s, def) => (s && typeof s.color === 'string' && HEX.test(s.color)) ? s.color : (HEX.test(def || '') ? def : '#ffd600');
  const fillOf = s => s.fill === true || s.fill === 'solid' ? 'solid' : s.fill === 'hatch' ? 'hatch' : null;
  const f1 = v => (Math.round(v * 10) / 10).toString();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lum = hex => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; };
  const kOf = H => clamp(H / 480, 0.6, 2.4);
  const initials = n => { const w = String(n || '').trim().split(/\s+/).filter(Boolean); return ((w[0] || '?')[0] + (w.length > 1 ? (w[w.length - 1].replace(/^[^A-Za-zÀ-ÿ]+/, '')[0] || '') : '')).toUpperCase(); };

  // text width (Barlow Condensed) — measured when a canvas is there, estimated otherwise
  let MC = null;
  function textW(str, px, weight) {
    try { if (!MC) MC = document.createElement('canvas').getContext('2d'); MC.font = (weight || 800) + ' ' + px + "px 'Barlow Condensed', 'Arial Narrow', sans-serif"; const m = MC.measureText(str).width; if (m > 0) return m; } catch (_) {}
    return String(str).length * px * 0.5;
  }

  // ── geometry helpers ──
  const P = (x, y, W, H) => [x * W, y * H];
  function qPoint(a, c, b, t) { const u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; }
  function cPoint(a, c1, c2, b, t) { const u = 1 - t; return [u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]; }
  function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; const t = L2 ? clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1) : 0; return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); }
  function polyDist(px, py, pts, closed) { let d = Infinity; for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    if (closed && pts.length > 2) d = Math.min(d, segDist(px, py, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1])); return d; }
  function inside(px, py, pts) { let r = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi)) r = !r; } return r; }
  // a pen path's segment from node a to node b (cubic when either end has a handle)
  function penSegs(nodes, closed, W, H) {
    const out = [], n = nodes.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = nodes[i], b = nodes[(i + 1) % n];
      out.push({ a: [a.x * W, a.y * H], c1: a.ox != null ? [a.ox * W, a.oy * H] : [a.x * W, a.y * H], c2: b.ix != null ? [b.ix * W, b.iy * H] : [b.x * W, b.y * H], b: [b.x * W, b.y * H] });
    }
    return out;
  }
  const penD = (nodes, closed, W, H) => { if (!nodes.length) return ''; const s = penSegs(nodes, closed, W, H);
    return 'M' + f1(nodes[0].x * W) + ' ' + f1(nodes[0].y * H) + s.map(g => 'C' + [g.c1, g.c2, g.b].map(p => f1(p[0]) + ' ' + f1(p[1])).join(' ')).join('') + (closed ? 'Z' : ''); };
  const penSamples = (nodes, closed, W, H) => { const pts = []; penSegs(nodes, closed, W, H).forEach(g => { for (let t = 0; t <= 1.0001; t += 1 / 16) pts.push(cPoint(g.a, g.c1, g.c2, g.b, t)); }); return pts.length ? pts : nodes.map(n => [n.x * W, n.y * H]); };
  function freeD(pts, W, H) {
    if (!pts.length) return '';
    const p = pts.map(q => [q[0] * W, q[1] * H]);
    if (p.length < 3) return 'M' + p.map(q => f1(q[0]) + ' ' + f1(q[1])).join('L');
    let d = 'M' + f1(p[0][0]) + ' ' + f1(p[0][1]);
    for (let i = 1; i < p.length - 1; i++) { const m = [(p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2]; d += 'Q' + f1(p[i][0]) + ' ' + f1(p[i][1]) + ' ' + f1(m[0]) + ' ' + f1(m[1]); }
    const l = p[p.length - 1]; return d + 'L' + f1(l[0]) + ' ' + f1(l[1]);
  }
  // the default bend of a new curved arrow: 22% of its length, to the left of travel
  function autoCtrl(x1, y1, x2, y2, W, H) { const dx = (x2 - x1) * W, dy = (y2 - y1) * H, L = Math.hypot(dx, dy) || 1; const mx = (x1 + x2) / 2 * W, my = (y1 + y2) / 2 * H; return [(mx + dy / L * L * 0.22) / W, (my - dx / L * L * 0.22) / H]; }

  // layout of the boxes (name tag, text): shared by drawing and hit-testing
  function tagBox(s, W, H) {
    const k = kOf(H), bh = 34 * k, fs = 15 * k, name = String(s.name || '').toUpperCase();
    const tw = textW(name, fs, 800), nw = s.no ? 24 * k : 0;
    const w = bh + 8 * k + tw + 12 * k + nw;
    const x = clamp(s.x * W, 0, Math.max(0, W - w)), y = clamp(s.y * H, 0, Math.max(0, H - bh));
    return { x, y, w, h: bh, fs, k, name, nw };
  }
  function textBox(s, W, H) {
    const k = kOf(H), fs = (s.size || 20) * k * 0.95, str = String(s.text || '');
    const tw = textW(str, fs, 800), padX = s.style === 'plain' ? 2 * k : 10 * k, padY = s.style === 'plain' ? 2 * k : 6 * k;
    const w = tw + padX * 2 + (s.style === 'dark' ? 5 * k : 0), h = fs * 1.18 + padY * 2;
    return { x: s.x * W, y: s.y * H, w, h, fs, k, padX, padY, str };
  }

  // ── rendering ──
  function defs(id, cols, k) {
    let d = '<defs>'
      + '<filter id="' + id + 'g" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="' + f1(2.6 * k) + '" result="b"/><feComponentTransfer in="b" result="b2"><feFuncA type="linear" slope="0.85"/></feComponentTransfer><feMerge><feMergeNode in="b2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
      + '<filter id="' + id + 's" x="-30%" y="-30%" width="160%" height="170%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="' + f1(1.6 * k) + '" stdDeviation="' + f1(1.8 * k) + '" flood-color="#000" flood-opacity="0.75"/></filter>';
    cols.forEach(c => { const h = c.slice(1);
      d += '<pattern id="' + id + 'h' + h + '" patternUnits="userSpaceOnUse" width="' + f1(9 * k) + '" height="' + f1(9 * k) + '" patternTransform="rotate(45)"><rect width="' + f1(9 * k) + '" height="' + f1(9 * k) + '" fill="' + c + '" fill-opacity="0.10"/><rect width="' + f1(3.2 * k) + '" height="' + f1(9 * k) + '" fill="' + c + '" fill-opacity="0.62"/></pattern>'
        + '<radialGradient id="' + id + 'r' + h + '"><stop offset="0" stop-color="' + c + '" stop-opacity="0.55"/><stop offset="0.55" stop-color="' + c + '" stop-opacity="0.22"/><stop offset="1" stop-color="' + c + '" stop-opacity="0.05"/></radialGradient>'
        + '<linearGradient id="' + id + 'b' + h + '" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="' + c + '" stop-opacity="0.55"/><stop offset="0.35" stop-color="' + c + '" stop-opacity="0.22"/><stop offset="1" stop-color="' + c + '" stop-opacity="0"/></linearGradient>'
        + '<linearGradient id="' + id + 'e' + h + '" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.65"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'; });
    return d + '</defs>';
  }
  // a stroke with the dark outline under it and the colour glowing on top
  function stroke(d, col, sw, k, id, extra) {
    extra = extra || '';
    return '<path d="' + d + '" fill="none" stroke="#000" stroke-opacity="0.5" stroke-width="' + f1(sw + 3 * k) + '" stroke-linecap="round" stroke-linejoin="round"' + extra + '/>'
      + '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + f1(sw) + '" stroke-linecap="round" stroke-linejoin="round" filter="url(#' + id + 'g)"' + extra + '/>';
  }
  function head(x, y, a, sw, k, col, id) {
    const hl = 9 * k + sw * 2.3, hw = hl * 0.58, bx = x - hl * Math.cos(a), by = y - hl * Math.sin(a), nx = x - hl * 0.72 * Math.cos(a), ny = y - hl * 0.72 * Math.sin(a);
    const l = [bx + hw * Math.sin(a), by - hw * Math.cos(a)], r = [bx - hw * Math.sin(a), by + hw * Math.cos(a)];
    const pts = [[x, y], l, [nx, ny], r].map(p => f1(p[0]) + ',' + f1(p[1])).join(' ');
    return '<polygon points="' + pts + '" fill="' + col + '" stroke="#000" stroke-opacity="0.55" stroke-width="' + f1(1.6 * k) + '" stroke-linejoin="round" filter="url(#' + id + 'g)"/>';
  }
  const back = (x, y, a, d) => [x - d * Math.cos(a), y - d * Math.sin(a)];
  function fillAttr(s, col, id, solidOp) { const f = fillOf(s); return f === 'hatch' ? 'url(#' + id + 'h' + col.slice(1) + ')' : f === 'solid' ? col : 'none'; }
  function fillOpacity(s) { return fillOf(s) === 'solid' ? ' fill-opacity="0.28"' : ''; }

  function shapeSvg(s, W, H, def, id, opts) {
    const col = colOf(s, def), k = kOf(H), sw = clamp(+s.w || 4, 1, 16) * k * 0.85;
    let o = '';
    switch (s.type) {
      case 'free': o = stroke(freeD(s.pts || [], W, H), col, sw, k, id); break;
      case 'line': o = stroke('M' + f1(s.x1 * W) + ' ' + f1(s.y1 * H) + 'L' + f1(s.x2 * W) + ' ' + f1(s.y2 * H), col, sw, k, id); break;
      case 'arrow': case 'darrow': {
        const x1 = s.x1 * W, y1 = s.y1 * H, x2 = s.x2 * W, y2 = s.y2 * H, a = Math.atan2(y2 - y1, x2 - x1), e = back(x2, y2, a, (9 * k + sw * 2.3) * 0.6);
        const dash = s.type === 'darrow' ? ' stroke-dasharray="' + f1(sw * 2.4) + ' ' + f1(sw * 2) + '"' : '';
        o = stroke('M' + f1(x1) + ' ' + f1(y1) + 'L' + f1(e[0]) + ' ' + f1(e[1]), col, sw, k, id, dash) + head(x2, y2, a, sw, k, col, id);
        break;
      }
      case 'carrow': {
        const a1 = [s.x1 * W, s.y1 * H], c = [(s.cx != null ? s.cx : (s.x1 + s.x2) / 2) * W, (s.cy != null ? s.cy : (s.y1 + s.y2) / 2) * H], b = [s.x2 * W, s.y2 * H];
        const a = Math.atan2(b[1] - c[1], b[0] - c[0]), e = back(b[0], b[1], a, (9 * k + sw * 2.3) * 0.6);
        o = stroke('M' + f1(a1[0]) + ' ' + f1(a1[1]) + 'Q' + f1(c[0]) + ' ' + f1(c[1]) + ' ' + f1(e[0]) + ' ' + f1(e[1]), col, sw, k, id) + head(b[0], b[1], a, sw, k, col, id);
        break;
      }
      case 'rect': { const x = Math.min(s.x1, s.x2) * W, y = Math.min(s.y1, s.y2) * H, w = Math.abs(s.x2 - s.x1) * W, h = Math.abs(s.y2 - s.y1) * H;
        o = '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(w) + '" height="' + f1(h) + '" rx="' + f1(3 * k) + '" fill="' + fillAttr(s, col, id) + '"' + fillOpacity(s) + '/>'
          + stroke('M' + f1(x) + ' ' + f1(y) + 'h' + f1(w) + 'v' + f1(h) + 'h' + f1(-w) + 'Z', col, sw, k, id); break; }
      case 'ellipse': { const cx = (s.x1 + s.x2) / 2 * W, cy = (s.y1 + s.y2) / 2 * H, rx = Math.abs(s.x2 - s.x1) / 2 * W, ry = Math.abs(s.y2 - s.y1) / 2 * H;
        const d = 'M' + f1(cx - rx) + ' ' + f1(cy) + 'a' + f1(rx) + ' ' + f1(ry) + ' 0 1 0 ' + f1(2 * rx) + ' 0a' + f1(rx) + ' ' + f1(ry) + ' 0 1 0 ' + f1(-2 * rx) + ' 0Z';
        o = '<path d="' + d + '" fill="' + fillAttr(s, col, id) + '"' + fillOpacity(s) + '/>' + stroke(d, col, sw, k, id); break; }
      case 'poly': { const pts = (s.pts || []).map(p => P(p[0], p[1], W, H)); if (!pts.length) break;
        const d = 'M' + pts.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L') + (s.closed ? 'Z' : '');
        o = (s.closed ? '<path d="' + d + '" fill="' + fillAttr(s, col, id) + '"' + fillOpacity(s) + '/>' : '') + stroke(d, col, sw, k, id); break; }
      case 'spot': {
        const cx = s.cx * W, cy = s.cy * H, rx = Math.max(3, (s.rx || 0.05) * W), ry = Math.max(2, (s.ry || 0.02) * H), h = s.color && HEX.test(s.color) ? s.color.slice(1) : col.slice(1);
        if (s.beam) {
          const top = Math.max(0, cy - Math.min(cy, rx * 4.2 + ry * 2)), tw = rx * 0.82;
          o += '<path d="M' + f1(cx - rx) + ' ' + f1(cy) + 'L' + f1(cx - tw) + ' ' + f1(top) + 'L' + f1(cx + tw) + ' ' + f1(top) + 'L' + f1(cx + rx) + ' ' + f1(cy) + 'Z" fill="url(#' + id + 'b' + h + ')"/>'
            + '<path d="M' + f1(cx - rx * 0.32) + ' ' + f1(cy) + 'L' + f1(cx - tw * 0.3) + ' ' + f1(top) + 'L' + f1(cx + tw * 0.3) + ' ' + f1(top) + 'L' + f1(cx + rx * 0.32) + ' ' + f1(cy) + 'Z" fill="url(#' + id + 'e' + h + ')" opacity="0.35"/>'
            + '<path d="M' + f1(cx - rx) + ' ' + f1(cy) + 'L' + f1(cx - tw) + ' ' + f1(top) + 'M' + f1(cx + rx) + ' ' + f1(cy) + 'L' + f1(cx + tw) + ' ' + f1(top) + '" stroke="url(#' + id + 'b' + h + ')" stroke-width="' + f1(1.5 * k) + '" fill="none"/>';
        }
        const ring = (r1, r2) => 'M' + f1(cx - r1) + ' ' + f1(cy) + 'a' + f1(r1) + ' ' + f1(r2) + ' 0 1 0 ' + f1(2 * r1) + ' 0a' + f1(r1) + ' ' + f1(r2) + ' 0 1 0 ' + f1(-2 * r1) + ' 0Z';
        o += '<ellipse cx="' + f1(cx) + '" cy="' + f1(cy) + '" rx="' + f1(rx) + '" ry="' + f1(ry) + '" fill="url(#' + id + 'r' + col.slice(1) + ')"/>'
          + stroke(ring(rx, ry), col, sw, k, id)
          + '<path d="' + ring(rx * 0.6, ry * 0.6) + '" fill="none" stroke="' + col + '" stroke-opacity="0.85" stroke-width="' + f1(Math.max(1, sw * 0.55)) + '"/>';
        break;
      }
      case 'link': {
        const pts = (s.pts || []).map(p => P(p[0], p[1], W, H)); if (!pts.length) break;
        const d = 'M' + pts.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L') + (s.closed ? 'Z' : '');
        if (s.closed) o += '<path d="' + d + '" fill="' + fillAttr(s, col, id) + '"' + fillOpacity(s) + '/>';
        if (pts.length > 1) o += stroke(d, col, sw, k, id);
        pts.forEach(p => { o += '<circle cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" r="' + f1(7.5 * k) + '" fill="#000" fill-opacity="0.4" stroke="#000" stroke-opacity="0.5" stroke-width="' + f1(2 * k + 3 * k) + '"/>'
          + '<circle cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" r="' + f1(7.5 * k) + '" fill="none" stroke="' + col + '" stroke-width="' + f1(2.4 * k) + '" filter="url(#' + id + 'g)"/>'
          + '<circle cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" r="' + f1(2.2 * k) + '" fill="' + col + '"/>'; });
        break;
      }
      case 'pen': {
        const nodes = s.nodes || []; if (!nodes.length) break;
        const d = penD(nodes, !!s.closed, W, H);
        if (s.closed) o += '<path d="' + d + '" fill="' + fillAttr(s, col, id) + '"' + fillOpacity(s) + '/>';
        o += stroke(d, col, sw, k, id);
        break;
      }
      case 'text': {
        const b = textBox(s, W, H), st = s.style || 'plain', tcol = st === 'box' ? (lum(col) > 0.55 ? '#0b0d12' : '#ffffff') : st === 'dark' ? '#ffffff' : col;
        let g = '';
        if (st === 'dark') g += '<rect x="' + f1(b.x) + '" y="' + f1(b.y) + '" width="' + f1(b.w) + '" height="' + f1(b.h) + '" rx="' + f1(4 * b.k) + '" fill="#090b10" fill-opacity="0.88" stroke="#fff" stroke-opacity="0.08"/>'
          + '<rect x="' + f1(b.x) + '" y="' + f1(b.y) + '" width="' + f1(5 * b.k) + '" height="' + f1(b.h) + '" rx="' + f1(2 * b.k) + '" fill="' + col + '"/>';
        if (st === 'box') g += '<rect x="' + f1(b.x) + '" y="' + f1(b.y) + '" width="' + f1(b.w) + '" height="' + f1(b.h) + '" rx="' + f1(4 * b.k) + '" fill="' + col + '"/>';
        const tx = b.x + b.padX + (st === 'dark' ? 5 * b.k : 0), ty = b.y + b.padY + b.fs * 0.93;
        g += '<text x="' + f1(tx) + '" y="' + f1(ty) + '" font-family="\'Barlow Condensed\',\'Arial Narrow\',sans-serif" font-weight="800" font-size="' + f1(b.fs) + '" letter-spacing="' + f1(0.4 * b.k) + '" fill="' + tcol + '"'
          + (st === 'plain' ? ' stroke="#000" stroke-opacity="0.85" stroke-width="' + f1(3.6 * b.k) + '" paint-order="stroke" stroke-linejoin="round"' : '') + '>' + esc(b.str) + '</text>';
        o = '<g filter="url(#' + id + 's)">' + g + '</g>';
        break;
      }
      case 'tag': {
        const b = tagBox(s, W, H), k2 = b.k, px = s.px != null ? s.px * W : null, py = s.py != null ? s.py * H : null;
        if (px != null) {
          const ax = clamp(px, b.x + b.h / 2, b.x + b.w - b.h / 2), ay = py < b.y ? b.y : py > b.y + b.h ? b.y + b.h : b.y + b.h;
          o += stroke('M' + f1(ax) + ' ' + f1(ay) + 'L' + f1(px) + ' ' + f1(py), col, 2.2 * k2, k2, id)
            + '<circle cx="' + f1(px) + '" cy="' + f1(py) + '" r="' + f1(5 * k2) + '" fill="#000" fill-opacity="0.35" stroke="' + col + '" stroke-width="' + f1(2.2 * k2) + '" filter="url(#' + id + 'g)"/>'
            + '<circle cx="' + f1(px) + '" cy="' + f1(py) + '" r="' + f1(1.8 * k2) + '" fill="' + col + '"/>';
        }
        const r = b.h / 2 - 3 * k2, cx = b.x + b.h / 2, cy = b.y + b.h / 2, url = opts.photo ? opts.photo(s.team, s.name) : null, cid = id + 'c' + (opts.n = (opts.n || 0) + 1);
        let g = '<rect x="' + f1(b.x) + '" y="' + f1(b.y) + '" width="' + f1(b.w) + '" height="' + f1(b.h) + '" rx="' + f1(b.h / 2) + '" fill="#0a0d13" fill-opacity="0.92" stroke="' + col + '" stroke-width="' + f1(1.6 * k2) + '"/>'
          + '<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(r + 1.6 * k2) + '" fill="' + col + '"/>';
        if (url && /^(https?:|blob:|data:image\/)/i.test(url)) g += '<clipPath id="' + cid + '"><circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(r) + '"/></clipPath><circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(r) + '" fill="#20242e"/>'
          + '<image href="' + esc(url) + '" x="' + f1(cx - r) + '" y="' + f1(cy - r) + '" width="' + f1(2 * r) + '" height="' + f1(2 * r) + '" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + cid + ')"/>';
        else g += '<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(r) + '" fill="#1b1f29"/><text x="' + f1(cx) + '" y="' + f1(cy + 4.6 * k2) + '" text-anchor="middle" font-family="\'Barlow Condensed\',sans-serif" font-weight="800" font-size="' + f1(13 * k2) + '" fill="' + col + '">' + esc(initials(s.name)) + '</text>';
        g += '<text x="' + f1(b.x + b.h + 6 * k2) + '" y="' + f1(cy + b.fs * 0.36) + '" font-family="\'Barlow Condensed\',\'Arial Narrow\',sans-serif" font-weight="800" font-size="' + f1(b.fs) + '" letter-spacing="' + f1(0.6 * k2) + '" fill="#fff">' + esc(b.name) + '</text>';
        if (s.no) { const nx = b.x + b.w - b.nw - 6 * k2; g += '<rect x="' + f1(nx) + '" y="' + f1(cy - 9 * k2) + '" width="' + f1(b.nw) + '" height="' + f1(18 * k2) + '" rx="' + f1(4 * k2) + '" fill="' + col + '"/>'
          + '<text x="' + f1(nx + b.nw / 2) + '" y="' + f1(cy + 4.8 * k2) + '" text-anchor="middle" font-family="\'Barlow Condensed\',sans-serif" font-weight="800" font-size="' + f1(13 * k2) + '" fill="' + (lum(col) > 0.55 ? '#0b0d12' : '#fff') + '">' + esc(s.no) + '</text>'; }
        o += '<g filter="url(#' + id + 's)">' + g + '</g>';
        break;
      }
    }
    const a = s.alpha != null ? clamp(+s.alpha, 0.1, 1) : 1;
    return '<g' + (a < 1 ? ' opacity="' + a + '"' : '') + '>' + o + '</g>';
  }
  function colorsUsed(layers) { const s = new Set(); layers.forEach(L => (L.shapes || []).forEach(x => s.add(colOf(x, L.color)))); return [...s]; }
  function render(layers, W, H, opts) {
    opts = Object.assign({ id: 'ct' }, opts || {}); opts.n = 0;
    layers = (layers || []).filter(L => L && Array.isArray(L.shapes));
    const k = kOf(H);
    return defs(opts.id, colorsUsed(layers.concat(opts.extra ? [opts.extra] : [])), k) + layers.map(L => L.shapes.map(s => shapeSvg(s, W, H, L.color, opts.id, opts)).join('')).join('');
  }

  // ── hit-testing, handles, moving (pixels; tol in px) ──
  function hit(s, x, y, W, H, tol) {
    const px = x * W, py = y * H;
    switch (s.type) {
      case 'line': case 'arrow': case 'darrow': return segDist(px, py, s.x1 * W, s.y1 * H, s.x2 * W, s.y2 * H) <= tol;
      case 'carrow': { const a = [s.x1 * W, s.y1 * H], c = [s.cx * W, s.cy * H], b = [s.x2 * W, s.y2 * H], pts = []; for (let t = 0; t <= 1.0001; t += 1 / 24) pts.push(qPoint(a, c, b, t)); return polyDist(px, py, pts, false) <= tol; }
      case 'rect': { const x1 = Math.min(s.x1, s.x2) * W, x2 = Math.max(s.x1, s.x2) * W, y1 = Math.min(s.y1, s.y2) * H, y2 = Math.max(s.y1, s.y2) * H;
        if (fillOf(s) && px >= x1 && px <= x2 && py >= y1 && py <= y2) return true; return polyDist(px, py, [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], true) <= tol; }
      case 'ellipse': case 'spot': {
        const cx = s.type === 'spot' ? s.cx * W : (s.x1 + s.x2) / 2 * W, cy = s.type === 'spot' ? s.cy * H : (s.y1 + s.y2) / 2 * H;
        const rx = Math.max(1, s.type === 'spot' ? s.rx * W : Math.abs(s.x2 - s.x1) / 2 * W), ry = Math.max(1, s.type === 'spot' ? s.ry * H : Math.abs(s.y2 - s.y1) / 2 * H);
        const v = Math.pow((px - cx) / rx, 2) + Math.pow((py - cy) / ry, 2);
        if ((s.type === 'spot' || fillOf(s)) && v <= 1) return true; return Math.abs(Math.sqrt(v) - 1) * Math.min(rx, ry) <= tol;
      }
      case 'free': return polyDist(px, py, (s.pts || []).map(p => [p[0] * W, p[1] * H]), false) <= tol;
      case 'poly': case 'link': { const pts = (s.pts || []).map(p => [p[0] * W, p[1] * H]); if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]) <= tol + 6;
        if (s.closed && fillOf(s) && inside(px, py, pts)) return true; if (s.type === 'link' && pts.some(p => Math.hypot(px - p[0], py - p[1]) <= tol + 6)) return true; return polyDist(px, py, pts, !!s.closed) <= tol; }
      case 'pen': { const pts = penSamples(s.nodes || [], !!s.closed, W, H); if (s.closed && fillOf(s) && inside(px, py, pts)) return true; return polyDist(px, py, pts, false) <= tol; }
      case 'text': { const b = textBox(s, W, H); return px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol; }
      case 'tag': { const b = tagBox(s, W, H); if (px >= b.x - 4 && px <= b.x + b.w + 4 && py >= b.y - 4 && py <= b.y + b.h + 4) return true;
        return s.px != null && segDist(px, py, b.x + b.w / 2, b.y + b.h, s.px * W, s.py * H) <= tol; }
    }
    return false;
  }
  function handles(s, W, H) {
    switch (s.type) {
      case 'line': case 'arrow': case 'darrow': return [{ id: 'p1', x: s.x1, y: s.y1 }, { id: 'p2', x: s.x2, y: s.y2 }];
      case 'carrow': return [{ id: 'p1', x: s.x1, y: s.y1 }, { id: 'p2', x: s.x2, y: s.y2 }, { id: 'c', x: s.cx, y: s.cy, round: true }];
      case 'rect': case 'ellipse': return [{ id: 'c11', x: s.x1, y: s.y1 }, { id: 'c21', x: s.x2, y: s.y1 }, { id: 'c12', x: s.x1, y: s.y2 }, { id: 'c22', x: s.x2, y: s.y2 }];
      case 'poly': case 'link': return (s.pts || []).map((p, i) => ({ id: 'v' + i, x: p[0], y: p[1] }));
      case 'spot': return [{ id: 'rx', x: s.cx + s.rx, y: s.cy }, { id: 'ry', x: s.cx, y: s.cy + s.ry }];
      case 'tag': return s.px != null ? [{ id: 'pt', x: s.px, y: s.py, round: true }] : [];
      case 'text': { const b = textBox(s, W || 1, H || 1); return [{ id: 'sz', x: (b.x + b.w) / (W || 1), y: (b.y + b.h) / (H || 1) }]; }
      case 'pen': { const out = []; (s.nodes || []).forEach((n, i) => { out.push({ id: 'n' + i, x: n.x, y: n.y });
        if (n.ix != null) { out.push({ id: 'i' + i, x: n.ix, y: n.iy, round: true, from: [n.x, n.y] }); out.push({ id: 'o' + i, x: n.ox, y: n.oy, round: true, from: [n.x, n.y] }); } }); return out; }
    }
    return [];
  }
  function applyHandle(s, h, x, y, W, H) {
    const c = (v, lo, hi) => clamp(v, lo == null ? 0 : lo, hi == null ? 1 : hi);
    if (/^v\d+$/.test(h)) { const i = +h.slice(1); if (s.pts && s.pts[i]) s.pts[i] = [c(x), c(y)]; return; }
    if (/^[nio]\d+$/.test(h) && s.nodes) {
      const i = +h.slice(1), n = s.nodes[i]; if (!n) return;
      if (h[0] === 'n') { const dx = c(x) - n.x, dy = c(y) - n.y; n.x += dx; n.y += dy; if (n.ix != null) { n.ix += dx; n.iy += dy; n.ox += dx; n.oy += dy; } return; }
      const hx = c(x, -0.5, 1.5), hy = c(y, -0.5, 1.5);
      if (h[0] === 'o') { n.ox = hx; n.oy = hy; n.ix = 2 * n.x - hx; n.iy = 2 * n.y - hy; } else { n.ix = hx; n.iy = hy; n.ox = 2 * n.x - hx; n.oy = 2 * n.y - hy; }   // smooth: mirrored
      return;
    }
    switch (h) {
      case 'p1': s.x1 = c(x); s.y1 = c(y); break; case 'p2': s.x2 = c(x); s.y2 = c(y); break;
      case 'c': s.cx = c(x, -0.5, 1.5); s.cy = c(y, -0.5, 1.5); break;
      case 'c11': s.x1 = c(x); s.y1 = c(y); break; case 'c21': s.x2 = c(x); s.y1 = c(y); break;
      case 'c12': s.x1 = c(x); s.y2 = c(y); break; case 'c22': s.x2 = c(x); s.y2 = c(y); break;
      case 'rx': s.rx = clamp(Math.abs(x - s.cx), 0.006, 0.5); break; case 'ry': s.ry = clamp(Math.abs(y - s.cy), 0.003, 0.5); break;
      case 'pt': s.px = c(x); s.py = c(y); break;
      case 'sz': { const k = kOf(H || 480), hpx = (y - s.y) * (H || 480), padY = (s.style === 'plain' ? 2 : 6) * k; s.size = Math.round(clamp((hpx - 2 * padY) / (1.18 * 0.95 * k), 10, 48)); break; }
    }
  }
  function move(s, dx, dy) {
    const m = p => [clamp(p[0] + dx, 0, 1), clamp(p[1] + dy, 0, 1)];
    switch (s.type) {
      case 'free': case 'poly': case 'link': s.pts = (s.pts || []).map(m); break;
      case 'spot': s.cx = clamp(s.cx + dx, 0, 1); s.cy = clamp(s.cy + dy, 0, 1); break;
      case 'text': s.x = clamp(s.x + dx, 0, 0.98); s.y = clamp(s.y + dy, 0, 0.98); break;
      case 'tag': s.x = clamp(s.x + dx, 0, 0.98); s.y = clamp(s.y + dy, 0, 0.98); break;   // the box moves; its pointer stays on the player
      case 'pen': (s.nodes || []).forEach(n => { n.x = clamp(n.x + dx, 0, 1); n.y = clamp(n.y + dy, 0, 1); if (n.ix != null) { n.ix += dx; n.iy += dy; n.ox += dx; n.oy += dy; } }); break;
      case 'carrow': s.cx += dx; s.cy += dy; // falls through
      default: s.x1 = clamp(s.x1 + dx, 0, 1); s.y1 = clamp(s.y1 + dy, 0, 1); s.x2 = clamp(s.x2 + dx, 0, 1); s.y2 = clamp(s.y2 + dy, 0, 1);
    }
  }
  function bbox(s, W, H) {
    let pts = [];
    switch (s.type) {
      case 'free': case 'poly': case 'link': pts = (s.pts || []).map(p => [p[0] * W, p[1] * H]); break;
      case 'pen': pts = penSamples(s.nodes || [], !!s.closed, W, H); break;
      case 'spot': pts = [[(s.cx - s.rx) * W, (s.cy - s.ry) * H], [(s.cx + s.rx) * W, (s.cy + s.ry) * H]]; break;
      case 'text': { const b = textBox(s, W, H); pts = [[b.x, b.y], [b.x + b.w, b.y + b.h]]; break; }
      case 'tag': { const b = tagBox(s, W, H); pts = [[b.x, b.y], [b.x + b.w, b.y + b.h]]; if (s.px != null) pts.push([s.px * W, s.py * H]); break; }
      case 'carrow': pts = [[s.x1 * W, s.y1 * H], [s.x2 * W, s.y2 * H], qPoint([s.x1 * W, s.y1 * H], [s.cx * W, s.cy * H], [s.x2 * W, s.y2 * H], 0.5)]; break;
      default: pts = [[s.x1 * W, s.y1 * H], [s.x2 * W, s.y2 * H]];
    }
    if (!pts.length) return null;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  /* ── EDITOR ─────────────────────────────────────────────────────────────────────────────────────────────────────
   * CohTele.editor(svg, {
   *   color: '#rrggbb' | null (null = the layer colour), layerColor, w, fill ('none'|'solid'|'hatch'), alpha, textStyle,
   *   beam, shapes (initial), photo(team, name), pickPlayer({x, y, clientX, clientY}) → Promise<{name, team, no}|null>,
   *   editText({shape, box, done(text|null)}) — the page opens its input over the text,
   *   onChange(state), onSelect(shape|null) })
   * → { setTool, tool, set(key, value), undo, redo, canUndo, canRedo, del, clear, shapes, load, cancelCurrent,
   *     hasCurrent, finishCurrent, selected, render, editSelectedText, destroy }
   * EVERY change goes through the history (add, move, resize, delete, clear, style, text create / edit / move):
   * a snapshot of the shapes is kept before it, so undo / redo restore exactly.
   */
  function editor(svg, o) {
    o = o || {};
    const st = { tool: 'arrow', color: o.color === undefined ? '#ffd600' : o.color, layerColor: o.layerColor || '#4fc3f7', w: o.w || 4, fill: o.fill || 'none', alpha: o.alpha || 1,
      textStyle: o.textStyle || 'dark', beam: o.beam !== false, shapes: JSON.parse(JSON.stringify(o.shapes || [])), cur: null, sel: null, drag: null, hover: null, hist: [], redo: [], dead: false, styleRun: null };
    const WH = () => [+svg.getAttribute('width') || svg.clientWidth || 1, +svg.getAttribute('height') || svg.clientHeight || 1];
    const snap = () => JSON.stringify(st.shapes);
    const push = (before) => { st.hist.push(before == null ? snap() : before); if (st.hist.length > 200) st.hist.shift(); st.redo = []; };
    const changed = () => { try { o.onChange && o.onChange(api.state()); } catch (_) {} };
    const sel = () => st.sel != null ? st.shapes[st.sel] : null;
    const newShape = extra => { const s = Object.assign({ w: st.w }, extra); if (st.color) s.color = st.color; if (st.alpha < 1) s.alpha = st.alpha; return s; };
    function pos(e) { const r = svg.getBoundingClientRect(); return [clamp((e.clientX - r.left) / (r.width || 1), 0, 1), clamp((e.clientY - r.top) / (r.height || 1), 0, 1)]; }
    function hitIndex(x, y) { const [W, H] = WH(); for (let i = st.shapes.length - 1; i >= 0; i--) if (hit(st.shapes[i], x, y, W, H, 9)) return i; return null; }
    function hitHandle(x, y) { const s = sel(); if (!s) return null; const [W, H] = WH(); for (const h of handles(s, W, H)) if (Math.hypot((x - h.x) * W, (y - h.y) * H) <= 11) return h.id; return null; }
    function select(i) { st.sel = i; try { o.onSelect && o.onSelect(sel()); } catch (_) {} }

    function renderNow() {
      if (st.dead) return;
      const [W, H] = WH(), k = kOf(H);
      const list = st.shapes.concat(st.cur ? [st.cur] : []);
      let out = render([{ shapes: list, color: st.layerColor }], W, H, { id: 'ce', photo: o.photo });
      const c = st.cur;
      // the shape in progress: the next segment to the cursor, the first point (click it to close)
      if (c && st.hover && (c.type === 'poly' || c.type === 'link' || c.type === 'pen')) {
        const lp = c.type === 'pen' ? [c.nodes[c.nodes.length - 1].x, c.nodes[c.nodes.length - 1].y] : c.pts[c.pts.length - 1];
        const col = colOf(c, st.layerColor);
        out += '<line x1="' + f1(lp[0] * W) + '" y1="' + f1(lp[1] * H) + '" x2="' + f1(st.hover[0] * W) + '" y2="' + f1(st.hover[1] * H) + '" stroke="' + col + '" stroke-width="2" stroke-dasharray="6,5" opacity=".8"/>';
        const f = c.type === 'pen' ? [c.nodes[0].x, c.nodes[0].y] : c.pts[0], n = c.type === 'pen' ? c.nodes.length : c.pts.length;
        if (n >= 3) out += '<circle class="ct-close" cx="' + f1(f[0] * W) + '" cy="' + f1(f[1] * H) + '" r="' + f1(9 * k) + '" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="3,2"/>';
      }
      if (c && c.type === 'pen') c.nodes.forEach(n => { out += '<rect x="' + f1(n.x * W - 4) + '" y="' + f1(n.y * H - 4) + '" width="8" height="8" fill="#fff" stroke="#000"/>'; if (n.ix != null) out += penHandleSvg(n, W, H); });
      const s = sel();
      if (s) {
        const b = bbox(s, W, H);
        if (b) out += '<rect class="ct-sel" x="' + f1(b.x - 6) + '" y="' + f1(b.y - 6) + '" width="' + f1(b.w + 12) + '" height="' + f1(b.h + 12) + '" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="1" stroke-dasharray="4,3"/>';
        if (s.type === 'carrow') out += '<path d="M' + f1(s.x1 * W) + ' ' + f1(s.y1 * H) + 'L' + f1(s.cx * W) + ' ' + f1(s.cy * H) + 'L' + f1(s.x2 * W) + ' ' + f1(s.y2 * H) + '" fill="none" stroke="#fff" stroke-opacity=".6" stroke-dasharray="3,3"/>';
        if (s.type === 'pen') s.nodes.forEach(n => { if (n.ix != null) out += penHandleSvg(n, W, H); });
        handles(s, W, H).forEach(h => { if (h.from) return;
          out += h.round ? '<circle class="ct-h" data-h="' + h.id + '" cx="' + f1(h.x * W) + '" cy="' + f1(h.y * H) + '" r="6" fill="#fff" stroke="#000" stroke-width="1.4"/>'
            : '<rect class="ct-h" data-h="' + h.id + '" x="' + f1(h.x * W - 5) + '" y="' + f1(h.y * H - 5) + '" width="10" height="10" fill="#fff" stroke="#000" stroke-width="1.4"/>'; });
      }
      svg.innerHTML = out;
    }
    function penHandleSvg(n, W, H) {
      return '<line x1="' + f1(n.ix * W) + '" y1="' + f1(n.iy * H) + '" x2="' + f1(n.ox * W) + '" y2="' + f1(n.oy * H) + '" stroke="#fff" stroke-opacity=".7" stroke-width="1"/>'
        + '<circle class="ct-h" cx="' + f1(n.ix * W) + '" cy="' + f1(n.iy * H) + '" r="4.5" fill="#4fc3f7" stroke="#000"/><circle class="ct-h" cx="' + f1(n.ox * W) + '" cy="' + f1(n.oy * H) + '" r="4.5" fill="#4fc3f7" stroke="#000"/>';
    }

    function finishCurrent() {
      const c = st.cur; if (!c) return false;
      st.cur = null; st.hover = null;
      let keep = false;
      if (c.type === 'poly') keep = c.pts.length >= 2;
      else if (c.type === 'link') keep = c.pts.length >= 2;
      else if (c.type === 'pen') keep = c.nodes.length >= 2;
      if (keep) { push(); st.shapes.push(c); }
      renderNow(); changed(); return keep;
    }
    function closeCurrent() {
      const c = st.cur; if (!c) return;
      c.closed = true; if (st.fill !== 'none') { c.fill = st.fill; if (st.color) c.fillColor = st.color; }
      st.cur = null; st.hover = null; push(); st.shapes.push(c); renderNow(); changed();
    }
    function cancelCurrent() { if (!st.cur) return false; st.cur = null; st.hover = null; st.drag = null; renderNow(); changed(); return true; }

    // ── pointer ──
    let lastDown = 0, lastXY = [-9, -9];
    function down(e) {
      if (st.dead || e.button > 0) return;
      e.preventDefault(); try { svg.setPointerCapture(e.pointerId); } catch (_) {}
      const [x, y] = pos(e), [W, H] = WH(), now = Date.now();
      const dbl = now - lastDown < 350 && Math.hypot((x - lastXY[0]) * W, (y - lastXY[1]) * H) < 6;   // a double-click: same place, quickly
      lastDown = now; lastXY = [x, y];
      // the selected shape's handles: with the select tool, or with the tool that drew it (bend a curve you just drew)
      const sh = sel(), h = st.cur || !sh || (st.tool !== 'select' && st.tool !== sh.type) ? null : hitHandle(x, y);
      if (h) { st.drag = { mode: 'handle', h, before: snap() }; return; }
      if (st.tool === 'select') {
        const i = hitIndex(x, y);
        if (i != null) {
          select(i);
          if (dbl && st.shapes[i].type === 'text') { st.drag = null; renderNow(); editText(i, false); return; }
          st.drag = { mode: 'move', lx: x, ly: y, before: snap() };
        } else select(null);
        renderNow(); changed(); return;
      }
      if (dbl && st.tool !== 'pen' && st.tool !== 'poly' && st.tool !== 'link') { const i = hitIndex(x, y); if (i != null && st.shapes[i].type === 'text') { select(i); renderNow(); editText(i, false); return; } }
      const t = st.tool;
      if (t === 'poly' || t === 'link') {
        const c = st.cur;
        if (c && c.type === t) {
          const p0 = c.pts[0];
          if (c.pts.length >= 3 && Math.hypot((x - p0[0]) * W, (y - p0[1]) * H) <= 12) { closeCurrent(); return; }
          if (dbl) { finishCurrent(); return; }
          c.pts.push([x, y]);
        } else { select(null); st.cur = newShape({ type: t, pts: [[x, y]] }); }
        renderNow(); changed(); return;
      }
      if (t === 'pen') {
        const c = st.cur;
        if (c && c.type === 'pen') {
          const n0 = c.nodes[0];
          if (c.nodes.length >= 3 && Math.hypot((x - n0.x) * W, (y - n0.y) * H) <= 12) { closeCurrent(); return; }
          if (dbl) { c.nodes.pop(); finishCurrent(); return; }
          c.nodes.push({ x, y });
        } else { select(null); st.cur = newShape({ type: 'pen', nodes: [{ x, y }] }); }
        st.drag = { mode: 'pen', sx: x, sy: y };
        renderNow(); changed(); return;
      }
      select(null);
      if (t === 'text') {
        const s = newShape({ type: 'text', x, y: clamp(y - 0.03, 0, 0.95), text: 'Text', style: st.textStyle, size: 20 });
        push(); st.shapes.push(s); select(st.shapes.length - 1); renderNow(); changed(); editText(st.shapes.length - 1, true); return;
      }
      if (t === 'tag') {
        const pick = o.pickPlayer ? o.pickPlayer({ x, y, clientX: e.clientX, clientY: e.clientY }) : Promise.resolve(null);
        Promise.resolve(pick).then(p => {
          if (!p || !p.name || st.dead) return;
          const s = newShape({ type: 'tag', px: x, py: y, x: clamp(x + 0.035, 0, 0.8), y: clamp(y - 0.16, 0.01, 0.9), name: String(p.name).slice(0, 60) });
          if (p.team) s.team = String(p.team).slice(0, 60); if (p.no && /^\d{1,2}$/.test(String(p.no))) s.no = String(p.no);
          push(); st.shapes.push(s); renderNow(); changed();
        });
        return;
      }
      if (t === 'spot') { st.cur = newShape({ type: 'spot', cx: x, cy: y, rx: 0.045, ry: 0.045 * W / H * 0.3 }); if (st.beam) st.cur.beam = true; st.drag = { mode: 'spot', sx: x, sy: y }; renderNow(); return; }
      if (t === 'free') { st.cur = newShape({ type: 'free', pts: [[x, y]] }); renderNow(); return; }
      st.cur = newShape({ type: t, x1: x, y1: y, x2: x, y2: y });
      if (t === 'carrow') { st.cur.cx = x; st.cur.cy = y; }
      if ((t === 'rect' || t === 'ellipse') && st.fill !== 'none') { st.cur.fill = st.fill; if (st.color) st.cur.fillColor = st.color; }
      renderNow();
    }
    function moveEv(e) {
      if (st.dead) return;
      const [x, y] = pos(e), [W, H] = WH();
      const d = st.drag;
      if (d && d.mode === 'handle' && sel()) { applyHandle(sel(), d.h, x, y, W, H); renderNow(); return; }
      if (d && d.mode === 'move' && sel()) { move(sel(), x - d.lx, y - d.ly); d.lx = x; d.ly = y; renderNow(); return; }
      const c = st.cur;
      if (!c) return;
      if (d && d.mode === 'pen' && c.type === 'pen') {
        const n = c.nodes[c.nodes.length - 1];
        if (Math.hypot((x - d.sx) * W, (y - d.sy) * H) > 4) { n.ox = x; n.oy = y; n.ix = 2 * n.x - x; n.iy = 2 * n.y - y; }   // click-and-drag: a smooth point
        renderNow(); return;
      }
      if (c.type === 'poly' || c.type === 'link' || c.type === 'pen') { st.hover = [x, y]; renderNow(); return; }
      if (d && d.mode === 'spot') { const rx = Math.max(0.012, Math.abs(x - d.sx)); c.rx = rx; c.ry = Math.max(0.006, rx * W / H * 0.3 + Math.abs(y - d.sy) * 0.6); renderNow(); return; }
      if (c.type === 'free') { const l = c.pts[c.pts.length - 1]; if (Math.hypot((x - l[0]) * W, (y - l[1]) * H) >= 2) c.pts.push([x, y]); }
      else { c.x2 = x; c.y2 = y; if (c.type === 'carrow') { const q = autoCtrl(c.x1, c.y1, c.x2, c.y2, W, H); c.cx = q[0]; c.cy = q[1]; } }
      renderNow();
    }
    function up() {
      if (st.dead) return;
      const d = st.drag; st.drag = null;
      if (d && (d.mode === 'handle' || d.mode === 'move')) { if (snap() !== d.before) { push(d.before); changed(); } return; }
      if (d && d.mode === 'pen') return;            // the pen path goes on until it is closed / finished
      const c = st.cur;
      if (!c || c.type === 'poly' || c.type === 'link' || c.type === 'pen') return;
      const [W, H] = WH();
      let tiny = false;
      if (c.type === 'free') tiny = c.pts.length < 3;
      else if (c.type === 'spot') tiny = false;
      else tiny = Math.hypot((c.x2 - c.x1) * W, (c.y2 - c.y1) * H) < 4;
      st.cur = null;
      if (!tiny) { push(); st.shapes.push(c); if (c.type === 'carrow') select(st.shapes.length - 1); changed(); }   // a new curve shows its bend handle
      renderNow();
    }
    function dbl(e) { if (st.cur && (st.cur.type === 'poly' || st.cur.type === 'link')) { e.preventDefault(); finishCurrent(); } }
    function editText(i, isNew) {
      const s = st.shapes[i]; if (!s || !o.editText) return;
      const before = isNew ? null : snap(), [W, H] = WH(), b = textBox(s, W, H);
      o.editText({ shape: s, isNew, box: { x: b.x, y: b.y, w: b.w, h: b.h, fs: b.fs }, done: txt => {
        if (st.dead) return;
        const at = st.shapes.indexOf(s);
        if (txt == null) { if (isNew && at >= 0) { st.shapes.splice(at, 1); st.hist.pop(); select(null); } renderNow(); changed(); return; }   // cancelled
        txt = String(txt).replace(/\s+/g, ' ').trim().slice(0, 160);
        if (!txt) { if (at >= 0) { if (!isNew) push(before); st.shapes.splice(at, 1); if (isNew) st.hist.pop(); select(null); } renderNow(); changed(); return; }
        if (txt !== s.text) { if (!isNew) push(before); s.text = txt; }
        if (isNew && st.tool !== 'select') select(null);
        renderNow(); changed();
      } });
    }
    // a style change: on the selected shape (through the history) and for the next shapes
    function set(key, v) {
      const s = sel();
      if (key === 'color') st.color = v; else if (key === 'w') st.w = v; else if (key === 'fill') st.fill = v; else if (key === 'alpha') st.alpha = v;
      else if (key === 'textStyle') st.textStyle = v; else if (key === 'beam') st.beam = !!v; else if (key === 'layerColor') { st.layerColor = v; renderNow(); return; }
      if (!s) return;
      const run = key + ':' + st.sel;
      if (!(key === 'alpha' && st.styleRun === run)) push();     // one slider drag = one undo step
      st.styleRun = key === 'alpha' ? run : null;
      if (key === 'color') { if (v) s.color = v; else delete s.color; if (s.fillColor) { if (v) s.fillColor = v; else delete s.fillColor; } }
      else if (key === 'w') s.w = v;
      else if (key === 'alpha') { if (v < 1) s.alpha = v; else delete s.alpha; }
      else if (key === 'fill' && ['rect', 'ellipse', 'poly', 'link', 'pen'].includes(s.type) && (s.closed || s.type === 'rect' || s.type === 'ellipse')) { if (v === 'none') { delete s.fill; delete s.fillColor; } else s.fill = v; }
      else if (key === 'textStyle' && s.type === 'text') s.style = v;
      else if (key === 'beam' && s.type === 'spot') { if (v) s.beam = true; else delete s.beam; }
      else { st.hist.pop(); }                                        // nothing changed on this shape
      renderNow(); changed();
    }
    const api = {
      state: () => ({ tool: st.tool, n: st.shapes.length, canUndo: st.hist.length > 0 || !!st.cur, canRedo: st.redo.length > 0, sel: sel(), cur: !!st.cur }),
      tool: () => st.tool,
      setTool(t) { if (st.cur && st.cur.type !== t) finishCurrent(); st.tool = t; if (t !== 'select') { st.styleRun = null; } renderNow(); changed(); },
      set,
      undo() {
        if (st.cur) {                                                  // a path in progress: its last point first
          const c = st.cur, L = c.type === 'pen' ? c.nodes : c.pts;
          if (L && L.length > 1) { L.pop(); st.hover = null; } else st.cur = null;
          renderNow(); changed(); return true;
        }
        if (!st.hist.length) return false;
        st.redo.push(snap()); st.shapes = JSON.parse(st.hist.pop()); st.styleRun = null;
        if (st.sel != null && st.sel >= st.shapes.length) select(null); renderNow(); changed(); return true;
      },
      redo() { if (!st.redo.length) return false; st.hist.push(snap()); st.shapes = JSON.parse(st.redo.pop()); st.styleRun = null; if (st.sel != null && st.sel >= st.shapes.length) select(null); renderNow(); changed(); return true; },
      del() { if (st.sel == null || !st.shapes[st.sel]) return false; push(); st.shapes.splice(st.sel, 1); select(null); renderNow(); changed(); return true; },
      clear() { if (!st.shapes.length) return false; push(); st.shapes = []; select(null); renderNow(); changed(); return true; },
      shapes: () => JSON.parse(snap()),
      load(list) { st.shapes = JSON.parse(JSON.stringify(list || [])); st.hist = []; st.redo = []; select(null); renderNow(); changed(); },
      cancelCurrent, finishCurrent, hasCurrent: () => !!st.cur,
      selected: () => sel(), deselect() { select(null); renderNow(); },
      editSelectedText() { if (st.sel != null && st.shapes[st.sel] && st.shapes[st.sel].type === 'text') { editText(st.sel, false); return true; } return false; },
      render: renderNow,
      endStyleRun() { st.styleRun = null; },
      destroy() { st.dead = true; svg.removeEventListener('pointerdown', down); svg.removeEventListener('pointermove', moveEv); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up); svg.removeEventListener('dblclick', dbl); },
    };
    svg.addEventListener('pointerdown', down); svg.addEventListener('pointermove', moveEv); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up); svg.addEventListener('dblclick', dbl);
    renderNow();
    return api;
  }

  const CohTele = { render, editor, hit, handles, applyHandle, move, bbox, esc, colOf, initials, kOf, textBox, tagBox };
  if (typeof window !== 'undefined') window.CohTele = CohTele;
  if (typeof module !== 'undefined' && module.exports) module.exports = CohTele;
})();
