/* COHESION — GAA COUNTY COLOURS: the 32 counties, London and New York.
 *
 * >>> BARRY: PLEASE CHECK THIS LIST. <<<  It is the commonly known county colours, typed in by hand (Oct 2026); change any
 * hex below and every page that loads this file picks it up. One entry per county, keyed by the crest slug (cohCrestSlug:
 * lower case, letters and digits only — 'New York' → 'newyork'). primary = the main jersey colour, secondary = the trim,
 * tertiary (optional, Carlow and Offaly only) = a third colour, used ONLY decoratively (stripes: the dashboard's name
 * underline, the print-out cover and header bars) — never in charts, tiles, arrows or maps, where yellow / gold would read
 * as COHESION's goal colour and red as a miss.
 *
 * SCOPE (Barry, Oct 2026): ONLY the new Analysis views read this list — the Player Dashboard and the Panel Print-out
 * (cohesion-playerdash.js pdColours). It is NOT merged into COHESION_TEAM_COLOURS, so every other page keeps drawing a
 * game in the colours saved on that game (a team may wear a change or third kit). Display rules (readable on the dark
 * pages: a white or black primary gives way to the secondary, colours are lifted through cohesion-ink.js) live where the
 * colours are drawn, not here. Confirmed by Barry, including London, New York and Kildare.
 */
(function(root){
  var COUNTY_COLOURS={
    antrim:    {primary:'#f6b40e', secondary:'#ffffff'},   // saffron, white
    armagh:    {primary:'#f58220', secondary:'#ffffff'},   // orange, white
    carlow:    {primary:'#d7182a', secondary:'#00843d', tertiary:'#ffd200'},   // red, green, yellow
    cavan:     {primary:'#0055a4', secondary:'#ffffff'},   // blue, white
    clare:     {primary:'#f7d117', secondary:'#0055a4'},   // saffron, blue
    cork:      {primary:'#d3202f', secondary:'#ffffff'},   // red, white
    derry:     {primary:'#d3202f', secondary:'#ffffff'},   // red, white
    donegal:   {primary:'#00843d', secondary:'#f2c200'},   // green, gold
    down:      {primary:'#d3202f', secondary:'#000000'},   // red, black
    dublin:    {primary:'#4fa3dc', secondary:'#0b2a5b'},   // sky blue, navy
    fermanagh: {primary:'#00843d', secondary:'#ffffff'},   // green, white
    galway:    {primary:'#7a1f2b', secondary:'#ffffff'},   // maroon, white
    kerry:     {primary:'#00703c', secondary:'#f2c200'},   // green, gold
    kildare:   {primary:'#ffffff', secondary:'#000000'},   // white (the Lilywhites), black trim
    kilkenny:  {primary:'#000000', secondary:'#f2a900'},   // black, amber
    laois:     {primary:'#0055a4', secondary:'#ffffff'},   // blue, white
    leitrim:   {primary:'#00843d', secondary:'#f2c200'},   // green, gold
    limerick:  {primary:'#00843d', secondary:'#ffffff'},   // green, white
    london:    {primary:'#00843d', secondary:'#ffffff'},   // green, white
    longford:  {primary:'#0055a4', secondary:'#f2c200'},   // blue, gold
    louth:     {primary:'#d3202f', secondary:'#ffffff'},   // red, white
    mayo:      {primary:'#00843d', secondary:'#e4002b'},   // green, red
    meath:     {primary:'#00843d', secondary:'#f2c200'},   // green, gold
    monaghan:  {primary:'#ffffff', secondary:'#0055a4'},   // white, blue
    newyork:   {primary:'#0b2a6b', secondary:'#d3202f'},   // navy, red
    offaly:    {primary:'#00843d', secondary:'#ffffff', tertiary:'#f2c200'},   // green, white, gold
    roscommon: {primary:'#f5d300', secondary:'#0055a4'},   // primrose, blue
    sligo:     {primary:'#000000', secondary:'#ffffff'},   // black, white
    tipperary: {primary:'#0055a4', secondary:'#f2c200'},   // blue, gold
    tyrone:    {primary:'#ffffff', secondary:'#d3202f'},   // white, red
    waterford: {primary:'#ffffff', secondary:'#0055a4'},   // white, blue
    westmeath: {primary:'#7a1f2b', secondary:'#ffffff'},   // maroon, white
    wexford:   {primary:'#5b2c83', secondary:'#f2c200'},   // purple, gold
    wicklow:   {primary:'#0055a4', secondary:'#f2c200'},   // blue, gold
  };
  root.COHESION_COUNTY_COLOURS=COUNTY_COLOURS;
  if(typeof module!=='undefined'&&module.exports) module.exports=COUNTY_COLOURS;
})(typeof window!=='undefined'?window:globalThis);
