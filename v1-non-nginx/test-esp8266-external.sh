#!/bin/bash
# Test ESP8266 autoupload from external IP perspective
# Simulates ESP8266 on WiFi network accessing server via router

EXTERNAL_IP="192.168.1.3"
HTTP_PORT="7764"
HTTPS_PORT="7763"
TOKEN="d250ab27b30db84e3dbc843eda266e16"

PAYLOAD='{
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

echo "=== ESP8266 External IP Test ==="
echo "Testing as if from ESP8266 on WiFi network"
echo "External IP: $EXTERNAL_IP"
echo "Token: $TOKEN"
echo ""

# Test HTTP (recommended for ESP8266)
echo "--- Test 1: HTTP to $EXTERNAL_IP:$HTTP_PORT ---"
echo "This simulates ESP8266 with useHTTPS=false"
echo ""

HTTP_RESPONSE=$(curl -w "\nHTTP_CODE:%{http_code}\n" -X POST http://$EXTERNAL_IP:$HTTP_PORT/api/ml/autoupload \
  -H "device-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  2>&1)

HTTP_CODE=$(echo "$HTTP_RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
HTTP_BODY=$(echo "$HTTP_RESPONSE" | grep -v "HTTP_CODE:")

echo "$HTTP_BODY"
echo "HTTP Code: $HTTP_CODE"

if [ "$HTTP_CODE" = "201" ]; then
  echo "✅ HTTP SUCCESS - ESP8266 will work with useHTTPS=false"
else
  echo "❌ HTTP FAILED - Check port forwarding, firewall, server binding"
fi

echo ""
echo "--- Test 2: HTTPS to $EXTERNAL_IP:$HTTPS_PORT (may fail on ESP8266) ---"
echo "This simulates ESP8266 with useHTTPS=true"
echo ""

HTTPS_RESPONSE=$(curl -k -w "\nHTTP_CODE:%{http_code}\n" -X POST https://$EXTERNAL_IP:$HTTPS_PORT/api/ml/autoupload \
  -H "device-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  2>&1)

HTTPS_CODE=$(echo "$HTTPS_RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
HTTPS_BODY=$(echo "$HTTPS_RESPONSE" | grep -v "HTTP_CODE:")

echo "$HTTPS_BODY"
echo "HTTP Code: $HTTPS_CODE"

if [ "$HTTPS_CODE" = "201" ]; then
  echo "✅ HTTPS SUCCESS - ESP8266 may work with useHTTPS=true (requires setInsecure())"
else
  echo "❌ HTTPS FAILED - ESP8266 will fail with useHTTPS=true (use HTTP instead)"
fi

echo ""
echo "=== Summary ==="
echo ""
echo "HTTP ($HTTP_PORT):  $([ "$HTTP_CODE" = "201" ] && echo "✅ WORKS" || echo "❌ FAILED")"
echo "HTTPS ($HTTPS_PORT): $([ "$HTTPS_CODE" = "201" ] && echo "✅ WORKS" || echo "❌ FAILED")"
echo ""
echo "Recommendation for ESP8266:"
if [ "$HTTP_CODE" = "201" ]; then
  echo "  Use HTTP mode (useHTTPS = false) in sketch"
  echo "  const char* serverUrlHTTP = \"http://$EXTERNAL_IP:$HTTP_PORT/api/ml/autoupload\";"
else
  echo "  Fix port forwarding/firewall first, then use HTTP mode"
fi

echo ""
echo "Next Steps:"
echo "  1. Upload ESP8266_AutoUpload_V2.ino with useHTTPS=false"
echo "  2. Open Serial Monitor (115200 baud)"
echo "  3. Type 'send' to test upload"
echo "  4. Expected: '✓ SUCCESS: Data uploaded successfully!'"
