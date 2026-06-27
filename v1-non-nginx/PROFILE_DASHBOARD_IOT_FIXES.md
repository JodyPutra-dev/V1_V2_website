# Profile, Dashboard, and IoT Fixes Documentation

## Overview

This document details three critical fixes applied to the V1 deployment:
1. **Profile Device Token Copy Button** - HTTP compatibility fix
2. **Dashboard Parameter Display** - Fallback order correction
3. **ESP8266 IoT Integration** - New 9-parameter auto-upload sketch

---

## Issue 1: Device Token Copy Button Not Working

### Symptoms
- Click "Copy" button on Profile page → no visible error
- Try to paste token → nothing pastes (clipboard empty)
- Silent failure, no error messages
- Occurs on HTTP deployment (172.29.156.41:7764)

### Root Cause
**File:** `frontend/src/pages/Profile.js` line 439

**Original Code:**
```javascript
navigator.clipboard.writeText(user.deviceToken);
```

**Problem:** `navigator.clipboard` API requires **HTTPS** or `localhost`. V1 runs on **HTTP** (172.29.156.41:7764), causing silent failure.

**Browser Console Error (if checked):**
```
Uncaught (in promise) DOMException: Document is not focused.
```

### Solution Applied

**File:** `frontend/src/pages/Profile.js` lines 434-449

**New Code:**
```javascript
onClick={() => {
  if (user?.deviceToken) {
    try {
      // Fallback for HTTP (navigator.clipboard requires HTTPS)
      const textarea = document.createElement('textarea');
      textarea.value = user.deviceToken;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setSuccess('Device token copied to clipboard!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Copy failed:', err);
      setError('Failed to copy token. Please select and copy manually.');
    }
  }
}}
```

**How It Works:**
1. Create invisible `<textarea>` element
2. Set value to device token
3. Position off-screen (`position: fixed; opacity: 0`)
4. Append to document body
5. Select text in textarea
6. Execute copy command (`document.execCommand('copy')`)
7. Remove textarea from DOM
8. Show success message

**Benefits:**
- ✅ Works on HTTP (no HTTPS required)
- ✅ Compatible with all browsers (IE11+)
- ✅ No external dependencies
- ✅ Graceful error handling with try-catch

### Testing

**Test Steps:**
1. Open Profile page: http://172.29.156.41:7764/profile
2. Navigate to "Device Integration" section
3. Click **"Copy"** button next to token input
4. Verify success message: "Device token copied to clipboard!"
5. Open any text editor or terminal
6. Press `Ctrl+V` (or `Cmd+V` on Mac)
7. Verify token pastes correctly (32 hex characters)

**Expected Result:**
```
11899e4faa744b32781816963d3a791f
```

**Troubleshooting:**
- If copy still fails, check browser console (F12) for errors
- Try different browser (Chrome, Firefox, Edge)
- Ensure JavaScript is enabled
- Manual fallback: Select token text, press `Ctrl+C`

---

## Issue 2: Dashboard Shows N/A for Parameters

### Symptoms
- Dashboard "Latest Prediction" card shows:
  - ✅ pH: 7.2 (displays correctly)
  - ✅ TDS: 900 ppm (displays correctly)
  - ❌ Specific Gravity: **N/A** (should show 1.009)
  - ❌ Turbidity NTU: **N/A** (should show 5)
  - ✅ RGB Color: (255,200,100) (displays correctly)
  - ❌ Turbidity Level: **N/A** (should show "Jernih")
  - ❌ Warna Dasar: **N/A** (should show "KUNING")
- Backend logs show correct data saved to MongoDB
- CSV upload succeeds (processed: 5, failed: 0)

### Root Cause Analysis

**Backend Processing** (`prediction-service.js` lines 1015-1030):
```javascript
// CSV normalization - converts to camelCase
const keyNormalizationMap = {
  'specificgravity': 'specificGravity',
  'turbidityntu': 'turbidityNTU',
  'turbiditylevel': 'turbidityLevel',
  'warnadasar': 'warnaDasar',
  // ...
};
```

