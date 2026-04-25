/**
 * Check for duplicate events at specific timestamps
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://uycptgjngtoxuawnsdzi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5Y3B0Z2puZ3RveHVhd25zZHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNjk5NDAsImV4cCI6MjA5MjY0NTk0MH0.PLmf6zZ1Aa_v98agzKO_Sje3Aak6n2uZOX9rQsfSV0E';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const gameId = 'monaghan-donegal-2026-national-football-league';

async function checkDuplicates() {
  try {
    console.log('🔍 Looking for events at timestamp "1H 01:13" (DONEGAL P15)...\n');

    const { data: eventsData, error: eventsError } = await supabase
      .from('events')
      .select('id, data, created_at')
      .eq('game_id', gameId);

    if(eventsError) throw eventsError;

    // Find all events at this timestamp
    const targetTime = '1H 01:13';
    const matches = eventsData.filter(e => e.data.gameTime === targetTime && e.data.team === 'DONEGAL');

    console.log(`Found ${matches.length} events at "${targetTime}":\n`);
    matches.forEach((row, idx) => {
      console.log(`${idx + 1}. ID: ${row.id} | Player: "${row.data.player}"`);
      console.log(`   Created: ${row.created_at}`);
      console.log('');
    });

    // Also check a Monaghan one
    console.log('\n---\n');
    console.log('🔍 Looking for events at timestamp "1H 06:47" (MONAGHAN P14)...\n');

    const targetTime2 = '1H 06:47';
    const matches2 = eventsData.filter(e => e.data.gameTime === targetTime2 && e.data.team === 'MONAGHAN');

    console.log(`Found ${matches2.length} events at "${targetTime2}":\n`);
    matches2.forEach((row, idx) => {
      console.log(`${idx + 1}. ID: ${row.id} | Player: "${row.data.player}"`);
      console.log(`   Created: ${row.created_at}`);
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkDuplicates();
