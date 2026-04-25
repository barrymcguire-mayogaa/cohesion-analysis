/**
 * Clean up: Keep only latest updated versions, remove duplicates and P-tags
 * Strategy: For each unique game_time + team + code combo, keep only the newest record
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://uycptgjngtoxuawnsdzi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5Y3B0Z2puZ3RveHVhd25zZHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNjk5NDAsImV4cCI6MjA5MjY0NTk0MH0.PLmf6zZ1Aa_v98agzKO_Sje3Aak6n2uZOX9rQsfSV0E';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const gameId = 'monaghan-donegal-2026-national-football-league';

async function cleanupAndDeduplicate() {
  try {
    console.log('🧹 Starting cleanup and deduplication...\n');

    const { data: allEvents, error: allError } = await supabase
      .from('events')
      .select('id, data, created_at')
      .eq('game_id', gameId);

    if(allError) throw allError;

    // Group by unique event signature (team + gameTime + code)
    const eventGroups = {};
    allEvents.forEach(row => {
      const key = `${row.data.team}|${row.data.gameTime}|${row.data.code}`;
      if(!eventGroups[key]){
        eventGroups[key] = [];
      }
      eventGroups[key].push({
        id: row.id,
        player: row.data.player,
        created: new Date(row.created_at)
      });
    });

    console.log(`📊 Found ${allEvents.length} total events`);
    console.log(`📋 Found ${Object.keys(eventGroups).length} unique event signatures\n`);

    // For each group, identify which to keep and which to delete
    let toDelete = [];
    let keepStats = { ptag: 0, named: 0 };

    Object.values(eventGroups).forEach(group => {
      // Sort by created_at descending (newest first)
      group.sort((a, b) => b.created - a.created);

      // Keep the newest one
      const keeper = group[0];
      keepStats[/^P\d+$/.test(keeper.player) ? 'ptag' : 'named']++;

      // Delete all older versions
      for(let i = 1; i < group.length; i++){
        toDelete.push(group[i].id);
      }
    });

    console.log(`📌 Keeping ${keepStats.named} events with player names`);
    console.log(`⚠️  Keeping ${keepStats.ptag} events that still have P-tags`);
    console.log(`🗑️  Will delete ${toDelete.length} duplicate versions\n`);

    if(toDelete.length === 0){
      console.log('✅ No duplicates found. Database is already clean!');
      return;
    }

    // Delete duplicates in batches
    console.log('🗑️  Deleting duplicates...');
    const chunkSize = 100;
    for(let i = 0; i < toDelete.length; i += chunkSize){
      const chunk = toDelete.slice(i, i + chunkSize);
      console.log(`  Deleting batch ${Math.floor(i/chunkSize) + 1}/${Math.ceil(toDelete.length/chunkSize)}...`);

      const { error: delErr } = await supabase
        .from('events')
        .delete()
        .in('id', chunk);

      if(delErr) {
        console.error(`  ❌ Error: ${delErr.message}`);
      }
    }

    console.log(`\n✅ Delete operations completed\n`);

    // Verify
    console.log('🔍 Verifying results...');
    const { data: verifyData } = await supabase
      .from('events')
      .select('id, data')
      .eq('game_id', gameId);

    let ptagCount = 0;
    verifyData.forEach(row => {
      if(/^P\d+$/.test(row.data.player)){
        ptagCount++;
      }
    });

    console.log(`📊 Total events after cleanup: ${verifyData.length}`);
    console.log(`🏷️  Remaining P-tags: ${ptagCount}`);

    if(ptagCount === 0){
      console.log(`\n✨ SUCCESS! Database is now clean.`);
    } else {
      console.log(`\n⚠️  WARNING: ${ptagCount} P-tags still remain`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

cleanupAndDeduplicate();
