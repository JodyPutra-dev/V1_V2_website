# CSV Header Case Sensitivity Bug Fix

## Date: November 24, 2025

## Problem Summary

CSV upload failed with "Missing required columns" error even when using correctly formatted CSV files with proper camelCase headers (e.g., `specificGravity`, `turbidityNTU`, `turbidityLevel`, `warnaDasar`).

### Error Message
```
Missing required columns: specificGravity, turbidityNTU, turbidityLevel, warnaDasar
```

### Symptoms
- All CSV uploads returned 400 Bad Request
- Error occurred with sample-urine-data.csv (known good file)
- Frontend validation passed, backend validation failed
- Logs showed header mismatch during validation

## Root Cause Analysis

**File**: All three `prediction-service.js` files (main, v1-non-nginx, v2-nginx-pm2)

**The Bug**: Case sensitivity mismatch in CSV header validation logic

### Request Flow
1. **User uploads CSV** with camelCase headers:
   ```csv
   ph,tds,specificGravity,turbidityNTU,red,green,blue,turbidityLevel,warnaDasar
   6.5,800,1.015,5.2,255,220,150,Jernih,KUNING
   ```

2. **Backend Line 871**: Converts headers to lowercase for processing:
   ```javascript
   const header = lines[0].toLowerCase().trim();
   // Result: "ph,tds,specificgravity,turbidityntu,red,green,blue,turbiditylevel,warnadasar"
   ```

3. **Backend Line 872**: Defines expected headers in **camelCase**:
   ```javascript
   const expectedHeaders = ['ph', 'tds', 'specificGravity', 'turbidityNTU', ...];
   // Still camelCase! Doesn't match lowercased actualHeaders
   ```

4. **Backend Line 898-901**: Validation fails:
   ```javascript
   const actualHeaders = header.split(delimiter); // lowercase
   const missingHeaders = expectedHeaders.filter(h => !actualHeaders.includes(h));
   // Comparison: 'specificgravity' (actual) !== 'specificGravity' (expected)
   // Result: Missing columns error
   ```

5. **Backend Lines 926-970**: Row processing uses `row[header]`:
   ```javascript
   for (const header of expectedHeaders) {
     const value = parseFloat(row[header]); // row has lowercase keys!
   }
   // Trying to access row['specificGravity'] but key is 'specificgravity'
   // Result: undefined values
   ```

### Why It Happened
The backend implemented case-insensitive header parsing (`toLowerCase()`) but forgot to update the validation arrays to match. This created a mismatch where:
- **actualHeaders** (from CSV) = lowercase
- **expectedHeaders** (hardcoded) = camelCase
- **row object keys** (from CSV parser) = lowercase
- **numericFields/categoricalFields** (hardcoded) = camelCase

The code tried to be user-friendly (accept any case) but inconsistently applied the normalization.

## Solution

Convert all header-related arrays to **lowercase** to match the `header.toLowerCase()` normalization applied at the start of CSV processing.

### Files Modified

1. **`/deployments/v1-non-nginx/microservices/prediction/prediction-service.js`**
2. **`/deployments/v2-nginx-pm2/microservices/prediction/prediction-service.js`**
3. **`/microservices/prediction/prediction-service.js`**

### Changes Applied

#### 1. Expected Headers (Line ~872)
```javascript
// BEFORE - camelCase
const expectedHeaders = ['ph', 'tds', 'specificGravity', 'turbidityNTU', 'red', 'green', 'blue', 'turbidityLevel', 'warnaDasar'];

// AFTER - lowercase
const expectedHeaders = ['ph', 'tds', 'specificgravity', 'turbidityntu', 'red', 'green', 'blue', 'turbiditylevel', 'warnadasar'];
```

#### 2. Numeric Fields (Line ~946/850)
```javascript
// BEFORE - camelCase
const numericFields = ['ph', 'tds', 'specificGravity', 'turbidityNTU', 'red', 'green', 'blue'];

// AFTER - lowercase
const numericFields = ['ph', 'tds', 'specificgravity', 'turbidityntu', 'red', 'green', 'blue'];
```

