# CSV Processing "index is not defined" Error Investigation

## Error Details

### Symptoms
```
POST /api/predict/csv → 200 OK
Response: {
  "success": true,
  "message": "CSV file processed: 5 rows, 0 successful, 5 failed",
  "total": 5,
  "processed": 0,
  "failed": 5,
  "errors": ["ML service error: index is not defined", ...]
}
```

### Log Evidence
**prediction.log** (line 496):
```
CSV file processed: 5 rows, 0 successful, 5 failed
Failed rows: ReferenceError: index is not defined
```

All 5 CSV rows fail with identical error message: "index is not defined"

---

## Code Trace

### 1. Frontend Upload
**File**: `frontend/src/pages/MLPrediction.js`
**Line**: ~600 (handleCSVSubmit)
```javascript
const formData = new FormData();
formData.append('csv', file);

const response = await predictionAPI.uploadCSV(formData, {
  onUploadProgress: (progressEvent) => {
    const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
    setUploadProgress(percentCompleted);
  }
});
```

### 2. API Layer
**File**: `frontend/src/services/api.js`
**Line**: ~535
```javascript
uploadCSV: async (formData, config = {}) => {
  return API.post('/api/predict/csv', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    ...config
  });
}
```

### 3. Gateway Proxy
**File**: `microservices/gateway/gateway.js`
**Line**: ~400
```javascript
// Proxy to prediction service
app.use('/api/predict', proxyMiddleware({
  target: 'http://localhost:3004',
  changeOrigin: true,
  pathRewrite: { '^/api/predict': '' }
}));
```

### 4. Prediction Service CSV Handler
**File**: `microservices/prediction/prediction-service.js`
**Lines**: 975-1143

#### Loop Structure (CORRECT - uses rowIndex)
```javascript
// Line 975: Parse CSV
const results = Papa.parse(csvContent, { header: true });

// Line 1011: Loop through each row
for (let rowIndex = 0; rowIndex < results.data.length; rowIndex++) {
  const row = results.data[rowIndex];
  
  // Line 1035: Create row context
  console.log(`[CSV-UPLOAD] Processing row ${rowIndex + 1}/${results.data.length}`);
  
  // Line 1051: Call ML service
  const mlResponse = await fetch('http://localhost:3002/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
    body: JSON.stringify(normalizedParams)
  });
  
  // Line 1089: Debug log (FIXED - was using 'index' instead of 'rowIndex')
  console.log('[CSV-SAVE] Row index:', rowIndex);
  
  // Line 1122: Error handling
  if (!mlData.success) {
    errors.push(`Row ${rowIndex + 1}: ${mlData.error}`);
    continue;
  }
  
  // Line 1134: MongoDB save
  const saved = await createPrediction(predictionData);
}
```

**Note**: Line 1089 was recently fixed from `index` to `rowIndex`. But error persists, suggesting the issue is NOT in prediction-service.js.

### 5. ML Service Predict Endpoint
**File**: `microservices/ml/ml-service.js`
**Lines**: 1334-1380

