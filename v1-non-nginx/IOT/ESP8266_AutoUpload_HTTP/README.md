# ESP8266 Auto Upload HTTP - Setup Guide

Complete guide for testing V1 backend `/api/ml/autoupload` endpoint using ESP8266 NodeMCU over HTTP (no SSL).

## Overview

- **Purpose**: Send dummy urine analysis data (9 parameters) from ESP8266 to V1 backend
- **Protocol**: HTTP (V1 deployment has no NGINX/SSL)
- **Endpoint**: `http://172.29.156.41:7764/api/ml/autoupload`
- **Trigger**: Serial monitor command ("send")
- **Token**: Hardcoded device token from Profile page
- **Parameters**: ph, tds, specificGravity, turbidityNTU, red, green, blue, turbidityLevel, warnaDasar

---

## Hardware Requirements

### Components
- **NodeMCU ESP8266** (ESP-12E module)
- **LED** (optional, built-in LED on GPIO2/D4 works)
- **Resistor** 220Ω (if using external LED)
- **USB Cable** (Micro-USB for NodeMCU)
- **Breadboard** (optional)

### Wiring
```
NodeMCU ESP8266
├── Built-in LED: GPIO2 (D4) - Used for status
├── External LED (optional):
│   ├── Anode → GPIO2 (D4)
│   ├── Resistor (220Ω) → Cathode
│   └── Cathode → GND
└── USB → Computer (for power + serial monitor)
```

**LED Status Indicators:**
- **Slow Blink (1x)**: Starting operation
- **Solid ON**: Sending HTTP request
- **Fast Blink (10x)**: Error occurred
- **Multiple Blinks (3-5x)**: Success

---

## Software Requirements

### Arduino IDE Setup

1. **Install Arduino IDE** (version 1.8.13 or newer)
   - Download: https://www.arduino.cc/en/software

2. **Add ESP8266 Board Manager**
   - Open Arduino IDE → File → Preferences
   - Add to "Additional Board Manager URLs":
     ```
     http://arduino.esp8266.com/stable/package_esp8266com_index.json
     ```
   - Tools → Board → Boards Manager
   - Search "ESP8266" → Install "ESP8266 by ESP8266 Community"

3. **Install Required Libraries**
   - Tools → Manage Libraries (or Ctrl+Shift+I)
   - Install:
     - **ArduinoJson** (v6.21.0 or newer)
     - ESP8266WiFi (included with board)
     - ESP8266HTTPClient (included with board)

---

## Configuration

### 1. Update WiFi Credentials

Edit `ESP8266_AutoUpload_HTTP.ino` lines 18-19:

```cpp
const char* ssid = "YOUR_WIFI_SSID";          // Change this
const char* password = "YOUR_WIFI_PASSWORD";  // Change this
```

