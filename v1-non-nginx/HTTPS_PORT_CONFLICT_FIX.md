# HTTPS Port 7763 Conflict Fix

## Issue Overview

**Problem**: V1 gateway fails to start with error: `Error: listen EADDRINUSE: address already in use :::7763`

**Root Cause**: Port 7763 is already occupied by another service (V2 deployment, main codebase systemd services, or PM2 processes).

**Impact**: V1 HTTPS server cannot start, only HTTP on port 7764 is available.

---

## Diagnostic Commands

### 1. Check What's Using Port 7763

```bash
# Method 1: netstat (shows PID and program name)
sudo netstat -tlnp | grep 7763

# Method 2: lsof (more detailed)
sudo lsof -i :7763

# Method 3: ss (modern alternative to netstat)
sudo ss -tlnp | grep 7763
```

**Expected Output (if port is in use):**
```
tcp6  0  0  :::7763  :::*  LISTEN  12345/node
```

The PID (12345 in example) identifies the process.

### 2. Identify the Process

```bash
# Get full process details by PID
ps aux | grep 12345

# Check if it's PM2
pm2 list

# Check if it's systemd service
systemctl status urine-gateway
systemctl status urine-ml
systemctl status urine-user
systemctl status urine-prediction
systemctl status urine-admin

# Check for any node processes
ps aux | grep node | grep 7763
```

### 3. Check V2 Deployment Status

```bash
cd /var/www/html/HIBAH/deployments/v2-nginx-pm2

# Check if V2 is running
pm2 list
# Look for: gateway, user, prediction, ml, admin services

# Check NGINX
sudo systemctl status nginx
sudo nginx -t  # Test config
```

---

## Solution: Stop Conflicting Services

### Option 1: Automated Script (Recommended)

```bash
cd /var/www/html/HIBAH/deployments/v1-non-nginx
./stop-conflicting-services.sh
```

This script automatically stops:
- PM2 processes on port 7763
- Systemd services using port 7763
- Any direct node processes on port 7763

### Option 2: Manual Shutdown

#### Stop V2 Deployment

```bash
cd /var/www/html/HIBAH/deployments/v2-nginx-pm2
sudo ./stop.sh

# Verify PM2 stopped
pm2 list
# Should show: "No processes found"

# Stop NGINX if running
sudo systemctl stop nginx
```

#### Stop Main Codebase Systemd Services

```bash
# Stop all urine-* services
sudo systemctl stop urine-gateway
sudo systemctl stop urine-ml
sudo systemctl stop urine-user
sudo systemctl stop urine-prediction
sudo systemctl stop urine-admin

# Verify stopped
systemctl status urine-gateway
# Should show: "inactive (dead)"
```

#### Kill Direct Node Processes

```bash
# Find PID
sudo lsof -ti:7763

# Kill process (replace PID)
sudo kill -9 <PID>

# Or kill all node processes on 7763
sudo lsof -ti:7763 | xargs sudo kill -9
```

### Option 3: Use Alternative Port for V1

If you need both V1 and V2 running simultaneously:

1. **Modify V1 to use port 7765:**

```bash
# Edit .env.v1
echo "HTTPS_PORT=7765" >> .env.v1

# Edit gateway.js (or use env var)
# Change: const HTTPS_PORT = process.env.HTTPS_PORT || 7765;
```

2. **Update frontend config:**

```bash
# Edit frontend/src/config.js
# Update: https: 7765 in ports.gateway object
```

3. **Rebuild frontend:**

```bash
cd frontend
npm run build
cd ..
```

---

## Verification

### 1. Confirm Port is Free

```bash
# Should return nothing if port is free
sudo lsof -i :7763
sudo netstat -tlnp | grep 7763
```

### 2. Start V1 and Verify

```bash
cd /var/www/html/HIBAH/deployments/v1-non-nginx
./start.sh

# Check gateway logs
tail -f logs/gateway.log
# Should see: "HTTPS server listening on port 7763"

# Test HTTPS endpoint
curl -k https://localhost:7763/api/health
# Expected: {"status":"healthy",...}
```

### 3. Check Running Services

```bash
# V1 processes
ps aux | grep "node.*microservices"

# Port usage
sudo lsof -i :7763
sudo lsof -i :7764
```

---

## Decision Tree

```
Is port 7763 in use?
├─ YES → What's using it?
│   ├─ V2 Deployment (PM2)
│   │   └─ Action: cd v2-nginx-pm2 && sudo ./stop.sh
│   ├─ Main Systemd Services
│   │   └─ Action: sudo systemctl stop urine-*
│   ├─ Direct Node Process
│   │   └─ Action: sudo kill -9 <PID>
│   └─ Unknown Process
│       └─ Action: sudo lsof -i :7763 to identify, then stop
└─ NO → Proceed with V1 startup
    └─ Action: ./start.sh
```

