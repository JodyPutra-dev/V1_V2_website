const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { connectToMongoDB } = require('../db/mongo-service');

// Model Schema
const modelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  version: {
    type: String,
    required: true
  },
  active: {
    type: Boolean,
    default: true
  },
  accuracy: {
    type: Number,
    default: 0.92
  },
  filePath: {
    type: String,
    required: true
  },
  txtPath: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

// Register model
const Model = mongoose.model('Model', modelSchema);

// Ensure MongoDB connection is established
async function ensureMongoDBConnection() {
  try {
    if (mongoose.connection.readyState !== 1) {
      await connectToMongoDB();
    }
    return true;
  } catch (error) {
    console.error(`MongoDB connection error: ${error.message}`);
    return false;
  }
}

// Read model metadata from .txt file
function readModelMetadata(txtFilePath) {
  try {
    if (!fs.existsSync(txtFilePath)) {
      console.log(`Metadata file not found: ${txtFilePath}`);
      return null;
    }

    const content = fs.readFileSync(txtFilePath, 'utf8');
    const lines = content.split('\n');
    const metadata = {};

    lines.forEach(line => {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) {
        metadata[key.toLowerCase()] = value;
      }
    });

    return metadata;
  } catch (error) {
    console.error(`Error reading model metadata: ${error.message}`);
    return null;
  }
}

// Write model metadata to .txt file
function writeModelMetadata(txtFilePath, metadata) {
  try {
    const content = Object.entries(metadata)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    fs.writeFileSync(txtFilePath, content);
    return true;
  } catch (error) {
    console.error(`Error writing model metadata: ${error.message}`);
    return false;
  }
}

// Scan model directory for .joblib files
async function scanModelDirectory() {
  try {
    const modelDir = path.join(__dirname, '..', '..', 'MODEL-ML', 'joblib');
    const models = [];

    if (!fs.existsSync(modelDir)) {
      console.log(`Model directory not found: ${modelDir}`);
      return models;
    }

    const modelFolders = fs.readdirSync(modelDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const folder of modelFolders) {
      const folderPath = path.join(modelDir, folder);
      const joblibFiles = fs.readdirSync(folderPath)
        .filter(file => file.endsWith('.joblib'));

      for (const joblibFile of joblibFiles) {
        const joblibPath = path.join(folderPath, joblibFile);
        const txtFile = joblibFile.replace('.joblib', '.txt');
        const txtPath = path.join(folderPath, txtFile);

        // Read or create metadata
        let metadata = readModelMetadata(txtPath);
        if (!metadata) {
          metadata = {
            name: joblibFile.replace('.joblib', ''),
            version: '1.0.0',
            description: 'Auto-generated model',
            accuracy: '0.0'
          };
          writeModelMetadata(txtPath, metadata);
        }

        models.push({
          name: metadata.name,
          version: metadata.version,
          description: metadata.description,
          accuracy: parseFloat(metadata.accuracy) || 0,
          filePath: joblibPath,
          txtPath: txtPath,
          active: false
        });
      }
    }

    return models;
  } catch (error) {
    console.error(`Error scanning model directory: ${error.message}`);
    return [];
  }
}

// Update models in database
async function updateModelsInDatabase() {
  try {
    await ensureMongoDBConnection();

    // Get existing models from database
    const existingModels = await Model.find({});
    const existingPaths = new Set(existingModels.map(m => m.filePath));

    // Scan for new models
    const scannedModels = await scanModelDirectory();
    const newModels = scannedModels.filter(m => !existingPaths.has(m.filePath));

    // Add new models to database
    if (newModels.length > 0) {
      await Model.insertMany(newModels);
      console.log(`Added ${newModels.length} new models to database`);
    }

    // Update existing models
    for (const existingModel of existingModels) {
      const scannedModel = scannedModels.find(m => m.filePath === existingModel.filePath);
      if (scannedModel) {
        // Update metadata if changed
        if (
          existingModel.name !== scannedModel.name ||
          existingModel.version !== scannedModel.version ||
          existingModel.description !== scannedModel.description ||
          existingModel.accuracy !== scannedModel.accuracy
        ) {
          await Model.findByIdAndUpdate(existingModel._id, {
            name: scannedModel.name,
            version: scannedModel.version,
            description: scannedModel.description,
            accuracy: scannedModel.accuracy
          });
          console.log(`Updated model: ${scannedModel.name}`);
        }
      } else {
        // Model file no longer exists, mark as inactive
        if (existingModel.active) {
          await Model.findByIdAndUpdate(existingModel._id, { active: false });
          console.log(`Marked model as inactive: ${existingModel.name}`);
        }
      }
    }

    return true;
  } catch (error) {
    console.error(`Error updating models in database: ${error.message}`);
    return false;
  }
}

// Ensure default model exists
async function ensureDefaultModel() {
  try {
    await ensureMongoDBConnection();

    // Check if any active model exists
    const activeModel = await Model.findOne({ active: true });
    if (activeModel) {
      return true;
    }

    // Get all models
    const models = await Model.find({});
    if (models.length === 0) {
      console.log('No models found in database');
      return false;
    }

    // Activate the first model
    await Model.findByIdAndUpdate(models[0]._id, { active: true });
    console.log(`Activated default model: ${models[0].name}`);

    return true;
  } catch (error) {
    console.error(`Error ensuring default model: ${error.message}`);
    return false;
  }
}

// Clean up duplicate models
async function cleanupDuplicateModels() {
  try {
    await ensureMongoDBConnection();

    // Get all models
    const models = await Model.find({});
    const seenPaths = new Set();
    const duplicates = [];

    // Find duplicates
    for (const model of models) {
      if (seenPaths.has(model.filePath)) {
        duplicates.push(model._id);
      } else {
        seenPaths.add(model.filePath);
      }
    }

    // Remove duplicates
    if (duplicates.length > 0) {
      await Model.deleteMany({ _id: { $in: duplicates } });
      console.log(`Removed ${duplicates.length} duplicate models`);
    }

    return true;
  } catch (error) {
    console.error(`Error cleaning up duplicate models: ${error.message}`);
    return false;
  }
}

// Get all models
async function getModels() {
  try {
    await ensureMongoDBConnection();
    return await Model.find({}).sort({ createdAt: -1 });
  } catch (error) {
    console.error(`Error getting models: ${error.message}`);
    return [];
  }
}

// Initialize the service
async function initialize() {
  try {
    console.log('Initializing model service...');
    
    // Ensure MongoDB connection
    await ensureMongoDBConnection();
    
    // Update models in database
    await updateModelsInDatabase();
    
    // Clean up duplicates
    await cleanupDuplicateModels();
    
    // Ensure default model
    await ensureDefaultModel();
    
    console.log('Model service initialization completed');
    return true;
  } catch (error) {
    console.error(`Error initializing model service: ${error.message}`);
    return false;
  }
}

module.exports = {
  Model,
  ensureMongoDBConnection,
  readModelMetadata,
  writeModelMetadata,
  scanModelDirectory,
  updateModelsInDatabase,
  ensureDefaultModel,
  cleanupDuplicateModels,
  getModels,
  initialize
}; 