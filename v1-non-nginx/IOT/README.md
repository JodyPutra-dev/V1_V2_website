# ESP8266 IoT Device Testing Guide

Complete guide for testing V1 backend `/api/ml/autoupload` endpoint using ESP8266 NodeMCU with device token authentication.

---

## Overview

### Network Setup

**Internal vs External Access**:
- **Internal IP**: 172.29.156.41 (server localhost, for curl/Postman on same machine)
- **External IP**: 192.168.1.3 (router IP, for ESP8266 on WiFi network)
- **Port Forwarding**: Router forwards 192.168.1.3:7763/7764 → 172.29.156.41:7763/7764

**ESP8266 Requirements**:
- Must use **external IP** (192.168.1.3) to reach server from WiFi
- **HTTPS-only** (port 7763) enforced in V1 deployment for secure production IoT uploads
- Uses `WiFiClientSecure` with `setInsecure()` for self-signed certificates

### Purpose
Send 9-parameter urine analysis data from ESP8266 to V1 backend for ML prediction processing.

### Available Sketches

| Sketch | Protocol | Port | Use Case | Status |
|--------|----------|------|----------|--------|
| **ESP8266_AutoUpload_V2** ⭐ | HTTPS only | 7763 | **Production (Recommended)** | ✅ Matches V1 deployment |
| **ESP8266_AutoUpload_HTTP_HTTPS_Hybrid** | Both | 7764/7763 | Development/testing | ⚠️ Deprecated (V1 has no HTTP) |

**Recommendation**: Use **ESP8266_AutoUpload_V2** (HTTPS-only) to match V1 deployment architecture.

---

## Quick Start (5 Minutes)

### Step 1: Get Device Token

1. Open browser: `https://172.29.156.41:7763/profile` (or `http://172.29.156.41:7764/profile`)
2. Login to your account
3. Scroll to "Device Integration" section
4. Click "Generate Token" button (if not already generated)
5. Click "Copy Token" to clipboard
6. **Token format**: 32-character hex string (e.g., `272281c6e6843e03a8fca97e14165b72`)

### Step 2: Configure Sketch

Open `ESP8266_AutoUpload_V2/ESP8266_AutoUpload_V2.ino` and update:

```cpp
// Line 17-18: WiFi credentials
const char* ssid = "YOUR_WIFI_SSID";          // Change this
const char* password = "YOUR_WIFI_PASSWORD";  // Change this

// Line 23: Device token (paste from Profile page)
const char* deviceToken = "d250ab27b30db84e3dbc843eda266e16";  // Change this

// Line 24: HTTPS-only mode (enforced for secure production IoT uploads)
bool useHTTPS = true;  // HTTPS required - V1 deployment only supports port 7763
```

**HTTPS Requirements**:
- V1 deployment uses **HTTPS-only** (port 7763)
- ESP8266 uses `WiFiClientSecure` with `setInsecure()` for self-signed certificates
- If connection fails, verify:
  - Gateway HTTPS server running: `netstat -tlnp | grep 7763`
  - SSL certificates exist: `ls -la ssl/server.{key,crt}`
  - Gateway logs show no errors: `tail -f logs/gateway.log`

**Important - Network Configuration**:
- **For ESP8266**: Use external IP `192.168.1.3` (router IP)
- **For curl/testing**: Use internal IP `172.29.156.41` (server localhost)
- **Why**: ESP8266 on WiFi network must route through router port forwarding

