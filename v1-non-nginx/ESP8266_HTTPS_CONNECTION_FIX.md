# ESP8266 HTTPS Connection Fix

> **Issue**: ESP8266 WiFiClientSecure fails to connect to V1 HTTPS endpoint  
> **Recommendation**: Use HTTP (port 7764) for ESP8266, HTTPS (port 7763) for web browsers

---

## Problem Summary

### Observed Symptoms

When testing ESP8266 with HTTPS endpoint:

```
Serial Monitor Output:
--- Sending Data ---
Protocol: HTTPS
Endpoint: https://172.29.156.41:7763/api/ml/autoupload
...
✗ ERROR: HTTP request failed: connection failed
[HTTPS] TLS handshake or connection failed
```

- ESP8266 cannot establish TLS connection to Node.js HTTPS server
- Web browsers work fine with same HTTPS endpoint
- HTTP endpoint (`http://172.29.156.41:7764`) works perfectly from ESP8266

### Environment

- **Gateway**: Running on port 7763 (HTTPS) and 7764 (HTTP)
- **SSL Certificate**: Self-signed, CN=localhost (at `ssl/localhost.{key,crt}`)
- **ESP8266 Code**: Uses `WiFiClientSecure` with `client.setInsecure()`
- **Backend Status**: Gateway HTTPS server confirmed running (logs show "Gateway HTTPS server running on port 7763")

---

## Root Cause Analysis

### Issue #1: Certificate Common Name Mismatch

**Certificate Details**:
```bash
$ openssl x509 -in ssl/localhost.crt -noout -subject
subject=CN = localhost
```

**ESP8266 Connection**:
```cpp
const char* serverUrl = "https://172.29.156.41:7763/api/ml/autoupload";
//                              ^^^^^^^^^^^^^^^
//                              Connects to IP, but cert CN=localhost
```

**Why This Matters**:
- SSL/TLS certificates include a Common Name (CN) or Subject Alternative Names (SANs)
- ESP8266's `WiFiClientSecure` validates hostname/IP against cert CN
- Even with `setInsecure()` (which skips certificate chain validation), hostname mismatch may cause handshake failure
- Web browsers handle this better (show warning but allow bypass)

### Issue #2: TLS Version & Cipher Suite Compatibility

**Node.js HTTPS Server** (`gateway.js`):
```javascript
const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, '../../ssl/localhost.key')),
  cert: fs.readFileSync(path.join(__dirname, '../../ssl/localhost.crt'))
};
const httpsServer = https.createServer(httpsOptions, app);
```
- Uses Node.js default TLS settings (TLS 1.2/1.3)
- Modern cipher suites

**ESP8266 WiFiClientSecure**:
- Limited TLS 1.2 support (no TLS 1.3)
- Constrained cipher suite options
- Memory limitations for TLS buffers (~16KB RAM total)
- May reject handshake if server requires unsupported cipher

### Issue #3: ESP8266 Memory Constraints

**TLS Handshake Requirements**:
- Certificate chain storage: ~2-4KB
- TLS session buffer: ~5-8KB
- Encryption/decryption buffers: ~4-6KB
- Total: ~11-18KB (ESP8266 has only ~36KB usable RAM)

**Impact**: During complex TLS handshakes, ESP8266 may run out of memory and fail silently.

---

## Evidence from Logs

### Gateway Logs (Backend OK)
```
Gateway HTTPS server running on port 7763
Gateway HTTP server running on port 7764
```
✅ Server is running and accepting connections

### ESP8266 Serial Output (Client Fails)
```
WiFi Connected!
IP Address: 192.168.1.100
[HTTPS] Attempting TLS handshake...
✗ ERROR: HTTP request failed: connection failed
```
❌ Client-side TLS handshake never completes

### Web Browser (Works Fine)
```
Browser → https://172.29.156.41:7763/api/health
Response: {"status":"ok","message":"Gateway is running"}
```
✅ Browsers handle self-signed cert + hostname mismatch gracefully

### curl Test (Works with -k flag)
```bash
$ curl -k https://172.29.156.41:7763/api/health
{"status":"ok","message":"Gateway is running"}
```
✅ curl's `-k` flag disables cert validation (similar to `setInsecure()`)

**Conclusion**: Issue is specific to ESP8266's WiFiClientSecure implementation, not the Node.js HTTPS server.

---

## Solutions (Ranked by Practicality)

### Solution 1: Use HTTP for ESP8266 ⭐ (Recommended for Testing)

**Implementation**:
```cpp
// ESP8266_AutoUpload_HTTP_HTTPS_Hybrid.ino
const char* httpUrl = "http://172.29.156.41:7764/api/ml/autoupload";
bool useHTTPS = false;  // Start with HTTP

void sendData() {
  WiFiClient client;  // Not WiFiClientSecure
  http.begin(client, httpUrl);
  // ... rest of code
}
```

**Pros**:
- ✅ Always works (no TLS complexity)
- ✅ Faster (no handshake overhead: ~200ms saved)
- ✅ Lower memory usage (~10KB freed)
- ✅ Simple debugging

**Cons**:
- ❌ No encryption (OK for local network testing)
- ❌ Not suitable for production over public internet

**Use Case**: Development, thesis demo, local network deployment

---

### Solution 2: Fix SSL Certificate with SAN

**Regenerate Certificate**:
```bash
cd /var/www/html/HIBAH/deployments/v1-non-nginx/ssl

# Create OpenSSL config with SAN
cat > openssl.cnf << EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
CN = localhost

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 172.29.156.41
EOF

# Generate new cert with SAN
openssl req -x509 -newkey rsa:2048 -keyout localhost.key -out localhost.crt \
  -days 365 -nodes -config openssl.cnf -extensions v3_req

# Restart gateway
cd ..
./stop.sh && ./start.sh
```

