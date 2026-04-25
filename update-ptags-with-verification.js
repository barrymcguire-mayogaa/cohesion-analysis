/**
 * Robust P-tag update script WITH VERIFICATION
 * For: Monaghan v Donegal Round 7 (March 22, 2026)
 * Uses: DELETE + INSERT pattern with post-update verification
 */

const { createClient } = require('@supabase/supabase-js');

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

async function updatePTagsWithVerification() {
  try {
    console.log('🔄 Starting P-tag update with verification...\n');

    // STEP 1: Scan for remaining P-tags
    console.log('📊 STEP 1: Scanning for P-tags to update...');
    const { data: eventsData, error: eventsError } = await supabase
      .from('events')
      .select('id, data')
      .eq('game_id', gameId);

    if(eventsError) throw eventsError;

    const ptagEvents = {};
    let totalPtags = 0;

    eventsData.forEach((row) => {
      const playerTag = row.data.player || '';
      if(/P\d+/.test(playerTag)){
        const team = row.data.team || 'UNKNOWN';
        const key = `${team}:${playerTag}`;

        if(!ptagEvents[key]){
          ptagEvents[key] = [];
        }
        ptagEvents[key].push(row.id);
        totalPtags++;
      }
    });

    console.log(`✅ Found ${totalPtags} P-tag events across ${Object.keys(ptagEvents).length} unique tags\n`);

    if(totalPtags === 0){
      console.log('✅ No P-tags remaining! Database is already clean.');
      return;
    }

    // STEP 2: Prepare update batches
    console.log('📋 STEP 2: Preparing update batches...');
    let deleteIds = [];
    let insertRows = [];
    let updatesSummary = {};

    eventsData.forEach((row) => {
      const event = { ...row.data };
      const playerTag = event.player || '';

      if(/P\d+/.test(playerTag)){
        let newName = null;

        if(event.team === 'MONAGHAN'){
          newName = monaghantRoster[playerTag];
        } else if(event.team === 'DONEGAL'){
          newName = donegalRoster[playerTag];
        }

        if(newName){
          // Track what we're updating
          const key = `${event.team}:${playerTag}`;
          if(!updatesSummary[key]){
            updatesSummary[key] = { from: playerTag, to: newName, count: 0 };
          }
          updatesSummary[key].count++;

          // Prepare delete and insert
          event.player = newName;
          deleteIds.push(row.id);
          insertRows.push({ game_id: gameId, data: event });
        }
      }
    });

    console.log(`✅ Prepared updates for ${insertRows.length} events\n`);

    // STEP 3: Execute delete
    console.log('🗑️  STEP 3: Deleting old P-tag entries...');
    const { error: delErr } = await supabase
      .from('events')
      .delete()
      .in('id', deleteIds);

    if(delErr) throw delErr;
    console.log(`✅ Deleted ${deleteIds.length} old entries\n`);

    // STEP 4: Execute inserts in chunks
    console.log('💾 STEP 4: Inserting updated entries...');
    const chunkSize = 100;
    let insertedCount = 0;

    for(let i = 0; i < insertRows.length; i += chunkSize){
      const chunk = insertRows.slice(i, i + chunkSize);
      const chunkNum = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(insertRows.length / chunkSize);

      console.log(`  Chunk ${chunkNum}/${totalChunks} (${chunk.length} events)...`);

      const { error: insErr } = await supabase
        .from('events')
        .insert(chunk);

      if(insErr) {
        console.error(`  ❌ ERROR in chunk ${chunkNum}: ${insErr.message}`);
        throw insErr;
      }

      insertedCount += chunk.length;
      console.log(`  ✅ Inserted ${chunk.length} events (${insertedCount}/${insertRows.length})`);
    }

    console.log(`\n✅ Successfully inserted ${insertedCount} updated events\n`);

    // STEP 5: VERIFY the updates
    console.log('🔍 STEP 5: Verifying updates...');
    const { data: verifyData, error: verifyError } = await supabase
      .from('events')
      .select('id, data')
      .eq('game_id', gameId);

    if(verifyError) throw verifyError;

    let remainingPtags = 0;
    let verifiedUpdates = 0;
    const remainingList = {};

    verifyData.forEach((row) => {
      const playerTag = row.data.player || '';

      if(/P\d+/.test(playerTag)){
        remainingPtags++;
        const team = row.data.team;
        const key = `${team}:${playerTag}`;
        if(!remainingList[key]){
          remainingList[key] = [];
        }
        remainingList[key].push({
          time: row.data.gameTime || '',
          code: row.data.code || ''
        });
      }
    });

    // Count verified updates (entries that now have player names instead of P-tags)
    verifyData.forEach((row) => {
      const playerTag = row.data.player || '';
      if(!/P\d+/.test(playerTag) && playerTag !== ''){
        // This has a name, not a P-tag
        const key = `${row.data.team}:${playerTag}`;
        if(updatesSummary[key]){
          verifiedUpdates++;
        }
      }
    });

    console.log(`\n📊 VERIFICATION RESULTS:`);
    console.log(`  Total events: ${verifyData.length}`);
    console.log(`  Remaining P-tags: ${remainingPtags}`);
    console.log(`  Successfully updated: ${insertedCount}`);

    if(remainingPtags === 0){
      console.log(`\n✨ SUCCESS! All P-tags have been replaced with player names.`);
      console.log(`\n📋 Summary of updates:`);
      Object.keys(updatesSummary).sort().forEach(key => {
        const summary = updatesSummary[key];
        console.log(`  ${summary.from} → ${summary.to}: ${summary.count} events`);
      });
    } else {
      console.log(`\n⚠️  WARNING: ${remainingPtags} P-tags remain in database!`);
      console.log(`\nRemaining P-tags by team:`);
      Object.keys(remainingList).sort().forEach(key => {
        const [team, ptag] = key.split(':');
        const events = remainingList[key];
        console.log(`  ${team} ${ptag}: ${events.length} events`);
      });
    }

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

updatePTagsWithVerification();
