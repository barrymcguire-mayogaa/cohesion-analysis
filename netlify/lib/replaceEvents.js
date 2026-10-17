/**
 * Replace every event of a game — used by processGame (single upload) and processBatchGames.
 *
 * WHY: the old code deleted the game's events first and then inserted the new ones 50 rows per request, one request
 * after another. A 1400-event game needed ~29 round-trips; the function hit Netlify's time limit after ~20 of them
 * and the game was left with its first ~1000 events and nothing after (the 2026 AISFC Final stopped at ~57:00).
 *
 * NOW:
 *   1. note the highest id the game has now (events.id is a bigserial, so every new row gets a higher id);
 *   2. insert the new rows, CHUNK rows per request (a Sportscode event row is ~0.4 KB, the largest ~0.6 KB, so
 *      500 rows ≈ 0.2–0.3 MB a request; a 1400-event game is 3 requests instead of 29);
 *   3. count the new rows (id above the old highest) and compare with what was sent;
 *   4. only then delete the old rows (id at or below the old highest);
 *   5. count the game's rows once more.
 * A failure in 2 or 3 on a game that HAD events removes the new rows again, so the game is left exactly as it was
 * (never half-empty, never doubled): rolledBack:true. On a new game (no events before) the rows that did arrive are
 * kept, so "Repair missing events" (add-only) can add the rest.
 * A failure in 4 leaves old + new rows and is reported; uploading again clears it (the old highest id then covers both).
 *
 * Returns {ok:true, stored, expected} or {ok:false, error, stored, expected, stage, rolledBack}.
 * stored = the number of the game's events after the call when known, else null.
 */
const CHUNK = 500;

async function countRows(supabase, gameId, aboveId) {
  let q = supabase.from('events').select('id', { count: 'exact', head: true }).eq('game_id', gameId);
  if (aboveId != null) q = q.gt('id', aboveId);
  const { count, error } = await q;
  if (error) throw new Error('could not count the stored events: ' + error.message);
  return count == null ? 0 : count;
}

async function replaceEvents(supabase, gameId, eventRows, opts) {
  const chunk = (opts && opts.chunk) || CHUNK;
  const expected = eventRows.length;

  // 1. the game's highest event id now (null: no events yet)
  const { data: top, error: topErr } = await supabase.from('events').select('id')
    .eq('game_id', gameId).order('id', { ascending: false }).limit(1);
  if (topErr) return { ok: false, stage: 'read', expected, stored: null, error: 'Could not read the game\'s current events: ' + topErr.message + '. Nothing was changed.' };
  const oldTop = (top && top.length) ? top[0].id : null;

  // undo a replace that did not complete — only when the game had events before (they stay as they were)
  const undo = async () => {
    if (oldTop == null) return false;
    try { const { error } = await supabase.from('events').delete().eq('game_id', gameId).gt('id', oldTop); return !error; }
    catch (_) { return false; }
  };
  const fail = async (stage, arrived, why) => {
    const rolledBack = await undo();
    let stored = null; try { stored = await countRows(supabase, gameId, null); } catch (_) {}
    const tail = rolledBack ? ' The upload was undone: the game keeps its previous events, nothing was changed.'
      : oldTop == null ? (arrived != null ? ` Only ${arrived} of ${expected} events were saved — use Repair missing events.` : '') : '';
    return { ok: false, stage, expected, stored, rolledBack, why, error: why + tail };
  };

  // 2. insert
  for (let i = 0; i < eventRows.length; i += chunk) {
    let insErr;
    try { ({ error: insErr } = await supabase.from('events').insert(eventRows.slice(i, i + chunk))); }
    catch (e) { insErr = e; }
    if (insErr) return fail('insert', i, `Failed to insert events ${i + 1}–${Math.min(i + chunk, expected)} of ${expected}: ${insErr.message}.`);
  }

  // 3. every row arrived?
  let added;
  try { added = await countRows(supabase, gameId, oldTop); }
  catch (e) { return fail('count', null, e.message + '.'); }
  if (added !== expected) return fail('count', added, `The stored events do not add up: ${added} stored, ${expected} sent.`);

  // 4. now the old rows can go
  if (oldTop != null) {
    const { error: delErr } = await supabase.from('events').delete().eq('game_id', gameId).lte('id', oldTop);
    if (delErr) return { ok: false, stage: 'delete', expected, stored: null, error: `The ${expected} new events were stored, but the old ones could not be removed (${delErr.message}) — the game now has both. Upload again to clear it.` };
  }

  // 5. final count
  let stored;
  try { stored = await countRows(supabase, gameId, null); }
  catch (e) { return { ok: false, stage: 'final', expected, stored: null, error: e.message }; }
  if (stored !== expected) return { ok: false, stage: 'final', expected, stored, error: `The game has ${stored} events stored, but ${expected} were sent.` };
  return { ok: true, stored, expected };
}

module.exports = { replaceEvents, countRows, CHUNK };
