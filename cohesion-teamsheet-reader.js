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
    let m=/^[#(\[]?\s*(\d{1,2})(?:\s*[.\-–—:)\]]+\s*|\s+)(?=\S)/.exec(s);
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
      .map(w=>({text:String(w.text).trim(), x0:w.x0, y0:w.y0, x1:w.x1, y1:w.y1, conf:w.conf==null?null:+w.conf, sw:w.sw==null?null:+w.sw, ln:w.ln,
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
  // the segments of one row → a line (cells far apart are joined with a TAB unless `plain`)
  function rowLine(segs, hh, yc, h, plain){
    segs.sort((a,b)=>a.x0-b.x0);
    let text=''; segs.forEach((s,i)=>{ if(i) text+=(!plain&&s.x0-segs[i-1].x1>=2*hh)?'\t':' '; text+=s.text; });
    const wds=[].concat.apply([], segs.map(s=>s.words)), cf=segs.map(s=>s.conf).filter(c=>c!=null);
    // recognised text: a scrap of one or two characters in front of "18 Seán MacMahon" is a mark, not part of the line
    if(cf.length) text=text.replace(/^[A-Za-z|!\[\].,:;'"“”‘’~_-]{1,2}\s+(?=#?\d{1,2}[.)\]:]?\s+[A-ZÀ-Þ])/,'');
    return {text, no:lineNo(text), conf:cf.length?Math.min.apply(null,cf):null, yc:yc==null?segs.reduce((t,x)=>t+x.yc,0)/segs.length:yc, h:h==null?Math.max.apply(null,segs.map(x=>x.h)):h, words:wds,
      box:{x0:Math.min.apply(null,wds.map(w=>w.x0)), y0:Math.min.apply(null,wds.map(w=>w.y0)), x1:Math.max.apply(null,wds.map(w=>w.x1)), y1:Math.max.apply(null,wds.map(w=>w.y1))}};
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
      // two strips can ask for the same cut (or cuts out of order): each cut is used once, in order, and never leaves an empty piece
      let parts=[]; if(ok){ let from=0; [...new Set(cuts)].sort((x,y)=>x-y).concat([s.words.length]).forEach(k=>{ if(k>from){ parts.push(segOf(s.words.slice(from,k), o.glue)); from=k; } }); if(parts.length<2) ok=false; }
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
      return rows.map(r=>rowLine(r.segs, hh, r.yc, r.h));
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

  // ── 1b. several readings of one picture → one set of words ────
  // The same picture read more than once (as it is; with dark banners turned light). Words lying on the same spot
  // are one word read twice: the reading the engine was surer of is kept, the other dropped.
  function mergeWords(passes){
    const all=[]; (passes||[]).forEach((ws,pi)=>prep(ws).forEach(w=>{ w.pass=pi; all.push(w); }));
    // a whole word beats a sure fragment of it ("Eoin" 94% over "in" 97%)
    const cv=w=>(w.conf==null?100:w.conf)*(0.7+0.05*Math.min(6, w.text.replace(/[^A-Za-zÀ-ɏ0-9]/g,'').length));
    // the engine now and then gives a word the box of its whole line: the same word read tighter in another reading
    // wins, and a box far too wide for its letters does not push its neighbours out
    const wide=w=>(w.x1-w.x0)>2.2*0.62*w.h*Math.max(1,w.text.length);
    all.forEach(w=>{ w.loose=wide(w)||all.some(v=>v.pass!==w.pass&&v.text===w.text&&(v.x1-v.x0)<0.75*(w.x1-w.x0)&&v.x0<w.x1&&v.x1>w.x0&&v.y0<w.y1&&v.y1>w.y0); });
    all.sort((a,b)=>(a.loose?1:0)-(b.loose?1:0)||cv(b)-cv(a)||a.pass-b.pass||a.x0-b.x0);
    const kept=[];
    all.forEach(w=>{ const aw=(w.x1-w.x0)*(w.y1-w.y0);
      for(let i=0;i<kept.length;i++){ const k=kept[i], ix=Math.min(w.x1,k.x1)-Math.max(w.x0,k.x0); if(ix<=0) continue; const iy=Math.min(w.y1,k.y1)-Math.max(w.y0,k.y0);
        if(iy>0&&ix*iy>0.25*Math.min(aw,(k.x1-k.x0)*(k.y1-k.y0))) return; }
      kept.push(w); });
    return kept.map(w=>({text:w.text, x0:w.x0, y0:w.y0, x1:w.x1, y1:w.y1, conf:w.conf, pass:w.pass, sw:w.sw}));
  }
  R.mergeWords=mergeWords;

  // ── 1c. a formation page: number + name pairs wherever they are ──
  // No columns are looked for. Every run of words is a line; a jersey number standing by itself just left of a name
  // on the same baseline (the number in its own box beside the name banner) is joined to it. The lines come out in
  // reading order (row by row). Two teams side by side or one above the other (the numbers occur twice, apart) are
  // cut into two columns. → the same shape as layout(), with free:true
  function freeLayout(words, o){
    o=o||{};
    const ws=prep(words); if(!ws.length) return {columns:[], spanning:[], extra:[], skew:0, H:0, free:true};
    const skew=o.skew===false?0:estimateSkew(ws), cs=Math.cos(skew), sn=Math.sin(skew);
    ws.forEach(w=>{ const rx=w.xc*cs+w.yc*sn, ry=-w.xc*sn+w.yc*cs, hw=(w.x1-w.x0)/2; w.rx0=rx-hw; w.rx1=rx+hw; w.ry=ry; });
    const lv=ws.map(w=>({text:w.text, x0:w.rx0, x1:w.rx1, y0:w.ry-w.h/2, y1:w.ry+w.h/2, h:w.h, xc:(w.rx0+w.rx1)/2, yc:w.ry, _w:w}));
    const H=med(ws.map(w=>w.h))||1;
    let segs=[];
    chain(lv).forEach(c=>{ const wsC=c.map(x=>x._w).sort((a,b)=>a.rx0-b.rx0);
      // a run is cut where a new jersey number starts after a clear gap ("… Name   21 Name …")
      let from=0; for(let i=1;i<wsC.length;i++){ const a=wsC[i-1], b=wsC[i];
        if(isNumTok(b.text)&&i+1<wsC.length&&hasLetter(wsC[i+1].text)&&!isNumTok(a.text)&&b.rx0-a.rx1>0.6*Math.max(a.h,b.h)){ segs.push(segOf(wsC.slice(from,i), o.glue)); from=i; } }
      segs.push(segOf(wsC.slice(from), o.glue)); });
    // a number by itself + the name to its right
    const used=new Set(), lines=[];
    const bare=segs.filter(s=>isNumTok(s.text)).sort((a,b)=>a.x0-b.x0);
    bare.forEach(n=>{ let best=null, bg=Infinity;
      segs.forEach(t=>{ if(t===n||used.has(t)||isNumTok(t.text)||lineNo(t.text)!=null||!hasLetter(t.text)) return; const Hm=Math.max(n.h,t.h), gap=t.x0-n.x1;
        if(gap<-0.3*Hm||gap>3.5*Hm||Math.abs(t.yc-n.yc)>0.55*Hm||Math.min(n.h,t.h)<0.45*Hm) return; if(gap<bg){ bg=gap; best=t; } });
      if(best){ used.add(n); used.add(best); lines.push(rowLine([n,best], H, null, null, true)); } });
    // a number whose name starts further off (part of the line could not be read — glare): the next words on that
    // baseline, if nothing else lies between; the line is marked unsure
    bare.forEach(n=>{ if(used.has(n)) return; let best=null, bg=Infinity;
      segs.forEach(t=>{ if(t===n||used.has(t)||isNumTok(t.text)||lineNo(t.text)!=null||!hasLetter(t.text)) return; const Hm=Math.max(n.h,t.h), gap=t.x0-n.x1;
        if(gap<0||gap>7*Hm||Math.abs(t.yc-n.yc)>0.5*Hm||Math.min(n.h,t.h)<0.6*Hm) return; if(gap<bg){ bg=gap; best=t; } });
      if(best){ used.add(n); used.add(best); const l=rowLine([n,best], H, null, null, true); l.conf=Math.min(l.conf==null?100:l.conf, 50); l.gap=true; lines.push(l); } });
    segs.forEach(s=>{ if(!used.has(s)) lines.push(rowLine([s], H, null, null, true)); });
    // a numbered name of one word takes the single word just to its right ("20 Paul" + "Conroy", a smear between them)
    for(let i=0;i<lines.length;i++){ const a=lines[i]; if(a.no==null||a.text.trim().split(/\s+/).length!==2) continue;
      let k=-1, bg=Infinity; lines.forEach((b,j)=>{ if(j===i||b.no!=null||isNumTok(b.text)||!/^[A-ZÀ-Þ][A-Za-zÀ-ɏ'’-]{2,}$/.test(b.text.trim())) return; const Hm=Math.max(a.h,b.h), gap=b.box.x0-a.box.x1;
        if(gap<0||gap>2.6*Hm||Math.abs(b.yc-a.yc)>0.5*Hm||Math.min(a.h,b.h)<0.6*Hm) return; if(gap<bg){ bg=gap; k=j; } });
      if(k>=0){ const b=lines[k], cf=[a.conf,b.conf].filter(c=>c!=null); a.text+=' '+b.text.trim(); a.words=(a.words||[]).concat(b.words||[]); a.conf=cf.length?Math.min(Math.min.apply(null,cf), 60):null;
        a.box={x0:Math.min(a.box.x0,b.box.x0), y0:Math.min(a.box.y0,b.box.y0), x1:Math.max(a.box.x1,b.box.x1), y1:Math.max(a.box.y1,b.box.y1)}; lines.splice(k,1); if(k<i) i--; } }
    // reading order: rows top to bottom (a row = lines whose middles are within half a line), left to right inside a row
    const order=L=>{ const rows=[]; L.slice().sort((a,b)=>a.yc-b.yc).forEach(l=>{ const r=rows[rows.length-1]; if(r&&Math.abs(l.yc-r.yc)<0.6*Math.max(l.h,r.h)){ r.L.push(l); } else rows.push({yc:l.yc, h:l.h, L:[l]}); });
      return [].concat.apply([], rows.map(r=>r.L.sort((a,b)=>a.box.x0-b.box.x0))); };
    // two teams in the picture: most numbers occur twice, on either side of one dividing line
    const byNo=new Map(); lines.forEach(l=>{ if(l.no!=null&&l.no>=1&&l.no<=40){ if(!byNo.has(l.no)) byNo.set(l.no,[]); byNo.get(l.no).push(l); } });
    const pairs=[...byNo.values()].filter(v=>v.length===2);
    let cols=[lines];
    if(pairs.length>=5){
      for(const ax of ['x','y']){
        const c=l=>ax==='x'?(l.box.x0+l.box.x1)/2:(l.box.y0+l.box.y1)/2;
        const cut=med(pairs.map(p=>(c(p[0])+c(p[1]))/2)), good=pairs.filter(p=>(c(p[0])<cut)!==(c(p[1])<cut)).length;
        if(good>=0.8*pairs.length){ const c0=l=>ax==='x'?l.box.x0:(l.box.y0+l.box.y1)/2; cols=[lines.filter(l=>c0(l)<cut), lines.filter(l=>c0(l)>=cut)].filter(x=>x.length); break; }
      }
    }
    lines.forEach(l=>{ l.free=true; });
    return {columns:cols.map(L=>({x0:Math.min.apply(null,L.map(l=>l.box.x0)), x1:Math.max.apply(null,L.map(l=>l.box.x1)), lines:order(L)})), spanning:[], extra:[], skew, H, free:true};
  }
  R.freeLayout=freeLayout;

  // ── 1d. name blocks: the lines under a numbered player ────────
  // A programme often prints, under each "7 Seán Kelly", one or two more lines that are not players: the Irish form
  // of the name, the club. Where most numbered players of a list have such lines under them, those lines are marked
  // (line.under = true) and later left out. A line is "under" a numbered player when it starts below it, not left of
  // it, nearer to it than to any other numbered line, and well before the place the next numbered line of that
  // column is expected — so a player whose number was simply not read stays visible.
  function nameBlocks(lines){
    const L=(lines||[]).filter(l=>l&&l.box), num=L.filter(l=>l.no!=null&&l.no<=40);
    L.forEach(l=>{ if(l.under) delete l.under; });
    if(num.length<8) return {on:false, under:0};
    const yc=l=>(l.box.y0+l.box.y1)/2, hh=l=>Math.max(1,l.box.y1-l.box.y0);
    // each numbered line's distance to the next numbered line below it in its column
    const pitch=new Map(), above=new Map();
    num.forEach(n=>{ let d=Infinity, nx=null; num.forEach(m=>{ if(m===n||m.page!==n.page) return; const dy=yc(m)-yc(n); if(dy<0.6*hh(n)) return;
        if(m.box.x0<n.box.x1+hh(n)&&m.box.x1>n.box.x0-hh(n)&&dy<d){ d=dy; nx=m; } }); if(nx){ pitch.set(n,d); if(!above.has(nx)||d<pitch.get(above.get(nx))) above.set(nx,n); } });
    const P=med([...pitch.values()]);
    const own=new Map();
    L.forEach(u=>{ if(u.no!=null||isNumTok(u.text)||!hasLetter(u.text)||RE_KEEP.test(fold(u.text).trim())) return;
      let best=null, bd=Infinity;
      num.forEach(n=>{ if(n.page!==u.page) return; const Hn=hh(n), dy=yc(u)-yc(n); if(dy<0.45*Hn||dy>5*Hn) return; if(n.box.x0>u.box.x0+1.5*Hn) return;
        const d=dy+0.5*Math.max(0,u.box.x0-n.box.x1); if(d<bd){ bd=d; best=n; } });
      if(!best) return;
      // the next player is expected one row on: the spacing to the numbered line below, or that of the row above if
      // it is tighter (the line below may be the one after next, when a number in between was not read)
      let p=pitch.has(best)?pitch.get(best):P; const up=above.get(best); if(up&&pitch.get(up)<p) p=pitch.get(up);
      if(p&&(yc(u)-yc(best))>0.85*p) return;
      own.set(u,best); });
    const owners=new Set(own.values());
    if(owners.size<0.5*num.length) return {on:false, under:0};
    own.forEach((n,u)=>{ u.under=true; });
    return {on:true, under:own.size};
  }
  R.nameBlocks=nameBlocks;

  // ── 1e. a formation read row by row: numbers that could not be read ──
  // The starters of a formation page come in reading order 1, 2 3 4, 5 6 7, 8 9, … . Where most of the first fifteen
  // player lines carry exactly the number of their place, a line between two such lines whose own number is missing,
  // repeated or out of order is given the number of its place — only when the count of lines between the two sure
  // ones is exactly right. Such a line is marked unsure (line.placed). Nothing else is touched.
  function formationNumbers(lines){
    const F=(lines||[]).filter(l=>l&&l.free&&l.box&&!l.under), yc=l=>(l.box.y0+l.box.y1)/2, hh=l=>l.box.y1-l.box.y0;
    const numd=F.filter(l=>l.no!=null);
    if(numd.length<8) return [];
    const nameLike=t=>t.split(/\s+/).filter(w=>/^[A-ZÀ-Þ][A-Za-zÀ-ɏ'’-]+$/.test(w)).length>=2;
    const like=l=>l.no==null&&!isNumTok(l.text)&&!RE_KEEP.test(fold(l.text).trim())&&nameLike(l.text)&&numd.some(n=>n.page===l.page&&Math.abs(yc(n)-yc(l))<0.6*Math.max(hh(n),hh(l))&&hh(l)>0.6*hh(n));
    const P=F.filter(l=>l.no!=null||like(l)), m=Math.min(15,P.length);
    if(m<8) return [];
    const sure=i=>P[i].no===i+1; let agree=0; for(let i=0;i<m;i++) if(sure(i)) agree++;
    if(agree<0.6*m||agree===m) return [];
    const count=new Map(); P.forEach(l=>{ if(l.no!=null) count.set(l.no,(count.get(l.no)||0)+1); });
    const placed=[];
    for(let i=0;i<m;i++){ if(sure(i)) continue;
      let a=i-1; while(a>=0&&!sure(a)) a--; let b=i+1; while(b<m&&!sure(b)) b++;
      if(b>=m||(a<0&&i>0&&false)) continue;                                        // a sure line must follow (and one before it, unless this is the very first place)
      if(a<0&&P.slice(0,b).some((l,k)=>l.no!=null&&l.no!==k+1&&count.get(l.no)===1&&l.no<b+1&&false)) continue;
      const l=P[i], n=i+1, bad=l.no==null||count.get(l.no)>1||l.no<=(a<0?0:a+1)||l.no>=b+1;
      if(!bad||P.some((x,k)=>k!==i&&x.no===n&&sure(k))) continue;
      if(l.no!=null) l.text=l.text.replace(/^[#(\[]?\s*\d{1,2}[.\-–—:)\]]*\s*/, n+' ');
      else l.text=n+' '+l.text.replace(/^(?:(?![A-ZÀ-Þ][a-zß-ÿ]+\s)\S{1,3}\s+)(?=\S+\s+\S)/,'');
      l.no=n; l.placed=true; l.conf=Math.min(l.conf==null?100:l.conf, 50); placed.push(n);
    }
    return placed;
  }
  R.formationNumbers=formationNumbers;

  // ── 1f. name boxes: a jersey with the number on it, and under it a light box of three lines ──
  // Some programmes print each starter as a jersey graphic (the number is on the jersey) over a light rounded box
  // holding three centred lines: the Irish name, the ENGLISH NAME IN BOLD, the club. There is no "number + name"
  // line to find, so the boxes themselves are looked for in the picture, each is read by itself, the bold line (else
  // the middle one) is taken, and the numbers come from where the boxes stand (1 / 3 / 3 / 2 / 3 / 3).
  //
  // findBoxes(px, w, h) → {boxes:[{x0,y0,x1,y1,fill}]}   px: one byte a pixel, light = high. (The reader passes the
  // LOWEST of the three colour channels, so a white box on green grass is light and the grass is not.)
  function findBoxes(g, w, h, o){
    o=o||{};
    const f=Math.max(1, Math.round(Math.max(w,h)/(o.small||420))), sw=Math.floor(w/f), sh=Math.floor(h/f), n=sw*sh;
    if(sw<40||sh<40) return {boxes:[], f};
    // reduced by taking the lightest pixel of each block (thin dark letters go), then closed (what is left of bold letters goes)
    const P=new Uint8Array(n), D=new Uint8Array(n);
    for(let y=0;y<sh;y++) for(let x=0;x<sw;x++){ let m=0; for(let j=0;j<f;j++){ const row=(y*f+j)*w+x*f; for(let i=0;i<f;i++){ const v=g[row+i]; if(v>m) m=v; } } P[y*sw+x]=m; }
    for(let y=0;y<sh;y++) for(let x=0;x<sw;x++){ let m=0; for(let j=-1;j<=1;j++){ const yy=y+j; if(yy<0||yy>=sh) continue; for(let i=-1;i<=1;i++){ const xx=x+i; if(xx<0||xx>=sw) continue; const v=P[yy*sw+xx]; if(v>m) m=v; } } D[y*sw+x]=m; }
    for(let y=0;y<sh;y++) for(let x=0;x<sw;x++){ let m=255; for(let j=-1;j<=1;j++){ const yy=y+j; if(yy<0||yy>=sh) continue; for(let i=-1;i<=1;i++){ const xx=x+i; if(xx<0||xx>=sw) continue; const v=D[yy*sw+xx]; if(v<m) m=v; } } P[y*sw+x]=m; }
    // what the boxes lie on: a low percentile over a wide window, on a coarse grid
    const c=4, cw=Math.ceil(sw/c), ch=Math.ceil(sh/c), C=new Uint8Array(cw*ch), BG=new Uint8Array(cw*ch), rr=Math.max(3, Math.round(Math.min(cw,ch)*0.16)), hist=new Uint32Array(256);
    for(let y=0;y<ch;y++) for(let x=0;x<cw;x++) C[y*cw+x]=P[Math.min(sh-1,y*c+1)*sw+Math.min(sw-1,x*c+1)];
    for(let y=0;y<ch;y++) for(let x=0;x<cw;x++){ hist.fill(0); let cnt=0; for(let yy=Math.max(0,y-rr);yy<=Math.min(ch-1,y+rr);yy++) for(let xx=Math.max(0,x-rr);xx<=Math.min(cw-1,x+rr);xx++){ hist[C[yy*cw+xx]]++; cnt++; }
      let acc=0, v=0; const want=cnt*0.3; for(v=0;v<256;v++){ acc+=hist[v]; if(acc>=want) break; } BG[y*cw+x]=v; }
    const found=[], Lh=Math.round(0.11*sw), Lv=Math.round(0.022*sh);
    const rowsOpen=bin=>{ for(let y=0;y<sh;y++){ let s=-1; for(let x=0;x<=sw;x++){ const on=x<sw&&bin[y*sw+x]; if(on&&s<0) s=x; if(!on&&s>=0){ if(x-s<Lh) for(let i=s;i<x;i++) bin[y*sw+i]=0; s=-1; } } } };
    // light = clearly lighter than the background, at several levels (glare and shadow differ across a photo)
    // … and at plain levels of lightness (a box at the dark edge of the page, where "the background" is the dark)
    (o.ks||[1.15,1.3,1.5,1.8,2.2,2.7,-140,-165,-190,-215]).forEach(k=>{
      const bin=new Uint8Array(n);
      if(k<0){ for(let i=0;i<n;i++) if(P[i]>-k) bin[i]=1; }
      else for(let y=0;y<sh;y++) for(let x=0;x<sw;x++){ const b=BG[Math.min(ch-1,(y/c)|0)*cw+Math.min(cw-1,(x/c)|0)], v=P[y*sw+x]; if(v>k*b+8&&v>90) bin[y*sw+x]=1; }
      // only runs of light at least a box wide and a box high are kept — a white jersey touching its box, a thin border line go
      rowsOpen(bin);
      for(let x=0;x<sw;x++){ let s=-1; for(let y=0;y<=sh;y++){ const on=y<sh&&bin[y*sw+x]; if(on&&s<0) s=y; if(!on&&s>=0){ if(y-s<Lv) for(let i=s;i<y;i++) bin[i*sw+x]=0; s=-1; } } }
      rowsOpen(bin);
      const lab=new Int32Array(n), par=[0], find=x=>{ while(par[x]!==x){ par[x]=par[par[x]]; x=par[x]; } return x; };
      for(let y=0;y<sh;y++) for(let x=0;x<sw;x++){ const i=y*sw+x; if(!bin[i]) continue; const A=x&&bin[i-1]?lab[i-1]:0, U=y&&bin[i-sw]?lab[i-sw]:0;
        if(A&&U){ const a=find(A), q=find(U); if(a!==q) par[Math.max(a,q)]=Math.min(a,q); lab[i]=Math.min(a,q); } else if(A||U) lab[i]=A||U; else { par.push(par.length); lab[i]=par.length-1; } }
      const comps=new Map();
      for(let y=0;y<sh;y++) for(let x=0;x<sw;x++){ const i=y*sw+x; if(!bin[i]) continue; const cc=find(lab[i]); let q=comps.get(cc); if(!q){ q={x0:x,x1:x,y0:y,y1:y,area:0}; comps.set(cc,q); }
        q.area++; if(x<q.x0) q.x0=x; if(x>q.x1) q.x1=x; if(y>q.y1) q.y1=y; }
      comps.forEach(q=>{ const ww=q.x1-q.x0+1, hh=q.y1-q.y0+1, fill=q.area/(ww*hh);
        if(ww<0.12*sw||ww>0.45*sw||hh<0.025*sh||hh>0.12*sh||ww/hh<1.8||ww/hh>6||fill<0.8) return;
        found.push({x0:q.x0*f, y0:q.y0*f, x1:(q.x1+1)*f, y1:(q.y1+1)*f, fill}); });
    });
    // the boxes of one design are one size; of a box found at several levels the one nearest that size is kept
    let B=found; const out=[];
    if(B.length>=3){ const mh=med(B.map(b=>b.y1-b.y0)), mw=med(B.map(b=>b.x1-b.x0)); B.forEach(b=>{ const hh=b.y1-b.y0, ww=b.x1-b.x0; b.off=Math.abs(hh-mh)/mh+Math.abs(ww-mw)/mw-0.5*b.fill; b.ok=hh>0.72*mh&&hh<1.35*mh&&ww>0.65*mw&&ww<1.5*mw; });
      B=B.filter(b=>b.ok).sort((a,b)=>a.off-b.off); }
    B.forEach(b=>{ if(out.some(q=>{ const ix=Math.min(b.x1,q.x1)-Math.max(b.x0,q.x0), iy=Math.min(b.y1,q.y1)-Math.max(b.y0,q.y0); return ix>0&&iy>0&&ix*iy>0.3*Math.min((b.x1-b.x0)*(b.y1-b.y0),(q.x1-q.x0)*(q.y1-q.y0)); })) return; out.push({x0:b.x0, y0:b.y0, x1:b.x1, y1:b.y1, fill:b.fill}); });
    out.sort((a,b)=>a.y0-b.y0||a.x0-b.x0);
    return {boxes:out, f};
  }
  R.findBoxes=findBoxes;
  R.BOXMIN=8;                                     // this many name boxes and the page is read box by box

  // How heavy the letters in a part of the picture are: the usual width of a pen stroke, in pixels (bold text has
  // wider strokes than regular text of the same size). g: grey bytes, dark ink on light. → {sw, ink} or null
  function strokeWidth(g, w, h, b){
    const x0=Math.max(0,Math.floor(b.x0)), x1=Math.min(w,Math.ceil(b.x1)), y0=Math.max(0,Math.floor(b.y0)), y1=Math.min(h,Math.ceil(b.y1)), bw=x1-x0, bh=y1-y0;
    if(bw<3||bh<3) return null;
    const hist=new Uint32Array(256), n=bw*bh; for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) hist[g[y*w+x]]++;
    let sum=0; for(let i=0;i<256;i++) sum+=i*hist[i]; let sb=0, wb=0, best=-1, th=128;
    for(let i=0;i<256;i++){ wb+=hist[i]; if(!wb) continue; const wf=n-wb; if(!wf) break; sb+=i*hist[i]; const mb=sb/wb, mf=(sum-sb)/wf, q=wb*wf*(mb-mf)*(mb-mf); if(q>best){ best=q; th=i; } }
    // through every ink pixel: the shorter of the runs of ink across and down it; the average over the ink
    const ink=new Uint8Array(n), hr=new Uint16Array(n), vr=new Uint16Array(n); let k=0;
    for(let y=0;y<bh;y++) for(let x=0;x<bw;x++){ if(g[(y+y0)*w+x+x0]<=th){ ink[y*bw+x]=1; k++; } }
    if(k<0.03*n||k>0.75*n) return null;
    for(let y=0;y<bh;y++){ let s=-1; for(let x=0;x<=bw;x++){ const on=x<bw&&ink[y*bw+x]; if(on&&s<0) s=x; if(!on&&s>=0){ for(let i=s;i<x;i++) hr[y*bw+i]=x-s; s=-1; } } }
    for(let x=0;x<bw;x++){ let s=-1; for(let y=0;y<=bh;y++){ const on=y<bh&&ink[y*bw+x]; if(on&&s<0) s=y; if(!on&&s>=0){ for(let i=s;i<y;i++) vr[i*bw+x]=y-s; s=-1; } } }
    let tot=0; for(let i=0;i<n;i++) if(ink[i]) tot+=hr[i]<vr[i]?hr[i]:vr[i];
    return {sw:tot/k, ink:k/n};
  }
  R.strokeWidth=strokeWidth;
  // The number printed on a jersey. g: a grey picture of the jersey (w×h). The digits are the one or two shapes of
  // the "other" colour in the lower middle of the shirt — white on maroon, blue on white — of a digit's size and not
  // touching the edge. → {w, h, px (0 = ink, 255 = paper: only those shapes, with a margin), n: digits} | null
  function digitBlob(g, w, h){
    const top=Math.floor(0.36*h), hist=new Uint32Array(256); let n=0;
    for(let y=top;y<h;y++) for(let x=0;x<w;x++){ hist[g[y*w+x]]++; n++; }
    let sum=0; for(let i=0;i<256;i++) sum+=i*hist[i]; let sb=0, wb=0, best=-1, th=128;
    for(let i=0;i<256;i++){ wb+=hist[i]; if(!wb) continue; const wf=n-wb; if(!wf) break; sb+=i*hist[i]; const mb=sb/wb, mf=(sum-sb)/wf, q=wb*wf*(mb-mf)*(mb-mf); if(q>best){ best=q; th=i; } }
    // the shirt is what most of the middle is
    let dark=0, tot=0; for(let y=Math.floor(0.45*h);y<Math.floor(0.95*h);y++) for(let x=Math.floor(0.3*w);x<Math.floor(0.7*w);x++){ tot++; if(g[y*w+x]<=th) dark++; }
    if(!tot) return null; const inkDark=dark<tot/2;
    const bin=new Uint8Array(w*h); for(let y=top;y<h;y++) for(let x=0;x<w;x++){ const d=g[y*w+x]<=th; if(d===inkDark) bin[y*w+x]=1; }
    const lab=new Int32Array(w*h), par=[0], find=x=>{ while(par[x]!==x){ par[x]=par[par[x]]; x=par[x]; } return x; };
    for(let y=top;y<h;y++) for(let x=0;x<w;x++){ const i=y*w+x; if(!bin[i]) continue; const A=x&&bin[i-1]?lab[i-1]:0, U=y>top&&bin[i-w]?lab[i-w]:0;
      if(A&&U){ const a=find(A), q=find(U); if(a!==q) par[Math.max(a,q)]=Math.min(a,q); lab[i]=Math.min(a,q); } else if(A||U) lab[i]=A||U; else { par.push(par.length); lab[i]=par.length-1; } }
    const C=new Map();
    for(let y=top;y<h;y++) for(let x=0;x<w;x++){ const i=y*w+x; if(!bin[i]) continue; const c=find(lab[i]); lab[i]=c; let q=C.get(c); if(!q){ q={id:c,x0:x,x1:x,y0:y,y1:y,a:0}; C.set(c,q); } q.a++; if(x<q.x0) q.x0=x; if(x>q.x1) q.x1=x; if(y>q.y1) q.y1=y; }
    const cand=[...C.values()].filter(q=>{ const ch=q.y1-q.y0+1, cw=q.x1-q.x0+1, xc=(q.x0+q.x1)/2, yc=(q.y0+q.y1)/2;
      return ch>=0.2*h&&ch<=0.6*h&&cw<=0.42*w&&cw>=0.04*w&&cw<=1.1*ch&&q.x0>1&&q.x1<w-2&&q.y1<h-1&&q.y0>top&&xc>0.15*w&&xc<0.85*w&&yc>0.5*h&&q.a>=0.18*cw*ch; });
    if(!cand.length) return null;
    cand.sort((a,b)=>Math.abs((a.x0+a.x1)/2-w/2)-Math.abs((b.x0+b.x1)/2-w/2));
    const first=cand[0], fh=first.y1-first.y0+1, pick=[first];
    const mate=cand.slice(1).filter(q=>{ const qh=q.y1-q.y0+1, ov=Math.min(q.y1,first.y1)-Math.max(q.y0,first.y0), gap=q.x0>first.x1?q.x0-first.x1:first.x0-q.x1; return qh>0.7*fh&&qh<1.4*fh&&ov>0.6*Math.min(qh,fh)&&gap>=0&&gap<0.7*fh; })
      .sort((a,b)=>Math.abs((a.x0+a.x1)/2-w/2)-Math.abs((b.x0+b.x1)/2-w/2))[0];
    if(mate) pick.push(mate);
    const ids=new Set(pick.map(q=>q.id)), x0=Math.min.apply(null,pick.map(q=>q.x0)), x1=Math.max.apply(null,pick.map(q=>q.x1)), y0=Math.min.apply(null,pick.map(q=>q.y0)), y1=Math.max.apply(null,pick.map(q=>q.y1));
    const m=Math.round(0.45*(y1-y0+1)), ow=x1-x0+1+2*m, oh=y1-y0+1+2*m, px=new Uint8Array(ow*oh).fill(255);
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){ if(ids.has(lab[y*w+x])) px[(y-y0+m)*ow+(x-x0+m)]=0; }
    return {w:ow, h:oh, px, n:pick.length};
  }
  R.digitBlob=digitBlob;
  // the words read inside one box → its lines, top to bottom: [{text, conf, weight (stroke width), box, words}]
  function boxLines(words){
    const ws=prep(words).filter(w=>/[A-Za-zÀ-ɏ0-9]/.test(w.text)); if(!ws.length) return [];
    const rows=[];
    // words that share most of their height are one line (a tilted line, a word with a tail below the line)
    // the engine's own lines, where it gave them (a box is read by itself): its word boxes are not always tight
    if(ws.every(w=>w.ln!=null)){ const m=new Map(); ws.forEach(w=>{ if(!m.has(w.ln)) m.set(w.ln,{ws:[], y0:0, y1:0}); m.get(w.ln).ws.push(w); });
      m.forEach(r=>{ const s=r.ws.slice().sort((a,b)=>a.yc-b.yc); r.y0=r.y1=s[s.length>>1].yc; rows.push(r); }); }
    else ws.slice().sort((a,b)=>a.yc-b.yc).forEach(w=>{ let best=null, bo=0;
      rows.forEach(r=>{ const ov=(Math.min(w.y1,r.y1)-Math.max(w.y0,r.y0))/Math.min(w.h,r.y1-r.y0); if(ov>bo){ bo=ov; best=r; } });
      if(best&&bo>0.5){ best.ws.push(w); const s=best.ws.slice().sort((a,b)=>a.y0-b.y0), e=best.ws.slice().sort((a,b)=>a.y1-b.y1); best.y0=s[s.length>>1].y0; best.y1=e[e.length>>1].y1; }
      else rows.push({ws:[w], y0:w.y0, y1:w.y1}); });
    rows.sort((a,b)=>(a.y0+a.y1)-(b.y0+b.y1));
    const lt=w=>w.text.replace(/[^A-Za-zÀ-ɏ]/g,'').length;
    let L=rows.map(r=>{ r.ws.sort((a,b)=>a.x0-b.x0);
      // scraps at either end of a line (the edge of the box read as a letter or two)
      while(r.ws.length>1&&(lt(r.ws[0])<3&&r.ws[0].conf!=null&&r.ws[0].conf<50&&!/^[ÓO]$/.test(r.ws[0].text))) r.ws.shift();
      while(r.ws.length>1&&(lt(r.ws[r.ws.length-1])<3&&r.ws[r.ws.length-1].conf!=null&&r.ws[r.ws.length-1].conf<50&&!/^\(/.test(r.ws[r.ws.length-1].text))) r.ws.pop();
      const cf=r.ws.filter(w=>w.conf!=null&&lt(w)).map(w=>w.conf);
      let ws2=0, wn=0; r.ws.forEach(w=>{ const k=lt(w); if(k>=2&&w.sw!=null){ ws2+=w.sw*k; wn+=k; } });
      return {text:r.ws.map(w=>w.text).join(' '), letters:r.ws.reduce((t,w)=>t+lt(w),0), conf:cf.length?Math.min.apply(null,cf):null, mean:cf.length?cf.reduce((a,b)=>a+b,0)/cf.length:null, weight:wn?ws2/wn:null, words:r.ws,
        box:{x0:Math.min.apply(null,r.ws.map(w=>w.x0)), y0:Math.min.apply(null,r.ws.map(w=>w.y0)), x1:Math.max.apply(null,r.ws.map(w=>w.x1)), y1:Math.max.apply(null,r.ws.map(w=>w.y1))}}; })
      .filter(l=>l.letters>=3);
    // more than three lines: the ones the reader could make nothing of (the rim of the box, the hem of the jersey) go
    while(L.length>3){ const bad=L.map((l,i)=>({i, m:l.mean==null?100:l.mean})).filter(x=>x.m<60).sort((a,b)=>a.m-b.m)[0]; if(!bad) break; L.splice(bad.i,1); }
    return L;
  }
  R.boxLines=boxLines;
  R.BOLD=1.15;                                    // a line whose strokes are this much wider than any other line of its box is the bold one
  // Which line of a box is the player's English name? The bold one; with no clear bold line, the middle of three.
  // → {i, how:'bold'|'middle'|'guess', agree: bold line = middle line (null when that cannot be said), sure}
  function pickEnglish(lines){
    const n=(lines||[]).length; if(!n) return null;
    const wt=lines.map(l=>l.weight), have=n>=2&&wt.every(v=>v!=null&&v>0);
    let bold=null, ratio=0; if(have){ const s=wt.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v); ratio=s[0].v/s[1].v; if(ratio>=R.BOLD) bold=s[0].i; }
    const mid=n===3?1:null;
    if(bold!=null) return {i:bold, how:'bold', agree:mid==null?null:bold===mid, sure:mid==null?(n===2&&ratio>=1.3):bold===mid, ratio};
    if(mid!=null) return {i:mid, how:'middle', agree:null, sure:true, ratio};
    // one, two or four lines and nothing bold: the tallest line of two (the English name is set larger), the first of one, a middle one of four
    let i=n===1?0:(n===2?((lines[1].box.y1-lines[1].box.y0)>(lines[0].box.y1-lines[0].box.y0)?1:0):1);
    return {i, how:'guess', agree:null, sure:false, ratio};
  }
  R.pickEnglish=pickEnglish;
  // boxes → rows, top to bottom, each left to right
  function boxRows(B){
    const hh=med(B.map(b=>b.y1-b.y0))||1, rows=[];
    B.slice().sort((a,b)=>(a.y0+a.y1)-(b.y0+b.y1)).forEach(b=>{ const yc=(b.y0+b.y1)/2, r=rows[rows.length-1];
      if(r&&Math.abs(yc-r.yc)<0.6*hh){ r.B.push(b); r.yc=r.B.reduce((t,x)=>t+(x.y0+x.y1)/2,0)/r.B.length; } else rows.push({yc, B:[b]}); });
    return rows.map(r=>r.B.sort((a,b)=>a.x0-b.x0));
  }
  R.boxRows=boxRows;
  const SHAPE=[1,3,3,2,3,3]; R.JSURE=75;
  // Numbers for the boxes. Fifteen boxes standing 1 / 3 / 3 / 2 / 3 / 3: numbered 1–15 by place; a jersey number read
  // with confidence that says otherwise is noted (box.clash). Any other arrangement (a box not found, another
  // formation): the numbers read from the jerseys, and the gaps between two of them filled where the count fits.
  // box.jersey = {no, conf} | null.  Sets box.no, box.by ('place' | 'jersey' | 'between' | null) → {method, shape, read, agree}
  function numberBoxes(rows){
    const seq=[].concat.apply([], rows), shape=rows.map(r=>r.length);
    const std=shape.length===SHAPE.length&&shape.every((v,i)=>v===SHAPE[i]);
    const jz=b=>b.jersey&&b.jersey.no>=1&&b.jersey.no<=40?b.jersey:null;
    let read=0, agree=0;
    if(std){ seq.forEach((b,i)=>{ b.no=i+1; b.by='place'; delete b.clash; const j=jz(b); if(j&&j.conf>=R.JSURE){ read++; if(j.no===b.no) agree++; else b.clash=j.no; } });
      return {method:'place', shape, read, agree}; }
    // not the usual shape: jersey numbers that rise in reading order
    let last=null; seq.forEach((b,i)=>{ b.no=null; b.by=null; delete b.clash; const j=jz(b); if(!j||j.conf<60) return;
      if(last&&!(j.no>last.no&&j.no-last.no>=i-last.i)) return; if(!last&&j.no<i+1) return;
      b.no=j.no; b.by='jersey'; last={no:j.no, i}; read++; });
    const known=seq.map((b,i)=>b.no!=null?i:-1).filter(i=>i>=0);
    const fill=(a,b,start)=>{ for(let i=a;i<b;i++){ seq[i].no=start+(i-a); seq[i].by='between'; } };
    if(known.length){
      if(seq[known[0]].no===known[0]+1) fill(0, known[0], 1);
      for(let k=0;k+1<known.length;k++){ const a=known[k], b=known[k+1]; if(seq[b].no-seq[a].no===b-a) fill(a+1, b, seq[a].no+1); }
      const z=known[known.length-1]; if(seq[z].no+(seq.length-1-z)<=15) fill(z+1, seq.length, seq[z].no+1);
    }
    return {method:'jersey', shape, read, agree:read};
  }
  R.numberBoxes=numberBoxes;
  // the lines of the page outside the boxes (and outside the jerseys over them)
  function outsideLines(words, boxes, o){
    const hh=med((boxes||[]).map(b=>b.y1-b.y0))||0;
    const inb=w=>{ const xc=(w.x0+w.x1)/2, yc=(w.y0+w.y1)/2; return (boxes||[]).some(b=>xc>=b.x0-0.04*hh&&xc<=b.x1+0.04*hh&&yc>=b.y0-1.05*hh&&yc<=b.y1+0.1*hh); };
    const rest=(words||[]).filter(w=>w&&!inb(w)&&/[A-Za-zÀ-ɏ0-9]/.test(String(w.text||''))), fr=freeLayout(rest, {skew:(o||{}).skew}), H=fr.H||1, lines=[];
    // "FIR IONAID 16. Connor Gleeson …": the heading of the list standing right against its first line is cut from it
    [].concat.apply([], fr.columns.map(c=>c.lines)).forEach(l=>{ const ws=(l.words||[]).slice().sort((a,b)=>a.rx0-b.rx0); let k=-1;
      if(l.no==null&&ws.length>=3) for(let i=1;i<ws.length-1;i++){ if(isNumTok(ws[i].text)&&hasLetter(ws[i+1].text)&&RE_SUBSF.test(fold(ws.slice(0,i).map(w=>w.text).join(' ')).replace(/[^a-z\s]+/g,' ').trim())){ k=i; break; } }
      if(k<0){ lines.push(l); return; }
      [ws.slice(0,k), ws.slice(k)].forEach(part=>{ const x=rowLine([segOf(part)], H, null, null, true); x.free=true; lines.push(x); }); });
    return {lines, H};
  }
  // the numbered list beside / under the formation (the subs): numbered lines above 15 whose numbers stand in one column
  function subsColumn(lines, H){
    const S=lines.filter(l=>l.no!=null&&l.no>15&&l.no<=40&&l.box); if(S.length<3) return null;
    const mx=med(S.map(l=>l.box.x0)), col=S.filter(l=>Math.abs(l.box.x0-mx)<2.5*H); if(col.length<3) return null;
    col.sort((a,b)=>a.yc-b.yc);
    const gaps=[]; for(let i=1;i<col.length;i++) gaps.push(col[i].yc-col[i-1].yc);
    const pitch=Math.max(H, med(gaps)||H);
    return {x:mx, lines:col, pitch, x0:mx, x1:Math.max.apply(null,col.map(l=>l.box.x1)), y0:col[0].box.y0, y1:col[col.length-1].box.y1};
  }
  // where to read the subs list again, enlarged: {x0,y0,x1,y1} in the picture, or null
  R.subsZone=function(words, boxes, W, Hh){
    const o=outsideLines(words, boxes), c=subsColumn(o.lines, o.H); if(!c) return null;
    const H=o.H, z={x0:Math.max(0,c.x0-0.7*H), y0:Math.max(0,c.y0-2.5*c.pitch), x1:Math.min(W||1e9,c.x1+2*H), y1:Math.min(Hh||1e9,c.y1+2.5*c.pitch)};   // room for a first or last line whose number was not read
    return (z.x1-z.x0>8*H&&z.y1-z.y0>3*H)?z:null;
  };
  R.CLUB=1.12;
  // "16. Connor Gleeson Dún Mór Mhic Éil": the name in bold, the club after it in lighter (italic) type on the same line.
  // Where the first words of the lines are clearly heavier than their last words, each line is cut where the heavy
  // words stop; the tail goes to line.tail. A cut that is not clear-cut marks the line (line.unsure).
  // lines: numbered lines with .words (each with .sw). → {on, cut, unsure, bold, light}
  function clubSplit(lines){
    const lt=w=>w.text.replace(/[^A-Za-zÀ-ɏ]/g,'').length;
    const rows=(lines||[]).map(l=>{ const ws=(l.words||[]).slice().sort((a,b)=>a.x0-b.x0); let k=0; while(k<ws.length&&!lt(ws[k])) k++; return {l, head:ws.slice(0,k), ws:ws.slice(k)}; })
      .filter(r=>r.head.length&&r.ws.length>=2);
    const m=rows.filter(r=>r.ws.length>=3&&r.ws[0].sw!=null&&r.ws[r.ws.length-1].sw!=null&&lt(r.ws[0])>=2&&lt(r.ws[r.ws.length-1])>=2);
    if(m.length<4) return {on:false, cut:0, unsure:0};
    const B=med(m.map(r=>r.ws[0].sw)), L=med(m.map(r=>r.ws[r.ws.length-1].sw));
    if(!(B>=R.CLUB*L)) return {on:false, cut:0, unsure:0, bold:B, light:L};
    const D=Math.log(B/L); let cut=0, unsure=0;
    rows.forEach(r=>{ const n=r.ws.length, v=r.ws.map(w=>(w.sw==null||lt(w)<2)?null:Math.log(w.sw));
      // the cut that best divides the line into heavy words, then light words (least spread on either side); a name has at least one word
      const part=(i,j)=>{ const a=v.slice(i,j).filter(x=>x!=null); if(!a.length) return {m:null, e:0}; const m=a.reduce((p,q)=>p+q,0)/a.length; return {m, e:a.reduce((p,q)=>p+(q-m)*(q-m),0)}; };
      let bk=n, be=Infinity, bl=null, br=null;
      for(let k=1;k<n;k++){ const l=part(0,k), rt=part(k,n); if(l.m==null||rt.m==null||l.m-rt.m<0.55*D) continue; if(l.e+rt.e<be-1e-12){ be=l.e+rt.e; bk=k; bl=l.m; br=rt.m; } }
      let sure=true;
      if(bk<n){ // the words either side of the cut must each sit clearly with their own side
        const near=(x,own,other)=>x==null||Math.abs(x-other)-Math.abs(x-own)>=0.25*D;
        let i=bk-1; while(i>0&&v[i]==null) i--; let j=bk; while(j<n-1&&v[j]==null) j++;
        sure=bl-br>=0.7*D&&near(v[i],bl,br)&&near(v[j],br,bl); }
      // "Daniel Ó | Flaherty": a name does not end on a particle
      while(bk<n&&PARTICLE.test(r.ws[bk-1].text.replace(/[^A-Za-zÀ-ɏ]/g,'').toLowerCase())&&/^[A-ZÀ-Þ]/.test(r.ws[bk].text)){ bk++; sure=false; }
      if(bk<2) sure=false;                                                      // a name of one word
      if(bk===n&&n>2) sure=false;                                               // no club found on a line of several words
      const l=r.l, name=r.ws.slice(0,bk), tail=r.ws.slice(bk);
      l.text=r.head.map(w=>w.text).join(' ')+' '+name.map(w=>w.text).join(' '); l.no=lineNo(l.text);
      if(tail.length){ l.tail=tail.map(w=>w.text).join(' '); cut++; }
      const cf=r.head.concat(name).filter(w=>w.conf!=null&&/[A-Za-zÀ-ɏ0-9]/.test(w.text)).map(w=>w.conf); if(cf.length) l.conf=Math.min.apply(null,cf);
      if(!sure){ l.unsure=true; l.conf=Math.min(l.conf==null?100:l.conf, 50); unsure++; } });
    return {on:true, cut, unsure, bold:B, light:L};
  }
  R.clubSplit=clubSplit;
  // boxLayout(words, boxes, {width, height}) → a layout like freeLayout's (one team), or null when this is not such a page.
  //   words: the whole picture's words (each may carry .sw). boxes: [{x0,y0,x1,y1, words:[…read inside it…], jersey:{no,conf}|null}]
  function boxLayout(words, boxes, o){
    o=o||{};
    const all=(boxes||[]).map(b=>{ const L=boxLines(b.words||[]); return Object.assign({}, b, {L, pick:L.length>=2&&L.length<=4?pickEnglish(L):null}); });
    const good=all.filter(b=>b.pick);
    if(good.length<R.BOXMIN) return null;
    const rows=boxRows(good), num=numberBoxes(rows), seq=[].concat.apply([], rows), lines=[], notes=[];
    const st={boxes:good.length, shape:num.shape, method:num.method, jerseyRead:num.read, jerseyAgree:num.agree, three:0, bold:0, boldIsMiddle:0, boldNotMiddle:0, middle:0, guess:0, clash:[]};
    seq.forEach(b=>{ const p=b.pick, l=b.L[p.i]; let conf=l.conf==null?100:l.conf, why=[];
      if(b.L.length===3) st.three++;
      if(p.how==='bold'){ st.bold++; if(p.agree===true) st.boldIsMiddle++; else if(p.agree===false) st.boldNotMiddle++; } else if(p.how==='middle') st.middle++; else st.guess++;
      if(!p.sure) why.push(b.L.length===3?'the bold line is not the middle line':'the box did not read as three lines');
      if(b.clash!=null){ why.push('the jersey reads '+b.clash); st.clash.push({no:b.no, jersey:b.clash, name:l.text}); }
      if(num.method!=='place') why.push(b.by==='jersey'?'number read from the jersey':b.by==='between'?'number worked out from the jerseys beside it':'no number');
      if(why.length) conf=Math.min(conf, 50);
      const name=l.text.replace(/^[^A-Za-zÀ-ɏ]+/,'');
      lines.push({text:(b.no!=null?b.no+' ':'')+name, no:b.no==null?null:b.no, conf, box:{x0:b.x0, y0:b.y0, x1:b.x1, y1:b.y1}, yc:(b.y0+b.y1)/2, h:l.box.y1-l.box.y0, boxed:true, why:why.join('; ')||undefined});
      b.L.forEach((x,i)=>{ if(i!==p.i) lines.push({text:x.text, no:null, conf:x.conf, box:x.box, yc:(x.box.y0+x.box.y1)/2, h:x.box.y1-x.box.y0, inbox:true}); }); });
    // the rest of the page: the numbered column (the subs) is kept, everything else is not a player
    const out=outsideLines(words, all, o), H=out.H||1, col=subsColumn(out.lines, H), subs=[];
    if(col){
      const inCol=l=>l.box&&l.yc>col.y0-0.8*col.pitch&&l.yc<col.y1+0.8*col.pitch;
      out.lines.forEach(l=>{ const f=fold(l.text).trim();
        if(RE_SUBSF.test(f.replace(/[^a-z\s]+/g,' ').trim())&&l.no==null&&f.length<24){ l.text='Subs'; l.heading=true; subs.push(l); return; }
        if(inCol(l)&&l.no!=null&&Math.abs(l.box.x0-col.x)<2.5*H){ subs.push(l); return; }
        // a line of the list whose number was not read: it starts where the names start
        if(inCol(l)&&l.no==null&&!isNumTok(l.text)&&l.box.x0>col.x-H&&l.box.x0<col.x+7*H&&l.text.split(/\s+/).filter(w=>/^[A-ZÀ-Þ][A-Za-zÀ-ɏ'’-]+$/.test(w)).length>=2){ l.conf=Math.min(l.conf==null?100:l.conf, 50); l.nonum=true; subs.push(l); return; }
        l.outside=true; lines.push(l); });
      const S=subs.filter(l=>!l.heading).sort((a,b)=>a.yc-b.yc);
      // a number that breaks the run between two that fit ("22 · 4 · 24") is put right; so is a missing one
      const fixed=[]; for(let i=1;i+1<S.length;i++){ const a=S[i-1], l=S[i], b=S[i+1]; if(a.no!=null&&b.no!=null&&b.no-a.no===2&&!a.fixed&&l.no!==a.no+1){ const n=a.no+1;
        if(l.no!=null){ l.text=l.text.replace(/^[#(\[]?\s*\d{1,2}[.\-–—:)\]]*\s*/, n+' '); if(l.words) l.words=l.words.slice().sort((p,q)=>p.x0-q.x0).map((w,k)=>k===0?Object.assign({},w,{text:String(n)}):w); }
        else { l.text=n+' '+l.text; if(l.words) l.words=[{text:String(n), x0:col.x, x1:col.x+H, y0:l.box.y0, y1:l.box.y1, conf:50, sw:null}].concat(l.words); }
        l.no=n; l.fixed=true; l.conf=Math.min(l.conf==null?100:l.conf, 50); fixed.push(n); } }
      const cs=clubSplit(S.filter(l=>l.no!=null));
      st.subs=S.length; st.club=cs; st.fixed=fixed;
      S.forEach(l=>{ l.sub=true; });
      subs.sort((a,b)=>(b.heading?1:0)-(a.heading?1:0)||a.yc-b.yc).forEach(l=>lines.push(l));
      if(cs.on) notes.push('Subs: the club printed after each name (in lighter type) was cut off'+(cs.unsure?' — on '+cs.unsure+' line'+(cs.unsure===1?'':'s')+' the place to cut was not clear, so '+(cs.unsure===1?'it is':'they are')+' marked to check':'')+'.');
      if(fixed.length) notes.push('Sub number'+(fixed.length===1?' ':'s ')+fixed.join(', ')+' could not be read and '+(fixed.length===1?'was':'were')+' worked out from the lines above and below — check.');
    } else out.lines.forEach(l=>{ l.outside=true; lines.push(l); });
    const shape=num.shape.join(' / ');
    if(num.method==='place') notes.unshift('Starters: numbers 1–15 were taken from the positions of the 15 name boxes on the page ('+shape+'), not read from the lines — check.'
      +(num.read?' The jersey numbers that could be read ('+num.read+') '+(num.agree===num.read?'all agree':'agree for '+num.agree)+'.':''));
    else notes.unshift('Starters: '+good.length+' name boxes were found in rows of '+shape+' — not the usual 1 / 3 / 3 / 2 / 3 / 3 — so the numbers were read from the jerseys where they could be ('+seq.filter(b=>b.by==='jersey').length+' read, '+seq.filter(b=>b.by==='between').length+' worked out, '+seq.filter(b=>b.no==null).length+' without a number). Check every number.');
    st.clash.forEach(c=>notes.push('The jersey over “'+c.name+'” reads '+c.jersey+', but its place on the page is '+c.no+' — check.'));
    if(st.boldNotMiddle||st.guess) notes.push((st.boldNotMiddle+st.guess)+' name box'+(st.boldNotMiddle+st.guess===1?'':'es')+' did not read as Irish name / bold English name / club — marked to check.');
    lines.forEach(l=>{ l.free=true; });
    const P=lines.filter(l=>l.box);
    return {columns:[{x0:Math.min.apply(null,P.map(l=>l.box.x0)), x1:Math.max.apply(null,P.map(l=>l.box.x1)), lines, notes, boxed:true}], spanning:[], extra:[], skew:0, H, free:true, boxed:true, notes, stats:st};
  }
  R.boxLayout=boxLayout;

  // ── 2. lines → team lists ─────────────────────────────────────
  // Is this line a team's name used as a heading? ("GARRYMORE", "Garrymore GAA", "CLG Béal an Mhuirthead")
  const RE_V=/\s+(?:v|vs|versus)\.?\s+/i;
  // the Irish names of the counties, as printed over the lists in a county programme ("GAILLIMH", "ÁTH CLIATH")
  const IRISH={antrim:'aontroim',armagh:'ardmhacha',carlow:'ceatharlach',cavan:'anchabhan',clare:'anclar',cork:'corcaigh',derry:'doire',donegal:'dunnangall',down:'andun',dublin:'athcliath',fermanagh:'fearmanach',galway:'gaillimh',kerry:'ciarrai',kildare:'cilldara',kilkenny:'cillchainnigh',laois:'laois',leitrim:'liatroim',limerick:'luimneach',longford:'anlongfort',louth:'lu',mayo:'maigheo',meath:'anmhi',monaghan:'muineachan',offaly:'uibhfhaili',roscommon:'roscomain',sligo:'sligeach',tipperary:'tiobraidarann',tyrone:'tireoghain',waterford:'portlairge',westmeath:'aniarmhi',wexford:'lochgarman',wicklow:'cillmhantain'};
  function teamMatch(text, team){
    const ir=IRISH[foldKey(team)]; if(ir&&ir.length>=5&&team!==ir&&teamMatch(text, ir)) return true;
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
  function splitTeams(columns, teams, o){
    teams=(teams||[]).filter(Boolean);
    // o.fixed: the columns already are the lists (a formation page, divided by where its numbers lie) — a repeated
    // number there is a misread, not the start of another team
    if(o&&o.fixed){ let B=(columns||[]).map(c=>({lines:c.lines.slice(), numbered:c.lines.filter(l=>l.no!=null).length, notes:c.notes, boxed:c.boxed})); let more=0;
      if(B.length>2){ more=B.length-2; B=B.slice(0,2); }
      B.forEach(b=>{ const L=b.lines.filter(l=>l.box); b.page=L.length?L[0].page:undefined; const P=L.filter(l=>l.page===b.page);
        b.box=P.length?{x0:Math.min.apply(null,P.map(l=>l.box.x0)), y0:Math.min.apply(null,P.map(l=>l.box.y0)), x1:Math.max.apply(null,P.map(l=>l.box.x1)), y1:Math.max.apply(null,P.map(l=>l.box.y1))}:null; });
      B.more=more; return B; }
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

  const LOW=70;                                   // a line with a word the image reader was under 70% sure of is flagged
  R.LOW=LOW;
  // ── 3. clean-up before the editor's parser ────────────────────
  // Conservative: a line is only left out when it is clearly not a player; an
  // unsure line stays in the text for the user to see in the preview.
  // (all tested on the text with fadas removed and in lower case)
  // headings the editor's parser understands itself ("Subs", "Starting 15") are always passed on
  const RE_SUBSF=/^(?:subs?|substitutes?|substitutions?|replacements?|bench|fir\s+ionaid|fir\s*i?onai?d(?=\s*:?$)|ionadaithe)\b/;
  const RE_STARTF=/^(?:starting(?:\s+(?:xv|15|team|line[\s-]?up))?|starters?|team|line[\s-]?up|first\s+15|xv)\s*[:\-–]?$/;
  const RE_SUBS2=/^(?:(?:subs?|substitutes?|substitutions?|replacements?|bench|fir\s+ionaid|ionadaithe)[\s\/|,&\-–:.]*){2,}$/;
  const RE_KEEP={test:f=>RE_SUBSF.test(f)||RE_STARTF.test(f)};
  const OFFICIAL='(?:team\\s+)?(?:managers?|management|bainisteoir\\w*|selectors?|roghnoir\\w*|coach(?:es)?|trainers?|traenalai|physio\\w*|doctor|kitman|maor\\s+\\w+|referee|reiteoir|moltoir|linesm[ae]n|umpires?|maoir|standby\\s+referee|fourth\\s+official|match\\s+officials?|officials?|captain|captaen|vice[\\s-]?captain|chairman|chairperson|cathaoirleach|secretary|runai|sponsors?|sponsored\\s+by|venue|throw[\\s-]?in)';
  const RE_OFFICIAL=new RegExp('^'+OFFICIAL+'\\b'), RE_OFFICIAL_IN=new RegExp('[(\\[]\\s*'+OFFICIAL+'\\b');
  const RE_OFFICIAL_ANY=/(?:^|[^a-z])(?:b?ainisteoir|r?oghnoir|roghnoiri|managers?|selectors?|referee|reiteoir)\s*:/;
  const RE_POSITION=/^(?:goal\s?keepers?|goalie|keepers?|cul\s?baire|(?:(?:full|half|corner|centre|center|wing|left|right)[\s-]*){1,3}(?:backs?|forwards?|line)(?:\s+line)?|backs?|forwards?|defen[cs]e|defenders?|attack(?:ers)?|mid[\s-]?field(?:ers)?|lar\s+na\s+pairce|tosaithe|cosantoiri|cuil|lantosaithe)\s*[:\-]?$/;
  const RE_EVENT=/\b(?:19|20)\d\d\b|\b\d{1,2}[:.]\d{2}\s*(?:am|pm)\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|april|june|july|august|september|october|november|december)\b|\b(?:championship|league|semi[\s-]?finals?|quarter[\s-]?finals?|final|programme|clar\s+oifigiuil|team\s+sheets?|fixtures?|round\s+\d+)\b|www\.|\.ie\b|\.com\b|@/;
  const RE_BRACKET=/\s*[(\[][^()\[\]]*[A-Za-zÀ-ɏ][^()\[\]]*[)\]]/g;
  // a role note with a bracket on at least one side, wherever it sits: "16 (GK) Name", "Name (C)", "(Capt.) Name", and a
  // half-read one: "16 (GK Name", "16 GK) Name"
  const ROLE='(?:g\\.?\\s?k|c|v\\.?\\s?c|capt|captain|cpt|vice[\\s-]?capt(?:ain)?|capt?aen|j\\.?\\s?c|joint[\\s-]?capt(?:ain)?)\\.?';
  const RE_ROLE=new RegExp('(^|\\s)(?:[(\\[{]\\s*'+ROLE+'\\s*[)\\]}]?|'+ROLE+'\\s*[)\\]}])(?=\\s|$)','gi');
  const stripRole=c=>c.replace(RE_ROLE,'$1').replace(/ {2,}/g,' ').trim();
  R.stripRole=stripRole;
  const WHY={marks:'no letters or numbers', official:'manager / official', team:'team name', position:'position heading', event:'fixture / date / venue', bracket:'only a note in brackets', across:'a line across both columns', column:'a second column beside the names', under:'line under a numbered player (Irish name / club)', cut:'cut off by the edge of the crop box', above:'a line above the numbered list', inbox:'Irish name / club in the player\u2019s name box', outside:'not in a name box or the numbered list', club:'club printed after the name'};
  R.WHY=WHY;
  // "15 | Liam Ó Conghaile ." → "15 Liam Ó Conghaile"; "8 JohnMaher" → "8 John Maher"; "7 sean Kelly" → "7 Sean Kelly"
  const NOSPLIT=/^(?:Mc|Mac|Mag|De|Le|La|Fitz|Ni|Nic|Ui|Mhic|Van|Du|Di|O)$/;
  const PARTICLE=/^(?:de|da|di|du|la|le|van|von|der|den|mac|mhic|nic|an|na|ní|ni|uí|ui|ó|o)$/;
  function tidyRead(c){
    let m=/^([#(\[]?\d{1,2}[.):\]]*\s+)?(.*)$/.exec(c.trim()), no=m[1]?m[1].replace(/[^\d]/g,'')+' ':'', nm=m[2];
    if(/[(\[]\s*#?\s*\d{1,2}\s*[)\]]\s*$/.test(nm)) return c.trim();                       // "Name (7)" / "Name [7]": the number, left exactly as it is
    nm=nm.replace(/^(?:[|\[\]!¦:;.,_~=«»‹›“”"'’‘*+\\\/-]+\s+)+/,'').replace(/(?:\s+[|\[\]!¦:;.,_~=«»‹›“”"'’‘*+\\\/-]+)+$/,'').replace(/[|¦\[\]{}_~=«»‹›“”"*+\\]+/g,' ').replace(/\s[.:;,]+(?=\s|$)/g,' ').replace(/[.:;,]+$/,'').replace(/ {2,}/g,' ').trim();
    // a bar read as a letter between the number and a full name ("15 I Liam Ó Conghaile")
    if(no) nm=nm.replace(/^[Il1]\s+(?=\S+\s+\S)/,'');
    // one long word with a capital inside it is two words that touched ("JohnMaher")
    if(nm&&!/\s/.test(nm)){ const k=/^([A-ZÀ-Þ][a-zß-ÿ]{2,})([A-ZÀ-Þ][a-zß-ÿ'’]+.*)$/.exec(nm); if(k&&!NOSPLIT.test(k[1])) nm=k[1]+' '+k[2]; }
    // a numbered name: a word read with a small first letter gets its capital ("Paddy small"), particles and Irish prefixes aside
    if(no&&/\s/.test(nm)) nm=nm.split(' ').map((w,i)=>(/^[a-zß-ÿ][a-zß-ÿ'’-]{3,}$/.test(w)&&!PARTICLE.test(w)||i===0&&/^[a-zß-ÿ]{2,}/.test(w)&&!PARTICLE.test(w))?w.charAt(0).toUpperCase()+w.slice(1):w).join(' ');
    return (no+nm).trim();
  }
  R._tidyRead=tidyRead;
  // an unnumbered recognised line that cannot be a name: no word of three letters, or one short unsure scrap
  function notName(t, conf){
    const w=t.split(/\s+/).map(x=>x.replace(/[^A-Za-zÀ-ɏ]/g,'')).filter(Boolean), letters=w.join('').length;
    if(letters<4||!w.some(x=>x.length>=3)) return true;
    if(w.length===1&&(conf<50||letters<5)) return true;
    return w.length<=2&&conf<30&&letters<8;
  }
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
    // the rest of an officials line that the reader broke in two ("ROGHNÓIR: John Concannon, Mi" … "David Morris, Mickey Graham")
    const offs=(lines||[]).filter(l=>l&&l.box&&l.conf!=null&&RE_OFFICIAL_ANY.test(fold(String(l.text||'')).trim()));
    const besideOfficial=l=>l.box&&l.conf!=null&&offs.some(q=>q!==l&&q.page===l.page&&l.box.x0>=q.box.x1&&Math.abs((q.box.y0+q.box.y1)-(l.box.y0+l.box.y1))/2<0.5*Math.max(q.box.y1-q.box.y0, l.box.y1-l.box.y0));
    (lines||[]).forEach(l=>{
      const raw=String(l.text==null?'':l.text);
      if(l.inbox||l.outside){ if(/[A-Za-zÀ-ɏ0-9]/.test(raw)) drop(raw, l.inbox?'inbox':'outside'); return; }
      if(l.tail) drop(l.tail+'  (after “'+raw.trim()+'”)', 'club');
      // table rules and stray marks an image reader picks up
      let cells=raw.split('\t').map(c=>c.replace(/[|¦]/g,' ').replace(/^[\s_~=•·*»«›‹]+|[\s_~=•·*»«›‹]+$/g,'').replace(/^[-–—.]+\s+|\s+[-–—]+$/g,'').replace(/ {2,}/g,' ')).filter(Boolean);
      let t=cells.join('\t');
      if(!/[A-Za-zÀ-ɏ0-9]/.test(t)){ if(raw.trim()) drop(raw,'marks'); return; }
      // a two-language heading ("Fir Ionaid / Subs") is passed on as the one word the parser knows
      if(RE_SUBS2.test(fold(t).trim())||(/^fir\s*i?onai?d\s*:?$/.test(fold(t).trim())&&!/^fir ionaid\s*:?$/.test(fold(t).trim()))){ keep.push({text:'Subs', conf:null, box:l.box, page:l.page, heading:true}); return; }
      const f=fold(t).trim(), numbered=lineNo(t)!=null||cells.length>1;
      // "BAINISTEOIR: …" / "Manager: …" wherever it stands in the line, and with its first letter lost to the reader
      if(RE_OFFICIAL_ANY.test(f)) return drop(raw,'official');
      if(!numbered&&!isNumTok(t)&&!RE_KEEP.test(f)){
        if(RE_OFFICIAL.test(f)||RE_OFFICIAL_IN.test(f)) return drop(raw,'official');
        if(teams.some(x=>teamMatch(t,x))||isFixture(t,teams)) return drop(raw,'team');
        if(RE_POSITION.test(f)) return drop(raw,'position');
        if(RE_EVENT.test(f)) return drop(raw,'event');
        if(besideOfficial(l)) return drop(raw,'official');
        if(l.under) return drop(raw,'under');
        if(l.cut) return drop(raw,'cut');
        if(l.above) return drop(raw,'above');
      }
      // "7 Jack Coyne (Ballyhaunis)" / "(Capt.)" → the note in brackets goes; "Name (7)" is a number and stays
      if(!RE_KEEP.test(f)){
        cells=cells.map(c=>stripRole(c).replace(RE_BRACKET,'').trim()).filter(Boolean);
        const t2=cells.join('\t');
        if(!/[A-Za-zÀ-ɏ0-9]/.test(t2)) return drop(raw,'bracket');
        t=t2;
      }
      // recognised text only (a picture, not a PDF's own text): the marks a reader leaves around a name
      if(l.conf!=null&&!RE_KEEP.test(f)){
        // beside a numbered name, a cell that is only a stray number or a scrap of a letter or two (a mark at the page edge)
        let cs=t.split('\t').map(tidyRead).filter(Boolean);
        if(cs.length>1&&lineNo(cs[0])!=null) cs=cs.filter((c,i)=>i===0||!(isNumTok(c)||c.replace(/[^A-Za-zÀ-ɏ]/g,'').length<3));
        t=cs.join('\t');
        if(!t||(!numbered&&!isNumTok(t)&&notName(t, l.conf))) return drop(raw,'marks');
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
    // recognised text: a number by itself that the reader was not even sure of is a stray mark (a sure one stays, for the parser's "Not read" list)
    for(let i=out.length-1;i>=0;i--){ if(out[i].conf!=null&&out[i].conf<LOW&&isNumTok(out[i].text)){ drop(out[i].text,'marks'); out.splice(i,1); } }
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
  // how many different numbered players a layout holds (per column, so two teams count twice)
  // (counted on a copy after the formation numbering, so a formation whose numbers were partly unreadable still counts)
  const players=lay=>(lay.columns||[]).reduce((t,c)=>{ const L=c.lines.map(l=>Object.assign({},l)); if(lay.free){ nameBlocks(L); formationNumbers(L); }
    return t+new Set(L.map(l=>l.no).filter(n=>n!=null&&n>=1&&n<=40)).size; },0);
  R._players=players;
  // rows of a free layout that hold two or more numbered players of the same team
  const sideBySide=lay=>(lay.columns||[]).reduce((t,c)=>{ const L=c.lines.filter(l=>l.no!=null&&l.no<=40&&l.box); let rows=0; const seen=new Set();
    L.forEach(a=>{ if(seen.has(a)) return; const row=L.filter(b=>Math.abs((b.box.y0+b.box.y1)-(a.box.y0+a.box.y1))/2<0.6*Math.max(a.box.y1-a.box.y0,b.box.y1-b.box.y0)); row.forEach(b=>seen.add(b)); if(row.length>=2) rows++; });
    return t+rows; },0);
  // compose([{n, words, glue, skew}], {homeTeam, awayTeam}) → {lists:[{lines, box, page}], assign, spanning, extra, more}
  function compose(pages, o){
    o=o||{};
    let columns=[], spanning=[], extra=[];
    (pages||[]).forEach(p=>{
      let lay=p.layout||layout(p.words, {glue:p.glue, skew:p.skew});
      // a formation page (players in rows of 1 / 3 / 3 / 2 / 3 / 3) has no columns to find: when reading it without
      // columns gives clearly more numbered players, that reading is used
      // … or when it shows numbered players side by side on a row within one team (a formation) and finds as many
      if(!p.layout&&p.free!==false&&!p.glue){ const fr=freeLayout(p.words, {skew:p.skew}), a=players(lay), b=players(fr); if(b>=8&&(b>=a+2||(b>=a-1&&sideBySide(fr)>=3))) lay=fr; }
      // a page of name boxes (jersey + three lines): the boxes were found in the picture and read one by one
      if(p.boxes&&p.boxes.length>=R.BOXMIN){ const bl=boxLayout(p.words, p.boxes, {skew:p.skew}); if(bl){ lay=bl; p.stats=bl.stats; } }
      p.model=lay.boxed?'boxes':lay.free?'free':'columns';
      // a crop box: a line touching an edge of it was cut through by the box
      if(p.width) lay.columns.forEach(c=>c.lines.forEach(l=>{ if(l.box&&(l.box.x0<=3||l.box.x1>=p.width-3||l.box.y0<=2||(p.height&&l.box.y1>=p.height-2))) l.cut=true; }));
      if(p.cuts&&p.cuts.length) lay.columns.concat([{lines:lay.spanning||[]}]).forEach(c=>c.lines.forEach(l=>{ if(l.box&&p.cuts.some(q=>q.xc>=l.box.x0-1&&q.xc<=l.box.x1+1&&q.yc>=l.box.y0-1&&q.yc<=l.box.y1+1)) l.cut=true; }));
      const tag=l=>{ l.page=p.n; return l; };
      lay.columns.forEach(c=>columns.push({lines:c.lines.map(tag), notes:c.notes, boxed:c.boxed}));
      lay.spanning.forEach(l=>spanning.push(tag(l)));
      (lay.extra||[]).forEach(c=>c.lines.forEach(l=>extra.push(tag(l))));
    });
    const lists=splitTeams(columns, [o.homeTeam, o.awayTeam], {fixed:(pages||[]).length===1&&(pages[0].model==='free'||pages[0].model==='boxes')});
    return {lists:lists.slice(), more:lists.more||0, assign:assignTeams(lists, spanning, o.homeTeam, o.awayTeam), spanning, extra};
  }
  R.compose=compose;
  // A formation page is read row by row, so its numbers arrive as 1, 2 3 4, … and a three-column bench as 16 20 24,
  // 17 21 25 …; the editor's parser needs them in order (everything after a number above 15 is a sub). When a list of
  // numbered players is out of order, the players are put in number order; an unnumbered line stays behind the
  // numbered line it followed. Lists already in order, or with numbers repeated, are left exactly as they are.
  function byNumber(lines){
    const no=x=>lineNo(x.text), nums=lines.map(no).filter(n=>n!=null);
    if(nums.length<8) return lines;
    let inv=0; for(let i=1;i<nums.length;i++) if(nums[i]<nums[i-1]) inv++;
    if(!inv||new Set(nums).size<nums.length-1) return lines;
    const head=[], groups=[]; let subs=null, cur=null;
    lines.forEach(x=>{ const f=fold(x.text).trim();
      if(x.heading||RE_SUBSF.test(f)&&no(x)==null){ subs=subs||x; return; }
      if(RE_STARTF.test(f)) return;
      if(no(x)!=null){ cur={n:no(x), L:[x]}; groups.push(cur); } else if(cur) cur.L.push(x); else head.push(x); });
    groups.forEach((g,i)=>{ g.i=i; }); groups.sort((a,b)=>a.n-b.n||a.i-b.i);
    const out=head.slice(); let put=false;
    groups.forEach(g=>{ if(subs&&!put&&g.n>15){ out.push(subs); put=true; } g.L.forEach(x=>out.push(x)); });
    return out;
  }
  R.byNumber=byNumber;
  // One list cleaned for one team → {text, lines:[{text, confidence, low}], confidence, dropped, adopted, joined, box, page}
  function finish(list, o){
    o=o||{};
    let placed=[];
    if(list&&list.boxed){ list.lines.forEach(l=>{ if(l.under) delete l.under; if(l.above) delete l.above; }); }
    else if(list){ nameBlocks(list.lines); placed=formationNumbers(list.lines);
      // a list of numbered players: an unnumbered line above its first number is a title or heading, not a player
      // (not when numbers stand on lines of their own — there a name may come before its number)
      const L=list.lines, first=L.findIndex(l=>l.no!=null&&l.no<=40);
      L.forEach(l=>{ if(l.above) delete l.above; });
      if(first>0&&L.filter(l=>l.no!=null&&l.no<=40).length>=8&&!L.some(l=>isNumTok(l.text))) L.slice(0,first).forEach(l=>{ if(l.no==null) l.above=true; });
    }
    const c=cleanLines(list?list.lines:[], {teams:[o.homeTeam, o.awayTeam], known:o.known});
    c.lines=byNumber(c.lines);
    const lines=c.lines.map(l=>({text:l.text, confidence:l.conf, low:l.conf!=null&&l.conf<LOW, box:l.box, page:l.page}));
    const cf=lines.map(l=>l.confidence).filter(v=>v!=null);
    return {text:lines.map(l=>l.text).join('\n'), lines, confidence:cf.length?Math.round(cf.reduce((a,b)=>a+b,0)/cf.length):null,
      dropped:c.dropped, adopted:c.adopted, joined:c.joined, placed, notes:(list&&list.notes)||[], boxed:!!(list&&list.boxed), box:list?list.box:null, page:list?list.page:undefined};
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

  // ── 5. crop and rotate: the geometry of a crop box ────────────
  // The picture (W×H original pixels) is first given `turn` quarter turns clockwise (0–3). On that turned picture a
  // region is a box with centre (cx,cy), size w×h, tilted by `angle` degrees (clockwise on screen, y downward):
  //   region = {turn, cx, cy, w, h, angle}
  // The crop is what the box holds, levelled: crop pixel (u,v), 0≤u≤w, 0≤v≤h, with u running along the box's top edge.
  const G=R.geom={};
  const rad=d=>d*Math.PI/180;
  G.turned=(W,H,turn)=>((turn&1)?{w:H,h:W}:{w:W,h:H});
  // a point of the turned picture ↔ the same point of the original
  G.toSource=(x,y,W,H,turn)=>{ switch(((turn%4)+4)%4){ case 1: return [y, H-x]; case 2: return [W-x, H-y]; case 3: return [W-y, x]; default: return [x,y]; } };
  G.fromSource=(x,y,W,H,turn)=>{ switch(((turn%4)+4)%4){ case 1: return [H-y, x]; case 2: return [W-x, H-y]; case 3: return [y, W-x]; default: return [x,y]; } };
  // crop pixel (u,v) → the point of the turned picture it shows
  G.cropPoint=(r,u,v)=>{ const a=rad(r.angle||0), c=Math.cos(a), s=Math.sin(a), dx=u-r.w/2, dy=v-r.h/2; return [r.cx+dx*c-dy*s, r.cy+dx*s+dy*c]; };
  // … and the point of the ORIGINAL picture it shows
  G.cropToSource=(r,u,v,W,H)=>{ const p=G.cropPoint(r,u,v); return G.toSource(p[0],p[1],W,H,r.turn||0); };
  // a point of the turned picture → where it lies in the box (u,v)
  G.local=(r,x,y)=>{ const a=rad(r.angle||0), c=Math.cos(a), s=Math.sin(a), dx=x-r.cx, dy=y-r.cy; return [dx*c+dy*s+r.w/2, -dx*s+dy*c+r.h/2]; };
  G.corners=r=>[[0,0],[r.w,0],[r.w,r.h],[0,r.h]].map(p=>G.cropPoint(r,p[0],p[1]));
  G.inside=(r,TW,TH,eps)=>{ eps=eps==null?0.5:eps; return G.corners(r).every(p=>p[0]>=-eps&&p[1]>=-eps&&p[0]<=TW+eps&&p[1]<=TH+eps); };
  // The canvas transform [a,b,c,d,e,f] (x' = a·x + c·y + e, y' = b·x + d·y + f) that draws the ORIGINAL picture so
  // that the box fills a canvas of (w·scale)×(h·scale): original pixel → crop pixel × scale.
  G.matrix=(r,W,H,scale)=>{
    const k=scale||1, a=rad(r.angle||0), c=Math.cos(a), s=Math.sin(a);
    // turned = Q·src + q0
    const Q=[[1,0,0,1,0,0],[0,1,-1,0,H,0],[-1,0,0,-1,W,H],[0,-1,1,0,0,W]][(((r.turn||0)%4)+4)%4];
    // crop = k·( Rot(−a)·(turned − centre) + (w/2,h/2) )
    const m=[k*c, -k*s, k*s, k*c, k*(r.w/2-(c*r.cx+s*r.cy)), k*(r.h/2-(-s*r.cx+c*r.cy))];
    return [m[0]*Q[0]+m[2]*Q[1], m[1]*Q[0]+m[3]*Q[1], m[0]*Q[2]+m[2]*Q[3], m[1]*Q[2]+m[3]*Q[3], m[0]*Q[4]+m[2]*Q[5]+m[4], m[1]*Q[4]+m[3]*Q[5]+m[5]];
  };
  G.MIN=40;                                        // the smallest side of a box, in picture pixels (callers may ask for more)
  // The box pulled back inside the picture: shrunk about its centre if it must be, never below the smallest size.
  G.fit=(r,TW,TH,min)=>{
    min=min||G.MIN; const o=Object.assign({},r);
    o.w=Math.max(min,Math.min(o.w,TW*2)); o.h=Math.max(min,Math.min(o.h,TH*2));
    o.cx=Math.max(0,Math.min(TW,o.cx)); o.cy=Math.max(0,Math.min(TH,o.cy));
    if(G.inside(o,TW,TH)) return o;
    // first slide it in, if it is small enough to fit as it is
    const cs=G.corners(o), x0=Math.min.apply(null,cs.map(p=>p[0])), x1=Math.max.apply(null,cs.map(p=>p[0])), y0=Math.min.apply(null,cs.map(p=>p[1])), y1=Math.max.apply(null,cs.map(p=>p[1]));
    if(x1-x0<=TW&&y1-y0<=TH){ o.cx+=x0<0?-x0:(x1>TW?TW-x1:0); o.cy+=y0<0?-y0:(y1>TH?TH-y1:0); if(G.inside(o,TW,TH)) return o; }
    let lo=0, hi=1; const at=k=>Object.assign({},o,{w:Math.max(min,o.w*k), h:Math.max(min,o.h*k)});
    for(let i=0;i<24;i++){ const mid=(lo+hi)/2; if(G.inside(at(mid),TW,TH)) lo=mid; else hi=mid; }
    return at(lo);
  };
  // the furthest step from a good box `from` towards `to` that is still inside the picture (dragging stops at the edge)
  G.towards=(from,to,TW,TH)=>{
    if(G.inside(to,TW,TH)) return to;
    const mix=k=>{ const o=Object.assign({},to); ['cx','cy','w','h'].forEach(p=>{ o[p]=from[p]+(to[p]-from[p])*k; }); return o; };
    let lo=0, hi=1; for(let i=0;i<20;i++){ const mid=(lo+hi)/2; if(G.inside(mix(mid),TW,TH)) lo=mid; else hi=mid; }
    return mix(lo);
  };
  // Dragging a handle: which = 'move' or a mix of n/s/e/w; (dx,dy) = how far the pointer has moved on the turned
  // picture since the drag began at box `r0`. The opposite edge stays where it is.
  G.drag=(r0,which,dx,dy,TW,TH,min)=>{
    min=min||G.MIN; const o=Object.assign({},r0);
    if(which==='move'){ o.cx=r0.cx+dx; o.cy=r0.cy+dy;
      // slide along the edge rather than stop dead
      const tryX=G.towards(r0,Object.assign({},r0,{cx:o.cx}),TW,TH); const both=G.towards(tryX,Object.assign({},tryX,{cy:o.cy}),TW,TH); return both; }
    const a=rad(r0.angle||0), c=Math.cos(a), s=Math.sin(a), lx=dx*c+dy*s, ly=-dx*s+dy*c;       // the movement in the box's own directions
    let u0=0, u1=r0.w, v0=0, v1=r0.h;
    if(which.indexOf('w')>=0) u0=Math.min(u1-min, u0+lx);
    if(which.indexOf('e')>=0) u1=Math.max(u0+min, u1+lx);
    if(which.indexOf('n')>=0) v0=Math.min(v1-min, v0+ly);
    if(which.indexOf('s')>=0) v1=Math.max(v0+min, v1+ly);
    const mid=G.cropPoint(r0,(u0+u1)/2,(v0+v1)/2);
    o.w=u1-u0; o.h=v1-v0; o.cx=mid[0]; o.cy=mid[1];
    return G.towards(r0,o,TW,TH);
  };
  // the starting boxes: one over the whole picture (a small margin in), or the left and right halves
  G.initial=(TW,TH,two)=>{
    const m=Math.round(0.02*Math.min(TW,TH));
    if(!two) return [{cx:TW/2, cy:TH/2, w:TW-2*m, h:TH-2*m, angle:0}];
    return [{cx:TW/4+m/4, cy:TH/2, w:TW/2-1.5*m, h:TH-2*m, angle:0}, {cx:3*TW/4-m/4, cy:TH/2, w:TW/2-1.5*m, h:TH-2*m, angle:0}];
  };
  // a quarter turn of the whole picture carries a box with it (dir = +1 clockwise, −1 anticlockwise)
  G.turnBox=(r,TW,TH,dir)=>{ const o=Object.assign({},r); if(dir>0){ o.cx=TH-r.cy; o.cy=r.cx; } else { o.cx=r.cy; o.cy=TW-r.cx; } o.w=r.h; o.h=r.w; return o; };
  // how much to enlarge a crop so its text is big enough to read: the long side is brought to `long`, at most `maxUp`×
  G.cropScale=(r,long,maxUp)=>Math.min(maxUp||3, long/Math.max(r.w,r.h));

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
  const LIMIT=R.LIMIT={pdfMB:60, imageMB:40, pages:40, pick:6, long:2000, viewLong:1600, pixels:60e6, cropLong:2000, cropUp:3};
  // Tesseract page segmentation. 6 ("one block of text") is tried first: it keeps a narrow column of jersey
  // numbers attached to the names. If that finds few numbered lines (a busy page: adverts, pictures), 3
  // ("automatic") is tried as well and whichever found more numbered lines is used.
  R.PSM=['6','3'];
  // The readings of one picture: page layout 6 with the engine's plain threshold, then with its local (Sauvola)
  // threshold, which copes with glare and shadow. Measured on the real programme photo and the test documents.
  R.PASSES=[{tessedit_pageseg_mode:'6', thresholding_method:'0'}, {tessedit_pageseg_mode:'6', thresholding_method:'2'}];
  R.FALLBACK={tessedit_pageseg_mode:'3', thresholding_method:'0'};
  let SCAN=1.5; R._scan=v=>{ SCAN=v; };
  const numbered=words=>Math.max(R._players(R.layout(words)), R._players(R.freeLayout(words)));

  function err(code, msg){ const e=new Error(msg); e.code=code; e.reader=true; return e; }   // .reader: one of ours, with a message fit to show
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
    unreadable:()=>'This picture could not be read automatically. Try cropping to one team\u2019s list, or paste / type the list.',
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
  // Light text on a dark banner ("7 Seán Kelly" in white on maroon) is what the text reader does worst. Every shape
  // that is clearly darker than its wide surroundings and big enough to be a banner or a number box is inverted,
  // together with the small shapes inside it (its letters, and the hollows of those letters), so that all the text
  // of the picture ends up dark on light. A shadow or a dark page is not "darker than its surroundings" and is left
  // alone, as are letters, rules and anything thin. Works on (and returns) a grey canvas; a plain page is unchanged.
  function flipDark(work, o){
    o=o||{};
    const w=work.width, h=work.height, g=work.getContext('2d'), im=g.getImageData(0,0,w,h), d=im.data, n=w*h, L=Math.max(w,h), W1=w+1;
    const r=Math.max(8, Math.round(L*(o.win||1/12))), k=o.k||0.75, I=new Float64Array(W1*(h+1)), bin=new Uint8Array(n);
    for(let y=0;y<h;y++){ let s=0; const row=(y+1)*W1, up=y*W1; for(let x=0;x<w;x++){ s+=d[4*(y*w+x)]; I[row+x+1]=I[up+x+1]+s; } }
    let dark=0;
    for(let y=0;y<h;y++){ const y0=Math.max(0,y-r), y1=Math.min(h,y+r+1); for(let x=0;x<w;x++){ const x0=Math.max(0,x-r), x1=Math.min(w,x+r+1);
      const m=(I[y1*W1+x1]-I[y0*W1+x1]-I[y1*W1+x0]+I[y0*W1+x0])/((y1-y0)*(x1-x0)); if(d[4*(y*w+x)]<k*m){ bin[y*w+x]=1; dark++; } } }
    // connected shapes of one kind (dark or light), numbered in reading order of their first pixel
    const lab=new Int32Array(n), par=[0], find=x=>{ while(par[x]!==x){ par[x]=par[par[x]]; x=par[x]; } return x; };
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const i=y*w+x, b=bin[i], A=x&&bin[i-1]===b?lab[i-1]:0, U=y&&bin[i-w]===b?lab[i-w]:0;
      if(A&&U){ const a=find(A), q=find(U); if(a!==q) par[Math.max(a,q)]=Math.min(a,q); lab[i]=Math.min(a,q); } else if(A||U) lab[i]=A||U; else { par.push(par.length); lab[i]=par.length-1; } }
    const N=par.length, area=new Uint32Array(N), x0=new Int32Array(N).fill(1e9), x1=new Int32Array(N).fill(-1), y0=new Int32Array(N).fill(1e9), y1=new Int32Array(N).fill(-1), nb=new Int32Array(N).fill(-1), pol=new Uint8Array(N);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const i=y*w+x, c=find(lab[i]); lab[i]=c; if(!area[c]){ pol[c]=bin[i]; nb[c]=x?lab[i-1]:(y?lab[i-w]:-1); } area[c]++; if(x<x0[c]) x0[c]=x; if(x>x1[c]) x1[c]=x; if(y<y0[c]) y0[c]=y; if(y>y1[c]) y1[c]=y; }
    const big=L/60, small=L/25, flip=new Uint8Array(N); let any=0;
    for(let c=1;c<N;c++){ if(area[c]&&pol[c]===1&&area[c]>=big*big&&(x1[c]-x0[c])>=1.2*big&&(y1[c]-y0[c])>=1.2*big){ flip[c]=1; any++; } }
    if(!any) return {canvas:work, flipped:0};
    for(let c=1;c<N;c++){ if(area[c]&&!flip[c]&&nb[c]>0&&flip[nb[c]]&&(x1[c]-x0[c])<small*3&&(y1[c]-y0[c])<small) flip[c]=2; }
    const out=new Uint8ClampedArray(n); let fl=0; for(let i=0;i<n;i++){ const p=d[4*i]; if(flip[lab[i]]){ out[i]=255-p; fl++; } else out[i]=p; }
    // where an inverted shape meets one left alone both sides are now light: the thin edge line between them is wiped
    for(let y=2;y<h-2;y++) for(let x=2;x<w-2;x++){ const i=y*w+x, f=flip[lab[i]]?1:0;
      if(((flip[lab[i-2]]?1:0)!==f)||((flip[lab[i+2]]?1:0)!==f)||((flip[lab[i-2*w]]?1:0)!==f)||((flip[lab[i+2*w]]?1:0)!==f)){ if(out[i]<225) out[i]=225; } }
    for(let i=0;i<n;i++){ const q=4*i; d[q]=d[q+1]=d[q+2]=out[i]; }
    g.putImageData(im,0,0);
    return {canvas:work, flipped:fl/n};
  }
  R._flipDark=flipDark;
  // The box of a region cut from the ORIGINAL pixels, levelled, and enlarged so its text is big enough to read
  // (a crop of one page of a programme is a small part of the photo; reading it at 2000 px makes its letters larger).
  function cropCanvas(src, W, H, region, long, maxUp){
    const k=R.geom.cropScale(region, long||LIMIT.cropLong, maxUp||LIMIT.cropUp), c=canvasOf(region.w*k, region.h*k), g=c.getContext('2d'), m=R.geom.matrix(region, W, H, c.width/region.w);
    g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height); g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high';
    g.setTransform(m[0],m[1],m[2],m[3],m[4],m[5]); g.drawImage(src,0,0); g.setTransform(1,0,0,1,0,0);
    return c;
  }
  R._crop=cropCanvas;

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
    }catch(e){ close(); if(e&&e.reader) throw e; throw err('cdn', MSG.cdn()); }
    st.phase='ready'; st.last=Date.now();
    return { langs, _worker:worker,
      // The picture is read more than once and the readings merged word by word (R.mergeWords): R.PASSES, in order.
      // If few numbered lines come out (a busy page: adverts, pictures), the automatic page layout is tried as well
      // and used if it finds more.
      async read(canvas, page, of){
        const fd=R.FLIP===false?{canvas, flipped:0}:flipDark(canvas); this.flipped=fd.flipped;
        const plan=[].concat(R.PASSES), got=[]; let words=[];
        const run=async(i, total, params)=>{ W.page=page; W.of=of; W.base=i/total; W.span=1/total; prog({stage:'read', pct:W.base, page, of}); return this.pass(fd.canvas, params); };
        for(let i=0;i<plan.length;i++){ got.push(await run(i, plan.length+0.5, plan[i])); }
        words=got.length>1?R.mergeWords(got):(got[0]||[]); this.mode=plan.map(p=>p.tessedit_pageseg_mode).join('+');
        if(numbered(words)<10&&R.FALLBACK){ const ws=await run(plan.length, plan.length+1, R.FALLBACK); if(numbered(ws)>numbered(words)){ words=ws; this.mode=R.FALLBACK.tessedit_pageseg_mode; } }
        st.phase='ready';
        return words;
      },
      // one pass with given Tesseract parameters → positioned words
      async pass(canvas, params){
        st.phase='read'; st.last=Date.now();
        await job.race(Promise.race([failed, worker.setParameters(params||{})]));
        const r=await job.race(Promise.race([failed, worker.recognize(canvas, {}, {text:true, blocks:true, hocr:false, tsv:false})]));
        st.phase='ready';
        const d=r&&r.data||{}; let ws=[], ln=0;                                  // .ln: which of the engine's own lines a word is on
        (d.blocks||[]).forEach(b=>(b.paragraphs||[]).forEach(p=>(p.lines||[]).forEach(l=>{ ln++; (l.words||[]).forEach(w=>{ if(w&&w.bbox) ws.push({text:w.text, conf:w.confidence, x0:w.bbox.x0, y0:w.bbox.y0, x1:w.bbox.x1, y1:w.bbox.y1, ln}); }); })));
        if(!ws.length&&d.words) ws=d.words.filter(w=>w&&w.bbox).map(w=>({text:w.text, conf:w.confidence, x0:w.bbox.x0, y0:w.bbox.y0, x1:w.bbox.x1, y1:w.bbox.y1}));
        return ws;
      },
      async set(params){ await job.race(Promise.race([failed, worker.setParameters(params||{})])); },
      close };
  }

  // ── a page of name boxes (jersey + three lines): each box read by itself ──
  // the lowest of the colour channels: a white box on green grass is light, the grass is not
  function minChannel(view){ const d=view.getContext('2d').getImageData(0,0,view.width,view.height).data, o=new Uint8Array(view.width*view.height); for(let i=0,j=0;j<o.length;i+=4,j++){ const a=d[i], b=d[i+1], c=d[i+2]; o[j]=a<b?(a<c?a:c):(b<c?b:c); } return o; }
  // a part of the picture enlarged k times, in grey (stretch: to full contrast; inv: light on dark turned dark on light)
  function zoomed(view, b, k, o){
    o=o||{}; const x0=Math.max(0,Math.round(b.x0)), y0=Math.max(0,Math.round(b.y0)), x1=Math.min(view.width,Math.round(b.x1)), y1=Math.min(view.height,Math.round(b.y1));
    const c=canvasOf((x1-x0)*k,(y1-y0)*k), g=c.getContext('2d'); g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high'; g.drawImage(view, x0,y0,x1-x0,y1-y0, 0,0,c.width,c.height);
    const im=g.getImageData(0,0,c.width,c.height), d=im.data, n=c.width*c.height, grey=new Uint8Array(n); let lo=255, hi=0;
    for(let i=0,j=0;j<n;i+=4,j++){ const v=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8; grey[j]=v; if(v<lo) lo=v; if(v>hi) hi=v; }
    const sp=hi-lo; for(let i=0,j=0;j<n;i+=4,j++){ let v=grey[j]; if(o.stretch&&sp>20) v=Math.round((v-lo)*255/sp); if(o.inv) v=255-v; grey[j]=v; d[i]=d[i+1]=d[i+2]=v; d[i+3]=255; }
    g.putImageData(im,0,0);
    return {canvas:c, grey, w:c.width, h:c.height, x0, y0, k:c.width/Math.max(1,x1-x0), ky:c.height/Math.max(1,y1-y0)};
  }
  const backTo=(z, ws)=>ws.map(v=>{ const s=R.strokeWidth(z.grey, z.w, z.h, v); return {text:v.text, conf:v.conf, ln:v.ln, x0:z.x0+v.x0/z.k, x1:z.x0+v.x1/z.k, y0:z.y0+v.y0/z.ky, y1:z.y0+v.y1/z.ky, sw:s?s.sw/z.k:null}; });
  const P6={tessedit_pageseg_mode:'6', thresholding_method:'0', tessedit_char_whitelist:''};
  // the number on the jersey over a box: the middle of the jersey, enlarged, digits only, as it is and inverted → {no, conf} | null
  async function readJersey(eng, view, b){
    const w=b.x1-b.x0, h=b.y1-b.y0, cx=(b.x0+b.x1)/2, zone={x0:cx-0.17*w, x1:cx+0.17*w, y0:b.y0-0.68*h, y1:b.y0-0.04*h};
    if(zone.y0<0||zone.x0<0||zone.x1>view.width) return null;
    const z=zoomed(view, zone, Math.max(2, Math.min(6, 150/Math.max(1,zone.y1-zone.y0))), {stretch:true}); if(R._dbg) b.jdbg=[dbg(z)];
    const d=R.digitBlob(z.grey, z.w, z.h); if(!d) return null;
    // only the digit shapes, black on white, at a size the reader likes
    const c0=canvasOf(d.w,d.h), g0=c0.getContext('2d'), im=g0.createImageData(d.w,d.h); for(let i=0;i<d.w*d.h;i++){ im.data[4*i]=im.data[4*i+1]=im.data[4*i+2]=d.px[i]; im.data[4*i+3]=255; } g0.putImageData(im,0,0);
    const k=72/d.h, c=canvasOf(d.w*k,d.h*k), g=c.getContext('2d'); g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high'; g.drawImage(c0,0,0,c.width,c.height);
    const ws=await eng.pass(c, {tessedit_pageseg_mode:'8', thresholding_method:'0', tessedit_char_whitelist:'0123456789'});
    let best=null; ws.forEach(v=>{ const t=String(v.text||'').trim(); if(/^\d{1,2}$/.test(t)&&+t>=1&&(!best||v.conf>best.conf)) best={no:+t, conf:v.conf}; });
    return best;
  }
  R.JERSEY=true; R.BOXES=true; R.SUBZOOM=true;
  const b64=u=>{ let t=''; for(let i=0;i<u.length;i+=8192) t+=String.fromCharCode.apply(null,u.subarray(i,i+8192)); return btoa(t); };
  const dbg=(z,ws)=>({w:z.w, h:z.h, k:z.k, x0:z.x0, y0:z.y0, grey:b64(z.grey), words:ws||null});   // R._dbg: the measuring scripts keep what was read
  // pg = {words (the whole picture's), …}: finds the boxes, reads each one, the jerseys, and the subs list again enlarged → pg.boxes
  async function readBoxes(eng, view, work, pg){
    const t0=performance.now(), W=view.width, H=view.height, T={};
    const mc=minChannel(view); if(R._dbg) pg.mdbg={w:W, h:H, grey:b64(mc)};
    const cand=R.findBoxes(mc, W, H).boxes; pg.found=cand.length; T.find=Math.round(performance.now()-t0);
    if(cand.length<R.BOXMIN) return;
    const boxes=[]; let t=performance.now();
    for(const b of cand){ const hh=b.y1-b.y0, z=zoomed(view, {x0:b.x0+0.02*hh, y0:b.y0+0.02*hh, x1:b.x1-0.02*hh, y1:b.y1-0.02*hh}, Math.max(1.5, Math.min(4, 300/hh)));
      const raw=await eng.pass(z.canvas, P6); boxes.push({x0:b.x0, y0:b.y0, x1:b.x1, y1:b.y1, words:backTo(z, raw), jersey:null}); if(R._dbg) boxes[boxes.length-1].dbg=dbg(z, raw); }
    T.boxes=Math.round(performance.now()-t);
    if(boxes.filter(b=>{ const L=R.boxLines(b.words); return L.length>=2&&L.length<=4; }).length<R.BOXMIN){ await eng.set({tessedit_char_whitelist:''}); return; }
    t=performance.now();
    if(R.JERSEY){ for(const b of boxes) b.jersey=await readJersey(eng, view, b); await eng.set({tessedit_char_whitelist:''}); }
    T.jersey=Math.round(performance.now()-t); t=performance.now();
    // the numbered list (the subs) again, enlarged and by itself: its letters are small on the whole page
    const zone=R.SUBZOOM?R.subsZone(pg.words, boxes, W, H):null;
    if(zone){ const z=zoomed(view, zone, Math.max(1.3, Math.min(3, 1900/(zone.x1-zone.x0)))), raw=await eng.pass(z.canvas, P6), ws=backTo(z, raw); if(R._dbg) pg.zdbg=dbg(z, raw);
      pg.words=pg.words.filter(w=>{ const xc=(w.x0+w.x1)/2, yc=(w.y0+w.y1)/2; return !(xc>=zone.x0&&xc<=zone.x1&&yc>=zone.y0&&yc<=zone.y1); }).concat(ws); pg.zone=zone; }
    else { const g=work.getContext('2d').getImageData(0,0,work.width,work.height).data, grey=new Uint8Array(work.width*work.height); for(let i=0,j=0;j<grey.length;i+=4,j++) grey[j]=g[i];
      pg.words.forEach(w=>{ const s=R.strokeWidth(grey, work.width, work.height, w); w.sw=s?s.sw:null; }); }
    T.subs=Math.round(performance.now()-t);
    pg.boxes=boxes; pg.boxTimes=T;
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
    catch(e){ if(e&&e.reader) throw e; const n=String(e&&e.name||'');
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
      const pages=[], engines=[]; let usedRegions=null;
      // The crop boxes: given (o.regions), or asked for (o.adjust) once the picture is open; null = read the whole picture.
      //   region = {side:'home'|'away'|'', turn, cx, cy, w, h, angle} on the picture after `turn` quarter turns (R.geom)
      const askRegions=async(image, info)=>{
        const W=info.width||image.width, H=info.height||image.height;
        let regs=Array.isArray(o.regions)&&o.regions.length?o.regions:null;
        if(!regs&&typeof o.adjust==='function'){ regs=await job.race(Promise.resolve(o.adjust(Object.assign({image, width:W, height:H, name:String(file.name||'')}, info)))); if(!regs||!regs.length) throw err('cancel', MSG.cancel()); }
        if(!regs) return null;
        return regs.map(g=>{ const t=R.geom.turned(W,H,g.turn||0); return Object.assign({side:g.side||''}, R.geom.fit({turn:((g.turn||0)%4+4)%4, cx:+g.cx, cy:+g.cy, w:+g.w, h:+g.h, angle:Math.max(-45,Math.min(45,+g.angle||0))}, t.w, t.h)); });
      };
      // each box cut from the original pixels, levelled, enlarged, read by itself → one "page" per box
      const readRegions=async(src, W, H, regs)=>{
        const eng=await getOcr();
        for(let i=0;i<regs.length;i++){ const view=cropCanvas(src, W, H, regs[i]), work=greyStretch(view); await tick();
          const words=await eng.read(work, i+1, regs.length);
          const pg={n:i+1, method:'ocr', words, image:view, scale:1, side:regs[i].side, flipped:eng.flipped, width:view.width, height:view.height};
          if(R.BOXES) await readBoxes(eng, view, work, pg);
          pages.push(pg); }
        usedRegions=regs;
      };
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
            if(engines.indexOf('pdf')<0) engines.push('pdf');
            // exact text needs no cropping; "Crop / choose area" (o.cropText) lets the user box the list(s) on the page
            const regs=pick.length===1&&o.cropText?await askRegions(r.canvas, {page:n, text:true}):null;
            if(regs){ regs.forEach((g,i)=>{ const q=R.geom.fit(Object.assign({},g,{angle:0, turn:0}), r.canvas.width, r.canvas.height), bx={x0:(q.cx-q.w/2)/r.scale, y0:(q.cy-q.h/2)/r.scale, x1:(q.cx+q.w/2)/r.scale, y1:(q.cy+q.h/2)/r.scale};
                const ws=p.words.filter(w=>{ const xc=(w.x0+w.x1)/2, yc=(w.y0+w.y1)/2; return xc>=bx.x0&&xc<=bx.x1&&yc>=bx.y0&&yc<=bx.y1; }).map(w=>Object.assign({},w,{x0:w.x0-bx.x0, x1:w.x1-bx.x0, y0:w.y0-bx.y0, y1:w.y1-bx.y0}));
                // a word inside the box that runs on into a word outside it: that line was cut through by the box
                const inb=w=>{ const xc=(w.x0+w.x1)/2, yc=(w.y0+w.y1)/2; return xc>=bx.x0&&xc<=bx.x1&&yc>=bx.y0&&yc<=bx.y1; }, outs=p.words.filter(w=>!inb(w));
                const cuts=p.words.filter(w=>inb(w)&&outs.some(v=>{ const hh=Math.max(w.y1-w.y0, v.y1-v.y0); return Math.abs((v.y0+v.y1)-(w.y0+w.y1))/2<0.5*hh&&(v.x0>=w.x0?v.x0-w.x1:w.x0-v.x1)<0.6*hh; })).map(w=>({xc:(w.x0+w.x1)/2-bx.x0, yc:(w.y0+w.y1)/2-bx.y0}));
                const img=cropCanvas(r.canvas, r.canvas.width, r.canvas.height, q, LIMIT.viewLong, 2);
                pages.push({n:i+1, pdfPage:n, method:'text', words:ws, glue:true, skew:false, image:img, scale:img.width/(bx.x1-bx.x0), side:g.side, cuts}); }); usedRegions=regs; }
            else pages.push({n, method:'text', words:p.words, layout:p.layout, image:r.canvas, scale:r.scale});
          } else {
            // a scanned page is drawn larger than it is read, then reduced like a photo (sharper than drawing it at size)
            const r=await job.race(renderPage(p.page, LIMIT.long*SCAN));
            if(engines.indexOf('ocr')<0) engines.push('ocr');
            const regs=pick.length===1?await askRegions(r.canvas, {page:n}):null;
            if(regs){ await readRegions(r.canvas, r.canvas.width, r.canvas.height, regs); pages.forEach(x=>{ x.pdfPage=n; }); }
            else { const pr=prepare(r.canvas, r.canvas.width, r.canvas.height), eng=await getOcr(), words=await eng.read(pr.work, k, pick.length);
              pages.push({n, method:'ocr', words, image:pr.view, scale:1}); }
          }
        }
      } else {
        if(file.size>LIMIT.imageMB*1048576) throw err('big', MSG.bigimage());
        prog({stage:'load', pct:0, engine:'ocr'});
        const src=await job.race(decode(file, kind)), sw=src.width||src.naturalWidth, sh=src.height||src.naturalHeight;
        if(!sw||!sh) throw err('image', MSG.image());
        engines.push('ocr');
        const regs=await askRegions(src, {page:1, width:sw, height:sh});
        if(regs) await readRegions(src, sw, sh, regs);
        else { const pr=prepare(src, sw, sh); await tick(); const eng=await getOcr(), words=await eng.read(pr.work, 1, 1); pages.push({n:1, method:'ocr', words, image:pr.view, scale:1}); }
        if(src.close) src.close();
      }
      prog({stage:'layout', pct:1});
      R._last=pages;                                 // for the tests: the positioned words of the last read
      const ctx={homeTeam:o.homeTeam, awayTeam:o.awayTeam, known:o.known||{}};
      const side=o.side==='home'||o.side==='away'?o.side:'both';
      let comp, res;
      const boxed=usedRegions&&pages.length===2&&side==='both'&&pages.every(p=>p.side==='home'||p.side==='away')&&pages[0].side!==pages[1].side;
      if(boxed){
        // one box per team: each box is that team's list (the one that matches its heading, else the first, if a box holds two)
        const comps=pages.map(p=>R.compose([p], ctx)); comp={lists:[], more:0, extra:[]};
        const dealBoxes=sides=>{ const r={home:null, away:null}; pages.forEach((p,i)=>{ const d=R.deal(comps[i], sides[i], ctx); r[sides[i]]=d[sides[i]]; }); return r; };
        const sides=pages.map(p=>p.side); res=dealBoxes(sides); res.assign={first:sides[0], why:'boxes'}; res.lists=2; res.boxed=true;
        if(!['home','away'].some(s=>res[s]&&res[s].lines.length)) throw err('empty', MSG.empty());
        res.redeal=first=>{ const sd=first===sides[0]?sides:[sides[1],sides[0]], r=dealBoxes(sd); res.home=r.home; res.away=r.away; res.assign={first, why:first===sides[0]?'boxes':'chosen'}; return res; };
      } else {
        comp=R.compose(pages, ctx); res=R.deal(comp, side, ctx);
        if(!comp.lists.length||!['home','away'].some(s=>res[s]&&res[s].lines.length)) throw err('empty', MSG.empty());
        res.redeal=first=>{ const r=R.deal(comp, side, Object.assign({first}, ctx)); res.home=r.home; res.away=r.away; res.assign=r.assign; return res; };
      }
      const methods=[...new Set(pages.map(p=>p.method))];
      res.pages=pages.map(p=>({n:p.n, method:p.method, image:p.image, scale:p.scale, side:p.side, model:p.model, pdfPage:p.pdfPage, stats:p.stats, boxTimes:p.boxTimes}));
      res.regions=usedRegions; res.pdfPages=kind==='pdf'?[...new Set(pages.map(p=>p.pdfPage||p.n))]:null;
      res.more=comp.more; res.extra=comp.extra.length;
      res.source={name:String(file.name||''), kind:kind==='pdf'?'pdf':'image', method:methods.length>1?'mixed':methods[0],
        engine:engines.map(e=>LIB[e].name+' '+LIB[e].ver).join(' + '), langs:ocr?ocr.langs:[]};
      return res;
    } catch(e){
      if(e&&e.reader) throw e;
      try{ console.error('[team sheet reader]', e); }catch(_){}
      const x=err('unreadable', MSG.unreadable()); x.cause=e; throw x;
    } finally { job.end(); }
  };
  R._lab={decode, sniff, newJob, ocrOpen, greyStretch, canvasOf};   // for the measuring scripts in the tests
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
.cohts-prow.cohrd-low{background:rgba(245,158,11,.13);box-shadow:inset 3px 0 0 var(--orange,#f59e0b);}
.cohts-prow.cohrd-low span::after{content:'  ⚠ check';color:var(--orange,#f59e0b);font-size:10.5px;white-space:nowrap;}
.cohrd-full{position:fixed;inset:0;z-index:10040;background:rgba(0,0,0,.85);overflow:auto;padding:44px 8px 8px;box-sizing:border-box;-webkit-overflow-scrolling:touch;}
.cohrd-full canvas{display:block;margin:0 auto;background:#fff;}
.cohrd-full .cohts-btn{position:fixed;top:8px;right:8px;z-index:1;}

.cohrd-adj{position:fixed;inset:0;top:0;right:0;bottom:0;left:0;z-index:10050;background:#0b0d14;display:flex;flex-direction:column;color:var(--t1,#eee);font:500 13px Barlow,sans-serif;-webkit-user-select:none;user-select:none;overflow:hidden;}
.cohrd-adj-hd{display:flex;gap:10px;align-items:center;padding:9px 12px;border-bottom:1px solid var(--border,#333);background:var(--panel,#1e1e28);flex:none;}
.cohrd-adj-hd div{flex:1;min-width:0;line-height:1.35;color:var(--t2,#aaa);font-size:12px;}
.cohrd-adj-hd b{display:block;color:var(--t1,#eee);font:700 15px 'Barlow Condensed',sans-serif;letter-spacing:.5px;text-transform:uppercase;}
.cohrd-adj-body{flex:1;min-height:0;display:flex;}
.cohrd-adj-wrap{flex:1;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;padding:14px;overflow:hidden;}
.cohrd-adj-stage{position:relative;touch-action:none;background:#000;box-shadow:0 0 0 1px #000,0 6px 30px rgba(0,0,0,.6);flex:none;}
.cohrd-adj-stage>canvas{display:block;width:100%;height:100%;}
.cohrd-adj-box{position:absolute;box-sizing:border-box;border:2px solid var(--c,#4fc3f7);cursor:move;touch-action:none;background:
  repeating-linear-gradient(to bottom,transparent 0,transparent 30px,rgba(0,0,0,.4) 30px,rgba(0,0,0,.4) 31px,rgba(255,255,255,.7) 31px,rgba(255,255,255,.7) 32px);box-shadow:0 0 0 1px rgba(0,0,0,.7),inset 0 0 0 1px rgba(0,0,0,.45);}
.cohrd-adj-box:not(.on){background:none;opacity:.8;}
.cohrd-adj-box.on{border-width:3px;z-index:2;}
.cohrd-adj-tag{position:absolute;left:-2px;top:-2px;transform:translateY(-100%);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--c,#4fc3f7);color:var(--ct,#fff);font:700 12px 'Barlow Condensed',sans-serif;letter-spacing:.6px;padding:2px 8px;border-radius:5px 5px 0 0;pointer-events:none;}
.cohrd-adj-box.low .cohrd-adj-tag{top:auto;bottom:-2px;transform:translateY(100%);border-radius:0 0 5px 5px;}
.cohrd-adj-h{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;touch-action:none;display:none;}
.cohrd-adj-box.on .cohrd-adj-h{display:block;}
.cohrd-adj-h::after{content:'';position:absolute;left:10px;top:10px;width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid var(--c,#4fc3f7);box-shadow:0 0 0 1px rgba(0,0,0,.8);box-sizing:border-box;}
.cohrd-adj-h[data-h="nw"]{left:0;top:0;cursor:nwse-resize}.cohrd-adj-h[data-h="n"]{left:50%;top:0;cursor:ns-resize}.cohrd-adj-h[data-h="ne"]{left:100%;top:0;cursor:nesw-resize}
.cohrd-adj-h[data-h="w"]{left:0;top:50%;cursor:ew-resize}.cohrd-adj-h[data-h="e"]{left:100%;top:50%;cursor:ew-resize}
.cohrd-adj-h[data-h="sw"]{left:0;top:100%;cursor:nesw-resize}.cohrd-adj-h[data-h="s"]{left:50%;top:100%;cursor:ns-resize}.cohrd-adj-h[data-h="se"]{left:100%;top:100%;cursor:nwse-resize}
.cohrd-adj-side{flex:none;width:320px;box-sizing:border-box;padding:12px;border-left:1px solid var(--border,#333);background:var(--panel,#1e1e28);overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:10px;}
.cohrd-adj-tabs{display:flex;gap:6px;align-items:stretch;}
.cohrd-adj-tab{flex:1;min-width:0;border:2px solid var(--c,#4fc3f7);background:transparent;color:var(--t1,#eee);border-radius:7px;padding:6px 8px;font:700 13px 'Barlow Condensed',sans-serif;letter-spacing:.5px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cohrd-adj-tab.on{background:var(--c,#4fc3f7);color:var(--ct,#fff);}
.cohrd-adj-lbl{font:700 10.5px 'Barlow Condensed',sans-serif;letter-spacing:.7px;text-transform:uppercase;color:var(--t3,#888);}
.cohrd-adj-prev{position:relative;background:#fff;border:1px solid var(--border,#333);border-radius:6px;overflow:hidden;height:190px;display:flex;align-items:center;justify-content:center;}
.cohrd-adj-prev canvas{max-width:100%;max-height:100%;display:block;}
.cohrd-adj-prev i{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;background:repeating-linear-gradient(to bottom,transparent 0,transparent 18px,rgba(79,195,247,.55) 18px,rgba(79,195,247,.55) 19px);}
.cohrd-adj-tilt{display:flex;gap:6px;align-items:center;}
.cohrd-adj-tilt input[type=range]{flex:1;min-width:0;height:28px;accent-color:var(--accent,#4fc3f7);}
.cohrd-adj-tilt output{width:46px;text-align:right;font:700 13px 'Barlow Condensed',sans-serif;color:var(--t1,#eee);}
.cohrd-adj-row{display:flex;gap:6px;flex-wrap:wrap;}
.cohrd-adj-row .cohts-btn{flex:1;white-space:nowrap;}
.cohrd-adj-go{display:flex;gap:8px;margin-top:auto;padding:8px 0 2px;position:-webkit-sticky;position:sticky;bottom:-12px;background:var(--panel,#1e1e28);z-index:1;}
.cohrd-adj-go .cohts-btn{flex:1;padding:9px 10px;font-size:14px;}
.cohrd-adj-hint{font-size:11.5px;line-height:1.4;color:var(--t2,#aaa);}
@media (max-width:900px),(max-aspect-ratio:1/1){
.cohrd-adj-body{flex-direction:column;}
.cohrd-adj-wrap{padding:24px 8px 10px;flex:1 1 50%;}
.cohrd-adj-side{width:auto;border-left:0;border-top:1px solid var(--border,#333);flex:0 1 auto;max-height:50%;padding:9px 10px 10px;gap:8px;}
.cohrd-adj-go{bottom:-10px;}
.cohrd-adj-prev{height:120px;}
.cohrd-adj-hint{display:none;}
}
@media (max-width:520px){ .cohrd-adj-hd div span{display:none;} .cohrd-adj-prev{height:96px;} .cohrd-adj-lbl{font-size:9.5px;} }
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
  function failure(host, message, retry){
    host.innerHTML=''; const b=el('<div class="cohrd-box"><div class="cohrd-err"></div><div class="cohrd-row"><button class="cohts-btn" type="button" data-a="ok">OK</button>'+(retry?'<button class="cohts-btn" type="button" data-a="retry">✂ Adjust the crop and try again</button>':'')+'</div></div>');
    b.querySelector('.cohrd-err').textContent='⚠ '+message; b.querySelector('[data-a="ok"]').onclick=()=>{ host.innerHTML=''; };
    if(retry) b.querySelector('[data-a="retry"]').onclick=retry; host.appendChild(b);
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


  // ── the adjust screen: crop box(es) and rotation, before anything is read ──
  // adjust(info, opt) → Promise<[{side, turn, cx, cy, w, h, angle}] | null>  (null = cancelled)
  //   info = {image (drawable, original pixels), width, height, text (a PDF's own text: crop only, no tilt)}
  //   opt  = {boxes:[{side, name, color}], saved:{turn, boxes:[{side,cx,cy,w,h,angle}]}, onState(state)}
  // The picture is shown after `turn` quarter turns; each box is drawn over it, tilted by its own angle (the page of
  // an open programme lies at its own slant), with guide lines that are level when the box is. Mouse and touch both
  // go through pointer events; a box cannot leave the picture or shrink below a small size.
  const G=R.geom;
  const lum=c=>{ const m=/^#?([0-9a-f]{6})$/i.exec(String(c||'').trim()); if(!m) return 0; const n=parseInt(m[1],16); return (0.299*(n>>16)+0.587*((n>>8)&255)+0.114*(n&255))/255; };
  function adjustScreen(info, opt){
    css();
    return new Promise(resolve=>{
      const W=info.width, H=info.height, two=opt.boxes.length>1, noTilt=!!info.text;
      let turn=0, T=G.turned(W,H,turn), boxes, act=0, scale=1, raf=0;
      const fresh=()=>G.initial(T.w,T.h,two).map((b,i)=>Object.assign(b,{side:opt.boxes[i].side}));
      const sv=opt.saved;
      if(sv&&sv.boxes&&sv.boxes.length===opt.boxes.length&&sv.w===W&&sv.h===H){ turn=sv.turn||0; T=G.turned(W,H,turn); boxes=sv.boxes.map(b=>Object.assign({},G.fit(b,T.w,T.h),{side:b.side})); }
      else boxes=fresh();
      const meta=side=>opt.boxes.find(b=>b.side===side)||opt.boxes[0];
      const minSide=()=>Math.max(G.MIN, 0.06*Math.min(T.w,T.h));
      const ov=el(`<div class="cohrd-adj" role="dialog" aria-modal="true" aria-label="Choose the area to read">
        <div class="cohrd-adj-hd"><div><b>${two?'Put a box on each team':'Put the box on '+esc(opt.boxes[0].name)}</b><span>Drag ${two?'each box over one team’s list':'the box over the list'} (starters and subs), pull its corners to fit${noTilt?'':', then tilt it until the guide lines run along the lines of names'}. Only what is inside ${two?'a box':'the box'} is read.</span></div>
          <button class="cohts-btn" type="button" data-a="cancel" aria-label="Cancel">✕</button></div>
        <div class="cohrd-adj-body">
          <div class="cohrd-adj-wrap"><div class="cohrd-adj-stage"><canvas></canvas></div></div>
          <div class="cohrd-adj-side">
            ${two?'<div><div class="cohrd-adj-lbl">Box to adjust</div><div class="cohrd-adj-tabs"></div></div>':''}
            <div><div class="cohrd-adj-lbl">How it will be read${noTilt?'':' — the names should sit level on the lines'}</div><div class="cohrd-adj-prev"><canvas></canvas><i></i></div></div>
            ${noTilt?'':`<div><div class="cohrd-adj-lbl">Tilt of this box</div><div class="cohrd-adj-tilt"><button class="cohts-btn" type="button" data-a="t-" aria-label="Tilt 0.1° anticlockwise">−</button><input type="range" min="-15" max="15" step="0.1" value="0" aria-label="Tilt in degrees"><button class="cohts-btn" type="button" data-a="t+" aria-label="Tilt 0.1° clockwise">+</button><output>0.0°</output></div></div>
            <div class="cohrd-adj-row"><button class="cohts-btn" type="button" data-a="q-" title="Turn the whole picture a quarter turn left">⟲ 90°</button><button class="cohts-btn" type="button" data-a="q+" title="Turn the whole picture a quarter turn right">⟳ 90°</button><button class="cohts-btn" type="button" data-a="level">Level (0°)</button></div>`}
            <div class="cohrd-adj-row">${two?'<button class="cohts-btn" type="button" data-a="swap">⇄ Swap the teams</button>':''}<button class="cohts-btn" type="button" data-a="reset">Reset</button></div>
            <div class="cohrd-adj-hint">${two?'The two pages of an open programme usually lie at different slants — each box has its own tilt. ':''}A tighter box makes the letters larger for the reader, which is what helps most. Leave out crests, adverts and the managers’ lines if you can.</div>
            <div class="cohrd-adj-go"><button class="cohts-btn pri" type="button" data-a="go">Read</button><button class="cohts-btn" type="button" data-a="cancel">Cancel</button></div>
          </div></div></div>`);
      const wrap=ov.querySelector('.cohrd-adj-wrap'), stage=ov.querySelector('.cohrd-adj-stage'), cv=stage.querySelector('canvas'), prev=ov.querySelector('.cohrd-adj-prev canvas'),
        range=ov.querySelector('input[type=range]'), outp=ov.querySelector('output'), tabs=ov.querySelector('.cohrd-adj-tabs');
      // the turned picture, drawn once per turn at screen size
      function drawPicture(){
        const k=Math.min(1, 1600/Math.max(T.w,T.h)); cv.width=Math.round(T.w*k); cv.height=Math.round(T.h*k);
        const g=cv.getContext('2d'), m=G.matrix({turn, cx:T.w/2, cy:T.h/2, w:T.w, h:T.h, angle:0}, W, H, cv.width/T.w);
        g.fillStyle='#fff'; g.fillRect(0,0,cv.width,cv.height); g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high';
        g.setTransform(m[0],m[1],m[2],m[3],m[4],m[5]); g.drawImage(info.image,0,0); g.setTransform(1,0,0,1,0,0);
      }
      function size(){ const cw=wrap.clientWidth-(parseFloat(getComputedStyle(wrap).paddingLeft)||0)*2, ch=wrap.clientHeight-(parseFloat(getComputedStyle(wrap).paddingTop)||0)-(parseFloat(getComputedStyle(wrap).paddingBottom)||0);
        scale=Math.max(0.01, Math.min(cw/T.w, ch/T.h)); stage.style.width=Math.round(T.w*scale)+'px'; stage.style.height=Math.round(T.h*scale)+'px'; }
      function paint(){
        boxes.forEach((b,i)=>{ let d=stage.querySelector('.cohrd-adj-box[data-i="'+i+'"]');
          if(!d){ d=el('<div class="cohrd-adj-box" data-i="'+i+'"><span class="cohrd-adj-tag"></span>'+['nw','n','ne','w','e','sw','s','se'].map(h=>'<i class="cohrd-adj-h" data-h="'+h+'"></i>').join('')+'</div>'); stage.appendChild(d); }
          const m=meta(b.side); d.style.setProperty('--c', m.color); d.style.setProperty('--ct', lum(m.color)>0.62?'#111':'#fff');
          d.style.left=(100*(b.cx-b.w/2)/T.w)+'%'; d.style.top=(100*(b.cy-b.h/2)/T.h)+'%'; d.style.width=(100*b.w/T.w)+'%'; d.style.height=(100*b.h/T.h)+'%';
          d.style.transform='rotate('+(b.angle||0)+'deg)'; d.classList.toggle('on', i===act); d.classList.toggle('low', (b.cy-b.h/2)*scale<22);
          d.querySelector('.cohrd-adj-tag').textContent=m.name; d.setAttribute('aria-label', 'Crop box for '+m.name); });
        if(tabs) tabs.innerHTML=boxes.map((b,i)=>{ const m=meta(b.side); return '<button type="button" class="cohrd-adj-tab'+(i===act?' on':'')+'" data-tab="'+i+'" style="--c:'+esc(m.color)+';--ct:'+(lum(m.color)>0.62?'#111':'#fff')+'">'+esc(m.name)+'</button>'; }).join('');
        if(range){ range.value=String(boxes[act].angle||0); outp.textContent=(boxes[act].angle>0?'+':'')+(+boxes[act].angle||0).toFixed(1)+'°'; }
        if(opt.onState) opt.onState(state());
        if(!raf) raf=requestAnimationFrame(()=>{ raf=0; preview(); });
      }
      function preview(){ const b=boxes[act], c=R._crop(info.image, W, H, Object.assign({turn}, b), 520, 1.5); prev.width=c.width; prev.height=c.height; prev.getContext('2d').drawImage(c,0,0); }
      const state=()=>({w:W, h:H, turn, boxes:boxes.map(b=>({side:b.side, cx:b.cx, cy:b.cy, w:b.w, h:b.h, angle:b.angle||0}))});
      const setAngle=a=>{ a=Math.max(-15, Math.min(15, Math.round(a*10)/10)); boxes[act]=Object.assign({}, G.fit(Object.assign({}, boxes[act], {angle:a}), T.w, T.h, minSide()), {side:boxes[act].side}); paint(); };
      // dragging: the box body moves it, a handle pulls that edge or corner
      let drag=null;
      stage.addEventListener('pointerdown',ev=>{
        const bx=ev.target.closest('.cohrd-adj-box'); if(!bx) return; ev.preventDefault();
        act=+bx.dataset.i; const h=ev.target.closest('.cohrd-adj-h');
        drag={id:ev.pointerId, x:ev.clientX, y:ev.clientY, which:h?h.dataset.h:'move', r0:Object.assign({}, boxes[act])};
        try{ stage.setPointerCapture(ev.pointerId); }catch(_){}
        paint();
      });
      stage.addEventListener('pointermove',ev=>{ if(!drag||ev.pointerId!==drag.id) return; ev.preventDefault();
        const side=boxes[act].side; boxes[act]=Object.assign(G.drag(drag.r0, drag.which, (ev.clientX-drag.x)/scale, (ev.clientY-drag.y)/scale, T.w, T.h, minSide()), {side}); paint(); });
      const up=ev=>{ if(drag&&ev.pointerId===drag.id){ drag=null; try{ stage.releasePointerCapture(ev.pointerId); }catch(_){} } };
      stage.addEventListener('pointerup',up); stage.addEventListener('pointercancel',up);
      if(range) range.addEventListener('input',()=>setAngle(+range.value));
      const done=v=>{ window.removeEventListener('resize', onResize); document.removeEventListener('keydown', key, true); if(raf) cancelAnimationFrame(raf); ov.remove(); resolve(v); };
      const onResize=()=>{ size(); paint(); };
      const key=ev=>{ if(ev.key==='Escape'){ ev.stopPropagation(); ev.preventDefault(); done(null); } };
      ov.addEventListener('click',ev=>{
        const tb=ev.target.closest('[data-tab]'); if(tb){ act=+tb.dataset.tab; paint(); return; }
        const a=ev.target.closest('[data-a]'); if(!a) return; const k=a.dataset.a;
        if(k==='cancel') return done(null);
        if(k==='go') return done(boxes.map(b=>Object.assign({turn}, b)));
        if(k==='t-'||k==='t+') return setAngle((+boxes[act].angle||0)+(k==='t+'?0.1:-0.1));
        if(k==='level') return setAngle(0);
        if(k==='swap'){ const s0=boxes[0].side; boxes[0].side=boxes[1].side; boxes[1].side=s0; return paint(); }
        if(k==='reset'){ boxes=fresh(); act=0; return paint(); }
        if(k==='q+'||k==='q-'){ const dir=k==='q+'?1:-1, old=T; turn=((turn+dir)%4+4)%4; T=G.turned(W,H,turn);
          boxes=boxes.map(b=>Object.assign({}, G.fit(G.turnBox(b, old.w, old.h, dir), T.w, T.h, minSide()), {side:b.side})); drawPicture(); size(); return paint(); }
      });
      document.addEventListener('keydown', key, true); window.addEventListener('resize', onResize);
      document.body.appendChild(ov);
      ov._adj={state, set:(i,b)=>{ boxes[i]=Object.assign({}, G.fit(Object.assign({}, boxes[i], b), T.w, T.h, minSide()), {side:boxes[i].side}); act=i; paint(); }, scale:()=>scale};
      drawPicture(); size(); paint(); requestAnimationFrame(()=>{ size(); paint(); });
    });
  }
  R._adjust=adjustScreen;

  // attach(ctx, file, opt) — opt.readjust: open the adjust screen with the boxes of the last read of this file;
  // opt.cropText: let the user box the list on a PDF that has its own text; opt.pages: the PDF pages already chosen
  R.attach=function(ctx, file, opt){
    try{ return attach(ctx, file, opt||{}); }
    catch(e){ try{ console.error('[team sheet reader]', e); }catch(_){} const h=ctx&&ctx.card&&(ctx.side?colHost(ctx, ctx.side):topHost(ctx.card)); if(h) failure(h, R.MSG.unreadable()); return Promise.resolve(null); }
  };
  function attach(ctx, file, opt){
    css();
    const card=ctx.card, both=!ctx.side, sides=both?['home','away']:[ctx.side];
    const host=both?topHost(card):colHost(ctx, ctx.side);
    if(!host) return;
    const game=ctx.game||{}, colour=s=>(s==='home'?game.homeColor:game.awayColor)||(s==='home'?'#2563eb':'#22c55e');
    // the boxes of the last read of this same file with this same control, kept on the editor card for "Re-adjust"
    const fkey=[file.name, file.size, file.lastModified, both?'both':ctx.side].join('|');
    const mem=card._cohrdAdj&&card._cohrdAdj.key===fkey?card._cohrdAdj:(card._cohrdAdj={key:fkey, state:null});
    const again=o2=>R.attach(ctx, file, o2);
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

    const srcText=res=>{ const s=res.source||{}, pg=res.pdfPages||(res.pages||[]).map(p=>p.n);
      const how=s.method==='text'?'the exact text in the PDF':s.method==='mixed'?'PDF text and text recognition':'text recognition on this device'+((s.langs||[]).length?((s.langs.indexOf('gle')>=0)?' (English + Irish)':' (English only — the Irish data could not be loaded, so fadas may be missed)'):'');
      return '“'+(s.name||'the file')+'”'+(s.kind==='pdf'&&pg.length?', page'+(pg.length>1?'s ':' ')+pg.join(', '):'')+' — '+how; };
    // "Re-adjust" after a read from boxes; "Crop / choose area" after a PDF's own text (which skips the adjust screen)
    const tools=res=>res.regions?`<div class="cohrd-row"><button class="cohts-btn" type="button" data-a="readjust" title="Back to the crop boxes, kept as they were">✂ Re-adjust the crop and read again</button></div>`
      :((res.source||{}).method==='text'&&(res.pdfPages||[]).length===1?`<div class="cohrd-row"><button class="cohts-btn" type="button" data-a="croptext" title="Draw a box round the list on the page">✂ Crop / choose area</button><span>if the wrong part of the page was read</span></div>`:'');
    function colPanel(side, r, res){
      const h=colHost(ctx, side); if(!h) return; h.innerHTML=''; lowKeys[side]=new Set();
      if(!r) return;
      const low=r.lines.filter(l=>l.low);
      low.forEach(l=>T.parsePaste(l.text,{known:ctx.known(side)}).rows.forEach(x=>lowKeys[side].add(x.no+'|'+T.nameKey(x.name))));
      const b=el(`<div class="cohrd-box"><div class="cohrd-top"><div><b>${r.lines.length} line${r.lines.length===1?'':'s'} read for ${esc(team(side))}</b>${both?'':' from '+esc(srcText(res))}${r.confidence!=null?' · average certainty '+r.confidence+'%':''}.
          Nothing is in the sheet yet — check the preview above against the picture, then press <b>Replace this sheet</b> or <b>Add to this sheet</b>.</div><button class="cohts-x" type="button" data-a="close" title="Close the picture">✕</button></div>
        ${!both&&res.lists>1?`<div class="cohrd-note">This file holds two team lists; the ${res.assign.first===side?'first':'second'} one is shown${res.assign.why==='headings'?' (matched by the team name on the sheet)':' — check it is the right team'}. <button class="cohts-btn" type="button" data-a="other">Use the other list</button></div>`:''}
        ${low.length?`<div class="cohrd-flag">⚠ Check ${low.length===1?'this line':'these '+low.length+' lines'} against the picture — the reader was less sure of ${low.length===1?'it':'them'}: <span>${low.map(l=>esc(l.text.replace(/\t/g,' '))+' ('+Math.round(l.confidence)+'%)').join(' · ')}</span></div>`:''}
        ${r.placed&&r.placed.length?`<div class="cohrd-note">The number${r.placed.length===1?'':'s'} <b>${r.placed.join(', ')}</b> could not be read and ${r.placed.length===1?'was':'were'} worked out from the player’s place in the formation — check ${r.placed.length===1?'it':'them'}.</div>`:''}
        ${both?'':tools(res)}
        ${r.adopted&&r.adopted.length?`<div class="cohrd-note">Changed to this team's existing spelling: ${r.adopted.map(a=>'“'+esc(a.from)+'” → <b>'+esc(a.to)+'</b>').join(' · ')}</div>`:''}
        ${r.dropped&&r.dropped.length?`<details class="cohrd-note"><summary>Left out as not players (${r.dropped.length})</summary>${r.dropped.map(d=>esc(d.text.replace(/\t/g,' '))+' <i>— '+esc(d.why)+'</i>').join('<br>')}</details>`:''}
        </div>`);
      const v=viewer(res, r); if(v) b.appendChild(v);
      b.addEventListener('click',ev=>{ const a=ev.target.closest('[data-a]'); if(!a) return;
        if(a.dataset.a==='close'){ h.innerHTML=''; lowKeys[side]=new Set(); decorate(side); }
        else if(a.dataset.a==='other'){ swap(res); }
        else if(a.dataset.a==='readjust'){ again({readjust:true, pages:res.pdfPages||undefined}); }
        else if(a.dataset.a==='croptext'){ again({cropText:true, pages:res.pdfPages||undefined}); } });
      h.appendChild(b); if(v) v._show();
    }
    function topPanel(res){
      const h=topHost(card); if(!h||!both) return; h.innerHTML='';
      const a=res.assign||{first:'home', why:'default'}, other=a.first==='home'?'away':'home';
      const why={headings:'matched by the team names on the sheet', title:'going by the order of the names in the title — check', default:'the team names were not found on the sheet, so this is only a guess — check', chosen:'as you set it', boxes:'as the boxes were placed'}[a.why]||'';
      const two=res.lists>1;
      const b=el(`<div class="cohrd-box"><div class="cohrd-top"><div><b>Read ${esc(srcText(res))}.</b><br>
        ${two?`First (left / top) list → <b>${esc(team(a.first))}</b> · second list → <b>${esc(team(other))}</b> <span>(${why})</span>.`
             :`Only one team list was found; it is under <b>${esc(team(a.first))}</b>.`}
        ${res.more?'<br>The file holds more than two numbered lists — the two longest were used.':''}${res.extra?'<br>A column beside the names (clubs or positions) was left out.':''}
        <br>Nothing is in the sheets yet — check each preview against its picture, then press <b>Replace this sheet</b> or <b>Add to this sheet</b>.</div>
        <button class="cohts-x" type="button" data-a="close" title="Close">✕</button></div>
        <div class="cohrd-row"><button class="cohts-btn" type="button" data-a="swap">${two?'⇄ Swap — the first list is '+esc(team(other)):'Move it to '+esc(team(other))}</button></div>${tools(res)}</div>`);
      b.addEventListener('click',ev=>{ const x=ev.target.closest('[data-a]'); if(!x) return; const k=x.dataset.a;
        if(k==='close') h.innerHTML=''; else if(k==='readjust') again({readjust:true, pages:res.pdfPages||undefined}); else if(k==='croptext') again({cropText:true, pages:res.pdfPages||undefined}); else swap(res); });
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
      onProgress:p=>{ if(!done&&!ac.signal.aborted) progress(host, p, cancel); }, choosePages:info=>pagePicker(host, info, file.name), signal:ac.signal,
      pages:opt.pages, cropText:!!opt.cropText,
      // pictures and scanned pages: the crop / rotate screen first (R.ADJUST=false reads the whole picture at once)
      adjust:R.ADJUST===false?null:info=>{ host.innerHTML='';
        return adjustScreen(info, {boxes:sides.map(sd=>({side:sd, name:team(sd), color:colour(sd)})), saved:mem.state, onState:st=>{ mem.state=st; }})
          .then(regs=>{ if(regs&&!done&&!ac.signal.aborted) progress(host, {stage:'load', pct:0, engine:info.text?'pdf':'ocr'}, cancel); return regs; }); }};
    return Promise.resolve().then(()=>root.cohTeamSheetFromFile(file, o)).then(res=>{
      done=true; host.innerHTML=''; fill(res||{}); return res;
    }).catch(e=>{
      done=true; card.removeEventListener('input', onInput);
      if(e&&e.code==='cancel'){ host.innerHTML=''; return null; }
      // only the reader's own messages are shown; anything unexpected gets a plain message, with the detail in the console
      if(!(e&&e.reader)){ try{ console.error('[team sheet reader]', e); }catch(_){} }
      const canRetry=mem.state&&(!e||!e.reader||e.code==='empty'||e.code==='unreadable');
      failure(host, (e&&e.reader&&e.message)||R.MSG.unreadable(), canRetry?()=>again({readjust:true, pages:opt.pages}):null);
      return null;
    });
  }
})(typeof window!=='undefined'?window:globalThis);
