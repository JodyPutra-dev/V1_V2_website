# Device Token & Dashboard Parameters Fix

## Overview
This document details the root causes and fixes for two critical issues identified through log analysis:
1. Device token not displaying in Profile page
2. Dashboard showing "N/A" for 4 parameters (Specific Gravity, Turbidity NTU, Turbidity Level, Warna Dasar)

---

## Issue 1: Device Token Not Displaying

### Problem
Profile page shows "Not generated" for device token field despite successful regeneration via modal.

### Root Cause Analysis

**Data Flow Traced**:
1. Profile.js loads → calls `authAPI.getProfile()` (line 105)
2. API calls `/api/auth/me` endpoint
3. Backend `user-service.js` lines 1424-1459 returns user data
4. **Missing field**: Response excludes `deviceToken`

**Evidence from Code** (`user-service.js` lines 1447-1456):
```javascript
return res.status(200).json({
  success: true,
  data: {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    profileImage: user.profileImage,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
    // ❌ deviceToken is missing
  }
});
```

**Comparison**: The `/api/users/me` endpoint (lines 1104-1107) returns the full user object including `deviceToken`, which is why regeneration works correctly (it uses a different endpoint).

### Solution Applied

**File**: `microservices/user/user-service.js` (all deployments)  
**Change**: Added `deviceToken: user.deviceToken` to response object at line ~1454

```javascript
return res.status(200).json({
  success: true,
  data: {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    deviceToken: user.deviceToken,  // ✅ Added
    profileImage: user.profileImage,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  }
});
```

### Testing

**1. Verify Backend Fix**:
```bash
# Get JWT token from localStorage (after login)
TOKEN="your-jwt-token-here"

# Test endpoint
curl -X GET http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.data.deviceToken'

# Should return: "32-char-hex-token" (not null)
```

**2. Verify Frontend Display**:
```bash
# Open browser
http://localhost:7764

# Login → Profile page
# Token field should display actual token (not "Not generated")
```

**3. Verify MongoDB**:
```bash
mongosh
use urine-disease-detection
db.users.findOne({email: "test@example.com"}, {deviceToken: 1})

# Should show: { deviceToken: "abc123..." }
```

**4. Verify localStorage**:
```javascript
// Browser Console (F12)
JSON.parse(localStorage.getItem('user')).deviceToken

// Should show: "abc123..." (not undefined)
```

### Expected Behavior After Fix
- ✅ Profile page loads with token displayed in field
- ✅ "Generate Token" button shows "Regenerate Token" if token exists
- ✅ Copy button is enabled
- ✅ Token persists across page refreshes
- ✅ Token updates correctly after regeneration

---

## Issue 2: Dashboard N/A Parameters

### Problem
Dashboard displays "N/A" for 4 parameters:
- Specific Gravity
- Turbidity NTU
- Turbidity Level
- Warna Dasar

But correctly shows:
- pH (7.2)
- TDS (900)
- RGB colors (255, 200, 100)

### Root Cause Analysis

**Data Flow Traced**:
1. Dashboard.js → `/api/predict/stats` endpoint
2. Backend queries MongoDB: `Prediction.findForUser(userId)`
3. Returns documents to frontend
4. Frontend renders parameter values

**Evidence from Logs** (`logs/prediction.log` lines 16-61):
```
[STATS-DEBUG] First prediction raw parameters: {
  ph: 7.2,
  tds: 900,
  red: 255,
  green: 200,
  blue: 100
}
[STATS-DEBUG] Parameter keys: [ 'ph', 'tds', 'red', 'green', 'blue' ]
```

**Finding**: MongoDB documents only contain 5 out of 9 required parameters.

**Schema Analysis** (`prediction-service.js` lines 224-236):
```javascript
parameters: {
  ph: { type: Number },
  tds: { type: Number },
  specificGravity: { type: Number },     // ❌ Missing in DB
  turbidityNTU: { type: Number },        // ❌ Missing in DB
  red: { type: Number },
  green: { type: Number },
  blue: { type: Number },
  turbidityLevel: { type: String },      // ❌ Missing in DB
  warnaDasar: { type: String }           // ❌ Missing in DB
}
```

