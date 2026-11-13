/**
 * TELESTRATION — the server's rules for drawings, comment colours and @mentions (Barry, Oct 2026).
 * Used by netlify/functions/playlists.js (and its tests). Nothing here touches the database.
 *
 * DRAWINGS are lists of SHAPES in fractions (0–1) of the video's 16:9 content rectangle, so they stay glued to the
 * pitch at any size. Two owners:
 *   · a staff clip drawing  — it.draws = [{t, shapes, caption?, videoId?, still?}] inside the playlist (edit rights =
 *                             the playlist's canEdit, as before);
 *   · a comment's drawing   — playlist_comments.drawing = {shapes, caption?}, pinned to the comment's moment (t) and
 *                             owned by the comment (its author edits it; the owner / admins remove it).
 * Everything the client sends is rebuilt here from a WHITELIST: known shape types only, known fields only, numbers
 * clamped, colours only as #rrggbb (anything else is dropped → the shape takes its comment's colour), text trimmed and
 * stripped of control characters (the page always renders it escaped), and hard caps on shapes and points.
 *
 * COLOURS: every comment gets one when it is created, by the server, and keeps it: the first comment on a clip (or on
 * the whole playlist) is COHESION blue, each later one the next colour of PALETTE (distinct, readable on grass). The
 * index is max(existing)+1, so deleting a comment never recolours the others.
 *
 * MENTIONS: a comment's text carries <@user-id> tokens; the page renders each as a highlighted @Name from the
 * comment's mentions list [{id, name}] (names only — never an email).
 */
'use strict';

const PALETTE = ['#4fc3f7',   // COHESION blue — the first comment
  '#ffd600',   // yellow
  '#ff5252',   // red
  '#69f0ae',   // green
  '#ff9100',   // orange
  '#b388ff',   // purple
  '#ff80ab',   // pink
  '#ffffff',   // white
  '#18ffff',   // cyan
  '#eeff41',   // lime
  '#ff6e40',   // coral
  '#8c9eff'];  // indigo
const colorOf = idx => PALETTE[((Number(idx) || 0) % PALETTE.length + PALETTE.length) % PALETTE.length];
// the next index for a new comment, from the comments already on its target (stored indexes; legacy ones by position)
function nextColorIdx(existing) {
  let max = -1;
  (existing || []).forEach((c, i) => { const n = c && c.color_idx != null && c.color_idx !== '' ? Number(c.color_idx) : i; if (Number.isFinite(n) && n > max) max = n; });
  return max + 1;
}

const MAX_SHAPES = 80, MAX_POINTS = 600, MAX_TOTAL_POINTS = 5000, MAX_NODES = 200, MAX_TEXT = 160, MAX_CAPTION = 200, MAX_STOPS = 40;
const TYPES = ['free', 'line', 'arrow', 'darrow', 'carrow', 'rect', 'ellipse', 'poly', 'spot', 'tag', 'link', 'text', 'pen', 'focus', 'mag', 'ring', 'mark', 'pitch', 'dist', 'pos'];
const HEX = /^#[0-9a-f]{6}$/i;
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n * 10000) / 10000)) : null; };
const frac = v => num(v, 0, 1);
const handle = v => num(v, -0.5, 1.5);          // curve handles may sit off the frame
const cleanText = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const color = v => typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : null;
const fillOf = v => v === true || v === 'solid' ? 'solid' : v === 'hatch' ? 'hatch' : null;

function pts(list, budget) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const p of list) {
    if (out.length >= MAX_POINTS || budget.n <= 0) break;
    if (!Array.isArray(p)) continue;
    const x = frac(p[0]), y = frac(p[1]); if (x == null || y == null) continue;
    out.push([x, y]); budget.n--;
  }
  return out;
}