#### Original Code (Before Investigation)
```javascript
app.post('/predict', async (req, res) => {
  const requestId = req.headers['x-request-id'] || `ml_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    console.log(`POST /predict - Making prediction`);
    
    const data = req.body;
    
    await predictionQueue.acquire();
    
    try {
      const result = await predictWithJoblib(data, requestId);
      
      if (!result.success) {
        return res.status(500).json(result);
      }
      
      return res.status(200).json(result);
    } finally {
      predictionQueue.release();
    }
  } catch (error) {
    console.error(`Error making prediction: ${error.message}`);
    return res.status(500).json({ success: false, error: error.message });
  }
});
```

#### Enhanced Code (With Debug Logging)
```javascript
app.post('/predict', async (req, res) => {
  const requestId = req.headers['x-request-id'] || `ml_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    console.log(`POST /predict - Making prediction`);
    console.log('[CSV-INDEX-DEBUG] Request body received:', JSON.stringify(req.body).substring(0, 200));
    console.log('[CSV-INDEX-DEBUG] All variable names in scope:', Object.keys({ requestId, req, res }).join(', '));
    
    const data = req.body;
    
    await predictionQueue.acquire();
    
    try {
      console.log('[CSV-INDEX-DEBUG] About to call predictWithJoblib');
      const result = await predictWithJoblib(data, requestId);
      console.log('[CSV-INDEX-DEBUG] predictWithJoblib result:', result.success ? 'SUCCESS' : 'FAILED');
      
      if (!result.success) {
        console.error('[CSV-INDEX-DEBUG] Prediction failed with error:', result.error);
        return res.status(500).json(result);
      }
      
      return res.status(200).json(result);
    } catch (innerError) {
      console.error('[CSV-INDEX-DEBUG] Exception in predictWithJoblib:', innerError.message);
      console.error('[CSV-INDEX-DEBUG] Exception stack:', innerError.stack);
      console.error('[CSV-INDEX-DEBUG] All variables at error:', Object.keys({ data, requestId, innerError }).join(', '));
      throw innerError;
    } finally {
      predictionQueue.release();
    }
  } catch (error) {
    console.error(`Error making prediction: ${error.message}`);
    console.error('[CSV-INDEX-DEBUG] Outer catch error:', error.message);
    console.error('[CSV-INDEX-DEBUG] Error stack trace:', error.stack);
    return res.status(500).json({ success: false, error: error.message });
  }
});
```

### 6. predictWithJoblib Function
**File**: `microservices/ml/ml-service.js`
**Lines**: 1096-1175

```javascript
async function predictWithJoblib(data, requestId) {
  try {
    // Line 1102: Log incoming data
    logger.info('Prediction request received', { requestId, dataKeys: Object.keys(data) });
    
    // Line 1109: Validate input
    const validationResult = validateUrineData(data);
    if (!validationResult.valid) {
      return { success: false, error: validationResult.error };
    }
    
    // Line 1117: Preprocess input
    const processedData = preprocessInput(data);
    
    // Line 1125: Call Python bridge
    const result = await pythonBridge.predict(processedData, requestId);
    
    return result;
  } catch (error) {
    console.error('[predictWithJoblib] Error:', error.message);
    return { success: false, error: error.message };
  }
}
```

### 7. validateUrineData Function
**File**: `microservices/ml/ml-service.js`
**Lines**: 758-828

```javascript
function validateUrineData(data) {
  const requiredFields = [
    'ph', 'tds', 'specificGravity', 'turbidityNTU',
    'red', 'green', 'blue', 'turbidityLevel', 'warnaDasar'
  ];

  // Check required fields
  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === null) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  // Validate numeric ranges
  // ...

  return { valid: true };
}
```

**Note**: Uses `for (const field of requiredFields)` - no 'index' variable.

### 8. preprocessInput Function
**File**: `microservices/ml/ml-service.js`
**Lines**: 699-750

```javascript
function preprocessInput(data) {
  // Map turbidity level to numeric
  const turbidityMap = { 'Jernih': 0, 'Agak Keruh': 1, 'Keruh': 2 };
  
  // Map warna dasar to numeric
  const warnaMap = { 
    'BENING': 0, 'KUNING': 1, 'MERAH': 2, 
    'COKLAT': 3, 'ORANGE': 4, 'HIJAU': 5, 'BIRU': 6 
  };

  return {
    ph: parseFloat(data.ph),
    tds: parseFloat(data.tds),
    specificGravity: parseFloat(data.specificGravity),
    turbidityNTU: parseFloat(data.turbidityNTU),
    red: parseInt(data.red),
    green: parseInt(data.green),
    blue: parseInt(data.blue),
    turbidityLevel: turbidityMap[data.turbidityLevel] || 0,
    warnaDasar: warnaMap[data.warnaDasar] || 0
  };
}
```

**Note**: No 'index' variable used.

### 9. Python Bridge
**File**: `microservices/ml/python_bridge.py`
**Lines**: 1-100 (approx)

```python
import sys
import json
import joblib
import numpy as np

def predict(data):
    try:
        # Load model
        model = joblib.load('/path/to/kidney_stone_model.joblib')
        
        # Prepare features
        features = np.array([[
            data['ph'], data['tds'], data['specificGravity'], 
            data['turbidityNTU'], data['red'], data['green'], 
            data['blue'], data['turbidityLevel'], data['warnaDasar']
        ]])
        
        # Make prediction
        prediction = model.predict(features)[0]
        
        return {
            'success': True,
            'prediction': int(prediction),
            'penyakit': 'Batu Ginjal' if prediction == 1 else 'Sehat'
        }
    except Exception as e:
        return {'success': False, 'error': str(e)}

if __name__ == '__main__':
    input_data = json.loads(sys.argv[1])
    result = predict(input_data)
    print(json.dumps(result))
```

**Note**: No 'index' variable used.

---

## Hypothesis

### Where is 'index' Referenced?

The error "index is not defined" is NOT from:
1. ❌ prediction-service.js (uses `rowIndex` correctly)
2. ❌ ml-service.js /predict endpoint (no 'index' variable)
3. ❌ validateUrineData function (uses `for...of` with `field`)
4. ❌ preprocessInput function (no loops, direct mapping)
5. ❌ python_bridge.py (Python code, no 'index')

### Possible Locations

1. **Template String in Error Message**
   - Check if any error messages use backticks with `${index}`
   - Example: ``Error at index ${index}`` where 'index' is not defined

2. **Array.forEach or Array.map Callback**
   - Check if any array operations reference 'index' without declaring it
   - Example: `array.forEach(item => console.log(index))` (missing second parameter)

3. **Dynamic Code Evaluation**
   - Check if any code uses `eval()` or `Function()` that might reference 'index'

4. **Hidden Variable in Closure**
   - Check if 'index' is referenced in a closure but not in scope

### Search Strategy

```bash
# Search for 'index' in ml-service.js (excluding comments)
grep -n "index" microservices/ml/ml-service.js | grep -v "//"

# Search for template strings with 'index'
grep -n "\${index}" microservices/ml/ml-service.js

# Search for forEach/map without proper parameters
grep -n "\.forEach\|\.map" microservices/ml/ml-service.js

# Search in Python bridge
grep -n "index" microservices/ml/python_bridge.py
```

---

## Debug Logging Added

### In /predict Endpoint (Lines 1334-1380)

1. **Request body logging**: Shows first 200 chars of req.body
2. **Variable scope logging**: Lists all variables in scope at endpoint entry
3. **Function call logging**: Logs before/after predictWithJoblib
4. **Error context logging**: Shows all variables when error occurs
5. **Stack trace logging**: Full error.stack for debugging

### Expected Output

When CSV upload triggers error, logs should show:

```
[CSV-INDEX-DEBUG] Request body received: {"ph":7.2,"tds":900,"specificGravity":1.009,...}
[CSV-INDEX-DEBUG] All variable names in scope: requestId, req, res
[CSV-INDEX-DEBUG] About to call predictWithJoblib
[CSV-INDEX-DEBUG] Exception in predictWithJoblib: index is not defined
[CSV-INDEX-DEBUG] Exception stack: ReferenceError: index is not defined
    at validateUrineData (/path/to/ml-service.js:XXX:YY)
    at predictWithJoblib (/path/to/ml-service.js:1109:XX)
    ...
[CSV-INDEX-DEBUG] All variables at error: data, requestId, innerError
[CSV-INDEX-DEBUG] Outer catch error: index is not defined
[CSV-INDEX-DEBUG] Error stack trace: (full stack)
```

This will reveal:
- Exact line number where 'index' is referenced
- Function name where error occurs (stack trace first frame)
- Context of what data was being processed

---

## Testing Plan

### 1. Restart Services with Enhanced Logging
```bash
cd /var/www/html/HIBAH/deployments/v1-non-nginx
./stop.sh
./start.sh

# Watch ML service logs in real-time
tail -f logs/ml.log
```

### 2. Upload Test CSV
```bash
# Open browser
http://localhost:7764

# Navigate to ML Prediction → CSV Upload
# Upload sample-urine-data.csv (5 rows)

# Observe logs in terminal
# Look for [CSV-INDEX-DEBUG] messages
```

### 3. Analyze Logs
```bash
# After upload, check ml.log for debug output
grep "CSV-INDEX-DEBUG" logs/ml.log

# Check error stack trace
grep -A 10 "Exception stack:" logs/ml.log

# Find exact error location
# Stack trace first line shows: at functionName (file:line:col)
```

### 4. Identify Root Cause
Based on stack trace, go to exact line number and inspect code for 'index' reference.

---

## Next Steps

1. ✅ Enhanced logging added to ml-service.js /predict endpoint
2. ⏳ Restart services to apply changes
3. ⏳ Upload CSV to trigger error
4. ⏳ Analyze [CSV-INDEX-DEBUG] logs
5. ⏳ Identify exact line where 'index' is referenced
6. ⏳ Fix the root cause
7. ⏳ Re-test CSV upload
8. ⏳ Document final fix

---

## Related Files

- `microservices/prediction/prediction-service.js` - CSV upload handler (NOT the issue)
- `microservices/ml/ml-service.js` - ML prediction service (**likely source of error**)
- `microservices/ml/python_bridge.py` - Python model interface (probably not the issue)
- `frontend/src/pages/MLPrediction.js` - Upload UI (frontend only, not relevant)

---

## Notes

- Line 1089 typo fix in prediction-service.js did NOT resolve the issue
- Error persists despite correct `rowIndex` usage
- Error message "index is not defined" suggests a ReferenceError in JavaScript
- Python bridge uses different variable names (no 'index')
- Enhanced logging will pinpoint exact error location via stack trace
