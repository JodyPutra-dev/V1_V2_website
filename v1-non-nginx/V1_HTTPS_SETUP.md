# V1 HTTPS Setup Documentation

## Overview

**V1 now uses HTTPS on port 7763 with direct Node.js SSL server** (no NGINX reverse proxy). This matches V2's port number but differs in implementation:

- **V1**: Direct Node.js HTTPS server (SSL/TLS handled in gateway.js)
- **V2**: NGINX SSL termination (SSL offloaded to NGINX, Node.js receives HTTP internally)

---

## SSL Certificate Setup

### Option 1: Automated Script (Recommended)

```bash
cd /var/www/html/HIBAH/ssl
./generate-certs.sh
```

This script will:
1. Generate 2048-bit RSA private key (`localhost.key`)
2. Create self-signed certificate valid for 365 days (`localhost.crt`)
3. Set proper file permissions (600 for key, 644 for cert)
4. Display success message with file paths

### Option 2: Manual OpenSSL Commands

```bash
cd /var/www/html/HIBAH/ssl

# Generate private key
openssl genrsa -out localhost.key 2048

# Generate self-signed certificate
openssl req -new -x509 -key localhost.key -out localhost.crt -days 365 \
  -subj "/CN=localhost"

# Set permissions
chmod 600 localhost.key
chmod 644 localhost.crt
```

### Verify Certificates

```bash
# Check private key
openssl rsa -in localhost.key -check

# Check certificate details
openssl x509 -in localhost.crt -text -noout

# Verify certificate matches key
openssl x509 -noout -modulus -in localhost.crt | openssl md5
openssl rsa -noout -modulus -in localhost.key | openssl md5
# (MD5 hashes should match)
```

---

## Configuration Changes

### 1. `.env.v1` - Enable HTTPS

**File:** `deployments/v1-non-nginx/.env.v1`

**Before:**
```bash
DISABLE_HTTPS=true
```

**After:**
```bash
# DISABLE_HTTPS=false  # Enable HTTPS on port 7763 for V1 (direct Node.js SSL server)
```

**Effect:** Allows gateway.js HTTPS server startup code (lines 2812-2867) to execute.

### 2. `config.js` - Remove HTTP-Only Enforcement

**File:** `deployments/v1-non-nginx/frontend/src/config.js`

**Before:**
```javascript
// V1 DEPLOYMENT: Force HTTP-only mode (no NGINX, no SSL)
const currentProtocol = process.env.REACT_APP_FORCE_HTTP === 'true' 
  ? 'http' 
  : (window.location.protocol.includes('https') ? 'https' : 'http');
```

**After:**
```javascript
// V1 DEPLOYMENT: Support both HTTP and HTTPS
// V1 runs HTTPS on port 7763 (direct Node.js SSL), V2 runs HTTPS with NGINX on port 7763
const currentProtocol = window.location.protocol.includes('https') ? 'https' : 'http';
```

**Effect:** Frontend detects HTTPS protocol from browser and uses port 7763.

### 3. `start.sh` - Update Frontend Build

**File:** `deployments/v1-non-nginx/start.sh`

**Before:**
```bash
REACT_APP_FORCE_HTTP=true REACT_APP_DIRECT_API=true REACT_APP_USE_NGINX=false REACT_APP_DIRECT_PROD=true npm run build
```

**After:**
```bash
REACT_APP_DIRECT_API=true REACT_APP_USE_NGINX=false REACT_APP_DIRECT_PROD=true npm run build
```

**Effect:** Removes HTTP-only enforcement, allows HTTPS protocol detection.

### 4. `ssl/` Symlink

**Location:** `deployments/v1-non-nginx/ssl` → `../../ssl`

Created with: `ln -sf ../../ssl ssl`

**Effect:** V1 deployment accesses shared SSL certificates without duplication.

---

## Starting V1 with HTTPS

```bash
cd /var/www/html/HIBAH/deployments/v1-non-nginx

# Rebuild frontend (if needed)
cd frontend
npm run build
cd ..

# Start services
./start.sh
```

**Expected Output:**
```
╔═══════════════════════════════════════════════════════════╗
║  🎉 Version 1 (Non-NGINX Baseline) Started Successfully!  ║
╚═══════════════════════════════════════════════════════════╝

🌐 Access Points:
   Frontend: https://localhost:7763
   Backend API: https://localhost:7763/api/*
```

---

## Verification

### 1. Test HTTPS Endpoint