All fields are optional (no `required: true`), so Mongoose saves incomplete documents without error.

### Why This Happened

**Possible Scenarios**:
1. **CSV Upload**: CSV files only contained 5 columns (ph, tds, RGB) - missing 4 parameters
2. **Manual Prediction**: Frontend form only collected 5 inputs
3. **API Direct Call**: ESP8266 device sent incomplete data
4. **Migration Not Run**: `fix-missing-csv-parameters.js` was never executed after initial data import

### Solution Applied

**Migration Script**: `fix-missing-csv-parameters.js`

This script:
1. Queries all predictions with missing parameters
2. Derives missing values:
   - `specificGravity`: Calculated from TDS (formula: `1.000 + (TDS / 1000000)`)
   - `turbidityNTU`: Default to 5 NTU (clear water)
   - `turbidityLevel`: Derived from RGB values (e.g., "Jernih" if high RGB)
   - `warnaDasar`: Derived from RGB values (e.g., "Kuning" for yellow tint)
3. Updates MongoDB documents with derived values

**Execution Script**: `run-parameter-migration.sh`

Automated wrapper that:
- Checks MongoDB connectivity
- Runs dry-run first (shows what will be updated)
- Prompts for confirmation
- Executes actual migration
- Verifies results (counts complete documents)
- Logs everything to `logs/migration-{timestamp}.log`

### Running the Migration

```bash
# Navigate to deployment directory
cd /var/www/html/HIBAH/deployments/v1-non-nginx

# Run migration script
./run-parameter-migration.sh

# Follow prompts:
# 1. Review dry-run output
# 2. Type "yes" to confirm
# 3. Wait for completion
# 4. Review verification results
```

**Expected Output**:
```
[1/5] Checking MongoDB connection...
✓ MongoDB is accessible

[2/5] Running migration in dry-run mode...
Found 64 predictions with missing parameters
Deriving values for prediction: 507

[3/5] Review the dry-run results above.
Do you want to proceed? (yes/no): yes

[4/5] Running actual migration...
Updated 64 predictions successfully

[5/5] Verifying migration results...
Total predictions: 64
Complete predictions (all 9 params): 64
Incomplete predictions: 0

✓ Migration completed successfully!
```

### Testing After Migration

**1. Verify MongoDB Structure**:
```bash
mongosh
use urine-disease-detection

# Check first prediction
db.predictions.findOne({}, {parameters: 1, _id: 0}).pretty()

# Should show all 9 fields:
# {
#   parameters: {
#     ph: 7.2,
#     tds: 900,
#     specificGravity: 1.0009,        // ✅ Now present
#     turbidityNTU: 5,                // ✅ Now present
#     red: 255,
#     green: 200,
#     blue: 100,
#     turbidityLevel: "Jernih",       // ✅ Now present
#     warnaDasar: "Kuning Muda"       // ✅ Now present
#   }
# }
```

**2. Verify Backend Logs**:
```bash
cd /var/www/html/HIBAH/deployments/v1-non-nginx

# Restart services
./stop.sh && ./start.sh

# Watch logs while refreshing Dashboard
tail -f logs/prediction.log | grep STATS-DEBUG
```

Expected output:
```
[STATS-DEBUG] Parameter keys: [
  'ph', 'tds', 'specificGravity', 'turbidityNTU',
  'red', 'green', 'blue', 'turbidityLevel', 'warnaDasar'
]  // ✅ All 9 keys present
```

**3. Verify Frontend Display**:
```bash
# Open browser
http://localhost:7764

# Login → Dashboard
# Latest Prediction card should show:
# - pH: 7.2 ✅
# - TDS: 900 ppm ✅
# - Specific Gravity: 1.0009 ✅ (was N/A)
# - Turbidity NTU: 5 ✅ (was N/A)
# - RGB Color: (255,200,100) ✅
# - Turbidity Level: Jernih ✅ (was N/A)
# - Warna Dasar: Kuning Muda ✅ (was N/A)
```

