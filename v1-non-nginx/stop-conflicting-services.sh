#!/bin/bash

###############################################################################
# Stop Conflicting Services on Port 7763
###############################################################################
# Automatically stops all services that might be using port 7763
# Run before starting V1 to ensure HTTPS server can bind to port
###############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Stop Conflicting Services on Port 7763                ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Safety check: Don't stop V1 itself if it's running
V1_RUNNING=false
if [ -f "logs/gateway.pid" ]; then
    V1_PID=$(cat logs/gateway.pid)
    if ps -p "$V1_PID" > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  V1 is currently running (PID: $V1_PID)${NC}"
        echo -e "${YELLOW}   This script will NOT stop V1 services${NC}"
        echo ""
        V1_RUNNING=true
    fi
fi

STOPPED_SOMETHING=false

###############################################################################
# 1. Check what's using port 7763
###############################################################################
echo -e "${BLUE}[1/5] Checking port 7763 usage...${NC}"

if sudo lsof -ti:7763 > /dev/null 2>&1; then
    echo -e "${YELLOW}   Port 7763 is in use:${NC}"
    sudo lsof -i :7763
    echo ""
else
    echo -e "${GREEN}   ✓ Port 7763 is free${NC}"
    echo ""
    echo -e "${GREEN}No conflicting services found. Port 7763 is available.${NC}"
    exit 0
fi

###############################################################################
# 2. Stop PM2 processes (V2 deployment)
###############################################################################
echo -e "${BLUE}[2/5] Checking PM2 processes...${NC}"

if command -v pm2 > /dev/null 2>&1; then
    PM2_PROCESSES=$(pm2 list | grep -c "online" || true)
    
    if [ "$PM2_PROCESSES" -gt 0 ]; then
        echo -e "${YELLOW}   Found $PM2_PROCESSES PM2 process(es) running${NC}"
        pm2 list
        echo ""
        
        # Stop PM2 processes
        echo -e "${YELLOW}   Stopping PM2 processes...${NC}"
        pm2 stop all > /dev/null 2>&1 || true
        pm2 delete all > /dev/null 2>&1 || true
        
        echo -e "${GREEN}   ✓ PM2 processes stopped${NC}"
        STOPPED_SOMETHING=true
    else
        echo -e "${GREEN}   ✓ No PM2 processes found${NC}"
    fi
else
    echo -e "${GREEN}   ✓ PM2 not installed${NC}"
fi
echo ""

###############################################################################
# 3. Stop systemd services (main codebase)
###############################################################################
echo -e "${BLUE}[3/5] Checking systemd services...${NC}"

SYSTEMD_SERVICES=(
    "urine-gateway"
    "urine-ml"
    "urine-user"
    "urine-prediction"
    "urine-admin"
)

SYSTEMD_STOPPED=0

for service in "${SYSTEMD_SERVICES[@]}"; do
    if systemctl is-active --quiet "$service" 2>/dev/null; then
        echo -e "${YELLOW}   Stopping $service...${NC}"
        sudo systemctl stop "$service" || true
        SYSTEMD_STOPPED=$((SYSTEMD_STOPPED + 1))
        STOPPED_SOMETHING=true
    fi
done

if [ $SYSTEMD_STOPPED -gt 0 ]; then
    echo -e "${GREEN}   ✓ Stopped $SYSTEMD_STOPPED systemd service(s)${NC}"
else
    echo -e "${GREEN}   ✓ No systemd services found${NC}"
fi
echo ""

###############################################################################
# 4. Stop NGINX (if using port 7763)
###############################################################################
echo -e "${BLUE}[4/5] Checking NGINX...${NC}"

if command -v nginx > /dev/null 2>&1; then
    if systemctl is-active --quiet nginx 2>/dev/null; then
        # Check if NGINX is listening on 7763
        if sudo lsof -i :7763 | grep -q nginx; then
            echo -e "${YELLOW}   NGINX is using port 7763${NC}"
            echo -e "${YELLOW}   Stopping NGINX...${NC}"
            sudo systemctl stop nginx
            echo -e "${GREEN}   ✓ NGINX stopped${NC}"
            STOPPED_SOMETHING=true
        else
            echo -e "${GREEN}   ✓ NGINX running but not on port 7763${NC}"
        fi
    else
        echo -e "${GREEN}   ✓ NGINX not running${NC}"
    fi
else
    echo -e "${GREEN}   ✓ NGINX not installed${NC}"
fi
echo ""

###############################################################################
# 5. Kill remaining processes on port 7763
###############################################################################
echo -e "${BLUE}[5/5] Checking for remaining processes on port 7763...${NC}"

sleep 2  # Wait for services to fully stop

if sudo lsof -ti:7763 > /dev/null 2>&1; then
    echo -e "${YELLOW}   Found remaining process(es) on port 7763:${NC}"
    sudo lsof -i :7763
    echo ""
    
    # Get PIDs
    PIDS=$(sudo lsof -ti:7763)
    
    # Safety check: Don't kill V1 gateway
    for pid in $PIDS; do
        if [ "$V1_RUNNING" = true ] && [ "$pid" = "$V1_PID" ]; then
            echo -e "${YELLOW}   Skipping V1 gateway (PID: $pid)${NC}"
            continue
        fi
        
        # Get process name for logging
        PROCESS_NAME=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
        
        echo -e "${YELLOW}   Killing process $pid ($PROCESS_NAME)...${NC}"
        sudo kill -9 "$pid" 2>/dev/null || true
        STOPPED_SOMETHING=true
    done
    
    echo -e "${GREEN}   ✓ Remaining processes terminated${NC}"
else
    echo -e "${GREEN}   ✓ No remaining processes on port 7763${NC}"
fi
echo ""

###############################################################################
# Final Verification
###############################################################################
echo -e "${BLUE}Verifying port 7763 is free...${NC}"
sleep 2

if sudo lsof -ti:7763 > /dev/null 2>&1; then
    echo -e "${RED}✗ ERROR: Port 7763 is still in use:${NC}"
    sudo lsof -i :7763
    echo ""
    echo -e "${YELLOW}Manual intervention required:${NC}"
    echo "  sudo lsof -ti:7763 | xargs sudo kill -9"
    exit 1
else
    echo -e "${GREEN}✓ Port 7763 is now free${NC}"
fi

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
if [ "$STOPPED_SOMETHING" = true ]; then
    echo -e "${GREEN}║  ✓ Conflicting services stopped successfully             ║${NC}"
else
    echo -e "${GREEN}║  ✓ No conflicting services were running                  ║${NC}"
fi
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}You can now start V1 with: ./start.sh${NC}"
echo ""
