# ESP8266 HTTPS Connection Troubleshooting Guide

**Problem**: ESP8266 shows "connection failed" when sending data, despite code having `useHTTPS = false`.

**Date**: February 2025  
**Status**: ✅ DOCUMENTED

---

## Problem Statement

### Symptoms
- ESP8266 Serial Monitor shows: `✗ ERROR: HTTP request failed: connection failed`
- Serial output displays: `Sending to: https://192.168.1.3:7763/api/ml/autoupload`
- Code line 24 has: `bool useHTTPS = false;` (HTTP mode)
- curl and Postman work perfectly with same URL and token from external network

### Why It's Confusing
- The code default is HTTP (`useHTTPS = false`)
- But ESP8266 is actually using HTTPS at runtime
- Connection works from curl/Postman but not from ESP8266

---

## Root Cause

### The Issue: Runtime Variable Persistence

**`useHTTPS` is a runtime variable that persists in ESP8266 RAM**

1. **Code Default**: Line 24 sets `bool useHTTPS = false;` (HTTP mode)
2. **This default ONLY applies on first boot** (when ESP8266 powers on)
3. **Serial commands change it in RAM**: Typing `https` in Serial Monitor sets `useHTTPS = true`
4. **Setting persists**: The variable stays `true` until ESP8266 is reset/powered off
5. **Subsequent sends use HTTPS**: Even though code shows `false`, the runtime value is `true`

### Why HTTPS Fails on ESP8266

**TLS Handshake Issues**:
- **Certificate CN Mismatch**: Self-signed cert has `CN=localhost`, but ESP8266 accesses via `192.168.1.3` (IP address)
- **Limited TLS Support**: ESP8266 has restricted cipher suite support and limited memory for TLS operations
- **setInsecure() Unreliable**: Even with certificate validation disabled, handshake can still fail on some networks
- **WiFi Instability**: Weak signal or congestion can cause TLS timeout errors

**Why curl/Postman Work**:
- Full TLS library with all cipher suites
- More memory for certificate handling
- Better error recovery
- Can use `-k` flag to skip cert validation completely

---

## Solution Steps

### Quick Fix (Recommended)

**Step 1**: Open Serial Monitor (115200 baud)

**Step 2**: Type command to switch to HTTP:
```
http
```

**Expected Response**:
```
Protocol changed to: HTTP
Type 'send' to test with new protocol
```

**Step 3**: Verify current mode:
```
status
```

**Expected Output**:
```
=== System Status ===
WiFi Status: Connected
  SSID: ZTE_2.4G_Jody
  IP Address: 192.168.1.100
  Signal Strength: -45 dBm
Current Protocol: HTTP
Target URL: http://192.168.1.3:7764/api/ml/autoupload
Device Token: d250ab27 (first 8 chars)
```

**Step 4**: Send data:
```
send
```

**Expected Output**:
```
Current Protocol: HTTP (port 7764)

--- Sending Data ---
Protocol: HTTP
Client Type: WiFiClient
Sending to: http://192.168.1.3:7764/api/ml/autoupload
...
HTTP Response Code: 201
✓ SUCCESS: Data uploaded successfully!
```

---

## Verification Commands

### Check Current Protocol
```
status
```
Shows: `Current Protocol: HTTP` or `HTTPS`

### Switch to HTTP (Recommended)
```
http
```
Response: `Protocol changed to: HTTP`

### Switch to HTTPS (Not Recommended)
```
https
```
Response: `Protocol changed to: HTTPS`  
Note: Will likely fail with "connection failed"

### Send Data
```
send
```
Uses current protocol (check output shows correct URL)

### Show All Commands
```
help
```

---

## Expected Serial Output

### Successful HTTP Upload

```
> http
Protocol changed to: HTTP
Type 'send' to test with new protocol

> send
Current Protocol: HTTP (port 7764)

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
JSON Payload: {"ph":6.8,"tds":950,"specificGravity":1.018,"turbidityNTU":7.5,"red":240,"green":200,"blue":120,"turbidityLevel":"Jernih","warnaDasar":"KUNING"}
Sending to: http://192.168.1.3:7764/api/ml/autoupload
HTTP Response Code: 201
Response Body: {"success":true,"message":"Device data uploaded and processed successfully",...}
✓ SUCCESS: Data uploaded successfully!
--- Done ---
```

### Failed HTTPS Upload

```
> https
Protocol changed to: HTTPS
Type 'send' to test with new protocol

> send
Current Protocol: HTTPS (port 7763)

--- Sending Data ---
Dummy Urine Parameters:
  pH: 6.80
  TDS: 950 ppm
  ...
Protocol: HTTPS
Client Type: WiFiClientSecure
JSON Payload: {"ph":6.8,...}
Sending to: https://192.168.1.3:7763/api/ml/autoupload
✗ ERROR: HTTP request failed: connection failed
--- Done ---
```

---

## Understanding the Code Behavior