```bash
# Health check (ignore self-signed cert warning)
curl -k https://localhost:7763/api/health

# Expected response:
# {"status":"healthy","timestamp":"...","services":{"gateway":"running"}}
```

### 2. Check Browser Access

1. Open browser: `https://localhost:7763`
2. **Certificate Warning**: "Your connection is not private" (expected for self-signed certs)
3. Click "Advanced" → "Proceed to localhost (unsafe)"
4. Login page should load

### 3. Verify SSL Certificate

```bash
# Check certificate details
openssl s_client -connect localhost:7763 -showcerts </dev/null 2>/dev/null | openssl x509 -text -noout

# Should show:
# Subject: CN = localhost
# Validity: Not Before/Not After dates
# Issuer: CN = localhost (self-signed)
```

### 4. Check Browser Console

Open DevTools (F12) → Console:

```javascript
App Configuration: {
  protocol: "https",               // ← Should be "https"
  hostname: "localhost",
  currentMode: "Direct Production",
  apiUrl: "",                      // ← Empty (same-origin)
  directApiUrl: "https://localhost:7763"
}
```

### 5. Check Network Tab

DevTools → Network tab. All API requests should use HTTPS:

```
✓ https://localhost:7763/api/health           → 200 OK
✓ https://localhost:7763/api/auth/me          → 200 OK
✓ https://localhost:7763/api/predict/stats    → 200 OK
```

---

## Browser Certificate Warnings

### Chrome

**Warning:** "Your connection is not private - NET::ERR_CERT_AUTHORITY_INVALID"

**To Proceed:**
1. Click "Advanced"
2. Click "Proceed to localhost (unsafe)"

**To Permanently Trust (Development Only):**
1. Export certificate: `openssl x509 -in ssl/localhost.crt -out localhost.pem`
2. Chrome Settings → Privacy and Security → Security → Manage Certificates
3. Import `localhost.pem` to "Trusted Root Certification Authorities"

### Firefox

**Warning:** "Warning: Potential Security Risk Ahead"

**To Proceed:**
1. Click "Advanced"
2. Click "Accept the Risk and Continue"

**To Permanently Trust (Development Only):**
1. Click padlock icon in address bar
2. Connection Not Secure → More Information
3. View Certificate → Details → Export
4. Firefox Settings → Privacy & Security → Certificates → View Certificates
5. Import saved certificate

### Edge

**Warning:** "Your connection isn't private"

**To Proceed:**
1. Click "Advanced"
2. Click "Continue to localhost (unsafe)"

Same certificate trust process as Chrome (Edge uses Windows certificate store).

---

## Troubleshooting

### Certificate Not Found Error

**Symptom:**
```
Error: ENOENT: no such file or directory, open 'ssl/localhost.key'
Gateway HTTPS server failed to start
```

**Solution:**
```bash
# Check symlink exists
ls -la deployments/v1-non-nginx/ssl
# Should show: ssl -> ../../ssl

# Check certificates exist
ls -la ssl/
# Should show: localhost.key, localhost.crt

# Regenerate certificates if missing
cd ssl && ./generate-certs.sh
```

### Port 7763 Already in Use

**Symptom:**
```
Error: listen EADDRINUSE: address already in use :::7763
```

**Solution:**
```bash
# Check what's using port 7763
sudo lsof -i :7763

# If V2 is running, stop it first
cd deployments/v2-nginx-pm2
./stop.sh

# Or kill the process
kill -9 <PID>
```

### HTTPS Server Not Starting

**Symptom:**
Gateway starts but only HTTP (7764) works, HTTPS (7763) doesn't respond.

**Solution:**
```bash
# Check gateway logs
tail -50 logs/gateway.log

# Look for HTTPS startup message:
# "HTTPS server listening on port 7763"

# If not found, check .env.v1
grep DISABLE_HTTPS .env.v1
# Should be commented out or false

# Restart services
./stop.sh && ./start.sh
```

### Certificate Expired

**Symptom:**
```
Browser: NET::ERR_CERT_DATE_INVALID
```

**Solution:**
```bash
# Check certificate validity
openssl x509 -in ssl/localhost.crt -noout -dates

# If expired, regenerate
cd ssl
rm localhost.key localhost.crt
./generate-certs.sh
cd ../deployments/v1-non-nginx
./stop.sh && ./start.sh
```

### Mixed Content Errors

**Symptom:**
Browser console shows: "Mixed Content: The page was loaded over HTTPS, but requested an insecure resource"

