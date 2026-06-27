/*
 * ESP8266 Auto Upload HTTP - V1 Testing
 * 
 * Sends 9-parameter urine analysis data to V1 backend via HTTP (no SSL)
 * Triggered by serial monitor "send" command
 * 
 * Hardware: NodeMCU ESP8266
 * LEDs: Single LED on GPIO2 (D4) for status feedback
 * Endpoint: http://172.29.156.41:7764/api/ml/autoupload
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <ArduinoJson.h>

// ===== CONFIGURATION - UPDATE THESE VALUES =====
// WiFi Configuration
const char* ssid = "YOUR_WIFI_SSID";          // Change this
const char* password = "YOUR_WIFI_PASSWORD";  // Change this

// API Configuration (V1 HTTP - No SSL)
const char* serverUrl = "http://172.29.156.41:7764/api/ml/autoupload";
const char* deviceToken = "11899e4faa744b32781816963d3a791f";

// LED Pin (Built-in LED on NodeMCU)
#define LED_PIN 2  // GPIO2 (D4)

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
  210,           // green
  120,           // blue
  "Jernih",      // turbidityLevel
  "KUNING"       // warnaDasar
};

// ===== LED PATTERNS =====
void ledBlink(int times, int delayMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_PIN, LOW);   // LED ON (active LOW)
    delay(delayMs);
    digitalWrite(LED_PIN, HIGH);  // LED OFF
    delay(delayMs);
  }
}

void ledSolid() {
  digitalWrite(LED_PIN, LOW);  // LED ON
}

void ledOff() {
  digitalWrite(LED_PIN, HIGH); // LED OFF
}

void ledFastBlink() {
  for (int i = 0; i < 10; i++) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    delay(100);
  }
  ledOff();
}

// ===== SETUP =====
void setup() {
  Serial.begin(115200);
  delay(100);
  
  // Initialize LED
  pinMode(LED_PIN, OUTPUT);
  ledOff();
  
  Serial.println("\n\n=== ESP8266 Auto Upload HTTP ===");
  Serial.println("V1 HTTP Testing (No SSL)");
  Serial.println("9-Parameter Urine Analysis System");
  Serial.println("================================\n");
  
  // Connect to WiFi
  connectWiFi();
  
  Serial.println("\n=== Ready ===");
  Serial.println("Commands:");
  Serial.println("  send  - Upload dummy data to backend");
  Serial.println("  wifi  - Show WiFi status");
  Serial.println("  data  - Show dummy data values");
  Serial.println("  help  - Show this help");
  Serial.println();
}

// ===== WIFI CONNECTION =====
void connectWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  
  unsigned long startTime = millis();
  ledBlink(1, 200);  // Quick blink
  
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - startTime > WIFI_TIMEOUT) {
      Serial.println("\n✗ WiFi connection timeout!");
      ledFastBlink();
      Serial.println("Please check SSID and password, then reset ESP8266");
      return;
    }
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\n✓ WiFi Connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
  ledBlink(3, 200);  // Success blinks
}

// ===== SEND DATA =====
void sendData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("✗ Error: WiFi not connected");
    ledFastBlink();
    return;
  }
  
  Serial.println("\n--- Sending Data ---");
  ledBlink(1, 100);  // Starting
  
  // Show data being sent
  Serial.println("Dummy Urine Parameters:");
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
  
  // Send HTTP POST with retry logic
  int retries = 0;
  bool success = false;
  
  while (retries < MAX_RETRIES && !success) {
    if (retries > 0) {
      Serial.print("Retry attempt "); Serial.print(retries); Serial.println("...");
      delay(2000);
    }
    
    WiFiClient client;
    HTTPClient http;
    
    Serial.print("Sending to: ");
    Serial.println(serverUrl);
    
    http.begin(client, serverUrl);
    http.setTimeout(HTTP_TIMEOUT);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("device-token", deviceToken);
    
    ledSolid();  // LED on during send
    
    int httpCode = http.POST(jsonPayload);
    
    Serial.print("HTTP Response Code: ");
    Serial.println(httpCode);
    
    if (httpCode > 0) {
      String response = http.getString();
      Serial.print("Response Body: ");
      Serial.println(response);
      
      if (httpCode >= 200 && httpCode < 300) {
        Serial.println("✓ SUCCESS: Data uploaded successfully!");
        ledBlink(5, 100);  // Success blinks
        success = true;
      } else if (httpCode == 401) {
        Serial.println("✗ ERROR: Invalid device token (401 Unauthorized)");
        Serial.println("Please regenerate token in Profile page and update sketch");
        ledFastBlink();
        break;  // No retry for auth error
      } else if (httpCode == 500) {
        Serial.println("✗ ERROR: Server error (500)");
        Serial.println("Check backend logs: tail -f logs/ml.log");
        ledFastBlink();
      } else {
        Serial.print("✗ ERROR: Unexpected status code ");
        Serial.println(httpCode);
        ledFastBlink();
      }
    } else {
      Serial.print("✗ ERROR: HTTP request failed: ");
      Serial.println(http.errorToString(httpCode));
      ledFastBlink();
    }
    
    http.end();
    retries++;
  }
  
  if (!success && retries >= MAX_RETRIES) {
    Serial.println("✗ FAILED: Max retries reached");
  }
  
  ledOff();
  Serial.println("--- Done ---\n");
}

// ===== SHOW COMMANDS =====
void showWiFiStatus() {
  Serial.println("\n--- WiFi Status ---");
  Serial.print("Status: ");
  Serial.println(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("SSID: "); Serial.println(WiFi.SSID());
    Serial.print("IP: "); Serial.println(WiFi.localIP());
    Serial.print("Signal: "); Serial.print(WiFi.RSSI()); Serial.println(" dBm");
  }
  Serial.println("-------------------\n");
}

void showDummyData() {
  Serial.println("\n--- Dummy Data ---");
  Serial.print("pH: "); Serial.println(dummyData.ph, 2);
  Serial.print("TDS: "); Serial.print(dummyData.tds); Serial.println(" ppm");
  Serial.print("Specific Gravity: "); Serial.println(dummyData.specificGravity, 3);
  Serial.print("Turbidity NTU: "); Serial.println(dummyData.turbidityNTU, 2);
  Serial.print("Red: "); Serial.println(dummyData.red);
  Serial.print("Green: "); Serial.println(dummyData.green);
  Serial.print("Blue: "); Serial.println(dummyData.blue);
  Serial.print("Turbidity Level: "); Serial.println(dummyData.turbidityLevel);
  Serial.print("Warna Dasar: "); Serial.println(dummyData.warnaDasar);
  Serial.println("------------------\n");
}

void showHelp() {
  Serial.println("\n--- Available Commands ---");
  Serial.println("send  - Upload dummy data to backend");
  Serial.println("wifi  - Show WiFi status");
  Serial.println("data  - Show dummy data values");
  Serial.println("help  - Show this help");
  Serial.println("-------------------------\n");
}

// ===== MAIN LOOP =====
void loop() {
  // Check for serial commands
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    command.toLowerCase();
    
    if (command == "send") {
      sendData();
    } else if (command == "wifi") {
      showWiFiStatus();
    } else if (command == "data") {
      showDummyData();
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