#### 3. Categorical Fields (Lines ~947-950/851-854)
```javascript
// BEFORE - camelCase keys
const categoricalFields = {
  turbidityLevel: ['Jernih', 'Agak Keruh', 'Keruh'],
  warnaDasar: ['BENING', 'KUNING', 'MERAH', 'COKLAT', 'ORANGE', 'HIJAU', 'BIRU']
};

// AFTER - lowercase keys
const categoricalFields = {
  turbiditylevel: ['Jernih', 'Agak Keruh', 'Keruh'],
  warnadasar: ['BENING', 'KUNING', 'MERAH', 'COKLAT', 'ORANGE', 'HIJAU', 'BIRU']
};
```

#### 4. Added Comment (Line ~871)
```javascript
// Convert to lowercase for case-insensitive CSV header matching
const header = lines[0].toLowerCase().trim();
```

## Benefits

### User-Friendly CSV Uploads
Users can now upload CSVs with **any header case variation**:

✅ **camelCase** (recommended): `specificGravity`, `turbidityNTU`  
✅ **lowercase**: `specificgravity`, `turbidityntu`  
✅ **UPPERCASE**: `SPECIFICGRAVITY`, `TURBIDITYNTU`  
✅ **Mixed case**: `SpecificGravity`, `TurbidityNTU`  

All variations work identically - the backend normalizes to lowercase internally.

### Consistent Processing
- Headers converted to lowercase at entry point
- All validation arrays use lowercase
- Row object keys are lowercase (from CSV parser)
- Processing loop uses lowercase field names
- ML service receives parameters with lowercase keys (already handles this)

### Example Request Flow (After Fix)

```
User uploads CSV:
ph,TDS,SpecificGravity,TurbidityNTU,RED,green,Blue,TurbidityLevel,WarnaDasar
6.5,800,1.015,5.2,255,220,150,Jernih,KUNING

↓ Backend Line 871
header.toLowerCase() → "ph,tds,specificgravity,turbidityntu,red,green,blue,turbiditylevel,warnadasar"

↓ Backend Line 872 (FIXED)
expectedHeaders → ['ph', 'tds', 'specificgravity', 'turbidityntu', ...]

↓ Backend Line 898-901 (FIXED)
actualHeaders vs expectedHeaders → ✅ MATCH

↓ Backend Line 926-928
row object created with lowercase keys:
{
  ph: '6.5',
  tds: '800',
  specificgravity: '1.015',
  turbidityntu: '5.2',
  ...
}

↓ Backend Lines 946-970 (FIXED)
Processing loop uses lowercase field names:
for (const header of expectedHeaders) { // lowercase
  const value = parseFloat(row[header]); // lowercase key → ✅ FOUND
  parameters[header] = value; // lowercase → ML service
}

↓ ML Service
Receives parameters with lowercase keys (already compatible):
{
  ph: 6.5,
  tds: 800,
  specificgravity: 1.015,
  turbidityntu: 5.2,
  ...
}

↓ Result
✅ 200 OK with predictions array
```

## Testing

### Automated Test Script
**File**: `deployments/v1-non-nginx/test-csv-upload.sh`

The updated test script now validates case-insensitive uploads:
- ✅ **camelCase headers** (original sample-urine-data.csv)
- ✅ **lowercase headers** (temp test file)
- ✅ **UPPERCASE headers** (temp test file)
- ✅ **mixed case headers** (temp test file)

Run with:
```bash
cd /var/www/html/HIBAH/deployments/v1-non-nginx
./test-csv-upload.sh
```

### Manual Testing

**1. Upload Original CSV** (camelCase):
```bash
curl -X POST http://localhost:7764/api/predict/csv \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@frontend/public/sample-urine-data.csv"
```

**Expected**: ✅ 200 OK with 5 predictions