**Requirements:**
- WiFi must be **2.4GHz** (ESP8266 doesn't support 5GHz)
- ESP8266 and server must be on same network or have routing configured
- Test server reachability: `ping 172.29.156.41` from WiFi network

### 2. Verify Server URL

Line 22 (should be correct for V1):
```cpp
const char* serverUrl = "http://172.29.156.41:7764/api/ml/autoupload";
```

**Note:** V1 uses HTTP (port 7764), V2 uses HTTPS (port 7763)

### 3. Update Device Token

Line 23:
```cpp
const char* deviceToken = "11899e4faa744b32781816963d3a791f";
```

**How to Get Token:**
1. Open browser: `http://172.29.156.41:7764`
2. Login to system
3. Navigate to Profile page
4. Scroll to "Device Integration" section
5. Click "Generate Token" (if not already generated)
6. Copy 32-character hex token
7. Paste into sketch line 23

---

## Upload Instructions

### 1. Select Board Settings

- **Board**: "NodeMCU 1.0 (ESP-12E Module)"
- **Upload Speed**: 115200
- **CPU Frequency**: 80 MHz
- **Flash Size**: "4MB (FS:2MB OTA:~1019KB)"
- **Port**: 
  - Linux: `/dev/ttyUSB0` or `/dev/ttyACM0`
  - Windows: `COM3`, `COM4`, etc.
  - Mac: `/dev/cu.usbserial-XXXX`

### 2. Upload Sketch

1. Connect NodeMCU to computer via USB
2. Click **Upload** button (→) in Arduino IDE
3. Wait for "Done uploading" message
4. If upload fails:
   - Check port selection
   - Press FLASH button on NodeMCU during upload
   - Try different USB cable (data cable, not just charging)
   - Reduce upload speed to 57600

### 3. Open Serial Monitor

- Tools → Serial Monitor (or Ctrl+Shift+M)
- Set baud rate: **115200**
- Set line ending: "Newline" or "Both NL & CR"

---

## Usage

### Serial Monitor Commands

After uploading, open Serial Monitor (115200 baud). You'll see:

```
=== ESP8266 Auto Upload HTTP ===
V1 HTTP Testing (No SSL)
9-Parameter Urine Analysis System
================================

Connecting to WiFi: YourSSID
......
✓ WiFi Connected!
IP Address: 192.168.1.100

=== Ready ===
Commands:
  send  - Upload dummy data to backend
  wifi  - Show WiFi status
  data  - Show dummy data values
  help  - Show this help
```

**Available Commands:**

1. **`send`** - Upload dummy data to backend
   ```
   send
   ```
   Output:
   ```
   --- Sending Data ---
   Dummy Urine Parameters:
     pH: 6.80
     TDS: 950 ppm
     Specific Gravity: 1.018
     Turbidity NTU: 7.50
     RGB: (240, 210, 120)
     Turbidity Level: Jernih
     Warna Dasar: KUNING
   
   JSON Payload: {"ph":6.8,"tds":950,"specificGravity":1.018,...}
   Sending to: http://172.29.156.41:7764/api/ml/autoupload
   HTTP Response Code: 200
   Response Body: {"success":true,"message":"Prediction saved",...}
   ✓ SUCCESS: Data uploaded successfully!
   --- Done ---
   ```

2. **`wifi`** - Show WiFi connection status
   ```
   wifi
   ```
   Output:
   ```
   --- WiFi Status ---
   Status: Connected
   SSID: YourSSID
   IP: 192.168.1.100
   Signal: -45 dBm
   -------------------
   ```

3. **`data`** - Display dummy data values
   ```
   data
   ```

4. **`help`** - Show available commands
   ```
   help
   ```

---

## Expected Output

### Successful Upload (HTTP 200)

```
--- Sending Data ---
Dummy Urine Parameters:
  pH: 6.80
  TDS: 950 ppm
  Specific Gravity: 1.018
  Turbidity NTU: 7.50
  RGB: (240, 210, 120)
  Turbidity Level: Jernih
  Warna Dasar: KUNING

JSON Payload: {"ph":6.8,"tds":950,"specificGravity":1.018,"turbidityNTU":7.5,"red":240,"green":210,"blue":120,"turbidityLevel":"Jernih","warnaDasar":"KUNING"}
Sending to: http://172.29.156.41:7764/api/ml/autoupload
HTTP Response Code: 200
Response Body: {"success":true,"message":"Prediction saved","data":{"prediction":"Sehat","confidence":92.5,...}}
✓ SUCCESS: Data uploaded successfully!
--- Done ---
```

### Error Responses

**HTTP 401 - Invalid Token:**
```
HTTP Response Code: 401
Response Body: {"success":false,"message":"Invalid device token"}
✗ ERROR: Invalid device token (401 Unauthorized)
Please regenerate token in Profile page and update sketch
```

**HTTP 500 - Server Error:**
```
HTTP Response Code: 500
Response Body: {"success":false,"message":"Internal server error"}
✗ ERROR: Server error (500)
Check backend logs: tail -f logs/ml.log
```

**Connection Failed:**
```
✗ ERROR: HTTP request failed: connection refused
```

---

## Backend Verification

### Check Backend Logs

Watch ML service logs for autoupload requests:

```bash
cd /var/www/html/HIBAH/deployments/v1-non-nginx
tail -f logs/ml.log | grep -i autoupload
```

Expected output:
```
[AUTOUPLOAD] Device token validated for user: 673a1234567890abcdef1234
[AUTOUPLOAD] Received data: ph=6.8, tds=950, specificGravity=1.018, turbidityNTU=7.5, ...
[AUTOUPLOAD] ML Prediction: Sehat (Kidney Stone: No)
[AUTOUPLOAD] Prediction saved to database
```

### Check MongoDB

Verify prediction was saved:

```bash
mongosh "mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection" \
  --authenticationDatabase admin \
  --eval "db.predictions.find({source: 'AutoData'}).sort({createdAt: -1}).limit(1).pretty()"
```

Expected output:
```javascript
{
  _id: ObjectId("..."),
  user: ObjectId("673a1234567890abcdef1234"),
  parameters: {
    ph: 6.8,
    tds: 950,
    specificgravity: 1.018,  // Note: MongoDB may use lowercase
    turbidityntu: 7.5,
    red: 240,
    green: 210,
    blue: 120,
    turbiditylevel: "Jernih",
    warnadasar: "KUNING"
  },
  prediction: "Sehat",
  source: "AutoData",
  createdAt: ISODate("2025-11-25T...")
}
```

### Check Dashboard

1. Open browser: `http://172.29.156.41:7764/dashboard`
2. Navigate to Dashboard page
3. Check "Latest Prediction" section
4. Verify all 9 parameters display correctly
5. Verify source shows "IoT Device" or "AutoData"

---

## Troubleshooting

### WiFi Connection Failed

**Symptom:**
```
Connecting to WiFi: YourSSID
....................
✗ WiFi connection timeout!
```

**Solutions:**
- Verify SSID and password are correct
- Check WiFi is 2.4GHz (not 5GHz)
- Move ESP8266 closer to router
- Reset ESP8266 and retry
- Check router MAC filtering isn't blocking device

### HTTP 401 Unauthorized

**Symptom:**
```
HTTP Response Code: 401
✗ ERROR: Invalid device token (401 Unauthorized)
```

**Solutions:**
1. Regenerate token in Profile page
2. Copy new token (32 hex characters)
3. Update sketch line 23
4. Re-upload sketch to ESP8266
5. Verify token in browser DevTools Network tab

### HTTP 500 Server Error

**Symptom:**
```
HTTP Response Code: 500
✗ ERROR: Server error (500)
```

**Solutions:**
1. Check backend logs: `tail -f logs/ml.log`
2. Verify ML service is running: `ps aux | grep ml-service`
3. Check Python dependencies: `python3 -c "import joblib, pandas"`
4. Restart services: `./stop.sh && ./start.sh`

### Connection Refused

**Symptom:**
```
✗ ERROR: HTTP request failed: connection refused
```

**Solutions:**
- Verify server is running: `curl http://172.29.156.41:7764/api/health`
- Check ESP8266 and server on same network: `ping 172.29.156.41` from WiFi
- Verify firewall not blocking port 7764
- Check .env.v1 has `GATEWAY_PORT=7764`
- Restart gateway: `./stop.sh && ./start.sh`

### Upload Failed

**Symptom:**
```
error: espcomm_open failed
error: espcomm_upload_mem failed
```

**Solutions:**
- Check correct port selected (Tools → Port)
- Try different USB cable (must be data cable)
- Press FLASH button on NodeMCU during upload
- Reduce upload speed to 57600
- Install CH340 driver (for clone NodeMCU boards)

---

## Modifying Dummy Data

To change test values, edit lines 43-53 in sketch:

```cpp
UrineData dummyData = {
  7.2,           // ph (change value)
  1200,          // tds (change value)
  1.025,         // specificGravity (change value)
  10.0,          // turbidityNTU (change value)
  255,           // red (0-255)
  180,           // green (0-255)
  90,            // blue (0-255)
  "Keruh",       // turbidityLevel ("Jernih" or "Keruh")
  "MERAH"        // warnaDasar ("KUNING", "MERAH", "HIJAU", etc.)
};
```

After changes, re-upload sketch and test with `send` command.

---

## V1 vs V2 Comparison

| Feature | V1 (HTTP) | V2 (HTTPS) |
|---------|-----------|------------|
| Protocol | HTTP | HTTPS (SSL) |
| Port | 7764 | 7763 |
| WiFiClient | `WiFiClient` | `WiFiClientSecure` |
| SSL Certificate | Not required | Required (`client.setInsecure()` or fingerprint) |
| Endpoint | `http://172.29.156.41:7764/api/ml/autoupload` | `https://172.29.156.41:7763/api/ml/autoupload` |
| Sketch | `ESP8266_AutoUpload_HTTP.ino` | `ESP8266_AutoUpload_V2.ino` |

**Note:** This sketch is for V1 testing only. For V2 HTTPS, use `ESP8266_AutoUpload_V2.ino` in parent directory.

---

## Related Documentation

- **Backend API**: `/deployments/v1-non-nginx/api-documentation.md`
- **V1 Architecture**: `/deployments/v1-non-nginx/README.md`
- **HTTPS Fix**: `/deployments/v1-non-nginx/HTTPS_HTTP_FIX.md`
- **ML Service**: `/deployments/v1-non-nginx/microservices/ml/ml-service.js`

---

## Support

**Issues:**
- WiFi not connecting → Check SSID/password, use 2.4GHz network
- HTTP 401 error → Regenerate token in Profile, update sketch
- HTTP 500 error → Check backend logs: `tail -f logs/ml.log`
- Dashboard shows N/A → Check MongoDB keys match, see `HTTPS_HTTP_FIX.md`

**Testing Commands:**
```bash
# Test backend health
curl http://172.29.156.41:7764/api/health

# Test autoupload endpoint (with token header)
curl -X POST http://172.29.156.41:7764/api/ml/autoupload \
  -H "Content-Type: application/json" \
  -H "device-token: 11899e4faa744b32781816963d3a791f" \
  -d '{"ph":6.8,"tds":950,"specificGravity":1.018,"turbidityNTU":7.5,"red":240,"green":210,"blue":120,"turbidityLevel":"Jernih","warnaDasar":"KUNING"}'

# Watch logs
tail -f logs/ml.log | grep -i autoupload

# Check MongoDB
mongosh "mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection" \
  --authenticationDatabase admin \
  --eval "db.predictions.find({source: 'AutoData'}).count()"
```
