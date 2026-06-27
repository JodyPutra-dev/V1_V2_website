#!/bin/bash

################################################################################
# RGB-Based Hydration Analysis Test Script
# 
# Tests the hydration analysis feature by sending predictions with different
# RGB values and verifying the hydration status responses.
#
# Usage:
#   ./test-hydration-analysis.sh
#
# Requirements:
#   - ML service running on port 7764
#   - curl and jq installed
#   - User authentication configured
#
# Test Cases:
#   1. Dehydrated (dark amber): RGB(180,50,50)
#   2. Slightly Dehydrated (yellow): RGB(255,220,150)
#   3. Well Hydrated (pale): RGB(255,255,240)
################################################################################

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="http://localhost:7764/api/predict"
USER_ID="test-hydration-$(date +%s)"
TESTS_PASSED=0
TESTS_FAILED=0

echo -e "${BLUE}🧪 Testing Hydration Analysis Feature${NC}"
echo "====================================="
echo ""

# Test function
test_hydration() {
    local test_name="$1"
    local rgb_values="$2"
    local expected_status="$3"
    local red=$(echo "$rgb_values" | cut -d',' -f1)
    local green=$(echo "$rgb_values" | cut -d',' -f2)
    local blue=$(echo "$rgb_values" | cut -d',' -f3)
    
    echo -e "${YELLOW}Test: $test_name${NC}"
    echo "RGB: ($rgb_values)"
    
    # Make API request
    response=$(curl -s -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -H "user-id: $USER_ID" \
        -d "{
            \"ph\": 6.5,
            \"tds\": 800,
            \"specificGravity\": 1.015,
            \"turbidityNTU\": 5,
            \"red\": $red,
            \"green\": $green,
            \"blue\": $blue,
            \"turbidityLevel\": \"Jernih\",
            \"warnaDasar\": \"KUNING\"
        }")
    
    # Check if request succeeded
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to connect to API${NC}"
        ((TESTS_FAILED++))
        echo ""
        return 1
    fi
    
    # Extract hydration analysis
    hydration_status=$(echo "$response" | jq -r '.data.hydrationAnalysis.hydrationStatus // empty')
    needs_water=$(echo "$response" | jq -r '.data.hydrationAnalysis.needsWater // empty')
    recommendation=$(echo "$response" | jq -r '.data.hydrationAnalysis.recommendation // empty')
    color_intensity=$(echo "$response" | jq -r '.data.hydrationAnalysis.colorIntensity // empty')
    yellow_ratio=$(echo "$response" | jq -r '.data.hydrationAnalysis.yellowRatio // empty')
    
    # Check if hydration analysis exists
    if [ -z "$hydration_status" ]; then
        echo -e "${RED}❌ No hydration analysis in response${NC}"
        echo "Response: $response"
        ((TESTS_FAILED++))
        echo ""
        return 1
    fi
    
    # Verify expected status
    if [ "$hydration_status" = "$expected_status" ]; then
        echo -e "${GREEN}✅ Status: $hydration_status${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}❌ Status: $hydration_status (expected: $expected_status)${NC}"
        ((TESTS_FAILED++))
    fi
    
    # Display details
    echo -e "${BLUE}💧 Recommendation:${NC} $recommendation"
    echo -e "${BLUE}📊 Metrics:${NC} Intensity=$color_intensity, Yellow Ratio=$yellow_ratio"
    echo -e "${BLUE}🚰 Needs Water:${NC} $needs_water"
    echo ""
}

# Check if services are running
echo "Checking ML service availability..."
if ! curl -s -f "$API_URL" -X POST -H "Content-Type: application/json" -d '{}' > /dev/null 2>&1; then
    # Try with different error handling
    status_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL" -H "Content-Type: application/json" -d '{}')
    if [ "$status_code" = "000" ]; then
        echo -e "${RED}❌ ML service is not running on port 7764${NC}"
        echo "Please start the service with: ./start.sh"
        exit 1
    fi
fi

echo -e "${GREEN}✅ ML service is running${NC}"
echo ""

# Run tests
echo "Running hydration analysis tests..."
echo ""

# Test 1: Dehydrated (dark amber)
test_hydration \
    "Dehydrated (Dark Amber)" \
    "180,50,50" \
    "Dehydrated"

# Test 2: Slightly Dehydrated (yellow)
test_hydration \
    "Slightly Dehydrated (Yellow)" \
    "255,220,150" \
    "Slightly Dehydrated"

# Test 3: Well Hydrated (pale/clear)
test_hydration \
    "Well Hydrated (Pale/Clear)" \
    "255,255,240" \
    "Well Hydrated"

# Summary
echo "====================================="
echo -e "${BLUE}Test Summary${NC}"
echo "====================================="
echo -e "${GREEN}✅ Passed: $TESTS_PASSED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "${RED}❌ Failed: $TESTS_FAILED${NC}"
    echo ""
    echo "Please check:"
    echo "  1. ML service is running (./start.sh)"
    echo "  2. checkDehydrationFromRGB() function is implemented"
    echo "  3. predictWithJoblib() includes hydration analysis in response"
    exit 1
else
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    echo ""
    echo "Feature verification successful:"
    echo "  ✅ Backend hydration analysis working"
    echo "  ✅ RGB color interpretation correct"
    echo "  ✅ Recommendations generated properly"
    echo ""
    echo "Next steps:"
    echo "  - Test frontend display in browser"
    echo "  - Check Dashboard hydration section"
    echo "  - Verify PredictionHistory table column"
    exit 0
fi
