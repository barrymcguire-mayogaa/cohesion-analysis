/* COHESION — video player seam.
 *
 * THE CONTRACT (audited Aug 2026: the complete set of player calls made
 * anywhere in the app — dashboard, Code Room, playlists):
 *
 *   getCurrentTime() -> seconds
 *   getDuration()    -> seconds
 *   seekTo(seconds, allowSeekAhead)
 *   playVideo() / pauseVideo()
 *   getPlayerState() -> 1 playing · 2 paused · 0 ended · -1 unknown
 *   loadVideoById({videoId, startSeconds, endSeconds})
 *   setPlaybackRate(rate)
 *
 * Every page keeps its player in a variable (YTP) and only ever calls these
 * eight methods. cohesionCreatePlayer() below is the ONLY place a concrete
 * provider is constructed. Adding a provider (Vimeo, …) means implementing
 * the contract IN THIS FILE and teaching the factory its name — no page
 * code changes. The YouTube provider hands back the YT.Player itself
 * (it natively implements the contract); other providers return a
 * hand-built adapter object.
 *
 *   cohesionCreatePlayer({
 *     provider: 'youtube' (default) | 'file',
 *     mount:    element id to build the player in,
 *     videoId:  (youtube) initial video — omit to construct empty and cue
 *               later via loadVideoById,
 *     url:      (file) object/blob URL of a local video file,
 *     playerVars: (youtube) passed through to the IFrame API,
 *     onReady(player): REQUIRED for youtube — the adapter arrives here
 *               (construction is async; the factory returns undefined).
 *               Optional for 'file', which ALSO returns the adapter
 *               synchronously.
 *     onStateChange(e): e.data uses the state codes above,
 *     onError(e): provider-specific error event.
 *   })
 */
(function(){
  'use strict';

  // ── YouTube IFrame API loader: single-flight, queue until ready ──
  let ytQueue=[], ytHooked=false;
  function withYT(fn){
    if(window.YT && window.YT.Player){ fn(); return; }
    ytQueue.push(fn);
    if(!ytHooked){
      ytHooked=true;
      const prev=window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady=function(){
        if(typeof prev==='function'){ try{ prev(); }catch(_){} }
        const q=ytQueue.slice(); ytQueue=[];
        q.forEach(f=>{ try{ f(); }catch(_){} });
      };
    }
    if(!document.querySelector('script[src*="youtube.com/iframe_api"]')){
      const s=document.createElement('script');
      s.src='https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  }

  // ── 'file' provider: a native <video> wrapped in the contract ──
  // (moved here from Code Room's local-session player; behaviour identical)
  function fileAdapter(opts){
    const mount=document.getElementById(opts.mount);
    if(!mount) return null;
    mount.innerHTML='';
    const v=document.createElement('video');
    v.src=opts.url; v.controls=false; v.preload='auto';
    v.style.cssText='width:100%;height:100%;background:#000;object-fit:contain;';
    v.addEventListener('click',()=>{ if(v.paused) v.play(); else v.pause(); });
    if(opts.onError) v.addEventListener('error',opts.onError);
    if(opts.onStateChange){
      v.addEventListener('play', ()=>opts.onStateChange({data:1}));
      v.addEventListener('pause',()=>opts.onStateChange({data:2}));
      v.addEventListener('ended',()=>opts.onStateChange({data:0}));
    }
    mount.appendChild(v);
    const adapter={
      getCurrentTime:()=>v.currentTime||0,
      getDuration:()=>v.duration||0,
      seekTo:t=>{ try{ v.currentTime=Math.max(0,t); }catch(_){} },
      playVideo:()=>{ v.play().catch(()=>{}); },
      pauseVideo:()=>v.pause(),
      getPlayerState:()=>v.paused?2:1,
      setPlaybackRate:r=>{ v.playbackRate=r; },
      loadVideoById:()=>{},   // single local file — nothing to switch to
      _el:v
    };
    if(opts.onReady){ setTimeout(()=>opts.onReady(adapter),0); }
    return adapter;
  }

  window.cohesionCreatePlayer=function(opts){
    opts=opts||{};
    if(opts.provider==='file') return fileAdapter(opts);
    // default: youtube
    withYT(function(){
      let p=null;
      const events={
        // p is assigned right after construction; ev.target covers the
        // (theoretical) synchronous-onReady case so the adapter is never null
        onReady:function(ev){ if(opts.onReady) opts.onReady(p||(ev&&ev.target)||null, ev); }
      };
      if(opts.onStateChange) events.onStateChange=opts.onStateChange;
      if(opts.onError) events.onError=opts.onError;
      const cfg={
        playerVars:opts.playerVars||{rel:0,modestbranding:1,enablejsapi:1,origin:window.location.origin},
        events:events
      };
      if(opts.videoId) cfg.videoId=opts.videoId;
      p=new YT.Player(opts.mount, cfg);
    });
    return undefined;   // youtube constructs asynchronously — take it in onReady
  };
})();
