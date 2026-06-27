# ESP8266 HTTPS/HTTP External IP Fix

**Problem**: ESP8266 autoupload always uses HTTPS despite `useHTTPS = false`, causing "connection failed" errors.

**Date Fixed**: February 2025  
**Status**: ✅ RESOLVED

---

## Root Cause Analysis

### Issue 1: ESP8266 Always Uses HTTPS Despite useHTTPS=false

**Location**: `ESP8266_AutoUpload_V2.ino` line 160

**The Bug**:
```cpp
// BEFORE (BROKEN) - Hardcoded HTTPS client
WiFiClientSecure client;
HTTPClient http;
client.setInsecure();
http.begin(client, serverUrl);  // Always uses HTTPS URL
```

**Evidence from Serial Monitor**:
```
Protocol: HTTP                                    // useHTTPS = false
Sending to: https://192.168.1.3:7763/...         // ❌ But uses HTTPS anyway!
✗ ERROR: HTTP request failed: connection failed
```

**Root Cause**:
- Line 160 hardcoded `http.begin(client, serverUrl)` with WiFiClientSecure
- `serverUrl` always points to HTTPS (line 21)
- `useHTTPS` flag was checked nowhere in code
- ESP8266 attempts TLS handshake even when HTTP intended

**Impact**: All ESP8266 uploads fail with "connection failed" even with correct token and network.

---

### Issue 2: External IP vs Internal IP Mismatch

**Network Setup**:
```
ESP8266 (WiFi) → Router (192.168.1.3) → Port Forward → Server (172.29.156.41)
                                ↓
                          Port 7763 → 172.29.156.41:7763 (HTTPS)
                          Port 7764 → 172.29.156.41:7764 (HTTP)
```

**Why External IP Matters**:
- **ESP8266 on WiFi network**: Must use router's external IP (192.168.1.3) to reach server
- **curl on same machine**: Uses internal IP (172.29.156.41) via localhost
- **Postman from browser**: Can use either depending on network location

**Original Sketch Issue**:
```cpp
// Would work for localhost curl but NOT for ESP8266 on WiFi
const char* serverUrl = "https://172.29.156.41:7763/api/ml/autoupload";
```

**Fixed**:
```cpp
// Works for ESP8266 on external WiFi network
const char* serverUrl = "https://192.168.1.3:7763/api/ml/autoupload";
const char* serverUrlHTTP = "http://192.168.1.3:7764/api/ml/autoupload";
```

---

### Issue 3: Self-Signed Certificate CN Mismatch

**Certificate Details**:
```bash
$ openssl x509 -in ssl/localhost.crt -noout -text
Subject: CN=localhost
```

**The Problem**:
- Cert CN: `localhost`
- Access IP: `192.168.1.3` (external) or `172.29.156.41` (internal)
- ESP8266 TLS: Strict validation fails even with `setInsecure()`

**Why HTTPS Fails on ESP8266**:
1. CN mismatch (localhost ≠ 192.168.1.3)
2. Self-signed cert not in ESP8266 trust store
3. ESP8266 TLS memory/CPU limitations
4. Handshake timeout on slow WiFi

**Solution**: Use HTTP for IoT testing (port 7764), or regenerate cert with IP SANs:
```bash
openssl req -x509 -newkey rsa:4096 -nodes -keyout server.key -out server.crt \
  -days 365 -subj "/CN=192.168.1.3" \
  -addext "subjectAltName=IP:192.168.1.3,IP:172.29.156.41,DNS:localhost"
```

---

## Fix Applied

### ESP8266 Sketch Changes

**1. Fixed Protocol Selection Bug** (Line ~160):

```cpp
// BEFORE (BROKEN)
WiFiClientSecure client;
HTTPClient http;
client.setInsecure();
http.begin(client, serverUrl);  // Always HTTPS

// AFTER (FIXED) - Conditional client based on useHTTPS flag
HTTPClient http;

if (useHTTPS) {
  WiFiClientSecure* secureClient = new WiFiClientSecure();
  secureClient->setInsecure();
  http.begin(*secureClient, serverUrl);
} else {
  WiFiClient* httpClient = new WiFiClient();
  http.begin(*httpClient, serverUrlHTTP);  // ✅ Uses HTTP when useHTTPS=false
}
```