**Backend Logs** (lines 1107-1108):
```
[CSV-SAVE] Normalized parameter keys: [ 'ph', 'tds', 'specificGravity', 'turbidityNTU', ... ]
[CSV-SAVE] MongoDB saved parameter keys: [ 'ph', 'tds', 'specificGravity', 'turbidityNTU', ... ]
```

**Conclusion:** Backend saves data with **camelCase keys** (specificGravity, turbidityNTU, etc.)

**Frontend Display** (`Dashboard.js` line 535 - BEFORE FIX):
```javascript
// WRONG: Check lowercase first
parameters?.specificgravity || parameters?.specificGravity || 'N/A'
```

**Problem:** Frontend checks **lowercase first**, but data is **camelCase**, so it falls through to 'N/A'.

### Solution Applied

**File:** `frontend/src/pages/Dashboard.js`

**Changed Lines:**
- Line 535: Specific Gravity fallback
- Line 545: Turbidity NTU fallback
- Line 576: Turbidity Level fallback
- Line 580: Warna Dasar fallback

**Before (WRONG):**
```javascript
// Checks lowercase first → misses camelCase data
specificgravity || specificGravity || 'N/A'  // ❌
turbidityntu || turbidityNTU || 'N/A'        // ❌
turbiditylevel || turbidityLevel || 'N/A'    // ❌
warnadasar || warnaDasar || 'N/A'            // ❌
```

**After (CORRECT):**
```javascript
// Checks camelCase first → matches backend save format
specificGravity || specificgravity || 'N/A'  // ✅
turbidityNTU || turbidityntu || 'N/A'        // ✅
turbidityLevel || turbiditylevel || 'N/A'    // ✅
warnaDasar || warnadasar || 'N/A'            // ✅
```

**Why This Works:**
1. Backend normalizes CSV data to **camelCase** before MongoDB save
2. Dashboard now checks **camelCase first** (matches database)
3. Fallback to lowercase for legacy data (if any)
4. Final fallback to 'N/A' if neither exists

### Testing

**Test Steps:**
1. Upload CSV file: http://172.29.156.41:7764/ml-prediction
2. Use `sample-urine-data.csv` (5 rows)
3. Verify upload success: "CSV processed successfully: 5 rows"
4. Navigate to Dashboard: http://172.29.156.41:7764/dashboard
5. Check "Latest Prediction" card displays all 9 parameters

**Expected Result:**
```
Latest Prediction
─────────────────────────────
pH:                7.2
TDS:               900 ppm
Specific Gravity:  1.009        ← Now displays (was N/A)
Turbidity NTU:     5            ← Now displays (was N/A)
RGB Color:         (255,200,100)
Turbidity Level:   Jernih       ← Now displays (was N/A)
Warna Dasar:       KUNING       ← Now displays (was N/A)
Prediction:        Sehat
Confidence:        92%
```

**Verification (Browser Console F12):**
```javascript
// Debug logs show correct data structure
[DASHBOARD-FINAL] Stats set to state: {...}
[DASHBOARD-FINAL] Latest parameters after processing: {
  ph: 7.2,
  tds: 900,
  specificGravity: 1.009,      // camelCase key ✅
  turbidityNTU: 5,              // camelCase key ✅
  red: 255, green: 200, blue: 100,
  turbidityLevel: "Jernih",     // camelCase key ✅
  warnaDasar: "KUNING"          // camelCase key ✅
}
```

**Troubleshooting:**
- If still shows N/A, check browser console for `[DASHBOARD-NA-DEBUG]` logs
- Verify MongoDB data: `db.predictions.findOne({}, {parameters: 1})`
- Check backend logs: `tail -f logs/prediction.log | grep CSV-SAVE`
- Clear browser cache and refresh (Ctrl+Shift+R)

---

## Issue 3: ESP8266 IoT Integration

### Background

**Old Code:** `ESP8266/API-send.cpp` uses **6 parameters** (gravity, osmo, etc.) - outdated format

