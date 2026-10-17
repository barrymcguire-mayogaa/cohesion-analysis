/**
 * Netlify Function: Process Game (secure atomic game storage)
 *
 * Purpose: Handle all game insert/update/delete operations atomically
 * - Validates user is authenticated admin
 * - Replaces the game's events (netlify/lib/replaceEvents.js: insert 500 a request,
 *   count, then delete the old rows — never half-empty) and reports the stored count
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
const { verifiedClaims, UNAUTH } = require('../lib/identity');
const { replaceEvents } = require('../lib/replaceEvents');


const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase with service role key (has admin privileges)
// Service role key is protected as a Netlify environment variable, never exposed to browser
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

    // Claims verified by Netlify (signature + expiry) — never decode the header ourselves
    const decodedToken = verifiedClaims(context);
    if (!decodedToken) return UNAUTH;

    // ========================================================================
    // STEP 4: Validate admin role
    // ========================================================================
    // Netlify Identity stores roles in app_metadata.roles array
    const userRole = ((decodedToken.app_metadata && decodedToken.app_metadata.roles) || []).map(r => String(r).toLowerCase()).includes('admin') ? 'admin' : (decodedToken.app_metadata?.roles?.[0] || 'none');

    if (userRole !== 'admin') {
      console.error('Admin role validation failed:', {
        roles: decodedToken.app_metadata?.roles,
        userRole: userRole,
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
    // Store entire gameMeta as JSON in the 'meta' column (existing schema)
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

    // ========================================================================
    // STEP 6+7: Replace events (skipped entirely in skipXml reparse mode —
    // existing events are already correct and must be left untouched, not
    // re-inserted on top of themselves)
    // ========================================================================
    // Replace-safe and fast (netlify/lib/replaceEvents.js): the new rows go in first (500 a request), are COUNTED,
    // and only then are the old rows removed — a failure leaves the game as it was, never half-empty.
    let stored = null;
    if (!(skipXml && isReparse)) {
      const r = await replaceEvents(supabase, gameId, eventRows);
      if (!r.ok) {
        console.error('processGame replace failed:', r);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: r.error, stage: r.stage, stored: r.stored, expected: r.expected, rolledBack: !!r.rolledBack })
        };
      }
      stored = r.stored;
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
        stored,
        expected: eventRows.length,
        message: `Game processed successfully: ${stored == null ? 'events unchanged' : stored + ' events stored'}`
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