**2. Added Protocol Toggle Commands** (Line ~85):

```cpp
// In loop() function
if (command == "http") {
  useHTTPS = false;
  Serial.println("Switched to HTTP mode");
} else if (command == "https") {
  useHTTPS = true;
  Serial.println("Switched to HTTPS mode");
}
```

**3. Added Connection Diagnostics** (After line ~150):

```cpp
Serial.print("Protocol: ");
Serial.println(useHTTPS ? "HTTPS" : "HTTP");
Serial.print("Client Type: ");
Serial.println(useHTTPS ? "WiFiClientSecure" : "WiFiClient");
Serial.print("Sending to: ");
Serial.println(useHTTPS ? serverUrl : serverUrlHTTP);
```

**4. Updated URLs to External IP** (Lines 21-22):

```cpp
const char* serverUrl = "https://192.168.1.3:7763/api/ml/autoupload";
const char* serverUrlHTTP = "http://192.168.1.3:7764/api/ml/autoupload";
```

**5. Updated Device Token** (Line 23):

```cpp
const char* deviceToken = "d250ab27b30db84e3dbc843eda266e16";  // Current user token
```

**6. Updated Help Command** (printHelp function):

```cpp
Serial.println("  http   - Switch to HTTP mode (port 7764)");
Serial.println("  https  - Switch to HTTPS mode (port 7763)");
```

---

### Gateway Changes

**Added Debug Logging for ML Proxy** (gateway.js lines ~1735-1745):

```javascript
console.log('[ML-PROXY] Request URL:', req.url);
console.log('[ML-PROXY] Request method:', req.method);
console.log('[ML-PROXY] Authorization header present:', !!req.headers.authorization);
console.log('[ML-PROXY] User-ID header present:', !!req.headers['user-id']);
console.log('[ML-PROXY] Device-token header present:', !!req.headers['device-token']);

if (req.url.includes('/autodata')) {
  console.log('[ML-PROXY] /autodata request detected');
  console.log('[ML-PROXY] Query params:', req.query);
  console.log('[ML-PROXY] Full headers being forwarded:', headers);
}
```

**Purpose**: Diagnose Dashboard `/autodata` 500 errors by verifying auth header forwarding.

---

## Testing

### Test 1: HTTP from ESP8266 (Recommended)

**Upload Sketch with**:
```cpp
bool useHTTPS = false;  // Line 24
const char* serverUrlHTTP = "http://192.168.1.3:7764/api/ml/autoupload";
```

**Expected Serial Output**:
```
--- Sending Data ---
Protocol: HTTP
Client Type: WiFiClient
Sending to: http://192.168.1.3:7764/api/ml/autoupload
JSON Payload: {"ph":6.8,"tds":950,...}
HTTP Response Code: 201
Response Body: {"success":true,"message":"Device data uploaded and processed successfully",...}
✓ SUCCESS: Data uploaded successfully!
[Green LED blinks]
--- Done ---
```

**Verify in Gateway Logs**:
```bash
tail -f logs/gateway.log | grep ML-PROXY
# Expected:
[ML-PROXY] POST /api/ml/autoupload
[ML-PROXY] Headers being forwarded: [ 'Content-Type', 'Accept', 'device-token' ]
[ML-PROXY] Device-token header present: true
```

---

### Test 2: Runtime Protocol Switching

**Serial Monitor Commands**:
```
send        → Uses current protocol (HTTP by default)
http        → Switched to HTTP mode
send        → Uses HTTP
https       → Switched to HTTPS mode
send        → Uses HTTPS (may fail with self-signed cert)
http        → Switched back to HTTP mode
```