// one shape → its clean copy, or null (unknown type / not enough geometry)
function cleanShape(s, budget) {
  if (!s || typeof s !== 'object' || Array.isArray(s) || !TYPES.includes(s.type)) return null;
  const o = { type: s.type };
  const c = color(s.color); if (c) o.color = c;
  const w = num(s.w, 1, 16); o.w = w == null ? 4 : w;
  const a = num(s.alpha, 0.1, 1); if (a != null && a !== 1) o.alpha = a;
  const XY = keys => { for (const k of keys) { const v = frac(s[k]); if (v == null) return false; o[k] = v; } return true; };
  const fill = () => { const f = fillOf(s.fill); if (f) { o.fill = f; const fc = color(s.fillColor); if (fc) o.fillColor = fc; } };
  switch (s.type) {
    case 'free': { const p = pts(s.pts, budget); if (!p || p.length < 2) return null; o.pts = p; break; }
    case 'line': case 'arrow': case 'darrow': case 'dist': if (!XY(['x1', 'y1', 'x2', 'y2'])) return null; break;
    case 'pitch': {                                             // 📐 the line-up with the pitch: its size and up to 16 matched points; rev = this camera sees the pitch the other way round from the main camera
      o.len = num(s.len, 100, 160) || 140; o.wid = num(s.wid, 60, 100) || 85; delete o.w;
      if (!Array.isArray(s.pts)) return null; const P = [], seen = new Set();
      for (const q of s.pts) { if (P.length >= 16 || budget.n <= 0) break; if (!q || typeof q !== 'object' || typeof q.k !== 'string' || !/^[ABH][a-z0-9]{1,6}$/.test(q.k) || seen.has(q.k)) continue;
        const x = handle(q.x), y = handle(q.y); if (x == null || y == null) continue; seen.add(q.k); P.push({ k: q.k, x, y }); budget.n--; }
      if (!P.length) return null; o.pts = P; if (s.show === false) o.show = false; if (s.rev === true) o.rev = true; delete o.color; delete o.alpha; break; }
    case 'pos': {                                               // 👥 the players marked on the lined-up frame: two teams (name, colour), up to 30 players and a ball
      delete o.w; delete o.color; delete o.alpha;
      ['a', 'b'].forEach(t => { const T = s['t' + t]; if (!T || typeof T !== 'object' || Array.isArray(T)) return; const q = {}; const nm = cleanText(T.name, 40); if (nm) q.name = nm; const c = color(T.color); if (c) q.color = c; o['t' + t] = q; });
      if (!Array.isArray(s.pl)) return null; const P = []; let ball = false, na = 0, nb = 0;
      for (const q of s.pl) { if (P.length >= 31 || budget.n <= 0) break; if (!q || typeof q !== 'object' || Array.isArray(q)) continue;
        const side = q.s === 'a' || q.s === 'b' || q.s === 'ball' ? q.s : null; if (!side) continue;
        if (side === 'ball') { if (ball) continue; ball = true; } else if (side === 'a' ? na >= 15 : nb >= 15) continue;
        const x = frac(q.x), y = frac(q.y); if (x == null || y == null) continue;
        const r = { x, y, s: side };
        if (side !== 'ball') { const no = cleanText(q.no, 3); if (/^\d{1,2}$/.test(no)) r.no = no; const nm = cleanText(q.nm, 60); if (nm) r.nm = nm; if (side === 'a') na++; else nb++; }
        P.push(r); budget.n--; }
      o.pl = P; o.map = ['off', 'tl', 'tr', 'bl', 'br'].includes(s.map) ? s.map : 'br';
      if (s.hull === true) o.hull = true; if (s.dots === false) o.dots = false; if (s.adef === 'A' || s.adef === 'B') o.adef = s.adef; break; }
    case 'carrow': { if (!XY(['x1', 'y1', 'x2', 'y2'])) return null; const cx = handle(s.cx), cy = handle(s.cy);
      o.cx = cx == null ? (o.x1 + o.x2) / 2 : cx; o.cy = cy == null ? (o.y1 + o.y2) / 2 : cy; break; }
    case 'rect': case 'ellipse': if (!XY(['x1', 'y1', 'x2', 'y2'])) return null; fill(); break;
    case 'poly': case 'link': { const p = pts(s.pts, budget); if (!p || p.length < (s.type === 'link' ? 1 : 2)) return null; o.pts = p;
      if (s.closed === true && p.length >= 3) { o.closed = true; fill(); } break; }
    case 'spot': { if (!XY(['cx', 'cy'])) return null; o.rx = num(s.rx, 0.004, 0.5) || 0.05; o.ry = num(s.ry, 0.002, 0.5) || 0.02; if (s.beam === true) o.beam = true; break; }
    case 'focus': { if (!XY(['cx', 'cy'])) return null; o.rx = num(s.rx, 0.01, 0.6) || 0.1; o.ry = num(s.ry, 0.01, 0.6) || 0.12;
      const d = num(s.dim, 0.2, 0.85); if (d != null) o.dim = d; break; }                          // a bright area; the rest of the picture darkened
    case 'ring': { if (!XY(['cx', 'cy'])) return null; o.rx = num(s.rx, 0.004, 0.5) || 0.05; o.ry = num(s.ry, 0.002, 0.5) || 0.02;   // a ring flat on the grass, up to 3 layers
      if (Array.isArray(s.rings)) { const L = [];
        for (const r of s.rings.slice(0, 3)) { if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
          const q = {}; const rc = color(r.c); if (rc) q.c = rc; q.r = num(r.r, 0.3, 1.6) || 1; q.segs = Math.round(num(r.segs, 0, 12) || 0);
          const g = num(r.gap, 0, 0.6); if (g) q.gap = g; q.t = num(r.t, 1, 16) || 4; L.push(q); }
        if (L.length) o.rings = L; }
      if (s.glow === true) o.glow = true; const sp = num(s.spin, 0, 360); if (sp) o.spin = sp; const rt = num(s.rot, -90, 90); if (rt) o.rot = rt; break; }
    case 'mark': { if (!XY(['x', 'y'])) return null; o.kind = ['tri', 'chev', 'dot', 'num'].includes(s.kind) ? s.kind : 'tri';   // a marker over a player
      if (o.kind === 'num') { const t = cleanText(s.text, 2); o.text = /^[A-Za-z0-9]{1,2}$/.test(t) ? t : '1'; } break; }
    case 'mag': { if (!XY(['cx', 'cy', 'lx', 'ly'])) return null; o.r = num(s.r, 0.02, 0.25) || 0.06; o.z = num(s.z, 1.5, 4) || 2.2; break; }   // source spot → lens
    case 'tag': { if (!XY(['x', 'y'])) return null; const px = frac(s.px), py = frac(s.py); if (px != null && py != null) { o.px = px; o.py = py; }
      o.name = cleanText(s.name, 60); if (!o.name) return null; const team = cleanText(s.team, 60); if (team) o.team = team;
      const no = cleanText(s.no, 3); if (/^\d{1,2}$/.test(no)) o.no = no; break; }
    case 'text': { if (!XY(['x', 'y'])) return null; o.text = cleanText(s.text, MAX_TEXT); if (!o.text) return null;
      o.style = ['plain', 'dark', 'box'].includes(s.style) ? s.style : 'plain'; const z = num(s.size, 10, 48); if (z != null) o.size = Math.round(z); break; }
    case 'pen': {
      if (!Array.isArray(s.nodes)) return null;
      const nodes = [];
      for (const n of s.nodes) {
        if (nodes.length >= MAX_NODES || budget.n <= 0) break;
        if (!n || typeof n !== 'object') continue;
        const x = frac(n.x), y = frac(n.y); if (x == null || y == null) continue;
        const q = { x, y };
        const ix = handle(n.ix), iy = handle(n.iy), ox = handle(n.ox), oy = handle(n.oy);
        if (ix != null && iy != null && ox != null && oy != null) { q.ix = ix; q.iy = iy; q.ox = ox; q.oy = oy; }
        nodes.push(q); budget.n -= 3;
      }
      if (nodes.length < 2) return null;
      o.nodes = nodes; if (s.closed === true && nodes.length >= 3) { o.closed = true; fill(); } break;
    }
  }
  return o;
}

