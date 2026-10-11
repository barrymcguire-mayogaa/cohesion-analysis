/* COHESION — merge a second XML into an open game (shared helper, Code Room)
 *
 * A game is stored from ONE file. This helper reads a SECOND file of the same
 * match (a different analyst's coding), lines its clock up with the game's, pairs
 * the events the two have in common and lists what the file can add:
 *   · an event in BOTH: by default the game's own row stays as it is (timing, players,
 *     labels) and only the details it LACKS are copied from the file — a value the
 *     game has is never replaced, with ONE exception: a real player name from the
 *     file replaces a "P13" jersey tag;
 *   · an event ONLY in the file: added, converted to COHESION's own rows.
 * Nothing here touches the game: cohMergePlan → a plan (what is in each, what
 * pairs, what would be added / filled, what is left out and why), cohMergeOps →
 * the adds / edits / removals for the user's choices, cohMergeApply → the same on
 * a plain event list (the headless tests; Code Room queues the ops itself).
 *
 * ONLY CONVERTED ROWS ARE ADDED. The file's shots, kickouts and turnovers are read
 * exactly as the admin upload reads that format and converted by the existing rules
 * (cohesion-gi.js cohGiConvert: SHOT OPEN PLAY / DEADBALL + score row, KO + break
 * rows + the KICKOUT LOST turnover, "<LOSER> TOs"), but the file's ORIGINAL rows
 * are not added. Two files number their events 1, 2, 3 … independently, and every
 * "superseded original" rule works on those ids ('GI Source ID' = the original's
 * id), so a second file's originals would collide with the game's; and a game
 * holding two raw formats at once would be read twice by every format rule. A
 * merged row therefore looks like a row coded in Code Room and carries
 *   'Merge Source ID' = "<file tag>:<the event's id in that file>"
 * (never 'GI Source ID'); the labels of the file's event that the conversion does
 * not use (ShootingIntent, PitchArea, PossFrom …) are kept on it. The marker makes
 * a second merge of the same file find those rows already there.
 *
 * GIU-ONLY ROWS (the admin upload stores them raw; here they are converted):
 *   "<Team> Foul"        → "<TEAM> FOUL", 'Foul Areas' from PitchArea (the fouling
 *                          team's view: Own → DEFENSIVE, Middle, Opp → ATTACKING THIRD)
 *   "<Team> Poss"        → "<TEAM> TEAM POSSESSION", same span, PossFrom / PitchArea kept
 *   "<Team> Turnover"    → "<TEAM> TOs" (that team LOST it), 'Turnover Locations' from PitchArea
 *   "<Team> Solo and Go" → "<TEAM> SOLO AND GO"
 *   "Throw Up"           → "HOP BALL" (no team; never THROW-IN, which starts a half)
 *   any other row        → the same name in capitals with its labels, OFF by default
 *                          (no meaning is invented for it).
 * FREE AGAINST: a file foul BY a team whose own turnover starts within FA_WINDOW
 * seconds is that turnover's type — offered only where the turnover's type is blank.
 * (These are cohesion-gi.js's own conversions — "GIU: OTHER ROWS" — so a merged row and a converted GIU game agree.)
 *
 * CLOCKS. The game's clock is the reference. Per half there are up to three readings of the offset (game − file):
 *   shots     the offset most same-team SHOTS agree on (median of those pairs);
 *   kickouts  the same from the KICKOUTS — two analysts stamp a kickout several seconds apart (the kick v the catch),
 *             so this reading carries that habit;
 *   throw-in  the file's period start (GIU "P1 / P2 START", the Gaelic Insights "NA Whistle" that starts the half)
 *             against the game's own (the moment its rows' gameTime counts from: "1H 00:00") — one event, so it is
 *             only as good as that one tag; "not available" when either side has none.
 * The half's offset is the first of: one typed or set from the video by the user, the shots when confident, the
 * kickouts when confident, the throw-in. Every event of the file in that half is moved by that ONE offset, so the
 * file's own order is kept; all readings are reported and a half whose readings differ by more than CHECK_GAP seconds
 * is flagged for a look at the video. Pairing allows each event type its own measured lag (kickouts ≈ 5 s here). A
 * half with no offset gets nothing merged. driveT / gameTime are written the way the game's own rows carry them.
 *
 * PLAYER NUMBERS. A GIU file names a player only by jersey number ("P13" = number 13 of that team). It is turned into
 * the name at that number on the game's team sheet (cohesion-gi.js cohGiuRosterName: meta.rosters[side], the admin's
 * P-tag map first) when there is one; with no player at that number the row keeps "P13" — never a guess. A row whose
 * name came from a number remembers the number and the name written (`pTag`, `pTagName`). cohPTagFixes lists every
 * value that is STILL a bare P-number, and every remembered name whose number now has a different player on the
 * sheet (see P-NUMBERS); a value someone typed is never touched.
 *
 * A FORMAT is an adapter (ADAPTERS): text → the file's events as the admin upload
 * reads them. Gaelic Insights and GIU are supported; any other format is refused
 * by name, never guessed.
 *
 * Loaded by code-room.html (after cohesion-gi.js); require()-able from node.
 */