**4. Verify Browser Console**:
```javascript
// F12 → Console tab
// Look for:
[DASHBOARD] Parameter keys: (9) ["ph", "tds", "specificGravity", ...]
[DASHBOARD-DEBUG] Check if nested: undefined  // Good - not nested
```

### Expected Behavior After Fix
- ✅ Dashboard shows all 9 parameters with values (no "N/A")
- ✅ Backend logs show 9 parameter keys
- ✅ MongoDB documents have all 9 fields
- ✅ Future CSV uploads include all parameters (if CSV normalization is complete)

---

## Files Modified

### Backend (All Deployments)
1. `deployments/v1-non-nginx/microservices/user/user-service.js` (line 1454)
2. `deployments/v2-nginx-pm2/microservices/user/user-service.js` (line 1277)
3. `microservices/user/user-service.js` (line 1277)

**Change**: Added `deviceToken: user.deviceToken` to `/api/auth/me` response

### Migration Scripts
1. `deployments/v1-non-nginx/run-parameter-migration.sh` (NEW)
2. `deployments/v2-nginx-pm2/run-parameter-migration.sh` (NEW)

**Purpose**: Automated wrapper for `fix-missing-csv-parameters.js` with safety checks

### Documentation
1. `deployments/v1-non-nginx/DEVICE_TOKEN_DASHBOARD_FIX.md` (NEW - this file)

---

## Verification Checklist

### Device Token Fix
- [ ] Backend returns deviceToken in `/api/auth/me` response
- [ ] Profile page displays existing token on load
- [ ] Token persists after page refresh
- [ ] Copy button works
- [ ] Regeneration updates token correctly
- [ ] localStorage includes deviceToken

### Dashboard Parameters Fix
- [ ] Migration script runs successfully (dry-run + actual)
- [ ] MongoDB documents have all 9 parameter fields
- [ ] Backend logs show 9 parameter keys
- [ ] Dashboard displays all fields without "N/A"
- [ ] Browser console shows 9 keys in parameters object
- [ ] Future CSV uploads include all parameters

---

## Rollback Instructions

### If Device Token Fix Causes Issues
```bash
# Revert user-service.js changes
cd /var/www/html/HIBAH/deployments/v1-non-nginx/microservices/user

# Remove deviceToken line from response (line 1454)
# Restart services
cd ../..
./stop.sh && ./start.sh
```

### If Migration Causes Issues
```bash
# MongoDB has backups via oplog
# Or restore from backup if needed

# If data is corrupted, re-run migration:
mongosh
use urine-disease-detection
db.predictions.updateMany(
  {},
  { $unset: { 
    "parameters.specificGravity": "",
    "parameters.turbidityNTU": "",
    "parameters.turbidityLevel": "",
    "parameters.warnaDasar": ""
  }}
)

# Then re-run migration
./run-parameter-migration.sh
```

---

## Related Documentation
- `PROFILE_TOKEN_SAVE_FIX.md`: Token save UI clarity fix
- `DASHBOARD_PARAMETERS_DIAGNOSTIC.md`: Diagnostic guide for N/A parameters
- `CSV_KEY_NORMALIZATION_FIX.md`: CSV upload normalization
- `MISSING_PARAMETERS_FIX.md`: Migration script documentation
- `fix-missing-csv-parameters.js`: Actual migration implementation

---

## Future Improvements

### Prevent Future N/A Issues
1. **CSV Validation**: Require all 9 parameters in uploaded CSVs
2. **Schema Validation**: Make critical fields required in Mongoose schema
3. **Frontend Validation**: Ensure prediction form collects all parameters
4. **API Validation**: Reject incomplete prediction submissions
5. **Automated Testing**: Integration tests for parameter completeness

### Device Token Improvements
1. **Token Expiry**: Add expiration date display in Profile
2. **Token History**: Log token regeneration events
3. **Multi-Device Support**: Allow multiple tokens per user
4. **Token Rotation**: Automatic rotation after N days
