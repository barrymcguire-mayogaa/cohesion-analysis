/**
 * Inspect script: Check the structure of events in the database
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://uycptgjngtoxuawnsdzi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5Y3B0Z2puZ3RveHVhd25zZHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNjk5NDAsImV4cCI6MjA5MjY0NTk0MH0.PLmf6zZ1Aa_v98agzKO_Sje3Aak6n2uZOX9rQsfSV0E';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function inspectEvents() {
  try {
    console.log('🔍 Inspecting event structure...\n');

    // Get a few sample events
    const { data: events } = await supabase
      .from('events')
      .select('*')
      .eq('game_id', 'monaghan-donegal-2026-national-football-league')
      .limit(5);

    console.log('Sample events (first 5):');
    console.log(JSON.stringify(events, null, 2));

  } catch (error) {
    console.error('Error:', error.message);
  }
}

inspectEvents();