(function(root){
  const GI = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./cohesion-gi.js') : root;
  const GI_SRC = 'GI Source ID', MERGE_SRC = 'Merge Source ID';
  const HALVES = ['1st Half','2nd Half','ET 1st Half','ET 2nd Half'], HALF_PFX = { '1st Half':'1H', '2nd Half':'2H', 'ET 1st Half':'ET1', 'ET 2nd Half':'ET2' };
  const FA_WINDOW = 4;          // seconds between a team's foul and its own turnover (file clock)
  const EST_WINDOW = 4;         // ± seconds: anchors that agree on one offset
  const BIAS_WINDOW = 20;       // ± seconds searched for an event type's own lag
  const TOL = { ko:8, shot:8, to:10 };   // ± seconds round the lag within which two events are the same one
  const TOL_DEFAULT = 8;
  const CHECK_GAP = 3;          // seconds: readings of one half further apart than this are flagged
  const EDGE = 600, BREAK = 240;         // a file with no half labels: how far outside a half's anchors an event may sit; a gap this long is a break
  const KIND_NAME = { shot:'Shots', ko:'Kickouts', to:'Turnovers', foul:'Fouls', poss:'Possessions', solo:'Solo and Go', hop:'Throw Up → HOP BALL' };
  const KIND_WORD = { shot:['shot','shots'], ko:['kickout','kickouts'], to:['turnover','turnovers'], foul:['foul','fouls'], poss:['possession','possessions'],
    solo:['solo and go','solo and go'], hop:['hop ball','hop balls'] };
  const KIND_ORDER = ['shot','ko','to','foul','poss','solo','hop'];
  const MODES = ['fill','file','both','none'];

  const up = s => String(s == null ? '' : s).trim().toUpperCase();
  const fin = v => v != null && v !== '' && isFinite(+v);
  const lbl = (e, g) => { const L = (e && e.labels) || {}; return L[g] != null ? String(L[g]).trim() : ''; };
  const keyCI = (L, g) => { if(!L) return null; if(Object.prototype.hasOwnProperty.call(L, g)) return g; const w = String(g).toLowerCase(); for(const k of Object.keys(L)) if(k.toLowerCase() === w) return k; return null; };
  const valCI = (e, names) => { const L = (e && e.labels) || {}; for(const n of names){ const k = keyCI(L, n); if(k != null && L[k] != null && String(L[k]).trim()) return String(L[k]).trim(); } return ''; };
  const median = a => { if(!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; };
  const clone = o => JSON.parse(JSON.stringify(o));
  const isPTag = s => /^P\s*\d+$/i.test(String(s || '').trim());
  const pTagOf = s => { const m = /^P\s*(\d+)$/i.exec(String(s || '').trim()); return m ? 'P' + (+m[1]) : ''; };
  const clockOf = t => { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const plural = (n, w) => n + ' ' + (n === 1 ? w[0] : w[1]);

  // ── reading a file ──────────────────────────────────────────────
  function unesc(s){ return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
  function tagOf(block, name){ const m = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>').exec(block); return m ? unesc(m[1]).trim() : ''; }
  function instancesOf(text){
    return (String(text || '').match(/<instance>[\s\S]*?<\/instance>/g) || []).map(b => ({
      id: tagOf(b, 'ID'), code: tagOf(b, 'code'), start: parseFloat(tagOf(b, 'start') || 0), end: parseFloat(tagOf(b, 'end') || 0),
      labels: (b.match(/<label>[\s\S]*?<\/label>/g) || []).map(l => [tagOf(l, 'group'), tagOf(l, 'text')]) }));
  }
  function hash6(text){ let h = 0x811c9dc5; const s = String(text || ''); for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('00000000' + h.toString(16)).slice(-8).slice(0, 6); }

  // The format, by the admin upload's own rule (admin.html): <ALL_INSTANCES> with P1 / P2 START = GIU, with
  // "1st Half" / "2nd Half" rows = Sportscode, with neither = Gaelic Insights; no <ALL_INSTANCES> = Sportscode.
  function cohMergeDetect(text){
    const t = String(text || '').replace(/^\uFEFF/, '').trim();
    const no = (format, name) => ({ format, name, supported:false, message: name + ' files cannot be merged yet — only Gaelic Insights and GIU XML files are supported. Nothing was read from this file.' });
    if(!t) return { format:'empty', name:'Empty file', supported:false, message:'This file is empty.' };
    if(/^[\[{]/.test(t)) return no('tracker-json', 'Gaelic Tracker JSON');
    if(!/<instance>/i.test(t)) return { format:'unknown', name:'Unknown file', supported:false, message:'This is not a timeline XML this tool can read (no <instance> events were found). Nothing was read from it.' };
    const codes = instancesOf(t).map(i => i.code), all = /<ALL_INSTANCES>/.test(t);
    const format = (all && codes.some(c => /^P[12] START$/.test(c))) ? 'giu'
      : (all && codes.some(c => /^(?:ET\s)?[12](?:st|nd)\sHalf$/.test(c))) ? 'sportscode' : all ? 'gaelic-insights' : 'sportscode';
    const A = ADAPTERS[format];
    return A ? { format, name:A.name, supported:true, message:'' } : no(format, 'Sportscode / Match Tracker XML');
  }

  // A row's team: the game's home / away team its code starts with (the admin upload's rule), in capitals.
  function teamOfCode(code, game){
    const c = String(code || '').toLowerCase(), H = String((game && game.homeTeam) || ''), A = String((game && game.awayTeam) || '');
    if(H && c.startsWith(H.toLowerCase() + ' ')) return H.toUpperCase();
    if(A && c.startsWith(A.toLowerCase() + ' ')) return A.toUpperCase();
    return '';
  }
  // The team names a file's rows carry: what stands before a known row name.
  const ROW_TAIL = /\s+(shot(?:\s*\(\s*[pf]\s*\)|\s+sideline)?|kickout|turnovers?(?:\s+won|\s+lost)?|poss|foul|sideline|goalkeeper|out\s+for\s+'?45|'?45|penalty|solo\s+and\s+go|op\s+wide|tackle|free|mark)\s*$/i;
  function fileTeams(codes){ const s = new Map(); codes.forEach(c => { const m = ROW_TAIL.exec(c); if(m){ const t = c.slice(0, m.index).trim(); if(t) s.set(t.toUpperCase(), t); } }); return [...s.values()]; }

  const ADAPTERS = {
    // GIU: one <instance> per event with all its labels; P1 / P2 START are markers; every row says its Half.
    'giu': { name:'GIU XML', short:'giu', consumed:['ShotOutcome','KickoutOutcome','KODistance','Player'],
      read(text, game){
        const raw = [], markers = [];
        instancesOf(text).forEach(i => {
          if(/^P\d START$/.test(i.code)){ markers.push(i); return; }
          const labels = {}; i.labels.forEach(([g, t]) => { if(g && t) labels[g] = t; });
          raw.push({ id: i.id || String(raw.length + 1), start:i.start, end:i.end, half: labels['Half'] || null, code:i.code, team: teamOfCode(i.code, game),
            player: labels['Player'] || '', outcome: labels['ShotOutcome'] || labels['KickoutOutcome'] || labels['PossFrom'] || '', subtype: labels['KODistance'] || labels['PitchArea'] || '', labels });
        });
        const starts = {}; markers.forEach(m => { const h = HALVES[+/^P(\d)/.exec(m.code)[1] - 1]; if(h && starts[h] == null) starts[h] = m.start; });
        return { raw, starts, startName:'P START', skipped: markers.length ? [{ code:'P1 / P2 START', n:markers.length, reason:'period markers — not events (read for the throw-in reading)' }] : [] };
      } },
    // Gaelic Insights: one <instance> per LABEL (merged by <ID>), labels renamed as stored; NA Whistle is ignored by the
    // import. The file says no half: each event's half comes from the alignment with the game.
    'gaelic-insights': { name:'Gaelic Insights XML', short:'gi', consumed:['Assist','Description','Outcome','KickoutOutcome','KickoutLength','TurnoverZone','Source','Player'],
      read(text, game){
        const map = new Map(), whistles = new Map();
        instancesOf(text).forEach(i => {
          if(!i.id) return;
          if(i.code === 'NA Whistle'){ whistles.set(i.id, i.start); return; }
          if(!map.has(i.id)) map.set(i.id, { id:i.id, start:i.start, end:i.end, code:i.code, L:{} });
          const l = i.labels[0]; if(l && l[0] && l[1]) map.get(i.id).L[l[0]] = l[1];
        });
        const raw = [...map.values()].sort((a, b) => a.start - b.start).map(ev => { const L = ev.L, c = {};
          if(L['Assist']) c['Assist'] = L['Assist']; if(L['Description']) c['Description'] = L['Description']; if(L['Outcome']) c['Outcome'] = L['Outcome'];
          if(L['PO_Result']) c['KickoutOutcome'] = L['PO_Result']; if(L['Kickout_Length']) c['KickoutLength'] = L['Kickout_Length'];
          if(L['turnover_zone']) c['TurnoverZone'] = L['turnover_zone']; if(L['Source']) c['Source'] = L['Source'];
          return { id:ev.id, start:ev.start, end:ev.end, half:null, code:ev.code, team: teamOfCode(ev.code, game), player: L['Player'] || '',
            outcome: L['Outcome'] || '', subtype: L['Description'] || L['Kickout_Length'] || '', labels:c }; });
        // the whistles that START a period (the upload's own reading): the first one; then every whistle with play resuming within
        // 300 s that follows a break of 240 s or more, or is the first whistle after an end-of-period one (no play within 300 s of it)
        const W = [...new Set(whistles.values())].sort((a, b) => a - b), play = raw.map(e => e.start), starts = {}, list = [];
        const after = t => { for(const g of play) if(g >= t) return g; return null; }, gapBefore = t => { let p = null; for(const g of play){ if(g < t) p = g; else break; } return p == null ? Infinity : t - p; };
        const resumes = t => { const f = after(t); return f != null && f - t <= 300; };
        W.forEach((t, i) => { if(!i){ list.push(t); return; } if(!resumes(t)) return; if(gapBefore(t) >= BREAK || !resumes(W[i-1])) list.push(t); });
        list.forEach((t, i) => { if(HALVES[i]) starts[HALVES[i]] = t; });
        return { raw, starts, startName:'NA Whistle', skipped: whistles.size ? [{ code:'NA Whistle', n:whistles.size, reason:'period whistles — the import ignores them (read for the throw-in reading)' }] : [] };
      } },
  };

  // ── the file's events as COHESION rows ──────────────────────────
  const thirdOf = txt => { const K = up(txt); return /DEFENSIVE|\bDEF\b|\bOWN\b/.test(K) ? 'DEFENSIVE THIRD' : /MIDDLE|\bMID\b/.test(K) ? 'MIDDLE THIRD' : /ATTACKING|OFFENSIVE|\bATT\b|\bOPP/.test(K) ? 'ATTACKING THIRD' : ''; };
  function catOf(code){
    const c = up(code);
    if(/SHOT|1 POINT|2 POINT|WIDE|GOAL|SAVE|BLOCKED|SHORT|WOODWORK/.test(c)) return 'Shots & Scores';
    if(/KO|KICKOUT/.test(c) && !/SCORE|ATTACK/.test(c)) return 'Kickouts';
    if(/FOUL|CARD|TECHNICAL/.test(c)) return 'Fouls';
    if(/TOS|TURNOVER/.test(c)) return 'Turnovers';
    if(/TACKLE/.test(c)) return 'Tackles';
    if(/ATTACKS|ENTRY|POSSESSION|SCORE SOURCE|SCORE ASSIST|SHOT SOURCE|SHOT ASSIST/.test(c)) return 'Possession & Attack';
    return 'Other';
  }
  // → [{ key, srcId, kind, team, ft, fe, half, code (the file's), rows:[main, companions…] }] + what cannot be converted
  function fileItems(raw, game, adapter, keep){
    const derived = GI.cohGiConvert(raw, game, { carry:false, fa:false }), bySrc = new Map(), items = [], out = [];   // (FREE AGAINST is the merge's own, ticked, step)
    derived.forEach(d => { const s = lbl(d, GI_SRC); if(!bySrc.has(s)) bySrc.set(s, []); bySrc.get(s).push(d); });
    const consumed = new Set(adapter.consumed.map(s => s.toLowerCase()));
    const extra = (e, also) => { const o = {}; Object.keys(e.labels || {}).forEach(g => { const w = g.toLowerCase();
      if(consumed.has(w) || (also && also.indexOf(w) >= 0)) return;
      if((w === 'half' || w === 'quarter') && !keep[w]) return;
      if(e.labels[g] != null && String(e.labels[g]).trim()) o[g] = String(e.labels[g]).trim(); }); return o; };
    const leave = (e, reason) => { const k = e.code + '\u0001' + reason, hit = out.find(x => x.k === k); if(hit) hit.n++; else out.push({ k, code:e.code, n:1, reason }); };
    raw.forEach(e => {
      const id = String(e.id), d = bySrc.get(id), base = { key:id, srcId:id, team:e.team, ft:e.start, fe:Math.max(e.start, e.end), half:e.half, code:e.code };
      if(d && d.length){
        const main = d[0], MC = up(main.code), kind = /SHOT (OPEN|DEAD)/.test(MC) ? 'shot' : GI.cohGiIsDerivedKo(main) ? 'ko' : GI.cohGiIsDerivedTo(main) ? 'to'
          : /TEAM POSSESSION$/.test(MC) ? 'poss' : /FOUL$/.test(MC) ? 'foul' : /SOLO AND GO$/.test(MC) ? 'solo' : 'hop';
        const rows = d.map(r => { const c = clone(r); delete c.labels[GI_SRC]; delete c.videoT; return c; });
        // the file's labels the conversion did not use (PitchArea is used when it became the row's third)
        const used = (rows[0].labels['Foul Areas'] || rows[0].labels['Turnover Locations']) ? ['pitcharea'] : null, more = extra(e, used);
        Object.keys(more).forEach(g => { if(keyCI(rows[0].labels, g) == null) rows[0].labels[g] = more[g]; });
        const tg = pTagOf((e.labels || {})['Player'] || e.player);
        if(tg && kind === 'shot'){ base.pTag = tg; base.pName = isPTag(rows[0].player) ? '' : rows[0].player; }
        items.push(Object.assign(base, { kind, team: kind === 'hop' ? '' : up(main.team) || e.team, rows }));
        return;
      }
      const C = String(e.code || '').trim(), T = e.team, rest = T ? C.slice(T.length).trim() : C, R = up(rest);
      const row = (code, labels, also) => ({ id:'', code, team:T, start:e.start, end:e.end, half:e.half, player:'', outcome:'', subtype:'', category:catOf(code),
        labels: Object.assign({}, labels, extra(e, also)) });
      const withPlayer = r => { const tag = String((e.labels || {})['Player'] || e.player || '').trim(); if(!tag || !T) return r;
        const p = (isPTag(tag) && GI.cohGiuRosterName(game, T, tag)) || tag; r.player = p; r.labels[T + ' Player Labels'] = p;
        if(isPTag(tag)){ base.pTag = pTagOf(tag); base.pName = isPTag(p) ? '' : p; if(base.pName){ r.pTag = base.pTag; r.pTagName = p; } } return r; };
      if(/kickout$/i.test(C) && T){   // kept as an event (it can pair with the game's kickout) but there is nothing to convert
        const v = String((e.labels || {})['KickoutOutcome'] || '').trim();
        items.push(Object.assign(base, { kind:'ko', rows:[], bad:'its kickout outcome ' + (v ? '“' + v + '” ' : '') + 'cannot be read as won or lost by either team' })); return; }
      if(/turnovers?\s+won$/i.test(C)){ leave(e, 'the team that lost the ball could not be read'); return; }
      if(/shot/i.test(C) && T && GI.cohGiIsShot(e)){ leave(e, 'the shot could not be converted'); return; }
      if(!R){ leave(e, 'no row name'); return; }
      // any other row: the same name in capitals, its labels, no meaning added
      // (category 'Other' whatever the name: "GOALKEEPER" / "OP WIDE" must not be filed under shots by their spelling)
      items.push(Object.assign(base, { kind:'x:' + R, name: rest, rows:[Object.assign(withPlayer(row((T ? T + ' ' : '') + R, {}, null)), { category:'Other' })] }));
    });
    return { items, out: out.map(x => ({ code:x.code, n:x.n, reason:x.reason })) };
  }

  // ── the game's events ───────────────────────────────────────────
  const gameT = e => fin(e.start) ? +e.start : fin(e.driveT) ? +e.driveT : null;
  const isKoRow = e => /(^|\s)(KO|KICKOUTS?)\s*$/i.test(String((e && e.code) || '').trim()) && !/\bTOS?\b|TURNOVER/i.test((e && e.code) || '');
  const TO_OUT = ['Turnover Outcomes','Turnover Outcome','TurnoverOutcome'], TO_LOC = ['Turnover Locations','Turnover Location','turnover_zone','TurnoverZone','PitchArea'];
  const FOUL_LOC = ['Foul Areas','Foul Area','PitchArea'];
  function gameKind(e, game){
    const C = up(e.code);
    if(lbl(e, GI_SRC) && GI.cohGiIsCompanion(e)) return null;
    if(/SHOT (OPEN PLAY|DEAD ?BALL)\s*$/.test(C)) return 'shot';
    if(isKoRow(e)) return 'ko';
    if(/(\bTOS|\sTURNOVERS?(\s+LOST)?)\s*$/.test(C)) return /KICK\s*OUT LOST|\bKO LOST\b/.test(up(valCI(e, TO_OUT) || e.outcome)) ? null : 'to';
    if(/\sTURNOVERS?\s+WON\s*$/.test(C)) return null;
    if(/\sFOUL\s*$/.test(C) && !/TECHNICAL/.test(C)) return 'foul';
    if(/\sTEAM POSSESSION\s*$/.test(C) || /\sPOSS\s*$/.test(C)) return 'poss';
    if(/\sSOLO AND GO\s*$/.test(C)) return 'solo';
    if(C === 'HOP BALL' || C === 'THROW UP') return 'hop';
    const T = up(e.team) || teamOfCode(e.code, game);
    return 'x:' + (T && C.startsWith(T + ' ') ? C.slice(T.length + 1).trim() : C);
  }
  function gameItems(events, game){
    const sup = GI.cohGiSupersededFn(events), out = [];
    (events || []).forEach((e, i) => { if(!e || !e.code || sup(e)) return;
      const kind = gameKind(e, game), t = gameT(e); if(!kind || t == null) return;
      out.push({ i, e, kind, team: up(e.team) || teamOfCode(e.code, game), t, half: e.half || '', marker: lbl(e, MERGE_SRC) }); });
    return out;
  }

  // ── alignment ───────────────────────────────────────────────────
  // closest-first pairs of same-team events with |game − file − off − bias| ≤ tol
  function pairUp(G, F, off, tol, bias){
    const c = []; bias = bias || 0;
    G.forEach((g, a) => F.forEach((f, b) => { if(g.team !== f.team) return; const d = g.t - f.ft - off; if(Math.abs(d - bias) <= tol) c.push({ a, b, d }); }));
    c.sort((x, y) => Math.abs(x.d - bias) - Math.abs(y.d - bias) || x.a - y.a);
    const ua = new Set(), ub = new Set(), out = [];
    c.forEach(p => { if(ua.has(p.a) || ub.has(p.b)) return; ua.add(p.a); ub.add(p.b); out.push({ g:G[p.a], f:F[p.b], d:p.d }); });
    return out;
  }
  // The offset most same-team pairs agree on (a window of ±EST_WINDOW s), its pairs, and the next best elsewhere.
  function estimate(G, F){
    const diffs = []; G.forEach(g => F.forEach(f => { if(g.team === f.team) diffs.push(g.t - f.ft); }));
    if(!diffs.length) return null;
    diffs.sort((a, b) => a - b);
    let best = null, j = 0;
    for(let i = 0; i < diffs.length; i++){ while(diffs[i] - diffs[j] > 2 * EST_WINDOW) j++; if(!best || i - j + 1 > best.n) best = { n:i - j + 1, c:(diffs[j] + diffs[i]) / 2 }; }
    let second = 0; j = 0;
    for(let i = 0; i < diffs.length; i++){ while(diffs[i] - diffs[j] > 2 * EST_WINDOW) j++;
      if(Math.abs((diffs[j] + diffs[i]) / 2 - best.c) > 4 * EST_WINDOW) second = Math.max(second, i - j + 1); }
    let pairs = pairUp(G, F, best.c, EST_WINDOW + 2, 0);
    if(!pairs.length) return null;
    const offset = Math.round(median(pairs.map(p => p.g.t - p.f.ft)) * 100) / 100;
    pairs = pairUp(G, F, offset, EST_WINDOW + 2, 0);
    return { offset, pairs, second };
  }
  const confident = (est, nG, nF) => !!est && est.pairs.length >= 3 && est.pairs.length >= 0.5 * Math.min(nG, nF) && est.pairs.length >= 2 * est.second;

  // how the game's own rows in a half carry driveT and gameTime, relative to start
  function halfClock(events, half){
    const dk = [], ref = [];
    (events || []).forEach(e => { if(!e || (half != null && e.half !== half) || !fin(e.start)) return;
      if(fin(e.driveT)) dk.push(+e.driveT - +e.start);
      const m = /^(1H|2H|ET1|ET2)\s+(\d+):(\d\d)$/.exec(String(e.gameTime || '').trim());
      if(m && (half == null || m[1] === HALF_PFX[half])) ref.push(+e.start - (+m[2] * 60 + +m[3])); });
    return { n:dk.length, k: dk.length ? Math.round(median(dk)) : null, ref: ref.length ? Math.round(median(ref)) : null };
  }
  function placeRow(r, item, half, off, clock, marker, id){
    const row = clone(r), start = Math.round(item.ft + off), end = Math.max(start, Math.round(item.fe + off));
    // a companion keeps its place inside the event (the mapped rows all share the event's window)
    row.id = id; row.start = start; row.end = end; row.half = half;
    row.driveT = Math.max(0, start + (clock.k == null ? 0 : clock.k));
    if(clock.ref != null && HALF_PFX[half]){ const rel = Math.max(0, start - clock.ref); row.gameTime = HALF_PFX[half] + ' ' + String(Math.floor(rel / 60)).padStart(2, '0') + ':' + String(rel % 60).padStart(2, '0'); }
    else delete row.gameTime;
    row.labels = row.labels || {}; row.labels[MERGE_SRC] = marker;
    return row;
  }

  // ── what a paired file event adds to the game's row ─────────────
  const SKIP_FILL = /^(half|quarter)$/i;
  const ALIAS = [TO_LOC, TO_OUT, FOUL_LOC, ['Kickout Locations','KickoutLength','KODistance'], ['Kickout Outcomes','KickoutOutcome'], ['Shot Outcomes','ShotOutcome','Outcome']];
  const aliasOf = g => { const w = String(g).toLowerCase(); const a = ALIAS.find(x => x.some(n => n.toLowerCase() === w)); return a || [g]; };
  const wonLost = s => /LOST/.test(up(s)) ? 'L' : /WON/.test(up(s)) ? 'W' : '';
  const sameThird = (a, b) => { const x = thirdOf(a), y = thirdOf(b); return !!x && x === y; };
  function playerOf(e){ const p = String((e && e.player) || '').trim(); if(p) return p; const L = (e && e.labels) || {}; const k = Object.keys(L).find(x => /player labels$/i.test(x)); return k ? String(L[k] || '').trim() : ''; }
  // → { labels:{group:value}, player:{name, group, team, was}, n, what:[words], notes:[words] }
  function fillPlan(g, f, kind){
    const out = { labels:{}, player:null, n:0, what:[], notes:[] };
    const gCode = up(g.code), fCode = up(f.code), dead = c => /SHOT DEAD ?BALL/.test(c);
    const shotKindDiffers = kind === 'shot' && /SHOT (OPEN|DEAD)/.test(gCode) && dead(gCode) !== dead(fCode);
    if(shotKindDiffers) out.notes.push('the file has it as ' + (dead(fCode) ? 'a dead ball' + (lbl(f, 'Deadball Shot Type') ? ' (' + lbl(f, 'Deadball Shot Type') + ')' : '') : 'open play') + ' — the game’s is kept');
    const gOut = kind === 'shot' ? up(valCI(g, ['Shot Outcomes','ShotOutcome','Outcome']) || g.outcome) : kind === 'ko' ? up(valCI(g, ['Kickout Outcomes','KickoutOutcome']) || g.outcome) : '';
    const fOut = kind === 'shot' ? up(lbl(f, 'Shot Outcomes')) : kind === 'ko' ? up(lbl(f, 'Kickout Outcomes')) : '';
    const outDiffers = !!gOut && !!fOut && gOut !== fOut && !(kind === 'shot' && /SHOT (OPEN|DEAD)/.test(gCode) === false);
    // who won a kickout is only copied when both files agree which side won it (a game kickout whose outcome cannot be read gets no name)
    const koSideDiffers = kind === 'ko' && wonLost(gOut) !== wonLost(fOut);
    Object.keys(f.labels || {}).forEach(grp => {
      const v = String(f.labels[grp] == null ? '' : f.labels[grp]).trim();
      if(!v || grp === MERGE_SRC || grp === GI_SRC || SKIP_FILL.test(grp) || /player labels$/i.test(grp)) return;
      const have = valCI(g, aliasOf(grp));
      if(have){
        if(up(have) !== up(v) && !sameThird(have, v) && aliasOf(grp).length > 1 && keyCI(g.labels, grp) == null) return;   // the game says it in its own format's words
        if(up(have) !== up(v) && !sameThird(have, v)) out.notes.push(grp + ': the file says ' + v + ' — the game’s ' + have + ' is kept');
        return;
      }
      if(grp === 'Deadball Shot Type' && (shotKindDiffers || !dead(gCode))) return;
      if(kind === 'ko' && /^pitcharea$/i.test(grp) && valCI(g, ['Kickout Locations','KickoutLength','KODistance'])) return;   // the game's kickout says its length: the file's third adds nothing
      if(grp === 'Shot Attempts' && outDiffers){ out.notes.push('Shot Attempts ' + v + ' not copied — the outcomes differ'); return; }
      if(koSideDiffers && /^kickout (won by|target)$/i.test(grp)){ out.notes.push(grp + ' ' + v + ' not copied — the file has this kickout ' + (wonLost(fOut) === 'W' ? 'won' : 'lost') + ', the game ' + (wonLost(gOut) === 'W' ? 'won' : wonLost(gOut) === 'L' ? 'lost' : 'with an outcome that cannot be read')); return; }
      out.labels[grp] = v; out.n++; out.what.push(grp + ' ' + v);
    });
    const pf = playerOf(f), pg = playerOf(g);
    if(pf){
      const fk = Object.keys(f.labels || {}).find(x => /player labels$/i.test(x)) || '', team = f.playerTeam || (fk ? up(fk.replace(/\s*player labels$/i, '')) : up(f.team));
      const tg = f.pTag || pTagOf(pf);
      if(!pg){ out.player = { name:pf, group:fk, team, was:'', pTag:tg, pTagName: f.pTagName || '' }; out.n++; out.what.push('player ' + (tg && !isPTag(pf) ? tg + ' → ' : '') + pf); }
      else if(isPTag(pg) && !isPTag(pf)){ out.player = { name:pf, group:fk, team, was:pg, pTag:pTagOf(pg) }; out.n++; out.what.push('player ' + pg + ' → ' + pf); }
      else if(up(pg) !== up(pf) && !(isPTag(pf) && !isPTag(pg))) out.notes.push('player: the file says ' + pf + ' — the game’s ' + pg + ' is kept');
    }
    return out;
  }
  // write a fill (or a FREE AGAINST type) onto a row, in place
  function applyEdit(row, ed){
    row.labels = row.labels || {};
    Object.keys(ed.labels || {}).forEach(g => { const k = keyCI(row.labels, g) || g; if(String(row.labels[k] == null ? '' : row.labels[k]).trim()) return;   // never over a value
      GI.cohGiCarryApply(row, { labels:{ [k]:[ed.labels[g]] } });
      if(TO_OUT.some(n => n.toLowerCase() === k.toLowerCase()) && !String(row.outcome || '').trim()) row.outcome = ed.labels[g]; });
    if(ed.player){
      const cur = playerOf(row);
      if(!cur || (isPTag(cur) && !isPTag(ed.player.name))){
        const old = Object.keys(row.labels).filter(k => /player labels$/i.test(k) && (!String(row.labels[k] || '').trim() || isPTag(row.labels[k])));
        const k = old[0] || ed.player.group || ((ed.player.team || up(row.team) || 'Unassigned') + ' Player Labels');
        row.labels[k] = ed.player.name; row.player = ed.player.name;
        if(ed.player.pTag) row.pTag = ed.player.pTag;
        if(ed.player.pTagName) row.pTagName = ed.player.pTagName; else delete row.pTagName;   // a name from the other FILE is not the sheet's: it does not follow the sheet
        if(ed.player.team && ed.player.team !== up(row.team)) row.playerTeam = ed.player.team;
      }
    }
    return row;
  }

  // the rows that make up one of the game's events (to take the file's version instead)
  function groupOf(events, i){
    const e = events[i], set = new Set([i]), src = lbl(e, GI_SRC), m = lbl(e, MERGE_SRC), kind = gameKind(e, null);
    events.forEach((x, j) => { if(!x || j === i) return;
      if(src && (lbl(x, GI_SRC) === src || (!lbl(x, GI_SRC) && String(x.id) === src))){ set.add(j); return; }
      if(!src && m && lbl(x, MERGE_SRC) === m){ set.add(j); return; }
      if(e._rowId != null && x._shotComp != null && String(x._shotComp) === String(e._rowId)){ set.add(j); return; }
      if(src || m) return;
      const same = fin(x.start) && fin(e.start) && +x.start === +e.start, X = up(x.code), bare = !playerOf(x);
      if(kind === 'shot' && same && bare && up(x.team) === up(e.team) && X === up(e.team) + ' ' + up(valCI(e, ['Shot Outcomes']) || e.outcome) && /(1 POINT|2 POINT|GOAL)$/.test(X)) set.add(j);
      if(kind === 'ko' && same && bare && /\sBREAK (WON|LOST)$/.test(X)) set.add(j);
      if(kind === 'ko' && fin(x.start) && fin(e.start) && Math.abs(x.start - e.start) <= 2 && up(x.team) === up(e.team) && /\bTOS\s*$/.test(X) && /KICK\s*OUT LOST|\bKO LOST\b/.test(up(valCI(x, TO_OUT) || x.outcome))) set.add(j);
    });
    return [...set];
  }

  // ── the plan ────────────────────────────────────────────────────
  // opts.offsets {half: seconds (game − file)} — typed offsets, used instead of the computed ones.
  function cohMergePlan(events, game, text, opts){
    opts = opts || {}; events = events || [];
    const fail = (error, more) => Object.assign({ ok:false, error }, more || {});
    const det = cohMergeDetect(text);
    if(!det.supported) return fail(det.message, { format:det.format, formatName:det.name });
    if(!game || !game.homeTeam || !game.awayTeam) return fail('The game has no home / away team names, so the file’s teams cannot be matched.', { format:det.format, formatName:det.name });
    const A = ADAPTERS[det.format], codes = instancesOf(text).map(i => i.code);
    const teams = fileTeams(codes), H = up(game.homeTeam), W = up(game.awayTeam), strange = teams.filter(t => up(t) !== H && up(t) !== W);
    const base = { format:det.format, formatName:A.name, fileTeams:teams };
    if(!teams.length) return fail('No team rows were found in this file, so it cannot be matched to ' + game.homeTeam + ' v ' + game.awayTeam + '.', base);
    if(strange.length) return fail('This file is ' + teams.join(' v ') + '; the game is ' + game.homeTeam + ' v ' + game.awayTeam + '. The teams do not match, so nothing was read from it.', base);
    if(GI.cohGiConvert(events, game, { carry:false }).length)
      return fail('This game still has Gaelic Insights / GIU events that are not converted. Press “Convert …” first, then merge — the merge pairs with the converted rows.', base);
    if(!events.some(e => e && gameT(e) != null)) return fail('The game has no events to line the file up with.', base);

    const tag = A.short + '-' + hash6(text), marker = id => tag + ':' + id;
    const keep = { half: events.some(e => keyCI(e && e.labels, 'Half') != null), quarter: events.some(e => keyCI(e && e.labels, 'Quarter') != null) };
    const rd = A.read(text, game), fi = fileItems(rd.raw, game, A, keep), items = fi.items, leftOut = rd.skipped.concat(fi.out);
    const G = gameItems(events, game);
    // rows already merged from THIS file
    const byMarker = new Map(); G.forEach(g => { if(g.marker && g.marker.indexOf(tag + ':') === 0 && !byMarker.has(g.marker + '|' + g.kind)) byMarker.set(g.marker + '|' + g.kind, g); });
    items.forEach(it => { const g = byMarker.get(marker(it.srcId) + '|' + it.kind); if(g){ it.already = g; g.used = true; } });
    const Gfree = G.filter(g => !g.used), Ffree = items.filter(it => !it.already);

    // per half: the readings of the offset, and the one used
    const gameHalves = HALVES.filter(h => events.some(e => e && e.half === h));
    events.forEach(e => { if(e && e.half && gameHalves.indexOf(e.half) < 0 && HALVES.indexOf(e.half) < 0) gameHalves.push(e.half); });
    const fileHalves = [...new Set(items.map(it => it.half).filter(Boolean))], halved = fileHalves.length > 0;
    const halves = gameHalves.slice(); fileHalves.forEach(h => { if(halves.indexOf(h) < 0) halves.push(h); });
    halves.sort((a, b) => { const x = HALVES.indexOf(a), y = HALVES.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
    const typed = opts.offsets || {}, from = opts.offsetFrom || {}, align = [], off = {}, allClock = halfClock(events, null), starts = rd.starts || {};
    const r2 = v => Math.round(v * 100) / 100;
    halves.forEach(h => {
      const inG = k => Gfree.filter(g => g.kind === k && g.half === h), inF = k => Ffree.filter(f => f.kind === k && (!halved || f.half === h));
      const gk = inG('ko'), fk = inF('ko'), gs = inG('shot'), fs = inF('shot');
      const ek = estimate(gk, fk), es = estimate(gs, fs), c = halfClock(events, h);
      const reading = (est, nG, nF) => est ? { offset: est.offset, agree: est.pairs.length, of: Math.min(nG, nF), next: est.second, confident: confident(est, nG, nF) } : null;
      // the throw-in: the file's period start against the moment the game's own rows count gameTime from
      const anchor = (starts[h] != null && c.ref != null) ? { offset: r2(c.ref - starts[h]), fileT: starts[h], gameT: c.ref, what: rd.startName } : null;
      const a = { half:h, offset:null, source:'', confident:false, typed:false, inGame: events.some(e => e && e.half === h), fileEvents: halved ? items.filter(f => f.half === h).length : null,
        readings: { shots: reading(es, gs.length, fs.length), kickouts: reading(ek, gk.length, fk.length), anchor },
        anchorWhy: anchor ? '' : starts[h] == null ? 'the file has no ' + (rd.startName === 'NA Whistle' ? 'whistle that starts this half' : 'period-start marker for this half')
          : 'the game’s rows in this half carry no game clock (gameTime), so its throw-in moment is not stored' };
      const R = a.readings;
      a.shotOffset = R.shots ? R.shots.offset : null; a.koOffset = R.kickouts ? R.kickouts.offset : null;
      if(fin(typed[h])){ a.offset = +typed[h]; a.source = from[h] === 'video' ? 'video' : 'typed'; a.typed = true; }
      else if(R.shots && R.shots.confident){ a.offset = R.shots.offset; a.source = 'shots'; a.confident = true; }
      else if(R.kickouts && R.kickouts.confident){ a.offset = R.kickouts.offset; a.source = 'kickouts'; a.confident = true; }
      else if(anchor){ a.offset = anchor.offset; a.source = 'throw-in'; }
      else a.reason = !a.inGame ? 'the game has no events in this half' : (!gk.length && !gs.length) ? 'the game has no kickouts or shots in this half to line up with'
        : (!fk.length && !fs.length) ? 'the file has no kickouts or shots for this half' : 'too few shots and kickouts agree on one offset'
          + (es ? ' (shots: best ' + es.pairs.length + ' of ' + Math.min(gs.length, fs.length) + (es.second ? ', next best ' + es.second : '') + ')' : '') + '; ' + a.anchorWhy;
      // what the automatic choice would be (shown beside a typed / video offset), and whether the readings disagree
      a.computed = (R.shots && R.shots.confident) ? { offset:R.shots.offset, source:'shots' } : (R.kickouts && R.kickouts.confident) ? { offset:R.kickouts.offset, source:'kickouts' } : anchor ? { offset:anchor.offset, source:'throw-in' } : null;
      const vals = [R.shots && R.shots.confident ? R.shots.offset : null, R.kickouts && R.kickouts.confident ? R.kickouts.offset : null, anchor ? anchor.offset : null].filter(v => v != null);
      a.gap = vals.length > 1 ? r2(Math.max.apply(null, vals) - Math.min.apply(null, vals)) : 0; a.check = a.gap > CHECK_GAP;
      a.clock = c.n ? c : { n:0, k:allClock.k, ref:null };
      if(a.offset != null) off[h] = a.offset;
      align.push(a);
    });
    // a file with no half labels: each event's half from where it sits among the aligned halves
    if(!halved){
      const times = items.map(it => it.ft).sort((x, y) => x - y), done = halves.filter(h => off[h] != null), span = {};
      done.forEach(h => { const gt = G.filter(g => g.half === h).map(g => g.t); if(gt.length) span[h] = [Math.min.apply(null, gt) - off[h], Math.max.apply(null, gt) - off[h]]; });
      const hs = done.filter(h => span[h]), cut = [];
      const gapCut = (lo, hi) => { let best = null; for(let i = 1; i < times.length; i++){ if(times[i-1] < lo || times[i] > hi) continue; const g = times[i] - times[i-1]; if(!best || g > best.g) best = { g, c:(times[i] + times[i-1]) / 2 }; } return best ? best.c : (lo + hi) / 2; };
      for(let i = 0; i + 1 < hs.length; i++) cut.push(gapCut(span[hs[i]][1], span[hs[i+1]][0]));
      // outside the first / last aligned half: up to EDGE seconds, never across a break
      const edge = (from, dir) => { let lim = from + dir * EDGE, prev = from; const ts = dir > 0 ? times.filter(t => t > from) : times.filter(t => t < from).reverse();
        for(const t of ts){ if(Math.abs(t - prev) >= BREAK){ lim = prev + dir * 1; break; } prev = t; } return lim; };
      const lo = hs.length ? edge(span[hs[0]][0], -1) : 0, hi = hs.length ? edge(span[hs[hs.length-1]][1], 1) : 0;
      items.forEach(it => { it.half = null; if(!hs.length || it.ft < lo || it.ft > hi) return;
        let k = 0; while(k < cut.length && it.ft > cut[k]) k++; it.half = hs[k]; });
      align.forEach(a => { a.fileEvents = items.filter(f => f.half === a.half).length; });
    }

    // pair every type, half by half; an event type's own lag = the median lag of its nearest pairs
    const kinds = []; KIND_ORDER.forEach(k => { if(items.some(it => it.kind === k)) kinds.push(k); });
    [...new Set(items.map(it => it.kind))].filter(k => kinds.indexOf(k) < 0).sort().forEach(k => kinds.push(k));
    const pairsOf = {};
    kinds.forEach(k => {
      const tol = TOL[k] || TOL_DEFAULT, wide = {}, all = [];
      halves.forEach(h => { if(off[h] == null) return; wide[h] = pairUp(Gfree.filter(g => g.kind === k && g.half === h), Ffree.filter(f => f.kind === k && f.half === h), off[h], BIAS_WINDOW, 0); wide[h].forEach(p => all.push(p.d)); });
      const overall = all.length >= 3 ? median(all) : 0;
      halves.forEach(h => { if(off[h] == null) return;
        const bias = wide[h].length >= 3 ? median(wide[h].map(p => p.d)) : overall;
        const ps = pairUp(Gfree.filter(g => g.kind === k && g.half === h), Ffree.filter(f => f.kind === k && f.half === h), off[h], tol, bias);
        ps.forEach(p => { p.f.pair = p.g; p.g.paired = p.f; p.f.lag = p.d; });
        pairsOf[k + '|' + h] = { n:ps.length, bias: Math.round(bias * 10) / 10, res: ps.map(p => p.d - bias) }; });
    });
    align.forEach(a => {
      // the file's events of this half, for "mark on the video": the period start first, then the first kickout and shot, then all in time order
      const mine = items.filter(f => f.half === a.half || (!halved && f.half == null && a.offset == null)).sort((x, y) => x.ft - y.ft), ev = [];
      const lab = f => f.code + ' — file ' + clockOf(f.ft);
      if(starts[a.half] != null) ev.push({ key:'start', label: (rd.startName === 'NA Whistle' ? 'NA Whistle (throw-in)' : 'P' + (HALVES.indexOf(a.half) + 1) + ' START (throw-in)') + ' — file ' + clockOf(starts[a.half]), fileT: starts[a.half] });
      const fko = mine.find(f => f.kind === 'ko'), fsh = mine.find(f => f.kind === 'shot');
      if(fko) ev.push({ key:'ko|' + fko.srcId, label:'first kickout: ' + lab(fko), fileT:fko.ft });
      if(fsh) ev.push({ key:'shot|' + fsh.srcId, label:'first shot: ' + lab(fsh), fileT:fsh.ft });
      mine.forEach(f => ev.push({ key:f.kind + '|' + f.srcId + '|all', label: lab(f), fileT:f.ft }));
      a.marks = ev;
      if(a.offset == null) return;
      const cnt = k => ({ paired:(pairsOf[k + '|' + a.half] || { n:0 }).n, game: G.filter(g => g.kind === k && g.half === a.half).length, file: items.filter(f => f.kind === k && f.half === a.half).length,
        lag:(pairsOf[k + '|' + a.half] || { bias:0 }).bias });
      a.ko = cnt('ko'); a.shot = cnt('shot'); a.to = cnt('to');
      const src = pairsOf[(a.source === 'kickouts' ? 'ko' : 'shot') + '|' + a.half], res = src ? src.res : [];
      a.spreadOf = a.source === 'kickouts' ? 'kickouts' : 'shots';
      a.spread = res.length ? { min: Math.round(Math.min.apply(null, res) * 10) / 10, max: Math.round(Math.max.apply(null, res) * 10) / 10 } : null;
      const firstPair = items.filter(f => f.half === a.half && f.pair && (f.kind === 'ko' || f.kind === 'shot')).sort((x, y) => x.ft - y.ft)[0];
      const firstAny = items.filter(f => f.half === a.half).sort((x, y) => x.ft - y.ft)[0], f0 = firstPair || firstAny;
      if(f0){ const st = Math.round(f0.ft + a.offset);
        a.first = { paired: !!firstPair, code: f0.code, fileT: f0.ft, start: st, driveT: Math.max(0, st + (a.clock.k == null ? 0 : a.clock.k)), gameCode: firstPair ? firstPair.pair.e.code : '', gameDriveT: firstPair && fin(firstPair.pair.e.driveT) ? +firstPair.pair.e.driveT : null }; }
    });

    // entries, type by type
    const types = kinds.map(k => {
      const mine = items.filter(it => it.kind === k).sort((a, b) => (HALVES.indexOf(a.half) - HALVES.indexOf(b.half)) || a.ft - b.ft);
      const rows = mine.map(it => {
        const a = it.half ? align.find(x => x.half === it.half) : null, o = it.half != null ? off[it.half] : null, main0 = it.rows[0] || { code:'' };
        const r = { key: k + '|' + it.srcId, srcId: it.srcId, kind:k, half: it.half, team: it.team, fileCode: it.code, code: main0.code, player: playerOf(main0), fileT: it.ft, t:null, driveT:null,
          pTag: it.pTag || '', pName: it.pName || '', status:'', reason:'', gi:null, fills:null, notes:[], rows:[] };
        if(it.already){ r.status = 'already'; r.gi = it.already.i; r.t = it.already.t; r.driveT = fin(it.already.e.driveT) ? +it.already.e.driveT : null; r.half = it.already.half || it.half; return r; }
        if(o == null){ r.status = 'out'; r.reason = it.half ? 'its half (' + it.half + ') is not lined up with the game' : 'it falls outside the halves that could be lined up'; return r; }
        const mk = marker(it.srcId);
        r.rows = it.rows.map((x, n) => placeRow(x, it, it.half, o, a.clock, mk, 'mg-' + tag + '-' + it.srcId + (n ? '-' + (String(x.id || '').replace(/^gi-.*?-(?=[a-z]+$)/, '') || n) : '')));
        r.t = Math.round(it.ft + o); r.driveT = Math.max(0, r.t + (a.clock.k == null ? 0 : a.clock.k));
        if(it.bad){
          if(!it.pair){ r.status = 'out'; r.reason = it.bad; return r; }
          r.status = 'paired'; r.gi = it.pair.i; r.lag = Math.round(it.lag * 10) / 10; r.gameCode = it.pair.e.code; r.gameT = it.pair.t; r.gameDriveT = fin(it.pair.e.driveT) ? +it.pair.e.driveT : null;
          r.gamePlayer = playerOf(it.pair.e); r.fills = { labels:{}, player:null, n:0, what:[], notes:[] }; r.notes = ['nothing can be taken from the file: ' + it.bad]; r.unusable = true; return r; }
        if(it.pair){ r.status = 'paired'; r.gi = it.pair.i; r.lag = Math.round(it.lag * 10) / 10; r.gameCode = it.pair.e.code; r.gameT = it.pair.t; r.gameDriveT = fin(it.pair.e.driveT) ? +it.pair.e.driveT : null;
          r.gamePlayer = playerOf(it.pair.e); const fp = fillPlan(it.pair.e, r.rows[0], k); r.fills = fp; r.notes = fp.notes; }
        else r.status = 'new';
        return r;
      });
      const n = s => rows.filter(r => r.status === s).length;
      const aligned = new Set(halves.filter(h => off[h] != null));
      const inGame = G.filter(g => g.kind === k), gameOnly = inGame.filter(g => !g.paired && !g.used && aligned.has(g.half)).length;
      return { kind:k, name: KIND_NAME[k] || (mine[0] && mine[0].name) || k.replace(/^x:/, ''), defined: k.indexOf('x:') !== 0, mode: k.indexOf('x:') === 0 ? 'none' : 'fill',
        nGame: inGame.length, nFile: rows.length, paired: n('paired'), fileOnly: n('new'), already: n('already'), out: n('out'), gameOnly, rows };
    });

    // FREE AGAINST: a file foul BY a team whose own turnover starts within FA_WINDOW s (file clock)
    const fa = [], fouls = items.filter(it => it.kind === 'foul'), tos = items.filter(it => it.kind === 'to');
    tos.forEach(t => { const f = fouls.filter(x => x.team === t.team && (!halved || x.half === t.half) && Math.abs(x.ft - t.ft) <= FA_WINDOW).sort((x, y) => Math.abs(x.ft - t.ft) - Math.abs(y.ft - t.ft))[0];
      if(!f) return;
      const row = (types.find(x => x.kind === 'to') || { rows:[] }).rows.find(r => r.srcId === t.srcId); if(!row || row.status === 'out') return;
      const gi = row.gi, ge = gi != null ? events[gi] : null;
      fa.push({ key: 'fa|' + t.srcId, toKey: row.key, foulKey: 'foul|' + f.srcId, team: t.team, half: row.half, t: row.gameT != null ? row.gameT : row.t, driveT: row.gameDriveT != null ? row.gameDriveT : row.driveT,
        gi: gi == null ? null : gi, gameCode: ge ? ge.code : '', gameType: ge ? (valCI(ge, TO_OUT) || String(ge.outcome || '').trim()) : '', gap: Math.round((t.ft - f.ft) * 10) / 10, foulCode: f.code, toCode: t.code }); });

    const plan = { ok:true, format:det.format, formatName:A.name, tag, fileTeams:teams, homeTeam:game.homeTeam, awayTeam:game.awayTeam, halved, align, types, fa, leftOut,
      fileEvents: rd.raw.length, modes: MODES.slice() };
    Object.defineProperty(plan, '_events', { value: events, enumerable:false });
    return plan;
  }

  // ── the user's choices → what to do ─────────────────────────────
  // choice: { modes:{kind: 'fill'|'file'|'both'|'none'}, off:{entry key: true} (unticked entries), faOff:{fa key: true} }
  //   fill = keep the game's event and copy only what it lacks; add the events only in the file
  //   file = take the file's event instead of the game's (the game's is removed); add the events only in the file
  //   both = add every event of the file, keep the game's too (a paired event is then in the game twice)
  //   none = bring nothing of this type
  // → { adds:[rows], edits:[{i, labels, player, what:[…]}], deletes:[indexes], counts, summary, fa:[{key, state, why}] }
  function cohMergeOps(plan, choice){
    choice = choice || {};
    const events = plan._events || [], modes = choice.modes || {}, offT = choice.off || {}, faOff = choice.faOff || {};
    const adds = [], edits = new Map(), dels = new Set(), added = {}, addedRow = new Map(), counts = { adds:{}, fills:0, filledRows:0, removed:0, removedRows:0, fa:0, twice:0 };
    const edit = i => { if(!edits.has(i)) edits.set(i, { i, labels:{}, player:null, what:[] }); return edits.get(i); };
    plan.types.forEach(T => {
      const m = modes[T.kind] || T.mode;
      if(m === 'none') return;
      T.rows.forEach(r => {
        if(offT[r.key] || r.status === 'already' || r.status === 'out') return;
        if(r.status === 'paired' && m === 'fill'){
          if(r.fills && r.fills.n){ const e = edit(r.gi); Object.assign(e.labels, r.fills.labels); if(r.fills.player) e.player = r.fills.player; r.fills.what.forEach(w => e.what.push(w)); counts.fills += r.fills.n; }
          return;
        }
        if(r.unusable) return;                                    // paired, but the file's event cannot be converted: the game's stays
        if(r.status === 'paired' && m === 'file'){ groupOf(events, r.gi).forEach(j => dels.add(j)); counts.removed++; }
        if(r.status === 'paired' && m === 'both') counts.twice++;
        r.rows.forEach((x, n) => { const c = clone(x); if(n) c._mergeMain = r.rows[0].id; adds.push(c); });
        addedRow.set(r.key, adds.length - r.rows.length);
        added[T.kind] = (added[T.kind] || 0) + 1;
      });
    });
    // FREE AGAINST — on the row that will stand for that turnover
    const fa = plan.fa.map(f => {
      if(faOff[f.key]) return { key:f.key, state:'off', why:'' };
      if(addedRow.has(f.toKey)){ const row = adds[addedRow.get(f.toKey)];
        if(valCI(row, TO_OUT)) return { key:f.key, state:'skip', why:'the turnover already has a type' };
        row.labels['Turnover Outcomes'] = 'FREE AGAINST'; if(!row.outcome) row.outcome = 'FREE AGAINST'; counts.fa++; return { key:f.key, state:'new', why:'' }; }
      if(f.gi != null && !dels.has(f.gi)){
        if(f.gameType) return { key:f.key, state:'skip', why:'the game’s turnover already has the type ' + f.gameType };
        const e = edit(f.gi); e.labels['Turnover Outcomes'] = 'FREE AGAINST'; e.what.push('Turnover Outcomes FREE AGAINST'); counts.fa++; return { key:f.key, state:'game', why:'' }; }
      return { key:f.key, state:'skip', why:'this turnover is not in the game and is not being brought in' };
    });
    dels.forEach(j => edits.delete(j));
    counts.filledRows = edits.size; counts.removedRows = dels.size; counts.adds = added; counts.addRows = adds.length;
    const parts = [], addWords = plan.types.filter(T => added[T.kind]).map(T => plural(added[T.kind], KIND_WORD[T.kind] || [T.name.toLowerCase(), T.name.toLowerCase()]));
    if(addWords.length) parts.push('adds ' + addWords.join(', '));
    if(counts.fills) parts.push('fills ' + counts.fills + ' detail' + (counts.fills === 1 ? '' : 's') + ' on ' + [...edits.values()].filter(e => e.what.some(w => w !== 'Turnover Outcomes FREE AGAINST')).length + ' existing event' + (counts.fills === 1 ? '' : 's'));
    if(counts.fa) parts.push('sets FREE AGAINST on ' + counts.fa + ' turnover' + (counts.fa === 1 ? '' : 's'));
    if(counts.removed) parts.push('replaces ' + counts.removed + ' of the game’s events with the file’s (' + counts.removedRows + ' rows removed)');
    return { adds, edits:[...edits.values()], deletes:[...dels].sort((a, b) => a - b), counts, fa,
      summary: parts.length ? parts.join('; ') : 'nothing to bring in — everything chosen is already in the game' };
  }

  // The ops on a plain event list → a NEW list (the headless tests; Code Room queues the same ops itself).
  function cohMergeApply(events, ops){
    const out = (events || []).map(e => clone(e)), gone = new Set(ops.deletes || []);
    (ops.edits || []).forEach(ed => { if(out[ed.i] && !gone.has(ed.i)) applyEdit(out[ed.i], ed); });
    const kept = out.filter((e, i) => !gone.has(i));
    (ops.adds || []).forEach(r => { const c = clone(r); delete c._mergeMain; kept.push(c); });
    return kept.sort((a, b) => ((a.driveT == null ? 0 : a.driveT) - (b.driveT == null ? 0 : b.driveT)) || ((a.start == null ? 0 : a.start) - (b.start == null ? 0 : b.start)));
  }

  // ── P-numbers on the game's rows, and the team sheet ────────────
  // For a team sheet added or changed AFTER the rows were stored. Two kinds of change are listed:
  //  FILL    a value that is a bare P-number and now has a player at that number:
  //   · the row's player field and its "<TEAM> Player Labels" value — number of THAT team (the player's own team:
  //     the label's team, else playerTeam, else the row's team);
  //   · Assist, Kickout Taken By, Kickout Target, Player In, Player Out — the row's team;
  //   · Kickout Won By — the kicking team when the kickout was won, the other team when it was lost (skipped when
  //     the outcome does not say).
  //  FOLLOW  a value that was WRITTEN from a number (the row remembers it: pTag + pTagName for the player, pTagL
  //     {group:{tag, name, team}} for another label) when the sheet now has a DIFFERENT name at that number — only
  //     while the row still holds exactly the name that was written (a value someone has typed since is left alone and
  //     not offered), and never when the number is now empty on the sheet (the name stays).
  // `to` = the name now at that number ('' = no player at that number: a bare P-number stays). A superseded Gaelic
  // Insights / GIU original is not listed (it is the file's own record), nor the raw 'Player' label of any row, nor a
  // group holding several values. A row named before this was built has no pTag and cannot follow. Pure — nothing is
  // changed; apply with cohPTagApply.
  //   → [{ index, id, code, team, changes:[{ where:'player'|'label', group, from, to, team, tag, follow }], n (changes with a name) }]
  const PTAG_ROW_GROUPS = ['assist','kickout taken by','kickout target','player in','player out'];
  const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  function cohPTagFixes(events, game){
    events = events || [];
    const sup = GI.cohGiSupersededFn(events), out = [], H = up(game && game.homeTeam), A = up(game && game.awayTeam), other = T => T === H ? A : T === A ? H : '';
    events.forEach((e, index) => { if(!e || sup(e)) return;
      const L = e.labels || {}, T = up(e.team) || teamOfCode(e.code, game), ch = []; let own = up(e.playerTeam);
      const multi = g => !!(g && e.labelsAll && Array.isArray(e.labelsAll[g]) && e.labelsAll[g].length > 1);
      const want = (where, group, val, team) => { if(!isPTag(val) || multi(group)) return;
        ch.push({ where, group, from: pTagOf(val), tag: pTagOf(val), to: team ? (GI.cohGiuRosterName(game, team, val) || '') : '', team: team || '', follow:false }); };
      const follow = (where, group, val, tag, name, team) => { if(!tag || !name || !team || isPTag(val) || multi(group) || !sameName(val, name)) return;
        const now = GI.cohGiuRosterName(game, team, tag); if(now && !sameName(now, name)) ch.push({ where, group, from: String(val).trim(), tag, to: now, team, follow:true }); };
      let pKey = '';
      Object.keys(L).forEach(g => { const m = /^(.*?)\s*player labels$/i.exec(g), w = g.toLowerCase();
        if(m){ const pt = up(m[1]) === H || up(m[1]) === A ? up(m[1]) : (own || T); want('label', g, L[g], pt); if(!own) own = pt; pKey = pKey || g; return; }
        const tl = e.pTagL && e.pTagL[g];
        if(PTAG_ROW_GROUPS.indexOf(w) >= 0){ want('label', g, L[g], T); if(tl) follow('label', g, L[g], tl.tag, tl.name, tl.team || T); }
        else if(w === 'kickout won by'){ const s = wonLost(valCI(e, ['Kickout Outcomes','Kickout Outcome']) || e.outcome); if(s) want('label', g, L[g], s === 'W' ? T : other(T));
          if(tl) follow('label', g, L[g], tl.tag, tl.name, tl.team); } });
      want('player', '', e.player, own || T);
      if(e.pTag && e.pTagName){ if(pKey) follow('label', pKey, L[pKey], e.pTag, e.pTagName, own || T); follow('player', '', e.player, e.pTag, e.pTagName, own || T); }
      if(ch.length) out.push({ index, id:e.id, code:e.code, team:T, changes:ch, n: ch.filter(c => c.to).length });
    });
    return out;
  }
  // Write the named changes of one entry onto its row, in place; a change with no name is left. The row remembers the
  // number and the name written, so it can follow the sheet later. Returns how many values were written.
  function cohPTagApply(row, entry){
    let n = 0; row.labels = row.labels || {};
    (entry.changes || []).forEach(c => { if(!c.to) return;
      const isPl = c.where === 'player' || /player labels$/i.test(c.group);
      const cur = c.where === 'player' ? row.player : row.labels[c.group];
      if(c.follow ? !sameName(cur, c.from) : pTagOf(cur) !== c.from) return;
      if(c.where === 'player') row.player = c.to; else row.labels[c.group] = c.to;
      if(isPl){ row.pTag = c.tag; row.pTagName = c.to; }
      else { row.pTagL = row.pTagL || {}; row.pTagL[c.group] = { tag:c.tag, name:c.to, team:c.team }; }
      n++; });
    return n;
  }

  const api = { cohPTagFixes, cohPTagApply, cohMergeDetect, cohMergePlan, cohMergeOps, cohMergeApply, cohMergeApplyEdit:applyEdit, cohMergeFormats:() => Object.keys(ADAPTERS).map(k => ADAPTERS[k].name),
    COH_MERGE_SRC:MERGE_SRC, COH_MERGE_MODES:MODES };
  Object.assign(root, api);
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