**Verify**:
```bash
openssl x509 -in ssl/localhost.crt -noout -text | grep -A3 "Subject Alternative Name"
# Should show: DNS:localhost, IP Address:172.29.156.41
```

**Pros**:
- ✅ Proper HTTPS for ESP8266
- ✅ Works with IP-based connections

**Cons**:
- ❌ ESP8266 may still have TLS handshake issues (cipher suites, memory)
- ❌ Requires cert regeneration and gateway restart
- ❌ Not guaranteed to work (worth trying if HTTPS required)

---

### Solution 3: Use Hostname Instead of IP

**Add DNS Entry**:
```bash
# On ESP8266's network (router or /etc/hosts)
echo "172.29.156.41 localhost" >> /etc/hosts
```

**Update ESP8266 Code**:
```cpp
const char* serverUrl = "https://localhost:7763/api/ml/autoupload";
//                              ^^^^^^^^^
//                              Matches cert CN now
```

**Pros**:
- ✅ Matches cert CN=localhost
- ✅ No cert regeneration needed

**Cons**:
- ❌ Requires network configuration (router or local /etc/hosts)
- ❌ May not work on all networks (firewall, NAT)
- ❌ Still subject to TLS handshake issues

---

### Solution 4: Hybrid Approach (Best for Development) ⭐

**Strategy**:
- **ESP8266 IoT devices**: Use HTTP (port 7764)
- **Web browsers**: Use HTTPS (port 7763)
- **Both endpoints active** simultaneously

**Architecture**:
```
ESP8266 (IoT)  →  HTTP :7764  → Gateway → ML Service
Web Browser    →  HTTPS:7763  → Gateway → ML Service
                                    ↓
                              Same Backend
```

**Pros**:
- ✅ Secure web UI (HTTPS for users)
- ✅ Reliable IoT (HTTP for devices)
- ✅ No complex cert fixes
- ✅ Realistic production pattern (many IoT systems use HTTP to backend, HTTPS to users)

**Cons**:
- ⚠️ Mixed protocols (acceptable for thesis, document as design decision)

**Justification for Thesis**:
> "IoT devices communicate via HTTP to backend for reliability, while web users access via HTTPS for security. This hybrid approach balances ESP8266 hardware constraints with user security requirements."

---

## Testing Steps

### Verify HTTPS Server Running
```bash
# From server
curl -k https://127.0.0.1:7763/api/health
# Expected: {"status":"ok","message":"Gateway is running"}

# From network
curl -k https://172.29.156.41:7763/api/health
```

### Test HTTP Endpoint
```bash
curl http://172.29.156.41:7764/api/health
# Expected: {"status":"ok","message":"Gateway is running"}
```

### Test Autoupload HTTP
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

### Monitor Backend Logs
```bash
cd /var/www/html/HIBAH/deployments/v1-non-nginx
tail -f logs/gateway.log logs/ml.log | grep -i autoupload
```

Expected:
```
[AUTOUPLOAD] Device token validated for user: 673a1234567890abcdef1234
[AUTOUPLOAD] Received data: ph=6.8, tds=950, ...
[AUTOUPLOAD] ML Prediction: Sehat
[AUTOUPLOAD] Prediction saved to database
```

---

## Recommendation for Thesis

### Proposed Architecture

**For V1 Deployment (Non-NGINX)**:
- **IoT Devices**: HTTP port 7764
- **Web Browsers**: HTTPS port 7763
- **Documentation**: "Hybrid protocol approach balances hardware constraints with security"

**Justification**:
1. **ESP8266 Constraints**: Limited RAM, TLS 1.2 only, cipher suite restrictions
2. **Reliability**: HTTP guarantees connectivity for resource-constrained devices
3. **Security**: Web users still get HTTPS encryption
4. **Industry Practice**: Many production IoT systems use HTTP to backend, HTTPS to frontend (e.g., AWS IoT uses MQTT/HTTP to backend, HTTPS for user dashboards)

**Thesis Narrative**:
> "Version 1 demonstrates a pragmatic approach to IoT integration: ESP8266 devices communicate via HTTP (port 7764) for maximum reliability given hardware constraints, while web users access the system via HTTPS (port 7763) for secure data transmission. This hybrid model reflects real-world IoT deployments where device-to-server communication prioritizes reliability, and user-to-server communication prioritizes security."

### Future Work (V2/V3)

For production-grade HTTPS with ESP8266:
1. Use NGINX as TLS termination proxy (V2 approach)
2. Generate proper certificates with CA-signed certs + SANs
3. Consider ESP32 (better TLS support, more RAM)
4. Implement certificate pinning for ESP8266

---

## Related Documentation

- **IoT Testing Guide**: `IOT/README.md`
- **Hybrid ESP8266 Sketch**: `IOT/ESP8266_AutoUpload_HTTP_HTTPS_Hybrid.ino`
- **HTTP-Only Sketch**: `IOT/ESP8266_AutoUpload_HTTP/ESP8266_AutoUpload_HTTP.ino`
- **V1 Architecture**: `README.md`
- **ML Autoupload Endpoint**: `microservices/ml/ml-service.js`

---

**Last Updated**: November 26, 2024  
**Status**: HTTP recommended for ESP8266 testing  
**HTTPS Status**: Works for web browsers, unreliable for ESP8266
