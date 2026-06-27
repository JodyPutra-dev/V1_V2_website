# ESP8266 Auto Upload V2 - Setup Guide

## Overview

This Arduino sketch enables ESP8266 (NodeMCU) to send urine analysis data with 9 parameters to the backend `/api/ml/autoupload` endpoint. Data is sent on-demand via serial monitor "send" command.

---

## Hardware Requirements

### Components
- **NodeMCU ESP8266** (or compatible ESP8266 board)
- **3 LEDs** with appropriate resistors (220Ω-330Ω)
  - Red LED → GPIO12 (D6) - Error indicator
  - Yellow LED → GPIO13 (D7) - Sending indicator
  - Green LED → GPIO14 (D5) - Success indicator
- **Breadboard** and jumper wires
- **USB cable** for programming

### Optional
- LCD I2C display (can be added later, commented out in this version)

---

## Software Requirements

### Arduino IDE Setup

1. **Install Arduino IDE** (version 1.8.19 or later)
   - Download from: https://www.arduino.cc/en/software

2. **Install ESP8266 Board Support**
   - Open Arduino IDE → File → Preferences
   - Add to "Additional Board Manager URLs":
     ```
     http://arduino.esp8266.com/stable/package_esp8266com_index.json
     ```
   - Go to Tools → Board → Boards Manager
   - Search for "esp8266" and install "ESP8266 by ESP8266 Community"

3. **Install Required Libraries** (Tools → Manage Libraries)
   - **ESP8266WiFi** (included with ESP8266 board package)
   - **ESP8266HTTPClient** (included with ESP8266 board package)
   - **ArduinoJson** (by Benoit Blanchon) - Install version 6.x or later
     - Search "ArduinoJson" → Install latest 6.x version

---

## Configuration

### 1. WiFi Settings (Lines 17-18)
```cpp
const char* ssid = "E";                    // Change to your WiFi SSID
const char* password = "2711297449072!";   // Change to your WiFi password
```

### 2. API Endpoint (Lines 21-24)
```cpp
const char* serverUrl = "https://192.168.1.3:7763/api/ml/autoupload";
const char* serverUrlHTTP = "http://192.168.1.3:7764/api/ml/autoupload";
const char* deviceToken = "d250ab27b30db84e3dbc843eda266e16";
bool useHTTPS = true;  // HTTPS-only mode for secure IoT uploads
```

**Network Configuration**:
- **External IP**: 192.168.1.3 (router IP for ESP8266 on WiFi network)
- **Internal IP**: 172.29.156.41 (server localhost for curl/Postman on same machine)
- **Port Forwarding**: Router forwards 192.168.1.3:7763 → 172.29.156.41:7763
- **Important**: ESP8266 must use external IP (192.168.1.3) to reach server from WiFi

**Protocol Configuration**:
- **HTTPS-only mode** (port 7763) - hardcoded for production security
- Uses `WiFiClientSecure` with `setInsecure()` for self-signed certificates
- If connection fails, verify:
  - Server HTTPS is running: `netstat -tlnp | grep 7763`
  - SSL certificates exist in `ssl/` folder
  - Gateway logs show no errors: `tail -f logs/gateway.log`
  - Device token is valid (regenerate in Profile page if needed)

### 3. Device Token (Line 23)
```cpp
const char* deviceToken = "d250ab27b30db84e3dbc843eda266e16";
```

**To get your device token:**
1. Open browser: http://localhost:7764 (or your server IP)
2. Login to system
3. Navigate to **Profile** page
4. Click **"Generate Token"** or **"Regenerate Token"**
5. Copy the displayed token (32 hex characters)
6. Paste into sketch at line 22
7. Re-upload sketch to ESP8266

---

## Hardware Setup

### LED Connections

| LED Color | GPIO Pin | NodeMCU Pin | Function |
|-----------|----------|-------------|----------|
| Red       | GPIO12   | D6          | Error    |
| Yellow    | GPIO13   | D7          | Sending  |
| Green     | GPIO14   | D5          | Success  |

**Wiring:**
```
NodeMCU D6 (GPIO12) → [330Ω Resistor] → Red LED (+) → GND
NodeMCU D7 (GPIO13) → [330Ω Resistor] → Yellow LED (+) → GND
NodeMCU D5 (GPIO14) → [330Ω Resistor] → Green LED (+) → GND
```

**Note:** Connect LED cathode (short leg, flat side) to GND, anode (long leg) to resistor.

---

## Upload to ESP8266

