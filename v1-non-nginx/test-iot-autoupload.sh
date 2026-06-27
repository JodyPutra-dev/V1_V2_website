#!/bin/bash

###############################################################################
# ESP8266 IoT Autoupload Test Script
# 
# Simulates ESP8266 sending 9-parameter urine data to /api/ml/autoupload
# Tests both HTTP and HTTPS endpoints
# 
# Usage:
#   ./test-iot-autoupload.sh           # HTTP (default)
#   ./test-iot-autoupload.sh --https   # HTTPS
#   ./test-iot-autoupload.sh --token YOUR_TOKEN  # Custom token
###############################################################################

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
HTTP_URL="http://172.29.156.41:7764/api/ml/autoupload"
HTTPS_URL="https://172.29.156.41:7763/api/ml/autoupload"
DEVICE_TOKEN="d250ab27b30db84e3dbc843eda266e16"
USE_HTTPS=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --https)
      USE_HTTPS=true
      shift
      ;;
    --token)
      DEVICE_TOKEN="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --https        Use HTTPS endpoint (port 7763)"
      echo "  --token TOKEN  Use custom device token"
      echo "  --help         Show this help"
      echo ""
      echo "Examples:"
      echo "  $0                          # HTTP (recommended)"
      echo "  $0 --https                  # HTTPS"
      echo "  $0 --token abc123...        # Custom token"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Select endpoint
if [ "$USE_HTTPS" = true ]; then
  ENDPOINT="$HTTPS_URL"
  PROTOCOL="HTTPS"
  CURL_OPTS="-k"  # Ignore self-signed cert
else
  ENDPOINT="$HTTP_URL"
  PROTOCOL="HTTP"
  CURL_OPTS=""
fi

# Test data (9 parameters matching ESP8266)
TEST_DATA='{
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

# Print test info
echo -e "${BLUE}=== ESP8266 IoT Autoupload Test ===${NC}"
echo -e "${BLUE}Protocol:${NC} $PROTOCOL"
echo -e "${BLUE}Endpoint:${NC} $ENDPOINT"
echo -e "${BLUE}Token:${NC} ${DEVICE_TOKEN:0:8}..."
echo ""

# Execute request
echo -e "${YELLOW}Sending test data...${NC}"
RESPONSE=$(curl $CURL_OPTS -s -w "\n%{http_code}" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "device-token: $DEVICE_TOKEN" \
  -d "$TEST_DATA")

# Parse response
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

# Display results
echo ""
echo -e "${BLUE}--- Response ---${NC}"
echo -e "${BLUE}HTTP Code:${NC} $HTTP_CODE"
echo -e "${BLUE}Response Body:${NC}"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"

# Check status
echo ""
if [ "$HTTP_CODE" -eq 201 ] || [ "$HTTP_CODE" -eq 200 ]; then
  echo -e "${GREEN}✓ SUCCESS: Data uploaded and processed!${NC}"
  
  # Extract prediction details
  PREDICTION=$(echo "$BODY" | jq -r '.data.prediction // .prediction // "N/A"' 2>/dev/null)
  HYDRATION=$(echo "$BODY" | jq -r '.data.hydrationLevel // .hydrationLevel // "N/A"' 2>/dev/null)
  SAVED_ID=$(echo "$BODY" | jq -r '.data.savedId // .savedId // "N/A"' 2>/dev/null)
  
  echo -e "${GREEN}Prediction:${NC} $PREDICTION"
  echo -e "${GREEN}Hydration:${NC} $HYDRATION"
  echo -e "${GREEN}Saved ID:${NC} $SAVED_ID"
  
  # Verify in MongoDB
  echo ""
  echo -e "${BLUE}--- MongoDB Verification ---${NC}"
  if command -v mongosh &> /dev/null; then
    MONGO_CMD="mongosh"
  elif command -v mongo &> /dev/null; then
    MONGO_CMD="mongo"
  else
    echo -e "${YELLOW}⚠ MongoDB client not found, skipping verification${NC}"
    exit 0
  fi
  
  MONGO_QUERY="db.autodatas.findOne({_id: ObjectId('$SAVED_ID')}, {parameters: 1, prediction: 1, userId: 1, timestamp: 1})"
  
  echo -e "${BLUE}Querying AutoData collection...${NC}"
  $MONGO_CMD "mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection?authSource=admin" \
    --quiet --eval "$MONGO_QUERY" 2>/dev/null || echo -e "${YELLOW}Could not verify in MongoDB${NC}"
  
elif [ "$HTTP_CODE" -eq 401 ]; then
  echo -e "${RED}✗ ERROR: Invalid device token (401 Unauthorized)${NC}"
  echo ""
  echo -e "${YELLOW}Solutions:${NC}"
  echo "  1. Login to Profile page: https://172.29.156.41:7763/profile"
  echo "  2. Click 'Regenerate Device Token'"
  echo "  3. Copy new token"
  echo "  4. Run: $0 --token YOUR_NEW_TOKEN"
  
elif [ "$HTTP_CODE" -eq 400 ]; then
  echo -e "${RED}✗ ERROR: Bad request (400)${NC}"
  echo -e "${YELLOW}Possible causes:${NC}"
  echo "  - Missing required parameters"
  echo "  - Invalid parameter types"
  echo "  - Malformed JSON"
  
elif [ "$HTTP_CODE" -eq 500 ]; then
  echo -e "${RED}✗ ERROR: Server error (500)${NC}"
  echo ""
  echo -e "${YELLOW}Troubleshooting:${NC}"
  echo "  1. Check backend logs:"
  echo "     cd /var/www/html/HIBAH/deployments/v1-non-nginx"
  echo "     tail -f logs/ml.log | grep -i autoupload"
  echo ""
  echo "  2. Verify services running:"
  echo "     ps aux | grep 'ml-service\\|gateway'"
  echo ""
  echo "  3. Restart if needed:"
  echo "     ./stop.sh && ./start.sh"
  
elif [ "$HTTP_CODE" -eq 000 ]; then
  echo -e "${RED}✗ ERROR: Connection failed${NC}"
  echo ""
  if [ "$USE_HTTPS" = true ]; then
    echo -e "${YELLOW}HTTPS connection issue. Try HTTP mode:${NC}"
    echo "  $0"
  else
    echo -e "${YELLOW}HTTP connection issue. Check:${NC}"
    echo "  1. Backend running: curl http://172.29.156.41:7764/api/health"
    echo "  2. Network access: ping 172.29.156.41"
    echo "  3. Firewall rules allowing port 7764"
  fi
  
else
  echo -e "${RED}✗ ERROR: Unexpected HTTP code $HTTP_CODE${NC}"
fi

echo ""
echo -e "${BLUE}=== Test Complete ===${NC}"
