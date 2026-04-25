/**
 * Detailed analysis of what player values are in the events
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://uycptgjngtoxuawnsdzi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5Y3B0Z2puZ3RveHVhd25zZHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNjk5NDAsImV4cCI6MjA5MjY0NTk0MH0.PLmf6zZ1Aa_v98agzKO_Sje3Aak6n2uZOX9rQsfSV0E';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const gameId = 'monaghan-donegal-2026-national-football-league';

async function analyze() {
  try {
    console.log('📊 Analyzing all P-tag events...\n');

    const { data: allEvents, error: allError } = await supabase
      .from('events')
      .select('id, data, created_at')
      .eq('game_id', gameId);

    if(allError) throw allError;

    // Group by player value
    const byPlayer = {};
    allEvents.forEach(row => {
      const player = row.data.player || 'UNKNOWN';
      if(!byPlayer[player]){
        byPlayer[player] = [];
      }
      byPlayer[player].push({
        id: row.id,
        created: row.created_at
      });
    });

    // Find P-tag entries
    console.log('🏷️  Events with P-tags in player field:\n');
    const ptagPlayers = Object.keys(byPlayer).filter(p => /^P\d+$/.test(p)).sort();
    
    ptagPlayers.forEach(player => {
      const events = byPlayer[player];
      console.log(`${player}: ${events.length} events`);
      events.forEach(e => {
        console.log(`  - ID: ${e.id} (${e.created})`);
      });
    });

    console.log(`\n📈 Total events with P-tags: ${ptagPlayers.reduce((sum, p) => sum + byPlayer[p].length, 0)}`);
    console.log(`📈 Total unique P-tag values: ${ptagPlayers.length}`);

    // Check for players with names
    console.log('\n✓ Sample of events with player names:\n');
    const namedPlayers = Object.keys(byPlayer).filter(p => !/^P\d+$/.test(p) && p !== 'UNKNOWN').slice(0, 10);
    namedPlayers.forEach(player => {
      console.log(`${player}: ${byPlayer[player].length} events`);
    });

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

analyze();