### 1. Board Configuration
- Open Arduino IDE
- Go to **Tools** → Configure:
  - **Board:** "NodeMCU 1.0 (ESP-12E Module)"
  - **Upload Speed:** 115200
  - **CPU Frequency:** 80 MHz
  - **Flash Size:** "4MB (FS:2MB OTA:~1019KB)"
  - **Port:** 
    - **Linux:** `/dev/ttyUSB0` (or `/dev/ttyUSB1`)
    - **Windows:** `COM3` (or check Device Manager)
    - **Mac:** `/dev/cu.usbserial-*`

### 2. Upload Sketch
1. Open `ESP8266_AutoUpload_V2.ino` in Arduino IDE
2. Update WiFi credentials, API URL, and device token
3. Connect NodeMCU via USB
4. Click **Upload** button (→)
5. Wait for "Done uploading" message

### 3. Troubleshooting Upload Errors
- **"Port not found"**: Check USB cable, install CH340 driver (for NodeMCU clones)
- **"espcomm_sync failed"**: Hold FLASH button on NodeMCU while clicking Upload
- **"Sketch too large"**: Change Flash Size to "4MB" in Tools menu

---

## Usage

### 1. Open Serial Monitor
- Arduino IDE → Tools → Serial Monitor
- Set baud rate to **115200**
- Set line ending to **"Newline"** or **"Both NL & CR"**

### 2. Watch Startup
```
=== ESP8266 Auto Upload V2 ===
9-Parameter Urine Analysis System
Connecting to WiFi: E
.....
WiFi Connected!
IP Address: 192.168.1.100

Ready. Type 'send' to upload data.
```

### 3. Send Data
Type `send` in Serial Monitor and press Enter.

**Expected Output (HTTP Mode - Default)**:
```
--- Sending Data ---
Dummy Urine Parameters:
  pH: 6.80
  TDS: 950 ppm
  Specific Gravity: 1.018
  Turbidity NTU: 7.50
  RGB: (240, 200, 120)
  Turbidity Level: Jernih
  Warna Dasar: KUNING
Protocol: HTTP
Client Type: WiFiClient
JSON Payload: {"ph":6.8,"tds":950,"specificGravity":1.018,...}
Sending to: http://192.168.1.3:7764/api/ml/autoupload
HTTP Response Code: 201
Response Body: {"success":true,"message":"Device data uploaded and processed successfully",...}
✓ SUCCESS: Data uploaded successfully!
--- Done ---
```

### 4. Available Commands
- `send` - Send dummy urine data to backend
- `http` - Switch to HTTP mode (port 7764)
- `https` - Switch to HTTPS mode (port 7763)
- `status` - Show WiFi and system status
- `help` - Show available commands

### 5. Runtime Protocol Switching
You can switch between HTTP and HTTPS without re-uploading:

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
✗ ERROR: HTTP request failed: connection failed  // May fail with self-signed cert
```

---

## LED Indicators

| LED      | Pattern          | Meaning                          |
|----------|------------------|----------------------------------|
| Yellow   | Solid (1-2 sec)  | Connecting to WiFi               |
| Green    | Blink (0.5 sec)  | WiFi connected                   |
| Yellow   | Solid (1-2 sec)  | Sending data to server           |
| Green    | Solid (2 sec)    | Data uploaded successfully (200) |
| Red      | Solid (2 sec)    | Error (connection, 401, 500, etc)|

---

## Testing & Verification

### 1. Check Backend Logs
```bash
# SSH to server
cd /var/www/html/HIBAH/deployments/v1-non-nginx

# Watch ML service logs
tail -f logs/ml.log | grep AUTOUPLOAD

# Expected output when ESP sends data:
[AUTOUPLOAD] Device token validated for user: 673a...
[AUTOUPLOAD] Received data: ph=6.8, tds=950, specificGravity=1.018, ...
[AUTOUPLOAD] Prediction result: Sehat (Kidney Stone: No)
```

### 2. Check Database
```bash
mongosh "mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection" --authenticationDatabase admin

# List recent predictions
db.predictions.find().sort({createdAt: -1}).limit(5).pretty()