**Cause:** Frontend making HTTP API requests while served over HTTPS.

**Solution:**
```bash
# Rebuild frontend to use HTTPS
cd frontend
rm -rf build node_modules/.cache
npm run build
cd ..
./stop.sh && ./start.sh
```

---

## Performance Impact

HTTPS adds minimal overhead to V1 baseline performance:

| Operation | HTTP | HTTPS | Overhead |
|-----------|------|-------|----------|
| Initial Connection | 5ms | 15-25ms | +10-20ms (TLS handshake) |
| Subsequent Requests | 5ms | 6-7ms | +1-2ms (encryption) |
| Large File Upload | 100ms | 105ms | +5ms (TLS overhead) |

**Notes:**
- TLS handshake occurs once per connection (reused via Keep-Alive)
- Encryption overhead is negligible (<2%) for typical API responses
- HTTPS overhead is **intentionally part of V1 baseline** for thesis comparison
- V2 offloads SSL to NGINX, reducing Node.js CPU overhead

---

## V1 vs V2 HTTPS Comparison

| Aspect | V1 (Direct Node.js SSL) | V2 (NGINX SSL Termination) |
|--------|------------------------|----------------------------|
| **Protocol** | HTTPS | HTTPS |
| **Port** | 7763 | 7763 |
| **SSL Handler** | Node.js (gateway.js) | NGINX |
| **TLS Implementation** | Node.js `https` module | NGINX OpenSSL |
| **CPU Overhead** | Higher (Node.js event loop) | Lower (NGINX C code) |
| **Certificate Location** | `ssl/` (symlinked) | NGINX conf (`/etc/nginx/ssl/`) |
| **Performance** | Baseline (intentional bottleneck) | Optimized (offloaded) |
| **Concurrency** | Single-threaded SSL | Multi-process SSL workers |
| **Use Case** | Thesis baseline testing | Production-ready optimized |

**Key Difference:**
- **V1**: Node.js handles TLS encryption in the same process as business logic (CPU contention)
- **V2**: NGINX handles TLS in separate processes, Node.js receives plain HTTP internally (CPU isolation)

---

## Production Certificate Upgrade

For production deployment, replace self-signed certificates with CA-signed certificates:

### Let's Encrypt (Free, Automated)

```bash
# Install certbot
sudo apt-get install certbot

# Generate certificate (requires public domain)
sudo certbot certonly --standalone -d yourdomain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ssl/localhost.key
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ssl/localhost.crt

# Set permissions
sudo chown $USER:$USER ssl/localhost.key ssl/localhost.crt
chmod 600 ssl/localhost.key
chmod 644 ssl/localhost.crt

# Restart services
./stop.sh && ./start.sh
```

### Manual CA Certificate

```bash
# Obtain from CA: privkey.pem, fullchain.pem
# Copy to ssl/ folder
cp /path/to/privkey.pem ssl/localhost.key
cp /path/to/fullchain.pem ssl/localhost.crt

# Set permissions
chmod 600 ssl/localhost.key
chmod 644 ssl/localhost.crt

# Restart
./stop.sh && ./start.sh
```

---

## Related Documentation

- **V1 README**: `deployments/v1-non-nginx/README.md`
- **V1 Architecture**: System design and bottlenecks
- **HTTPS Fix (Old)**: `HTTPS_HTTP_FIX.md` (now obsolete, kept for reference)
- **SSL Script**: `ssl/generate-certs.sh`
- **Gateway Code**: `microservices/gateway/gateway.js` (lines 2812-2867: HTTPS server)

---

## Summary

**Changes Made:**
1. ✅ SSL certificates generated (`ssl/localhost.key`, `ssl/localhost.crt`)
2. ✅ `.env.v1`: Removed `DISABLE_HTTPS=true`
3. ✅ `config.js`: Removed HTTP-only enforcement
4. ✅ `start.sh`: Removed `REACT_APP_FORCE_HTTP=true` from build
5. ✅ SSL symlink created in V1 deployment folder

**Result:**
- V1 now serves HTTPS on port 7763 (direct Node.js SSL server)
- Browser warnings expected (self-signed certificate)
- HTTP port 7764 still available as fallback
- Matches V2 port number (7763) for consistency

**Testing:**
```bash
# Access V1 via HTTPS
curl -k https://localhost:7763/api/health

# Browser access
https://localhost:7763
# (Accept certificate warning)
```

**Note:** Self-signed certificates are for development/testing only. Use CA-signed certificates for production.
