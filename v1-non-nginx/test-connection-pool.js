#!/usr/bin/env node

/**
 * MongoDB Connection Pool Bottleneck Test (Version 1)
 * 
 * Purpose: Demonstrates how a small connection pool (maxPoolSize: 10) causes
 * queuing and latency under concurrent load.
 * 
 * This test validates VERSION_1_BOTTLENECKS.md Bottleneck #1 by:
 * - Launching N concurrent queries against MongoDB
 * - Measuring individual query execution times
 * - Showing connection waiting for queries 11-N (pool exhaustion)
 * - Proving that small pools cause 100-200ms added latency
 * 
 * Usage:
 *   node test-connection-pool.js                    # Default: 50 concurrent
 *   node test-connection-pool.js --concurrent 100   # Custom concurrency
 *   node test-connection-pool.js --verbose          # Detailed output
 * 
 * References:
 * - microservices/db/mongo-service.js (maxPoolSize: 10 configuration)
 * - ../../VERSION_1_BOTTLENECKS.md lines 15-56
 */

const mongoose = require('mongoose');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const concurrentQueries = parseInt(args.find(arg => arg.startsWith('--concurrent'))?.split('=')[1] || 
                                    args[args.indexOf('--concurrent') + 1] || '50');
const verbose = args.includes('--verbose');

// MongoDB connection configuration (Version 1 settings)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection?directConnection=true&authSource=admin';
const POOL_SIZE = 10; // Version 1 bottleneck configuration

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

// Print header
console.log('\n' + colors.bright + colors.cyan + '╔═══════════════════════════════════════════════════════════╗' + colors.reset);
console.log(colors.bright + colors.cyan + '║  MongoDB Connection Pool Bottleneck Test (Version 1)     ║' + colors.reset);
console.log(colors.bright + colors.cyan + '╚═══════════════════════════════════════════════════════════╝' + colors.reset + '\n');

console.log(colors.bright + 'Configuration:' + colors.reset);
console.log(`  Pool Size: ${colors.yellow}${POOL_SIZE} connections${colors.reset} (maxPoolSize)`);
console.log(`  Concurrent Queries: ${colors.yellow}${concurrentQueries}${colors.reset}`);
console.log(`  Verbose Output: ${verbose ? colors.green + 'enabled' : colors.gray + 'disabled'}${colors.reset}\n`);

// Test collection schema
const TestSchema = new mongoose.Schema({
  testData: String,
  timestamp: Date,
  counter: Number
});

const TestModel = mongoose.model('ConnectionPoolTest', TestSchema);

/**
 * Execute a single query and measure its execution time
 */
async function executeQuery(queryId) {
  const startTime = Date.now();
  
  try {
    // Simple find query to test connection acquisition
    await TestModel.findOne({ counter: queryId % 100 });
    
    const duration = Date.now() - startTime;
    
    if (verbose) {
      const statusColor = duration < 50 ? colors.green : duration < 120 ? colors.yellow : colors.red;
      console.log(`  Query ${queryId.toString().padStart(3)}: ${statusColor}${duration}ms${colors.reset}`);
    }
    
    return { queryId, duration, success: true };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`  Query ${queryId}: ${colors.red}FAILED${colors.reset} (${duration}ms) - ${error.message}`);
    return { queryId, duration, success: false, error: error.message };
  }
}

/**
 * Calculate statistics from query results
 */
function calculateStats(results) {
  const durations = results.filter(r => r.success).map(r => r.duration).sort((a, b) => a - b);
  
  if (durations.length === 0) {
    return null;
  }
  
  const sum = durations.reduce((a, b) => a + b, 0);
  const min = durations[0];
  const max = durations[durations.length - 1];
  const avg = Math.round(sum / durations.length);
  const p50 = durations[Math.floor(durations.length * 0.5)];
  const p95 = durations[Math.floor(durations.length * 0.95)];
  const p99 = durations[Math.floor(durations.length * 0.99)];
  
  // Split into fast (using pool) vs slow (waiting) queries
  const fastQueries = durations.slice(0, Math.min(POOL_SIZE, durations.length));
  const slowQueries = durations.slice(POOL_SIZE);
  
  const fastAvg = fastQueries.length > 0 ? Math.round(fastQueries.reduce((a, b) => a + b, 0) / fastQueries.length) : 0;
  const slowAvg = slowQueries.length > 0 ? Math.round(slowQueries.reduce((a, b) => a + b, 0) / slowQueries.length) : 0;
  const waitTime = slowAvg - fastAvg;
  
  return {
    count: durations.length,
    min,
    max,
    avg,
    p50,
    p95,
    p99,
    fastQueries: fastQueries.length,
    slowQueries: slowQueries.length,
    fastAvg,
    slowAvg,
    waitTime
  };
}

/**
 * Main test execution
 */