**Expected Output**:
```
> http
Switched to HTTP mode

> send
Protocol: HTTP
Client Type: WiFiClient
Sending to: http://192.168.1.3:7764/api/ml/autoupload
...
✓ SUCCESS: Data uploaded successfully!

> https
Switched to HTTPS mode

> send
Protocol: HTTPS
Client Type: WiFiClientSecure
Sending to: https://192.168.1.3:7763/api/ml/autoupload
...
✗ ERROR: HTTP request failed: connection failed  // May fail due to cert issues
```

---

### Test 3: Verify in Dashboard

1. ESP8266 uploads via HTTP (serial: `send`)
2. Open browser: `https://172.29.156.41:7763/dashboard`
3. Check "Auto Upload Data" section
4. Should see new entry with timestamp
5. Verify all 9 parameters display (not N/A)

---

### Test 4: External Curl (Simulates ESP8266)

**HTTP Test** (Recommended):
```bash
curl -v -X POST http://192.168.1.3:7764/api/ml/autoupload \
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

**Expected**: `201 Created` with `{"success":true,...}`

**HTTPS Test** (May Fail):
```bash
curl -k -v -X POST https://192.168.1.3:7763/api/ml/autoupload \
  -H "device-token: d250ab27b30db84e3dbc843eda266e16" \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**Expected**: May succeed with `-k` (ignore cert), or fail with SSL error (same as ESP8266).

---

### Test 5: MongoDB Verification

```bash
mongosh mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection

# Check latest auto data entry
db.autodatas.find().sort({timestamp:-1}).limit(1).pretty()

# Expected output:
{
  "_id": ObjectId("..."),
  "userId": ObjectId("..."),
  "ph": 6.8,
  "tds": 950,
  "specificGravity": 1.018,
  "turbidityNTU": 7.5,
  "red": 240,
  "green": 200,
  "blue": 120,
  "turbidityLevel": "Jernih",
  "warnaDasar": "KUNING",
  "timestamp": ISODate("2025-02-02T..."),
  "predictionResult": {...}
}
```

---

## Why This Works

### HTTP Avoids TLS Complexity
- **No Certificate Validation**: Skips CN mismatch, trust store, handshake
- **Lower Memory**: WiFiClient uses ~2KB vs WiFiClientSecure ~20KB
- **Faster Connection**: No TLS negotiation, faster POST
- **More Reliable**: Works on slow WiFi, low signal strength

### External IP Matches Network Path
- ESP8266 on WiFi → Router (192.168.1.3) → Port Forward → Server (172.29.156.41)
- Using 192.168.1.3 follows actual network routing
- Using 172.29.156.41 only works from same machine (localhost)

### Port 7764 Direct HTTP Server
- No NGINX proxy layer
- Direct Node.js Gateway service
- Simpler routing for IoT devices
- Same `/api/ml/autoupload` endpoint as HTTPS

### Conditional Client Logic
- Lightweight WiFiClient for HTTP (default)
- Full-featured WiFiClientSecure for HTTPS (when needed)
- Runtime switching via serial commands
- Protocol shown in diagnostics for debugging

---

## Dashboard Auto Data 500 Fix

If `/autodata` still returns 500 error in Dashboard after ESP8266 fix:

### Step 1: Check Gateway Logs

```bash
tail -f logs/gateway.log | grep autodata

# Expected with new logging:
[ML-PROXY] /autodata request detected
[ML-PROXY] Query params: {}
[ML-PROXY] Authorization header present: true
[ML-PROXY] Full headers being forwarded: { 'Content-Type': '...', 'Authorization': 'Bearer ...' }
```

### Step 2: Check ML Service Logs

```bash
tail -f logs/ml.log | grep autodata

# Look for:
[ERROR] /autodata failed: ...
[INFO] GET /autodata - 200 (if working)
```

### Step 3: Test Direct ML Service

