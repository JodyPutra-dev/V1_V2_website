#!/usr/bin/env node

/**
 * Device Token Testing Script
 * Tests the complete IoT device token flow:
 * 1. Register new test user
 * 2. Extract device token from response
 * 3. Verify token in user profile
 * 4. Send test data to /autoupload with device-token header
 * 5. Verify AutoData saved with userId link
 * 6. Query /autodata by userId to confirm retrieval
 */

const https = require('https');
const http = require('http');

// Configuration
const BASE_URL = process.env.API_URL || 'https://172.29.156.41:7763';
const USE_HTTPS = BASE_URL.startsWith('https');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// Helper function for colored console output
function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`\n[STEP ${step}] ${message}`, 'cyan');
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

function logInfo(message) {
  log(`  ${message}`, 'blue');
}

// HTTP request helper
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const client = USE_HTTPS ? https : http;
    
    // For self-signed certificates
    if (USE_HTTPS) {
      options.rejectUnauthorized = false;
    }
    
    const req = client.request(options, (res) => {
      let body = '';
      
      res.on('data', (chunk) => {
        body += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = {
            statusCode: res.statusCode,
            headers: res.headers,
            body: body ? JSON.parse(body) : null
          };
          resolve(response);
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body
          });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

// Test flow
async function runTests() {
  log('\n╔════════════════════════════════════════════════════════════╗', 'bright');
  log('║         Device Token Integration Test Suite               ║', 'bright');
  log('╚════════════════════════════════════════════════════════════╝', 'bright');
  
  let testUser = null;
  let authToken = null;
  let deviceToken = null;
  let userId = null;
  let autoDataId = null;
  
  try {
    // Step 1: Register new test user
    logStep(1, 'Registering new test user');
    const timestamp = Date.now();
    const testEmail = `test-device-${timestamp}@example.com`;
    
    const registerResponse = await makeRequest({
      hostname: BASE_URL.replace('https://', '').replace('http://', '').split(':')[0],
      port: BASE_URL.split(':')[2] || (USE_HTTPS ? 443 : 80),
      path: '/api/auth/register',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, {
      name: 'Test Device User',
      email: testEmail,
      password: 'testpass123'
    });
    
    if (registerResponse.statusCode !== 201 || !registerResponse.body.success) {
      logError(`Registration failed: ${registerResponse.body.message}`);
      return process.exit(1);
    }
    
    testUser = registerResponse.body.user;
    authToken = registerResponse.body.token;
    deviceToken = testUser.deviceToken;
    userId = testUser.id;
    
    logSuccess('User registered successfully');
    logInfo(`Email: ${testEmail}`);
    logInfo(`User ID: ${userId}`);
    logInfo(`Device Token: ${deviceToken}`);
    
    if (!deviceToken) {
      logError('Device token not generated on registration!');
      return process.exit(1);
    }
    
    // Step 2: Verify token in profile
    logStep(2, 'Verifying device token in user profile');
    
    const profileResponse = await makeRequest({
      hostname: BASE_URL.replace('https://', '').replace('http://', '').split(':')[0],
      port: BASE_URL.split(':')[2] || (USE_HTTPS ? 443 : 80),
      path: '/api/users/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    if (profileResponse.statusCode !== 200 || !profileResponse.body.success) {
      logError(`Profile fetch failed: ${profileResponse.body.message}`);
      return process.exit(1);
    }
    
    const profileToken = profileResponse.body.data.deviceToken;
    if (profileToken !== deviceToken) {
      logError(`Token mismatch! Registration: ${deviceToken}, Profile: ${profileToken}`);
      return process.exit(1);
    }
    
    logSuccess('Device token verified in profile');
    logInfo(`Token matches: ${profileToken}`);
    
    // Step 3: Send test data to /autoupload
    logStep(3, 'Sending test data to /autoupload endpoint');
    
    const testData = {
      gravity: 1.020,
      ph: 6.5,
      osmo: 800,
      cond: 15,
      urea: 300,
      calc: 5
    };
    
    const uploadResponse = await makeRequest({
      hostname: BASE_URL.replace('https://', '').replace('http://', '').split(':')[0],
      port: BASE_URL.split(':')[2] || (USE_HTTPS ? 443 : 80),
      path: '/api/ml/autoupload',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'device-token': deviceToken
      }
    }, testData);
    
    if (uploadResponse.statusCode !== 201 || !uploadResponse.body.success) {
      logError(`Auto-upload failed: ${uploadResponse.body.message}`);
      return process.exit(1);
    }
    
    autoDataId = uploadResponse.body.data._id;
    const prediction = uploadResponse.body.prediction;
    
    logSuccess('Test data uploaded and processed');
    logInfo(`AutoData ID: ${autoDataId}`);
    logInfo(`Prediction Result: ${prediction === 0 ? 'Normal' : 'Kidney Stone'} (${prediction})`);
    logInfo(`Device ID: ${uploadResponse.body.data.deviceId}`);
    logInfo(`User ID: ${uploadResponse.body.data.userId}`);
    
    if (uploadResponse.body.data.userId !== userId) {
      logError(`User ID mismatch! Expected: ${userId}, Got: ${uploadResponse.body.data.userId}`);
      return process.exit(1);
    }
    
    // Step 4: Query /autodata by userId
    logStep(4, 'Querying /autodata by userId');
    
    const queryResponse = await makeRequest({
      hostname: BASE_URL.replace('https://', '').replace('http://', '').split(':')[0],
      port: BASE_URL.split(':')[2] || (USE_HTTPS ? 443 : 80),
      path: `/api/ml/autodata?userId=${userId}&limit=10`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    if (queryResponse.statusCode !== 200 || !queryResponse.body.success) {
      logError(`AutoData query failed: ${queryResponse.body.message}`);
      return process.exit(1);
    }
    
    const autoDataRecords = queryResponse.body.data;
    const foundRecord = autoDataRecords.find(record => record._id === autoDataId);
    
    if (!foundRecord) {
      logError('Uploaded record not found in query results!');
      return process.exit(1);
    }
    
    logSuccess('AutoData record retrieved successfully');
    logInfo(`Total records: ${autoDataRecords.length}`);
    logInfo(`Record found: ${foundRecord._id}`);
    logInfo(`User populated: ${foundRecord.userId?.name} (${foundRecord.userId?.email})`);
    logInfo(`Prediction: ${foundRecord.predictionResult}`);
    
    // Step 5: Test invalid token
    logStep(5, 'Testing invalid device token (security check)');
    
    const invalidResponse = await makeRequest({
      hostname: BASE_URL.replace('https://', '').replace('http://', '').split(':')[0],
      port: BASE_URL.split(':')[2] || (USE_HTTPS ? 443 : 80),
      path: '/api/ml/autoupload',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'device-token': 'invalid-token-12345'
      }
    }, testData);
    
    if (invalidResponse.statusCode === 401 && invalidResponse.body.message === 'Invalid device token') {
      logSuccess('Invalid token correctly rejected');
      logInfo('Security validation passed');
    } else {
      logError(`Expected 401 with "Invalid device token", got ${invalidResponse.statusCode}: ${invalidResponse.body.message}`);
      return process.exit(1);
    }
    
    // Step 6: Test token regeneration
    logStep(6, 'Testing device token regeneration');
    
    const regenerateResponse = await makeRequest({
      hostname: BASE_URL.replace('https://', '').replace('http://', '').split(':')[0],
      port: BASE_URL.split(':')[2] || (USE_HTTPS ? 443 : 80),
      path: '/api/users/regenerate-token',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (regenerateResponse.statusCode !== 200 || !regenerateResponse.body.success) {
      logError(`Token regeneration failed: ${regenerateResponse.body.message}`);
      return process.exit(1);
    }
    
    const newToken = regenerateResponse.body.data.deviceToken;
    
    if (newToken === deviceToken) {
      logError('Token not regenerated! Same token returned.');
      return process.exit(1);
    }
    
    logSuccess('Device token regenerated successfully');
    logInfo(`Old Token: ${deviceToken}`);
    logInfo(`New Token: ${newToken}`);
    
    // Verify old token is now invalid
    const oldTokenResponse = await makeRequest({
      hostname: BASE_URL.replace('https://', '').replace('http://', '').split(':')[0],
      port: BASE_URL.split(':')[2] || (USE_HTTPS ? 443 : 80),
      path: '/api/ml/autoupload',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'device-token': deviceToken
      }
    }, testData);
    
    if (oldTokenResponse.statusCode === 401) {
      logSuccess('Old token correctly invalidated');
    } else {
      logError('Old token still works! Security issue!');
      return process.exit(1);
    }
    
    // Summary
    log('\n╔════════════════════════════════════════════════════════════╗', 'bright');
    log('║                    Test Summary                            ║', 'bright');
    log('╚════════════════════════════════════════════════════════════╝', 'bright');
    
    logSuccess('All tests passed!');
    log('\nTest Results:', 'green');
    log('  ✓ User registration with auto-generated device token', 'green');
    log('  ✓ Device token visible in user profile', 'green');
    log('  ✓ IoT data upload with valid token', 'green');
    log('  ✓ AutoData record linked to user via userId', 'green');
    log('  ✓ Query AutoData by userId with user population', 'green');
    log('  ✓ Invalid token correctly rejected', 'green');
    log('  ✓ Token regeneration working', 'green');
    log('  ✓ Old token invalidated after regeneration', 'green');
    
    log('\nIoT Integration Status: READY', 'bright');
    log('ESP8266 devices can now use device tokens for automatic uploads.\n', 'blue');
    
    return process.exit(0);
    
  } catch (error) {
    logError(`\nTest failed with error: ${error.message}`);
    console.error(error);
    return process.exit(1);
  }
}

// Run tests
runTests();
