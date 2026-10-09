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
  { name: 'Shot Attempts', options: ['1 Point Attempt', '2 Point Attempt', 'Goal Attempt'], appliesTo: /SHOT (OPEN|DEAD)/ },
  { name: 'Deadball Shot Type', options: ['FREE KICK', 'PENALTY', 'MARK', "'45", 'SIDELINE'], appliesTo: /SHOT DEAD ?BALL/ },
  { name: 'Shooting Leg', options: ['Right Leg', 'Left Leg', 'No Leg (Hand Pass Score)'], appliesTo: /SHOT (OPEN|DEAD)/ },
  { name: 'Shot Side',    options: ['Left Side', 'Centre', 'Right Side'], appliesTo: /SHOT (OPEN|DEAD)/ },
  { name: 'Shot Pressure', options: ['Low Pressure', 'Medium Pressure', 'High Pressure'], appliesTo: /SHOT (OPEN|DEAD)/ },
  // players:true — options are the shooting team's players (filled per game by
  // each page), not a fixed list. The shooter himself is left out.
  { name: 'Assist', options: [], players: true, appliesTo: /SHOT (OPEN|DEAD)/ },
  { name: 'Turnover Locations', options: ['DEFENSIVE THIRD', 'MIDDLE THIRD', 'ATTACKING THIRD'], appliesTo: /\bTOS?\b|TURNOVER/ },
  { name: 'Score Source Score Outcomes', options: ['1 POINT', '2 POINT', 'GOAL'], appliesTo: /SCORE SOURCE/ },
  { name: 'Kickout Locations', options: ['KO SHORT', 'KO MEDIUM', 'KO LONG'], appliesTo: /\bKO\b|KICKOUT/ },
  // players:true + playersTeam:'koWinner' — the player who WON the kickout. He
  // belongs to the kicking team (the row's team) when 'Kickout Outcomes' says
  // WON, to the opposition when it says LOST; with no outcome yet both teams'
  // players are offered (see cohesionPlayersTeam). Left blank for a kickout
  // nobody won (a free / sideline). Kickout rows only: the same test as
  // Kickout Locations, minus turnover rows (TOs · KICKOUT LOST) and the
  // score/shot SOURCE and ASSIST rows, whatever their code is called.
  { name: 'Kickout Won By', options: [], players: true, playersTeam: 'koWinner',
    appliesTo: /^(?!.*(\bTOS?\b|TURNOVER|SOURCE|ASSIST)).*(\bKO\b|KICKOUT)/ },
  { name: 'Foul Areas', options: ['DEFENSIVE THIRD', 'MIDDLE THIRD', 'ATTACKING THIRD'], appliesTo: /\bFOULS?\b/ },
  { name: 'Foul Outcomes', options: ['DISSENT', '50M FREE', 'BREACH'], appliesTo: /\bFOULS?\b/ },
  { name: 'Card Outcomes', options: ['YELLOW CARD', 'BLACK CARD', 'RED CARD'], appliesTo: /\bCARDS?\b/ },
];

// Return the label groups that apply to a given event code.
window.cohesionGroupsFor = function(code){
  const c = (code || '').toUpperCase();
  return (window.COHESION_LABEL_GROUPS || []).filter(g => !g.appliesTo || g.appliesTo.test(c));
};

// Which team's players a players:true group offers for an event:
//   'own'  — the event's own team (Assist: the shooter's team-mates)
//   'opp'  — the opposition
//   'both' — either team (not known yet)
// labels = the event's labels (group → value); outcome = its denormalised
// outcome field, used when the labels carry no 'Kickout Outcomes'.
window.cohesionPlayersTeam = function(group, labels, outcome){
  if(!group || group.playersTeam !== 'koWinner') return 'own';
  const L = labels || {};
  const k = Object.keys(L).find(x => x.toLowerCase() === 'kickout outcomes');
  const v = String((k != null && L[k]) || outcome || '').toUpperCase();
  return /\bWON\b/.test(v) ? 'own' : /\bLOST\b/.test(v) ? 'opp' : 'both';
};
// A players:true group leaves the event's own player (the shooter) out of its
// list — except a group whose player may be anyone (Kickout Won By).
window.cohesionPlayersExcludeSelf = function(group){ return !(group && group.playersTeam); };

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
    options: ['1 POINT','2 POINT','GOAL','WIDE','SHORT','SAVE','BLOCKED','WOODWORK',"'45"] },
  { appliesTo: /\bKO\b|KICKOUT/,   group: 'Kickout Outcomes', prompt: 'Kickout outcome',
    options: ['KO WON CLEAN','KO BREAK WON','KO BREAK LOST','KO LOST CLEAN','KO FREE WON','KO FREE LOST','KO SIDELINE WON','KO SIDELINE LOST'] },
  { appliesTo: /\bTOS?\b|TURNOVER/,group: 'Turnover Outcomes',prompt: 'Turnover outcome',
    options: ['FORCED TURNOVER','UNFORCED TURNOVER','KICKOUT LOST','HANDLING','FREE AGAINST','SHOT ATTEMPT'] },
  { appliesTo: /TACKLE/,           group: 'Tackle Outcomes',  prompt: 'Tackle outcome',
    options: ['CONTACT','TACKLE FREE CONCEDED','CHANGE OF DIRECTION','FOUL CONCEDED'] },
];

// Return the first event link whose appliesTo matches the code, or null.
window.cohesionLinkFor = function(code){
  const c = (code || '').toUpperCase();
  return (window.COHESION_EVENT_LINKS || []).find(l => l.appliesTo && l.appliesTo.test(c)) || null;
};
