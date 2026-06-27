# Dashboard Parameters Diagnostic Guide

## Issue
Dashboard shows N/A for: Specific Gravity, Turbidity NTU, Turbidity Level, Warna Dasar
Working fields: pH (7.2), TDS (900), RGB (255,200,100)

## Data Flow Trace
1. **Frontend Request**: Dashboard.js line 139 → `predictionAPI.getStats()` → `/api/predict/stats`
2. **Backend Processing**: prediction-service.js line 431-497:
   - Fetches predictions: `Prediction.findForUser(userId)` (line 448)
   - Returns: `recentPredictions` array (line 486)
   - Logs added (line 450-476): Raw parameters, keys, toJSON output
3. **Frontend Receive**: Dashboard.js line 140 → `processStatsData()` (line 42-81)
4. **Frontend Display**: Lines 528, 532, 558, 562 with fallbacks: `specificgravity || specificGravity || parameters?.specificGravity || 'N/A'`

## Diagnostic Steps (USER MUST DO THIS)

### Step 1: Check Browser Console
```
1. Open http://localhost:7764 → Dashboard
2. Open Browser DevTools (F12) → Console tab
3. Look for these logs:
   [DASHBOARD] Full parameters object: {...}
   [DASHBOARD] specificGravity value: ...
   [DASHBOARD] specificgravity (lowercase) value: ...
   [DASHBOARD-DEBUG] Raw parameters JSON: {...}
   [DASHBOARD-DEBUG] Check if nested: ...
```

### Step 2: Provide Console Output
Copy the FULL console output showing:
- `[DASHBOARD] Parameter keys: [...]` (what keys exist?)
- `[DASHBOARD] Full parameters object: {...}` (actual structure)
- `[DASHBOARD-DEBUG] Raw parameters JSON: {...}` (formatted JSON)
- `[DASHBOARD-DEBUG] Check if nested: ...` (if parameters.parameters exists)

### Step 3: Check MongoDB Directly
```bash
mongosh
use urine-disease-detection
db.predictions.findOne(
  {user: ObjectId("682b0ad62536031edb517c1c")}, 
  {parameters: 1, _id: 0}
).pretty()
```
Provide output showing actual MongoDB `parameters` structure.

### Step 4: Check Backend Logs
```bash
cd /var/www/html/HIBAH/deployments/v1-non-nginx
tail -f logs/prediction.log | grep -E "STATS-DEBUG|CSV-SAVE"
```
Look for:
- `[STATS-DEBUG] Parameter keys:` (what MongoDB returns)
- `[CSV-SAVE] MongoDB saved parameter keys:` (what was saved from CSV)

## Possible Causes (Based on Code)

### Hypothesis A: CSV Normalization Incomplete
- `prediction-service.js` line ~991 has `keyNormalizationMap` for CSV
- Map may be missing `specificgravity → specificGravity` mapping
- Result: MongoDB has lowercase keys, frontend expects camelCase
- **Fix**: Update normalization map in `prediction-service.js`

### Hypothesis B: Nested Parameters
- Mongoose `toJSON` transform (line 260-272) may create `{parameters: {parameters: {...}}}`
- Frontend accesses `stats.latest.parameters.specificGravity` but actual path is `stats.latest.parameters.parameters.specificGravity`
- **Fix**: Add `?.parameters?.specificGravity` fallback (already in current plan)

### Hypothesis C: Fields Missing in MongoDB
- CSV save (prediction-service.js line ~1000-1100) may skip normalized fields
- MongoDB doc only has `{ph, tds, red, green, blue}` - missing SG/NTU/etc.
- **Fix**: Run `fix-missing-csv-parameters.js` migration OR update CSV save logic

### Hypothesis D: Wrong Key Casing in MongoDB
- MongoDB has lowercase (`specificgravity`) but frontend checks camelCase first
- Current fallback: `specificgravity || specificGravity` (lowercase first)
- **Fix**: Already implemented in Dashboard.js lines 528, 532, 558, 562

## Next Steps
1. **USER**: Provide browser console output from Step 1
2. **USER**: Provide MongoDB query output from Step 3
3. **USER**: Provide backend log output from Step 4
4. **DEVELOPER**: Based on actual structure, apply targeted fix:
   - If Hypothesis A: Update keyNormalizationMap
   - If Hypothesis B: Fallback already added in plan (nested check)
   - If Hypothesis C: Run migration + fix CSV save
   - If Hypothesis D: Already fixed (lowercase first in fallback)

## Files to Check
- Frontend: `Dashboard.js` (display logic line 528-562)
- Backend: `prediction-service.js` (CSV save ~line 991, stats endpoint line 431-497)
- Migration: `fix-missing-csv-parameters.js` (derives missing fields)
- Logs: `logs/prediction.log` (backend stats debug line 450-476)

## Testing Commands
```bash
# Check if keyNormalizationMap has all fields
grep -A 20 "keyNormalizationMap" /var/www/html/HIBAH/deployments/v1-non-nginx/microservices/prediction/prediction-service.js

# Test CSV upload with full logging
tail -f logs/prediction.log | grep CSV-SAVE
# Then upload CSV file via frontend

# Run migration if MongoDB missing fields
node fix-missing-csv-parameters.js
```

## Expected Diagnostic Output Examples

### Good (All 9 Parameters Present)
```javascript
[DASHBOARD] Parameter keys: (9) ["ph", "tds", "specificGravity", "turbidityNTU", "red", "green", "blue", "turbidityLevel", "warnaDasar"]
[DASHBOARD-DEBUG] Check if nested: undefined  // Not nested
```

### Bad (Only 5 Parameters)
```javascript
[DASHBOARD] Parameter keys: (5) ["ph", "tds", "red", "green", "blue"]
[DASHBOARD] specificGravity value: undefined
[DASHBOARD] specificgravity (lowercase) value: undefined
// → Hypothesis C: Fields missing in MongoDB
```

### Nested Structure (Hypothesis B)
```javascript
[DASHBOARD-DEBUG] Check if nested: {ph: 7.2, tds: 900, ...}  // Nested!
// → Need to access parameters.parameters.specificGravity
```

## Related Fixes
- `CSV_KEY_NORMALIZATION_FIX.md`: Previous normalization attempt
- `MISSING_PARAMETERS_FIX.md`: Migration script docs
- `DASHBOARD_PARAMETER_DISPLAY_FIX.md`: Earlier display fix
- `DASHBOARD_NA_INVESTIGATION.md`: Comprehensive investigation guide
