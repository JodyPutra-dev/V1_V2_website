# HTTPS/HTTP Fix Documentation

## Issue Overview

**Problem**: V1 frontend attempts HTTPS connections (port 7763) which fail with 400 Bad Request errors.

**Root Cause**: V1 deployment is HTTP-only (no NGINX, no SSL), but frontend protocol detection uses browser's `window.location.protocol`, causing HTTPS attempts when accessed via HTTPS browser initially.

**Impact**: 
- API health checks fail
- Frontend shows connection errors
- Dashboard/Profile pages fail to load data
- Token regeneration doesn't work

---

## Technical Details

### V1 Architecture (HTTP-Only)

```
┌─────────────┐
│   Browser   │ Access via http://172.29.156.41:7764
└──────┬──────┘
       │ HTTP
       ▼
┌─────────────────────────────────┐
│  Gateway (Node.js)              │
│  Port: 7764 (HTTP)              │
│  - Serves static frontend       │
│  - Proxies to microservices     │
│  NO NGINX, NO SSL               │
└─────────────────────────────────┘
       │
       ├─► User Service (3001)
       ├─► Prediction Service (3002)
       └─► ML Service (3003)
```

**Key Points:**
- Gateway serves frontend AND acts as API proxy
- Single port (7764) for both frontend and backend
- NO SSL certificates, NO HTTPS listener
- NO NGINX reverse proxy

### V2 Architecture (HTTPS with NGINX)

```
┌─────────────┐
│   Browser   │ Access via https://172.29.156.41:7763
└──────┬──────┘
       │ HTTPS (SSL)
       ▼
┌─────────────────────────────────┐
│  NGINX                          │
│  Port: 7763 (HTTPS)             │
│  - SSL termination              │
│  - Reverse proxy                │
│  - Static file serving          │
└─────────────────────────────────┘
       │ HTTP (internal)
       ▼
┌─────────────────────────────────┐
│  PM2 Microservices              │
│  - Gateway (7764)               │
│  - User (3001)                  │
│  - Prediction (3002)            │
│  - ML (3003)                    │
└─────────────────────────────────┘
```

---

## Root Cause Analysis

### Frontend Protocol Detection

**File**: `frontend/src/config.js` line 8

**Before Fix:**
```javascript
const currentProtocol = window.location.protocol.includes('https') ? 'https' : 'http';
```

**Problem**:
1. User accesses V1 via `https://172.29.156.41:7764` (browser defaults to HTTPS or user types it)
2. `window.location.protocol` returns `'https:'`
3. Frontend sets `currentProtocol = 'https'`
4. Frontend tries `https://172.29.156.41:7763/api/health` (HTTPS port)
5. V1 has NO HTTPS listener → Connection fails with 400 Bad Request

**After Fix:**
```javascript
const currentProtocol = process.env.REACT_APP_FORCE_HTTP === 'true' 
  ? 'http' 
  : (window.location.protocol.includes('https') ? 'https' : 'http');
```

Now:
1. Build-time env var `REACT_APP_FORCE_HTTP=true` forces HTTP
2. Frontend always uses `http://172.29.156.41:7764`
3. Works regardless of browser's initial protocol

---

## Solution Implementation

### 1. Config.js Changes

**File**: `deployments/v1-non-nginx/frontend/src/config.js`

**Lines 6-11** (added):
```javascript
// V1 DEPLOYMENT: Force HTTP-only mode (no NGINX, no SSL)
// V1 runs HTTP on port 7764, V2 runs HTTPS with NGINX on port 7763
const currentProtocol = process.env.REACT_APP_FORCE_HTTP === 'true' 
  ? 'http' 
  : (window.location.protocol.includes('https') ? 'https' : 'http');
```

**Why This Works**:
- `process.env.REACT_APP_FORCE_HTTP` is set during build (not runtime)
- React injects env vars at build time via `npm run build`
- Compiled JavaScript contains hardcoded `'http'` protocol
- No runtime detection needed

### 2. Start Script Changes

**File**: `deployments/v1-non-nginx/start.sh`

**Line 203** (modified):
```bash
# Before:
REACT_APP_DIRECT_API=true REACT_APP_USE_NGINX=false REACT_APP_DIRECT_PROD=true npm run build

# After:
REACT_APP_FORCE_HTTP=true REACT_APP_DIRECT_API=true REACT_APP_USE_NGINX=false REACT_APP_DIRECT_PROD=true npm run build
```

