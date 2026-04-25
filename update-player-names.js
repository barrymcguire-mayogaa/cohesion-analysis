/**
 * Update script: Replace P1-P26 player tags with actual player names
 * For: Monaghan v Donegal Round 7 (March 22, 2026)
 * Usage: node update-player-names.js
 */

const { createClient } = require('@supabase/supabase-js');

// Supabase config
const SUPABASE_URL = 'https://uycptgjngtoxuawnsdzi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5Y3B0Z2puZ3RveHVhd25zZHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNjk5NDAsImV4cCI6MjA5MjY0NTk0MH0.PLmf6zZ1Aa_v98agzKO_Sje3Aak6n2uZOX9rQsfSV0E';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Player rosters
const monaghantRoster = [
  'Rory Beggan',
  'Darragh McElearney',
  'Ryan O\'Toole',
  'Kieran Duffy',
  'Conor McManus',
  'Dáire O\'Neill',
  'Cathal Compton',
  'Micheal Bannigan',
  'Gareth Trims',
  'Cillian O\'Sullivan',
  'Peter Lynn',
  'Dessie Mone',
  'Seán Jones',
  'Jack McCarron',
  'David Keogh',
  'Bryan Mulgrew',
  'Shane Carey',
  'Ronan McQuillan',
  'Barry Donohoe',
  'Andrew Lynch',
  'David Foreman',
  'Gearóid Finnegan',
  'Michael Kavanagh',
  'Rory Beggan II',
  'Conor Lenehan',
  'Shane Hanratty'
];

const donegalRoster = [
  'Gavin Mulreany',
  'Caolan McColgan',
  'Brendan McCole',
  'Paddy McBrearty',
  'Peadar Mogan',
  'Eoin McHugh',
  'Odhrán MacNiallais',
  'Hugh McFadden',
  'Michael Langan',
  'Darren Langan',
  'Jamie Brennan',
  'Conor O\'Donnell',
  'Ciaran Thompson',
  'Jason McGee',
  'Paul Hegarty',
  'Thomas McNamee',
  'Mark Anthony McGinley',
  'Conor Gormley',
  'Grant Keenan',
  'Ryan McHugh',
  'Enda Lynn',
  'Frank McGlynn',
  'Mark McHugh',
  'Stephen McMenamin',
  'Brendan Dever',
  'Max Campbell'
];

// Map P1-P26 to actual names for each team
const playerMap = {
  monaghan: {},
  donegal: {}
};

monaghantRoster.forEach((name, idx) => {
  playerMap.monaghan[`P${idx + 1}`] = name;
});

donegalRoster.forEach((name, idx) => {
  playerMap.donegal[`P${idx + 1}`] = name;
});

async function updatePlayerNames() {
  try {
    console.log('🔄 Starting player name update...\n');

    // Find the game - search for Monaghan v Donegal (there may be multiple)
    const { data: candidates, error: gameError } = await supabase
      .from('games')
      .select('id, meta')
      .ilike('meta->>title', '%Monaghan%Donegal%');

    if (gameError) throw gameError;

    if (candidates.length === 0) {
      console.error('❌ Game not found. Searching for similar games...');
      const { data: allGames } = await supabase.from('games').select('id, meta');
      console.log('Available games:', allGames?.map(g => g.meta.title));
      process.exit(1);
    }

    // If multiple matches, use the first one (most likely to be Round 7 = March 22, 2026)
    // The game shown in dashboard was dated March 22, 2026
    let gameId = candidates[0].id;
    let gameTitle = candidates[0].meta.title;

    if (candidates.length > 1) {
      console.log('⚠️  Multiple Monaghan v Donegal games found:');
      candidates.forEach((g, idx) => {
        console.log(`  ${idx}: ${g.meta.title} (${g.meta.date || 'date unknown'})`);
      });
      console.log(`\nUsing first match: ${gameTitle}`);
    }

    console.log(`✅ Found game: ${gameTitle}`);
    console.log(`   Game ID: ${gameId}\n`);

    // Get all events for this game
    const { data: eventsData, error: eventsError } = await supabase
      .from('events')
      .select('id, data')
      .eq('game_id', gameId);

    if (eventsError) throw eventsError;
    console.log(`📊 Found ${eventsData.length} events to process\n`);

    let updatedCount = 0;
    let updateErrors = 0;

    // Process events in chunks
    const chunkSize = 100;
    for (let i = 0; i < eventsData.length; i += chunkSize) {
      const chunk = eventsData.slice(i, i + chunkSize);
      const updates = [];

      chunk.forEach(row => {
        const event = row.data;
        let updated = false;

        // Determine team and replace player tags (team names are in uppercase)
        if (event.team === 'MONAGHAN' && event.player && /P\d+/.test(event.player)) {
          const playerKey = event.player;
          if (playerMap.monaghan[playerKey]) {
            event.player = playerMap.monaghan[playerKey];
            updated = true;
          }
        } else if (event.team === 'DONEGAL' && event.player && /P\d+/.test(event.player)) {
          const playerKey = event.player;
          if (playerMap.donegal[playerKey]) {
            event.player = playerMap.donegal[playerKey];
            updated = true;
          }
        }

        if (updated) {
          updates.push({
            id: row.id,
            data: event,
            game_id: gameId
          });
        }
      });

      // Batch update
      if (updates.length > 0) {
        const { error: updateError } = await supabase
          .from('events')
          .upsert(updates);

        if (updateError) {
          console.error(`❌ Error updating chunk ${Math.floor(i / chunkSize) + 1}: ${updateError.message}`);
          updateErrors++;
        } else {
          updatedCount += updates.length;
          console.log(`✅ Updated ${updates.length} events (chunk ${Math.floor(i / chunkSize) + 1})`);
        }
      }
    }

    console.log(`\n✨ Update complete!`);
    console.log(`✅ Events updated: ${updatedCount}`);
    console.log(`❌ Errors: ${updateErrors}`);

  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

// Run update
updatePlayerNames();
