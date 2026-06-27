#!/usr/bin/env node

/**
 * ML Service Prediction Tests (Version 1 - No Queue)
 * 
 * Purpose: Test single, batch, and concurrent predictions to demonstrate
 * OOM behavior when no request queuing is implemented (V1 simplicity).
 * 
 * Usage:
 *   node test-ml-predictions.js          # Safe tests (single + batch)
 *   node test-ml-predictions.js --stress # Include stress tests (may cause OOM)
 * 
 * References:
 * - microservices/ml/ml-service.js (DISABLE_REQUEST_QUEUE=true)
 * - VERSION_1_BOTTLENECKS.md Bottleneck #4
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:3002';
const TEST_DATA = {
  gravity: 1.02,
  ph: 6.5,
  osmo: 500,
  cond: 15,
  urea: 300,
  calc: 5
};

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

/**
 * Test 1: Single Prediction (baseline)
 */
async function testSinglePrediction() {
  console.log(colors.bright + '\n=== Test 1: Single Prediction ===' + colors.reset);
  const start = Date.now();
  
  try {
    const response = await axios.post(`${ML_SERVICE_URL}/predict`, TEST_DATA, {
      timeout: 30000
    });
    const duration = Date.now() - start;
    
    console.log(colors.green + `✓ Success: ${duration}ms` + colors.reset);
    console.log(`  Result: ${response.data.predictedClass || response.data.prediction}`);
    console.log(`  Confidence: ${response.data.confidence || 'N/A'}`);
    
    return { success: true, time: duration, result: response.data };
  } catch (error) {
    const duration = Date.now() - start;
    console.error(colors.red + `✗ Failed: ${error.message}` + colors.reset);
    return { success: false, time: duration, error: error.message };
  }
}

/**
 * Test 2: Batch Predictions (sequential)
 */
async function testBatchPredictions(count = 10) {
  console.log(colors.bright + `\n=== Test 2: Batch Predictions (${count} sequential) ===` + colors.reset);
  const start = Date.now();
  const results = [];
  
  process.stdout.write('Progress: ');
  for (let i = 0; i < count; i++) {
    try {
      const response = await axios.post(`${ML_SERVICE_URL}/predict`, TEST_DATA, {
        timeout: 30000
      });
      results.push({ success: true, index: i, time: Date.now() - start });
      process.stdout.write(colors.green + '✓' + colors.reset);
    } catch (error) {
      results.push({ success: false, index: i, error: error.message, time: Date.now() - start });
      process.stdout.write(colors.red + '✗' + colors.reset);
    }
  }
  
  const duration = Date.now() - start;
  const successCount = results.filter(r => r.success).length;
  const avgTime = Math.round(duration / count);
  
  console.log('\n');
  console.log(`  Total: ${duration}ms, Success: ${successCount}/${count} (${Math.round(successCount/count*100)}%)`);
  console.log(`  Avg per request: ${avgTime}ms`);
  
  return { results, duration, successRate: successCount/count, avgTime };
}

/**
 * Test 3: Concurrent Predictions (stress test)
 */
async function testConcurrentPredictions(count = 50) {
  console.log(colors.bright + `\n=== Test 3: Concurrent Predictions (${count} simultaneous) ===` + colors.reset);
  console.log(colors.yellow + `⚠️  WARNING: This will spawn ${count} Python processes simultaneously` + colors.reset);
  console.log(colors.gray + `   Expected: OOM/errors at 50+ on 4GB server (V1 no queuing)` + colors.reset);
  console.log(colors.gray + '   Monitor with: watch -n 1 "free -h; ps aux | grep python | wc -l"\n' + colors.reset);
  
  const start = Date.now();
  const promises = Array(count).fill(null).map((_, i) => 
    axios.post(`${ML_SERVICE_URL}/predict`, TEST_DATA, {
      timeout: 30000
    })
      .then(response => ({ 
        success: true, 
        index: i, 
        time: Date.now() - start,
        result: response.data 
      }))
      .catch(error => ({ 
        success: false, 
        index: i, 
        time: Date.now() - start,
        error: error.message 
      }))
  );
  
  console.log('Launching requests...');
  const results = await Promise.all(promises);
  const duration = Date.now() - start;
  
  // Analyze results
  const successCount = results.filter(r => r.success).length;
  const failCount = count - successCount;
  const errorTypes = {};
  
  results.filter(r => !r.success).forEach(r => {
    const type = r.error.includes('ENOMEM') ? 'OOM' : 
                 r.error.includes('ECONNRESET') ? 'Connection Reset' :
                 r.error.includes('timeout') ? 'Timeout' : 
                 r.error.includes('ETIMEDOUT') ? 'Timeout' :
                 r.error.includes('socket hang up') ? 'Socket Hang Up' :
                 'Other';
    errorTypes[type] = (errorTypes[type] || 0) + 1;
  });
  
  const successTimes = results.filter(r => r.success).map(r => r.time);
  const avgSuccessTime = successTimes.length > 0 
    ? Math.round(successTimes.reduce((a, b) => a + b, 0) / successTimes.length) 
    : 0;
  const minTime = successTimes.length > 0 ? Math.min(...successTimes) : 0;
  const maxTime = successTimes.length > 0 ? Math.max(...successTimes) : 0;
  
  console.log('\n' + colors.bright + 'Results:' + colors.reset);
  console.log(`  Total time: ${duration}ms`);
  console.log(`  Success: ${colors.green}${successCount}${colors.reset}/${count} (${Math.round(successCount/count*100)}%)`);
  console.log(`  Failed: ${colors.red}${failCount}${colors.reset}/${count} (${Math.round(failCount/count*100)}%)`);
  
  if (Object.keys(errorTypes).length > 0) {
    console.log(`  Error breakdown: ${JSON.stringify(errorTypes)}`);
  }
  
  if (successCount > 0) {
    console.log(`  Response times (successful): min=${minTime}ms, max=${maxTime}ms, avg=${avgSuccessTime}ms`);
  }
  
  // Analysis
  console.log('\n' + colors.bright + 'Analysis:' + colors.reset);
  if (failCount > count * 0.2) {
    console.log(colors.red + `  ✗ High failure rate (${Math.round(failCount/count*100)}%) indicates resource exhaustion` + colors.reset);
    console.log(colors.gray + '    V1 spawns unlimited Python processes causing OOM/CPU thrashing' + colors.reset);
  } else if (avgSuccessTime > 2000) {
    console.log(colors.yellow + `  ⚠ High latency (${avgSuccessTime}ms avg) indicates resource contention` + colors.reset);
  } else {
    console.log(colors.green + '  ✓ System handled concurrent load well at this level' + colors.reset);
    console.log(colors.gray + `    Try higher concurrency: node test-ml-predictions.js --stress` + colors.reset);
  }
  
  return { results, duration, successRate: successCount/count, errorTypes, avgSuccessTime, minTime, maxTime };
}