// a drawing {shapes, caption?} → {drawing} | {error}. Over the caps is an ERROR (never a silent cut).
function cleanDrawing(d) {
  if (d == null) return { drawing: null };
  if (typeof d !== 'object' || Array.isArray(d)) return { error: 'drawing must be an object {shapes:[…]}' };
  if (!Array.isArray(d.shapes)) return { error: 'drawing.shapes must be a list' };
  if (d.shapes.length > MAX_SHAPES) return { error: 'Too many shapes in one drawing (at most ' + MAX_SHAPES + ')' };
  const raw = d.shapes.reduce((n, s) => n + (s && Array.isArray(s.pts) ? s.pts.length : 0) + (s && Array.isArray(s.nodes) ? s.nodes.length * 3 : 0), 0);
  if (raw > MAX_TOTAL_POINTS) return { error: 'This drawing has too many points (at most ' + MAX_TOTAL_POINTS + ')' };
  if (d.shapes.some(s => s && ((Array.isArray(s.pts) && s.pts.length > MAX_POINTS) || (Array.isArray(s.nodes) && s.nodes.length > MAX_NODES)))) return { error: 'A shape has too many points (at most ' + MAX_POINTS + ')' };
  const budget = { n: MAX_TOTAL_POINTS };
  const shapes = d.shapes.map(s => cleanShape(s, budget)).filter(Boolean);
  if (!shapes.length) return { drawing: null };
  const out = { shapes };
  const cap = cleanText(d.caption, MAX_CAPTION); if (cap) out.caption = cap;
  return { drawing: out };
}
// a staff clip's drawing stops (it.draws) — the same shape rules; a stop's still must be a path this playlist's
// uploads could have made (stillPathOk)
function cleanStops(list, pid) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const st of list.slice(0, MAX_STOPS)) {
    if (!st || typeof st !== 'object') continue;
    const t = num(st.t, 0, 1e6); if (t == null) continue;
    const c = cleanDrawing({ shapes: st.shapes, caption: st.caption });
    if (c.error || !c.drawing) continue;
    const o = Object.assign({ t }, c.drawing);
    if (typeof st.videoId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(st.videoId)) o.videoId = st.videoId;
    if (typeof st.still === 'string' && stillPathOk(st.still, pid)) o.still = st.still;
    out.push(o);
  }
  return out.length ? out : null;
}

