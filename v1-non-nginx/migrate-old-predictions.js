const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection?authSource=admin', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Key mapping: lowercase -> camelCase
const keyMappings = {
  'specificgravity': 'specificGravity',
  'turbidityntu': 'turbidityNTU',
  'turbiditylevel': 'turbidityLevel',
  'warnadasar': 'warnaDasar'
};

const migrateParameters = async () => {
  try {
    await connectDB();
    
    const db = mongoose.connection.db;
    const predictionsCollection = db.collection('predictions');
    
    // Find predictions with any lowercase keys
    const query = {
      $or: [
        { 'parameters.specificgravity': { $exists: true } },
        { 'parameters.turbidityntu': { $exists: true } },
        { 'parameters.turbiditylevel': { $exists: true } },
        { 'parameters.warnadasar': { $exists: true } }
      ]
    };
    
    const predictions = await predictionsCollection.find(query).toArray();
    
    console.log(`\nFound ${predictions.length} predictions with lowercase parameter keys\n`);
    
    if (predictions.length === 0) {
      console.log('No migrations needed!');
      process.exit(0);
    }
    
    let updatedCount = 0;
    let errorCount = 0;
    
    for (const prediction of predictions) {
      try {
        const normalizedParams = { ...prediction.parameters };
        let modified = false;
        
        // Migrate lowercase keys to camelCase
        for (const [lowercaseKey, camelCaseKey] of Object.entries(keyMappings)) {
          if (normalizedParams[lowercaseKey] !== undefined) {
            // Copy value to camelCase key
            normalizedParams[camelCaseKey] = normalizedParams[lowercaseKey];
            // Delete lowercase key
            delete normalizedParams[lowercaseKey];
            modified = true;
            console.log(`  ✓ Migrated ${lowercaseKey} -> ${camelCaseKey} for prediction ${prediction._id}`);
          }
        }
        
        if (modified) {
          // Update the document
          await predictionsCollection.updateOne(
            { _id: prediction._id },
            { $set: { parameters: normalizedParams } }
          );
          updatedCount++;
          console.log(`  ✓ Updated prediction ${prediction._id}`);
        }
      } catch (error) {
        errorCount++;
        console.error(`  ✗ Error updating prediction ${prediction._id}:`, error.message);
      }
    }
    
    console.log(`\n=== Migration Summary ===`);
    console.log(`Total found: ${predictions.length}`);
    console.log(`Successfully updated: ${updatedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`========================\n`);
    
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

// Run migration
migrateParameters();
