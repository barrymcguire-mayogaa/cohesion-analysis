/* COHESION — "Read from photo / PDF" for the team sheet editor.
 *
 * Runs entirely in the browser: the chosen file is never uploaded and no
 * server or API is called with it. The two reading programs are public
 * open-source libraries fetched from a public CDN (jsDelivr), pinned to exact
 * versions, and only when the button is used:
 *   · pdf.js 3.11.174      — the exact text of a digital PDF (+ page pictures)
 *   · Tesseract.js 5.1.1   — text recognition for photos and scanned pages
 *     (core 5.1.1, language data eng + gle 1.0.0 "4.0.0_best_int")
 * This file itself is only loaded (by cohesion-teamsheet.js) when the button
 * is first used.
 *
 * The reader never writes to a sheet. Its text goes into a team's paste box
 * and through the editor's own parser and preview (cohTS.parsePaste), where
 * the user presses "Replace this sheet" / "Add to this sheet" himself.
 *
 * Public hook: cohTeamSheetFromFile(file, opts) → Promise<{home, away, pages,
 * source, …}> (see read() below). A paid / API reader could replace that one
 * function and the editor UI would keep working.
 *
 * Everything above the "BROWSER" banner is pure (no DOM, no network) and is
 * what the unit tests run.
 */
(function(root){
  'use strict';
  const T=root.cohTS||(typeof require==='function'?require('./cohesion-teamsheet.js'):null);
  const R={};

  // ── small helpers ─────────────────────────────────────────────
  const med=a=>{ if(!a.length) return 0; const s=a.slice().sort((x,y)=>x-y); return s[s.length>>1]; };
  // lower case, fadas and other accents removed
  const fold=s=>String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  const foldKey=s=>fold(s).replace(/[^a-z0-9]+/g,'');
  const hasLetter=s=>/[A-Za-zÀ-ɏ]/.test(s);
  const isNumTok=s=>/^#?\d{1,2}[.):]?$/.test(String(s).trim());
  // the jersey number a line starts with ("7 Name", "7. Name", "7<TAB>Name") or ends with ("Name (7)"), else null
  function lineNo(text){
    const s=String(text==null?'':text).trim();
    let m=/^#?\s*(\d{1,2})(?:\s*[.\-–—:)]+\s*|\s+)(?=\S)/.exec(s);
    if(m&&hasLetter(s.slice(m[0].length))) return +m[1];
    m=/[(\[]\s*#?\s*(\d{1,2})\s*[)\]]\s*$/.exec(s);
    if(m&&hasLetter(s.slice(0,m.index))) return +m[1];
    return null;
  }
  R.fold=fold; R.foldKey=foldKey; R.lineNo=lineNo;

  // ── 1. positioned words → lines and columns ───────────────────
  // word = {text, x0,y0,x1,y1 (y grows downward), conf (0–100, or null for exact PDF text)}
  function prep(words){
    return (words||[]).filter(w=>w&&String(w.text||'').trim()&&w.x1>w.x0&&w.y1>w.y0&&!(w.conf!=null&&w.conf<15&&!/[A-Za-zÀ-ɏ0-9]/.test(w.text)))
      .map(w=>({text:String(w.text).trim(), x0:w.x0, y0:w.y0, x1:w.x1, y1:w.y1, conf:w.conf==null?null:+w.conf,
        h:w.y1-w.y0, xc:(w.x0+w.x1)/2, yc:(w.y0+w.y1)/2}));
  }
  // Words that follow one another on a line (small gap, same height band) → chains.
  // Local only, so a tilted photo still chains correctly.
  function chain(ws){
    const order=ws.slice().sort((a,b)=>a.x0-b.x0), tails=[], chains=[];
    order.forEach(w=>{
      let best=-1, bg=Infinity;
      for(let i=0;i<tails.length;i++){
        const t=tails[i], H=Math.max(t.h,w.h), gap=w.x0-t.x1;
        if(gap<-0.35*H||gap>1.1*H) continue;
        if(Math.abs(w.yc-t.yc)>0.5*H) continue;
        if(Math.min(t.h,w.h)<0.4*H) continue;                 // a headline next to small print is not one line
        if(gap<bg){ bg=gap; best=i; }
      }
      if(best<0){ chains.push([w]); tails.push(w); w._c=chains.length-1; }
      else { const c=tails[best]._c; chains[c].push(w); w._c=c; tails[best]=w; }
    });
    return chains;
  }
  // The tilt of the text in radians (positive = lines run downhill to the right); 0 when level.
  function estimateSkew(words){
    const ws=prep(words), H=med(ws.map(w=>w.h))||1, a=[];
    chain(ws).forEach(c=>{ if(c.length<2) return; const f=c[0], l=c[c.length-1], dx=l.xc-f.xc; if(dx<3*H) return; a.push({v:Math.atan2(l.yc-f.yc, dx), w:dx}); });
    if(a.length<3) return 0;
    a.sort((p,q)=>p.v-q.v); const tot=a.reduce((s,p)=>s+p.w,0); let acc=0, v=0;
    for(const p of a){ acc+=p.w; if(acc>=tot/2){ v=p.v; break; } }
    return Math.abs(v)<0.004||Math.abs(v)>0.35?0:v;
  }
  R.estimateSkew=estimateSkew;

  function segOf(c, glue){
    c.sort((a,b)=>a.rx0-b.rx0);
    let text=''; c.forEach((w,i)=>{ if(i){ const p=c[i-1]; text+=(glue&&(w.rx0-p.rx1)<0.15*Math.max(p.h,w.h))?'':' '; } text+=w.text; });
    const cf=c.filter(w=>w.conf!=null&&/[A-Za-zÀ-ɏ0-9]/.test(w.text)).map(w=>w.conf);
    return {words:c, text, x0:c[0].rx0, x1:Math.max.apply(null,c.map(w=>w.rx1)), yc:c.reduce((s,w)=>s+w.ry,0)/c.length, h:med(c.map(w=>w.h)), conf:cf.length?Math.min.apply(null,cf):null};
  }
  // layout(words, {glue, skew}) → {columns:[{x0,x1,lines}], spanning:[line], skew, H}
  //   line = {text, no, conf, box:{x0,y0,x1,y1}}  (cells far apart on a row are joined with a TAB)
  // glue: join fragments that touch without a space (PDF text runs). skew: false = do not look for tilt.
  function layout(words, o){
    o=o||{};
    const ws=prep(words); if(!ws.length) return {columns:[], spanning:[], skew:0, H:0};
    const skew=o.skew===false?0:estimateSkew(ws), cs=Math.cos(skew), sn=Math.sin(skew);
    ws.forEach(w=>{ const rx=w.xc*cs+w.yc*sn, ry=-w.xc*sn+w.yc*cs, hw=(w.x1-w.x0)/2; w.rx0=rx-hw; w.rx1=rx+hw; w.ry=ry; });
    // chain again on the levelled positions
    const lv=ws.map(w=>({text:w.text, x0:w.rx0, x1:w.rx1, y0:w.ry-w.h/2, y1:w.ry+w.h/2, h:w.h, xc:(w.rx0+w.rx1)/2, yc:w.ry, _w:w}));
    let segs=chain(lv).map(c=>segOf(c.map(x=>x._w), o.glue));
    const H=med(ws.map(w=>w.h))||1;
    const gutters=findGutters(segs, H);
    // a segment lying across a gutter: two players on one row are cut apart; anything else is a line across the page
    const spanning=[], kept=[];
    segs.forEach(s=>{
      const g=gutters.filter(g=>s.x0<g.x0-0.2*H&&s.x1>g.x1+0.2*H);
      if(!g.length){ kept.push(s); return; }
      const cuts=[]; let ok=true;
      g.forEach(gt=>{ let k=-1; for(let i=1;i<s.words.length;i++){ const a=s.words[i-1], b=s.words[i]; if(a.rx1<=gt.x1+0.2*H&&b.rx0>=gt.x0-0.2*H){ k=i; break; } } if(k<0) ok=false; else cuts.push(k); });
      let parts=[]; if(ok){ let from=0; cuts.concat([s.words.length]).forEach(k=>{ parts.push(segOf(s.words.slice(from,k), o.glue)); from=k; }); }
      if(ok&&parts.every(p=>lineNo(p.text)!=null||isNumTok(p.words[0].text))) parts.forEach(p=>kept.push(p));
      else spanning.push(s);
    });
    // columns between the gutters
    const edges=gutters.map(g=>(g.x0+g.x1)/2);
    let cols=[]; for(let i=0;i<=edges.length;i++) cols.push({segs:[]});
    kept.forEach(s=>{ const xc=(s.x0+s.x1)/2; let i=0; while(i<edges.length&&xc>edges[i]) i++; cols[i].segs.push(s); });
    cols=cols.filter(c=>c.segs.length);
    // a column of bare numbers belongs to the names beside it
    for(let i=0;i<cols.length;i++){
      const c=cols[i], nn=c.segs.filter(s=>isNumTok(s.text)).length;
      if(cols.length>1&&nn>=0.8*c.segs.length){
        const j=i+1<cols.length?i+1:i-1;
        cols[j].segs=cols[j].segs.concat(c.segs); cols.splice(i,1); i--;
      }
    }
    const mkLines=segsIn=>{
      const hh=med(segsIn.map(s=>s.h))||H, rows=[];
      segsIn.slice().sort((a,b)=>a.yc-b.yc).forEach(s=>{
        const r=rows[rows.length-1];
        if(r&&Math.abs(s.yc-r.yc)<0.6*Math.min(hh,Math.max(s.h,r.h))){ r.segs.push(s); r.yc=r.segs.reduce((t,x)=>t+x.yc,0)/r.segs.length; r.h=Math.max(r.h,s.h); }
        else rows.push({segs:[s], yc:s.yc, h:s.h});
      });
      return rows.map(r=>{
        r.segs.sort((a,b)=>a.x0-b.x0);
        let text=''; r.segs.forEach((s,i)=>{ if(i) text+=(s.x0-r.segs[i-1].x1>=2*hh)?'\t':' '; text+=s.text; });
        const wds=[].concat.apply([], r.segs.map(s=>s.words)), cf=r.segs.map(s=>s.conf).filter(c=>c!=null);
        return {text, no:lineNo(text), conf:cf.length?Math.min.apply(null,cf):null, yc:r.yc, h:r.h,
          box:{x0:Math.min.apply(null,wds.map(w=>w.x0)), y0:Math.min.apply(null,wds.map(w=>w.y0)), x1:Math.max.apply(null,wds.map(w=>w.x1)), y1:Math.max.apply(null,wds.map(w=>w.y1))}};
      });
    };
    const columns=cols.map(c=>({x0:Math.min.apply(null,c.segs.map(s=>s.x0)), x1:Math.max.apply(null,c.segs.map(s=>s.x1)), lines:mkLines(c.segs)}));
    // a column with no numbers whose rows sit beside the rows of a numbered column (clubs, positions) is not a player list
    const out=[];
    columns.forEach(c=>{
      const p=out[out.length-1], nn=c.lines.filter(l=>l.no!=null).length;
      if(p&&!p.extra&&nn===0&&p.lines.filter(l=>l.no!=null).length>=5){
        const hit=c.lines.filter(l=>p.lines.some(q=>q.no!=null&&Math.abs(q.yc-l.yc)<0.6*Math.max(q.h,l.h))).length;
        if(hit>=0.7*c.lines.length){ c.extra=true; }
      }
      out.push(c);
    });
    return {columns:out.filter(c=>!c.extra), extra:out.filter(c=>c.extra), spanning:mkLines(spanning), skew, H};
  }
  // Empty vertical strips between columns of text. A strip counts when almost
  // no row crosses it (a title or a referee line may) and there is real text on both sides.
  function findGutters(segs, H){
    if(segs.length<6) return [];
    const tol=Math.max(1, Math.floor(segs.length*0.04)), ev=[];
    segs.forEach(s=>{ ev.push([s.x0,1]); ev.push([s.x1,-1]); });
    ev.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const raw=[]; let cov=0, start=null;
    for(const e of ev){ const before=cov; cov+=e[1];
      if(before>tol&&cov<=tol) start=e[0];
      else if(before<=tol&&cov>tol&&start!=null){ if(e[0]-start>=0.8*H) raw.push({x0:start, x1:e[0]}); start=null; } }
    // real text on both sides: at least 3 rows (and more than the tolerance) start inside each column
    const need=Math.max(3, tol+1);
    let g=raw.slice(), changed=true;
    while(changed&&g.length){
      changed=false;
      const edges=g.map(x=>(x.x0+x.x1)/2), n=new Array(g.length+1).fill(0);
      segs.forEach(s=>{ if(g.some(x=>s.x0<x.x0&&s.x1>x.x1)) return; const xc=(s.x0+s.x1)/2; let i=0; while(i<edges.length&&xc>edges[i]) i++; n[i]++; });
      for(let i=0;i<n.length;i++){ if(n[i]<need){ g.splice(Math.min(i,g.length-1),1); changed=true; break; } }
    }
    return g;
  }
  R.layout=layout;
  // does a page look like a team list? (many lines that start with a jersey number)
  R.looksLikeList=function(lay){ let n=0; (lay&&lay.columns||[]).forEach(c=>c.lines.forEach(l=>{ if(l.no!=null&&l.no<=40) n++; })); return n>=8; };

  // ── 2. lines → team lists ─────────────────────────────────────
  // Is this line a team's name used as a heading? ("GARRYMORE", "Garrymore GAA", "CLG Béal an Mhuirthead")
  function teamMatch(text, team){
    const a=foldKey(String(text).replace(/\b(?:v|vs|versus)\b\.?/gi,' ')), b=foldKey(team);
    if(!a||b.length<3) return false;
    if(a===b) return true;
    if(b.length>=4&&a.includes(b)&&a.length<=b.length+12) return true;
    return a.length>=5&&b.includes(a);
  }
  R.teamMatch=teamMatch;
  const isCapsHeading=t=>hasLetter(t)&&t===t.toUpperCase()&&!/[,\d]/.test(t);
  // columns (reading order) → the separate team lists found. A new list starts
  // where the jersey numbers start again (this number AND the next one were
  // already used); with no numbers, two columns are two lists, or the two
  // team names used as headings divide a single column.
  function splitTeams(columns, teams){
    teams=(teams||[]).filter(Boolean);
    const stream=[]; (columns||[]).forEach((c,ci)=>c.lines.forEach(l=>stream.push({l, ci})));
    const isHead=l=>teams.some(t=>teamMatch(l.text,t))||isCapsHeading(l.text);
    let blocks=[], cur=null, lastNumCol=-1;
    const start=()=>{ cur={items:[], seen:new Set(), nn:0}; blocks.push(cur); }; start();
    const nextNo=i=>{ for(let j=i+1;j<stream.length;j++) if(stream[j].l.no!=null) return stream[j].l.no; return null; };
    stream.forEach((s,i)=>{
      const n=s.l.no;
      if(n!=null&&cur.nn>=5&&cur.seen.has(n)){
        const m=nextNo(i);
        if(m!=null&&cur.seen.has(m)){
          const tail=[]; while(cur.items.length&&cur.items[cur.items.length-1].l.no==null) tail.unshift(cur.items.pop());
          // lines above the first number of the new list: all of them when it starts a new column, else from its heading on
          let k;
          if(s.ci!==lastNumCol){ k=tail.findIndex(x=>x.ci===s.ci); }
          else { k=tail.findIndex(x=>isHead(x.l)); }
          if(k<0) k=tail.length;
          tail.slice(0,k).forEach(x=>cur.items.push(x));
          start(); tail.slice(k).forEach(x=>cur.items.push(x));
        }
      }
      cur.items.push(s); if(n!=null){ cur.seen.add(n); cur.nn++; lastNumCol=s.ci; }
    });
    blocks=blocks.map(b=>({lines:b.items.map(x=>x.l), numbered:b.nn}));
    const total=blocks.reduce((t,b)=>t+b.numbered,0);
    if(blocks.length===1&&total<3&&columns.length===2) blocks=columns.map(c=>({lines:c.lines.slice(), numbered:c.lines.filter(l=>l.no!=null).length}));
    if(blocks.length===1&&teams.length===2){
      const L=blocks[0].lines, idx=t=>L.findIndex(l=>l.no==null&&teamMatch(l.text,t)&&!teamMatch(l.text, t===teams[0]?teams[1]:teams[0]));
      const i=idx(teams[0]), j=idx(teams[1]), cut=Math.max(i,j);
      if(i>=0&&j>=0&&i!==j&&cut>=3&&L.length-cut>=4) blocks=[L.slice(0,cut), L.slice(cut)].map(x=>({lines:x, numbered:x.filter(l=>l.no!=null).length}));
    }
    blocks=blocks.filter(b=>b.lines.filter(l=>l.no!=null||hasLetter(l.text)).length>=3||blocks.length===1);
    let more=0;
    if(blocks.length>2){ const keep=blocks.map((b,i)=>({b,i})).sort((x,y)=>y.b.numbered-x.b.numbered||x.i-y.i).slice(0,2).sort((x,y)=>x.i-y.i); more=blocks.length-2; blocks=keep.map(x=>x.b); }
    blocks.forEach(b=>{ const L=b.lines.filter(l=>l.box); b.page=L.length?L[0].page:undefined;
      const P=L.filter(l=>l.page===b.page);
      b.box=P.length?{x0:Math.min.apply(null,P.map(l=>l.box.x0)), y0:Math.min.apply(null,P.map(l=>l.box.y0)), x1:Math.max.apply(null,P.map(l=>l.box.x1)), y1:Math.max.apply(null,P.map(l=>l.box.y1))}:null; });
    blocks.more=more;
    return blocks;
  }
  R.splitTeams=splitTeams;

  // Which list is the home team's? → {first:'home'|'away', why:'headings'|'title'|'default'}
  // headings: a team name above a list. title: "X v Y" — the first-named team is taken to be the first list.
  function assignTeams(blocks, spanning, home, away){
    const head=b=>{ const o=[]; if(b) for(const l of b.lines){ if(l.no!=null) break; o.push(l.text); } return o; };
    const A=head(blocks[0]), B=head(blocks[1]);
    const has=(L,t)=>!!t&&L.some(x=>teamMatch(x,t));
    const aH=has(A,home), aA=has(A,away), bH=has(B,home), bA=has(B,away);
    const fh=(aH&&!aA?1:0)+(bA&&!bH?1:0), fa=(aA&&!aH?1:0)+(bH&&!bA?1:0);
    if(fh>fa) return {first:'home', why:'headings'};
    if(fa>fh) return {first:'away', why:'headings'};
    const kh=foldKey(home), ka=foldKey(away);
    if(kh.length>=3&&ka.length>=3) for(const t of (spanning||[]).map(l=>l.text).concat(A)){
      const k=foldKey(t), i=k.indexOf(kh), j=k.indexOf(ka);
      if(i>=0&&j>=0&&i!==j) return {first:i<j?'home':'away', why:'title'};
    }
    return {first:'home', why:'default'};
  }
  R.assignTeams=assignTeams;

  // ── 3. clean-up before the editor's parser ────────────────────
  // Conservative: a line is only left out when it is clearly not a player; an
  // unsure line stays in the text for the user to see in the preview.
  // (all tested on the text with fadas removed and in lower case)
  // headings the editor's parser understands itself ("Subs", "Starting 15") are always passed on
  const RE_SUBSF=/^(?:subs?|substitutes?|substitutions?|replacements?|bench|fir\s+ionaid|ionadaithe)\b/;
  const RE_STARTF=/^(?:starting(?:\s+(?:xv|15|team|line[\s-]?up))?|starters?|team|line[\s-]?up|first\s+15|xv)\s*[:\-–]?$/;
  const RE_KEEP={test:f=>RE_SUBSF.test(f)||RE_STARTF.test(f)};
  const OFFICIAL='(?:team\\s+)?(?:managers?|management|bainisteoir\\w*|selectors?|roghnoir\\w*|coach(?:es)?|trainers?|traenalai|physio\\w*|doctor|kitman|maor\\s+\\w+|referee|reiteoir|moltoir|linesm[ae]n|umpires?|maoir|standby\\s+referee|fourth\\s+official|match\\s+officials?|officials?|captain|captaen|vice[\\s-]?captain|chairman|chairperson|cathaoirleach|secretary|runai|sponsors?|sponsored\\s+by|venue|throw[\\s-]?in)';
  const RE_OFFICIAL=new RegExp('^'+OFFICIAL+'\\b'), RE_OFFICIAL_IN=new RegExp('[(\\[]\\s*'+OFFICIAL+'\\b');
  const RE_POSITION=/^(?:goal\s?keepers?|goalie|keepers?|cul\s?baire|(?:(?:full|half|corner|centre|center|wing|left|right)[\s-]*){1,3}(?:backs?|forwards?|line)|backs?|forwards?|defen[cs]e|defenders?|attack(?:ers)?|mid[\s-]?field(?:ers)?|lar\s+na\s+pairce|tosaithe|cosantoiri|cuil|lantosaithe)\s*[:\-]?$/;
  const RE_EVENT=/\b(?:19|20)\d\d\b|\b\d{1,2}[:.]\d{2}\s*(?:am|pm)\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|april|june|july|august|september|october|november|december)\b|\b(?:championship|league|semi[\s-]?finals?|quarter[\s-]?finals?|final|programme|clar\s+oifigiuil|team\s+sheets?|fixtures?)\b|www\.|\.ie\b|\.com\b|@/;
  const RE_BRACKET=/\s*[(\[][^()\[\]]*[A-Za-zÀ-ɏ][^()\[\]]*[)\]]/g;
  const WHY={marks:'no letters or numbers', official:'manager / official', team:'team name', position:'position heading', event:'fixture / date / venue', bracket:'only a note in brackets', across:'a line across both columns', column:'a second column beside the names'};
  R.WHY=WHY;
  const looseKey=s=>fold(s).replace(/[^a-z]/g,'');
  // known spellings by their loose key (fadas, apostrophes, spaces and hyphens ignored); a key shared by two different players is not used
  function looseIndex(known){
    const m=new Map();
    (known||[]).forEach(n=>{ const k=looseKey(n); if(!k||!T) return; const nk=T.nameKey(n); if(!m.has(k)) m.set(k,new Set()); m.get(k).add(nk); });
    return name=>{ const s=m.get(looseKey(name)); if(!s||s.size!==1) return ''; const nk=[...s][0]; return T.matchKnown((known||[]).find(n=>T.nameKey(n)===nk), known); };
  }
  // cleanLines(lines, {teams:[…], known:[…]}) → {lines:[{text, conf}], dropped:[{text, why}], adopted:[{from,to}], joined:n}
  function cleanLines(lines, ctx){
    ctx=ctx||{};
    const teams=(ctx.teams||[]).filter(Boolean), dropped=[], adopted=[], keep=[]; let joined=0;
    const drop=(text,why)=>dropped.push({text, why:WHY[why]||why});
    (lines||[]).forEach(l=>{
      const raw=String(l.text==null?'':l.text);
      // table rules and stray marks an image reader picks up
      let cells=raw.split('\t').map(c=>c.replace(/[|¦]/g,' ').replace(/^[\s_~=•·*»«›‹]+|[\s_~=•·*»«›‹]+$/g,'').replace(/ {2,}/g,' ')).filter(Boolean);
      let t=cells.join('\t');
      if(!/[A-Za-zÀ-ɏ0-9]/.test(t)){ if(raw.trim()) drop(raw,'marks'); return; }
      const f=fold(t).trim(), numbered=lineNo(t)!=null||cells.length>1;
      if(!numbered&&!isNumTok(t)&&!RE_KEEP.test(f)){
        if(RE_OFFICIAL.test(f)||RE_OFFICIAL_IN.test(f)) return drop(raw,'official');
        if(teams.some(x=>teamMatch(t,x))) return drop(raw,'team');
        if(RE_POSITION.test(f)) return drop(raw,'position');
        if(RE_EVENT.test(f)) return drop(raw,'event');
      }
      // "7 Jack Coyne (Ballyhaunis)" / "(Capt.)" → the note in brackets goes; "Name (7)" is a number and stays
      if(!RE_KEEP.test(f)){
        cells=cells.map(c=>c.replace(RE_BRACKET,'').trim()).filter(Boolean);
        const t2=cells.join('\t');
        if(!/[A-Za-zÀ-ɏ0-9]/.test(t2)) return drop(raw,'bracket');
        t=t2;
      }
      keep.push({text:t, conf:l.conf==null?null:l.conf, box:l.box, page:l.page});
    });
    // a number on one line and the name on the next (or the name then its number)
    const kind=x=>isNumTok(x.text)?'n':(lineNo(x.text)==null&&hasLetter(x.text)&&!/\t|,/.test(x.text)&&!RE_KEEP.test(fold(x.text).trim())?'a':'x');
    const out=[];
    for(let i=0;i<keep.length;){
      let j=i; const k0=kind(keep[i]);
      if(k0!=='x'){ while(j+1<keep.length&&kind(keep[j+1])!=='x'&&kind(keep[j+1])!==kind(keep[j])) j++; }
      const len=j-i+1;
      // only a clean run is paired. It starts with a number; or with a name and ends with a number (name above
      // number); a run of odd length that starts with a name is a heading followed by number / name pairs.
      const run=keep.slice(i,j+1), nn=run.filter(x=>kind(x)==='n').length;
      let from=i, numFirst=false, pair=false;
      if(k0==='n'&&len>=2){ numFirst=true; pair=true; }
      else if(k0==='a'&&len>=4&&len%2===0&&nn>=2){ pair=true; }
      else if(k0==='a'&&len>=3&&len%2===1){ from=i+1; numFirst=true; pair=true; }
      if(pair){
        for(let k=i;k<from;k++) out.push(keep[k]);
        const m=j+1-from, end=from+m-(m%2);
        for(let k=from;k<end;k+=2){ const a=keep[k], b=keep[k+1], num=numFirst?a:b, nm=numFirst?b:a, cf=[a.conf,b.conf].filter(c=>c!=null);
          out.push({text:num.text.replace(/[^\d]/g,'')+' '+nm.text, conf:cf.length?Math.min.apply(null,cf):null, box:nm.box, page:nm.page}); joined++; }
        for(let k=end;k<=j;k++) out.push(keep[k]);
      } else for(let k=i;k<=j;k++) out.push(keep[k]);
      i=j+1;
    }
    // O' / Ó, Mc / Mac spacing, fadas: only ever changed TO a spelling this team already has
    if(T&&ctx.known&&ctx.known.length){
      const loose=looseIndex(ctx.known);
      out.forEach(x=>{
        x.text=x.text.split('\t').map(c=>{
          const p=T.splitNumberName(c); if(!p.name||isNumTok(c)||T.matchKnown(p.name, ctx.known)) return c;
          const hit=loose(p.name); if(!hit||hit===p.name||c.indexOf(p.name)<0) return c;
          adopted.push({from:p.name, to:hit}); return c.replace(p.name, ()=>hit);
        }).join('\t');
      });
    }
    return {lines:out, dropped, adopted, joined};
  }
  R.cleanLines=cleanLines;

  // ── 4. the whole pure pipeline ────────────────────────────────
  const LOW=70;                                   // a line with a word the image reader was under 70% sure of is flagged
  R.LOW=LOW;
  // compose([{n, words, glue, skew}], {homeTeam, awayTeam}) → {lists:[{lines, box, page}], assign, spanning, extra, more}
  function compose(pages, o){
    o=o||{};
    let columns=[], spanning=[], extra=[];
    (pages||[]).forEach(p=>{
      const lay=p.layout||layout(p.words, {glue:p.glue, skew:p.skew});
      const tag=l=>{ l.page=p.n; return l; };
      lay.columns.forEach(c=>columns.push({lines:c.lines.map(tag)}));
      lay.spanning.forEach(l=>spanning.push(tag(l)));
      (lay.extra||[]).forEach(c=>c.lines.forEach(l=>extra.push(tag(l))));
    });
    const lists=splitTeams(columns, [o.homeTeam, o.awayTeam]);
    return {lists:lists.slice(), more:lists.more||0, assign:assignTeams(lists, spanning, o.homeTeam, o.awayTeam), spanning, extra};
  }
  R.compose=compose;
  // One list cleaned for one team → {text, lines:[{text, confidence, low}], confidence, dropped, adopted, joined, box, page}
  function finish(list, o){
    o=o||{};
    const c=cleanLines(list?list.lines:[], {teams:[o.homeTeam, o.awayTeam], known:o.known});
    const lines=c.lines.map(l=>({text:l.text, confidence:l.conf, low:l.conf!=null&&l.conf<LOW, box:l.box, page:l.page}));
    const cf=lines.map(l=>l.confidence).filter(v=>v!=null);
    return {text:lines.map(l=>l.text).join('\n'), lines, confidence:cf.length?Math.round(cf.reduce((a,b)=>a+b,0)/cf.length):null,
      dropped:c.dropped, adopted:c.adopted, joined:c.joined, box:list?list.box:null, page:list?list.page:undefined};
  }
  R.finish=finish;
  // Which list goes to which team. side: 'both' | 'home' | 'away'; o.first ('home'|'away') overrides the guess.
  // → {home, away, assign:{first, why}, lists:n}   (a side that gets no list is null)
  function deal(comp, side, o){
    o=o||{};
    const L=comp.lists, first=o.first||comp.assign.first, why=o.first?'chosen':comp.assign.why;
    const fin=(list,sd)=>list?finish(list, {homeTeam:o.homeTeam, awayTeam:o.awayTeam, known:(o.known||{})[sd]}):null;
    const res={home:null, away:null, assign:{first, why}, lists:L.length};
    if(side==='home'||side==='away'){
      // one team asked for: its own list when two were found (by heading, else the first)
      res[side]=fin(L.length>1?L[first===side?0:1]:L[0], side);
    } else if(L.length>1){ const other=first==='home'?'away':'home'; res[first]=fin(L[0], first); res[other]=fin(L[1], other); }
    else if(L.length===1) res[first]=fin(L[0], first);
    return res;
  }
  R.deal=deal;

  root.cohTSReader=R;
  if(typeof module!=='undefined'&&module.exports) module.exports=R;
})(typeof window!=='undefined'?window:globalThis);