/**
 * Test 4: CSV Batch Upload (informational)
 */
async function testCSVBatch() {
  console.log(colors.bright + '\n=== Test 4: CSV Batch Upload ===' + colors.reset);
  console.log(colors.gray + '  Note: CSV endpoint processes rows sequentially in V1' + colors.reset);
  console.log(colors.gray + '  For CSV testing, use Postman or curl with multipart/form-data' + colors.reset);
  console.log(colors.gray + '  Each row spawns Python without queue control (same OOM risk)\n' + colors.reset);
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('\n' + colors.bright + colors.cyan + '╔════════════════════════════════════════════════════════╗' + colors.reset);
  console.log(colors.bright + colors.cyan + '║  ML Service Prediction Tests (Version 1 - No Queue)   ║' + colors.reset);
  console.log(colors.bright + colors.cyan + '╚════════════════════════════════════════════════════════╝' + colors.reset);
  console.log(`${colors.gray}Target: ${ML_SERVICE_URL}${colors.reset}`);
  
  // Check service health
  try {
    await axios.get(`${ML_SERVICE_URL}/health`, { timeout: 5000 });
    console.log(colors.green + '✓ ML Service is healthy' + colors.reset);
  } catch (error) {
    console.error(colors.red + '✗ ML Service not reachable. Start with: ./start.sh' + colors.reset);
    process.exit(1);
  }
  
  const results = {};
  const startTime = Date.now();
  
  // Run safe tests
  results.single = await testSinglePrediction();
  results.batch10 = await testBatchPredictions(10);
  results.batch25 = await testBatchPredictions(25);
  
  // Concurrent tests (only if --stress flag provided)
  if (process.argv.includes('--stress')) {
    console.log(colors.yellow + '\n⚠️  Running STRESS TESTS (may cause OOM)...' + colors.reset);
    results.concurrent10 = await testConcurrentPredictions(10);
    results.concurrent50 = await testConcurrentPredictions(50);
    results.concurrent100 = await testConcurrentPredictions(100);
  } else {
    console.log(colors.yellow + '\n⚠️  Skipping stress tests (use --stress flag to enable)' + colors.reset);
    console.log(colors.gray + '   Stress tests spawn 50-100 processes and may cause OOM' + colors.reset);
    console.log(colors.gray + '   Run with: node test-ml-predictions.js --stress' + colors.reset);
  }
  
  await testCSVBatch();
  
  const totalDuration = Date.now() - startTime;
  
  // Summary
  console.log('\n' + colors.bright + colors.cyan + '╔════════════════════════════════════════════════════════╗' + colors.reset);
  console.log(colors.bright + colors.cyan + '║  Test Summary                                          ║' + colors.reset);
  console.log(colors.bright + colors.cyan + '╚════════════════════════════════════════════════════════╝' + colors.reset);
  console.log(`${colors.gray}Total test duration: ${totalDuration}ms${colors.reset}\n`);
  
  // Display summary statistics
  Object.keys(results).forEach(testName => {
    const result = results[testName];
    if (result.successRate !== undefined) {
      const statusColor = result.successRate >= 0.95 ? colors.green : 
                         result.successRate >= 0.7 ? colors.yellow : colors.red;
      console.log(`${testName.padEnd(20)} ${statusColor}${Math.round(result.successRate * 100)}% success${colors.reset} (${result.avgTime || result.avgSuccessTime || result.time}ms avg)`);
    }
  });
  
  // Save results
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  const resultsPath = path.join(logsDir, `ml-test-${Date.now()}.json`);
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\n${colors.gray}✓ Results saved to: ${resultsPath}${colors.reset}`);
  
  // Recommendations
  console.log('\n' + colors.bright + 'Recommendations:' + colors.reset);
  console.log(colors.gray + '  • V1 no queuing works for 1-25 concurrent users' + colors.reset);
  console.log(colors.gray + '  • Fails at 50+ concurrent due to unlimited Python spawning' + colors.reset);
  console.log(colors.gray + '  • V2 implements request queue (max 6 concurrent) + PM2 clustering' + colors.reset);
  console.log(colors.gray + '  • For production: Always use queuing + process management\n' + colors.reset);
}

// Run tests
runTests().catch(error => {
  console.error(colors.red + '\nUnexpected error:' + colors.reset, error);
  process.exit(1);
});