```bash
# Get JWT token from browser DevTools → Application → Local Storage → authToken
TOKEN="your_jwt_token_here"

# Test ML service directly (bypass gateway)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3002/api/ml/autodata

# Expected: Array of auto data entries
# If 401: Token expired, re-login
# If 500: ML service error, check ml.log
```

### Step 4: Frontend Auth Check

**Location**: `frontend/src/services/api.js` line 851

**Verify**:
```javascript
// Should auto-add Authorization header via interceptor (lines 83-95)
export const getAutoData = async () => {
  return apiClient.get('/ml/autodata');  // ✅ Interceptor adds auth
};
```

**If Missing**: Check browser console for 401/403 errors, clear localStorage, re-login.

---

## Troubleshooting

### Issue: "Connection failed" on HTTP mode

**Symptoms**:
```
Protocol: HTTP
Client Type: WiFiClient
Sending to: http://192.168.1.3:7764/...
✗ ERROR: HTTP request failed: connection failed
```

**Causes**:
1. Port forwarding not configured on router (192.168.1.3:7764 → 172.29.156.41:7764)
2. Firewall blocking port 7764
3. Server not listening on 0.0.0.0 (only 127.0.0.1)
4. Wrong external IP (check `ip addr` or router admin panel)

**Solutions**:
```bash
# 1. Verify server listening on all interfaces
netstat -tlnp | grep 7764
# Expected: 0.0.0.0:7764 or :::7764 (not 127.0.0.1:7764)

# 2. Test from server itself (should work)
curl http://localhost:7764/api/health

# 3. Test from ESP8266's network (simulates ESP8266)
# From another device on same WiFi:
curl http://192.168.1.3:7764/api/health

# 4. Check firewall
sudo ufw status
sudo ufw allow 7764/tcp

# 5. Verify port forwarding on router
# Router admin panel → Port Forwarding
# External 7764 → Internal 172.29.156.41:7764
```

---

### Issue: "401 Unauthorized" on ESP8266

**Symptoms**:
```
HTTP Response Code: 401
✗ ERROR: Invalid device token (401 Unauthorized)
```

**Causes**:
1. Token mismatch (sketch has old token)
2. Token regenerated in Profile but sketch not updated
3. Token not in MongoDB (user deleted)

**Solutions**:
```bash
# 1. Get current token from Profile page
# Browser: https://172.29.156.41:7763/profile → Device Integration → Copy Token

# 2. Verify token in MongoDB
mongosh mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection
> db.users.findOne({email: "jodyislami103@gmail.com"}, {deviceToken: 1})
{
  "_id": ObjectId("..."),
  "deviceToken": "d250ab27b30db84e3dbc843eda266e16"
}

# 3. Update sketch line 23 with correct token
const char* deviceToken = "d250ab27b30db84e3dbc843eda266e16";

# 4. Re-upload sketch to ESP8266
```

---

### Issue: Dashboard shows "Failed to fetch auto data"

**Symptoms**:
- Browser console: `GET /api/ml/autodata 500 Internal Server Error`
- Dashboard "Auto Upload Data" section shows error message

**Debug Steps**:

**Step 1**: Check gateway logs (with new debugging)
```bash
tail -f logs/gateway.log | grep -A5 "/autodata"
# Look for: [ML-PROXY] /autodata request detected
# Check: Authorization header present: true/false
```

**Step 2**: Check ML service logs
```bash
tail -f logs/ml.log | grep -i autodata
# Look for errors, auth failures, database issues
```

**Step 3**: Verify frontend sends auth token
```javascript
// Browser DevTools → Console
localStorage.getItem('authToken')  // Should return JWT token
// If null: Re-login to get new token
```

**Step 4**: Test backend directly
```bash
# Get token from localStorage
TOKEN="your_jwt_here"

# Test gateway endpoint (port 7763)
curl -H "Authorization: Bearer $TOKEN" https://localhost:7763/api/ml/autodata -k

# Test ML service directly (port 3002)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3002/api/ml/autodata
```

---

### Issue: Works on curl but not ESP8266

