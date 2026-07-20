/* COHESION — shared label-group definitions
 *
 * Custom label groups let you tag events with extra, filterable detail
 * beyond what the XML carried (e.g. which leg a shot was struck with).
 * They are defined here in ONE place and read by both the dashboard
 * (quick-tag beside Assign Player) and Code Room (dropdown controls).
 *
 * TO ADD A GROUP: copy a block below and change the fields.
 *   name      — the label group name (shows on events + becomes a filter)
 *   options   — the allowed values (dropdown choices)
 *   appliesTo — a RegExp tested against the event CODE; null = every event.
 *
 * NOTE: this is the single-team seed. Per-team, self-service definitions
 * stored in the database arrive with the multi-team phase; until then,
 * edit this file (or ask an admin) to add a group for the whole team.
 */
window.COHESION_LABEL_GROUPS = [
  { name: 'Shooting Leg', options: ['Right Leg', 'Left Leg', 'No Leg (Hand Pass Score)'], appliesTo: /SHOT/ },
  { name: 'Shot Side',    options: ['Left Side', 'Centre', 'Right Side'], appliesTo: /SHOT/ },
  { name: 'Shot Pressure', options: ['Low Pressure', 'Medium Pressure', 'High Pressure'], appliesTo: /SHOT/ },
];

// Return the label groups that apply to a given event code.
window.cohesionGroupsFor = function(code){
  const c = (code || '').toUpperCase();
  return (window.COHESION_LABEL_GROUPS || []).filter(g => !g.appliesTo || g.appliesTo.test(c));
};

/* EVENT LINKS — the "tag, then qualify" follow-up.
 *
 * When you code certain events (a shot, a kickout…) the very next thing you
 * know is how it turned out. An event link makes Code Room pop a quick
 * outcome prompt straight after you tag a matching event, so you record it in
 * the same beat instead of going back in Edit mode.
 *
 *   appliesTo — RegExp tested against the (uppercased) event CODE.
 *   group     — the label group the chosen outcome is written to. Use the
 *               EXACT DB group name so it flows through the parser, the
 *               dashboard filters, and Edit mode's outcome derivation.
 *   prompt    — heading shown on the prompt.
 *   options   — the outcome choices (also 1..N keyboard shortcuts).
 *
 * The first matching link wins. Values below mirror the real data.
 */
window.COHESION_EVENT_LINKS = [
  { appliesTo: /SCORE SOURCE/,     group: 'Score Source Outcomes', prompt: 'Score source',
    options: ['OWN KICKOUT','OPP KICKOUT','FORCED TURNOVER','UNFORCED TURNOVER','BALL RECOVERED','THROW-IN','FREE WON'] },
  { appliesTo: /SHOT SOURCE/,      group: 'Shot Source Outcomes', prompt: 'Shot source',
    options: ['OWN KICKOUT','OPP KICKOUT','FORCED TURNOVER','UNFORCED TURNOVER','THROW-IN','FREE WON'] },
  // NOTE: keep the specific *SOURCE links ABOVE the generic /SHOT/ one —
  // the first match wins, and /SHOT/ would otherwise swallow SHOT SOURCE.
  { appliesTo: /SHOT/,             group: 'Shot Outcomes',    prompt: 'Shot outcome',
    options: ['1 POINT','2 POINT','GOAL','WIDE','SHORT','SAVE','BLOCKED','WOODWORK'] },
  { appliesTo: /\bKO\b|KICKOUT/,   group: 'Kickout Outcomes', prompt: 'Kickout outcome',
    options: ['KO WON CLEAN','KO BREAK WON','KO BREAK LOST','KO LOST CLEAN','KO FREE WON','KO FREE LOST'] },
  { appliesTo: /\bTOS?\b|TURNOVER/,group: 'Turnover Outcomes',prompt: 'Turnover outcome',
    options: ['FORCED TURNOVER','UNFORCED TURNOVER','KICKOUT LOST','HANDLING'] },
  { appliesTo: /TACKLE/,           group: 'Tackle Outcomes',  prompt: 'Tackle outcome',
    options: ['CONTACT','TACKLE FREE CONCEDED','CHANGE OF DIRECTION'] },
];

// Return the first event link whose appliesTo matches the code, or null.
window.cohesionLinkFor = function(code){
  const c = (code || '').toUpperCase();
  return (window.COHESION_EVENT_LINKS || []).find(l => l.appliesTo && l.appliesTo.test(c)) || null;
};
