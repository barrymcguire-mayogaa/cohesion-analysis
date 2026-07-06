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
  { name: 'Shooting Leg', options: ['Right Leg', 'Left Leg'],            appliesTo: /SHOT/ },
  { name: 'Shot Side',    options: ['Left Side', 'Centre', 'Right Side'], appliesTo: /SHOT/ },
];

// Return the label groups that apply to a given event code.
window.cohesionGroupsFor = function(code){
  const c = (code || '').toUpperCase();
  return (window.COHESION_LABEL_GROUPS || []).filter(g => !g.appliesTo || g.appliesTo.test(c));
};
