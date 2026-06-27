#!/bin/bash

###############################################################################
# VERSION 1 (NON-NGINX BASELINE) STARTUP SCRIPT
###############################################################################
# Starts all services using direct Node.js execution (no PM2, no systemd)
# This demonstrates a typical Node.js deployment without process management
###############################################################################

set -e

# Load nvm node into PATH if not already available (handles sudo invocation)
if ! command -v node &> /dev/null; then
  NVM_NODE_DIR="$(ls -d /root/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
  if [ -n "$NVM_NODE_DIR" ]; then
    export PATH="$NVM_NODE_DIR:$PATH"
  fi
fi

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Starting Version 1 (Non-NGINX Baseline)                ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Load environment variables
if [ -f .env.v1 ]; then
  set -a; source .env.v1; set +a
  echo -e "${GREEN}✓ Environment variables loaded from .env.v1${NC}"
else
  echo -e "${YELLOW}⚠ .env.v1 not found, using defaults${NC}"
fi

# Display configuration
echo -e "${BLUE}Configuration:${NC}"
echo -e "  Deployment Version: ${DEPLOYMENT_VERSION:-V1-NON-NGINX-BASELINE}"
echo -e "  Gateway Port: ${GATEWAY_PORT:-7764}"
echo -e "  MongoDB: ${MONGODB_URI%%\?*}..." # Show URI without password
echo -e "  Request Queue: ${DISABLE_REQUEST_QUEUE:-true} (Disabled for V1)"
echo ""

###############################################################################
# Prerequisites Check
###############################################################################
echo -e "${BLUE}Checking prerequisites...${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Node.js is not installed${NC}"
  echo -e "${YELLOW}  Install: sudo apt-get install nodejs${NC}"
  exit 1
fi
NODE_VERSION=$(node --version)
echo -e "${GREEN}✓ Node.js installed: ${NODE_VERSION}${NC}"

# Check MongoDB accessibility
if command -v mongosh &> /dev/null; then
  if mongosh --eval "db.runCommand({ ping: 1 })" ${MONGODB_URI} &> /dev/null; then
    echo -e "${GREEN}✓ MongoDB is accessible${NC}"
  else
    echo -e "${RED}✗ MongoDB is not accessible${NC}"
    echo -e "${YELLOW}  Check MONGODB_URI in .env.v1${NC}"
    exit 1
  fi
elif command -v mongo &> /dev/null; then
  if mongo --eval "db.runCommand({ ping: 1 })" ${MONGODB_URI} &> /dev/null; then
    echo -e "${GREEN}✓ MongoDB is accessible${NC}"
  else
    echo -e "${RED}✗ MongoDB is not accessible${NC}"
    exit 1
  fi
else
  echo -e "${YELLOW}⚠ MongoDB client not found, skipping connectivity check${NC}"
fi

# Check Python
if ! command -v python3 &> /dev/null; then
  echo -e "${RED}✗ Python 3 is not installed${NC}"
  echo -e "${YELLOW}  Install: sudo apt-get install python3${NC}"
  exit 1
fi
PYTHON_VERSION=$(python3 --version)
echo -e "${GREEN}✓ Python installed: ${PYTHON_VERSION}${NC}"

# Check port 7763 availability (HTTPS gateway port)
echo -e "${BLUE}Checking port availability...${NC}"
if command -v lsof &> /dev/null; then
  if sudo lsof -ti:7763 > /dev/null 2>&1; then
    echo -e "${RED}✗ ERROR: Port 7763 is already in use${NC}"
    echo ""
    echo -e "${YELLOW}Process using port 7763:${NC}"
    sudo lsof -i :7763
    echo ""
    echo -e "${YELLOW}Solutions:${NC}"
    echo -e "${YELLOW}  1. Automated: ./stop-conflicting-services.sh${NC}"
    echo -e "${YELLOW}  2. Manual: Stop V2 deployment (cd ../v2-nginx-pm2 && sudo ./stop.sh)${NC}"
    echo -e "${YELLOW}  3. Manual: Stop systemd services (sudo systemctl stop urine-*)${NC}"
    echo -e "${YELLOW}  4. Force kill: sudo lsof -ti:7763 | xargs sudo kill -9${NC}"
    echo ""
    echo -e "${YELLOW}See HTTPS_PORT_CONFLICT_FIX.md for detailed troubleshooting${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ Port 7763 is available${NC}"
else
  echo -e "${YELLOW}⚠ lsof not found, skipping port conflict check${NC}"
fi

# Setup Python virtual environment and install dependencies
echo ""
echo -e "${BLUE}Setting up Python virtual environment...${NC}"

