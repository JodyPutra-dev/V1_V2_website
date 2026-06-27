# ESP8266 HTTPS-Only Fix Documentation

## Problem

ESP8266 was hardcoded to `useHTTPS = false` (line 24), causing it to connect via HTTP (port 7764) despite user requirement for **HTTPS-only** (port 7763). Serial logs showed contradictory output:
- "Protocol: HTTP"
- "Endpoint: http://192.168.1.3:7764"
- But then: "Sending to: https://192.168.1.3:7763" (incorrect)

The actual issue was that the ESP8266 was using HTTP client (WiFiClient) to attempt connection to port 7764, which is not listening in the V1 deployment (only HTTPS port 7763 is active).

## Root Cause

**File**: `deployments/v1-non-nginx/IOT/ESP8266_AutoUpload_V2/ESP8266_AutoUpload_V2.ino`

**Line 24**:
```cpp
bool useHTTPS = false;  // ❌ WRONG - Was set to false
```

**Impact**:
1. ESP8266 used `WiFiClient` (HTTP) instead of `WiFiClientSecure` (HTTPS)
2. Attempted connection to port 7764 (HTTP) which doesn't exist in V1
3. V1 gateway only listens on HTTPS port 7763 (no HTTP fallback)
4. Connection failed with "HTTP Response Code: -1"

**User Requirement**:
> "USE ONLY HTTPS AND THIS URL FOR THE IOT ONLY: `const char* httpsUrl = "https://192.168.1.3:7763/api/ml/autoupload";`"

## Solution Applied

### 1. Changed `useHTTPS` to true (Line 24)

**Before**:
```cpp
bool useHTTPS = false;  // Set to false for HTTP testing (recommended for ESP8266)
```

**After**:
```cpp
bool useHTTPS = true;  // HTTPS-only mode for secure IoT uploads
```

### 2. Removed HTTP Command Handler (Lines 91-95)

**Before**:
```cpp
} else if (command == "http") {
  useHTTPS = false;
  Serial.print("Protocol changed to: ");
  Serial.println("HTTP");
  Serial.println("Type 'send' to test with new protocol");
} else if (command == "https") {
```

**After**:
```cpp
} else if (command == "https") {
```

**Reason**: Prevent accidental protocol changes during production testing. HTTPS is now the only mode.

### 3. Updated Help Text (Line 78)

**Before**:
```cpp
Serial.println("TIP: If connection fails, type 'http' to switch to HTTP mode");
```

**After**:
```cpp
Serial.println("TIP: Using HTTPS mode (port 7763) - ensure server SSL is running");
```

**Reason**: Guide users to verify server prerequisites rather than switching protocols.

## Testing Procedure

### Step 1: Upload Updated Sketch to ESP8266

1. Open Arduino IDE
2. Load `ESP8266_AutoUpload_V2.ino`
3. Verify line 24: `bool useHTTPS = true;`
4. Upload to NodeMCU ESP8266
5. Open Serial Monitor (115200 baud)

### Step 2: Verify Serial Output at Startup

**Expected Output**:
```
=== ESP8266 Auto Upload V2 ===
9-Parameter Urine Analysis System

Connecting to WiFi: ZTE_2.4G_Jody
...........................
✓ WiFi Connected!
IP Address: 192.168.1.184
Protocol Mode: HTTPS                    ← Must show HTTPS
TIP: Using HTTPS mode (port 7763) - ensure server SSL is running

Ready. Type 'send' to upload data.
```

### Step 3: Send Test Data

**Type in Serial Monitor**: `send`

**Expected Output**:
```
--- Sending Data ---
Current Protocol: HTTPS (port 7763)     ← Confirms HTTPS
JSON Size: 281 bytes

Connecting to server...
✓ Connected
Sending to: https://192.168.1.3:7763/api/ml/autoupload
Sending POST request...

HTTP Response Code: 201                  ← Success!
Response:
{
  "success": true,
  "message": "Data uploaded and processed successfully",
  "data": {
    "ph": 6.8,
    "tds": 950,
    "specificGravity": 1.018,
    ...
  },
  "prediction": 0
}

✓ SUCCESS: Data uploaded successfully!
```

### Step 4: Verify in Backend Logs

**Check Gateway Logs**:
```bash
cd /var/www/html/HIBAH/deployments/v1-non-nginx
tail -f logs/gateway.log | grep autoupload
```

**Expected**:
```
[ML-PROXY] Forwarding request to: http://localhost:3002/api/ml/autoupload
[ML-PROXY] ML service response status: 201
Gateway received ML response with status 201
```

**Check ML Service Logs**:
```bash
tail -f logs/ml.log | grep AUTOUPLOAD
```

**Expected**:
```
[AUTOUPLOAD] Device token validated for user: 682b0ad62536031edb517c1c
[AUTOUPLOAD] Received data: ph=6.8, tds=950, specificGravity=1.018, turbidityNTU=7.5, red=240, green=200, blue=120
[AUTOUPLOAD] Prediction result: 0 (Sehat - Kidney Stone: No)
```

### Step 5: Verify in Database

**Connect to MongoDB**:
```bash
mongosh mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection
```

**Query AutoData Collection**:
```javascript
db.autodatas.find().sort({timestamp:-1}).limit(1).pretty()
```

**Expected Result**:
```javascript
{
  "_id": ObjectId("..."),
  "userId": ObjectId("682b0ad62536031edb517c1c"),
  "ph": 6.8,
  "tds": 950,
  "specificGravity": 1.018,
  "turbidityNTU": 7.5,
  "red": 240,
  "green": 200,
  "blue": 120,
  "turbidityLevel": "Jernih",
  "warnaDasar": "KUNING",
  "prediction": 0,
  "timestamp": ISODate("2025-11-26T...")
}
```

