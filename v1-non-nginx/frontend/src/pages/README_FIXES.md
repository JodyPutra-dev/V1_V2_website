# Frontend Issues and Fixes - Quick Reference

## Issue 1: Device Token Not Saving ✅ FIXED

**Problem**: Clicking "Save Changes" doesn't save device token

**Root Cause**: Token field is display-only (disabled input), not in form state (`profileInfo` only has name/email)

**Solution**: UI clarity - token managed ONLY via "Generate/Regenerate Token" modal button

**How to Use**:
1. Click "Generate Token" or "Regenerate Token" button
2. Confirm in modal
3. Token appears in field + saved to MongoDB + localStorage
4. "Save Changes" button is for name/profile image only

**Files Modified**:
- `Profile.js` lines 409, 436-438 (UI text only)

**Documentation**: See `PROFILE_TOKEN_SAVE_FIX.md` in deployment root

---

## Issue 2: Dashboard Parameters Show N/A ⚠️ NEEDS USER INPUT

**Problem**: Specific Gravity, Turbidity NTU, Turbidity Level, Warna Dasar show "N/A"

**Working**: pH, TDS, RGB colors display correctly

**Next Steps**:
1. **Open browser console** (F12) on Dashboard page
2. **Find these logs**:
   ```
   [DASHBOARD] Full parameters object: {...}
   [DASHBOARD] Parameter keys: [...]
   [DASHBOARD-DEBUG] Raw parameters JSON: {...}
   [DASHBOARD-DEBUG] Check if nested: ...
   ```
3. **Copy full console output** and provide to developer
4. **Run MongoDB query**:
   ```bash
   mongosh
   use urine-disease-detection
   db.predictions.findOne({user: ObjectId("YOUR_USER_ID")}, {parameters: 1})
   ```
5. **Provide MongoDB output** showing actual `parameters` structure

**Possible Fixes** (after diagnosis):
- Run migration: `node fix-missing-csv-parameters.js`
- Update CSV normalization in backend
- Add nested fallback in Dashboard.js (already added in current version)

**Files Modified**:
- `Dashboard.js` lines 153-154 (enhanced logging)
- `Dashboard.js` lines 528, 532, 558, 562 (nested fallback support)

**Documentation**: See `DASHBOARD_PARAMETERS_DIAGNOSTIC.md` in deployment root

---

## Testing Checklist

### Token Generation
- [ ] Click "Generate Token" → modal appears
- [ ] Confirm → token shows in field (32-char hex)
- [ ] Copy button works
- [ ] Refresh page → token persists
- [ ] Check MongoDB: `db.users.findOne({email: "..."}, {deviceToken: 1})`
- [ ] "Save Changes" button does NOT affect token

### Dashboard Parameters
- [ ] Upload CSV with all 9 params
- [ ] Check Dashboard → all fields show values (not N/A)
- [ ] Check console logs for parameter structure
- [ ] If N/A persists → provide console output to developer
- [ ] Check backend logs: `tail -f logs/prediction.log | grep STATS-DEBUG`

### CSV Upload
- [ ] Use `sample-urine-data.csv` (5 rows)
- [ ] Upload → "CSV processed successfully"
- [ ] Results table shows all 9 params + hydration
- [ ] Dashboard updates with latest prediction
- [ ] Check logs: `tail -f logs/prediction.log | grep CSV-SAVE`

---

## Quick Commands

```bash
# Rebuild frontend after fixes
cd /var/www/html/HIBAH/deployments/v1-non-nginx/frontend
npm run build

# Restart services
cd /var/www/html/HIBAH/deployments/v1-non-nginx
./stop.sh && ./start.sh

# Check prediction logs (backend)
tail -f logs/prediction.log | grep -E "STATS-DEBUG|CSV-SAVE"

# Check user logs (token generation)
tail -f logs/user.log | grep "Device token"

# Test token generation API
node test-device-token.js

# Run parameter migration (if needed after diagnosis)
node fix-missing-csv-parameters.js

# Check MongoDB predictions structure
mongosh
use urine-disease-detection
db.predictions.findOne({}, {parameters: 1, _id: 0}).pretty()

# Check MongoDB user tokens
db.users.findOne({email: "test@example.com"}, {deviceToken: 1, _id: 0})
```

---

## Diagnostic Output Examples

### Token Generation Success
```javascript
// Browser Console
Device token regenerated successfully! Update your IoT device.

// MongoDB
{ deviceToken: "a1b2c3d4e5f6789..." }  // 32-char hex

// localStorage
{"user": {"email": "...", "deviceToken": "a1b2c3d4..."}}
```

### Parameters Diagnostic (Good)
```javascript
// Browser Console
[DASHBOARD] Parameter keys: (9) ["ph", "tds", "specificGravity", "turbidityNTU", "red", "green", "blue", "turbidityLevel", "warnaDasar"]
[DASHBOARD-DEBUG] Check if nested: undefined  // Good - not nested
```

### Parameters Diagnostic (Bad - Missing Fields)
```javascript
// Browser Console
[DASHBOARD] Parameter keys: (5) ["ph", "tds", "red", "green", "blue"]
[DASHBOARD] specificGravity value: undefined
// → Need to run migration or fix CSV normalization
```

---

## File References

### Frontend Files
- `Profile.js`: User profile form, token display, modal handler
- `Dashboard.js`: Latest prediction display, parameter fallbacks
- `api.js`: API endpoints (regenerateDeviceToken, getStats, uploadCSV)

### Backend Files
- `user-service.js`: Token generation endpoint (line 1198-1234)
- `prediction-service.js`: Stats endpoint (line 431-497), CSV upload (line ~1000-1100)

### Documentation
- `PROFILE_TOKEN_SAVE_FIX.md`: Token save issue explanation
- `DASHBOARD_PARAMETERS_DIAGNOSTIC.md`: Parameter N/A investigation guide
- `DASHBOARD_NA_INVESTIGATION.md`: Comprehensive investigation steps
- `fix-missing-csv-parameters.js`: Migration script for missing parameters

### Testing Scripts
- `test-device-token.js`: E2E token generation test
- `sample-urine-data.csv`: Test CSV with all 9 parameters
