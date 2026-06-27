#!/bin/bash

###############################################################################
# VERSION 1 (NON-NGINX BASELINE) SHUTDOWN SCRIPT
###############################################################################
# Gracefully stops all Version 1 services
# V1 runs on both HTTP (7764) and HTTPS (7763) ports
###############################################################################

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Stopping Version 1 (Non-NGINX Baseline)                ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

###############################################################################
# Stop Services by PID
###############################################################################

STOPPED_SERVICES=()

# Function to stop a service
stop_service() {
  local service_name=$1
  local pid_file="logs/${service_name}.pid"
  
  if [ ! -f "$pid_file" ]; then
    echo -e "${YELLOW}⚠  ${service_name}: PID file not found${NC}"
    return
  fi
  
  local PID=$(cat "$pid_file")
  
  if ! ps -p $PID > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠  ${service_name}: Not running (PID: $PID)${NC}"
    rm "$pid_file"
    return
  fi
  
  echo -e "${YELLOW}Stopping ${service_name} (PID: $PID)...${NC}"
  
  # Send SIGTERM for graceful shutdown
  kill -TERM $PID 2>/dev/null || true
  
  # Wait up to 30 seconds for process to exit
  local wait_count=0
  while ps -p $PID > /dev/null 2>&1 && [ $wait_count -lt 30 ]; do
    sleep 1
    wait_count=$((wait_count + 1))
  done
  
  # If still running, force kill
  if ps -p $PID > /dev/null 2>&1; then
    echo -e "${RED}  ${service_name} did not stop gracefully, forcing...${NC}"
    kill -9 $PID 2>/dev/null || true
    sleep 1
  fi
  
  # Verify stopped
  if ! ps -p $PID > /dev/null 2>&1; then
    echo -e "${GREEN}✓ ${service_name} stopped (PID: $PID)${NC}"
    STOPPED_SERVICES+=("${service_name} (PID: $PID)")
    rm "$pid_file"
  else
    echo -e "${RED}✗ ${service_name} could not be stopped${NC}"
  fi
}

# Stop all services
stop_service "gateway"
stop_service "user"
stop_service "admin"
stop_service "ml"
stop_service "prediction"

echo ""

###############################################################################
# Verify Ports Released
###############################################################################
echo -e "${BLUE}Verifying ports are released...${NC}"

check_port() {
  local port=$1
  local service=$2
  
  if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠  Port $port ($service) is still in use${NC}"
    echo -e "${YELLOW}  Process: $(lsof -Pi :$port -sTCP:LISTEN | tail -n 1)${NC}"
  else
    echo -e "${GREEN}✓ Port $port ($service) is free${NC}"
  fi
}

check_port 7764 "Gateway"
check_port 3001 "User"
check_port 3003 "Admin"
check_port 3002 "ML"
check_port 3004 "Prediction"

echo ""

###############################################################################
# Optional Cleanup
###############################################################################
read -p "Clean up log files? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  rm -f logs/*.log
  echo -e "${GREEN}✓ Log files removed${NC}"
else
  echo -e "${BLUE}Log files kept in logs/ directory${NC}"
fi

read -p "Clean up temporary files? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  rm -rf tmp/*
  echo -e "${GREEN}✓ Temporary files removed${NC}"
else
  echo -e "${BLUE}Temporary files kept in tmp/ directory${NC}"
fi

###############################################################################
# Summary
###############################################################################
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ Version 1 Services Stopped                            ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ ${#STOPPED_SERVICES[@]} -gt 0 ]; then
  echo -e "${BLUE}Stopped Services:${NC}"
  for service in "${STOPPED_SERVICES[@]}"; do
    echo -e "   ${service}"
  done
else
  echo -e "${YELLOW}No services were running${NC}"
fi

echo ""
echo -e "${BLUE}Ports Released:${NC}"
echo -e "   7764 (Gateway)"
echo -e "   3001 (User)"
echo -e "   3003 (Admin)"
echo -e "   3002 (ML)"
echo -e "   3004 (Prediction)"
echo ""
echo -e "${BLUE}💡 To restart:${NC}"
echo -e "   ./start.sh"
echo ""