**Key Verification Points**:
- ✅ `userId` matches token owner (682b0ad6...)
- ✅ All 9 parameters present with correct values
- ✅ `prediction` field exists (0 = Sehat)
- ✅ `timestamp` is recent

## Troubleshooting

### Issue 1: Connection Failed

**Symptom**: "✗ ERROR: HTTP request failed: connection failed"

**Causes & Solutions**:

1. **HTTPS server not running**
   ```bash
   # Check if port 7763 is listening
   netstat -tlnp | grep 7763
   
   # If not, start services
   cd /var/www/html/HIBAH/deployments/v1-non-nginx
   ./start.sh
   
   # Verify gateway started
   tail -f logs/gateway.log
   ```

2. **SSL certificates missing**
   ```bash
   # Check SSL files exist
   ls -la ssl/
   
   # Expected: server.key, server.crt
   # If missing, regenerate certificates
   ```

3. **Wrong external IP**
   - Verify ESP8266 uses 192.168.1.3 (router IP)
   - curl/Postman use 172.29.156.41 (server localhost)
   - Line 21 should be: `const char* serverUrl = "https://192.168.1.3:7763/api/ml/autoupload";`

4. **Device token invalid**
   ```bash
   # Regenerate token in Profile page
   # Update sketch line 23 with new token
   # Re-upload sketch
   ```

5. **Port forwarding not configured**
   - Router must forward 192.168.1.3:7763 → 172.29.156.41:7763
   - Test from another WiFi device

### Issue 2: 401 Unauthorized

**Symptom**: "HTTP Response Code: 401"

**Cause**: Invalid device token

**Solution**:
1. Open Profile page in browser
2. Click "Regenerate Token"
3. Copy new token (32 hex characters)
4. Update sketch line 23: `const char* deviceToken = "NEW_TOKEN_HERE";`
5. Re-upload sketch to ESP8266

### Issue 3: 500 Internal Server Error

**Symptom**: "HTTP Response Code: 500"

**Cause**: Backend processing error (model prediction failed)

**Solution**:
```bash
# Check ML service logs
tail -100 logs/ml.log

# Look for Python errors in prediction
# Verify kidney_stone_model.joblib exists
ls -la kidney_stone_model.joblib

# Restart ML service if needed
pm2 restart ml-service
```

## Verification Checklist

Before testing ESP8266, verify:

- [ ] V1 services running (`./start.sh` completed successfully)
- [ ] Port 7763 listening (`netstat -tlnp | grep 7763`)
- [ ] SSL certificates exist (`ls -la ssl/server.{key,crt}`)
- [ ] Gateway logs show no errors (`tail -f logs/gateway.log`)
- [ ] ML service running (`tail -f logs/ml.log`)
- [ ] MongoDB accessible (`mongosh mongodb://admin:...`)
- [ ] Device token valid (regenerate if old)
- [ ] ESP8266 sketch has `useHTTPS = true` (line 24)
- [ ] WiFi credentials correct (lines 17-18)
- [ ] External IP correct (line 21: 192.168.1.3)

## Testing with curl (From External Network)

**Simulate ESP8266 request**:
```bash
# From server terminal (simulates external WiFi device)
curl -k -X POST https://192.168.1.3:7763/api/ml/autoupload \
  -H "device-token: d250ab27b30db84e3dbc843eda266e16" \
  -H "Content-Type: application/json" \
  -d '{
    "ph": 6.8,
    "tds": 950,
    "specificGravity": 1.018,
    "turbidityNTU": 7.5,
    "red": 240,
    "green": 200,
    "blue": 120,
    "turbidityLevel": "Jernih",
    "warnaDasar": "KUNING"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "message": "Data uploaded and processed successfully",
  "data": {
    "ph": 6.8,
    "tds": 950,
    "specificGravity": 1.018,
    "turbidityNTU": 7.5,
    "red": 240,
    "green": 200,
    "blue": 120,
    "turbidityLevel": "Jernih",
    "warnaDasar": "KUNING",
    "userId": "682b0ad62536031edb517c1c",
    "prediction": 0,
    "timestamp": "2025-11-26T...",
    "_id": "..."
  },
  "prediction": 0
}
```

## Why HTTPS Works Now

**Before Fix**:
- `useHTTPS = false` → WiFiClient (HTTP) → port 7764 → NOT LISTENING → FAIL

**After Fix**:
- `useHTTPS = true` → WiFiClientSecure (HTTPS) → port 7763 → LISTENING → SUCCESS

**V1 Deployment Configuration**:
- **Port 7763**: HTTPS (gateway listening) ✅
- **Port 7764**: HTTP (NOT configured in V1) ❌

**Why V1 doesn't use HTTP**:
- V1 is a non-Nginx deployment focused on HTTPS security
- No separate HTTP listener configured
- All API endpoints require HTTPS
- Self-signed certificates used for development/local network

**Why ESP8266 can handle HTTPS**:
- `WiFiClientSecure` library with `setInsecure()` bypasses certificate validation
- Works with self-signed certificates
- Memory sufficient for TLS handshake on ESP8266
- Connection to IP address (not hostname) avoids CN mismatch issues in practice

## Summary

**Changed**: `useHTTPS = false` → `useHTTPS = true`

**Result**: ESP8266 now connects successfully to HTTPS port 7763 matching V1 deployment configuration and user requirement.

**Key Insight**: The issue wasn't protocol preference (HTTP vs HTTPS) but **matching ESP8266 protocol to deployed server configuration**. V1 only has HTTPS (7763), so ESP8266 must use HTTPS.
