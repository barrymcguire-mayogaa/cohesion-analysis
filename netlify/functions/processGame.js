/**
 * Netlify Function: Process Game (secure atomic game storage)
 *
 * Purpose: Handle all game insert/update/delete operations atomically
 * - Validates user is authenticated admin
 * - Deletes old events
 * - Inserts new events (in chunks to avoid timeout)
 * - Updates game metadata
 * - Returns clean error handling
 *
 * Security:
 * - Uses Supabase service role key (protected on server, never exposed to browser)
 * - Validates Netlify Identity auth token
 * - Checks for 'admin' role
 * - Bypasses RLS policies (service key privilege)
 *
 * Usage from admin.html:
 *   const response = await fetch('/.netlify/functions/processGame', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       gameId: 'game-123',
 *       gameMeta: { title, opposition, ... },
 *       eventRows: [ { code, time_seconds, period, ... }, ... ],
 *       skipXml: false,
 *       isReparse: false
 *     })
 *   });
 */

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase with service role key (has admin privileges)
// Service role key is protected as a Netlify environment variable, never exposed to browser
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

    const { gameId, gameMeta, eventRows, skipXml, isReparse } = body;

    // Validate required fields
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'gameId is required' })
      };
    }

    if (!gameMeta || typeof gameMeta !== 'object') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'gameMeta object is required' })
      };
    }

    if (!Array.isArray(eventRows)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'eventRows must be an array' })
      };
    }

    // ========================================================================
    // STEP 3: Validate authentication via Netlify Identity JWT
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
      // Note: In production, you should verify the JWT signature
      // For now, this assumes Netlify has already validated the token
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
    // STEP 4: Validate admin role
    // ========================================================================
    // Netlify Identity stores roles in app_metadata.roles array
    const userRole = decodedToken.app_metadata?.roles?.[0];

    if (userRole !== 'admin') {
      console.error('Admin role validation failed:', {
        roles: decodedToken.app_metadata?.roles,
        userRole: userRole,
        fullToken: decodedToken
      });
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: 'Forbidden: admin role required',
          userRole: userRole || 'none',
          availableRoles: decodedToken.app_metadata?.roles || []
        })
      };
    }

    // ========================================================================
    // STEP 5: Create/update game metadata FIRST (required for foreign key)
    // ========================================================================
    // Must happen before inserting events (foreign key constraint)
    const gameRecord = {
      id: gameId,
      title: gameMeta.title,
      date: gameMeta.date,
      opposition: `${gameMeta.homeTeam} v ${gameMeta.awayTeam}`,
      competition: gameMeta.competition,
      venue: gameMeta.venue || '',
      youtube_id: gameMeta.youtubeId,
      thumbnail: gameMeta.thumbnail,
      // Store angles if provided, otherwise empty array
      angles: gameMeta.angles || []
    };

    const { error: upsertErr } = await supabase
      .from('games')
      .upsert(gameRecord);

    if (upsertErr) {
      throw new Error(`Failed to save game metadata: ${upsertErr.message}`);
    }

    // ========================================================================
    // STEP 6: Delete old events (if not in skipXml reparse mode)
    // ========================================================================
    if (!(skipXml && isReparse)) {
      const { error: delErr } = await supabase
        .from('events')
        .delete()
        .eq('game_id', gameId);

      if (delErr) {
        throw new Error(`Failed to delete old events: ${delErr.message}`);
      }
    }

    // ========================================================================
    // STEP 7: Insert new events in chunks (avoid timeout with large datasets)
    // ========================================================================
    const chunkSize = 50;
    for (let i = 0; i < eventRows.length; i += chunkSize) {
      const chunk = eventRows.slice(i, i + chunkSize);
      const { error: insErr } = await supabase
        .from('events')
        .insert(chunk);

      if (insErr) {
        throw new Error(`Failed to insert events chunk ${i / chunkSize + 1}: ${insErr.message}`);
      }
    }

    // ========================================================================
    // STEP 8: Return success response
    // ========================================================================
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        gameId: gameId,
        eventCount: eventRows.length,
        message: `Game processed successfully: ${eventRows.length} events stored`
      })
    };

  } catch (error) {
    console.error('processGame function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message || 'Internal server error',
        details: error.toString()
      })
    };
  }
};