**New System:** Requires **9 parameters** (ph, tds, specificGravity, turbidityNTU, RGB, turbidityLevel, warnaDasar)

**Requirement:** Serial monitor "send" command to trigger upload (not automatic loop)

### Solution: New ESP8266 Sketch

**Location:** `IOT/ESP8266_AutoUpload_V2/`

**Files Created:**
- `ESP8266_AutoUpload_V2.ino` - Arduino sketch (main code)
- `README.md` - Complete setup and usage guide

### Sketch Features

**Hardware:**
- NodeMCU ESP8266
- 3 LEDs (Red D6, Yellow D7, Green D5)
- No LCD required (optional)

**Configuration:**
```cpp
// WiFi
const char* ssid = "E";
const char* password = "2711297449072!";

// API
const char* serverUrl = "https://172.29.156.41:7763/api/ml/autoupload";
const char* deviceToken = "11899e4faa744b32781816963d3a791f";
```

**Dummy Data (9 Parameters):**
```cpp
UrineData dummyData = {
  6.8,           // ph
  950,           // tds
  1.018,         // specificGravity
  7.5,           // turbidityNTU
  240,           // red
  200,           // green
  120,           // blue
  "Jernih",      // turbidityLevel
  "KUNING"       // warnaDasar
};
```

**Commands (Serial Monitor):**
- `send` - Send dummy data to backend
- `status` - Show WiFi and system status
- `help` - Show available commands

**LED Indicators:**
- Yellow: Connecting WiFi / Sending data
- Green: Success (200 OK)
- Red: Error (connection, 401, 500)

### Setup Steps

1. **Install Libraries** (Arduino IDE → Manage Libraries):
   - ESP8266WiFi (included with ESP8266 board)
   - ESP8266HTTPClient (included)
   - ArduinoJson (v6+)

2. **Configure Board** (Tools menu):
   - Board: "NodeMCU 1.0 (ESP-12E Module)"
   - Upload Speed: 115200
   - Port: `/dev/ttyUSB0` (Linux) or `COM3` (Windows)

3. **Update Sketch**:
   - Line 17-18: WiFi credentials
   - Line 21: API URL (7763 for V2, 7764 for V1)
   - Line 22: Device token (from Profile page)

4. **Upload to ESP8266**:
   - Connect NodeMCU via USB
   - Click Upload (→) button
   - Wait for "Done uploading"

5. **Test via Serial Monitor**:
   - Open Serial Monitor (115200 baud)
   - Wait for "Ready. Type 'send' to upload data."
   - Type `send` and press Enter

### Testing

**Expected Serial Output:**
```
=== ESP8266 Auto Upload V2 ===
9-Parameter Urine Analysis System
Connecting to WiFi: E
.....
WiFi Connected!
IP Address: 192.168.1.100

Ready. Type 'send' to upload data.

--- Sending Data ---
Dummy Urine Parameters:
  pH: 6.80
  TDS: 950 ppm
  Specific Gravity: 1.018
  Turbidity NTU: 7.50
  RGB: (240, 200, 120)
  Turbidity Level: Jernih
  Warna Dasar: KUNING
JSON Payload: {"ph":6.8,"tds":950,"specificGravity":1.018,...}
Sending to: https://172.29.156.41:7763/api/ml/autoupload
HTTP Response Code: 200
Response Body: {"success":true,"message":"Prediction saved",...}
✓ SUCCESS: Data uploaded successfully!
--- Done ---
```

**Backend Verification:**
```bash
# Watch backend logs
tail -f logs/ml.log | grep AUTOUPLOAD

# Expected output:
[AUTOUPLOAD] Device token validated for user: 673a...
[AUTOUPLOAD] Received data: ph=6.8, tds=950, specificGravity=1.018, ...
[AUTOUPLOAD] Prediction result: Sehat (Kidney Stone: No)
```

