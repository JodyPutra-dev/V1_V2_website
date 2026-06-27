const mongoose = require('mongoose');

// VERSION 2 (NGINX+PM2): Production-grade connection pool
// This demonstrates proper resource provisioning for high concurrent load
// With 50 max connections and 5 min connections:
//   - Handles 100+ concurrent requests without connection waiting
//   - Pre-warmed connections (5 min) reduce first-request latency
//   - Properly sized for production workloads
// This is the recommended configuration from MongoDB best practices
// for production deployments with high concurrent traffic.

// MongoDB connection string from environment or default
// Use a direct connection string with all options embedded
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:12345678@127.0.0.1:27017/urine-disease-detection?directConnection=true&authSource=admin';

// Track connection state and retry attempts
let isConnected = false;
let retryCount = 0;
const MAX_RETRIES = 10;

// Connection options - updated for newer MongoDB driver versions
const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000, // Increased timeout for slower servers
  socketTimeoutMS: 60000, // Increased for slow operations
  // Auto-create indexes in development but not in production for performance
  autoIndex: process.env.NODE_ENV !== 'production',
  // Add retry capability for initial connection
  connectTimeoutMS: 30000,
  // If not connected, return errors immediately rather than waiting for reconnect
  bufferCommands: false,
  // Connection pool settings (using newer format)
  maxPoolSize: 50,
  minPoolSize: 5
};

