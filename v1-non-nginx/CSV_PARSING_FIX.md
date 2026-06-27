# CSV Parsing Bug Fix Documentation

## Date: November 24, 2025

## Bug Description

CSV upload functionality was failing with error "Error processing CSV file" when users attempted to upload valid CSV files containing urine analysis data. The specific error message showed: "Invalid value for turbidityLevel: Jernih" (or similar for categorical fields).

### Symptoms
- CSV upload endpoint returned 400 error
- Error occurred even with correctly formatted CSV files (e.g., `sample-urine-data.csv`)
- Frontend validation passed, but backend processing failed
- Error message indicated invalid values for categorical fields like `turbidityLevel` and `warnaDasar`

## Root Cause

**File**: `microservices/prediction/prediction-service.js`  
**Lines**: 947-951 (CSV row parsing loop)

The CSV parsing logic applied `parseFloat()` to **all 9 parameters**, including categorical string fields (`turbidityLevel` and `warnaDasar`). This was a programmer oversight during the parameter migration from the old 6-parameter system (all numeric) to the new 9-parameter system (7 numeric + 2 categorical).

### The Problematic Code
```javascript
// BEFORE FIX - Applied parseFloat to ALL fields
for (const header of expectedHeaders) {
  const value = parseFloat(row[header]);  // ❌ Converts "Jernih" to NaN
  if (isNaN(value)) {
    throw new Error(`Invalid value for ${header}: ${row[header]}`);
  }
  parameters[header] = value;
}
```

### Why It Failed
1. When parsing `turbidityLevel: "Jernih"`, `parseFloat("Jernih")` returns `NaN`
2. The `isNaN(value)` check triggered, throwing an error
3. Same issue occurred for `warnaDasar` values like "KUNING", "MERAH", etc.
4. CSV processing stopped at the first categorical field

### Why ml-service.js Worked Correctly

The ML service (`microservices/ml/ml-service.js` lines 686-705) already had the correct implementation that differentiated numeric vs categorical fields:

```javascript
// ml-service.js - CORRECT IMPLEMENTATION
if (['ph', 'tds', 'specificGravity', 'turbidityNTU', 'red', 'green', 'blue'].includes(field)) {
  const value = Number(data[field]);
  if (isNaN(value)) {
    throw new Error(`Invalid value for ${field}: ${data[field]}`);
  }
  processedData[field] = value;
} else {
  // Keep categorical fields as strings
  processedData[field] = data[field];
}
```

The prediction service should have mirrored this logic but didn't, creating an inconsistency.

## Fix Applied

### Updated CSV Parsing Logic

**Files Modified**:
- `deployments/v1-non-nginx/microservices/prediction/prediction-service.js` (lines 940-975)
- `deployments/v2-nginx-pm2/microservices/prediction/prediction-service.js` (lines 845-880)
- `microservices/prediction/prediction-service.js` (lines 845-880)

### New Implementation
```javascript
// AFTER FIX - Handles mixed numeric and categorical parameters
const parameters = {};
const numericFields = ['ph', 'tds', 'specificGravity', 'turbidityNTU', 'red', 'green', 'blue'];
const categoricalFields = {
  turbidityLevel: ['Jernih', 'Agak Keruh', 'Keruh'],
  warnaDasar: ['BENING', 'KUNING', 'MERAH', 'COKLAT', 'ORANGE', 'HIJAU', 'BIRU']
};

for (const header of expectedHeaders) {
  if (numericFields.includes(header)) {
    // Parse numeric fields
    const value = parseFloat(row[header]);
    if (isNaN(value)) {
      throw new Error(`Invalid ${header}: must be a valid number, got '${row[header]}'`);
    }
    parameters[header] = value;
  } else if (categoricalFields[header]) {
    // Validate categorical fields
    const value = row[header];
    if (!categoricalFields[header].includes(value)) {
      throw new Error(`Invalid ${header}: must be one of [${categoricalFields[header].join(', ')}], got '${value}'`);
    }
    parameters[header] = value;
  } else {
    parameters[header] = row[header];
  }
}

// Added logging for debugging
logCSVProcessing(logger, {
  requestId,
  stage: 'row_parsed',
  rowIndex: rowIndex + 1,
  parameters
});
```

### Key Improvements
1. **Separated field types**: Numeric fields array and categorical fields object with allowed values
2. **Type-specific parsing**: `parseFloat()` only for numeric fields, string validation for categorical
3. **Enum validation**: Categorical fields checked against allowed values (e.g., "Jernih", "Agak Keruh", "Keruh")
4. **Better error messages**: Specify expected values/ranges instead of generic "Invalid value"
5. **Debug logging**: Added parameter logging to help troubleshoot future issues

### Frontend Error Message Update

**File**: `deployments/v1-non-nginx/frontend/src/pages/MLPrediction.js` (line 454)