VENV_DIR="venv"

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
  echo -e "${BLUE}  Creating virtual environment: $VENV_DIR${NC}"
  if python3 -m venv "$VENV_DIR" > logs/venv_setup.log 2>&1; then
    echo -e "${GREEN}✓ Virtual environment created${NC}"
  else
    echo -e "${RED}✗ Failed to create virtual environment${NC}"
    echo -e "${YELLOW}  Check logs/venv_setup.log for details${NC}"
    echo -e "${YELLOW}  Install python3-venv: sudo apt-get install python3-venv${NC}"
    exit 1
  fi
else
  echo -e "${GREEN}✓ Virtual environment exists: $VENV_DIR${NC}"
fi

# Activate virtual environment
source "$VENV_DIR/bin/activate"
echo -e "${GREEN}✓ Virtual environment activated${NC}"

# Install Python dependencies
echo ""
echo -e "${BLUE}Installing Python dependencies...${NC}"
if [ -f "requirements.txt" ]; then
  # Create logs directory if it doesn't exist
  mkdir -p logs
  
  # Install dependencies with logging
  echo -e "${BLUE}  Running: pip install --quiet --upgrade -r requirements.txt${NC}"
  if pip install --quiet --upgrade -r requirements.txt > logs/python_deps_install.log 2>&1; then
    echo -e "${GREEN}✓ Python dependencies installed successfully${NC}"
    echo -e "${BLUE}  Installed: joblib, scikit-learn, numpy, pandas${NC}"
  else
    echo -e "${RED}✗ Failed to install Python dependencies${NC}"
    echo -e "${YELLOW}  Check logs/python_deps_install.log for details${NC}"
    echo -e "${YELLOW}  Manual installation: source venv/bin/activate && pip install -r requirements.txt${NC}"
    exit 1
  fi
else
  echo -e "${YELLOW}⚠ requirements.txt not found${NC}"
  echo -e "${YELLOW}  Manual installation required: source venv/bin/activate && pip install scikit-learn joblib numpy pandas${NC}"
fi

# Verify MODEL-ML symlink
echo ""
echo -e "${BLUE}Verifying ML model setup...${NC}"
if [ ! -L "MODEL-ML" ]; then
  echo -e "${RED}✗ MODEL-ML symlink not found${NC}"
  echo -e "${YELLOW}  Create symlink: ln -s ../../MODEL-ML MODEL-ML${NC}"
  exit 1
else
  SYMLINK_TARGET=$(readlink -f MODEL-ML)
  echo -e "${GREEN}✓ MODEL-ML symlink exists${NC}"
  echo -e "${BLUE}  Target: ${SYMLINK_TARGET}${NC}"
  
  if [ ! -d "$SYMLINK_TARGET" ]; then
    echo -e "${RED}✗ Symlink target does not exist: ${SYMLINK_TARGET}${NC}"
    exit 1
  fi
fi

# Check ML model file
MODEL_FILE="./MODEL-ML/joblib/kidney_stone_model/kidney_stone_model.joblib"
MODEL_FILE_ABS="$(readlink -f MODEL-ML)/joblib/kidney_stone_model/kidney_stone_model.joblib"
if [ -f "$MODEL_FILE" ]; then
  MODEL_SIZE=$(stat -f%z "$MODEL_FILE" 2>/dev/null || stat -c%s "$MODEL_FILE" 2>/dev/null)
  if [ "$MODEL_SIZE" -gt 1024 ]; then
    echo -e "${GREEN}✓ ML model found: $MODEL_FILE ($(numfmt --to=iec-i --suffix=B $MODEL_SIZE 2>/dev/null || echo ${MODEL_SIZE} bytes))${NC}"
  else
    echo -e "${RED}✗ ML model file is too small (possibly corrupted): ${MODEL_SIZE} bytes${NC}"
    exit 1
  fi
else
  echo -e "${RED}✗ ML model not found${NC}"
  echo -e "${YELLOW}  Relative path: $MODEL_FILE${NC}"
  echo -e "${YELLOW}  Absolute path: $MODEL_FILE_ABS${NC}"
  echo -e "${YELLOW}  Ensure MODEL-ML symlink points to correct location${NC}"
  echo -e "${YELLOW}  See README.md 'Step 5: Verify ML Model Exists' for setup instructions${NC}"
  exit 1
fi

# Check ports availability
for port in ${GATEWAY_PORT:-7764} ${USER_SERVICE_PORT:-3001} ${ADMIN_SERVICE_PORT:-3003} ${ML_SERVICE_PORT:-3002} ${PREDICTION_SERVICE_PORT:-3004}; do
  if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Port $port is already in use${NC}"
    echo -e "${YELLOW}  Process: $(lsof -Pi :$port -sTCP:LISTEN | tail -n 1)${NC}"
    echo -e "${YELLOW}  Stop existing service or use different port${NC}"
    exit 1
  fi