// Function to handle connection with exponential backoff
function connectToMongoDB() {
  // If already connected, return the existing connection
  if (mongoose.connection.readyState === 1) {
    console.log(`[MongoDB Service] Using existing MongoDB connection`);
    isConnected = true;
    retryCount = 0; // Reset retry count on successful connection
    return Promise.resolve(mongoose.connection);
  }
  
  // If connecting, wait for it to complete
  if (mongoose.connection.readyState === 2) {
    console.log(`[MongoDB Service] Connection already in progress, waiting...`);
    return new Promise((resolve, reject) => {
      mongoose.connection.once('connected', () => {
        isConnected = true;
        retryCount = 0; // Reset retry count on successful connection
        console.log(`[MongoDB Service] Successfully connected to MongoDB`);
        resolve(mongoose.connection);
      });
      
      mongoose.connection.once('error', (err) => {
        console.error('[MongoDB Service] Connection attempt failed:', err.message);
        reject(err);
      });
    });
  }
  
  // Calculate backoff delay with exponential increase and jitter
  const backoffDelay = Math.min(
    1000 * Math.pow(2, retryCount) + Math.random() * 1000,
    60000 // Max 60 seconds
  );
  
  // Log connection attempt
  if (retryCount > 0) {
    console.log(`[MongoDB Service] Attempting connection to MongoDB (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
    console.log(`[MongoDB Service] Waiting ${backoffDelay}ms before trying...`);
  } else {
    console.log(`[MongoDB Service] Connecting to MongoDB at ${MONGODB_URI.replace(/:[^:]*@/, ':****@')}`); // Hide password in logs
  }
  
  // Connect with promise
  return new Promise((resolve, reject) => {
    // If we've exceeded max retries, reject with error
    if (retryCount >= MAX_RETRIES) {
      const error = new Error(`[MongoDB Service] Max connection retries (${MAX_RETRIES}) exceeded. Giving up.`);
      console.error(error.message);
      return reject(error);
    }
    
    // Try a direct connection first
    try {
      console.log('[MongoDB Service] Attempting direct connection...');
      
      // Otherwise, attempt to connect
      mongoose.connect(MONGODB_URI, mongooseOptions)
        .then(() => {
          console.log(`[MongoDB Service] Successfully connected to MongoDB`);
          isConnected = true;
          retryCount = 0; // Reset retry count on successful connection
          resolve(mongoose.connection);
        })
        .catch(err => {
          console.error(`[MongoDB Service] MongoDB connection error:`, err.message);
          console.error(`[MongoDB Service] Error details:`, JSON.stringify({
            code: err.code,
            codeName: err.codeName,
            name: err.name,
            errorLabels: err.errorLabels || [],
            connectionGeneration: err.connectionGeneration
          }, null, 2));
          
          // Try to determine the specific error type
          if (err.name === 'MongoServerSelectionError') {
            console.error('[MongoDB Service] Server selection error - check if MongoDB is running and accessible');
          } else if (err.message.includes('Authentication failed')) {
            console.error('[MongoDB Service] Authentication failed - check username/password');
          } else if (err.message.includes('ECONNREFUSED')) {
            console.error('[MongoDB Service] Connection refused - check if MongoDB is running and the host/port is correct');
          }
          
          retryCount++; // Increment retry count
          
          // Try reconnecting after a delay using exponential backoff
          setTimeout(() => {
            connectToMongoDB()
              .then(resolve)
              .catch(reject);
          }, backoffDelay);
        });
    } catch (err) {
      console.error('[MongoDB Service] Error during connection setup:', err.message);
      retryCount++;
      
      // Try reconnecting after a delay
      setTimeout(() => {
        connectToMongoDB()
          .then(resolve)
          .catch(reject);
      }, backoffDelay);
    }
  });
}

// Monitor connection state
mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.log('[MongoDB Service] MongoDB disconnected. Reconnecting...');
  connectToMongoDB().catch(err => {
    console.error('[MongoDB Service] Failed to reconnect after disconnect:', err.message);
  });
});

mongoose.connection.on('error', (err) => {
  console.error('[MongoDB Service] MongoDB error:', err.message);
  console.error('[MongoDB Service] Error type:', err.name);
  
  // Only attempt reconnection if the connection was previously established
  if (isConnected) {
    isConnected = false;
    console.log('[MongoDB Service] Will attempt to reconnect after error...');
    connectToMongoDB().catch(err => {
      console.error('[MongoDB Service] Failed to reconnect after error:', err.message);
    });
  }
});

// Event listener for successful reconnection
mongoose.connection.on('reconnected', () => {
  console.log('[MongoDB Service] MongoDB reconnected successfully');
  isConnected = true;
  retryCount = 0; // Reset retry count on successful reconnection
});

// Add a simple test function to check MongoDB connectivity
async function testMongoDBConnection() {
  console.log('[MongoDB Service] Running MongoDB connection test...');
  
  try {
    // Try a direct connection with the MongoDB driver
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000
    });
    
    console.log('[MongoDB Service] Testing connection with MongoDB native driver...');
    await client.connect();
    console.log('[MongoDB Service] Successfully connected with MongoDB native driver');
    
    // Check server status
    const adminDb = client.db().admin();
    const serverStatus = await adminDb.serverStatus();
    console.log(`[MongoDB Service] MongoDB server version: ${serverStatus.version}`);
    console.log(`[MongoDB Service] MongoDB server uptime: ${serverStatus.uptime} seconds`);
    
    // List databases
    const dbList = await adminDb.listDatabases();
    console.log('[MongoDB Service] Available databases:');
    dbList.databases.forEach(db => {
      console.log(`  - ${db.name}`);
    });
    
    await client.close();
    console.log('[MongoDB Service] Connection test completed successfully');
    return true;
  } catch (error) {
    console.error('[MongoDB Service] Connection test failed:', error.message);
    if (error.name === 'MongoServerSelectionError') {
      console.error('[MongoDB Service] Server selection error - MongoDB server may not be running');
    }
    return false;
  }
}

// Export the mongoose instance and connection function
module.exports = {
  mongoose,
  connectToMongoDB,
  isConnected: () => isConnected,
  // Helper to check if connection is ready to use
  isReady: () => mongoose.connection.readyState === 1,
  // Get the connection URI (with password hidden)
  getConnectionUri: () => MONGODB_URI.replace(/:[^:]*@/, ':****@'),
  // Export the test function
  testMongoDBConnection
};

// If this file is run directly (not imported as a module), connect to MongoDB
if (require.main === module) {
  console.log('[MongoDB Service] Starting as standalone service');
  
  // Add timestamps to console logs for standalone mode
  const originalConsoleLog = console.log;
  console.log = function() {
    const args = Array.from(arguments);
    const timestamp = new Date().toISOString();
    originalConsoleLog.apply(console, [`${timestamp}:`].concat(args));
  };
  
  // Connection error handler to keep process alive even on connection errors
  const handleConnectionError = (err) => {
    console.error('[MongoDB Service] Connection error:', err.message);
    console.log('[MongoDB Service] Service will continue running and retry connection');
  };
  
  // Run the test function first to check if MongoDB is accessible
  testMongoDBConnection()
    .then(isConnected => {
      if (isConnected) {
        console.log('[MongoDB Service] MongoDB server is accessible and running');
      } else {
        console.error('[MongoDB Service] MongoDB server is not accessible. Check if it is running.');
      }
      
      // Connect to MongoDB using mongoose
      return connectToMongoDB();
    })
    .then(() => {
      console.log('[MongoDB Service] Successfully connected to MongoDB and ready to serve other microservices');
      
      // Log database information
      const db = mongoose.connection.db;
      console.log(`[MongoDB Service] Connected to database: ${db.databaseName}`);
      
      // Test the connection with a simple command
      return db.admin().serverStatus()
        .then(status => {
          console.log(`[MongoDB Service] MongoDB server version: ${status.version}`);
          console.log(`[MongoDB Service] MongoDB server uptime: ${status.uptime} seconds`);
        })
        .catch(err => {
          console.error('[MongoDB Service] Failed to get server status:', err.message);
        });
    })
    .catch(handleConnectionError);
    
  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('[MongoDB Service] Received SIGINT signal, closing MongoDB connection...');
    mongoose.connection.close(() => {
      console.log('[MongoDB Service] MongoDB connection closed');
      process.exit(0);
    });
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    console.error('[MongoDB Service] Uncaught exception:', err);
    console.log('[MongoDB Service] Service will continue running');
  });
} 