**Dashboard Verification:**
1. Open Dashboard: http://172.29.156.41:7764/dashboard
2. Check "Latest Prediction" shows IoT data
3. Verify all 9 parameters display correctly (not N/A)

### Common Issues

**HTTP 401 Unauthorized:**
- Token expired or invalid
- Solution: Regenerate token in Profile page → update sketch line 22 → re-upload

**HTTP 500 Server Error:**
- Backend service down or ML model error
- Solution: Check `tail -f logs/ml.log` → restart services if needed

**WiFi Connection Failed:**
- Wrong SSID/password or out of range
- Solution: Update lines 17-18 → verify 2.4GHz network (ESP8266 doesn't support 5GHz)

---

## Files Modified

### Frontend Changes
1. **V1 Profile.js** (lines 434-449) - Token copy fallback for HTTP
2. **V1 Dashboard.js** (lines 535, 545, 576, 580) - Parameter fallback order
3. **V2 Profile.js** - Same token copy fix (consistency)
4. **V2 Dashboard.js** - Same parameter fallback fix (consistency)

### Backend Changes
- No backend changes required (backend already saves camelCase correctly)

### New Files
1. **IOT/ESP8266_AutoUpload_V2/ESP8266_AutoUpload_V2.ino** - Arduino sketch
2. **IOT/ESP8266_AutoUpload_V2/README.md** - Setup guide
3. **PROFILE_DASHBOARD_IOT_FIXES.md** - This documentation

---

## Verification Checklist

### Profile Token Copy
- [ ] Open Profile page
- [ ] Click "Copy" button
- [ ] Paste token in text editor
- [ ] Verify 32 hex characters paste correctly
- [ ] Success message appears

### Dashboard Parameters
- [ ] Upload CSV with 5 rows
- [ ] Navigate to Dashboard
- [ ] Verify Specific Gravity shows value (not N/A)
- [ ] Verify Turbidity NTU shows value (not N/A)
- [ ] Verify Turbidity Level shows text (not N/A)
- [ ] Verify Warna Dasar shows text (not N/A)

### ESP8266 IoT
- [ ] Sketch uploaded to NodeMCU
- [ ] Serial Monitor shows WiFi connected
- [ ] Type "send" → HTTP 200 OK
- [ ] Backend logs show [AUTOUPLOAD] entries
- [ ] Dashboard displays IoT prediction
- [ ] All 9 parameters visible (not N/A)

---

## Next Steps

1. ✅ Frontend fixes applied (Profile copy, Dashboard parameters)
2. ✅ ESP8266 sketch created with 9-parameter support
3. ✅ Documentation updated
4. 🔄 Test CSV upload → Dashboard display workflow
5. 🔄 Test ESP8266 → Backend → Dashboard workflow
6. 🔄 Integrate real sensors (TDS, pH, turbidity) to ESP8266
7. 🔄 Add automatic upload timer (every 5 minutes)
8. 🔄 Deploy to production environment

---

## Related Documentation

- **Backend API:** `api-documentation.md`
- **System Architecture:** `README.md`
- **CSV Upload Flow:** `CSV_INDEX_ERROR_FIX.md`
- **Token Management:** `PROFILE_TOKEN_SAVE_FIX.md`
- **ESP8266 Setup:** `IOT/ESP8266_AutoUpload_V2/README.md`

---

## Support

**Issues:**
- Profile copy not working → Check browser console (F12)
- Dashboard shows N/A → Check `[DASHBOARD-NA-DEBUG]` logs
- ESP8266 401 error → Regenerate token in Profile
- ESP8266 500 error → Check backend logs: `tail -f logs/ml.log`

**Testing Commands:**
```bash
# Restart services
cd /var/www/html/HIBAH/deployments/v1-non-nginx
./stop.sh && ./start.sh

# Watch logs
tail -f logs/prediction.log | grep CSV-SAVE
tail -f logs/ml.log | grep AUTOUPLOAD

# Check MongoDB
mongosh "mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection" --authenticationDatabase admin
db.predictions.find().sort({createdAt: -1}).limit(1).pretty()
```
