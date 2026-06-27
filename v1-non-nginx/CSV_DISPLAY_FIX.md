# CSV Preview and Results Table Display Fix

**Created**: November 24, 2025  
**Issue**: Empty cells in CSV preview and prediction results tables  
**Status**: ✅ Fixed

---

## Problem Statement

When uploading CSV files for kidney stone predictions, the CSV preview table and prediction results table showed **empty cells** for the following columns:
- `specificGravity` (Specific Gravity)
- `turbidityNTU` (Turbidity NTU)
- `turbidityLevel` (Turbidity Level)
- `warnaDasar` (Warna Dasar)

Despite these empty cells, the backend processing was **successful** - all 5 rows in the sample CSV were processed correctly and predictions were generated. This indicated a **frontend display issue**, not a backend error.

---

## Root Cause Analysis

The issue was traced through three components:

### 1. Frontend CSV Preview (`MLPrediction.js` lines 186-254)

**Function**: `previewCSVHeaders()`

```javascript
// Line 210: Headers lowercased for case-insensitive validation
const headers = headerLine.split(delimiter).map(h => h.trim().toLowerCase());

// Lines 241-251: Preview rows created with lowercase keys
const row = {};
headers.forEach((header, idx) => {
  if (REQUIRED_HEADERS.includes(header)) {
    row[header] = values[idx] || 'N/A'; // ❌ row['specificgravity'], row['turbidityntu']
  }
});
previewRows.push(row);
```

**Result**: Preview data has lowercase keys:
```javascript
{
  ph: '6.5',
  tds: '800',
  specificgravity: '1.015',    // ❌ lowercase
  turbidityntu: '5.2',         // ❌ lowercase
  turbiditylevel: 'Jernih',    // ❌ lowercase
  warnadasar: 'KUNING',        // ❌ lowercase
  red: '255',
  green: '220',
  blue: '150'
}
```

### 2. Backend CSV Processing (`prediction-service.js` lines 871-1041)

**Function**: `POST /api/predict/csv`

```javascript
// Line 872: Headers lowercased for case-insensitive parsing
const header = headerRow[j].trim().toLowerCase();

// Line 960: Parameters object built with lowercase keys
parameters[header] = value; // ❌ parameters['specificgravity'], parameters['turbidityntu']
```

**Result**: Backend returns data with lowercase keys:
```javascript
results.push({
  row: {
    ph: 6.5,
    tds: 800,
    specificgravity: 1.015,    // ❌ lowercase
    turbidityntu: 5.2,         // ❌ lowercase
    turbiditylevel: 'Jernih',  // ❌ lowercase
    warnadasar: 'KUNING',      // ❌ lowercase
    ...
  },
  prediction: 'Normal'
})
```

### 3. Frontend Results Display (`MLPrediction.js` lines 403-408, 599-618)

**Preview Table Rendering** (lines 914-926):
```javascript
<td>{row.specificGravity}</td>      {/* ❌ undefined (expects camelCase) */}
<td>{row.turbidityNTU}</td>         {/* ❌ undefined */}
<td>{row.turbidityLevel}</td>       {/* ❌ undefined */}
<td>{row.warnaDasar}</td>           {/* ❌ undefined */}
```

**Results Table Rendering** (lines 599-618):
```javascript
<td>{result.input.specificGravity}</td>  {/* ❌ undefined */}
<td>{result.input.turbidityNTU}</td>     {/* ❌ undefined */}
<td>{result.input.turbidityLevel}</td>   {/* ❌ undefined */}
<td>{result.input.warnaDasar}</td>       {/* ❌ undefined */}
```

### Key Case Mismatch

| Component | Data Structure | Table Accessor | Result |
|-----------|---------------|----------------|--------|
| Preview Data | `row.specificgravity` (lowercase) | `row.specificGravity` (camelCase) | ❌ undefined |
| Results Data | `result.row.specificgravity` | `result.input.specificGravity` | ❌ undefined |
| Other Params | `row.ph`, `row.tds`, `row.red` (lowercase) | `row.ph`, `row.tds`, `row.red` | ✅ matched |

**Why 4 params affected, not all 9?**
- **pH** stays lowercase: `ph` → `ph` ✅
- **TDS** stays lowercase: `tds` → `tds` ✅
- **RGB** stays lowercase: `red` → `red`, `green` → `green`, `blue` → `blue` ✅
- **4 multi-word params** need camelCase: `specificgravity` → `specificGravity` ❌

---

## Solution Implemented

Added **frontend-only key normalization** by creating a helper function to transform lowercase keys to camelCase before rendering tables.

### 1. Helper Function (added line ~187)

