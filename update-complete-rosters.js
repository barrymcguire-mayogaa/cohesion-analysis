/**
 * Update script: Replace ALL P-tags with complete player names
 * For: Monaghan v Donegal Round 7 (March 22, 2026)
 * Usage: node update-complete-rosters.js
 */

const { createClient } = require('@supabase/supabase-js');

// Supabase config
const SUPABASE_URL = 'https://uycptgjngtoxuawnsdzi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5Y3B0Z2puZ3RveHVhd25zZHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNjk5NDAsImV4cCI6MjA5MjY0NTk0MH0.PLmf6zZ1Aa_v98agzKO_Sje3Aak6n2uZOX9rQsfSV0E';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Complete player rosters
const monaghantRoster = {
  'P1': 'Rory Beggan',
  'P2': 'Darragh McElearney',
  'P3': 'Ryan O\'Toole',
  'P4': 'Ryan Wylie',
  'P5': 'Cameron Dowd',
  'P6': 'Dessie Ward',
  'P7': 'Aaron Carey',
  'P8': 'Micheál McCarville',
  'P9': 'Karl Gallagher',
  'P10': 'Fionan Carolan',
  'P11': 'Micheál Bannigan',
  'P12': 'Oisín McGorman',
  'P13': 'David Garland',
  'P14': 'Andrew Woods',
  'P15': 'Stephen O\'Hanlon',
  'P16': 'Kian Mulligan',
  'P17': 'Louis Kelly',
  'P18': 'Alistair Stewart',
  'P19': 'Robbie Hanratty',
  'P20': 'Ryan Mohan',
  'P21': 'Ronan Boyle',
  'P22': 'Ryan Duffy',
  'P23': 'Darragh Treanor',
  'P24': 'Jack McCarron',
  'P25': 'Eddie Walsh',
  'P26': 'Shane Hanratty'
};

const donegalRoster = {
  'P1': 'Gavin Mulreany',
  'P2': 'Caolan McColgan',
  'P3': 'Brendan McCole',
  'P4': 'Mark Curran',
  'P5': 'Eoghan Ban Gallagher',
  'P6': 'Caolan McGonagle',
  'P7': 'Seán Martin',
  'P8': 'Hugh McFadden',
  'P9': 'Michael Langan',
  'P10': 'Paul O\'Hare',
  'P11': 'Shane O\'Donnell',
  'P12': 'Peadar Mogan',
  'P13': 'Conor O\'Donnell',
  'P14': 'Jason McGee',
  'P15': 'Shea Malone',
  'P16': 'Pádraig Mac Giolla Bhríde',
  'P17': 'Cormac Gallagher',
  'P18': 'Oisín Caulfield',
  'P19': 'Ryan McHugh',
  'P20': 'Seanan Carr',
  'P21': 'Finnbarr Roarty',
  'P22': 'Stephen McMenamin',
  'P23': 'Jamie Brennan',
  'P24': 'Eoin McHugh',
  'P25': 'Kevin Muldoon',
  'P26': 'Max Campbell'
};

const gameId = 'monaghan-donegal-2026-national-football-league';

async function updateCompleteRosters() {
  try {
    console.log('🔄 Starting complete roster update...\n');

    // Get all events for this game
    const { data: eventsData, error: eventsError } = await supabase
      .from('events')
      .select('id, data')
      .eq('game_id', gameId);

    if(eventsError) throw eventsError;

    console.log(`📊 Found ${eventsData.length} events\n`);

    let updateCount = 0;
    let deleteIds = [];
    let insertRows = [];

    // Process each event
    eventsData.forEach((row, idx) => {
      const event = { ...row.data };
      const playerTag = event.player || '';

      // Check if this is a P-tag that needs updating
      if(/P\d+/.test(playerTag)){
        let newName = null;

        if(event.team === 'MONAGHAN'){
          newName = monaghantRoster[playerTag];
        } else if(event.team === 'DONEGAL'){
          newName = donegalRoster[playerTag];
        }

        if(newName){
          // Update the player name
          event.player = newName;
          deleteIds.push(row.id);
          insertRows.push({ game_id: gameId, data: event });
          updateCount++;
        }
      }
    });

    console.log(`✅ Found ${updateCount} P-tags to update\n`);

    if(updateCount === 0){
      console.log('ℹ️  No P-tags found to update');
      return;
    }

    // Delete old rows
    console.log('🗑️  Deleting old entries...');
    const { error: delErr } = await supabase
      .from('events')
      .delete()
      .in('id', deleteIds);

    if(delErr) throw delErr;

    // Insert new rows with updated player names
    console.log('💾 Inserting updated entries...\n');
    const chunkSize = 100;
    for(let i = 0; i < insertRows.length; i += chunkSize){
      const chunk = insertRows.slice(i, i + chunkSize);
      console.log(`  Inserting chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(insertRows.length / chunkSize)}`);

      const { error: insErr } = await supabase
        .from('events')
        .insert(chunk);

      if(insErr) throw insErr;
    }

    console.log(`\n✨ Complete!`);
    console.log(`✅ Updated: ${updateCount} player tags`);
    console.log(`✅ All 26 players now mapped for both teams`);

  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

updateCompleteRosters();
