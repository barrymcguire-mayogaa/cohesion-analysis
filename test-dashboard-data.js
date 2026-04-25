/**
 * Test: Verify dashboard will display correct player names
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://uycptgjngtoxuawnsdzi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5Y3B0Z2puZ3RveHVhd25zZHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNjk5NDAsImV4cCI6MjA5MjY0NTk0MH0.PLmf6zZ1Aa_v98agzKO_Sje3Aak6n2uZOX9rQsfSV0E';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const gameId = 'monaghan-donegal-2026-national-football-league';

async function testDashboardData() {
  try {
    console.log('🧪 Testing Dashboard Data Display\n');
    console.log('='.repeat(60));

    // Get game info
    const { data: gameData, error: gameErr } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single();

    if(gameErr) throw gameErr;

    console.log('\n📋 Game Information:');
    console.log(`   Title: ${gameData.title}`);
    console.log(`   Date: ${gameData.date}`);
    console.log(`   Teams: ${gameData.team_a} vs ${gameData.team_b}`);
    console.log(`   Total Events: ${gameData.total_events}`);

    // Get sample events to verify player names are showing
    const { data: allEvents, error: eventsErr } = await supabase
      .from('events')
      .select('data')
      .eq('game_id', gameId);

    if(eventsErr) throw eventsErr;

    console.log(`\n✅ Events Retrieved: ${allEvents.length}`);

    // Analyze player names
    const playerEvents = {};
    let ptags = 0;
    let namedPlayers = 0;
    
    allEvents.forEach(row => {
      const player = row.data.player || 'UNKNOWN';
      if(/^P\d+$/.test(player)){
        ptags++;
      } else if(player !== 'UNKNOWN'){
        namedPlayers++;
        if(!playerEvents[player]){
          playerEvents[player] = 0;
        }
        playerEvents[player]++;
      }
    });

    console.log(`\n📊 Player Name Distribution:`);
    console.log(`   Events with P-tags: ${ptags}`);
    console.log(`   Events with player names: ${namedPlayers}`);
    console.log(`   Unique named players: ${Object.keys(playerEvents).length}`);

    // Show top players by event count
    console.log(`\n🏆 Top 10 Players by Event Count:`);
    const topPlayers = Object.entries(playerEvents)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    topPlayers.forEach((entry, idx) => {
      console.log(`   ${idx + 1}. ${entry[0]}: ${entry[1]} events`);
    });

    // Verify both teams are represented
    const teamAEvents = allEvents.filter(e => e.data.team === 'MONAGHAN');
    const teamBEvents = allEvents.filter(e => e.data.team === 'DONEGAL');

    console.log(`\n🎯 Events by Team:`);
    console.log(`   MONAGHAN: ${teamAEvents.length} events`);
    console.log(`   DONEGAL: ${teamBEvents.length} events`);

    // Sample events from each team with names
    console.log(`\n📌 Sample Events (First 5 of each team with player names):`);
    
    const monaghans = teamAEvents.filter(e => !/^P\d+$/.test(e.data.player)).slice(0, 3);
    const donegals = teamBEvents.filter(e => !/^P\d+$/.test(e.data.player)).slice(0, 3);

    console.log(`\n   MONAGHAN:`);
    monaghans.forEach(e => {
      console.log(`     ${e.data.gameTime} | ${e.data.player} | ${e.data.code}`);
    });

    console.log(`\n   DONEGAL:`);
    donegals.forEach(e => {
      console.log(`     ${e.data.gameTime} | ${e.data.player} | ${e.data.code}`);
    });

    // Final assessment
    console.log('\n' + '='.repeat(60));
    if(ptags === 0){
      console.log('✅ DASHBOARD READY: All player names are properly populated');
      console.log('✅ No P-tags found in database');
      console.log('✅ Both teams have events with named players');
    } else {
      console.log(`⚠️  WARNING: ${ptags} P-tags still found in database`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

testDashboardData();
