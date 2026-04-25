/**
 * Migration script: Import games and events from local JSON files to Supabase
 * Usage: node migrate-to-supabase.js
 */

const fs = require('fs');
const path = require('path');

// Supabase config (from your HTML files)
const SUPABASE_URL = 'https://uycptgjngtoxuawnsdzi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5Y3B0Z2puZ3RveHVhd25zZHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNjk5NDAsImV4cCI6MjA5MjY0NTk0MH0.PLmf6zZ1Aa_v98agzKO_Sje3Aak6n2uZOX9rQsfSV0E';

// Initialize Supabase client
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const gamesDir = path.join(__dirname, 'games');

async function migrateGames() {
  try {
    console.log('🔄 Starting migration...\n');

    // Load games.json
    const gamesJsonPath = path.join(gamesDir, 'games.json');
    const gamesData = JSON.parse(fs.readFileSync(gamesJsonPath, 'utf-8'));
    const games = gamesData.games;

    console.log(`📊 Found ${games.length} games to migrate\n`);

    let successCount = 0;
    let errorCount = 0;

    // Process each game
    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      try {
        // Insert game metadata
        const { error: gameError } = await supabase
          .from('games')
          .upsert({ id: game.id, meta: game });

        if (gameError) throw gameError;

        // Load and insert events for this game
        const eventFilePath = path.join(gamesDir, `${game.id}.json`);

        if (fs.existsSync(eventFilePath)) {
          const events = JSON.parse(fs.readFileSync(eventFilePath, 'utf-8'));

          if (Array.isArray(events) && events.length > 0) {
            // Insert events in chunks of 500
            const chunkSize = 500;
            for (let j = 0; j < events.length; j += chunkSize) {
              const chunk = events.slice(j, j + chunkSize);
              const eventRows = chunk.map(e => ({ game_id: game.id, data: e }));

              const { error: eventsError } = await supabase
                .from('events')
                .insert(eventRows);

              if (eventsError) throw eventsError;
            }

            console.log(`✅ [${i + 1}/${games.length}] ${game.title} (${events.length} events)`);
          } else {
            console.log(`⚠️  [${i + 1}/${games.length}] ${game.title} (no events file)`);
          }
        } else {
          console.log(`⚠️  [${i + 1}/${games.length}] ${game.title} (no events file)`);
        }

        successCount++;
      } catch (error) {
        console.error(`❌ [${i + 1}/${games.length}] ${game.title} - Error: ${error.message}`);
        errorCount++;
      }
    }

    console.log(`\n✨ Migration complete!`);
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}`);

  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

// Run migration
migrateGames();
