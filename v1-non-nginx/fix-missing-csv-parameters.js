const mongoose = require('mongoose');
require('dotenv').config({ path: '.env.v1' });

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:2711297449072@172.29.156.41:27017/urine-disease-detection?directConnection=true&authSource=admin';

// Check for dry-run flag
const isDryRun = process.argv.includes('--dry-run');

console.log('========================================');
console.log('Fix Missing CSV Parameters Script');
console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE UPDATE'}`);
console.log('========================================\n');

// Helper: Derive turbidity level from NTU value
const getTurbidityLevel = (ntu) => {
  if (ntu < 10) return 'Jernih';
  if (ntu < 30) return 'Agak Keruh';
  return 'Keruh';
};

// Helper: Derive warna dasar from RGB values
const getWarnaDasar = (red, green, blue) => {
  // All high values (white/clear)
  if (red > 240 && green > 240 && blue > 240) return 'BENING';
  
  // Yellow dominant (high red and green, lower blue)
  if (red > 200 && green > 180 && blue < 150) return 'KUNING';
  
  // Orange (high red, moderate green)
  if (red > 220 && green > 150 && green < 200 && blue < 100) return 'ORANYE';
  
  // Brown (moderate red, lower green and blue)
  if (red > 150 && red < 200 && green < 150 && blue < 100) return 'COKLAT';
  
  // Red dominant
  if (red > 200 && green < 150 && blue < 150) return 'MERAH';
  
  // Default to yellow for unclear cases
  return 'KUNING';
};

// Helper: Derive specific gravity from TDS (realistic approximation)
const getSpecificGravity = (tds) => {
  // Typical formula: SG ≈ 1.000 + (TDS / 100000)
  // TDS in ppm, result should be close to 1.000-1.030 range
  const sg = 1.000 + (tds / 100000);
  return parseFloat(sg.toFixed(3));
};

async function fixMissingParameters() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✓ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const predictionsCollection = db.collection('predictions');

    // Count predictions missing specificGravity (either null, undefined, or doesn't exist)
    const countQuery = {
      $or: [
        { 'parameters.specificGravity': { $exists: false } },
        { 'parameters.specificGravity': null },
        { 'parameters.specificGravity': undefined }
      ]
    };

    const totalMissing = await predictionsCollection.countDocuments(countQuery);
    console.log(`Found ${totalMissing} predictions missing specificGravity field\n`);

    if (totalMissing === 0) {
      console.log('✓ No predictions need updating. All have specificGravity field.');
      await mongoose.connection.close();
      return;
    }

    // Fetch predictions to update
    const predictions = await predictionsCollection.find(countQuery).toArray();
    console.log(`Processing ${predictions.length} predictions...\n`);

    let updated = 0;
    let errors = 0;

    for (const prediction of predictions) {
      try {
        const params = prediction.parameters || {};
        const updates = {};

        // Fix specificGravity
        if (!params.specificGravity && !params.specificgravity) {
          // Derive from TDS if available
          if (params.tds) {
            updates['parameters.specificGravity'] = getSpecificGravity(params.tds);
            console.log(`  [${prediction._id}] Derived specificGravity from TDS: ${updates['parameters.specificGravity']}`);
          } else {
            updates['parameters.specificGravity'] = 1.015; // Default realistic value
            console.log(`  [${prediction._id}] Set default specificGravity: 1.015`);
          }
        } else if (params.specificgravity && !params.specificGravity) {
          // Copy from lowercase variant
          updates['parameters.specificGravity'] = params.specificgravity;
          console.log(`  [${prediction._id}] Copied specificgravity → specificGravity: ${params.specificgravity}`);
        }

        // Fix turbidityNTU
        if (!params.turbidityNTU && !params.turbidityntu) {
          updates['parameters.turbidityNTU'] = 5.0; // Default clear urine
          console.log(`  [${prediction._id}] Set default turbidityNTU: 5.0`);
        } else if (params.turbidityntu && !params.turbidityNTU) {
          updates['parameters.turbidityNTU'] = params.turbidityntu;
          console.log(`  [${prediction._id}] Copied turbidityntu → turbidityNTU: ${params.turbidityntu}`);
        }

        // Fix turbidityLevel
        const ntuValue = updates['parameters.turbidityNTU'] || params.turbidityNTU || params.turbidityntu || 5.0;
        if (!params.turbidityLevel && !params.turbiditylevel) {
          updates['parameters.turbidityLevel'] = getTurbidityLevel(ntuValue);
          console.log(`  [${prediction._id}] Derived turbidityLevel: ${updates['parameters.turbidityLevel']} (from NTU: ${ntuValue})`);
        } else if (params.turbiditylevel && !params.turbidityLevel) {
          updates['parameters.turbidityLevel'] = params.turbiditylevel;
          console.log(`  [${prediction._id}] Copied turbiditylevel → turbidityLevel: ${params.turbiditylevel}`);
        }

        // Fix warnaDasar
        if (!params.warnaDasar && !params.warnadasar) {
          // Derive from RGB if available
          if (params.red !== undefined && params.green !== undefined && params.blue !== undefined) {
            updates['parameters.warnaDasar'] = getWarnaDasar(params.red, params.green, params.blue);
            console.log(`  [${prediction._id}] Derived warnaDasar: ${updates['parameters.warnaDasar']} (RGB: ${params.red},${params.green},${params.blue})`);
          } else {
            updates['parameters.warnaDasar'] = 'KUNING'; // Default
            console.log(`  [${prediction._id}] Set default warnaDasar: KUNING`);
          }
        } else if (params.warnadasar && !params.warnaDasar) {
          updates['parameters.warnaDasar'] = params.warnadasar;
          console.log(`  [${prediction._id}] Copied warnadasar → warnaDasar: ${params.warnadasar}`);
        }

        // Perform update if not dry-run
        if (Object.keys(updates).length > 0) {
          if (!isDryRun) {
            await predictionsCollection.updateOne(
              { _id: prediction._id },
              { $set: updates }
            );
            console.log(`  ✓ Updated prediction ${prediction._id}\n`);
          } else {
            console.log(`  [DRY RUN] Would update prediction ${prediction._id} with:`, updates, '\n');
          }
          updated++;
        }

      } catch (err) {
        console.error(`  ✗ Error processing prediction ${prediction._id}:`, err.message, '\n');
        errors++;
      }
    }

    console.log('\n========================================');
    console.log('Migration Summary');
    console.log('========================================');
    console.log(`Total predictions found: ${totalMissing}`);
    console.log(`Successfully ${isDryRun ? 'would update' : 'updated'}: ${updated}`);
    console.log(`Errors: ${errors}`);
    console.log('========================================\n');

    // Verification query
    if (!isDryRun) {
      console.log('Verification: Checking updated predictions...');
      const verifyQuery = {
        'parameters.specificGravity': { $exists: true, $ne: null }
      };
      const updatedCount = await predictionsCollection.countDocuments(verifyQuery);
      console.log(`✓ Predictions with specificGravity field: ${updatedCount}`);

      // Show sample
      const sample = await predictionsCollection.findOne(verifyQuery, { parameters: 1 });
      if (sample) {
        console.log('\nSample prediction parameters:');
        console.log(JSON.stringify(sample.parameters, null, 2));
      }
    }

    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Migration completed successfully');

  } catch (error) {
    console.error('✗ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
fixMissingParameters();