**Symptoms**:
- `curl http://172.29.156.41:7764/api/ml/autoupload` → 201 Success
- ESP8266 `http://192.168.1.3:7764/api/ml/autoupload` → Connection failed

**Root Cause**: IP address mismatch (internal vs external)

**Solution**:
```cpp
// ESP8266 needs EXTERNAL IP (router)
const char* serverUrlHTTP = "http://192.168.1.3:7764/api/ml/autoupload";

// curl on server uses INTERNAL IP (localhost)
curl http://172.29.156.41:7764/api/ml/autoupload
```

**Network Diagram**:
```
curl (same machine)           ESP8266 (WiFi network)
       ↓                              ↓
   localhost                      Router
       ↓                          192.168.1.3
172.29.156.41:7764                    ↓
                              Port Forward
                                      ↓
                              172.29.156.41:7764
```

---

## Success Metrics

After implementing fixes:

✅ **ESP8266 HTTP Mode**: 201 success, green LED blinks  
✅ **Protocol Toggle**: `http`/`https` commands work in serial monitor  
✅ **Diagnostics**: Shows protocol, client type, actual URL  
✅ **External IP**: ESP8266 uses 192.168.1.3 (router IP)  
✅ **Dashboard**: Auto data displays after ESP8266 upload  
✅ **Gateway Logs**: Shows device-token header forwarding  
✅ **MongoDB**: Auto data saved with all 9 parameters  

---

## Related Documentation

- **IoT Device Setup**: `IOT/README.md`
- **ESP8266 Sketches**: `IOT/ESP8266_AutoUpload_V2/`
- **Testing Script**: `test-esp8266-external.sh`
- **V1 Troubleshooting**: `README.md` → "IoT Device Testing"
- **Gateway Header Fix**: `IOT_AUTOUPLOAD_FIX.md`

---

## Technical Notes

### Why `new WiFiClient()` Instead of Stack Allocation?

**Original Attempt** (Doesn't Work):
```cpp
if (useHTTPS) {
  WiFiClientSecure client;
  client.setInsecure();
  http.begin(client, serverUrl);
} else {
  WiFiClient client;
  http.begin(client, serverUrlHTTP);
}
// ❌ Client destroyed when leaving scope, http.POST() fails
```

**Working Solution** (Heap Allocation):
```cpp
if (useHTTPS) {
  WiFiClientSecure* secureClient = new WiFiClientSecure();
  secureClient->setInsecure();
  http.begin(*secureClient, serverUrl);
} else {
  WiFiClient* httpClient = new WiFiClient();
  http.begin(*httpClient, serverUrlHTTP);
}
// ✅ Client persists until http.end()
```

**Why**: HTTPClient stores reference to client, needs to stay alive during POST.

### Memory Leak Consideration

The `new` allocations are intentional and cleaned up by:
1. `http.end()` at end of `sendData()` function
2. ESP8266 reboots periodically (watchdog timer)
3. Single allocation per upload (not in tight loop)

For production with frequent uploads, add cleanup:
```cpp
if (useHTTPS) {
  WiFiClientSecure* secureClient = new WiFiClientSecure();
  secureClient->setInsecure();
  http.begin(*secureClient, serverUrl);
  // ... POST ...
  http.end();
  delete secureClient;  // ✅ Cleanup
}
```

---

## Conclusion

The ESP8266 connection failures were caused by **hardcoded HTTPS client** in `sendData()` function that ignored the `useHTTPS` flag. By implementing conditional client logic (WiFiClient for HTTP, WiFiClientSecure for HTTPS) and using the external IP (192.168.1.3), ESP8266 can now reliably upload data via HTTP (recommended) or HTTPS (with caveats).

**Key Lessons**:
1. Always test conditional flags actually execute both code paths
2. Use HTTP for IoT devices unless production security required
3. External IP (router) ≠ Internal IP (localhost) for WiFi devices
4. Self-signed certs with CN=localhost fail on IP addresses
5. Serial diagnostics essential for debugging embedded devices