### Code Default (Line 24)
```cpp
bool useHTTPS = false;  // Set to false for HTTP testing (recommended for ESP8266)
```
- This is the **initial value** when ESP8266 boots up
- Does NOT reset between `send` commands
- Only applies on power-on or reset

### Runtime Commands (Lines 88-95)
```cpp
if (command == "http") {
  useHTTPS = false;  // ← Changes runtime variable
  Serial.println("Switched to HTTP mode");
} else if (command == "https") {
  useHTTPS = true;   // ← Changes runtime variable
  Serial.println("Switched to HTTPS mode");
}
```
- These change the variable **in RAM**
- Persists across multiple `send` commands
- Only reset by power cycle or typing opposite command

### URL Selection (Line 199)
```cpp
Serial.println(useHTTPS ? serverUrl : serverUrlHTTP);
```
- Uses **runtime value** of `useHTTPS`
- If you typed `https` earlier, this shows HTTPS URL
- Code default doesn't matter after serial command

---

## Why HTTP is Recommended for ESP8266

### Technical Limitations

**Memory Constraints**:
- WiFiClient (HTTP): ~2KB RAM
- WiFiClientSecure (HTTPS): ~20KB RAM
- ESP8266 total: 80KB RAM (25% consumed by TLS)

**TLS Stack Limitations**:
- Limited cipher suite support
- No hardware crypto acceleration
- Slow handshake (1-3 seconds)
- High failure rate on weak WiFi

**Certificate Validation Issues**:
- Self-signed certs not trusted
- CN mismatch (localhost ≠ 192.168.1.3)
- `setInsecure()` helps but not foolproof
- Time sync required (NTP) for cert validity

### HTTP Advantages for Local Testing

**Reliability**:
- Always works on local networks
- No TLS handshake delays
- Lower memory usage
- Faster connection

**Simplicity**:
- No certificate management
- No time sync required
- Easier debugging
- Consistent behavior

**Performance**:
- 200-500ms faster per request
- More predictable timing
- Lower power consumption

**Security Note**: For production deployments on public networks, HTTPS is required. For local IoT testing on private WiFi, HTTP is acceptable and more reliable.

---

## Troubleshooting Checklist

### ✓ Connection Failed on ESP8266

1. **Check current protocol**:
   ```
   status
   ```
   Look for: `Current Protocol: HTTP` or `HTTPS`

2. **If HTTPS, switch to HTTP**:
   ```
   http
   ```

3. **Verify URL in send output**:
   ```
   send
   ```
   Should show: `Sending to: http://192.168.1.3:7764/...`

4. **Check WiFi signal**:
   ```
   status
   ```
   Signal should be > -70 dBm

### ✓ Still Failing After Switching to HTTP

1. **Check external IP is correct**:
   - Line 21: `const char* serverUrl = "https://192.168.1.3:7763/..."`
   - Line 22: `const char* serverUrlHTTP = "http://192.168.1.3:7764/..."`
   - Verify `192.168.1.3` is your router's IP

2. **Test from server**:
   ```bash
   cd /var/www/html/HIBAH/deployments/v1-non-nginx
   ./test-esp8266-external.sh
   ```
   Expected: HTTP should return 201 success

3. **Check port forwarding**:
   - Router must forward `192.168.1.3:7764` → `172.29.156.41:7764`
   - Test from another device on WiFi network

4. **Check server firewall**:
   ```bash
   sudo ufw status | grep 7764
   sudo ufw allow 7764/tcp
   ```

### ✓ Protocol Keeps Switching Back to HTTPS

**Cause**: Someone is typing `https` command in Serial Monitor

**Solution**: 
- Type `http` before each test session
- Or reset ESP8266 (power cycle) to restore code default
- Check `status` before sending to confirm mode

---

## Power Cycle vs Serial Command

### Power Cycle (Hard Reset)
```
1. Unplug ESP8266 USB
2. Wait 2 seconds
3. Plug back in
4. Wait for WiFi connection
5. useHTTPS is now FALSE (code default from line 24)
```

### Serial Command (Soft Switch)
```
1. Type: http
2. Response: Protocol changed to: HTTP
3. useHTTPS is now FALSE (changed in RAM)
4. No reboot needed
```

**Recommendation**: Use serial command (`http`) - faster and doesn't disconnect WiFi.

---

## Related Documentation

- **ESP8266 Setup**: `ESP8266_AutoUpload_V2/README.md`
- **External IP Fix**: `ESP8266_HTTPS_EXTERNAL_IP_FIX.md`
- **Token Auth**: `../IOT_AUTOUPLOAD_FIX.md`
- **Main IoT Guide**: `README.md`

---

## Summary

**Problem**: `useHTTPS` persists in RAM from previous `https` serial command, causing HTTPS connection failures.

**Solution**: Type `http` in Serial Monitor before sending data.

**Prevention**: Always check `status` before `send` to verify protocol mode.

**Recommendation**: Use HTTP for ESP8266 local testing - more reliable, faster, and simpler than HTTPS.

**Key Lesson**: Runtime variables in embedded systems persist between function calls. Code defaults only apply on first boot.
