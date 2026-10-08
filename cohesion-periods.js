/* COHESION — game periods (shared helper)
 *
 * ONE copy of the rules that Analysis › Momentum, the dashboard and Code Room
 * all use to decide a game's level and to find EXTRA TIME THE FILE DOES NOT
 * MARK. Some Tracker files mark everything after half-time as "2nd Half", even
 * when the game went to extra time.
 *
 *   cohGameLevel(meta)   'club' | 'county'. A game of the club section is a
 *                        club game; otherwise it is a county game when both
 *                        teams are counties, else a club game.
 *   COH_HALF_MIN         the length of a half: club 30, county 35 minutes.
 *   cohPeriodOf(half)    which period an event's half label means:
 *                        'h1' | 'h2' | 'e1' | 'e2'.
 *   cohUnmarkedET(meta, events, h2, e1)
 *                        → {e1, e2} (times on the events' own time line, e2
 *                        may be null) or null.
 *       h2 = the caller's 2nd-half start; e1 = the caller's ET1 start from the
 *       marked events / the saved game setup (null = none).
 *       THE RULE: only when no event is marked as extra time and no ET start
 *       is known (e1 == null), a THROW-IN more than (half length + 5) minutes
 *       after the 2nd-half throw-in starts ET1, and the next THROW-IN at least
 *       5 minutes later starts ET2. A game without such a throw-in → null, so
 *       every caller behaves exactly as it did before for it.
 */
(function(root){
  const COH_COUNTIES=new Set(('ANTRIM ARMAGH CARLOW CAVAN CLARE CORK DERRY DONEGAL DOWN DUBLIN FERMANAGH GALWAY KERRY KILDARE KILKENNY LAOIS LEITRIM LIMERICK LONGFORD LOUTH MAYO MEATH MONAGHAN OFFALY ROSCOMMON SLIGO TIPPERARY TYRONE WATERFORD WESTMEATH WEXFORD WICKLOW LONDON').split(' ').concat(['NEW YORK']));
  const COH_HALF_MIN={county:35, club:30};
  const uc=s=>String(s||'').toUpperCase().trim();
  function cohGameLevel(meta){
    if(String((meta&&meta.section)||'').toLowerCase()==='club') return 'club';
    return [meta&&meta.homeTeam, meta&&meta.awayTeam].every(t=>COH_COUNTIES.has(uc(t)))?'county':'club';
  }
  function cohPeriodOf(half){
    const h=String(half||'');
    if(/ET/i.test(h)||/extra/i.test(h)) return /2nd|\b2\b|ET\s*2/i.test(h)?'e2':'e1';
    return /2nd|\b2H\b/i.test(h)?'h2':'h1';
  }
  function cohUnmarkedET(meta, events, h2, e1){
    if(e1!=null||h2==null) return null;
    const L=events||[], tOf=e=>(e.driveT??e.start)??0, isTI=e=>/THROW.?IN$/i.test(String(e.code||''));
    for(let i=0;i<L.length;i++){ const e=L[i]; if(!e) continue; const k=cohPeriodOf(e.half); if(k==='e1'||k==='e2') return null; }   // extra time IS marked
    const lim=h2+(COH_HALF_MIN[cohGameLevel(meta)]+5)*60; let x1=null, x2=null;
    L.forEach(e=>{ if(!e||!isTI(e)) return; const t=tOf(e); if(t>lim&&(x1==null||t<x1)) x1=t; });
    if(x1==null) return null;
    L.forEach(e=>{ if(!e||!isTI(e)) return; const t=tOf(e); if(t>=x1+300&&(x2==null||t<x2)) x2=t; });
    return {e1:x1, e2:x2};
  }
  const api={ COH_COUNTIES, COH_HALF_MIN, cohGameLevel, cohPeriodOf, cohUnmarkedET };
  Object.assign(root, api);
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
