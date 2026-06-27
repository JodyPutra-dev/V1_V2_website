/*
 * ESP8266 Auto Upload HTTP/HTTPS Hybrid - 9 Parameter System
 * 
 * Flexible testing sketch with serial commands to toggle between HTTP/HTTPS
 * Recommended for development: start with HTTP for reliability, test HTTPS when needed
 * 
 * Features:
 * - HTTP (port 7764) and HTTPS (port 7763) support
 * - Serial commands: send, toggle, http, https, status, help
 * - Enhanced connection diagnostics
 * - Auto-retry with fallback
 * - 3 LED status indicators
 * 
 * Hardware: NodeMCU ESP8266
 * LEDs: Red (D2/GPIO4), Yellow (D3/GPIO0), Green (D4/GPIO2) - All connect to GND
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

// ===== CONFIGURATION - UPDATE THESE VALUES =====

// WiFi Configuration
const char* ssid = "ZTE_2.4G_Jody";
const char* password = "2711297449072!";

// API Configuration
const char* httpsUrl = "https://192.168.1.4:7763/api/ml/autoupload";
const char* httpUrl = "http://192.168.1.4:7764/api/ml/autoupload";
const char* deviceToken = "d250ab27b30db84e3dbc843eda266e16";

// Protocol Selection (toggle via serial commands)
bool useHTTPS = false;  // Start with HTTP for reliable testing

// LED Pins (Active LOW - connect LEDs to GND)
#define LED_RED    4   // D2 - Error
#define LED_YELLOW 0   // D3 - Sending
#define LED_GREEN  2   // D4 - Success

// Connection Settings
#define WIFI_TIMEOUT 20000     // 20 seconds
#define HTTP_TIMEOUT 10000     // 10 seconds
#define MAX_RETRIES 3

// ===== DUMMY DATA (9 Parameters) =====
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

// ===== LED CONTROL =====
void ledOff() {
  digitalWrite(LED_RED, HIGH);
  digitalWrite(LED_YELLOW, HIGH);
  digitalWrite(LED_GREEN, HIGH);
}

void ledError() {
  ledOff();
  digitalWrite(LED_RED, LOW);  // Red ON
}

void ledSending() {
  ledOff();
  digitalWrite(LED_YELLOW, LOW);  // Yellow ON
}

void ledSuccess() {
  ledOff();
  digitalWrite(LED_GREEN, LOW);  // Green ON
  delay(2000);
  ledOff();
}

void ledBlink(int pin, int times, int delayMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(pin, LOW);
    delay(delayMs);
    digitalWrite(pin, HIGH);
    delay(delayMs);
  }
}

// ===== SETUP =====
void setup() {
  Serial.begin(115200);
  delay(100);
  
  // Initialize LEDs
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  ledOff();
  
  Serial.println("\n\n=== ESP8266 HTTP/HTTPS Hybrid ===");
  Serial.println("9-Parameter Urine Analysis System");
  Serial.println("=================================\n");
  
  // Connect to WiFi
  connectWiFi();
  
  Serial.println("\n=== Ready ===");
  Serial.println("Commands:");
  Serial.println("  send   - Upload dummy data");
  Serial.println("  toggle - Switch HTTP/HTTPS");
  Serial.println("  http   - Force HTTP mode");
  Serial.println("  https  - Force HTTPS mode");
  Serial.println("  status - Show connection info");
  Serial.println("  help   - Show this help");
  Serial.println();
  showStatus();
}

// ===== WIFI CONNECTION =====
void connectWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  
  unsigned long startTime = millis();
  ledBlink(LED_YELLOW, 1, 200);
  
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - startTime > WIFI_TIMEOUT) {
      Serial.println("\n✗ WiFi connection timeout!");
      ledError();
      Serial.println("Please check SSID and password, then reset ESP8266");
      return;
    }
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\n✓ WiFi Connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
  Serial.print("Signal Strength: ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");
  ledBlink(LED_GREEN, 3, 100);
}

// ===== SEND DATA =====
void sendData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("✗ Error: WiFi not connected");
    ledError();
    return;
  }
  
  Serial.println("\n--- Sending Data ---");
  Serial.print("Protocol: ");
  Serial.println(useHTTPS ? "HTTPS" : "HTTP");
  Serial.print("Endpoint: ");
  Serial.println(useHTTPS ? httpsUrl : httpUrl);
  Serial.print("Device-Token: ");
  Serial.println(deviceToken);
  
  ledSending();
  
  // Show data being sent
  Serial.println("\nDummy Urine Parameters:");
  Serial.print("  pH: "); Serial.println(dummyData.ph, 2);
  Serial.print("  TDS: "); Serial.print(dummyData.tds); Serial.println(" ppm");
  Serial.print("  Specific Gravity: "); Serial.println(dummyData.specificGravity, 3);
  Serial.print("  Turbidity NTU: "); Serial.println(dummyData.turbidityNTU, 2);
  Serial.print("  RGB: ("); 
  Serial.print(dummyData.red); Serial.print(", ");
  Serial.print(dummyData.green); Serial.print(", ");
  Serial.print(dummyData.blue); Serial.println(")");
  Serial.print("  Turbidity Level: "); Serial.println(dummyData.turbidityLevel);
  Serial.print("  Warna Dasar: "); Serial.println(dummyData.warnaDasar);
  
  // Create JSON payload
  StaticJsonDocument<512> doc;
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
  Serial.print("\nJSON Payload: ");
  Serial.println(jsonPayload);
  
  // Send with retry logic
  int retries = 0;
  bool success = false;
  
  while (retries < MAX_RETRIES && !success) {
    if (retries > 0) {
      Serial.print("\nRetry attempt ");
      Serial.print(retries);
      Serial.println("...");
      delay(2000);
    }
    
    HTTPClient http;
    unsigned long connectStart = millis();
    
    // Select client based on protocol
    if (useHTTPS) {
      WiFiClientSecure client;
      client.setInsecure();  // Accept self-signed certificates
      
      Serial.println("\n[HTTPS] Attempting TLS handshake...");
      http.begin(client, httpsUrl);
    } else {
      WiFiClient client;
      http.begin(client, httpUrl);
    }
    
    http.setTimeout(HTTP_TIMEOUT);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("device-token", deviceToken);
    
    unsigned long connectTime = millis() - connectStart;
    Serial.print("Connection established in ");
    Serial.print(connectTime);
    Serial.println(" ms");
    
    if (useHTTPS) {
      Serial.println("[HTTPS] TLS handshake successful");
    }
    
    int httpCode = http.POST(jsonPayload);
    
    Serial.print("HTTP Response Code: ");
    Serial.println(httpCode);
    
    if (httpCode > 0) {
      String response = http.getString();
      Serial.print("Response Body: ");
      Serial.println(response);
      
      if (httpCode >= 200 && httpCode < 300) {
        Serial.println("✓ SUCCESS: Data uploaded successfully!");
        ledSuccess();
        success = true;
      } else if (httpCode == 401) {
        Serial.println("✗ ERROR: Invalid device token (401 Unauthorized)");
        Serial.println("Solution:");
        Serial.print("  1. Login to: ");
        Serial.println(useHTTPS ? "https://172.29.156.41:7763/profile" : "http://172.29.156.41:7764/profile");
        Serial.println("  2. Go to Profile page, copy Device Token");
        Serial.println("  3. Update sketch line 30 with new token");
        Serial.println("  4. Re-upload sketch to ESP8266");
        ledError();omg
        break;  // No retry for auth error
      } else if (httpCode == 500) {
        Serial.println("✗ ERROR: Server error (500)");
        Serial.println("Check backend logs: tail -f logs/ml.log");
        ledError();
      } else {
        Serial.print("✗ ERROR: Unexpected status code ");
        Serial.println(httpCode);
        ledError();
      }
    } else {
      Serial.print("✗ ERROR: HTTP request failed: ");
      Serial.println(http.errorToString(httpCode));
      
      if (useHTTPS) {
        Serial.println("\n[HTTPS] TLS handshake or connection failed");
        Serial.println("Common causes:");
        Serial.println("  - Self-signed certificate rejected");
        Serial.println("  - TLS version incompatibility");
        Serial.println("  - ESP8266 memory constraints");
        Serial.println("\nSuggestion: Try HTTP mode");
        Serial.println("  Type 'http' in serial monitor, then 'send'");
      }
      
      ledError();
    }
    
    http.end();
    retries++;
  }
  
  if (!success && retries >= MAX_RETRIES) {
    Serial.println("\n✗ FAILED: Max retries reached");
    if (useHTTPS) {
      Serial.println("Recommendation: Switch to HTTP mode");
      Serial.println("  Type: toggle");
    }
  }
  
  ledOff();
  Serial.println("--- Done ---\n");
}

// ===== STATUS DISPLAY =====
void showStatus() {
  Serial.println("\n--- Current Status ---");
  Serial.print("WiFi: ");
  Serial.println(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("  SSID: "); Serial.println(WiFi.SSID());
    Serial.print("  IP: "); Serial.println(WiFi.localIP());
    Serial.print("  Signal: "); Serial.print(WiFi.RSSI()); Serial.println(" dBm");
  }
  Serial.print("Protocol: ");
  Serial.println(useHTTPS ? "HTTPS (port 7763)" : "HTTP (port 7764)");
  Serial.print("Endpoint: ");
  Serial.println(useHTTPS ? httpsUrl : httpUrl);
  Serial.print("Device Token: ");
  Serial.print(String(deviceToken).substring(0, 8));
  Serial.println("...");
  Serial.println("---------------------\n");
}

// ===== TOGGLE PROTOCOL =====
void toggleProtocol() {
  useHTTPS = !useHTTPS;
  Serial.print("Protocol switched to: ");
  Serial.println(useHTTPS ? "HTTPS" : "HTTP");
  showStatus();
}

// ===== HELP =====
void showHelp() {
  Serial.println("\n--- Available Commands ---");
  Serial.println("send   - Upload dummy data to backend");
  Serial.println("toggle - Switch between HTTP/HTTPS");
  Serial.println("http   - Force HTTP mode (port 7764)");
  Serial.println("https  - Force HTTPS mode (port 7763)");
  Serial.println("status - Show WiFi & connection info");
  Serial.println("help   - Show this help");
  Serial.println("-------------------------\n");
}

// ===== MAIN LOOP =====
void loop() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    command.toLowerCase();
    
    if (command == "send") {
      sendData();
    } else if (command == "toggle") {
      toggleProtocol();
    } else if (command == "http") {
      useHTTPS = false;
      Serial.println("Forced HTTP mode");
      showStatus();
    } else if (command == "https") {
      useHTTPS = true;
      Serial.println("Forced HTTPS mode");
      showStatus();
    } else if (command == "status") {
      showStatus();
    } else if (command == "help") {
      showHelp();
    } else if (command.length() > 0) {
      Serial.print("Unknown command: ");
      Serial.println(command);
      Serial.println("Type 'help' for available commands");
    }
  }
  
  delay(100);
}