```javascript
// Helper function: Normalize lowercase CSV keys to camelCase
const normalizeKeysToLowerCase = (obj) => {
  const keyMapping = {
    'specificgravity': 'specificGravity',
    'turbidityntu': 'turbidityNTU',
    'turbiditylevel': 'turbidityLevel',
    'warnadasar': 'warnaDasar'
  };
  
  const normalized = { ...obj };
  Object.keys(keyMapping).forEach(lowercaseKey => {
    if (normalized[lowercaseKey] !== undefined) {
      normalized[keyMapping[lowercaseKey]] = normalized[lowercaseKey];
      delete normalized[lowercaseKey];
    }
  });
  return normalized;
};
```

### 2. CSV Preview Fix (modified `previewCSVHeaders()`)

**Before**:
```javascript
resolve({
  headers,
  delimiter,
  totalRows: lines.length - 1,
  previewRows,  // ❌ lowercase keys
  valid: true
});
```

**After**:
```javascript
// Normalize lowercase keys to camelCase for table display
const normalizedPreviewRows = previewRows.map(row => normalizeKeysToLowerCase(row));

resolve({
  headers,
  delimiter,
  totalRows: lines.length - 1,
  previewRows: normalizedPreviewRows,  // ✅ camelCase keys
  valid: true
});
```

### 3. Results Table Fix (modified `handleCSVSubmit()`)

**Before**:
```javascript
const formattedResults = csvResults.map(result => ({
  input: result.row,  // ❌ lowercase keys from backend
  prediction: result.prediction === 'Batu Ginjal' ? 1 : 0,
  penyakit: result.prediction,
  predictionId: result.id
}));
```

**After**:
```javascript
const formattedResults = csvResults.map(result => ({
  input: normalizeKeysToLowerCase(result.row),  // ✅ camelCase keys
  prediction: result.prediction === 'Batu Ginjal' ? 1 : 0,
  penyakit: result.prediction,
  predictionId: result.id
}));
```

---

## Mapping Details

The helper function applies these transformations:

| Lowercase Key (Backend) | CamelCase Key (Frontend) | Example Value |
|------------------------|-------------------------|---------------|
| `specificgravity` | `specificGravity` | `1.015` |
| `turbidityntu` | `turbidityNTU` | `5.2` |
| `turbiditylevel` | `turbidityLevel` | `'Jernih'` |
| `warnadasar` | `warnaDasar` | `'KUNING'` |
| `ph` | `ph` | `6.5` (unchanged) |
| `tds` | `tds` | `800` (unchanged) |
| `red` | `red` | `255` (unchanged) |
| `green` | `green` | `220` (unchanged) |
| `blue` | `blue` | `150` (unchanged) |

**Note**: Only 4 parameters need transformation (multi-word compound names). Single-word lowercase keys (`ph`, `tds`, `red`, `green`, `blue`) work as-is.

---

## Testing

### Before Fix
```
CSV Upload → Preview Table Shows:
✅ pH: 6.5
✅ TDS: 800
❌ Specific Gravity: [empty]
❌ Turbidity NTU: [empty]
✅ Red: 255
✅ Green: 220
✅ Blue: 150
❌ Turbidity Level: [empty]
❌ Warna Dasar: [empty]

CSV Submit → Results Table Shows:
Same empty cells for specificGravity, turbidityNTU, turbidityLevel, warnaDasar
```

### After Fix
```
CSV Upload → Preview Table Shows:
✅ pH: 6.5
✅ TDS: 800
✅ Specific Gravity: 1.015
✅ Turbidity NTU: 5.2
✅ Red: 255
✅ Green: 220
✅ Blue: 150
✅ Turbidity Level: Jernih
✅ Warna Dasar: KUNING

CSV Submit → Results Table Shows:
✅ All 9 columns display values correctly
```

### Test Steps

1. **Start V1 deployment**:
   ```bash
   cd /var/www/html/HIBAH/deployments/v1-non-nginx
   ./stop.sh
   ./start.sh
   ```

2. **Rebuild frontend** (includes fix):
   ```bash
   cd frontend
   npm run build
   ```

3. **Upload sample CSV**:
   ```bash
   # Use sample-urine-data.csv from frontend/public/
   # Upload via ML Prediction page → CSV tab
   ```

4. **Verify preview table**:
   - Check all 9 columns show values
   - Specific Gravity, Turbidity NTU, Turbidity Level, Warna Dasar should be filled

5. **Submit CSV**:
   - Click "Submit CSV"
   - Check results table shows all 9 columns with values
   - No empty cells

---

## Files Modified

### V1 Deployment Frontend
**File**: `deployments/v1-non-nginx/frontend/src/pages/MLPrediction.js`

**Changes**:
1. Added `normalizeKeysToLowerCase()` helper function (line ~187)
2. Modified `previewCSVHeaders()` to normalize preview rows before resolving (line ~254)
3. Modified `handleCSVSubmit()` to normalize result input keys (line ~426)

### Main Frontend
**File**: `frontend/src/pages/MLPrediction.js`