Updated fallback error message from old 6-parameter format to new 9-parameter format:

```javascript
// BEFORE
errorMessage = 'The CSV file format is invalid. Please ensure it has the required columns: gravity, ph, osmo, cond, urea, calc';

// AFTER
errorMessage = 'The CSV file format is invalid. Please ensure it has the required columns: ph, tds, specificGravity, turbidityNTU, red, green, blue, turbidityLevel, warnaDasar';
```

## Testing

### Test CSV File
**Location**: `deployments/v1-non-nginx/frontend/public/sample-urine-data.csv`

**Content** (5 sample rows):
```csv
ph,tds,specificGravity,turbidityNTU,red,green,blue,turbidityLevel,warnaDasar
6.5,800,1.015,5.2,255,220,150,Jernih,KUNING
7.0,1200,1.020,15.5,200,100,80,Agak Keruh,COKLAT
5.5,500,1.010,3.0,255,255,240,Jernih,BENING
6.8,1500,1.025,35.0,180,50,50,Keruh,MERAH
7.2,900,1.018,8.0,255,200,100,Jernih,ORANGE
```

### Manual Test Steps
1. Start V1 services: `cd deployments/v1-non-nginx && ./start.sh`
2. Login to web interface: `http://localhost:3004`
3. Navigate to ML Prediction page
4. Switch to CSV Upload tab
5. Upload `sample-urine-data.csv`
6. Verify: Should show preview of 5 rows with correct parameter values
7. Submit CSV for prediction
8. Verify: Should return 5 predictions with kidney stone risk results

### Automated Test Script
**File**: `deployments/v1-non-nginx/test-csv-upload.sh`

Run with: `./test-csv-upload.sh`

The script:
- Authenticates with test credentials
- Uploads the sample CSV file
- Validates response structure
- Displays parsed parameters
- Confirms all 5 rows processed successfully

### Expected Results
✅ CSV upload completes successfully  
✅ All 5 rows parsed without errors  
✅ Numeric fields converted to numbers (e.g., pH: 6.5, TDS: 800)  
✅ Categorical fields kept as strings (e.g., turbidityLevel: "Jernih")  
✅ Backend returns 5 prediction results  
✅ Each result has `riskLevel` and `confidence` scores  

## Related Files

### Backend Services
- `microservices/prediction/prediction-service.js` - CSV upload endpoint
- `microservices/ml/ml-service.js` - ML prediction service (reference implementation)
- `deployments/v1-non-nginx/microservices/prediction/prediction-service.js` - V1 deployment
- `deployments/v2-nginx-pm2/microservices/prediction/prediction-service.js` - V2 deployment

### Frontend Files
- `deployments/v1-non-nginx/frontend/src/pages/MLPrediction.js` - CSV upload UI
- `deployments/v1-non-nginx/frontend/public/sample-urine-data.csv` - Test data

### Documentation
- `FRONTEND_PARAMETER_MIGRATION.md` - Frontend 9-parameter migration guide
- `FRONTEND_CLEANUP_SUMMARY.md` - Post-cleanup fixes (includes CSV validation fix)

## Prevention Guidelines

### For Future Parameter Changes
1. **Check all parsing locations**: When adding/changing parameters, update:
   - Frontend validation (MLPrediction.js `REQUIRED_HEADERS`)
   - Backend CSV parsing (prediction-service.js row loop)
   - Backend validation (ml-service.js `validateUrineData`)
   - Error messages (frontend fallback messages)

2. **Maintain type consistency**: If parameters have mixed types:
   - Document field types clearly in schema/documentation
   - Use separate arrays/objects for different types
   - Apply type-specific validation at all layers

3. **Reference correct implementations**: When implementing similar logic:
   - Check if ml-service.js or other services already handle it correctly
   - Mirror the pattern instead of creating new logic
   - Copy validation rules from authoritative source

4. **Test with real data**: Before deploying:
   - Test CSV upload with sample file containing all parameter types
   - Verify both numeric and categorical fields process correctly
   - Check error messages are accurate and helpful

## Deployment Status

✅ **V1 Deployment** (`deployments/v1-non-nginx`): Fixed and tested  
✅ **V2 Deployment** (`deployments/v2-nginx-pm2`): Fixed (identical logic)  
✅ **Main Codebase** (`microservices/`): Fixed for consistency  
✅ **Frontend Error Messages**: Updated to match new parameters  

## Additional Notes

This bug existed since the 6→9 parameter migration was completed (backend and frontend forms were updated, but CSV parsing logic was overlooked). The ml-service.js had the correct implementation from the start, but prediction-service.js CSV endpoint didn't mirror it, creating an inconsistency that only surfaced when users tried CSV upload with categorical fields.

The fix ensures all three codebases (main, v1, v2) have identical CSV parsing logic that correctly handles the mixed numeric and categorical parameter system used throughout the application.
