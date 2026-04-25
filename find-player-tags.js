/**
 * Find events with player tags
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://uycptgjngtoxuawnsdzi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5Y3B0Z2puZ3RveHVhd25zZHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNjk5NDAsImV4cCI6MjA5MjY0NTk0MH0.PLmf6zZ1Aa_v98agzKO_Sje3Aak6n2uZOX9rQsfSV0E';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function findPlayerTags() {
  try {
    console.log('🔍 Searching for events with player tags...\n');

    // Get all events for the game
    const { data: events } = await supabase
      .from('events')
      .select('data')
      .eq('game_id', 'monaghan-donegal-2026-national-football-league');

    console.log(`Total events: ${events.length}\n`);

    // Count events with non-empty player field
    const withPlayer = events.filter(e => e.data.player && e.data.player.trim() !== '');
    console.log(`Events with player field populated: ${withPlayer.length}`);

    if (withPlayer.length > 0) {
      console.log('\nSample events with player data:');
      withPlayer.slice(0, 10).forEach((e, idx) => {
        console.log(`  ${idx + 1}. Player: "${e.data.player}", Code: "${e.data.code}", Team: "${e.data.team}"`);
      });
    }

    // Look for P1-P26 patterns
    const withPlayerTags = events.filter(e => /P\d+/.test(e.data.player || ''));
    console.log(`\nEvents with P1-P26 style tags: ${withPlayerTags.length}`);

    if (withPlayerTags.length > 0) {
      console.log('Sample P-tagged events:');
      withPlayerTags.slice(0, 10).forEach((e, idx) => {
        console.log(`  ${idx + 1}. Player: "${e.data.player}", Code: "${e.data.code}", Team: "${e.data.team}"`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

findPlayerTags();