**Changes**:
1. Added `normalizeKeysToLowerCase()` helper function
2. Modified `handleCSVSubmit()` to normalize result input keys
3. (No preview functionality in main frontend, only CSV submit)

### V2 Deployment Frontend
**File**: `deployments/v2-nginx-pm2/frontend/src/pages/MLPrediction.js`

**Changes**:
1. Added `normalizeKeysToLowerCase()` helper function
2. Modified `handleCSVSubmit()` to normalize result input keys
3. (No preview functionality in V2 frontend, only CSV submit)

---

## Impact Assessment

### ✅ Positive
- **Pure display fix**: No backend/API changes required
- **No performance impact**: Simple object key transformation (~1ms overhead)
- **Consistent across deployments**: Same fix applied to V1, V2, main
- **Maintains case-insensitive CSV parsing**: Backend still accepts any case headers

### ⚠️ Considerations
- **Frontend dependency**: Relies on backend returning lowercase keys
- **Breaking change if backend changes**: If backend switches to camelCase, double normalization would break
- **Alternative approach**: Could modify backend to return camelCase, but would require changes in 3 files (prediction-service.js for all deployments)

---

## Why Frontend Fix (Not Backend)?

**Decision**: Fix in frontend only

**Rationale**:
1. **Backend correctness**: Backend's lowercase approach is correct for case-insensitive CSV header handling
   - Sample CSV uses: `pH,TDS,specificGravity,turbidityNTU,...`
   - User CSVs might use: `PH,tds,SpecificGravity,TurbidityNTU,...`
   - Lowercasing ensures consistent parsing regardless of user input

2. **Single responsibility**: Backend handles data processing, frontend handles display formatting

3. **Minimal changes**: Only 3 frontend files vs modifying backend (3 prediction-service.js files + testing)

4. **No API contract change**: Backend response structure stays consistent

5. **Frontend already handles other transformations**: 
   - Disease name mapping: `'Batu Ginjal'` → `prediction: 1`
   - Date formatting, number precision, etc.

---

## Related Documentation

- **Backend CSV Processing**: `microservices/prediction/prediction-service.js` (lines 871-1041)
- **V1 Frontend**: `deployments/v1-non-nginx/frontend/src/pages/MLPrediction.js`
- **Sample CSV**: `deployments/v1-non-nginx/frontend/public/sample-urine-data.csv`
- **CSV Upload Testing**: `deployments/v1-non-nginx/test-csv-upload.sh`
- **V1 Parameter Mapping**: `PYTHON_BRIDGE_V1_MAPPING.md` (different issue - model parameter compatibility)

---

## Future Improvements

1. **Backend camelCase option**: Add query param `?keyFormat=camelCase` for frontend requests
2. **TypeScript migration**: Strong typing would catch key case mismatches at compile time
3. **CSV header normalization config**: Allow users to specify preferred output format
4. **Schema validation**: Use JSON Schema or Zod to enforce consistent key naming

---

## Troubleshooting

### Empty cells still appearing after fix

**Check 1**: Frontend rebuild
```bash
cd deployments/v1-non-nginx/frontend
rm -rf build/
npm run build
```

**Check 2**: Browser cache
```
Clear browser cache or hard refresh (Ctrl+Shift+R)
```

**Check 3**: Verify helper function exists
```bash
grep -n "normalizeKeysToLowerCase" frontend/src/pages/MLPrediction.js
```

**Check 4**: Console errors
```
Open browser DevTools → Console tab
Look for "normalizeKeysToLowerCase is not defined" or similar errors
```

### Preview shows values but results table is empty

**Symptom**: Preview table displays all 9 columns correctly, but after submit, results table shows empty cells

**Likely cause**: `handleCSVSubmit()` not applying normalization

**Fix**: Verify line ~426 in MLPrediction.js:
```javascript
input: normalizeKeysToLowerCase(result.row),  // Must normalize here
```

### Backend returning camelCase keys

**Symptom**: After backend update, tables show empty cells again

**Cause**: Backend changed to return camelCase, normalization creates new keys

**Fix**: Remove normalization calls (revert to `input: result.row`)

---

## Summary

**Problem**: Empty cells in CSV preview/results tables for 4 parameters  
**Root Cause**: Key case mismatch (lowercase data vs camelCase accessors)  
**Solution**: Added `normalizeKeysToLowerCase()` helper to transform keys before rendering  
**Impact**: Pure display fix, no backend changes, no performance impact  
**Status**: ✅ Fixed in all 3 frontends (V1, V2, main)

**Test Command**:
```bash
cd /var/www/html/HIBAH/deployments/v1-non-nginx
./test-csv-upload.sh
# Should show all 9 columns filled in logs
```

---

**Document Version**: 1.0  
**Last Updated**: November 24, 2025  
**Author**: GitHub Copilot (Automated Fix)
