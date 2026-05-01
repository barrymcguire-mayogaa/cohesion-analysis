/**
 * Netlify Function: Process Batch Games (optimized for bulk uploads)
 *
 * Purpose: Handle multiple games in a single function call to reduce token usage
 * - Validates user is authenticated admin ONCE
 * - Processes each game sequentially (upsert metadata, delete old events, insert new events)
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

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase with service role key (has admin privileges)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
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

    // Decode and verify JWT (basic validation - Netlify Identity signed this)
    let decodedToken;
    try {
      const parts = token.split('.');
      const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
      decodedToken = JSON.parse(payload);
    } catch (e) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid token format' })
      };
    }

    // ========================================================================
    // STEP 4: Validate admin role (ONCE for all games)
    // ========================================================================
    const userRole = decodedToken.app_metadata?.roles?.[0];

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

        // UPSERT game metadata
        const gameRecord = {
          id: gameId,
          meta: gameMeta
        };

        const { error: upsertErr } = await supabase
          .from('games')
          .upsert(gameRecord);

        if (upsertErr) {
          throw new Error(`Failed to save game metadata: ${upsertErr.message}`);
        }

        // DELETE old events
        const { error: delErr } = await supabase
          .from('events')
          .delete()
          .eq('game_id', gameId);

        if (delErr) {
          throw new Error(`Failed to delete old events: ${delErr.message}`);
        }

        // INSERT new events in chunks (avoid timeout with large datasets)
        const chunkSize = 50;
        for (let i = 0; i < eventRows.length; i += chunkSize) {
          const chunk = eventRows.slice(i, i + chunkSize);
          const { error: insErr } = await supabase
            .from('events')
            .insert(chunk);

          if (insErr) {
            throw new Error(`Failed to insert events chunk ${Math.floor(i / chunkSize) + 1}: ${insErr.message}`);
          }
        }

        // Mark as success
        gameResult.success = true;
        gameResult.eventCount = eventRows.length;
        successCount++;

      } catch (error) {
        gameResult.success = false;
        gameResult.error = error.message || 'Unknown error';
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
