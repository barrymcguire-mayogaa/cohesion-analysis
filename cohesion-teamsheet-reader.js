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
      const g=gutters.filter(g=>s.x0<g.x1-0.5*H&&s.x1>g.x1+0.5*H);                // it runs past where the next column starts
      if(!g.length){ kept.push(s); return; }
      const cuts=[]; let ok=true;
      g.forEach(gt=>{ let k=-1, kg=-1;                                              // cut where the next player's number starts, else at the widest gap in the strip
        for(let i=1;i<s.words.length;i++){ const a=s.words[i-1], b=s.words[i]; if(a.rx1<=gt.x1+0.2*H&&b.rx0>=gt.x0-0.2*H){
          if(isNumTok(b.text)){ k=i; break; } if(b.rx0-a.rx1>kg){ kg=b.rx0-a.rx1; k=i; } } }
        if(k<0) ok=false; else cuts.push(k); });
      let parts=[]; if(ok){ let from=0; cuts.concat([s.words.length]).forEach(k=>{ parts.push(segOf(s.words.slice(from,k), o.glue)); from=k; }); }
      const numd=p=>lineNo(p.text)!=null;
      if(ok&&parts.every(numd)) parts.forEach(p=>kept.push(p));                      // "24 Long Name" + "24 Mark Gibbons"
      else if(ok&&isNumTok(parts[0].text)&&parts.length===2&&numd(s)) kept.push(s);   // "2" + "James Lavelle": one player
      else spanning.push(s);
    });
    // the rest of a line that runs across the page ("… CHAMPIONSHIP" + "— ROUND 2", "Referee: … · Linesmen: …")
    for(let i=kept.length-1;i>=0;i--){ const s=kept[i];
      if(lineNo(s.text)==null&&!isNumTok(s.text)&&spanning.some(p=>Math.abs(p.yc-s.yc)<0.5*Math.max(p.h,s.h)&&Math.min(p.h,s.h)>0.6*Math.max(p.h,s.h))){ spanning.push(s); kept.splice(i,1); } }
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
  // Empty vertical strips between columns of text. A strip counts when a good
  // run of rows (the lists) has text on both sides of it and nothing across it;
  // titles, dates and a referee line above or below that run may cross it.
  function findGutters(segs, H){
    if(segs.length<6) return [];
    const loose=Math.max(2, Math.floor(segs.length*0.25)), ev=[];
    segs.forEach(s=>{ ev.push([s.x0,1]); ev.push([s.x1,-1]); });
    ev.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    // the coverage (how many rows have text at x), as pieces; then each dip's emptiest stretch
    const pieces=[]; let cov=0, px=null;
    for(const e of ev){ if(px!=null&&e[0]>px) pieces.push({x0:px, x1:e[0], cov}); cov+=e[1]; px=e[0]; }
    // candidate strips: stretches crossed by at most t rows, tried from t = 0 upwards so the emptiest win
    const ok=c=>{
      const mid=(c.x0+c.x1)/2, cross=segs.filter(s=>s.x0<mid&&s.x1>mid).map(s=>s.yc).sort((a,b)=>a-b);
      const L=segs.filter(s=>s.x1<=mid), Rr=segs.filter(s=>s.x0>=mid), ys=[-Infinity].concat(cross, [Infinity]);
      // the clear run must hold at least as many rows as there are lines crossing the strip anywhere on the page
      // (so the gap between a number and its name, which half the rows bridge, is not taken for a column gap)
      for(let k=0;k+1<ys.length;k++){ const a=ys[k], b=ys[k+1], inb=s=>s.yc>a&&s.yc<b, m=Math.min(L.filter(inb).length, Rr.filter(inb).length);
        if(m>=need&&cross.length<=Math.max(3,m)){                                   // xr: where the next column's rows start (the first x at which several rows begin)
          const xs=Rr.filter(inb).map(s=>s.x0).sort((p,q)=>p-q); let xr=xs[0];
          for(let i=0;i<xs.length;i++){ if(xs.filter(x=>x>=xs[i]&&x<=xs[i]+1.5*H).length>=need){ xr=xs[i]; break; } }
          return {xr}; } }
      return null;
    };
    const need=4; let g=[];
    for(let t=0;t<=loose;t++){
      let cur=null; const found=[];
      pieces.forEach((p,i)=>{ if(p.cov<=t){ if(cur&&cur.x1===p.x0) cur.x1=p.x1; else { cur={x0:p.x0, x1:p.x1, first:i===0}; found.push(cur); } cur.last=i===pieces.length-1; } else cur=null; });
      found.sort((a,b)=>(b.x1-b.x0)-(a.x1-a.x0)).forEach(c=>{ if(c.first||c.last||c.x1-c.x0<0.8*H) return; if(g.some(x=>c.x0<x.x1&&c.x1>x.x0)) return; const r=ok(c); if(r) g.push({x0:c.x0, x1:Math.max(c.x1, r.xr)}); });
    }
    g.sort((a,b)=>a.x0-b.x0);
    // and enough rows start inside every column that results
    let changed=true;
    while(changed&&g.length){
      changed=false;
      const edges=g.map(x=>(x.x0+x.x1)/2), n=new Array(g.length+1).fill(0);
      segs.forEach(s=>{ if(g.some(x=>s.x0<x.x0&&s.x1>x.x1)) return; const xc=(s.x0+s.x1)/2; let i=0; while(i<edges.length&&xc>edges[i]) i++; n[i]++; });
      for(let i=0;i<n.length;i++){ if(n[i]<3){                                  // a sliver: drop the narrower of the strips beside it
        const a=i-1, b=i, w=k=>k>=0&&k<g.length?g[k].x1-g[k].x0:Infinity;
        g.splice(w(a)<w(b)?a:b,1); changed=true; break; } }
    }
    return g;
  }
  R.layout=layout;
  // does a page look like a team list? (many lines that start with a jersey number)
  R.looksLikeList=function(lay){ let n=0; (lay&&lay.columns||[]).forEach(c=>c.lines.forEach(l=>{ if(l.no!=null&&l.no<=40) n++; })); return n>=8; };

  // ── 2. lines → team lists ─────────────────────────────────────
  // Is this line a team's name used as a heading? ("GARRYMORE", "Garrymore GAA", "CLG Béal an Mhuirthead")
  const RE_V=/\s+(?:v|vs|versus)\.?\s+/i;
  function teamMatch(text, team){
    if(RE_V.test(' '+String(text).trim()+' ')&&String(text).trim().split(RE_V).filter(Boolean).length>1) return false;   // "X v Y" is a fixture title, not one team's heading
    const a=foldKey(String(text).replace(/\b(?:v|vs|versus)\b\.?/gi,' ')), b=foldKey(team);
    if(!a||b.length<3) return false;
    if(a===b) return true;
    if(b.length>=4&&a.includes(b)&&a.length<=b.length+12) return true;
    return a.length>=5&&b.includes(a);
  }
  // "Béal an Mhuirthead v Garrymore": a fixture title naming one of the teams
  const isFixture=(text, teams)=>{ const p=String(text).trim().split(RE_V).filter(Boolean); return p.length>1&&p.some(x=>teams.some(t=>teamMatch(x,t))); };
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
  const RE_SUBS2=/^(?:(?:subs?|substitutes?|substitutions?|replacements?|bench|fir\s+ionaid|ionadaithe)[\s\/|,&\-–:.]*){2,}$/;
  const RE_KEEP={test:f=>RE_SUBSF.test(f)||RE_STARTF.test(f)};
  const OFFICIAL='(?:team\\s+)?(?:managers?|management|bainisteoir\\w*|selectors?|roghnoir\\w*|coach(?:es)?|trainers?|traenalai|physio\\w*|doctor|kitman|maor\\s+\\w+|referee|reiteoir|moltoir|linesm[ae]n|umpires?|maoir|standby\\s+referee|fourth\\s+official|match\\s+officials?|officials?|captain|captaen|vice[\\s-]?captain|chairman|chairperson|cathaoirleach|secretary|runai|sponsors?|sponsored\\s+by|venue|throw[\\s-]?in)';
  const RE_OFFICIAL=new RegExp('^'+OFFICIAL+'\\b'), RE_OFFICIAL_IN=new RegExp('[(\\[]\\s*'+OFFICIAL+'\\b');
  const RE_POSITION=/^(?:goal\s?keepers?|goalie|keepers?|cul\s?baire|(?:(?:full|half|corner|centre|center|wing|left|right)[\s-]*){1,3}(?:backs?|forwards?|line)(?:\s+line)?|backs?|forwards?|defen[cs]e|defenders?|attack(?:ers)?|mid[\s-]?field(?:ers)?|lar\s+na\s+pairce|tosaithe|cosantoiri|cuil|lantosaithe)\s*[:\-]?$/;
  const RE_EVENT=/\b(?:19|20)\d\d\b|\b\d{1,2}[:.]\d{2}\s*(?:am|pm)\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|april|june|july|august|september|october|november|december)\b|\b(?:championship|league|semi[\s-]?finals?|quarter[\s-]?finals?|final|programme|clar\s+oifigiuil|team\s+sheets?|fixtures?|round\s+\d+)\b|www\.|\.ie\b|\.com\b|@/;
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
      let cells=raw.split('\t').map(c=>c.replace(/[|¦]/g,' ').replace(/^[\s_~=•·*»«›‹]+|[\s_~=•·*»«›‹]+$/g,'').replace(/^[-–—.]+\s+|\s+[-–—]+$/g,'').replace(/ {2,}/g,' ')).filter(Boolean);
      let t=cells.join('\t');
      if(!/[A-Za-zÀ-ɏ0-9]/.test(t)){ if(raw.trim()) drop(raw,'marks'); return; }
      // a two-language heading ("Fir Ionaid / Subs") is passed on as the one word the parser knows
      if(RE_SUBS2.test(fold(t).trim())){ keep.push({text:'Subs', conf:null, box:l.box, page:l.page, heading:true}); return; }
      const f=fold(t).trim(), numbered=lineNo(t)!=null||cells.length>1;
      if(!numbered&&!isNumTok(t)&&!RE_KEEP.test(f)){
        if(RE_OFFICIAL.test(f)||RE_OFFICIAL_IN.test(f)) return drop(raw,'official');
        if(teams.some(x=>teamMatch(t,x))||isFixture(t,teams)) return drop(raw,'team');
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

/* ══ BROWSER: the libraries, PDF text, picture preparation, recognition ══ */
(function(root){
  'use strict';
  if(typeof window==='undefined'||typeof document==='undefined') return;
  const R=root.cohTSReader;
  // Exact versions, one public CDN. Nothing here is fetched until a file is chosen.
  const CDN='https://cdn.jsdelivr.net/npm/';
  const LIB=R.LIB={
    host:'cdn.jsdelivr.net',
    pdf:{name:'pdf.js', ver:'3.11.174', mb:0.4,
      js:CDN+'pdfjs-dist@3.11.174/build/pdf.min.js', sri:'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e',
      worker:CDN+'pdfjs-dist@3.11.174/build/pdf.worker.min.js', cmaps:CDN+'pdfjs-dist@3.11.174/cmaps/', fonts:CDN+'pdfjs-dist@3.11.174/standard_fonts/'},
    ocr:{name:'Tesseract.js', ver:'5.1.1', mb:5,
      js:CDN+'tesseract.js@5.1.1/dist/tesseract.min.js', sri:'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F',
      worker:CDN+'tesseract.js@5.1.1/dist/worker.min.js', core:CDN+'tesseract.js-core@5.1.1',
      langBase:CDN+'@tesseract.js-data', lang:l=>CDN+'@tesseract.js-data/'+l+'@1.0.0/4.0.0_best_int/'+l+'.traineddata.gz'}
  };
  const LIMIT=R.LIMIT={pdfMB:60, imageMB:40, pages:40, pick:6, long:2000, viewLong:1600, pixels:60e6};
  // Tesseract page segmentation. 6 ("one block of text") is tried first: it keeps a narrow column of jersey
  // numbers attached to the names. If that finds few numbered lines (a busy page: adverts, pictures), 3
  // ("automatic") is tried as well and whichever found more numbered lines is used.
  R.PSM=['6','3'];
  const numbered=words=>{ let n=0; R.layout(words).columns.forEach(c=>c.lines.forEach(l=>{ if(l.no!=null) n++; })); return n; };

  function err(code, msg){ const e=new Error(msg); e.code=code; return e; }
  const MSG=R.MSG={
    cdn:()=>'The reader could not be downloaded from '+LIB.host+'. '+(navigator.onLine===false?'This device is offline.':'The connection may be down, or a content blocker or network filter may be stopping it.')+' Pasting or typing the list still works.',
    slow:()=>'The reader stopped responding while it was being downloaded — the connection may be too slow or blocked. Try again, or paste or type the list.',
    type:n=>'“'+n+'” is not a file this can read. Choose a PDF, or a JPG, PNG or WebP picture.',
    heic:()=>'This photo is in HEIC format, which this browser cannot open. Open it in Safari on the iPhone or iPad, or save it as a JPG (a screenshot of the photo also works) and choose that.',
    image:()=>'This picture could not be opened — the file may be damaged or in a format this browser does not support. A JPG or PNG (or a screenshot) will work.',
    password:()=>'This PDF is password-protected, so it cannot be read. Save or print it to a new PDF without the password (or take a screenshot of the page) and choose that.',
    pdf:()=>'This PDF could not be opened — the file may be damaged.',
    bigpdf:()=>'This PDF is over '+LIMIT.pdfMB+' MB, which is too large to read here. Save just the team sheet page as its own PDF, or take a screenshot of it.',
    bigimage:()=>'This picture is over '+LIMIT.imageMB+' MB, which is too large to read here. Use a smaller copy or a screenshot of it.',
    empty:()=>'No team list could be read from this file. If it is a photo, try a sharper, straighter one with the list filling the picture — or paste or type the list.',
    cancel:()=>'Stopped.'
  };

  const scripts={};
  function loadScript(url, sri){
    return scripts[url]||(scripts[url]=new Promise((res,rej)=>{
      const s=document.createElement('script'); s.src=url; s.async=true; s.crossOrigin='anonymous'; if(sri) s.integrity=sri;
      s.onload=()=>res(); s.onerror=()=>{ delete scripts[url]; s.remove(); rej(err('cdn', MSG.cdn())); };
      document.head.appendChild(s);
    }));
  }
  // one read at a time can be cancelled: job.cancel() stops the workers and rejects whatever is waiting
  function newJob(signal){
    const job={cancelled:false, stop:[], wait:null};
    job.gone=new Promise((_,rej)=>{ job.cancel=()=>{ if(job.cancelled) return; job.cancelled=true; job.stop.splice(0).forEach(f=>{ try{ f(); }catch(_){} }); rej(err('cancel', MSG.cancel())); }; });
    job.gone.catch(()=>{});
    job.race=p=>Promise.race([p, job.gone]);
    job.end=()=>{ job.stop.splice(0).forEach(f=>{ try{ f(); }catch(_){} }); };
    if(signal){ if(signal.aborted) job.cancel(); else signal.addEventListener('abort', job.cancel); }
    return job;
  }
  const tick=()=>new Promise(r=>setTimeout(r,0));
  function canvasOf(w,h){ const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(w)); c.height=Math.max(1,Math.round(h)); return c; }

  // ── what kind of file is it? (by its first bytes, not its name) ──
  async function sniff(file){
    let b=new Uint8Array(0); try{ b=new Uint8Array(await file.slice(0,16).arrayBuffer()); }catch(_){}
    const s=String.fromCharCode.apply(null,b), name=String(file.name||'').toLowerCase(), type=String(file.type||'').toLowerCase();
    if(s.indexOf('%PDF')>=0||type==='application/pdf'||/\.pdf$/.test(name)) return 'pdf';
    if(s.slice(4,8)==='ftyp'&&/hei[cfsx]|mif1|msf1|hev[cx]/.test(s.slice(8,12))||/hei[cf]/.test(type)||/\.hei[cf]$/.test(name)) return 'heic';
    if(/^image\//.test(type)||/\.(jpe?g|png|webp|gif|bmp|avif)$/.test(name)||(b[0]===0xFF&&b[1]===0xD8)||s.slice(1,4)==='PNG'||s.slice(0,4)==='RIFF') return 'image';
    return '';
  }

  // ── pictures: decode (EXIF turn applied), scale, grey, stretch the contrast ──
  async function decode(file, kind){
    try{ if(root.createImageBitmap) return await createImageBitmap(file, {imageOrientation:'from-image'}); }catch(_){}
    try{
      return await new Promise((res,rej)=>{ const u=URL.createObjectURL(file), im=new Image();
        im.onload=()=>{ URL.revokeObjectURL(u); res(im); }; im.onerror=()=>{ URL.revokeObjectURL(u); rej(new Error('decode')); }; im.src=u; });
    }catch(_){ throw err(kind==='heic'?'heic':'image', kind==='heic'?MSG.heic():MSG.image()); }
  }
  // → {view: colour canvas (what the user is shown), work: grey canvas (what is read)}
  function prepare(src, sw, sh){
    let s=LIMIT.long/Math.max(sw,sh); if(s>1) s=Math.min(s,2);                    // small pictures are enlarged, at most 2×
    const view=canvasOf(sw*s, sh*s), g=view.getContext('2d');
    g.fillStyle='#fff'; g.fillRect(0,0,view.width,view.height); g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high';
    g.drawImage(src,0,0,view.width,view.height);
    return {view, work:greyStretch(view)};
  }
  function greyStretch(view){
    const work=canvasOf(view.width, view.height), g=work.getContext('2d'); g.drawImage(view,0,0);
    const im=g.getImageData(0,0,work.width,work.height), d=im.data, hist=new Uint32Array(256), n=d.length/4;
    for(let i=0;i<d.length;i+=4){ const v=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8; d[i]=v; hist[v]++; }
    let lo=0, hi=255, acc=0; for(let v=0;v<256;v++){ acc+=hist[v]; if(acc>=n*0.01){ lo=v; break; } }
    acc=0; for(let v=255;v>=0;v--){ acc+=hist[v]; if(acc>=n*0.01){ hi=v; break; } }
    const span=hi-lo, lut=new Uint8Array(256);
    for(let v=0;v<256;v++) lut[v]=span>=40&&span<235?Math.max(0,Math.min(255,Math.round((v-lo)*255/span))):v;   // only a washed-out picture is stretched
    for(let i=0;i<d.length;i+=4){ const v=lut[d[i]]; d[i]=d[i+1]=d[i+2]=v; d[i+3]=255; }
    g.putImageData(im,0,0);
    return work;
  }
  R._prepare=prepare;

  // ── text recognition (Tesseract.js in a worker) ───────────────
  let gleOK=null;
  async function ocrOpen(job, prog){
    prog({stage:'load', pct:0, engine:'ocr'});
    await job.race(loadScript(LIB.ocr.js, LIB.ocr.sri));
    if(!root.Tesseract||!root.Tesseract.createWorker) throw err('cdn', MSG.cdn());
    // Irish (for fadas) only if its data really is on the CDN
    if(gleOK==null){ try{ const r=await job.race(fetch(LIB.ocr.lang('gle'), {method:'HEAD'})); gleOK=!!r.ok; }catch(e){ if(e.code==='cancel') throw e; gleOK=false; } }
    const langs=gleOK?['eng','gle']:['eng'];
    // The worker asks for <langBase>/<lang>.traineddata.gz; this shim points each to its pinned package version.
    const map={}; langs.forEach(l=>{ map[LIB.ocr.langBase+'/'+l+'.traineddata.gz']=LIB.ocr.lang(l); });
    const shim='(function(){var f=self.fetch.bind(self),M='+JSON.stringify(map)+';self.fetch=function(u,o){var k=String(u&&u.url||u);return f(M[k]||u,o);};})();importScripts('+JSON.stringify(LIB.ocr.worker)+');';
    const url=URL.createObjectURL(new Blob([shim], {type:'application/javascript'}));
    const st={phase:'load', last:Date.now(), fail:null};
    const failed=new Promise((_,rej)=>{ st.fail=rej; }); failed.catch(()=>{});
    const watch=setInterval(()=>{ const idle=Date.now()-st.last; if(st.phase==='load'&&idle>60000) st.fail(err('cdn', MSG.slow())); else if(st.phase==='read'&&idle>180000) st.fail(err('empty', 'Reading this picture is taking too long on this device. Try a smaller or sharper picture, or paste or type the list.')); }, 2000);
    const W={job:null};
    const logger=m=>{ st.last=Date.now(); if(!m) return;
      if(m.status==='recognizing text'){ st.phase='read'; prog({stage:'read', pct:(W.base||0)+(W.span||1)*(m.progress||0), page:W.page, of:W.of}); }
      else if(st.phase==='load'){ const base={'loading tesseract core':0.05,'initializing tesseract':0.45,'loading language traineddata':0.5,'initializing api':0.95}[m.status]; if(base!=null) prog({stage:'load', pct:Math.min(0.99, base+(m.status==='loading tesseract core'?0.4:m.status==='loading language traineddata'?0.45:0)*(m.progress||0)), engine:'ocr'}); } };
    let worker=null;
    const close=()=>{ clearInterval(watch); URL.revokeObjectURL(url); if(worker){ try{ worker.terminate(); }catch(_){} worker=null; } };
    job.stop.push(close);
    try{
      worker=await job.race(Promise.race([failed, root.Tesseract.createWorker(langs.join('+'), 1, {workerPath:url, workerBlobURL:false, corePath:LIB.ocr.core, langPath:LIB.ocr.langBase, logger,
        errorHandler:e=>st.fail(st.phase==='load'?err('cdn', MSG.cdn()):new Error(String(e&&e.message||e)))})]));
      if(job.cancelled){ close(); throw err('cancel', MSG.cancel()); }
      await job.race(Promise.race([failed, worker.setParameters({user_defined_dpi:'200'})]));
    }catch(e){ close(); if(e&&e.code) throw e; throw err('cdn', MSG.cdn()); }
    st.phase='ready'; st.last=Date.now();
    return { langs,
      async read(canvas, page, of){
        const modes=[].concat(R.PSM); let best=null, bn=-1;
        for(let i=0;i<modes.length;i++){
          W.page=page; W.of=of; W.base=i/modes.length; W.span=1/modes.length; st.phase='read'; st.last=Date.now(); prog({stage:'read', pct:W.base, page, of});
          await job.race(Promise.race([failed, worker.setParameters({tessedit_pageseg_mode:modes[i]})]));
          const r=await job.race(Promise.race([failed, worker.recognize(canvas, {}, {text:true, blocks:true, hocr:false, tsv:false})]));
          const d=r&&r.data||{}; let ws=d.words;
          if(!ws){ ws=[]; (d.blocks||[]).forEach(b=>(b.paragraphs||[]).forEach(p=>(p.lines||[]).forEach(l=>(l.words||[]).forEach(w=>ws.push(w))))); }
          ws=ws.filter(w=>w&&w.bbox).map(w=>({text:w.text, conf:w.confidence, x0:w.bbox.x0, y0:w.bbox.y0, x1:w.bbox.x1, y1:w.bbox.y1}));
          const n=numbered(ws); if(n>bn){ bn=n; best=ws; this.mode=modes[i]; }
          if(bn>=10) break;                              // a team list was found; no second pass needed
        }
        st.phase='ready';
        return best||[];
      }, close };
  }

  // ── PDF (pdf.js) ──────────────────────────────────────────────
  // text runs of a page → positioned words, in the page's own units (y downward)
  function itemsToWords(items, vp, lib){
    const out=[];
    (items||[]).forEach(it=>{
      const s=it&&it.str; if(!s||!s.trim()) return;
      const m=lib.Util.transform(vp.transform, it.transform), fh=Math.hypot(m[2],m[3]);
      if(Math.abs(m[1])>0.3*Math.abs(m[0])||!fh) return;                          // text on its side is not a team list
      const x=m[4], yb=m[5], w=(it.width||0)*vp.scale, h=fh*0.72;
      if(!(w>0)) return;
      let pos=0;
      s.split(/(\t+|\s{2,})/).forEach((part,i)=>{                                   // a run holding two table cells is cut at the wide gap
        if(i%2===0&&part.trim()){ const lead=part.length-part.replace(/^\s+/,'').length, txt=part.trim();
          out.push({text:txt, x0:x+w*(pos+lead)/s.length, x1:x+w*(pos+lead+txt.length)/s.length, y0:yb-h, y1:yb, conf:null}); }
        pos+=part.length;
      });
    });
    return out;
  }
  R._itemsToWords=itemsToWords;
  async function pdfOpen(file, job, prog){
    if(file.size>LIMIT.pdfMB*1048576) throw err('big', MSG.bigpdf());
    prog({stage:'load', pct:0, engine:'pdf'});
    await job.race(loadScript(LIB.pdf.js, LIB.pdf.sri));
    const lib=root.pdfjsLib; if(!lib||!lib.getDocument) throw err('cdn', MSG.cdn());
    lib.GlobalWorkerOptions.workerSrc=LIB.pdf.worker;
    const data=new Uint8Array(await job.race(file.arrayBuffer()));
    // isEvalSupported:false — this pdf.js version must not be allowed to build code from a PDF's fonts
    const task=lib.getDocument({data, isEvalSupported:false, cMapUrl:LIB.pdf.cmaps, cMapPacked:true, standardFontDataUrl:LIB.pdf.fonts, enableXfa:false, stopAtErrors:false});
    job.stop.push(()=>{ try{ task.destroy(); }catch(_){} });
    let doc;
    try{ doc=await job.race(task.promise); }
    catch(e){ if(e&&e.code) throw e; const n=String(e&&e.name||'');
      if(n==='PasswordException') throw err('password', MSG.password());
      if(/worker|fetch|network|import/i.test(String(e&&e.message||''))&&n!=='InvalidPDFException') throw err('cdn', MSG.cdn());
      throw err('pdf', MSG.pdf()); }
    return {lib, doc};
  }
  async function renderPage(page, long){
    const v1=page.getViewport({scale:1}), s=long/Math.max(v1.width, v1.height), vp=page.getViewport({scale:s});
    const c=canvasOf(vp.width, vp.height); await page.render({canvasContext:c.getContext('2d'), viewport:vp}).promise;
    return {canvas:c, scale:s};
  }

  // ── the hook: file → both teams' text ─────────────────────────
  // read(file, {
  //   side:'both'|'home'|'away', homeTeam, awayTeam, known:{home:[],away:[]},
  //   pages:[n…]                       PDF pages to read (else choosePages, else the pages that look like a team list)
  //   choosePages(info)→Promise<[n…]>  ask the user; info={count, shown, suggested:[n], pages:[{n, hasText, list, thumb(width)→Promise<canvas>}]}
  //   onProgress({stage:'load'|'pages'|'read'|'layout', pct, engine, page, of}), signal: AbortSignal
  // }) → Promise<{
  //   home:{text, lines:[{text, confidence, low}], confidence, dropped, adopted, box, page}|null, away:…|null,
  //   pages:[{n, method:'text'|'ocr', image:canvas, scale}], lists:n, assign:{first, why},
  //   source:{name, kind:'pdf'|'image', method:'text'|'ocr'|'mixed', engine, langs}, redeal(first)→{home, away, assign} }>
  // Rejects with an Error whose .code is cdn | type | heic | image | password | pdf | big | empty | cancel.
  R.read=async function(file, o){
    o=o||{};
    const prog=p=>{ try{ if(o.onProgress) o.onProgress(p); }catch(_){} };
    const job=newJob(o.signal);
    let ocr=null;
    const getOcr=async()=>ocr||(ocr=await ocrOpen(job, prog));
    try{
      if(!file||typeof file.slice!=='function') throw err('type', MSG.type('That'));
      const kind=await sniff(file);
      if(!kind) throw err('type', MSG.type(file.name||'That file'));
      const pages=[], engines=[];
      if(kind==='pdf'){
        const {lib, doc}=await pdfOpen(file, job, prog);
        const N=Math.min(doc.numPages, LIMIT.pages), info=[];
        for(let n=1;n<=N;n++){
          prog({stage:'pages', pct:(n-1)/N, page:n, of:N});
          const page=await job.race(doc.getPage(n)), vp=page.getViewport({scale:1});
          let words=[]; try{ words=itemsToWords((await job.race(page.getTextContent())).items, vp, lib); }catch(e){ if(e&&e.code==='cancel') throw e; }
          const chars=words.reduce((t,w)=>t+w.text.replace(/\s/g,'').length,0), lay=R.layout(words, {glue:true, skew:false});
          info.push({n, page, words, layout:lay, hasText:chars>=30, list:R.looksLikeList(lay)});
          if(n%4===0) await tick();
        }
        let suggested=info.filter(p=>p.list).map(p=>p.n); if(!suggested.length) suggested=[1];
        suggested=suggested.slice(0, LIMIT.pick);
        let pick=o.pages;
        if(!pick&&N>1&&typeof o.choosePages==='function'){
          pick=await job.race(Promise.resolve(o.choosePages({count:doc.numPages, shown:N, suggested, max:LIMIT.pick,
            pages:info.map(p=>({n:p.n, hasText:p.hasText, list:p.list, thumb:w=>renderPage(p.page, w||120).then(r=>r.canvas)}))})));
          if(!pick||!pick.length) throw err('cancel', MSG.cancel());
        }
        pick=(pick&&pick.length?pick:suggested).map(Number).filter(n=>n>=1&&n<=N).sort((a,b)=>a-b).slice(0, LIMIT.pick);
        let k=0;
        for(const n of pick){
          const p=info[n-1]; k++;
          if(p.hasText){
            prog({stage:'layout', pct:k/pick.length, page:n});
            const r=await job.race(renderPage(p.page, LIMIT.viewLong));
            pages.push({n, method:'text', words:p.words, layout:p.layout, image:r.canvas, scale:r.scale});
            if(engines.indexOf('pdf')<0) engines.push('pdf');
          } else {
            const r=await job.race(renderPage(p.page, LIMIT.long)), eng=await getOcr();
            const words=await eng.read(greyStretch(r.canvas), k, pick.length);
            pages.push({n, method:'ocr', words, image:r.canvas, scale:1});
            if(engines.indexOf('ocr')<0) engines.push('ocr');
          }
        }
      } else {
        if(file.size>LIMIT.imageMB*1048576) throw err('big', MSG.bigimage());
        prog({stage:'load', pct:0, engine:'ocr'});
        const src=await job.race(decode(file, kind)), sw=src.width||src.naturalWidth, sh=src.height||src.naturalHeight;
        if(!sw||!sh) throw err('image', MSG.image());
        const pr=prepare(src, sw, sh); if(src.close) src.close();
        await tick();
        const eng=await getOcr(), words=await eng.read(pr.work, 1, 1);
        pages.push({n:1, method:'ocr', words, image:pr.view, scale:1}); engines.push('ocr');
      }
      prog({stage:'layout', pct:1});
      R._last=pages;                                 // for the tests: the positioned words of the last read
      const ctx={homeTeam:o.homeTeam, awayTeam:o.awayTeam, known:o.known||{}};
      const comp=R.compose(pages, ctx), side=o.side==='home'||o.side==='away'?o.side:'both';
      const res=R.deal(comp, side, ctx);
      if(!comp.lists.length||!['home','away'].some(s=>res[s]&&res[s].lines.length)) throw err('empty', MSG.empty());
      const methods=[...new Set(pages.map(p=>p.method))];
      res.pages=pages.map(p=>({n:p.n, method:p.method, image:p.image, scale:p.scale}));
      res.more=comp.more; res.extra=comp.extra.length;
      res.source={name:String(file.name||''), kind:kind==='pdf'?'pdf':'image', method:methods.length>1?'mixed':methods[0],
        engine:engines.map(e=>LIB[e].name+' '+LIB[e].ver).join(' + '), langs:ocr?ocr.langs:[]};
      res.redeal=first=>{ const r=R.deal(comp, side, Object.assign({first}, ctx)); res.home=r.home; res.away=r.away; res.assign=r.assign; return res; };
      return res;
    } finally { job.end(); }
  };
  // The public hook is cohTeamSheetFromFile in cohesion-teamsheet.js, which loads this file and calls read().
})(typeof window!=='undefined'?window:globalThis);

/* ══ UI: the editor's "Read from photo / PDF" flow ══════════════════
 * attach(ctx, file) — ctx = {card, side:'home'|'away'|'' (both teams), game,
 *   known(side)→[names], teamName(side), col(side)→the team's column element}
 * Progress, the page picker, the source picture and the notes are drawn into
 * the editor's .cohts-rd hosts. The text itself is put into the team's paste
 * box and an 'input' event is fired, so the editor's own parser and preview
 * run exactly as if the user had pasted it.
 */
(function(root){
  'use strict';
  if(typeof window==='undefined'||typeof document==='undefined') return;
  const R=root.cohTSReader, T=root.cohTS, esc=T._esc;
  const el=(html)=>{ const d=document.createElement('div'); d.innerHTML=html; return d.firstElementChild; };
  let cssDone=false;
  function css(){
    if(cssDone) return; cssDone=true;
    const st=document.createElement('style'); st.id='cohrd-css';
    st.textContent=`
.cohts-rd:empty{display:none;}
.cohts-rd{margin-top:8px;}
.cohts-rd[data-rd="both"]{margin:0 0 12px;}
.cohrd-box{border:1px solid var(--border,#333);border-radius:8px;padding:9px 10px;background:var(--card,#252530);font-size:12px;line-height:1.5;color:var(--t2,#999);}
.cohrd-box b{color:var(--t1,#eee);}
.cohrd-msg{color:var(--t1,#eee);font-weight:600;}
.cohrd-bar{height:6px;border-radius:3px;background:var(--border,#333);overflow:hidden;margin:7px 0;}
.cohrd-bar i{display:block;height:100%;width:0;background:var(--accent,#4fc3f7);transition:width .2s;}
.cohrd-bar.busy i{width:35% !important;animation:cohrd-run 1.1s linear infinite;}
@keyframes cohrd-run{0%{margin-left:-35%}100%{margin-left:100%}}
.cohrd-err{color:var(--orange,#f59e0b);font-weight:600;}
.cohrd-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:7px;}
.cohrd-top{display:flex;gap:8px;align-items:flex-start;}
.cohrd-top div{flex:1;min-width:0;}
.cohrd-flag{margin-top:6px;color:var(--orange,#f59e0b);}
.cohrd-flag span{color:var(--t1,#eee);}
.cohrd-note{margin-top:5px;}
.cohrd-note summary{cursor:pointer;}
.cohrd-pages{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;margin-top:8px;max-height:330px;overflow-y:auto;padding:2px;}
.cohrd-pgb{border:2px solid var(--border,#333);border-radius:8px;background:var(--panel,#1e1e28);color:var(--t2,#999);padding:4px;cursor:pointer;font:700 11px 'Barlow Condensed',sans-serif;letter-spacing:.4px;text-align:center;min-width:0;}
.cohrd-pgb .th{display:flex;align-items:center;justify-content:center;height:104px;background:#fff;border-radius:4px;overflow:hidden;margin-bottom:3px;}
.cohrd-pgb canvas{max-width:100%;max-height:104px;display:block;}
.cohrd-pgb em{display:block;font-style:normal;font-size:9.5px;color:var(--accent,#4fc3f7);min-height:12px;}
.cohrd-pgb.on{border-color:var(--accent,#4fc3f7);color:var(--t1,#eee);box-shadow:0 0 0 1px var(--accent,#4fc3f7);}
.cohrd-tools{display:flex;gap:5px;align-items:center;margin-top:8px;}
.cohrd-tools span{flex:1;min-width:0;font:700 10px 'Barlow Condensed',sans-serif;letter-spacing:.6px;text-transform:uppercase;color:var(--t3,#777);}
.cohrd-tools .cohts-btn{padding:3px 9px;}
.cohrd-view{margin-top:5px;height:300px;overflow:auto;border:1px solid var(--border,#333);border-radius:8px;background:#fff;-webkit-overflow-scrolling:touch;}
.cohrd-pg{position:relative;}
.cohrd-pg canvas{display:block;width:100%;height:auto;}
.cohrd-mark{position:absolute;background:rgba(245,158,11,.28);outline:1px solid rgba(245,158,11,.9);pointer-events:none;}
.cohts-prow.cohrd-low{background:rgba(245,158,11,.13);}
.cohts-prow.cohrd-low b::before{content:'⚠ ';color:var(--orange,#f59e0b);}
.cohrd-full{position:fixed;inset:0;z-index:10040;background:rgba(0,0,0,.85);overflow:auto;padding:44px 8px 8px;box-sizing:border-box;-webkit-overflow-scrolling:touch;}
.cohrd-full canvas{display:block;margin:0 auto;background:#fff;}
.cohrd-full .cohts-btn{position:fixed;top:8px;right:8px;z-index:1;}
`;
    document.head.appendChild(st);
  }

  const topHost=card=>card.querySelector('.cohts-rd[data-rd="both"]');
  const colHost=(ctx,side)=>{ const c=ctx.col(side); return c?c.querySelector('.cohts-rd'):null; };
  function wipe(host){ if(!host) return; if(host._cohrd&&host._cohrd.stop) host._cohrd.stop(); host._cohrd=null; host.innerHTML=''; }

  // ── progress ──
  function progress(host, p, cancel){
    let b=host.querySelector('.cohrd-prog');
    if(!b){ host.innerHTML=''; b=el('<div class="cohrd-box cohrd-prog"><div class="cohrd-msg"></div><div class="cohrd-bar"><i></i></div><div class="cohrd-sub"></div><div class="cohrd-row"><button class="cohts-btn" type="button">Cancel</button></div></div>');
      b.querySelector('button').onclick=cancel; host.appendChild(b); }
    const L=R.LIB, pct=Math.round(100*(p.pct||0)); let msg='', sub='', busy=false;
    if(p.stage==='load'&&p.engine==='pdf'){ msg='Getting the PDF reader…'; sub='About '+L.pdf.mb+' MB, downloaded from '+L.host+' the first time only.'; busy=true; }
    else if(p.stage==='load'){ msg='Getting the text reader ready… '+(pct?pct+'%':''); sub='About '+L.ocr.mb+' MB is downloaded from '+L.host+' the first time; after that the browser keeps it.'; busy=!pct; }
    else if(p.stage==='pages'){ msg='Looking through the pages… '+(p.page||'')+(p.of?' of '+p.of:''); }
    else if(p.stage==='read'){ msg='Reading the '+(p.of>1?'pages ('+p.page+' of '+p.of+')':'picture')+'… '+pct+'%'; sub='This is done on this device and can take up to a minute on a phone or tablet.'; }
    else { msg='Sorting the lines into teams…'; busy=true; }
    b.querySelector('.cohrd-msg').textContent=msg; b.querySelector('.cohrd-sub').textContent=sub;
    const bar=b.querySelector('.cohrd-bar'); bar.classList.toggle('busy', busy); bar.firstChild.style.width=(busy?35:pct)+'%';
  }
  function failure(host, message){
    host.innerHTML=''; const b=el('<div class="cohrd-box"><div class="cohrd-err"></div><div class="cohrd-row"><button class="cohts-btn" type="button">OK</button></div></div>');
    b.querySelector('.cohrd-err').textContent='⚠ '+message; b.querySelector('button').onclick=()=>{ host.innerHTML=''; }; host.appendChild(b);
  }

  // ── page picker (a PDF with more than one page) → Promise<[n…]> ([] = cancelled) ──
  function pagePicker(host, info, name){
    return new Promise(resolve=>{
      host.innerHTML='';
      const sel=new Set(info.suggested), anyList=info.pages.some(p=>p.list);
      const b=el(`<div class="cohrd-box"><div class="cohrd-msg">${esc(name||'This PDF')} has ${info.count} pages — tick the page${info.max>1?'(s)':''} with the team list${info.max>1?'s':''}.</div>
        <div>${anyList?'The ticked pages look like team lists (many lines starting with a number).':'No page obviously holds a team list, so page 1 is ticked.'}${info.shown<info.count?' Only the first '+info.shown+' pages are shown.':''} Up to ${info.max} pages can be read at once.</div>
        <div class="cohrd-pages">${info.pages.map(p=>`<button type="button" class="cohrd-pgb${sel.has(p.n)?' on':''}" data-n="${p.n}" aria-pressed="${sel.has(p.n)}"><div class="th"></div>Page ${p.n}<em>${p.list?'team list?':(p.hasText?'':'picture')}</em></button>`).join('')}</div>
        <div class="cohrd-row"><button class="cohts-btn pri" type="button" data-a="go"></button><button class="cohts-btn" type="button" data-a="x">Cancel</button><span class="cohrd-err"></span></div></div>`);
      host.appendChild(b);
      const go=b.querySelector('[data-a="go"]'), warn=b.querySelector('.cohrd-row .cohrd-err');
      const paint=()=>{ go.textContent=sel.size?'Read '+(sel.size===1?'page '+[...sel][0]:sel.size+' pages'):'Read'; go.disabled=!sel.size;
        b.querySelectorAll('.cohrd-pgb').forEach(x=>{ const on=sel.has(+x.dataset.n); x.classList.toggle('on',on); x.setAttribute('aria-pressed', on); }); };
      b.querySelector('.cohrd-pages').onclick=ev=>{ const x=ev.target.closest('.cohrd-pgb'); if(!x) return; const n=+x.dataset.n; warn.textContent='';
        if(sel.has(n)) sel.delete(n); else if(sel.size>=info.max) warn.textContent='Up to '+info.max+' pages at once.'; else sel.add(n); paint(); };
      let live=true;
      go.onclick=()=>{ live=false; resolve([...sel].sort((x,y)=>x-y)); };
      b.querySelector('[data-a="x"]').onclick=()=>{ live=false; resolve([]); };
      paint();
      // small pictures of the pages, one at a time so the page never stalls
      (async()=>{ for(const p of info.pages){ if(!live||!b.isConnected) return;
        try{ const c=await p.thumb(150); const slot=b.querySelector('.cohrd-pgb[data-n="'+p.n+'"] .th'); if(slot) slot.appendChild(c); }catch(_){}
        await new Promise(r=>setTimeout(r,0)); } })();
    });
  }
  R._pagePicker=pagePicker;

  // ── the picture a list was read from ──
  function copyOf(canvas){ const c=document.createElement('canvas'); c.width=canvas.width; c.height=canvas.height; c.getContext('2d').drawImage(canvas,0,0); return c; }
  function viewer(res, r){
    const nums=[...new Set((r.lines||[]).map(l=>l.page).filter(n=>n!=null))];
    const pages=(res.pages||[]).filter(p=>p.image&&(nums.indexOf(p.n)>=0||(!nums.length&&p.n===r.page)));
    if(!pages.length) return null;
    const box=el(`<div><div class="cohrd-tools"><span>The page it was read from${pages.length>1?' — '+pages.map(p=>`<a href="#" data-p="${p.n}">page ${p.n}</a>`).join(' · '):''}</span>
      <button class="cohts-btn" type="button" data-z="-1" title="Smaller" aria-label="Zoom out">−</button><button class="cohts-btn" type="button" data-z="1" title="Larger" aria-label="Zoom in">+</button><button class="cohts-btn" type="button" data-z="full">Full page</button></div>
      <div class="cohrd-view"><div class="cohrd-pg"></div></div></div>`);
    const view=box.querySelector('.cohrd-view'), pg=box.querySelector('.cohrd-pg'); let cur=null, z=1;
    const size=()=>{ pg.style.width=Math.round(100*z)+'%'; };
    const show=n=>{
      cur=pages.find(p=>p.n===n)||pages[0]; pg.innerHTML=''; pg.appendChild(copyOf(cur.image));
      const W=cur.image.width, H=cur.image.height, s=cur.scale||1, L=(r.lines||[]).filter(l=>l.box&&l.page===cur.n);
      L.filter(l=>l.low).forEach(l=>{ const m=document.createElement('i'); m.className='cohrd-mark';
        m.style.cssText='left:'+(100*l.box.x0*s/W)+'%;top:'+(100*l.box.y0*s/H)+'%;width:'+(100*(l.box.x1-l.box.x0)*s/W)+'%;height:'+(100*(l.box.y1-l.box.y0)*s/H)+'%'; pg.appendChild(m); });
      // start with this team's list filling the width
      let bx=null; if(L.length) bx={x0:Math.min.apply(null,L.map(l=>l.box.x0))*s, y0:Math.min.apply(null,L.map(l=>l.box.y0))*s, x1:Math.max.apply(null,L.map(l=>l.box.x1))*s};
      z=bx?Math.max(1, Math.min(5, W/((bx.x1-bx.x0)+0.08*W))):1; size();
      const place=()=>{ if(!bx||!view.clientWidth) return; const k=pg.clientWidth/W; view.scrollLeft=Math.max(0,(bx.x0-0.03*W)*k); view.scrollTop=Math.max(0,(bx.y0-0.02*H)*k); };
      place(); requestAnimationFrame(place);
    };
    box.addEventListener('click',ev=>{
      const a=ev.target.closest('[data-p]'); if(a){ ev.preventDefault(); show(+a.dataset.p); return; }
      const b=ev.target.closest('[data-z]'); if(!b) return;
      if(b.dataset.z==='full'){ full(cur.image); return; }
      const cx=(view.scrollLeft+view.clientWidth/2)/pg.clientWidth, cy=(view.scrollTop+view.clientHeight/2)/pg.clientHeight;
      z=Math.max(1, Math.min(8, z*(b.dataset.z==='1'?1.35:1/1.35))); size();
      view.scrollLeft=cx*pg.clientWidth-view.clientWidth/2; view.scrollTop=cy*pg.clientHeight-view.clientHeight/2;
    });
    box._show=()=>show(pages[0].n);
    return box;
  }
  function full(canvas){
    const ov=el('<div class="cohrd-full"><button class="cohts-btn" type="button">✕ Close</button></div>'); ov.appendChild(copyOf(canvas));
    const close=()=>{ ov.remove(); document.removeEventListener('keydown', key, true); };
    const key=ev=>{ if(ev.key==='Escape'){ ev.stopPropagation(); close(); } };
    ov.querySelector('button').onclick=close; ov.addEventListener('click',ev=>{ if(ev.target===ov) close(); });
    document.addEventListener('keydown', key, true); document.body.appendChild(ov);
  }

  R.attach=function(ctx, file){
    css();
    const card=ctx.card, both=!ctx.side, sides=both?['home','away']:[ctx.side];
    const host=both?topHost(card):colHost(ctx, ctx.side);
    if(!host) return;
    // one read at a time; a new one replaces what the same control showed before
    wipe(topHost(card)); sides.forEach(s=>wipe(colHost(ctx,s)));
    const ac=new AbortController(); let done=false;
    host._cohrd={stop(){ if(!done) ac.abort(); }};
    const cancel=()=>{ ac.abort(); };
    const team=s=>String(ctx.teamName(s)||s).toUpperCase();
    progress(host, {stage:'load', pct:0, engine:/pdf$/i.test(file.name||'')||file.type==='application/pdf'?'pdf':'ocr'}, cancel);
    const filled={};
    const setText=(side, text)=>{ const c=ctx.col(side), ta=c&&c.querySelector('textarea'); if(!ta) return; ta.value=text; ta.dispatchEvent(new Event('input',{bubbles:true})); filled[side]=!!text; };
    // the preview rows that came from a line the reader was unsure of
    const lowKeys={};
    const decorate=side=>{ const c=ctx.col(side), keys=lowKeys[side]; if(!c||!keys||!keys.size) return;
      c.querySelectorAll('.cohts-prev .cohts-prow').forEach(row=>{ const b=row.querySelector('b'), sp=row.querySelector('span'); if(!b||!sp) return;
        const nm=sp.firstChild?sp.firstChild.textContent:'', on=keys.has(b.textContent.trim()+'|'+T.nameKey(nm));
        row.classList.toggle('cohrd-low', on); if(on) row.title='The reader was less sure of this line — check it against the picture'; }); };
    const onInput=ev=>{ const c=ev.target.closest&&ev.target.closest('.cohts-col'); if(c&&ev.target.tagName==='TEXTAREA') setTimeout(()=>decorate(c.dataset.side),0); };
    card.addEventListener('input', onInput);

    const srcText=res=>{ const s=res.source||{}, pg=(res.pages||[]).map(p=>p.n);
      const how=s.method==='text'?'the exact text in the PDF':s.method==='mixed'?'PDF text and text recognition':'text recognition on this device'+((s.langs||[]).length?((s.langs.indexOf('gle')>=0)?' (English + Irish)':' (English only — the Irish data could not be loaded, so fadas may be missed)'):'');
      return '“'+(s.name||'the file')+'”'+(s.kind==='pdf'&&pg.length?', page'+(pg.length>1?'s ':' ')+pg.join(', '):'')+' — '+how; };
    function colPanel(side, r, res){
      const h=colHost(ctx, side); if(!h) return; h.innerHTML=''; lowKeys[side]=new Set();
      if(!r) return;
      const low=r.lines.filter(l=>l.low);
      low.forEach(l=>T.parsePaste(l.text,{known:ctx.known(side)}).rows.forEach(x=>lowKeys[side].add(x.no+'|'+T.nameKey(x.name))));
      const b=el(`<div class="cohrd-box"><div class="cohrd-top"><div><b>${r.lines.length} line${r.lines.length===1?'':'s'} read for ${esc(team(side))}</b>${both?'':' from '+esc(srcText(res))}${r.confidence!=null?' · average certainty '+r.confidence+'%':''}.
          Nothing is in the sheet yet — check the preview above against the picture, then press <b>Replace this sheet</b> or <b>Add to this sheet</b>.</div><button class="cohts-x" type="button" data-a="close" title="Close the picture">✕</button></div>
        ${!both&&res.lists>1?`<div class="cohrd-note">This file holds two team lists; the ${res.assign.first===side?'first':'second'} one is shown${res.assign.why==='headings'?' (matched by the team name on the sheet)':' — check it is the right team'}. <button class="cohts-btn" type="button" data-a="other">Use the other list</button></div>`:''}
        ${low.length?`<div class="cohrd-flag">⚠ Check ${low.length===1?'this line':'these '+low.length+' lines'} against the picture — the reader was less sure of ${low.length===1?'it':'them'}: <span>${low.map(l=>esc(l.text.replace(/\t/g,' '))+' ('+Math.round(l.confidence)+'%)').join(' · ')}</span></div>`:''}
        ${r.adopted&&r.adopted.length?`<div class="cohrd-note">Changed to this team's existing spelling: ${r.adopted.map(a=>'“'+esc(a.from)+'” → <b>'+esc(a.to)+'</b>').join(' · ')}</div>`:''}
        ${r.dropped&&r.dropped.length?`<details class="cohrd-note"><summary>Left out as not players (${r.dropped.length})</summary>${r.dropped.map(d=>esc(d.text.replace(/\t/g,' '))+' <i>— '+esc(d.why)+'</i>').join('<br>')}</details>`:''}
        </div>`);
      const v=viewer(res, r); if(v) b.appendChild(v);
      b.addEventListener('click',ev=>{ const a=ev.target.closest('[data-a]'); if(!a) return;
        if(a.dataset.a==='close'){ h.innerHTML=''; lowKeys[side]=new Set(); decorate(side); }
        else if(a.dataset.a==='other'){ swap(res); } });
      h.appendChild(b); if(v) v._show();
    }
    function topPanel(res){
      const h=topHost(card); if(!h||!both) return; h.innerHTML='';
      const a=res.assign||{first:'home', why:'default'}, other=a.first==='home'?'away':'home';
      const why={headings:'matched by the team names on the sheet', title:'going by the order of the names in the title — check', default:'the team names were not found on the sheet, so this is only a guess — check', chosen:'as you set it'}[a.why]||'';
      const two=res.lists>1;
      const b=el(`<div class="cohrd-box"><div class="cohrd-top"><div><b>Read ${esc(srcText(res))}.</b><br>
        ${two?`First (left / top) list → <b>${esc(team(a.first))}</b> · second list → <b>${esc(team(other))}</b> <span>(${why})</span>.`
             :`Only one team list was found; it is under <b>${esc(team(a.first))}</b>.`}
        ${res.more?'<br>The file holds more than two numbered lists — the two longest were used.':''}${res.extra?'<br>A column beside the names (clubs or positions) was left out.':''}
        <br>Nothing is in the sheets yet — check each preview against its picture, then press <b>Replace this sheet</b> or <b>Add to this sheet</b>.</div>
        <button class="cohts-x" type="button" data-a="close" title="Close">✕</button></div>
        <div class="cohrd-row"><button class="cohts-btn" type="button" data-a="swap">${two?'⇄ Swap — the first list is '+esc(team(other)):'Move it to '+esc(team(other))}</button></div></div>`);
      b.addEventListener('click',ev=>{ const x=ev.target.closest('[data-a]'); if(!x) return; if(x.dataset.a==='close') h.innerHTML=''; else swap(res); });
      h.appendChild(b);
    }
    function fill(res){
      sides.forEach(side=>{ const r=res[side]; if(r) setText(side, r.text||''); else if(filled[side]) setText(side, ''); colPanel(side, r, res); decorate(side); });
      topPanel(res);
    }
    function swap(res){
      const first=(res.assign&&res.assign.first)==='home'?'away':'home';
      if(typeof res.redeal==='function') res.redeal(first);
      else { const t=res.home; res.home=res.away; res.away=t; res.assign={first, why:'chosen'}; }   // a reader that only returns text
      fill(res);
    }
    const o={side:both?'both':ctx.side, homeTeam:ctx.teamName('home'), awayTeam:ctx.teamName('away'), known:{home:ctx.known('home'), away:ctx.known('away')},
      onProgress:p=>{ if(!done&&!ac.signal.aborted) progress(host, p, cancel); }, choosePages:info=>pagePicker(host, info, file.name), signal:ac.signal};
    return Promise.resolve().then(()=>root.cohTeamSheetFromFile(file, o)).then(res=>{
      done=true; host.innerHTML=''; fill(res||{}); return res;
    }).catch(e=>{
      done=true; card.removeEventListener('input', onInput);
      if(e&&e.code==='cancel'){ host.innerHTML=''; return null; }
      failure(host, (e&&e.code&&e.message)||('The file could not be read ('+String(e&&e.message||e)+'). Pasting or typing the list still works.'));
      return null;
    });
  };
})(typeof window!=='undefined'?window:globalThis);