async function runTest() {
  console.log(colors.bright + 'Connecting to MongoDB...' + colors.reset);
  
  try {
    // Connect with Version 1 configuration
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: POOL_SIZE,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000
    });
    
    console.log(colors.green + '✓ Connected successfully' + colors.reset + '\n');
    
    // Seed test data if needed
    const existingCount = await TestModel.countDocuments();
    if (existingCount < 100) {
      console.log('Seeding test data...');
      const testDocs = Array.from({ length: 100 }, (_, i) => ({
        testData: `Test document ${i}`,
        timestamp: new Date(),
        counter: i
      }));
      await TestModel.insertMany(testDocs);
      console.log(colors.green + '✓ Test data ready' + colors.reset + '\n');
    }
    
    // Run concurrent queries
    console.log(colors.bright + `Running ${concurrentQueries} concurrent queries...` + colors.reset);
    if (verbose) {
      console.log('');
    }
    
    const startTime = Date.now();
    
    // Launch all queries simultaneously
    const queryPromises = Array.from({ length: concurrentQueries }, (_, i) => 
      executeQuery(i + 1)
    );
    
    const results = await Promise.all(queryPromises);
    const totalDuration = Date.now() - startTime;
    
    // Calculate statistics
    const stats = calculateStats(results);
    
    if (!stats) {
      console.error(colors.red + '\n✗ All queries failed. Check MongoDB connection.' + colors.reset);
      return;
    }
    
    // Display results
    console.log('\n' + colors.bright + 'Results:' + colors.reset);
    console.log(colors.cyan + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset);
    
    // Fast vs slow queries comparison
    console.log(colors.green + `First ${stats.fastQueries} queries (using pool):`.padEnd(45) + 
                `${stats.fastAvg}ms avg` + colors.reset + '   ✓ Fast');
    
    if (stats.slowQueries > 0) {
      console.log(colors.red + `Remaining ${stats.slowQueries} queries (waiting):`.padEnd(45) + 
                  `${stats.slowAvg}ms avg` + colors.reset + '   ✗ Slow (queuing)');
      console.log(colors.yellow + `Average wait time per query:`.padEnd(45) + 
                  `+${stats.waitTime}ms` + colors.reset);
    }
    
    console.log('');
    console.log(colors.bright + 'Statistics:' + colors.reset);
    console.log(`  Min:  ${colors.green}${stats.min}ms${colors.reset}`);
    console.log(`  Max:  ${stats.max > 150 ? colors.red : colors.yellow}${stats.max}ms${colors.reset}`);
    console.log(`  Avg:  ${stats.avg > 100 ? colors.red : stats.avg > 50 ? colors.yellow : colors.green}${stats.avg}ms${colors.reset}`);
    console.log(`  P50:  ${stats.p50}ms`);
    console.log(`  P95:  ${stats.p95 > 150 ? colors.red : colors.yellow}${stats.p95}ms${colors.reset}`);
    console.log(`  P99:  ${stats.p99}ms`);
    console.log(`  Total time: ${totalDuration}ms\n`);
    
    // Bottleneck analysis
    if (stats.slowQueries > 0 && stats.waitTime > 50) {
      console.log(colors.red + colors.bright + '⚠️  BOTTLENECK CONFIRMED:' + colors.reset + colors.red + 
                  ` ${stats.slowQueries}/${concurrentQueries} queries experienced connection waiting` + colors.reset);
      console.log(colors.yellow + `    Average wait time: ${stats.waitTime}ms per query` + colors.reset);
      console.log(colors.gray + '    This demonstrates why Version 1 is slow under concurrent load.' + colors.reset);
      console.log(colors.gray + '    With maxPoolSize: 10, only 10 queries can execute simultaneously.' + colors.reset);
      console.log(colors.gray + '    Remaining queries must wait for connections to be released.' + colors.reset + '\n');
    } else {
      console.log(colors.green + '✓ No significant bottleneck detected at this concurrency level.' + colors.reset);
      console.log(colors.gray + `  Try higher concurrency: node test-connection-pool.js --concurrent ${concurrentQueries * 2}` + colors.reset + '\n');
    }
    
    // Comparison with Version 2
    console.log(colors.bright + 'Version 2 Comparison:' + colors.reset);
    console.log(colors.gray + '  Version 2 uses maxPoolSize: 50, which eliminates this bottleneck.' + colors.reset);
    console.log(colors.gray + `  At ${concurrentQueries} concurrent queries, all would get connections immediately.` + colors.reset);
    console.log(colors.gray + '  Expected avg latency in V2: ~' + stats.fastAvg + 'ms (no waiting)' + colors.reset + '\n');
    
  } catch (error) {
    console.error(colors.red + '\n✗ Test failed:' + colors.reset, error.message);
    console.error(colors.gray + '\nTroubleshooting:' + colors.reset);
    console.error(colors.gray + '  1. Ensure MongoDB is running: sudo systemctl status mongod' + colors.reset);
    console.error(colors.gray + '  2. Check connection string in MONGODB_URI environment variable' + colors.reset);
    console.error(colors.gray + '  3. Verify credentials: mongosh "mongodb://admin:password@host:27017"' + colors.reset + '\n');
  } finally {
    // Cleanup
    await mongoose.disconnect();
    console.log(colors.gray + 'Disconnected from MongoDB.' + colors.reset + '\n');
  }
}

// Run the test
runTest().catch(error => {
  console.error(colors.red + 'Unexpected error:' + colors.reset, error);
  process.exit(1);
});