# Check for IoT device data (should have all 9 parameters)
db.predictions.findOne({}, {parameters: 1})
```

### 3. Check Dashboard
1. Open browser: http://localhost:7764
2. Login
3. Navigate to **Dashboard**
4. Verify **Latest Prediction** shows all 9 parameters (not "N/A")

---

## Troubleshooting

### Connection Failed (HTTPS)
**Symptom:** Serial shows "✗ ERROR: HTTP request failed: connection failed" with "HTTP Response Code: -1"

**Root Causes:**
1. **HTTPS server not running on port 7763**
   - Verify: `netstat -tlnp | grep 7763`
   - Expected: Should show gateway listening on port 7763
   - Fix: `cd /var/www/html/HIBAH/deployments/v1-non-nginx && ./start.sh`
   
2. **SSL certificates missing**
   - Verify: `ls -la /var/www/html/HIBAH/deployments/v1-non-nginx/ssl/`
   - Expected: server.key, server.crt files exist
   - Fix: Regenerate certificates if missing
   
3. **Wrong IP address** (external vs internal)
   - ESP8266 on WiFi needs external IP (192.168.1.3)
   - curl on same machine uses internal IP (172.29.156.41)
   
4. **Port forwarding not configured**
   - Router must forward 192.168.1.3:7763 → 172.29.156.41:7763
   - Test from another device on WiFi network
   
5. **Device token invalid**
   - Token may have been regenerated/deleted
   - Fix: Get new token from Profile page and update sketch line 23
   
6. **WiFi signal weak**
   - Type `status` in Serial Monitor to check signal strength
   - Move ESP8266 closer to router

**Verification Steps:**
```
Step 1: Check sketch configuration
        Line 24 should be: bool useHTTPS = true;
        
Step 2: Verify HTTPS server running
        netstat -tlnp | grep 7763
        curl -k https://192.168.1.3:7763/api/health
        
Step 3: Check gateway logs
        tail -f logs/gateway.log | grep autoupload
        
Step 4: Type 'status' in Serial Monitor
        Check WiFi signal and connection status
        
Step 5: Type 'send' in Serial Monitor
        Expected: "HTTP Response Code: 201"
                  "✓ SUCCESS: Data uploaded successfully!"
```

**For detailed HTTPS troubleshooting**:
- See `../ESP8266_HTTPS_ONLY_FIX.md` for comprehensive guide

**Test with curl from external network**:
```bash
# From server, test as if from ESP8266
cd /var/www/html/HIBAH/deployments/v1-non-nginx
curl -k -X POST https://192.168.1.3:7763/api/ml/autoupload \
  -H "device-token: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ph":6.8,"tds":950,"specificGravity":1.018}'

# Expected: 201 {"success":true,...}
```
netstat -tlnp | grep -E '7763|7764'
# Should show 0.0.0.0:7763 and 0.0.0.0:7764 (not 127.0.0.1)

# Test from another device on same WiFi network
curl http://192.168.1.3:7764/api/health
# Expected: {"status":"ok","message":"Gateway is running"}
```

**Option 4: Runtime protocol switch**:
```
> http        (switch to HTTP mode)
Switched to HTTP mode
> send        (test upload)
```

**For detailed analysis**:
- See `../ESP8266_HTTPS_EXTERNAL_IP_FIX.md` (comprehensive root cause document)

### Works on curl but not ESP8266
**Symptom:** curl succeeds with 201, but ESP8266 gets "connection failed"

**Root Cause:** IP address mismatch (internal vs external)

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

**Solution:**
```cpp
// ESP8266 sketch must use EXTERNAL IP (router)
const char* serverUrlHTTP = "http://192.168.1.3:7764/api/ml/autoupload";

// curl on server uses INTERNAL IP (localhost)
curl http://172.29.156.41:7764/api/ml/autoupload ...
```

### HTTPS Connection Failed (TLS Handshake)
**Symptom:** Serial shows "TLS handshake failed" when using `useHTTPS = true`

**Root Cause:**
- Self-signed certificate with CN=localhost
- ESP8266 accesses via IP (192.168.1.3) → CN mismatch
- ESP8266 TLS limitations (memory, cipher suites)

**Solution:**
Use HTTP mode (`useHTTPS = false`) - HTTPS not required for local network testing.

### WiFi Connection Fails
**Symptom:** Serial shows "WiFi Connection Failed!" with red LED

