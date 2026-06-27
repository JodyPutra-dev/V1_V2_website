/**
 * MongoDB Connection Test Script
 * 
 * This script tests direct connectivity to MongoDB without using mongoose
 * It can help diagnose connection issues
 */

const { MongoClient } = require('mongodb');

// MongoDB connection string
const MONGODB_URI = 'mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection?directConnection=true&authSource=admin';

// Connection options
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  connectTimeoutMS: 5000,
  serverSelectionTimeoutMS: 5000
};

async function testConnection() {
  console.log('Starting MongoDB connection test...');
  console.log(`Connecting to: ${MONGODB_URI.replace(/:[^:]*@/, ':****@')}`);
  
  try {
    // Create a new MongoClient
    const client = new MongoClient(MONGODB_URI, options);
    
    // Connect to the MongoDB server
    console.log('Attempting to connect...');
    await client.connect();
    console.log('Successfully connected to MongoDB server!');
    
    // Get server information
    const adminDb = client.db().admin();
    
    // Check if we can run the serverStatus command
    try {
      const serverStatus = await adminDb.serverStatus();
      console.log(`MongoDB server version: ${serverStatus.version}`);
      console.log(`MongoDB server uptime: ${serverStatus.uptime} seconds`);
      console.log(`MongoDB server process: ${serverStatus.process}`);
      console.log(`MongoDB server connections: ${JSON.stringify(serverStatus.connections)}`);
    } catch (err) {
      console.error('Failed to get server status:', err.message);
    }
    
    // List databases
    try {
      const dbList = await adminDb.listDatabases();
      console.log('Available databases:');
      dbList.databases.forEach(db => {
        console.log(`  - ${db.name} (${db.sizeOnDisk} bytes)`);
      });
    } catch (err) {
      console.error('Failed to list databases:', err.message);
    }
    
    // Close the connection
    await client.close();
    console.log('Connection closed successfully');
    return true;
  } catch (err) {
    console.error('MongoDB connection test failed:');
    console.error(`Error type: ${err.name}`);
    console.error(`Error message: ${err.message}`);
    
    if (err.name === 'MongoServerSelectionError') {
      console.error('Server selection error - MongoDB server may not be running or is not accessible');
      console.error('Check if MongoDB is running with: sudo systemctl status mongodb');
      console.error('Check if MongoDB is listening on the correct port: sudo lsof -i :27017');
      console.error('Check if MongoDB is bound to the correct IP in /etc/mongod.conf');
    } else if (err.name === 'MongoNetworkError') {
      console.error('Network error - Check firewall settings and network connectivity');
      console.error('Check if port 27017 is open: sudo ufw status');
    } else if (err.message.includes('Authentication failed')) {
      console.error('Authentication failed - Check username and password');
    }
    
    return false;
  }
}

// Run the test
testConnection()
  .then(success => {
    if (success) {
      console.log('MongoDB connection test completed successfully!');
      process.exit(0);
    } else {
      console.error('MongoDB connection test failed!');
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('Unexpected error during test:', err);
    process.exit(1);
  }); 