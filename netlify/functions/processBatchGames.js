/**
 * Netlify Function: Process Batch Games (optimized for bulk uploads)
 *
 * Purpose: Handle multiple games in a single function call to reduce token usage
 * - Validates user is authenticated admin ONCE
 * - Processes each game sequentially (upsert metadata, then replace its events safely —
 *   netlify/lib/replaceEvents.js: insert 500 a request, count, then delete the old rows)
 * - The pages send ONE game per request, so no request nears the 6 MB payload or the time limit
 * - Returns array of results (per-game success/failure)
 * - Continues processing remaining games if one fails
 *
 * Security:
 * - Uses Supabase service role key (protected on server, never exposed to browser)
 * - Validates Netlify Identity auth token ONCE for all games
 * - Checks for 'admin' role
 * - Bypasses RLS policies (service key privilege)
 *
 * CRITICAL: Validation happens BEFORE any database writes to prevent orphaned records
 */
const { verifiedClaims, UNAUTH } = require('../lib/identity');
const { replaceEvents } = require('../lib/replaceEvents');


const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase with service role key (has admin privileges)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event, context) => {
  try {
    // ========================================================================
    // STEP 1: Validate HTTP method
    // ========================================================================
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    // ========================================================================
    // STEP 2: Parse request body
    // ========================================================================
    let body;
    try {
      body = JSON.parse(event.body);
    } catch (e) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON body' })
      };
    }

    const { games } = body;

    // Validate required field
    if (!Array.isArray(games) || games.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'games array is required and must not be empty' })
      };
    }

    // ========================================================================
    // STEP 3: Validate authentication via Netlify Identity JWT (ONCE for all games)
    // ========================================================================
    const authHeader = event.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Authentication required' })
      };
    }

    // Claims verified by Netlify (signature + expiry) — never decode the header ourselves
    const decodedToken = verifiedClaims(context);
    if (!decodedToken) return UNAUTH;

    // ========================================================================
    // STEP 4: Validate admin role (ONCE for all games)
    // ========================================================================
    const userRole = ((decodedToken.app_metadata && decodedToken.app_metadata.roles) || []).map(r => String(r).toLowerCase()).includes('admin') ? 'admin' : (decodedToken.app_metadata?.roles?.[0] || 'none');

    if (userRole !== 'admin') {
      console.error('Admin role validation failed:', {
        roles: decodedToken.app_metadata?.roles,
        userRole: userRole
      });
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: 'Forbidden: admin role required',
          userRole: userRole || 'none'
        })
      };
    }

    // ========================================================================
    // STEP 5: Process each game sequentially
    // ========================================================================
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (const game of games) {
      const { gameId, gameMeta, eventRows } = game;
      const gameResult = {
        gameId: gameId,
        success: false,
        eventCount: 0,
        error: null
      };

      try {
        // ====================================================================
        // VALIDATION: Reject game BEFORE touching Supabase if any field invalid
        // ====================================================================

        // Validate required fields for this game
        if (!gameId) {
          throw new Error('gameId is required');
        }
        if (!gameMeta || typeof gameMeta !== 'object') {
          throw new Error('gameMeta object is required');
        }
        if (!Array.isArray(eventRows)) {
          throw new Error('eventRows must be an array');
        }

        // CRITICAL: Reject uploads with 0 events (prevents corrupt game records)
        if (eventRows.length === 0) {
          throw new Error(`${gameId}: XML parsed 0 events. Upload REJECTED to prevent corrupt database records.`);
        }

        // CRITICAL: Validate event shape BEFORE saving metadata
        // Events must be: { game_id, data: {...} }
        for (let i = 0; i < eventRows.length; i++) {
          const evt = eventRows[i];
          if (!evt.game_id) {
            throw new Error(`${gameId}: Event ${i} missing game_id field. Event shape must be { game_id, data: {...} }`);
          }
          if (!evt.data || typeof evt.data !== 'object') {
            throw new Error(`${gameId}: Event ${i} missing or invalid data field. Event shape must be { game_id, data: {...} }`);
          }
        }

        // Validate gameMeta has required fields
        if (!gameMeta.date || typeof gameMeta.date !== 'string') {
          throw new Error(`${gameId}: gameMeta.date must be a string (YYYY-MM-DD format), got ${typeof gameMeta.date}`);
        }

        // ====================================================================
        // NOW that all validation passed, write to database
        // ====================================================================

        // The game's meta as it is now (null: a new game), so a failed update can put it back.
        const { data: prevRows, error: prevErr } = await supabase.from('games').select('id, meta').eq('id', gameId).limit(1);
        if (prevErr) throw new Error(`Could not read the stored game: ${prevErr.message}`);
        const prev = (prevRows && prevRows[0]) || null;

        // UPSERT game metadata (required first: events reference the game)
        const { error: upsertErr } = await supabase
          .from('games')
          .upsert({ id: gameId, meta: gameMeta });
        if (upsertErr) {
          throw new Error(`Failed to save game metadata: ${upsertErr.message}`);
        }

        // Replace the events: insert 500 a request, count, then remove the old rows (netlify/lib/replaceEvents.js).
        // A failure leaves an existing game's events as they were (and puts its meta back); a new game is removed
        // again (ON DELETE CASCADE takes any rows that did arrive), so nothing half-saved is left behind.
        const r = await replaceEvents(supabase, gameId, eventRows);
        if (!r.ok) {
          const newRowsIn = r.stage === 'delete' || r.stage === 'final';   // the new events ARE stored: keep the new meta
          let note = '';
          if (newRowsIn) note = '';
          else if (prev) {
            const { error: backErr } = await supabase.from('games').upsert({ id: gameId, meta: prev.meta });
            note = backErr ? ` (its previous details could not be put back: ${backErr.message})` : '';
          } else {
            const { error: rmErr } = await supabase.from('games').delete().eq('id', gameId);
            note = rmErr ? ` (the new game could not be removed again: ${rmErr.message})` : ' Nothing was saved for this game.';
          }
          const e = new Error(((newRowsIn || prev) ? r.error : r.why) + note);
          e.counts = { stored: r.stored, expected: r.expected };
          throw e;
        }

        gameResult.success = true;
        gameResult.eventCount = r.stored;
        gameResult.stored = r.stored;
        gameResult.expected = r.expected;
        successCount++;

      } catch (error) {
        gameResult.success = false;
        gameResult.error = error.message || 'Unknown error';
        if (error.counts) { gameResult.stored = error.counts.stored; gameResult.expected = error.counts.expected; }
        failureCount++;
        console.error(`Error processing game ${gameId}:`, error);
      }

      results.push(gameResult);
    }

    // ========================================================================
    // STEP 6: Return batch results
    // ========================================================================
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: failureCount === 0,
        processed: successCount,
        failed: failureCount,
        total: games.length,
        results: results,
        message: `Batch processing complete: ${successCount} succeeded, ${failureCount} failed`
      })
    };

  } catch (error) {
    console.error('processBatchGames function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message || 'Internal server error',
        details: error.toString()
      })
    };
  }
};
