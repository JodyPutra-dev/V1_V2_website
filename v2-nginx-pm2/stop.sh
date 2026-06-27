#!/bin/bash

###############################################################################
# VERSION 2 (NGINX+PM2 OPTIMIZED) SHUTDOWN SCRIPT
###############################################################################
# Gracefully stops PM2 cluster and optionally stops NGINX
###############################################################################

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Stopping Version 2 (NGINX+PM2 Optimized)               ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

###############################################################################
# Stop PM2 Cluster
###############################################################################
echo -e "${BLUE}Stopping PM2 cluster...${NC}"

# Check if PM2 processes are running
if pm2 list | grep -q "urine"; then
  echo -e "${YELLOW}Stopping all PM2 instances...${NC}"
  
  # Stop processes gracefully
  pm2 stop ecosystem.config.js
  sleep 3
  
  # Delete processes from PM2
  pm2 delete ecosystem.config.js
  
  echo -e "${GREEN}✓ PM2 cluster stopped and deleted${NC}"
  
  # Show remaining processes
  echo -e "${BLUE}Remaining PM2 processes:${NC}"
  pm2 list
else
  echo -e "${YELLOW}⚠ No PM2 processes found for this deployment${NC}"
fi

echo ""

###############################################################################
# Verify Ports Released
###############################################################################
echo -e "${BLUE}Verifying ports are released...${NC}"

PORTS=("7764" "7765" "3001" "3002" "3003" "3004" "3005")
PORTS_IN_USE=()

for PORT in "${PORTS[@]}"; do
  if lsof -i :$PORT > /dev/null 2>&1; then
    PORTS_IN_USE+=($PORT)
    echo -e "${RED}✗ Port $PORT still in use${NC}"
    lsof -i :$PORT | tail -n +2
  else
    echo -e "${GREEN}✓ Port $PORT released${NC}"
  fi
done

if [ ${#PORTS_IN_USE[@]} -gt 0 ]; then
  echo -e "${YELLOW}⚠ Some ports are still in use. You may need to manually kill processes.${NC}"
else
  echo -e "${GREEN}✓ All ports released successfully${NC}"
fi

echo ""

###############################################################################
# Stop NGINX (Optional)
###############################################################################
echo -e "${BLUE}NGINX Management:${NC}"
echo -e "${YELLOW}Do you want to stop NGINX? (y/N):${NC}"
read -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
  if systemctl is-active --quiet nginx; then
    echo -e "${YELLOW}Stopping NGINX...${NC}"
    sudo systemctl stop nginx
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}✓ NGINX stopped${NC}"
    else
      echo -e "${RED}✗ Failed to stop NGINX${NC}"
      sudo systemctl status nginx
    fi
  else
    echo -e "${YELLOW}⚠ NGINX is not running${NC}"
  fi
else
  echo -e "${BLUE}ℹ NGINX left running${NC}"
  echo -e "${YELLOW}  To reload NGINX config: sudo systemctl reload nginx${NC}"
  echo -e "${YELLOW}  To stop NGINX manually: sudo systemctl stop nginx${NC}"
fi

echo ""

###############################################################################
# Optional Cleanup
###############################################################################
echo -e "${BLUE}Cleanup Options:${NC}"

# Clean log files
echo -e "${YELLOW}Clean up log files? (y/N):${NC}"
read -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
  if [ -d "logs" ]; then
    echo -e "${YELLOW}Removing log files...${NC}"
    rm -f logs/*.log
    echo -e "${GREEN}✓ Log files cleaned${NC}"
  else
    echo -e "${YELLOW}⚠ logs/ directory not found${NC}"
  fi
fi

# Clean temporary files
echo -e "${YELLOW}Clean up temporary files? (y/N):${NC}"
read -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
  if [ -d "tmp" ]; then
    echo -e "${YELLOW}Removing temporary files...${NC}"
    rm -f tmp/*
    echo -e "${GREEN}✓ Temporary files cleaned${NC}"
  else
    echo -e "${YELLOW}⚠ tmp/ directory not found${NC}"
  fi
fi

echo ""

###############################################################################
# Success Summary
###############################################################################
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ Version 2 (NGINX+PM2 Optimized) Stopped Successfully! ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}📊 Stopped Services:${NC}"
echo -e "   PM2 Cluster: 9 instances stopped and deleted"
echo -e "   Gateway: 2 instances (ports 7764-7765)"
echo -e "   User: 2 instances (ports 3001-3002)"
echo -e "   Prediction: 2 instances (ports 3004-3005)"
echo -e "   ML: 2 instances (ports 3002-3003)"
echo -e "   Admin: 1 instance (port 3003)"

if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo -e "   NGINX: Stopped"
else
  echo -e "   NGINX: Still running"
fi

echo ""
echo -e "${BLUE}🔧 Management:${NC}"
echo -e "   To restart: ./start.sh"
echo -e "   To check PM2: pm2 list"
echo -e "   To check NGINX: sudo systemctl status nginx"
echo ""
echo -e "${GREEN}✓ Shutdown complete!${NC}"