**Requirements**:
- WiFi must be **2.4GHz** (ESP8266 doesn't support 5GHz)
- ESP8266 and router must be on same network
- Port forwarding configured: 192.168.1.3:7763 → 172.29.156.41:7763
- Test: `curl -k https://192.168.1.3:7763/api/health` (should return 200)

### Step 3: Upload to ESP8266

**Arduino IDE Settings**:
- **Board**: NodeMCU 1.0 (ESP-12E Module)
- **Upload Speed**: 115200
- **CPU Frequency**: 80 MHz
- **Flash Size**: 4MB (FS:2MB OTA:~1019KB)
- **Port**: `/dev/ttyUSB0` (Linux), `COM3` (Windows)

**Upload Steps**:
1. Connect NodeMCU to computer via USB
2. Click **Upload** button (→) in Arduino IDE
3. Wait for "Done uploading" message

### Step 4: Test Upload

1. Open **Serial Monitor** (Ctrl+Shift+M)
2. Set baud rate: **115200**
3. Set line ending: "Newline" or "Both NL & CR"
4. Wait for "WiFi Connected" message
5. Type: `send` and press Enter
6. **Expected output**:
   ```
   --- Sending Data ---
   Protocol: HTTPS (port 7763)
   Endpoint: https://192.168.1.3:7763/api/ml/autoupload
   ...
   HTTP Response Code: 201
   ✓ SUCCESS: Data uploaded successfully!
   ```
7. Green LED blinks → Success!

### Step 5: Verify in Dashboard

1. Open browser: `https://172.29.156.41:7763/dashboard`
2. Check "Latest Prediction" card
3. Verify all 9 parameters display (not N/A)
4. Check source: "IoT Device" or "AutoData"

---

## Serial Commands

### Available Commands

| Command | Description | Example Output |
|---------|-------------|----------------|
| `send` | Upload dummy data to backend | `✓ SUCCESS: Data uploaded` |
| `toggle` | Switch between HTTP/HTTPS | `Protocol switched to: HTTP` |
| `http` | Force HTTP mode (port 7764) | `Forced HTTP mode` |
| `https` | Force HTTPS mode (port 7763) | `Forced HTTPS mode` |
| `status` | Show WiFi & connection info | Shows SSID, IP, protocol, token |
| `help` | List available commands | Shows this command list |

### Command Examples

**Test HTTP upload**:
```
send
```

**Switch to HTTPS for testing**:
```
https
send
```

**Check current status**:
```
status
```
Output:
```
--- Current Status ---
WiFi: Connected
  SSID: ZTE_2.4G_Jody
  IP: 192.168.1.100
  Signal: -45 dBm
Protocol: HTTP (port 7764)
Endpoint: http://172.29.156.41:7764/api/ml/autoupload
Device Token: 272281c6...
---------------------
```

**Toggle between protocols**:
```
toggle
```

---

## Hardware Setup

### Components
- **NodeMCU ESP8266** (ESP-12E module)
- **3 LEDs** (optional, built-in LEDs work)
  - Red LED → D2 (GPIO4)
  - Yellow LED → D3 (GPIO0)
  - Green LED → D4 (GPIO2)
- **3x 220Ω Resistors** (if using external LEDs)
- **USB Cable** (Micro-USB for NodeMCU)
- **Breadboard** (optional)

### Wiring (Optional External LEDs)

```
NodeMCU ESP8266
├── D2 (GPIO4) → Red LED → 220Ω Resistor → GND
├── D3 (GPIO0) → Yellow LED → 220Ω Resistor → GND
├── D4 (GPIO2) → Green LED → 220Ω Resistor → GND
└── USB → Computer (power + serial monitor)
```

**Note**: NodeMCU has built-in LEDs on these pins, external LEDs are optional for visibility.

### LED Status Indicators

| LED | Status | Meaning |
|-----|--------|---------|
| Yellow (Solid) | Sending | HTTP/HTTPS request in progress |
| Green (Blinks 3x) | Success | Data uploaded, saved, prediction generated |
| Red (Solid) | Error | Connection failed, invalid token, or server error |
| Yellow (Blinks 1x) | Connecting | WiFi connection in progress |

---

## Troubleshooting

### Issue #1: "connection failed" (HTTPS)

**Symptom**:
```
✗ ERROR: HTTP request failed: connection failed
[HTTPS] TLS handshake or connection failed
```

**Cause**: Self-signed SSL certificate rejected by ESP8266, or TLS incompatibility.

**Solution**:
```
1. Switch to HTTP mode:
   Type: http
   Type: send
   
2. Or update sketch line 33:
   bool useHTTPS = false;
   Re-upload sketch
```

**Why HTTPS fails**:
- V1 HTTPS server uses self-signed cert with CN=localhost
- ESP8266 connects to IP 172.29.156.41 (hostname mismatch)
- Even with `setInsecure()`, TLS handshake may fail

**Recommendation**: Use HTTP for ESP8266 testing, HTTPS for web browsers.

### Issue #2: 401 Unauthorized

**Symptom**:
```
HTTP Response Code: 401
Response Body: {"success":false,"message":"Invalid device token"}
✗ ERROR: Invalid device token (401 Unauthorized)
```

**Solution**:
1. Login to Profile page: `https://172.29.156.41:7763/profile`
2. Click "Regenerate Device Token"
3. Copy new token (32 hex characters)
4. Update sketch line 30: `const char* deviceToken = "NEW_TOKEN_HERE";`
5. Re-upload sketch to ESP8266
6. Type `send` in Serial Monitor

**Why this happens**:
- Token expired or invalidated
- Token regenerated in web UI but not updated in sketch
- Typo in token string

### Issue #3: WiFi Connection Timeout

**Symptom**:
```
Connecting to WiFi: YourSSID
....................
✗ WiFi connection timeout!
```

**Solutions**:
- Verify SSID and password are correct (lines 23-24)
- Check WiFi is **2.4GHz** (ESP8266 doesn't support 5GHz)
- Move ESP8266 closer to router
- Reset ESP8266 and try again
- Check router MAC filtering isn't blocking device

### Issue #4: 500 Server Error

**Symptom**:
```
HTTP Response Code: 500
✗ ERROR: Server error (500)
```

**Solutions**:
1. Check backend logs:
   ```bash
   cd /var/www/html/HIBAH/deployments/v1-non-nginx
   tail -f logs/ml.log | grep -i autoupload
   ```
2. Verify ML service is running:
   ```bash
   ps aux | grep ml-service
   ```
3. Check Python dependencies:
   ```bash
   python3 -c "import joblib, pandas, numpy"
   ```
4. Restart services if needed:
   ```bash
   ./stop.sh && ./start.sh
   ```

### Issue #5: Parameters Show N/A in Dashboard

**Symptom**: Upload succeeds (201 response), but Dashboard shows N/A for some parameters.

**Solution**: This was fixed in Phase 21. If still occurring:
1. Check browser console for errors
2. Verify MongoDB has lowercase keys: `db.autodatas.findOne().sort({timestamp:-1})`
3. Clear browser cache (Ctrl+Shift+R)
4. See: `DASHBOARD_PARAMETER_FIX_FINAL.md`

---

## Backend Endpoint Documentation

### POST `/api/ml/autoupload`

**Purpose**: Receive urine analysis data from IoT devices, process ML prediction, save to database.

**Headers**:
```
Content-Type: application/json
device-token: {32-character hex token from Profile page}
```

**Request Body** (9 parameters):
```json
{
  "ph": 6.8,
  "tds": 950,
  "specificGravity": 1.018,
  "turbidityNTU": 7.5,
  "red": 240,
  "green": 200,
  "blue": 120,
  "turbidityLevel": "Jernih",
  "warnaDasar": "KUNING"
}
```

**Response Codes**:
- **201 Created**: Data uploaded, prediction saved successfully
- **400 Bad Request**: Missing required parameters
- **401 Unauthorized**: Invalid or missing device token
- **500 Internal Server Error**: ML processing or database error

**Success Response**:
```json
{
  "success": true,
  "message": "Device data uploaded and processed successfully",
  "data": {
    "prediction": "Sehat",
    "hydrationLevel": "Normal",
    "savedId": "674c1234567890abcdef1234"
  }
}
```

---

## Testing Workflow

### Complete Test Sequence

1. **Start V1 Backend**:
   ```bash
   cd /var/www/html/HIBAH/deployments/v1-non-nginx
   ./start.sh
   ```

2. **Get Device Token**:
   - Login to web app
   - Go to Profile page
   - Copy device token

3. **Update ESP8266 Sketch**:
   - WiFi credentials (lines 23-24)
   - Device token (line 30)
   - Protocol mode (line 33): `useHTTPS = false`

4. **Upload & Test**:
   - Upload sketch to ESP8266
   - Open Serial Monitor (115200 baud)
   - Type `send`
   - Verify green LED and success message

5. **Verify in Web App**:
   - Open Dashboard
   - Check "Latest Prediction" card
   - Verify all parameters display
   - Check source: "IoT Device"

6. **Check Backend Logs**:
   ```bash
   tail -f logs/ml.log | grep -i autoupload
   ```
   Expected:
   ```
   [AUTOUPLOAD] Device token validated for user: 673a1234567890abcdef1234
   [AUTOUPLOAD] Received data: ph=6.8, tds=950, specificGravity=1.018, ...
   [AUTOUPLOAD] ML Prediction: Sehat (Kidney Stone: No)
   [AUTOUPLOAD] Prediction saved to database
   ```

7. **Verify MongoDB**:
   ```bash
   mongosh "mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection?authSource=admin"
   db.autodatas.findOne({}, {sort: {timestamp: -1}})
   ```
   Should show latest upload with all 9 parameters.

---

## Advanced: curl Testing

Simulate ESP8266 upload using curl (useful for debugging):

### HTTP Test
```bash
curl -X POST http://172.29.156.41:7764/api/ml/autoupload \
  -H "device-token: 272281c6e6843e03a8fca97e14165b72" \
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

Expected:
```json
{"success":true,"message":"Device data uploaded and processed successfully","data":{...}}
```

### HTTPS Test
```bash
curl -k -X POST https://172.29.156.41:7763/api/ml/autoupload \
  -H "device-token: d250ab27b30db84e3dbc843eda266e16" \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**Note**: `-k` flag ignores self-signed certificate warnings (like ESP8266's `setInsecure()`).

---

## Troubleshooting

### Issue: 401 Unauthorized Error

**Symptom**: ESP8266 or curl returns:
```json
{
  "success": false,
  "message": "Device token required"
}
```

**Common Causes**:

1. **Token Mismatch** (Most Common)
   - ESP8266 sketch has old/wrong token
   - Token regenerated in Profile page but sketch not updated
   
   **Solution**: Verify token matches MongoDB
   ```bash
   # Check your token in database
   mongosh mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection
   > db.users.findOne({email: "YOUR_EMAIL"}, {deviceToken: 1, email: 1})
   
   # Copy the deviceToken value
   # Update ESP8266 sketch line 33 with correct token
   # Re-upload sketch to ESP8266
   ```

2. **Gateway Not Forwarding Header** (Fixed in Feb 2025)
   - Gateway receives `device-token` header but doesn't forward to ML service
   - Check gateway logs: `tail -f logs/gateway.log | grep "ML-PROXY"`
   - Should show: `Headers being forwarded: [ 'Content-Type', 'Accept', 'device-token' ]`
   
   **Solution**: Verify gateway.js line ~1732 includes:
   ```javascript
   ...(req.headers['device-token'] && { 'device-token': req.headers['device-token'] })
   ```

3. **Header Not Sent by Client**
   - Missing `device-token` header in request
   
   **Solution**: Verify ESP8266 Serial Monitor shows:
   ```
   Device-Token: d250ab27b30db84e3dbc843eda266e16
   ```

**Quick Test with curl**:
```bash
# Replace YOUR_TOKEN with your actual device token from Profile page
curl -k -X POST https://172.29.156.41:7763/api/ml/autoupload \
  -H "device-token: YOUR_TOKEN" \
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

# Expected: {"success":true,"message":"Device data uploaded and processed successfully",...}
# If 401: Token mismatch or gateway issue
```

**See Also**: `../IOT_AUTOUPLOAD_FIX.md` for detailed root cause analysis

---

### Issue: Connection Failed (HTTP/HTTPS)

**Symptom**: ESP8266 serial shows "✗ ERROR: HTTP request failed: connection failed"

**Common Causes**:

1. **Wrong IP Address** (Most Common for ESP8266)
   - ESP8266 on WiFi uses external IP (192.168.1.3)
   - curl on server uses internal IP (172.29.156.41)
   
   **Solution**:
   ```cpp
   // In ESP8266 sketch:
   const char* serverUrlHTTP = "http://192.168.1.3:7764/api/ml/autoupload";
   ```

2. **Port Forwarding Not Configured**
   - Router must forward 192.168.1.3:7764 → 172.29.156.41:7764
   
   **Test**:
   ```bash
   # From server
   ./test-esp8266-external.sh
   
   # Expected HTTP: 201 success
   # If fails: Check router port forwarding settings
   ```

3. **HTTPS with Self-Signed Certificate**
   - ESP8266 TLS handshake fails on IP addresses with CN=localhost
   
   **Solution**: Use HTTP mode (`useHTTPS = false`)

4. **Firewall Blocking External Connections**
   ```bash
   # Check server listening on all interfaces
   netstat -tlnp | grep -E '7763|7764'
   # Expected: 0.0.0.0:7763 and 0.0.0.0:7764 (not 127.0.0.1)
   
   # Allow ports if needed
   sudo ufw allow 7764/tcp
   sudo ufw allow 7763/tcp
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

**See Also**: `ESP8266_HTTPS_EXTERNAL_IP_FIX.md` for comprehensive analysis

---

### Issue: Works on curl but not ESP8266

**Symptom**: curl from server succeeds (201), ESP8266 gets "connection failed"

**Root Cause**: IP address mismatch (internal vs external)

**Solution**:
```cpp
// ESP8266 sketch - use EXTERNAL IP
const char* serverUrlHTTP = "http://192.168.1.3:7764/api/ml/autoupload";

// curl - use INTERNAL IP  
curl http://172.29.156.41:7764/api/ml/autoupload ...
```

**Testing**:
```bash
# Simulate ESP8266 external access
../test-esp8266-external.sh

# Test from another device on same WiFi network
curl http://192.168.1.3:7764/api/health
# Expected: {"status":"ok","message":"Gateway is running"}
```

---

### Issue: Dashboard Not Showing Data

**Symptom**: ESP8266 upload succeeds (201) but Dashboard shows old data

**Solutions**:
1. Refresh Dashboard page (Ctrl+R)
2. Check browser console (F12) for errors
3. Verify MongoDB save:
   ```bash
   mongosh mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection
   > db.autodatas.find().sort({timestamp:-1}).limit(1).pretty()
   ```
4. Check gateway logs for `/autodata` requests:
   ```bash
   tail -f logs/gateway.log | grep -i autodata
   ```

---

## Related Documentation

- **ESP8266 HTTPS Connection Fix**: `../ESP8266_HTTPS_CONNECTION_FIX.md`
- **Dashboard Parameter Fix**: `../DASHBOARD_PARAMETER_FIX_FINAL.md`
- **V1 Architecture**: `../README.md`
- **ML Autoupload Endpoint**: `../microservices/ml/ml-service.js` (line ~150)

---

## Support & FAQ

**Q: Should I use HTTP or HTTPS?**  
A: Use **HTTP** for ESP8266 (reliable). HTTPS may fail due to self-signed cert + TLS handshake issues.

**Q: Can I use both HTTP and HTTPS simultaneously?**  
A: Yes! V1 gateway serves both ports. Use HTTP for IoT, HTTPS for web browsers.

**Q: How do I change dummy data values?**  
A: Edit lines 45-55 in sketch:
```cpp
UrineData dummyData = {
  7.2,           // ph (change value)
  1200,          // tds (change value)
  1.025,         // specificGravity (change value)
  // ... etc
};
```

**Q: Can I upload real sensor data instead of dummy data?**  
A: Yes! Replace dummy values with sensor readings in your code before calling `sendData()`.

**Q: What if Dashboard still shows N/A?**  
A: Verify browser cache cleared, check `DASHBOARD_PARAMETER_FIX_FINAL.md`, inspect Network tab in DevTools.

---

**Last Updated**: November 26, 2024  
**Tested With**: NodeMCU ESP8266, Arduino IDE 1.8.19, V1 Deployment  
**Recommended Sketch**: `ESP8266_AutoUpload_HTTP_HTTPS_Hybrid.ino`