// ── freeze-frame stills (private bucket "playlist-stills", supabase/telestration.sql) ──
const STILL_BUCKET = 'playlist-stills', MAX_STILL = 450000;
const STILL_RE = /^(\d{1,12})\/(c[a-z0-9]{1,24}|d[a-z0-9]{4,16}-\d{1,9})-[a-z0-9]{6,16}\.jpg$/;
const stillPathOk = (p, pid) => { const m = STILL_RE.exec(String(p || '')); return !!m && (pid == null || String(m[1]) === String(pid)); };
const isJpeg = buf => buf && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

// ── mentions ──
const TOKEN_RE = /<@([A-Za-z0-9_-]{1,64})>/g;
const mentionIds = text => [...new Set([...String(text || '').matchAll(TOKEN_RE)].map(m => m[1]))].slice(0, 20);
// a comment's text with its tokens as plain @Name (emails, the activity log)
const plainText = (text, mentions) => String(text || '').replace(TOKEN_RE, (_m, id) => { const p = (mentions || []).find(x => String(x.id) === id); return '@' + (p ? p.name : 'someone'); });
// keep tokens only for the allowed people; any other becomes plain text (@Name when known, else @someone)
function resolveMentions(text, allowed, known) {
  const keep = [], ok = new Map((allowed || []).map(p => [String(p.id), p]));
  const out = String(text || '').replace(TOKEN_RE, (_m, id) => {
    const p = ok.get(id); if (p) { if (!keep.some(k => k.id === p.id)) keep.push({ id: String(p.id), name: String(p.name || 'Member').slice(0, 80) }); return '<@' + id + '>'; }
    const k = (known || []).find(x => String(x.id) === id); return '@' + (k ? k.name : 'someone');
  });
  return { text: out, mentions: keep };
}

// ✨ the team's shared drawing styles (a shape's LOOK, never a position): at most 40, every field checked
const STYLE_TOOLS = ['free', 'line', 'arrow', 'darrow', 'carrow', 'rect', 'ellipse', 'poly', 'spot', 'tag', 'link', 'text', 'pen', 'focus', 'ring', 'mark', 'dist'];
function cleanStyles(list) {
  const out = [], seen = new Set();
  for (const m of Array.isArray(list) ? list : []) {
    if (out.length >= 40) break;
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    const name = cleanText(m.name, 30); if (!name || seen.has(name.toLowerCase()) || !STYLE_TOOLS.includes(m.tool)) continue;
    const o = { name, tool: m.tool }; seen.add(name.toLowerCase());
    const c = color(m.color); if (c) o.color = c; const w = num(m.w, 1, 16); if (w != null) o.w = w; const a = num(m.alpha, 0.1, 1); if (a != null && a !== 1) o.alpha = a;
    const f = fillOf(m.fill); if (f) o.fill = f;
    if (m.tool === 'ring' && m.ringStyle && typeof m.ringStyle === 'object') { const r = cleanShape({ type: 'ring', cx: 0.5, cy: 0.5, rings: m.ringStyle.rings, glow: m.ringStyle.glow }, { n: 100 });
      if (r && r.rings) o.ringStyle = { rings: r.rings, glow: !!r.glow }; }
    if (m.tool === 'mark' && ['tri', 'chev', 'dot', 'num'].includes(m.markKind)) o.markKind = m.markKind;
    const t = num(m.tilt, 0.12, 1); if (t != null && ['ring', 'spot', 'focus'].includes(m.tool)) o.tilt = t;
    if (m.tool === 'spot' && typeof m.beam === 'boolean') o.beam = m.beam;
    if (m.tool === 'text' && ['plain', 'dark', 'box'].includes(m.textStyle)) o.textStyle = m.textStyle;
    const by = cleanText(m.by, 60); if (by) o.by = by;
    out.push(o);
  }
  return out;
}

module.exports = { PALETTE, colorOf, nextColorIdx, cleanShape, cleanDrawing, cleanStops, TYPES, cleanStyles,
  MAX_SHAPES, MAX_POINTS, MAX_TOTAL_POINTS, MAX_NODES, STILL_BUCKET, MAX_STILL, STILL_RE, stillPathOk, isJpeg,
  TOKEN_RE, mentionIds, plainText, resolveMentions };
