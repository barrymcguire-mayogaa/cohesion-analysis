/**
 * Diagnostic script: Check ALL remaining P-tags in database
 * For: Monaghan v Donegal
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://uycptgjngtoxuawnsdzi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5Y3B0Z2puZ3RveHVhd25zZHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNjk5NDAsImV4cCI6MjA5MjY0NTk0MH0.PLmf6zZ1Aa_v98agzKO_Sje3Aak6n2uZOX9rQsfSV0E';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const gameId = 'monaghan-donegal-2026-national-football-league';

async function diagnoseRemainingTags() {
  try {
    console.log('🔍 Scanning for remaining P-tags...\n');

    const { data: eventsData, error: eventsError } = await supabase
      .from('events')
      .select('id, data')
      .eq('game_id', gameId);

    if(eventsError) throw eventsError;

    const ptagEvents = {};
    let totalEvents = eventsData.length;
    let ptagCount = 0;

    // Collect all P-tag events
    eventsData.forEach((row) => {
      const playerTag = row.data.player || '';
      if(/P\d+/.test(playerTag)){
        const team = row.data.team || 'UNKNOWN';
        const key = `${team} ${playerTag}`;

        if(!ptagEvents[key]){
          ptagEvents[key] = [];
        }
        ptagEvents[key].push({
          id: row.id,
          time: row.data.gameTime || '',
          code: row.data.code || '',
          team
        });
        ptagCount++;
      }
    });

    console.log(`📊 Total events in database: ${totalEvents}`);
    console.log(`🏷️  Remaining P-tags: ${ptagCount}\n`);

    if(ptagCount === 0){
      console.log('✅ No P-tags remaining! Database is clean.');
      return;
    }

    console.log('=== REMAINING P-TAG EVENTS ===\n');

    Object.keys(ptagEvents).sort().forEach(key => {
      const events = ptagEvents[key];
      console.log(`${key} (${events.length} events):`);
      events.forEach(ev => {
        console.log(`  - ${ev.time.padEnd(12)} | ${ev.code}`);
      });
      console.log('');
    });

    // Summary by team
    const monaghantags = Object.keys(ptagEvents).filter(k => k.startsWith('MONAGHAN')).length;
    const donegaltags = Object.keys(ptagEvents).filter(k => k.startsWith('DONEGAL')).length;

    console.log(`📋 Summary:`);
    console.log(`  Monaghan: ${monaghantags} unique P-tags with events`);
    console.log(`  Donegal: ${donegaltags} unique P-tags with events`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

diagnoseRemainingTags();
