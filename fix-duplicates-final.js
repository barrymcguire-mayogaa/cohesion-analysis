/**
 * Final fix: Remove all duplicate P-tag rows and keep only the updated ones
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://uycptgjngtoxuawnsdzi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5Y3B0Z2puZ3RveHVhd25zZHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNjk5NDAsImV4cCI6MjA5MjY0NTk0MH0.PLmf6zZ1Aa_v98agzKO_Sje3Aak6n2uZOX9rQsfSV0E';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const gameId = 'monaghan-donegal-2026-national-football-league';

async function fixDuplicates() {
  try {
    console.log('🔧 Fixing duplicates: Removing original P-tag rows...\n');

    const { data: eventsData, error: eventsError } = await supabase
      .from('events')
      .select('id, data')
      .eq('game_id', gameId);

    if(eventsError) throw eventsError;

    // Find all ORIGINAL P-tag rows (created before 2026-04-25T10:00:00)
    const originalPtagIds = eventsData
      .filter(row => {
        const playerTag = row.data.player || '';
        // Only match actual P-tags like P1, P12, etc.
        return /^P\d+$/.test(playerTag);
      })
      .map(row => row.id);

    console.log(`🎯 Found ${originalPtagIds.length} original P-tag rows to delete`);
    console.log(`   IDs: ${originalPtagIds.join(', ')}\n`);

    if(originalPtagIds.length === 0){
      console.log('✅ No original P-tags found. Database is clean!');
      return;
    }

    // Delete the original P-tag rows
    console.log('🗑️  Deleting original P-tag rows...');
    const { error: delErr } = await supabase
      .from('events')
      .delete()
      .in('id', originalPtagIds);

    if(delErr) {
      console.error(`❌ Delete failed: ${delErr.message}`);
      throw delErr;
    }

    console.log(`✅ Deleted ${originalPtagIds.length} original P-tag rows\n`);

    // Verify
    console.log('🔍 Verifying...');
    const { data: verifyData, error: verifyError } = await supabase
      .from('events')
      .select('id, data')
      .eq('game_id', gameId);

    if(verifyError) throw verifyError;

    let remainingPtags = 0;
    verifyData.forEach(row => {
      const playerTag = row.data.player || '';
      if(/^P\d+$/.test(playerTag)){
        remainingPtags++;
      }
    });

    console.log(`📊 Total events now: ${verifyData.length}`);
    console.log(`🏷️  Remaining P-tags: ${remainingPtags}`);

    if(remainingPtags === 0){
      console.log(`\n✨ SUCCESS! All original P-tag rows removed.`);
      console.log(`✅ Database is now clean with only updated player names.`);
    } else {
      console.log(`\n⚠️  WARNING: Still ${remainingPtags} P-tags remaining`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

fixDuplicates();
