/**
 * COHESION team band — a subtle fade of the section's team colours across the top bar, so every page shows whose
 * version of COHESION this is (Barry, Oct 2026). Display only: buttons, links and highlights stay COHESION blue.
 *
 * Load near the end of <body>, after cohesion-edit.js (for the section) where the page has it:
 *   <script src="crests/counties.js"></script>      (county colours; crests/index.js adds the clubs)
 *   <script src="cohesion-teamband.js"></script>
 * Not on Code Room: it already shows team colours on the tagging buttons, and the band would only distract.
 *
 * The section picks the team (SECTION_TEAMS). A section with no team set gets a plain COHESION-blue fade and its
 * own name. On a page without a <header> (the sign-in page) the fade sits behind the page from the top.
 * window.cohTeamBandPaint() repaints (the section switcher calls it through cohesionSetSection).
 */
(function () {
  'use strict';

  var SECTION_TEAMS = {
    county: { team: 'Mayo' },
    u20:    { team: 'Mayo', tag: 'U20' },
    club:   { team: null, label: 'Club' }      // the club this section is for: set its name here (colours come from crests/index.js)
  };
  var BLUE = { primary: '#4fc3f7', secondary: '#4fc3f7' };

  function slug(n) {
    return String(n == null ? '' : n).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }
  function coloursOf(team) {
    if (!team) return null;
    var s = slug(team), C = window.COHESION_COUNTY_COLOURS || {}, T = window.COHESION_TEAM_COLOURS || {};
    var c = C[s] || T[s];
    return c && c.primary ? { primary: c.primary, secondary: c.secondary || c.primary } : null;
  }
  function section() {
    try { if (window.cohesionSection) return window.cohesionSection() || 'county'; } catch (_) {}
    return 'county';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var css = document.createElement('style');
  css.textContent = [
    // the fade sits over the bar's own panel colour; the bar keeps its layout, borders and buttons
    'header.coh-band{background-image:linear-gradient(100deg,color-mix(in srgb,var(--tb-p) var(--tb-a),transparent) 0%,color-mix(in srgb,var(--tb-p) calc(var(--tb-a) * .45),transparent) 26%,transparent 58%) !important;}',
    'header.coh-band.coh-band-pos{position:relative;}',
    // a thin two-colour line along the bottom edge, fading out across the page
    'header.coh-band::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:3px;pointer-events:none;',
    '  background:linear-gradient(90deg,var(--tb-p) 0%,var(--tb-p) 9%,var(--tb-s) 9%,var(--tb-s) 13%,transparent 13%),',
    '             linear-gradient(90deg,transparent 13%,color-mix(in srgb,var(--tb-p) 70%,transparent) 13%,transparent 62%);}',
    '.coh-tb-chip{display:inline-flex;align-items:center;gap:7px;flex:none;padding:3px 10px 3px 4px;border-radius:999px;',
    '  font:700 12px/1 "Barlow Condensed",sans-serif;letter-spacing:1.6px;text-transform:uppercase;color:var(--t1,#f0f0f5);',
    '  background:color-mix(in srgb,var(--tb-p) 16%,transparent);border:1px solid color-mix(in srgb,var(--tb-p) 45%,transparent);white-space:nowrap;}',
    '.coh-tb-chip .coh-tb-dot{width:16px;height:16px;border-radius:50%;flex:none;background:linear-gradient(135deg,var(--tb-p) 0 55%,var(--tb-s) 55%);',
    '  box-shadow:0 0 0 1px rgba(255,255,255,.25);}',
    '.coh-tb-chip img{width:18px;height:18px;object-fit:contain;flex:none;}',
    '.coh-tb-chip .coh-tb-tag{padding:2px 5px;border-radius:4px;background:var(--tb-p);color:#fff;letter-spacing:1px;font-size:10px;}',
    '@media (max-width:520px){.coh-tb-chip .coh-tb-name{display:none;}.coh-tb-chip{padding:3px 4px;}}',
    // the sign-in page: no top bar, so a soft glow from the top of the page behind the card
    'body.coh-band-page::after{content:"";position:fixed;left:0;right:0;top:0;height:340px;pointer-events:none;z-index:0;',
    '  background:radial-gradient(ellipse 70% 100% at 50% 0%,color-mix(in srgb,var(--tb-p) calc(var(--tb-a) * 1.1),transparent) 0%,transparent 70%);}',
    'body.coh-band-page::before{z-index:0;}',
    '.coh-tb-top{position:fixed;left:0;right:0;top:0;height:4px;z-index:2;pointer-events:none;',
    '  background:linear-gradient(90deg,transparent 0%,var(--tb-p) 30%,var(--tb-s) 50%,var(--tb-p) 70%,transparent 100%);}',
    '.coh-tb-signin{display:flex;justify-content:center;margin-top:14px;}'
  ].join('\n');
  document.head.appendChild(css);

  function paint() {
    var sec = section(), cfg = SECTION_TEAMS[sec] || {}, col = coloursOf(cfg.team) || BLUE;
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    var root = document.documentElement.style;
    root.setProperty('--tb-p', col.primary);
    root.setProperty('--tb-s', col.secondary);
    root.setProperty('--tb-a', light ? '22%' : '44%');

    var name = cfg.team || cfg.label || sec;
    var crest = cfg.team && window.cohCrestSrc ? window.cohCrestSrc(cfg.team) : null;
    var chipHtml = (crest ? '<img alt="" src="' + esc(crest) + '">' : '<span class="coh-tb-dot"></span>')
      + '<span class="coh-tb-name">' + esc(name) + '</span>' + (cfg.tag ? '<span class="coh-tb-tag">' + esc(cfg.tag) + '</span>' : '');

    var hdr = document.querySelector('header');
    if (hdr) {
      hdr.classList.add('coh-band');
      if (getComputedStyle(hdr).position === 'static') hdr.classList.add('coh-band-pos');
      var chip = hdr.querySelector('.coh-tb-chip');
      if (!chip) {
        chip = document.createElement('span'); chip.className = 'coh-tb-chip';
        var after = hdr.querySelector('.logo-sub') || hdr.querySelector('.logo');
        if (after && after.parentNode === hdr) after.insertAdjacentElement('afterend', chip); else hdr.insertBefore(chip, hdr.firstChild);
      }
      chip.title = 'COHESION · ' + name + (cfg.tag ? ' ' + cfg.tag : '');
      chip.innerHTML = chipHtml;
      return;
    }
    // no top bar (sign-in page)
    document.body.classList.add('coh-band-page');
    if (!document.querySelector('.coh-tb-top')) { var top = document.createElement('div'); top.className = 'coh-tb-top'; document.body.appendChild(top); }
    var block = document.querySelector('.logo-block');
    if (block && !block.querySelector('.coh-tb-signin')) {
      var w = document.createElement('div'); w.className = 'coh-tb-signin';
      w.innerHTML = '<span class="coh-tb-chip">' + chipHtml + '</span>';
      block.appendChild(w);
    }
  }

  window.cohTeamBandPaint = paint;
  if (window.cohesionSetSection && !window.cohesionSetSection._band) {
    var set = window.cohesionSetSection;
    window.cohesionSetSection = function (s) { var r = set.apply(this, arguments); try { paint(); } catch (_) {} return r; };
    window.cohesionSetSection._band = true;
  }
  // the theme toggle flips data-theme: follow it (the fade is lighter in light mode)
  new MutationObserver(function () { try { paint(); } catch (_) {} })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint); else paint();
  // uploaded crests arrive a moment later: put the crest in once they are known
  if (window.cohCrestsReady) window.cohCrestsReady().then(function () { try { paint(); } catch (_) {} });
})();
