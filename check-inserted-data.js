/**
 * Check what's actually in the recently inserted rows
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://uycptgjngtoxuawnsdzi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5Y3B0Z2puZ3RveHVhd25zZHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNjk5NDAsImV4cCI6MjA5MjY0NTk0MH0.PLmf6zZ1Aa_v98agzKO_Sje3Aak6n2uZOX9rQsfSV0E';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const gameId = 'monaghan-donegal-2026-national-football-league';

async function checkInsertedData() {
  try {
    console.log('🔍 Checking recently inserted data...\n');

    const { data: eventsData, error: eventsError } = await supabase
      .from('events')
      .select('id, data, created_at')
      .eq('game_id', gameId)
      .order('created_at', { ascending: false })
      .limit(10);

    if(eventsError) throw eventsError;

    console.log('📋 Last 10 inserted events:\n');
    eventsData.forEach((row, idx) => {
      console.log(`${idx + 1}. ID: ${row.id}`);
      console.log(`   Created: ${row.created_at}`);
      console.log(`   Player: "${row.data.player}"`);
      console.log(`   Team: "${row.data.team}"`);
      console.log(`   Full data:`, JSON.stringify(row.data, null, 2));
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkInsertedData();
