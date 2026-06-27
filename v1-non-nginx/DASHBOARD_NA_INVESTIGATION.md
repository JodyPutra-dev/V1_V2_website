# Dashboard N/A Parameters Investigation

## Issue
Dashboard shows "N/A" for: Specific Gravity, Turbidity NTU, Turbidity Level, Warna Dasar
But shows correct: pH, TDS, RGB values

## Evidence
- Browser console: `{ph: 7.2, tds: 900, red: 255, green: 200, blue: 100}` (4 fields missing)
- CSV upload claims: "processed: 5, failed: 0"
- Prediction results table: Shows all 9 fields correctly
- Dashboard latest prediction: Shows only 5/9 fields

## Investigation Steps (DO NOT SKIP)

### Step 1: Check MongoDB Raw Data
```bash
# Connect to MongoDB
mongosh "mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection"

# Find latest prediction for user
db.predictions.findOne(
  {user: ObjectId("682b0ad62536031edb517c1c")},
  {parameters: 1, penyakit: 1, date: 1}
).sort({date: -1})

# Check parameter keys
db.predictions.findOne(
  {user: ObjectId("682b0ad62536031edb517c1c")}
).parameters
```
**Expected**: Should show all 9 keys (ph, tds, specificGravity, turbidityNTU, red, green, blue, turbidityLevel, warnaDasar)
**If missing**: CSV save bug (normalization incomplete)
**If lowercase**: Frontend fallback order wrong

### Step 2: Check Backend /stats Response
```bash
# Restart prediction service with logs
cd /var/www/html/HIBAH/deployments/v1-non-nginx
./stop.sh
./start.sh

# Trigger /stats call from browser (Dashboard refresh)
# Watch logs:
tail -f logs/prediction.log | grep "STATS-DEBUG"
```
**Look for**:
- `[STATS-DEBUG] First prediction raw parameters:` → MongoDB doc
- `[STATS-DEBUG] toJSON applied:` → What API sends
- Compare keys in both

### Step 3: Check Frontend Console
```
Browser F12 → Console → Look for:
[DASHBOARD] Parameter keys: ["ph", "tds", "red", "green", "blue"]
[DASHBOARD] specificGravity value: undefined
[DASHBOARD] specificgravity (lowercase) value: undefined
```
**If both undefined**: Data not in API response (backend issue)
**If lowercase exists**: Frontend fallback order wrong (check line 522)

### Step 4: Check CSV Upload Logs
```bash
# Upload CSV again, watch:
tail -f logs/prediction.log | grep "CSV-SAVE"
```
**Look for**:
- `[CSV-SAVE] Normalized parameter keys:` → Should show all 9
- `[CSV-SAVE] MongoDB saved parameter keys:` → Should match normalized
- If mismatch: Mongoose schema dropping fields or normalization incomplete

## Root Cause Hypotheses (Test in Order)

### Hypothesis A: keyNormalizationMap Incomplete (Most Likely)
**File**: `prediction-service.js` line 991
**Check**: Does map include all 4 missing fields?
```javascript
const keyNormalizationMap = {
  'specificgravity': 'specificGravity',  // ← Check this exists
  'turbidityntu': 'turbidityNTU',        // ← Check this exists
  'turbiditylevel': 'turbidityLevel',    // ← Check this exists
  'warnadasar': 'warnaDasar'             // ← Check this exists
};
```
**If missing**: Add to map
**If present**: Check next hypothesis

### Hypothesis B: Mongoose Schema Strict Mode
**File**: `prediction-service.js` line 224-236 (parameters field)
**Check**: Is `parameters` defined as `Mixed` or explicit fields?
**Current**: Explicit fields (ph, tds, specificGravity, etc.)
**Issue**: If CSV sends lowercase keys, Mongoose ignores them (strict mode)
**Fix**: Either normalize keys OR change schema to `Mixed`

### Hypothesis C: toJSON Transform Stripping Fields
**File**: `prediction-service.js` line 260-272
**Check**: Does transform modify `ret.parameters`?
**Current**: Only touches `__v`, `id`, `penyakit`
**Unlikely**: But verify with logs

### Hypothesis D: Frontend Fallback Order Wrong
**File**: `Dashboard.js` line 522-556
**Check**: Order of `specificGravity || specificgravity`
**Current**: camelCase first
**If MongoDB has lowercase**: Reverse to `specificgravity || specificGravity`

## Testing After Fix
1. Upload new CSV → check logs for all 9 keys saved
2. Query MongoDB → verify all 9 fields present
3. Refresh Dashboard → verify no "N/A"
4. Check existing predictions → run migration if needed

## Reference Files
- `CSV_KEY_NORMALIZATION_FIX.md` (prior fix attempt)
- `fix-missing-csv-parameters.js` (migration script)
- `VERSION_1_BOTTLENECKS.md` (confirms no .lean() is intentional)