**Comment Added** (line 202):
```bash
# V1 HTTP-only: Force HTTP protocol (no NGINX, no SSL)
```

---

## Testing

### Rebuild Frontend

```bash
cd /var/www/html/HIBAH/deployments/v1-non-nginx/frontend

# Manual build with HTTP enforcement
REACT_APP_FORCE_HTTP=true REACT_APP_DIRECT_API=true REACT_APP_USE_NGINX=false REACT_APP_DIRECT_PROD=true npm run build

cd ..
```

### Restart Services

```bash
cd /var/www/html/HIBAH/deployments/v1-non-nginx
./stop.sh
./start.sh
```

The `start.sh` script will:
1. Check if build is older than 1 hour
2. Rebuild with `REACT_APP_FORCE_HTTP=true` if needed
3. Start gateway with HTTP-only configuration

### Verify Fix

**1. Access Via HTTP Only:**
```
✓ Correct: http://172.29.156.41:7764
✗ Wrong:   https://172.29.156.41:7764
✗ Wrong:   https://172.29.156.41:7763
```

**2. Check Browser Console (F12):**

Open DevTools → Console. Look for config logs:

```javascript
App Configuration: {
  protocol: "http",              // ← Should be "http"
  hostname: "172.29.156.41",
  currentMode: "Direct Production",
  apiUrl: "",                    // ← Empty (same-origin)
  directApiUrl: "http://172.29.156.41:7764"
}

Initial API Base URL: http://172.29.156.41:7764   // ← Should use HTTP
```

**3. Check Network Tab:**

Open DevTools → Network tab. Verify all API requests use HTTP:

```
✓ http://172.29.156.41:7764/api/health           → 200 OK
✓ http://172.29.156.41:7764/api/auth/me          → 200 OK
✓ http://172.29.156.41:7764/api/predict/stats    → 200 OK
```

**4. Test Health Endpoint:**

```bash
# Should return 200 OK
curl http://172.29.156.41:7764/api/health

# Expected response:
{"status":"healthy","timestamp":"2025-11-25T...","services":{"gateway":"running"}}
```

---

## Troubleshooting

### Frontend Still Shows HTTPS Errors

**Problem**: Browser console shows `https://...` requests failing

**Solutions**:
1. **Clear browser cache** (Ctrl+Shift+Delete)
2. **Hard refresh** (Ctrl+Shift+R)
3. **Check build includes env var**:
   ```bash
   cd frontend/build/static/js
   grep -r "REACT_APP_FORCE_HTTP" .
   # Should find the env var check in compiled code
   ```
4. **Verify .env.v1**:
   ```bash
   cat .env.v1 | grep DISABLE_HTTPS
   # Should show: DISABLE_HTTPS=true
   ```
5. **Rebuild frontend manually**:
   ```bash
   cd frontend
   rm -rf build node_modules/.cache
   REACT_APP_FORCE_HTTP=true npm run build
   ```

### Browser Redirects HTTP to HTTPS

**Problem**: Browser automatically upgrades `http://` to `https://`

**Cause**: HSTS (HTTP Strict Transport Security) from previous HTTPS visits

**Solutions**:
1. **Chrome**: 
   - Go to `chrome://net-internals/#hsts`
   - Enter domain: `172.29.156.41`
   - Click "Delete domain security policies"

2. **Firefox**:
   - Type `about:config` in address bar
   - Search: `security.mixed_content.block_active_content`
   - Set to `false` (temporary)

3. **Incognito/Private Mode**:
   - Open incognito window (no HSTS memory)
   - Access `http://172.29.156.41:7764`

4. **Use IP Address** (not hostname):
   - `172.29.156.41:7764` works
   - HSTS typically applies to hostnames, not IPs

### Port 7763 Still Attempted

**Problem**: Frontend tries to connect to port 7763 despite HTTP setting

**Solutions**:
1. **Check no NGINX running**:
   ```bash
   sudo systemctl status nginx
   # Should show: inactive (dead)
   
   sudo lsof -i :7763
   # Should show: (no output - port not in use)
   ```

2. **Verify gateway.js config**:
   ```bash
   grep -n "GATEWAY_PORT\|7763\|7764" microservices/gateway/gateway.js
   # Should use 7764, not 7763
   ```

