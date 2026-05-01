#!/usr/bin/env node

/**
 * One-time cleanup script to delete the 3 games with bad date format
 * Run this from the command line: node cleanup-bad-games.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Read .env file
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    envVars[match[1].trim()] = match[2].trim();
  }
});

const supabase = createClient(
  envVars.VITE_SUPABASE_URL,
  envVars.VITE_SUPABASE_ANON_KEY
);

const gameIdsToDelete = [
  'cork-cavan-2026-d2r1',
  'louth-cork-2026-d2r2',
  'offaly-cork-2026-d2r3'
];

async function deleteGames() {
  console.log('🗑️  Deleting bad games...\n');

  for (const gameId of gameIdsToDelete) {
    try {
      // Delete events for this game
      const { error: eventsError } = await supabase
        .from('events')
        .delete()
        .eq('game_id', gameId);

      if (eventsError) {
        console.log(`❌ Error deleting events for ${gameId}: ${eventsError.message}`);
        continue;
      }

      // Delete game metadata
      const { error: gameError } = await supabase
        .from('games')
        .delete()
        .eq('id', gameId);

      if (gameError) {
        console.log(`❌ Error deleting game ${gameId}: ${gameError.message}`);
        continue;
      }

      console.log(`✓ Deleted ${gameId}`);
    } catch (err) {
      console.error(`❌ Unexpected error for ${gameId}:`, err.message);
    }
  }

  console.log('\n✅ Cleanup complete!');
  process.exit(0);
}

deleteGames();