---

## Sequential Testing Strategy

If you need to test both V1 and V2:

### Test V1 First

```bash
# Stop V2
cd /var/www/html/HIBAH/deployments/v2-nginx-pm2
sudo ./stop.sh

# Start V1
cd /var/www/html/HIBAH/deployments/v1-non-nginx
./start.sh

# Run V1 tests (CSV upload, Dashboard, Profile, etc.)

# Stop V1
./stop.sh
```

### Then Test V2

```bash
# V1 should be stopped first
cd /var/www/html/HIBAH/deployments/v1-non-nginx
./stop.sh

# Start V2
cd /var/www/html/HIBAH/deployments/v2-nginx-pm2
sudo ./start.sh

# Run V2 tests

# Stop V2
sudo ./stop.sh
```

---

## Common Scenarios

### Scenario 1: V2 Was Running

**Symptoms:**
- Port 7763 conflict
- `pm2 list` shows gateway, ml, user services

**Solution:**
```bash
cd /var/www/html/HIBAH/deployments/v2-nginx-pm2
sudo ./stop.sh
pm2 delete all  # If stop.sh doesn't clear PM2
```

### Scenario 2: Systemd Services from Main Codebase

**Symptoms:**
- Port 7763 conflict
- `systemctl status urine-gateway` shows "active (running)"

**Solution:**
```bash
sudo systemctl stop urine-gateway urine-ml urine-user urine-prediction urine-admin
sudo systemctl disable urine-gateway urine-ml urine-user urine-prediction urine-admin
```

### Scenario 3: Orphaned Node Process

**Symptoms:**
- Port 7763 conflict
- `ps aux | grep node` shows node process but not PM2 or systemd

**Solution:**
```bash
sudo lsof -ti:7763 | xargs sudo kill -9
```

### Scenario 4: NGINX Holding Port

**Symptoms:**
- Port 7763 conflict
- `sudo lsof -i :7763` shows nginx process

**Solution:**
```bash
sudo systemctl stop nginx
# Or if NGINX needed for other services:
sudo nano /etc/nginx/sites-available/urine-disease-detection
# Comment out listen 7763 ssl;
sudo nginx -t
sudo systemctl reload nginx
```

---

## Prevention

### Add to V1 start.sh

Add port conflict check before starting services:

```bash
# Check if port 7763 is in use
if sudo lsof -ti:7763 > /dev/null 2>&1; then
    echo "⚠️  ERROR: Port 7763 is already in use"
    echo ""
    sudo lsof -i :7763
    echo ""
    echo "Run: ./stop-conflicting-services.sh"
    echo "Or manually stop the service above"
    exit 1
fi
```

### Add to V2 start.sh

Similarly, check if V1 is using port 7763.

---

## Troubleshooting

### Port Still Occupied After Stopping Services

```bash
# Wait a few seconds for port to release
sleep 5

# Check again
sudo lsof -i :7763

# If still occupied, force kill
sudo lsof -ti:7763 | xargs sudo kill -9

# Check TIME_WAIT connections
sudo netstat -anp | grep 7763 | grep TIME_WAIT
# These will clear automatically in 60 seconds
```

### Gateway Starts But HTTPS Not Working

```bash
# Check gateway logs
tail -f logs/gateway.log | grep -i https
# Should see: "HTTPS server listening on port 7763"

# Test locally
curl -k https://localhost:7763/api/health

# Check firewall
sudo ufw status
sudo ufw allow 7763/tcp
```

### SSL Certificate Issues

```bash
# Verify certificates exist
ls -la ssl/localhost.key ssl/localhost.crt

# If missing, regenerate
cd ../../ssl
./generate-certs.sh
cd ../deployments/v1-non-nginx
```

---

## Related Documentation

- **stop-conflicting-services.sh**: Automated script to clear port 7763
- **V1_HTTPS_SETUP.md**: HTTPS configuration guide
- **start.sh**: V1 startup script (now includes port conflict check)
- **V2 README**: V2 deployment guide (uses same port)

---

## Summary

**Problem**: Port 7763 conflict prevents V1 HTTPS startup

**Solution**: Stop conflicting services (V2, systemd, orphaned processes)

**Verification**: `sudo lsof -i :7763` returns nothing, `curl -k https://localhost:7763/api/health` succeeds

**Prevention**: Use `./stop-conflicting-services.sh` before starting V1, or run V1/V2 sequentially