**2. Create Lowercase CSV**:
```csv
ph,tds,specificgravity,turbidityntu,red,green,blue,turbiditylevel,warnadasar
6.5,800,1.015,5.2,255,220,150,Jernih,KUNING
```

Upload and verify: ✅ 200 OK with predictions

**3. Create UPPERCASE CSV**:
```csv
PH,TDS,SPECIFICGRAVITY,TURBIDITYNTU,RED,GREEN,BLUE,TURBIDITYLEVEL,WARNADASAR
6.5,800,1.015,5.2,255,220,150,Jernih,KUNING
```

Upload and verify: ✅ 200 OK with predictions

### Verify Logs

**Gateway Log**:
```bash
tail -f logs/gateway.log | grep PREDICTION-PROXY
```

Expected entries:
```
[PREDICTION-PROXY] Forwarding request: POST /api/predict/csv
[PREDICTION-PROXY] Success: 5 predictions processed
```

**Prediction Service Log**:
```bash
tail -f logs/prediction.log | grep CSV
```

Expected entries:
```
[CSV] Headers validated: ph,tds,specificgravity,turbidityntu,...
[CSV] Processing complete: {total:5, processed:5, failed:0}
```

## Impact

### Before Fix
❌ Only exact camelCase headers worked (theory)  
❌ Actually, **nothing worked** due to toLowerCase() + camelCase validation mismatch  
❌ Users confused by "missing columns" error despite correct headers  
❌ sample-urine-data.csv upload failed (with correct headers!)  

### After Fix
✅ Any header case variation accepted (user-friendly)  
✅ Backend normalizes to lowercase (consistent processing)  
✅ sample-urine-data.csv upload works  
✅ Custom CSVs with lowercase/UPPERCASE headers work  
✅ No breaking changes (ML service already accepts lowercase keys)  

## Related Documentation

- **`CSV_PARSING_FIX.md`** - Documents numeric/categorical parameter handling fix
- **`CSV_UPLOAD_FIX.md`** - Documents gateway proxy addition for CSV upload endpoint
- **`FRONTEND_CLEANUP_SUMMARY.md`** - Tracks all post-cleanup fixes including this one
- **`PARAMETER_MIGRATION_GUIDE.md`** - Frontend 6→9 parameter migration

## Technical Notes

### Why Lowercase?
1. **Simplicity**: Single normalization point (line 871)
2. **Consistency**: CSV parser already outputs lowercase keys
3. **ML Service Compatibility**: ML service parameter validation is case-insensitive
4. **User-Friendly**: Accept any case variation from users

### No Breaking Changes
- ML service already handles lowercase parameter keys (validated in testing)
- Database stores parameters as-is (case doesn't matter for JSON fields)
- Frontend already sends camelCase (still works after lowercase normalization)
- Existing predictions in DB unaffected (display layer handles both cases)

### Alternative Considered
Keep camelCase and remove `toLowerCase()` → Rejected because:
- Users would need exact case match (poor UX)
- CSV tools often auto-format headers
- Lowercase normalization is industry standard for CSV processing

## Prevention Guidelines

When modifying CSV processing in the future:

1. **Maintain Consistency**: If headers are normalized (lowercase/uppercase), ensure ALL validation arrays match
2. **Document Case Handling**: Add comments explaining case normalization strategy
3. **Test Multiple Cases**: Test uploads with lowercase, UPPERCASE, camelCase, MixedCase
4. **Check Row Access**: Verify `row[header]` uses same case as CSV parser output
5. **Update All Copies**: Apply fixes to main, v1, v2 deployment versions

## Deployment Status

✅ **Main Codebase** (`microservices/prediction/prediction-service.js`) - Fixed  
✅ **V1 Deployment** (`deployments/v1-non-nginx/microservices/prediction/prediction-service.js`) - Fixed  
✅ **V2 Deployment** (`deployments/v2-nginx-pm2/microservices/prediction/prediction-service.js`) - Fixed  

All three versions now have consistent case-insensitive CSV header handling.