done
echo -e "${GREEN}✓ All required ports are available${NC}"

echo ""

###############################################################################
# Create Required Directories
###############################################################################
echo -e "${BLUE}Creating required directories...${NC}"
mkdir -p logs tmp uploads/profiles uploads/csv uploads/temp
echo -e "${GREEN}✓ Directories created${NC}"
echo ""

###############################################################################
# Build Frontend
###############################################################################
echo -e "${BLUE}Checking frontend build...${NC}"
if [ -d "frontend/build" ] && [ -n "$(find frontend/build -mmin -60 2>/dev/null)" ]; then
  echo -e "${GREEN}✓ Frontend build is recent (< 1 hour old)${NC}"
else
  echo -e "${YELLOW}⚠ Frontend build not found or outdated, building...${NC}"
  cd frontend
  if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}  Installing frontend dependencies...${NC}"
    npm install
  fi
  # V1 HTTPS enabled: Direct Node.js SSL server on port 7763
  REACT_APP_DIRECT_API=true REACT_APP_USE_NGINX=false REACT_APP_DIRECT_PROD=true npm run build
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Frontend built successfully${NC}"
  else
    echo -e "${RED}✗ Frontend build failed${NC}"
    exit 1
  fi
  cd ..
fi
echo ""

###############################################################################
# Start Backend Services
###############################################################################
echo -e "${BLUE}Starting backend services...${NC}"
echo ""

# Start Gateway
echo -e "${YELLOW}Starting Gateway (port ${GATEWAY_PORT:-7764})...${NC}"
nohup node microservices/gateway/gateway.js > logs/gateway.log 2>&1 &
GATEWAY_PID=$!
echo $GATEWAY_PID > logs/gateway.pid
echo -e "${GREEN}✓ Gateway started (PID: $GATEWAY_PID)${NC}"

# Start User Service
echo -e "${YELLOW}Starting User Service (port ${USER_SERVICE_PORT:-3001})...${NC}"
nohup node microservices/user/user-service.js > logs/user.log 2>&1 &
USER_PID=$!
echo $USER_PID > logs/user.pid
echo -e "${GREEN}✓ User Service started (PID: $USER_PID)${NC}"

# Start Admin Service
echo -e "${YELLOW}Starting Admin Service (port ${ADMIN_SERVICE_PORT:-3003})...${NC}"
nohup node microservices/admin/admin-service.js > logs/admin.log 2>&1 &
ADMIN_PID=$!
echo $ADMIN_PID > logs/admin.pid
echo -e "${GREEN}✓ Admin Service started (PID: $ADMIN_PID)${NC}"

# Start ML Service
echo -e "${YELLOW}Starting ML Service (port ${ML_SERVICE_PORT:-3002})...${NC}"
nohup node microservices/ml/ml-service.js > logs/ml.log 2>&1 &
ML_PID=$!
echo $ML_PID > logs/ml.pid
echo -e "${GREEN}✓ ML Service started (PID: $ML_PID)${NC}"

# Start Prediction Service
echo -e "${YELLOW}Starting Prediction Service (port ${PREDICTION_SERVICE_PORT:-3004})...${NC}"
nohup node microservices/prediction/prediction-service.js > logs/prediction.log 2>&1 &
PREDICTION_PID=$!
echo $PREDICTION_PID > logs/prediction.pid
echo -e "${GREEN}✓ Prediction Service started (PID: $PREDICTION_PID)${NC}"

echo ""
echo -e "${BLUE}Waiting for services to initialize (10 seconds)...${NC}"
sleep 10

###############################################################################
# Health Check
###############################################################################
echo ""
echo -e "${BLUE}Performing health checks...${NC}"

# Gateway health check
HEALTH_FAILURES=0
if curl -sf http://localhost:${GATEWAY_PORT:-7764}/api/health > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Gateway: Healthy${NC}"
else
  echo -e "${RED}✗ Gateway: Not responding${NC}"
  echo -e "${YELLOW}  Check logs: tail -f logs/gateway.log${NC}"
  HEALTH_FAILURES=$((HEALTH_FAILURES+1))
fi

# User Service health check
if curl -sf http://localhost:${USER_SERVICE_PORT:-3001}/health > /dev/null 2>&1; then
  echo -e "${GREEN}✓ User Service: Healthy${NC}"
else
  echo -e "${RED}✗ User Service: Not responding${NC}"
  echo -e "${YELLOW}  Check logs: tail -f logs/user.log${NC}"
  HEALTH_FAILURES=$((HEALTH_FAILURES+1))
fi