**Solutions:**
- Verify SSID and password in sketch (lines 23-24)
- Check WiFi signal strength (ESP should be within range)
- Try 2.4GHz network (ESP8266 doesn't support 5GHz)
- Check router allows new devices (not MAC filtered)

### HTTP 401 Unauthorized
**Symptom:** Serial shows "✗ ERROR: Invalid device token (401 Unauthorized)"

**Solutions:**
- Token expired or invalid
- Regenerate token in Profile page
- Copy new token to sketch line 23
- Re-upload sketch to ESP8266
- Verify token has no extra spaces or quotes

### HTTP 500 Server Error
**Symptom:** Serial shows "✗ ERROR: Server error (500+)"

**Solutions:**
- Check backend logs: `tail -f logs/ml.log logs/prediction.log`
- Verify ML service is running: `ps aux | grep ml-service`
- Check MongoDB connection
- Restart services: `./stop.sh && ./start.sh`

### SSL Certificate Error
**Symptom:** Serial shows "SSL handshake failed" or similar

**Solutions:**
- Verify `client.setInsecure()` is present in code (line 158)
- Check API URL protocol (HTTP vs HTTPS)
- For V1, use HTTP: `http://172.29.156.41:7764/api/ml/autoupload`
- For V2, use HTTPS with `setInsecure()`

### Data Not Appearing in Dashboard
**Symptom:** Upload succeeds (200 OK) but Dashboard shows old data

**Solutions:**
- Refresh Dashboard page (Ctrl+R or Cmd+R)
- Check browser console (F12) for errors
- Verify MongoDB save: `db.predictions.find().sort({createdAt: -1}).limit(1)`
- Check user ID matches (ESP uses token → user ID mapping)

### Upload Fails to ESP8266
**Symptom:** Arduino IDE shows "espcomm_sync failed" or "Port not found"

**Solutions:**
- Install CH340 driver (for NodeMCU clones)
- Try different USB cable (data cable, not charge-only)
- Hold FLASH button while clicking Upload
- Try different USB port
- Check Device Manager (Windows) or `ls /dev/tty*` (Linux)

---

## Data Format

### 9 Parameters Sent to Backend

| Parameter         | Type   | Range/Values                                      | Example      |
|-------------------|--------|---------------------------------------------------|--------------|
| `ph`              | Float  | 4.5 - 8.0                                         | 6.8          |
| `tds`             | Int    | 0 - 2000 ppm                                      | 950          |
| `specificGravity` | Float  | 1.005 - 1.030                                     | 1.018        |
| `turbidityNTU`    | Float  | 0 - 100 NTU                                       | 7.5          |
| `red`             | Int    | 0 - 255                                           | 240          |
| `green`           | Int    | 0 - 255                                           | 200          |
| `blue`            | Int    | 0 - 255                                           | 120          |
| `turbidityLevel`  | String | "Jernih", "Agak Keruh", "Keruh"                   | "Jernih"     |
| `warnaDasar`      | String | "BENING", "KUNING", "MERAH", "COKLAT", etc.      | "KUNING"     |

### JSON Payload Example
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

---

## Customization

### Change Dummy Data
Edit lines 29-42 in sketch:
```cpp
UrineData dummyData = {
  6.8,           // ph (change this)
  950,           // tds (change this)
  1.018,         // specificGravity (change this)
  7.5,           // turbidityNTU (change this)
  240,           // red (change this)
  200,           // green (change this)
  120,           // blue (change this)
  "Jernih",      // turbidityLevel (change this)
  "KUNING"       // warnaDasar (change this)
};
```

### Add Sensor Integration
To replace dummy data with real sensors (TDS, pH, turbidity sensors):

1. **Add sensor libraries** (e.g., `DFRobot_PH`, `GravityTDS`)
2. **Initialize sensors** in `setup()`
3. **Read sensor values** in `sendData()` before creating JSON
4. **Replace dummy values** with sensor readings:
   ```cpp
   doc["ph"] = phSensor.readPH();
   doc["tds"] = tdsSensor.readTDS();
   // ... etc
   ```

### Add LCD Display (Optional)
Uncomment LCD-related code if you have an I2C LCD:
```cpp
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2); // Update I2C address if needed

void setup() {
  lcd.init();
  lcd.backlight();
  lcd.print("ESP8266 V2");
}
```

---

## Security Notes

### Device Token
- Token is **hardcoded** in sketch for simplicity
- For production, store in EEPROM or SPIFFS
- Regenerate token if ESP8266 is lost/stolen
- Never commit token to public Git repository

### HTTPS
- `setInsecure()` bypasses SSL certificate validation
- Accept self-signed certificates (development)
- For production, use proper SSL certificates and remove `setInsecure()`

---

## Next Steps

1. ✅ Upload sketch and verify serial output
2. ✅ Test "send" command → check 200 OK response
3. ✅ Verify data in backend logs (`tail -f logs/ml.log`)
4. ✅ Check Dashboard displays all 9 parameters
5. ✅ Test with different dummy data values
6. 🔄 Integrate real sensors (TDS, pH, turbidity)
7. 🔄 Add automatic upload timer (e.g., every 5 minutes)
8. 🔄 Implement EEPROM token storage
9. 🔄 Add LCD display for local feedback

---

## Support

**Issues:**
- Check serial monitor output (115200 baud)
- Review backend logs: `tail -f logs/ml.log logs/user.log`
- Verify token in Profile page
- Test WiFi connectivity: `status` command

**Documentation:**
- Backend API: `../../api-documentation.md`
- System architecture: `../../README.md`
- Troubleshooting: `../../PROFILE_DASHBOARD_IOT_FIXES.md`