3. **Check .env.v1**:
   ```bash
   cat .env.v1 | grep PORT
   # Should show: GATEWAY_PORT=7764
   ```

### API Calls Return 404

**Problem**: Endpoints return 404 Not Found

**Cause**: Gateway not serving API routes correctly

**Solutions**:
1. **Check gateway logs**:
   ```bash
   tail -50 logs/gateway.log
   # Look for route registration logs
   ```

2. **Verify services running**:
   ```bash
   ps aux | grep "node.*microservices"
   # Should show gateway, user, prediction, ml processes
   ```

3. **Test direct service**:
   ```bash
   curl http://localhost:3001/api/health  # User service
   curl http://localhost:3002/api/health  # Prediction service
   curl http://localhost:3003/api/health  # ML service
   ```

4. **Restart services**:
   ```bash
   ./stop.sh
   sleep 5
   ./start.sh
   ```

---

## Environment Variable Reference

### V1 Build-Time Variables

```bash
REACT_APP_FORCE_HTTP=true       # Force HTTP protocol (new)
REACT_APP_DIRECT_API=true       # Use same-origin API (existing)
REACT_APP_USE_NGINX=false       # No NGINX proxy (existing)
REACT_APP_DIRECT_PROD=true      # Direct production mode (existing)
```

### V1 Runtime Variables (.env.v1)

```bash
GATEWAY_PORT=7764               # HTTP port
DISABLE_HTTPS=true              # Disable HTTPS in backend
NODE_ENV=production
```

### V2 Build-Time Variables (Comparison)

```bash
# V2 does NOT use REACT_APP_FORCE_HTTP
REACT_APP_DIRECT_API=false      # Use full URL
REACT_APP_USE_NGINX=true        # NGINX proxy enabled
REACT_APP_DIRECT_PROD=false     # PM2 mode
```

### V2 Runtime Variables (.env.v2)

```bash
GATEWAY_PORT=7764               # Internal HTTP port (behind NGINX)
DISABLE_HTTPS=false             # HTTPS enabled via NGINX
NGINX_PORT=7763                 # External HTTPS port
NODE_ENV=production
```

---

## Comparison: V1 vs V2

| Aspect | V1 (HTTP-Only) | V2 (HTTPS with NGINX) |
|--------|----------------|----------------------|
| **Protocol** | HTTP | HTTPS |
| **External Port** | 7764 | 7763 |
| **SSL/TLS** | None | NGINX SSL termination |
| **Frontend Serving** | Gateway (Node.js) | NGINX static serving |
| **Reverse Proxy** | None (direct access) | NGINX |
| **Process Manager** | systemd services | PM2 |
| **Environment Var** | `REACT_APP_FORCE_HTTP=true` | (not used) |
| **Access URL** | `http://172.29.156.41:7764` | `https://172.29.156.41:7763` |
| **Build Command** | `REACT_APP_FORCE_HTTP=true npm run build` | `npm run build` |
| **HSTS** | No | Yes (via NGINX) |
| **Certificate** | Not required | Required (self-signed or CA) |

---

## Related Files

### Modified Files
- `frontend/src/config.js` - Added HTTP enforcement logic
- `start.sh` - Added `REACT_APP_FORCE_HTTP=true` to build command

### Reference Files
- `.env.v1` - Runtime configuration (already has `DISABLE_HTTPS=true`)
- `microservices/gateway/gateway.js` - Gateway service (HTTP-only)
- `frontend/src/services/api.js` - API client (uses config.js protocol)

### Documentation Files
- `README.md` - Updated with HTTP-only access note
- `HTTPS_HTTP_FIX.md` - This file

---

## Summary

**Problem**: V1 frontend tried HTTPS (port 7763) due to browser protocol detection.

**Solution**: Added `REACT_APP_FORCE_HTTP=true` env var to force HTTP protocol during build.

**Result**: Frontend always uses HTTP (port 7764), regardless of browser's initial protocol.

**Action Required**: 
1. Rebuild frontend: `npm run build` (with env var)
2. Restart services: `./stop.sh && ./start.sh`
3. Access via: `http://172.29.156.41:7764` (not HTTPS)

**Testing**: Check browser console shows `protocol: "http"` and network tab shows HTTP requests.