# Admin Service health check
if curl -sf http://localhost:${ADMIN_SERVICE_PORT:-3003}/health > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Admin Service: Healthy${NC}"
else
  echo -e "${RED}✗ Admin Service: Not responding${NC}"
  echo -e "${YELLOW}  Check logs: tail -f logs/admin.log${NC}"
  HEALTH_FAILURES=$((HEALTH_FAILURES+1))
fi

# ML Service health check
if curl -sf http://localhost:${ML_SERVICE_PORT:-3002}/health > /dev/null 2>&1; then
  echo -e "${GREEN}✓ ML Service: Healthy${NC}"
else
  echo -e "${RED}✗ ML Service: Not responding${NC}"
  echo -e "${YELLOW}  Check logs: tail -f logs/ml.log${NC}"
  HEALTH_FAILURES=$((HEALTH_FAILURES+1))
fi

# Prediction Service health check
if curl -sf http://localhost:${PREDICTION_SERVICE_PORT:-3004}/health > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Prediction Service: Healthy${NC}"
else
  echo -e "${RED}✗ Prediction Service: Not responding${NC}"
  echo -e "${YELLOW}  Check logs: tail -f logs/prediction.log${NC}"
  HEALTH_FAILURES=$((HEALTH_FAILURES+1))
fi

###############################################################################
# Success Summary
###############################################################################
echo ""
if [ "$HEALTH_FAILURES" -gt 0 ]; then
  echo -e "${RED}╔═══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  ⚠  Version 1 started but ${HEALTH_FAILURES} service(s) not healthy     ║${NC}"
  echo -e "${RED}╚═══════════════════════════════════════════════════════════╝${NC}"
  echo -e "${YELLOW}  Processes were launched but did not pass health checks.${NC}"
  echo -e "${YELLOW}  Check logs above and run: tail -f logs/*.log${NC}"
else
  echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║  🎉 Version 1 (Non-NGINX Baseline) Started Successfully!  ║${NC}"
  echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
fi
echo ""
echo -e "${BLUE}🌐 Access Points:${NC}"
echo -e "   Frontend: https://localhost:${HTTPS_PORT:-7763}"
echo -e "   Backend API: https://localhost:${HTTPS_PORT:-7763}/api/*"
echo -e "   ${YELLOW}Note: Frontend served by Gateway (same origin, no CORS)${NC}"
echo ""
echo -e "${BLUE}📊 Service Status:${NC}"
echo -e "   Gateway: Running (PID: $GATEWAY_PID)"
echo -e "   User: Running (PID: $USER_PID)"
echo -e "   Admin: Running (PID: $ADMIN_PID)"
echo -e "   ML: Running (PID: $ML_PID)"
echo -e "   Prediction: Running (PID: $PREDICTION_PID)"
echo ""
echo -e "${BLUE}📝 Logs:${NC}"
echo -e "   Gateway: tail -f logs/gateway.log"
echo -e "   User: tail -f logs/user.log"
echo -e "   Admin: tail -f logs/admin.log"
echo -e "   ML: tail -f logs/ml.log"
echo -e "   Prediction: tail -f logs/prediction.log"
echo ""
echo -e "${BLUE}🛑 To stop all services:${NC}"
echo -e "   ./stop.sh"
echo ""
echo -e "${YELLOW}⚠️  WARNING: This is Version 1 (Baseline with Bottlenecks)${NC}"
echo -e "${YELLOW}   - Small MongoDB pool (10 connections)${NC}"
echo -e "${YELLOW}   - Synchronous file logging (blocks event loop)${NC}"
echo -e "${YELLOW}   - No request queuing (unlimited Python processes)${NC}"
echo -e "${YELLOW}   - Node.js rate limiting & compression (CPU overhead)${NC}"
echo -e "${YELLOW}   - Expected to perform poorly under high load (100+ users)${NC}"
echo -e "${YELLOW}   - EXPECT OOM at 100 VUs - system may become unresponsive${NC}"
echo -e "${YELLOW}   - Monitor memory: watch -n 1 'free -h'${NC}"
echo -e "${YELLOW}   - For thesis testing only, not production use${NC}"
echo ""
echo -e "${BLUE}💡 To test performance:${NC}"
echo -e "   npm run test:load:10   # 10 concurrent users"
echo -e "   npm run test:load:25   # 25 concurrent users"
echo -e "   npm run test:load:50   # 50 concurrent users"
echo -e "   npm run test:load:100  # 100 concurrent users (expect high error rate)"
echo ""
if [ "$HEALTH_FAILURES" -eq 0 ]; then
  echo -e "${GREEN}✓ All services are running!${NC}"
else
  echo -e "${RED}✗ ${HEALTH_FAILURES} service(s) failed health checks. See logs above.${NC}"
fi
