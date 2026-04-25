# Database Cleanup Report: Monaghan v Donegal

## Executive Summary
The database contains **479 events** with **61 remaining P-tags** (player numbers instead of names). Additionally, there are **244 duplicate events** from failed update attempts. The root cause is an RLS policy blocking DELETE operations.

## What Happened

### Original State
- Initial migration created **357 events** with P-tags (P1-P26) as player identifiers
- 61 of these events in the Monaghan v Donegal game still have P-tags

### Update Attempts
Four separate update scripts were run:
1. **update-complete-rosters.js** (first attempt) - reported 61 updates
2. **3 additional attempts** (likely from admin dashboard manual updates)

### Current Problem
- **Each update attempt added NEW rows** with correct player names
- **But DELETE operations failed silently** due to RLS policy restrictions
- Result: Now have 479 events (up from 357), with duplicates:
  - 235 unique event signatures
  - 244 duplicate versions (up to 5 copies of the same event)

### Example (Donegal P15 at "1H 01:13")
```
ID: 6     | Player: "P15"          | Created: 2026-04-25 08:20:24 (ORIGINAL)
ID: 4727  | Player: "Shea Malone"  | Created: 2026-04-25 10:07:07 (Update 1)
ID: 4788  | Player: "Shea Malone"  | Created: 2026-04-25 10:12:06 (Update 2)
ID: 4849  | Player: "Shea Malone"  | Created: 2026-04-25 10:14:41 (Update 3)
ID: 4910  | Player: "Shea Malone"  | Created: 2026-04-25 10:49:52 (Update 4)
```

## RLS Policy Issue

### Current Behavior
- `INSERT` operations: ✅ Working
- `UPDATE` operations: ❌ Blocked (expected)
- `DELETE` operations: ❌ **Not working** (unexpected!)

### The Problem
The anonymous API key's RLS policy is not allowing DELETE operations, even though the configuration indicates it should.

### Test Results
```
DELETE command: Reports success
Actual rows deleted: 0
Rows remaining in database: No change
```

## Events Remaining with P-tags

| Team | P-tags | Count | Player | Events |
|------|--------|-------|--------|--------|
| DONEGAL | P2, P5, P7, P9, P12, P13, P14, P15, P19, P21, P23 | 33 | 11 tags | 33 events |
| MONAGHAN | P1, P3, P4, P6, P9, P10, P11, P13, P14, P15, P17, P19, P24 | 28 | 13 tags | 28 events |
| **TOTAL** | | **61** | **26 unique tags** | **61 events** |

## Complete Mapping (All Players Updated)

### MONAGHAN (26 players)
```
P1→Rory Beggan, P2→Darragh McElearney, P3→Ryan O'Toole, P4→Ryan Wylie, 
P5→Cameron Dowd, P6→Dessie Ward, P7→Aaron Carey, P8→Micheál McCarville, 
P9→Karl Gallagher, P10→Fionan Carolan, P11→Micheál Bannigan, P12→Oisín McGorman, 
P13→David Garland, P14→Andrew Woods, P15→Stephen O'Hanlon, P16→Kian Mulligan, 
P17→Louis Kelly, P18→Alistair Stewart, P19→Robbie Hanratty, P20→Ryan Mohan, 
P21→Ronan Boyle, P22→Ryan Duffy, P23→Darragh Treanor, P24→Jack McCarron, 
P25→Eddie Walsh, P26→Shane Hanratty
```

### DONEGAL (26 players)
```
P1→Gavin Mulreany, P2→Caolan McColgan, P3→Brendan McCole, P4→Mark Curran, 
P5→Eoghan Ban Gallagher, P6→Caolan McGonagle, P7→Seán Martin, P8→Hugh McFadden, 
P9→Michael Langan, P10→Paul O'Hare, P11→Shane O'Donnell, P12→Peadar Mogan, 
P13→Conor O'Donnell, P14→Jason McGee, P15→Shea Malone, P16→Pádraig Mac Giolla Bhríde, 
P17→Cormac Gallagher, P18→Oisín Caulfield, P19→Ryan McHugh, P20→Seanan Carr, 
P21→Finnbarr Roarty, P22→Stephen McMenamin, P23→Jamie Brennan, P24→Eoin McHugh, 
P25→Kevin Muldoon, P26→Max Campbell
```

## Solution Required

### Step 1: Fix RLS Policy (CRITICAL)
Go to Supabase Dashboard:
1. Select your project (uycptgjngtoxuawnsdzi)
2. Navigate to **Authentication** → **Policies**
3. Find the `events` table RLS policies
4. Check the DELETE policy
5. Ensure it allows unauthenticated users to delete their own rows, OR
6. Create a new permissive policy:
   ```sql
   CREATE POLICY "Allow delete for anon" ON events
   FOR DELETE USING (auth.role() = 'anon');
   ```

### Step 2: Execute Cleanup (After RLS Fix)
Once RLS is fixed, run:
```bash
node cleanup-and-deduplicate.js
```

This will:
- Keep the most recent updated version of each unique event
- Delete 244 duplicate versions
- Remove all P-tag rows

### Step 3: Verify Results
```bash
node diagnose-ptags.js
```

Should show: `Remaining P-tags: 0`

## Workaround (If RLS Can't Be Fixed)

If the RLS policy can't be modified, use the **Supabase Admin Key**:

1. Get your **Supabase Service Role Key** from:
   - Supabase Dashboard → Project Settings → API Keys
   - Look for "service_role" key (starts with "eyJ...")

2. Create `cleanup-with-admin.js` using the service role key instead of the anonymous key

3. Run the cleanup script with admin permissions

## Files Generated

- `diagnose-ptags.js` - Scans for remaining P-tags
- `update-ptags-with-verification.js` - Robust update with verification
- `cleanup-and-deduplicate.js` - Removes duplicates and P-tags
- `analyze-ptag-events.js` - Detailed analysis of P-tag distribution

## Prevention for Future

To prevent this from happening again:

1. **Use Delete + Insert Pattern CORRECTLY**:
   - Must actually delete old rows before inserting new ones
   - Need proper error handling on both operations

2. **Implement Verification**:
   - Always verify changes after operations
   - Check record counts before/after
   - Don't rely on operation responses alone

3. **Dashboard Safety**:
   - Add validation in admin panel to detect remaining P-tags
   - Warn user if any P-tags remain before saving
   - Implement a final verification query

4. **Better RLS Design**:
   - Test DELETE operations during initial setup
   - Don't assume policies work as configured
   - Use admin key for sensitive operations

---
**Generated:** 2026-04-25 10:50 UTC  
**Game:** Monaghan v Donegal, Round 7 (March 22, 2026)  
**Database:** Supabase (uycptgjngtoxuawnsdzi)
