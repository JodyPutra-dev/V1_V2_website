/*
 * ESP8266 Auto Upload V2 - 9 Parameter System
 * 
 * Sends urine analysis data (9 parameters) to backend /api/ml/autoupload endpoint
 * Triggered by serial monitor "send" command
 * 
 * Hardware: NodeMCU ESP8266
 * LEDs: Red (D2/GPIO4), Yellow (D3/GPIO0), Green (D4/GPIO2) - All connect to GND
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

// WiFi Configuration
const char* ssid = "ZTE_2.4G_Jody";
const char* password = "2711297449072!";

// API Configuration
const char* serverUrl = "https://192.168.1.3:7763/api/ml/autoupload";
const char* serverUrlHTTP = "http://192.168.1.3:7764/api/ml/autoupload";
const char* deviceToken = "d250ab27b30db84e3dbc843eda266e16";
bool useHTTPS = true;  // HTTPS-only mode for secure IoT uploads

// LED Pins (Active LOW - connect LEDs to GND)
#define LED_RED    4   // D2 - Error
#define LED_YELLOW 0   // D3 - Sending
#define LED_GREEN  2   // D4 - Success

// Dummy Data (9 Parameters)
struct UrineData {
  float ph;
  int tds;
  float specificGravity;
  float turbidityNTU;
  int red;
  int green;
  int blue;
  String turbidityLevel;
  String warnaDasar;
};

UrineData dummyData = {
  6.8,           // ph
  950,           // tds
  1.018,         // specificGravity
  7.5,           // turbidityNTU
  240,           // red
  200,           // green
  120,           // blue
  "Jernih",      // turbidityLevel
  "KUNING"       // warnaDasar
};

void setup() {
  Serial.begin(115200);
  delay(100);
  
  // Initialize LEDs
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  
  // Turn off all LEDs
  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_GREEN, LOW);
  
  Serial.println("\n\n=== ESP8266 Auto Upload V2 ===");
  Serial.println("9-Parameter Urine Analysis System");
  
  // Connect to WiFi
  connectWiFi();
  
  Serial.print("Protocol Mode: ");
  Serial.println(useHTTPS ? "HTTPS" : "HTTP");
  Serial.println("TIP: Using HTTPS mode (port 7763) - ensure server SSL is running");
  Serial.println("\nReady. Type 'send' to upload data.");
}

void loop() {
  // Check for serial input
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    command.toLowerCase();
    
    if (command == "send") {
      sendData();
    } else if (command == "help") {
      printHelp();
    } else if (command == "status") {
      printStatus();
    } else {
      Serial.println("Unknown command. Type 'help' for available commands.");
    }
  }
  
  delay(100);
}

void connectWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  digitalWrite(LED_YELLOW, HIGH);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  digitalWrite(LED_YELLOW, LOW);
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    digitalWrite(LED_GREEN, HIGH);
    delay(500);
    digitalWrite(LED_GREEN, LOW);
  } else {
    Serial.println("\nWiFi Connection Failed!");
    digitalWrite(LED_RED, HIGH);
    delay(1000);
    digitalWrite(LED_RED, LOW);
  }
}

void sendData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("ERROR: WiFi not connected. Reconnecting...");
    connectWiFi();
    return;
  }
  
  Serial.println("Protocol: HTTPS (port 7763)");  // HTTPS-only mode enforced for secure production IoT uploads
  
  Serial.println("\n--- Sending Data ---");
  Serial.println("Dummy Urine Parameters:");
  Serial.print("  pH: "); Serial.println(dummyData.ph);
  Serial.print("  TDS: "); Serial.print(dummyData.tds); Serial.println(" ppm");
  Serial.print("  Specific Gravity: "); Serial.println(dummyData.specificGravity, 3);
  Serial.print("  Turbidity NTU: "); Serial.println(dummyData.turbidityNTU);
  Serial.print("  RGB: ("); 
  Serial.print(dummyData.red); Serial.print(", ");
  Serial.print(dummyData.green); Serial.print(", ");
  Serial.print(dummyData.blue); Serial.println(")");
  Serial.print("  Turbidity Level: "); Serial.println(dummyData.turbidityLevel);
  Serial.print("  Warna Dasar: "); Serial.println(dummyData.warnaDasar);
  
  digitalWrite(LED_YELLOW, HIGH);
  
  // Connection diagnostics
  Serial.println("Protocol: HTTPS");  // HTTPS-only mode
  Serial.println("Client Type: WiFiClientSecure");
  
  HTTPClient http;
  
  // Conditional client based on useHTTPS flag
  if (useHTTPS) {
    WiFiClientSecure* secureClient = new WiFiClientSecure();
    secureClient->setInsecure();
    http.begin(*secureClient, serverUrl);
  } else {
    WiFiClient* httpClient = new WiFiClient();
    http.begin(*httpClient, serverUrlHTTP);
  }
  
  // Set headers
  http.addHeader("Content-Type", "application/json");
  http.addHeader("device-token", deviceToken);
  
  // Create JSON payload
  StaticJsonDocument<256> doc;
  doc["ph"] = dummyData.ph;
  doc["tds"] = dummyData.tds;
  doc["specificGravity"] = dummyData.specificGravity;
  doc["turbidityNTU"] = dummyData.turbidityNTU;
  doc["red"] = dummyData.red;
  doc["green"] = dummyData.green;
  doc["blue"] = dummyData.blue;
  doc["turbidityLevel"] = dummyData.turbidityLevel;
  doc["warnaDasar"] = dummyData.warnaDasar;
  
  String jsonPayload;
  serializeJson(doc, jsonPayload);
  
  Serial.print("JSON Payload: ");
  Serial.println(jsonPayload);
  Serial.print("Sending to: ");
  Serial.println(useHTTPS ? serverUrl : serverUrlHTTP);
  
  // Send POST request
  int httpCode = http.POST(jsonPayload);
  
  digitalWrite(LED_YELLOW, LOW);
  
  // Handle response
  if (httpCode > 0) {
    Serial.print("HTTP Response Code: ");
    Serial.println(httpCode);
    
    String response = http.getString();
    Serial.print("Response Body: ");
    Serial.println(response);
    
    if (httpCode >= 200 && httpCode < 300) {
      Serial.println("✓ SUCCESS: Data uploaded successfully!");
      digitalWrite(LED_GREEN, HIGH);
      delay(2000);
      digitalWrite(LED_GREEN, LOW);
    } else if (httpCode == 401) {
      Serial.println("✗ ERROR: Invalid device token (401 Unauthorized)");
      Serial.println("  → Regenerate token in Profile page and update sketch");
      digitalWrite(LED_RED, HIGH);
      delay(2000);
      digitalWrite(LED_RED, LOW);
    } else if (httpCode >= 500) {
      Serial.println("✗ ERROR: Server error (500+)");
      Serial.println("  → Check backend logs: tail -f logs/ml.log");
      digitalWrite(LED_RED, HIGH);
      delay(2000);
      digitalWrite(LED_RED, LOW);
    } else {
      Serial.print("✗ ERROR: Unexpected response code: ");
      Serial.println(httpCode);
      digitalWrite(LED_RED, HIGH);
      delay(2000);
      digitalWrite(LED_RED, LOW);
    }
  } else {
    Serial.print("✗ ERROR: HTTP request failed: ");
    Serial.println(http.errorToString(httpCode));
    digitalWrite(LED_RED, HIGH);
    delay(2000);
    digitalWrite(LED_RED, LOW);
  }
  
  http.end();
  Serial.println("--- Done ---\n");
}

void printHelp() {
  Serial.println("\n=== Available Commands ===");
  Serial.println("  send   - Send dummy urine data to backend");
  Serial.println("  http   - Switch to HTTP mode (port 7764)");\n  Serial.println("  https  - Switch to HTTPS mode (port 7763)");\n  Serial.println("  status - Show WiFi and system status");
  Serial.println("  help   - Show this help message");
  Serial.println();
}

void printStatus() {
  Serial.println("\n=== System Status ===");
  Serial.print("WiFi Status: ");
  Serial.println(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("  SSID: ");
    Serial.println(WiFi.SSID());
    Serial.print("  IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("  Signal Strength: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  }
  Serial.print("Current Protocol: ");
  Serial.println(useHTTPS ? "HTTPS" : "HTTP");
  Serial.print("Target URL: ");
  Serial.println(useHTTPS ? serverUrl : serverUrlHTTP);
  Serial.print("Device Token: ");
  Serial.print(deviceToken);
  Serial.println(" (first 8 chars)");
  Serial.println();
}
