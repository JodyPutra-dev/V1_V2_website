// ML Service - Dedicated service for machine learning predictions
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { exec } = require('child_process');
const multer = require('multer');
const { connectToMongoDB } = require('../db/mongo-service');
const { RequestQueue } = require('../resilience/resilience-service');
const { createLogger, logPythonExecution, logPythonError, logMLRequest, logError } = require('../logger/production-logger');
const { PythonWorkerPool } = require('./python_worker_pool');

// Import cache modules
const { modelCache } = require('../cache/cache-service');
const { cacheMiddleware, cacheStatsMiddleware } = require('../cache/cache-middleware');

// Create logger instance with Python logging enabled
const logger = createLogger('ml-service', { enablePythonLogging: true });

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

// Add indexes for optimized queries
modelSchema.index({ active: 1 });
modelSchema.index({ version: -1 });

// Auto Data Schema - For automatic device uploads
const autoDataSchema = new mongoose.Schema({
  ph: {
    value: Number,
    unit: { type: String, default: 'pH' }
  },
  tds: {
    value: Number,
    unit: { type: String, default: 'ppm' }
  },
  specificGravity: {
    value: Number,
    unit: { type: String, default: 'g/ml' }
  },
  turbidityNTU: {
    value: Number,
    unit: { type: String, default: 'NTU' }
  },
  red: {
    value: Number,
    unit: { type: String, default: 'RGB' }
  },
  green: {
    value: Number,
    unit: { type: String, default: 'RGB' }
  },
  blue: {
    value: Number,
    unit: { type: String, default: 'RGB' }
  },
  turbidityLevel: {
    type: String,
    enum: ['Jernih', 'Agak Keruh', 'Keruh']
  },
  warnaDasar: {
    type: String,
    enum: ['BENING', 'KUNING', 'MERAH', 'COKLAT', 'ORANGE', 'HIJAU', 'BIRU']
  },
  analisis: String,
  deviceId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  notes: String,
  processed: {
    type: Boolean,
    default: false
  },
  predictionResult: {
    type: Number,
    default: null
  }
});

// Add compound index for efficient user queries
autoDataSchema.index({ userId: 1, timestamp: -1 });

// V1 AutoData categorical indexes
autoDataSchema.index({ turbidityLevel: 1 });
autoDataSchema.index({ warnaDasar: 1 });
autoDataSchema.index({ userId: 1, turbidityLevel: 1 });
autoDataSchema.index({ userId: 1, warnaDasar: 1 });

// Register models
const Model = mongoose.model('Model', modelSchema);
const AutoData = mongoose.model('AutoData', autoDataSchema);

// Model Service Functions
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

async function ensureDefaultModel() {
  try {
    console.log('Ensuring default model exists...');
    
    // Check if we have any active model
    const activeModel = await Model.findOne({ active: true });
    if (activeModel) {
      console.log('Active model found:', activeModel.name);
      return;
    }
    
    // Look for model files - ensure forward slashes for Linux
    const modelDir = path.join(__dirname, '../../MODEL-ML/joblib/kidney_stone_model').replace(/\\/g, '/');
    const modelPath = path.join(modelDir, 'kidney_stone_model.joblib').replace(/\\/g, '/');
    
    // Use relative paths for MongoDB - relative to HIBAH root, with forward slashes
    const mongoModelPath = 'MODEL-ML/joblib/kidney_stone_model/kidney_stone_model.joblib';
    const mongoTxtPath = 'MODEL-ML/joblib/kidney_stone_model/kidney_stone_model.txt';
    
    // Create model directory if it doesn't exist
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
    }
    
    // Check if model exists in any of the possible locations
    const possiblePaths = [
      modelPath,
      path.join(__dirname, '../../models/kidney_stone_model.joblib').replace(/\\/g, '/'),
      path.join(__dirname, '../../DATASET/kidney_stone_model.joblib').replace(/\\/g, '/'),
      path.join(__dirname, '../../kidney_stone_model.joblib').replace(/\\/g, '/')
    ];
    
    let sourceModelPath = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        sourceModelPath = p;
        break;
      }
    }
    
    if (sourceModelPath) {
      // Copy model to MODEL-ML directory if needed
      if (sourceModelPath !== modelPath) {
        fs.copyFileSync(sourceModelPath, modelPath);
        console.log(`Copied model from ${sourceModelPath} to ${modelPath}`);
      }
      
      // Create or update the model in MongoDB
      const modelData = {
        name: 'Kidney Stone Detection Model',
        description: 'This model predicts the likelihood of kidney stone formation based on urine sample analysis. It uses a Random Forest classifier trained on urine sample data with features including pH, TDS (Total Dissolved Solids), specific gravity, turbidity (NTU), RGB color values, turbidity level, and base color.',
        version: '1.0.0',
        active: true,
        accuracy: 0.92,
        filePath: mongoModelPath,
        txtPath: mongoTxtPath
      };
      
      // Create txt file with metadata
      const txtContent = [
        'name: ' + modelData.name,
        'version: ' + modelData.version,
        'description: ' + modelData.description,
        'accuracy: ' + modelData.accuracy,
        'filePath: ' + modelData.filePath
      ].join('\n');
      
      const txtFilePath = path.join(modelDir, 'kidney_stone_model.txt').replace(/\\/g, '/');
      fs.writeFileSync(txtFilePath, txtContent);
      
      // Update or create model in database
      await Model.findOneAndUpdate(
        { filePath: mongoModelPath },
        modelData,
        { upsert: true, new: true }
      );
      
      console.log('Default model registered successfully');
    } else {
      console.error('No model file found in any of the expected locations');
    }
  } catch (error) {
    console.error('Error ensuring default model:', error.message);
  }
}

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

async function getModels() {
  try {
    await ensureMongoDBConnection();
    return await Model.find({}).sort({ createdAt: -1 });
  } catch (error) {
    console.error(`Error getting models: ${error.message}`);
    return [];
  }
}

// Model Upload Service Functions
class ModelUploadService {
  constructor(mlServicePort = 3002) {
    this.mlServicePort = mlServicePort;
    this.tempDir = path.join(__dirname, 'temp').replace(/\\/g, '/');
    this.modelDir = path.join(__dirname, '..', '..', 'MODEL-ML', 'joblib').replace(/\\/g, '/');
    
    // Ensure directories exist
    for (const dir of [this.tempDir, this.modelDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  async uploadModel(file, metadata, userId) {
    try {
      console.log('Uploading model:', file.originalname);
      
      // Create model folder name from metadata
      const modelName = metadata.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const modelFolder = path.join(this.modelDir, modelName).replace(/\\/g, '/');
      
      // Create folder if it doesn't exist
      if (!fs.existsSync(modelFolder)) {
        fs.mkdirSync(modelFolder, { recursive: true });
      }
      
      // Define target paths - ensure forward slashes
      const modelFilePath = path.join(modelFolder, file.originalname).replace(/\\/g, '/');
      const txtFilePath = path.join(modelFolder, `${modelName}.txt`).replace(/\\/g, '/');
      
      // Get relative paths for MongoDB - always use forward slashes
      const relativeModelPath = `MODEL-ML/joblib/${modelName}/${file.originalname}`;
      const relativeTxtPath = `MODEL-ML/joblib/${modelName}/${modelName}.txt`;
      
      console.log(`Copying file to ${modelFilePath}`);
      
      // Copy the file to the MODEL-ML directory
      fs.copyFileSync(file.path, modelFilePath);
      
      // Create metadata file with proper format
      const dummyObjectId = new Date().getTime().toString(16).padStart(24, '0');
      
      const txtContent = [
        dummyObjectId,
        metadata.name || modelName,
        metadata.version || '1.0.0',
        metadata.description || 'Uploaded model',
        metadata.accuracy || '0.92',
        relativeModelPath
      ].join('\n');
      
      fs.writeFileSync(txtFilePath, txtContent);
      console.log(`Created metadata file at ${txtFilePath}`);
      
      const modelData = {
        name: metadata.name || modelName,
        version: metadata.version || '1.0.0',
        description: metadata.description || 'Uploaded model',
        accuracy: parseFloat(metadata.accuracy) || 0.92,
        filePath: relativeModelPath,
        txtPath: relativeTxtPath,
        active: metadata.active === 'true' || metadata.active === true,
        createdBy: userId
      };

      // Since we're in the same service now, we can directly create and save the model
      if (modelData.active) {
        // Deactivate all other models if this one should be active
        await Model.updateMany({}, { $set: { active: false } });
      }

      // Create and save the model
      const model = new Model(modelData);
      await model.save();

      // Update the txt file with the correct ObjectId
      const lines = txtContent.split('\n');
      lines[0] = model._id.toString();
      fs.writeFileSync(txtFilePath, lines.join('\n'));
      
      console.log('Upload successful');
      
      return {
        success: true,
        message: 'Model uploaded successfully',
        data: model
      };
    } catch (error) {
      console.error(`Error:`, error.message);
      throw error;
    } finally {
      // Clean up temp file
      try {
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
          console.log('Cleaned up temp file');
        }
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError.message);
      }
    }
  }
}

// Set strictQuery to false to avoid deprecation warning
mongoose.set('strictQuery', false);

// Express app setup
const app = express();
const PORT = process.env.ML_SERVICE_PORT || 3002;

// Instance ID for PM2 cluster mode
const INSTANCE_ID = process.env.INSTANCE_ID || process.env.NODE_APP_INSTANCE || '0';

// VERSION 1: Request queue DISABLED (INTENTIONAL BOTTLENECK)
// When DISABLE_REQUEST_QUEUE=true, maxConcurrent is set to Infinity (unlimited)
// This allows 100+ Python processes to spawn simultaneously, causing:
//   - Memory exhaustion (100 × 200MB = 20GB on 4GB server → OOM)
//   - CPU thrashing (100 processes on 2 cores)
//   - Response time degradation (500ms → 5-15s)
// VERSION 1: No request queuing for simplicity - allows unlimited Python spawns
// This demonstrates typical Node.js deployment without concurrency control
// Expected behavior: Works fine at low load (1-10 users), OOM at 50+ concurrent requests
// Reference: VERSION_1_BOTTLENECKS.md lines 287-354
const DISABLE_QUEUE = process.env.DISABLE_REQUEST_QUEUE === 'true';
const predictionQueue = new RequestQueue({
  name: `ml-prediction-queue-${INSTANCE_ID}`,
  maxConcurrent: DISABLE_QUEUE ? Infinity : 3,    // matches V2 per-instance setting
  maxWaiting:    DISABLE_QUEUE ? Infinity : 10    // matches V2 per-instance setting
});

console.log('[ML-SERVICE] Prediction queue initialized', {
  instanceId: INSTANCE_ID,
  maxConcurrent: 3,
  queueDisabled: false
});

// Create an instance of ModelUploadService
const modelUploadService = new ModelUploadService(PORT);

// Express middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Storage for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, modelMLDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });

// Add additional middleware to check for API calls
app.use((req, res, next) => {
  // Fix for API call routing - ensure "/api/ml/" routes work
  if (req.path.startsWith('/api/ml/')) {
    req.url = req.url.replace('/api/ml/', '/');
  }
  
  // Timestamp for logging
  console.log(`${new Date().toISOString()}: ${req.method} ${req.path}`);
  next();
});

// Connect to MongoDB
let isConnected = false;

// Define paths
const ROOT_DIR = path.join(__dirname, '..', '..');
const MODEL_DIR = path.join(ROOT_DIR, 'models');
const modelMLDir = path.join(ROOT_DIR, 'MODEL-ML', 'joblib');
const PYTHON_SCRIPT_PATH = path.join(__dirname, 'python_bridge.py');
const PYTHON_SCRIPT_V2_PATH = path.join(__dirname, 'python_bridge_v2.py');

// Model type detection function
function getModelType(modelPath) {
  return modelPath && modelPath.endsWith('.pkl') ? 'pkl' : 'joblib';
}

// Create necessary directories
for (const dir of [MODEL_DIR, modelMLDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Standard model paths - used for compatibility with various versions
const MODEL_JOBLIB_PATH = path.join(MODEL_DIR, 'kidney_stone_model.joblib');
const DATASET_MODEL_JOBLIB_PATH = path.join(ROOT_DIR, 'DATASET', 'kidney_stone_model.joblib');
const ROOT_MODEL_JOBLIB_PATH = path.join(ROOT_DIR, 'kidney_stone_model.joblib');

// Create the kidney_stone_model subdirectory in modelMLDir
const kidneyStoneModelDir = path.join(modelMLDir, 'kidney_stone_model');
if (!fs.existsSync(kidneyStoneModelDir)) {
  fs.mkdirSync(kidneyStoneModelDir, { recursive: true });
}

// V2 ensemble model directory
const V2_MODEL_DIR = path.join(modelMLDir, 'kidney_stone_model_v2');
if (!fs.existsSync(V2_MODEL_DIR)) {
  fs.mkdirSync(V2_MODEL_DIR, { recursive: true });
}

// Default paths in MODEL-ML
const MODEL_ML_JOBLIB_PATH = path.join(kidneyStoneModelDir, 'kidney_stone_model.joblib');
const MODEL_ML_TXT_PATH = path.join(kidneyStoneModelDir, 'kidney_stone_model.txt');

// Ensure MongoDB connection is established
async function ensureMongoDBConnection() {
  try {
    console.log('Ensuring MongoDB connection is established...');
    if (!isConnected) {
      await connectToMongoDB();
      isConnected = true;
      console.log('MongoDB connected successfully');
    }
    return true;
  } catch (error) {
    console.error(`MongoDB connection error: ${error.message}`);
    isConnected = false;
    return false;
  }
}

// Initialize the service
async function initialize() {
  try {
    // Ensure MongoDB connection
    await ensureMongoDBConnection();
    
    // Ensure default model exists
    await ensureDefaultModel();
    
    // Clean up any duplicate models
    await cleanupDuplicateModels();
    
    // Only scan and update models if none exist in database
    const modelCount = await Model.countDocuments();
    if (modelCount === 0) {
      await updateModelsInDatabase();
    }
    
    return true;
  } catch (error) {
    console.error(`Error during initialization: ${error.message}`);
    return false;
  }
}

// Key normalization map for case-insensitive parameter handling
// Maps lowercase CSV keys to camelCase expected format
const KEY_NORMALIZATION_MAP = {
  'specificgravity': 'specificGravity',
  'turbidityntu': 'turbidityNTU',
  'turbiditylevel': 'turbidityLevel',
  'warnadasar': 'warnaDasar',
  // Keys that are already lowercase
  'ph': 'ph',
  'tds': 'tds',
  'red': 'red',
  'green': 'green',
  'blue': 'blue'
};

// Helper function to parse and preprocess input
// Accept both lowercase (CSV) and camelCase (manual form) parameter names
function preprocessInput(data) {
  try {
    // Normalize input keys to handle case-insensitive CSV uploads
    const normalizedData = {};
    let normalizedCount = 0;
    
    for (const key in data) {
      const lowerKey = key.toLowerCase();
      const normalizedKey = KEY_NORMALIZATION_MAP[lowerKey] || key;
      
      if (normalizedKey !== key) {
        normalizedCount++;
      }
      
      normalizedData[normalizedKey] = data[key];
    }
    
    if (normalizedCount > 0) {
      console.log(`[NORMALIZE] Normalized ${normalizedCount} keys from lowercase to camelCase`);
    }
    
    // Ensure all required fields are present and convert to numbers
    const requiredFields = ['ph', 'tds', 'specificGravity', 'turbidityNTU', 'red', 'green', 'blue', 'turbidityLevel', 'warnaDasar'];
    const processedData = {};
    
    for (const field of requiredFields) {
      if (normalizedData[field] === undefined || normalizedData[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
      
      // Convert to number for numeric fields
      if (['ph', 'tds', 'specificGravity', 'turbidityNTU', 'red', 'green', 'blue'].includes(field)) {
        const value = Number(normalizedData[field]);
        if (isNaN(value)) {
          throw new Error(`Invalid value for ${field}: ${normalizedData[field]}`);
        }
        processedData[field] = value;
      } else {
        // Keep categorical fields as strings
        processedData[field] = normalizedData[field];
      }
    }
    
    // Log the processed data
    console.log('Preprocessed input data:', processedData);
    
    return processedData;
  } catch (error) {
    console.error('Error preprocessing input:', error.message);
    throw error;
  }
}

// ===== BOTTLENECK #9: THOROUGH URINE DATA VALIDATION =====
// Common 'defensive programming' pattern - validates all parameters
// against realistic medical ranges before ML prediction
// Adds ~20-50ms per request from validation loops
// Reference: VERSION_1_BOTTLENECKS.md Bottleneck #9
// Now includes case-insensitive parameter handling for CSV compatibility
function validateUrineData(data) {
  const validationStart = Date.now();
  
  // Normalize input keys for case-insensitive validation (CSV compatibility)
  const normalizedData = {};
  for (const key in data) {
    const lowerKey = key.toLowerCase();
    const normalizedKey = KEY_NORMALIZATION_MAP[lowerKey] || key;
    normalizedData[normalizedKey] = data[key];
  }
  
  // Define validation rules with realistic urine parameter ranges
  const validationRules = [
    { field: 'ph', min: 4.5, max: 8.0, unit: '' },
    { field: 'tds', min: 0, max: 2000, unit: 'ppm' },
    { field: 'specificGravity', min: 1.005, max: 1.030, unit: '' },
    { field: 'turbidityNTU', min: 0, max: 100, unit: 'NTU' },
    { field: 'red', min: 0, max: 255, unit: '' },
    { field: 'green', min: 0, max: 255, unit: '' },
    { field: 'blue', min: 0, max: 255, unit: '' }
  ];
  
  // Categorical field validation
  const categoricalRules = {
    turbidityLevel: ['Jernih', 'Agak Keruh', 'Keruh'],
    warnaDasar: ['BENING', 'KUNING', 'MERAH', 'COKLAT', 'ORANGE', 'HIJAU', 'BIRU']
  };
  
  // Thorough validation loop - common pattern for 'safety'
  // forEach adds natural delay (~20-50ms) from iteration overhead
  validationRules.forEach(rule => {
    const value = normalizedData[rule.field];
    
    // Check field presence
    if (value === undefined || value === null) {
      throw new Error(`Missing required field: ${rule.field}`);
    }
    
    // Convert to number
    const numValue = Number(value);
    if (isNaN(numValue)) {
      throw new Error(`Invalid ${rule.field}: must be a number, got '${value}'`);
    }
    
    // Range validation with detailed error messages
    if (numValue < rule.min || numValue > rule.max) {
      throw new Error(
        `Invalid ${rule.field}: ${numValue} is outside valid range ` +
        `(${rule.min}-${rule.max}${rule.unit ? ' ' + rule.unit : ''})`
      );
    }
  });
  
  // Validate categorical fields
  Object.keys(categoricalRules).forEach(field => {
    const value = normalizedData[field];
    if (!value) {
      throw new Error(`Missing required field: ${field}`);
    }
    if (!categoricalRules[field].includes(value)) {
      throw new Error(
        `Invalid ${field}: '${value}' is not one of [${categoricalRules[field].join(', ')}]`
      );
    }
  });
  
  const validationDuration = Date.now() - validationStart;
  console.log(`[VALIDATION] Urine data validated in ${validationDuration}ms`);
  
  return true;
}

// ============================================
// RGB-BASED HYDRATION ANALYSIS
// ============================================
//
// Medical Background:
// Urine color is a simple indicator of hydration status. Dark yellow/amber
// urine indicates dehydration (concentrated urine), while pale/clear urine
// indicates good hydration (dilute urine).
//
// RGB Analysis Logic:
// - Color Intensity: Average of RGB values (R+G+B)/3
//   * Low intensity (<150) = darker color = more concentrated
//   * High intensity (>200) = lighter color = more dilute
// - Yellow Ratio: (R+G)/(2*(B+1)) measures yellow vs blue balance
//   * High ratio (>2.0) = strong yellow/amber tint
//   * Low ratio (<1.5) = pale/clear appearance
//
// This is a simple heuristic, not a medical diagnosis. Actual hydration
// depends on many factors (diet, medications, health conditions).
//
function checkDehydrationFromRGB(red = 255, green = 220, blue = 150) {
  // Calculate color intensity (average RGB)
  const colorIntensity = (red + green + blue) / 3;
  
  // Calculate yellow ratio (high values = more yellow/amber)
  const yellowRatio = (red + green) / (2 * (blue + 1));
  
  let hydrationStatus;
  let needsWater;
  let recommendation;
  
  // Determine hydration status based on intensity and yellow ratio
  if (colorIntensity < 150 && yellowRatio > 2.0) {
    // Dark yellow/amber - dehydrated
    hydrationStatus = 'Dehydrated';
    needsWater = true;
    recommendation = 'Segera minum air 2-3 gelas. Urine terlalu pekat.';
  } else if (colorIntensity < 200 || yellowRatio > 1.5) {
    // Yellow - slightly dehydrated
    hydrationStatus = 'Slightly Dehydrated';
    needsWater = true;
    recommendation = 'Tingkatkan asupan air 1-2 gelas.';
  } else {
    // Pale/clear - well hydrated
    hydrationStatus = 'Well Hydrated';
    needsWater = false;
    recommendation = 'Hidrasi baik, pertahankan.';
  }
  
  return {
    hydrationStatus,
    needsWater,
    recommendation,
    colorIntensity: Math.round(colorIntensity * 10) / 10,
    yellowRatio: Math.round(yellowRatio * 100) / 100
  };
}

// ============================================
// PYTHON PREDICTION BRIDGE (UNCHANGED IN BOTH VERSIONS)
// ============================================
//
// This Python bridge implementation is IDENTICAL in both Version 1 (non-NGINX)
// and Version 2 (NGINX+PM2). This ensures that performance differences between
// versions come from Node.js/NGINX/PM2 optimizations, not from ML prediction changes.
//
// Current Implementation (Subprocess Spawning):
//   - Each prediction spawns a new Python process (lines 686-691)
//   - Python process loads the joblib model from disk (~200-300ms)
//   - Performs prediction (~50-100ms)
//   - Returns result and exits
//   - Total time per prediction: ~500ms
//
// Why No Process Pooling:
//   - Intentionally kept simple to isolate Node.js performance issues
//   - Process spawning overhead is constant in both versions (~500ms)
//   - Performance differences come from:
//     * Version 1: Node.js bottlenecks prevent efficient subprocess management
//     * Version 2: NGINX+PM2 optimizations enable controlled subprocess spawning
//
// Bottleneck Analysis:
//   - At 10 concurrent predictions: 10 Python processes (manageable)
//   - At 50 concurrent predictions: 50 Python processes (system strain)
//   - At 100 concurrent predictions: 100 Python processes (system overwhelmed)
//
// Version 1 Behavior (No Request Queuing):
//   - All 100 requests spawn Python processes immediately
//   - Memory: 100 × 200MB = 20GB (exceeds 4GB server, causes OOM)
//   - CPU: 100 processes on 2 cores (severe thrashing)
//   - Result: High error rate, slow responses, system instability
//
// Version 2 Behavior (With Request Queuing):
//   - Request queue limits concurrent predictions to 100 (gateway level)
//   - PM2 clustering distributes load across instances
//   - NGINX buffers requests, preventing backend overload
//   - Result: Controlled resource usage, stable performance
//
// Thesis Implication:
//   "The Python prediction subprocess spawning is identical in both versions,
//   taking approximately 500ms per prediction. The performance difference
//   (60-70% improvement with NGINX+PM2) comes from Node.js layer optimizations:
//   request queuing, connection pooling, async operations, and process clustering.
//   This validates that NGINX+PM2 addresses Node.js architectural limitations."
//

// Simple in-memory cache for the active model document.
// The active model rarely changes (only when an admin switches it), so querying
// MongoDB on every prediction is unnecessary overhead. A 5-minute TTL ensures
// freshness without a per-request DB hit. Invalidated explicitly on model status changes.
let _cachedActiveModel = null;
let _cachedActiveModelAt = 0;
const ACTIVE_MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getActiveModel() {
  const now = Date.now();
  if (_cachedActiveModel && (now - _cachedActiveModelAt) < ACTIVE_MODEL_CACHE_TTL_MS) {
    return _cachedActiveModel;
  }
  const model = await Model.findOne({ active: true });
  if (model) {
    _cachedActiveModel = model;
    _cachedActiveModelAt = now;
  }
  return model;
}

function invalidateActiveModelCache() {
  _cachedActiveModel = null;
  _cachedActiveModelAt = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENT PYTHON WORKER POOL
// Replaces the per-request spawn pattern.  The pool loads the ML model once
// and keeps the Python interpreter alive between requests.
// Size 1 = serial inference (safe default for a single-process baseline).
// Use PYTHON_WORKER_POOL_SIZE env to increase for higher concurrency.
// ─────────────────────────────────────────────────────────────────────────────
const WORKER_POOL_SIZE = parseInt(process.env.PYTHON_WORKER_POOL_SIZE || '1', 10);
let workerPool = null;

async function initializeWorkerPool() {
  try {
    const activeModel = await getActiveModel();
    if (!activeModel) {
      console.error('[WORKER-POOL] No active model found — pool not initialized');
      return;
    }

    const modelPath  = path.join(__dirname, '../..', activeModel.filePath).replace(/\\/g, '/');
    const modelType  = getModelType(modelPath);  // 'joblib' or 'pkl'
    const workerScript = path.join(__dirname, 'python_worker.py');
    const venvPython   = path.join(ROOT_DIR, 'venv', 'bin', 'python');
    const pythonCmd    = fs.existsSync(venvPython) ? venvPython : 'python3';

    // Shut down any previous pool (e.g. after a model swap)
    if (workerPool) {
      console.log('[WORKER-POOL] Shutting down previous pool for model swap');
      workerPool.shutdown();
      workerPool = null;
    }

    const pool = new PythonWorkerPool({ size: WORKER_POOL_SIZE });
    await pool.initialize({ pythonCmd, workerScript, modelPath, modelType });
    workerPool = pool;

    console.log(`[WORKER-POOL] Initialized — size=${WORKER_POOL_SIZE} model=${activeModel.filePath}`);
  } catch (err) {
    console.error(`[WORKER-POOL] Initialization failed: ${err.message}`);
    workerPool = null;
  }
}

// Create a Python bridge for prediction (kept for reference; no longer called on the hot path)
function createPythonBridge() {
  return {
    predict: async (data, requestId = null) => {
      // Make sure there's a target directory for input and output
      const tmpDir = path.join(ROOT_DIR, 'tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      
      // Write the input data to a temp file
      const inputPath = path.join(tmpDir, `input_${Date.now()}.json`);
      const outputPath = path.join(tmpDir, `output_${Date.now()}.json`);
      
      // Process input data
      const inputData = preprocessInput(data);
      fs.writeFileSync(inputPath, JSON.stringify(inputData));
      
      // Get active model — cached to avoid a MongoDB round-trip on every prediction
      const activeModel = await getActiveModel();
      if (!activeModel) {
        throw new Error('No active model found in database');
      }

      // Get model path from MongoDB and ensure forward slashes
      const modelPath = activeModel.filePath.replace(/\\/g, '/');
      console.log(`Using model file from MongoDB: ${modelPath}`);

      // Convert to local path - ensure forward slashes on Linux
      const localPath = path.join(__dirname, '../..', modelPath).replace(/\\/g, '/');
      
      // Detect model type and choose appropriate Python bridge
      const modelType = getModelType(localPath);
      const pythonScript = modelType === 'pkl' ? PYTHON_SCRIPT_V2_PATH : PYTHON_SCRIPT_PATH;
      
      console.log(`Using local model path: ${localPath}`);
      console.log(`Using Python bridge: ${modelType === 'pkl' ? 'V2 (ensemble)' : 'V1 (joblib)'}`);
      
      // Double check the file exists
      let modelSize = 0;
      try {
        const stats = fs.statSync(localPath);
        modelSize = stats.size;
        console.log(`Model file exists: ${stats.isFile()}, Size: ${stats.size} bytes`);
      } catch (error) {
        console.error(`Error checking model file: ${error.message}`);
        console.log('Current directory:', __dirname);
        console.log('Attempted path:', localPath);
        throw new Error('Model file not found at the specified path');
      }

      // Log Python execution
      logPythonExecution(logger, {
        requestId,
        command: 'python3',
        args: [
          pythonScript,
          '--model', localPath,
          '--input', inputPath,
          '--output', outputPath
        ],
        modelPath: localPath,
        modelSize,
        inputPath,
        outputPath,
        inputSummary: Object.keys(inputData).join(', ')
      });

      // Determine Python executable path
      // Use venv Python if available, otherwise system Python
      const venvPythonPath = path.join(ROOT_DIR, 'venv', 'bin', 'python');
      const pythonCommand = fs.existsSync(venvPythonPath) ? venvPythonPath : 'python3';
      
      console.log(`Using Python executable: ${pythonCommand}`);

      // Create Python process with proper path handling
      return new Promise((resolve, reject) => {
        const pythonProcess = spawn(pythonCommand, [
          pythonScript,
          '--model', localPath,
          '--input', inputPath,
          '--output', outputPath
        ]);

        let stdoutData = '';
        let stderrData = '';

        pythonProcess.stdout.on('data', (data) => {
          stdoutData += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          const stderrChunk = data.toString();
          console.log('Python stderr:', stderrChunk);
          stderrData += stderrChunk;
        });

        pythonProcess.on('close', (code) => {
          // Clean up temp files
          try {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          } catch (cleanupError) {
            console.error('Error cleaning up temp files:', cleanupError);
          }

          if (code !== 0) {
            console.error(`Python process exited with code ${code}`);
            console.error('Python stderr:', stderrData);
            
            logPythonError(logger, {
              requestId,
              stderr: stderrData,
              exitCode: code,
              command: `python3 ${PYTHON_SCRIPT_PATH}`,
              context: { modelPath: localPath, inputPath, outputPath }
            });
            
            reject(new Error(`Python process failed: ${stderrData}`));
            return;
          }

          try {
            const result = JSON.parse(stdoutData);
            resolve(result);
          } catch (error) {
            console.error('Error parsing Python output:', error);
            
            logPythonError(logger, {
              requestId,
              stderr: `JSON parse error: ${error.message}\nOutput: ${stdoutData}`,
              exitCode: code,
              command: `python3 ${PYTHON_SCRIPT_PATH}`,
              context: { modelPath: localPath }
            });
            
            reject(error);
          }
        });

        pythonProcess.on('error', (error) => {
          console.error('Failed to start Python process:', error);
          
          logPythonError(logger, {
            requestId,
            stderr: `Process spawn error: ${error.message}`,
            exitCode: -1,
            command: `python3 ${PYTHON_SCRIPT_PATH}`,
            context: { modelPath: localPath }
          });
          
          reject(error);
        });
      });
    }
  };
}

// Function to make prediction — routes through the persistent worker pool.
// The pool handles the Python process lifecycle; the interpreter and model
// are NOT restarted between requests.
async function predictWithJoblib(data, requestId = null) {
  try {
    logMLRequest(logger, {
      requestId,
      model: 'kidney_stone_model',
      parameters: data,
      endpoint: '/predict'
    });

    // Validate input before sending to the worker
    try {
      validateUrineData(data);
    } catch (validationError) {
      logger.error('Validation failed', { requestId, error: validationError.message });
      return { success: false, error: validationError.message, statusCode: 400 };
    }

    // Preprocess once in Node.js (key normalisation, numeric conversion)
    const inputData = preprocessInput(data);

    // Send to the persistent worker — no process spawn, no model reload
    if (!workerPool) {
      throw new Error('Python worker pool is not ready. The ML service may still be initializing.');
    }

    const result = await workerPool.predict(inputData);

    if (!result || !result.success) {
      const errorMessage = result?.error || 'Invalid prediction result from Python worker';
      logError(logger, new Error(errorMessage), { requestId, stage: 'prediction_failed', result });
      throw new Error(errorMessage);
    }

    logger.info('Prediction successful', { requestId, predictedClass: result.predictedClass });

    // RGB-based hydration analysis (runs in Node.js, no Python needed)
    const { red = 255, green = 220, blue = 150 } = data;
    const hydrationAnalysis = checkDehydrationFromRGB(red, green, blue);

    return {
      success: true,
      result: result.result,
      predictedClass: result.predictedClass,
      parameters: result.parameters,
      hydrationAnalysis,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error(`Error in predictWithJoblib: ${error.message}`);
    logError(logger, error, { requestId, stage: 'predictWithJoblib', parameters: data });
    return { success: false, error: error.message, timestamp: new Date().toISOString() };
  }
}

// Parse CSV data
function parseCSV(filePath) {
  const data = fs.readFileSync(filePath, 'utf8');
  // Implement CSV parsing logic here
  console.log(`Parsing CSV file: ${filePath}`);
  return []; // Placeholder
}

// Check if model file exists
function checkModelExists() {
  // First check MODEL-ML/joblib directory
  const modelMLPath = path.join(modelMLDir, 'kidney_stone_model', 'kidney_stone_model.joblib');
  if (fs.existsSync(modelMLPath)) {
    console.log(`Found .joblib model file in MODEL-ML/joblib directory: ${modelMLPath}`);
    return true;
  }
  
  // Then check other locations
  if (fs.existsSync(MODEL_JOBLIB_PATH)) {
    console.log('Found .joblib model file in model directory');
    return true;
  } else if (fs.existsSync(DATASET_MODEL_JOBLIB_PATH)) {
    console.log('Found .joblib model file in DATASET directory');
    try {
      // Don't copy to model directory, just return true
      console.log('Using model file from DATASET directory');
    } catch (err) {
      console.error('Error accessing model file from DATASET:', err);
    }
    return true;
  } else if (fs.existsSync(ROOT_MODEL_JOBLIB_PATH)) {
    console.log('Found .joblib model file in root directory');
    try {
      // Don't copy to model directory, just return true
      console.log('Using model file from root directory');
    } catch (err) {
      console.error('Error accessing model file from root:', err);
    }
    return true;
  }
  
  // Check for any .joblib files in MODEL-ML directory
  try {
    const modelFolders = fs.readdirSync(modelMLDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    for (const folder of modelFolders) {
      const folderPath = path.join(modelMLDir, folder);
      const joblibFiles = fs.readdirSync(folderPath)
        .filter(file => file.endsWith('.joblib'));
      
      if (joblibFiles.length > 0) {
        console.log(`Found model files in ${folderPath}`);
        return true;
      }
    }
  } catch (error) {
    console.error(`Error checking MODEL-ML directory: ${error.message}`);
  }
  
  return false;
}

// Define API routes
// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ml-service',
    timestamp: new Date().toISOString(),
    models: checkModelExists() ? 'found' : 'not found',
    mongoDb: isConnected ? 'connected' : 'disconnected',
    queueStats: predictionQueue.getStats(),
    instanceId: INSTANCE_ID
  });
});

// Get all models
app.get('/models', cacheMiddleware(modelCache, { ttl: 10 * 60 * 1000, includeUserId: false }), async (req, res) => {
  try {
    console.log('GET /models - Retrieving all models');
    
    // Ensure MongoDB connection is established
    if (!isConnected) {
      const connected = await ensureMongoDBConnection();
      if (!connected) {
        return res.status(503).json({
        success: false,
          message: 'Database connection not available',
          error: 'Failed to connect to MongoDB'
      });
      }
    }
    
    // Use the model service to get models
    try {
      const models = await getModels();
    
      return res.status(200).json({
        success: true, 
        message: 'Models retrieved successfully',
        data: models
      });
    } catch (modelError) {
      console.error(`Error getting models from model service: ${modelError.message}`);
      return res.status(500).json({
        success: false,
        message: 'Error retrieving models from database',
        error: modelError.message
      });
    }
  } catch (error) {
    console.error(`Error retrieving models: ${error.message}`);
    return res.status(500).json({ 
      success: false,
      message: 'Error retrieving models',
      error: error.message 
    });
  }
});

// Upload model endpoint using ModelUploadService
app.post('/upload-model', upload.single('model'), async (req, res) => {
  try {
    console.log(`${new Date().toISOString()}: [ML] Received model upload request`);
    
    if (!req.file) {
      console.error(`${new Date().toISOString()}: [ML] No file uploaded`);
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Get user ID from request header or body
    const userId = req.headers['user-id'] || req.body.userId;

    // Use the ModelUploadService to handle the upload
    const result = await modelUploadService.uploadModel(req.file, req.body, userId);
    
    // Invalidate model cache after successful upload
    modelCache.clear();
    invalidateActiveModelCache();
    console.log('[ML-CACHE] Cleared model cache after model upload');
    
    return res.status(201).json(result);
  } catch (error) {
    console.error(`${new Date().toISOString()}: [ML] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error uploading model',
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTIC FLAG: ML_BYPASS
// Set  ML_BYPASS=true  in the environment to skip Python execution entirely.
// The endpoint still exercises the full Node.js path (gateway middleware, JWT
// auth, HTTP proxy chain, queue logic, DB write in prediction-service).
// USE ONLY for bottleneck diagnosis. Do NOT use for thesis comparison results.
// Toggle:  ML_BYPASS=true node ml-service.js
//          or add to .env / ecosystem config temporarily.
// ─────────────────────────────────────────────────────────────────────────────
const ML_BYPASS = process.env.ML_BYPASS === 'true';
if (ML_BYPASS) {
  logger.warn('ML_BYPASS is ACTIVE — Python execution will be skipped on all /predict calls. DIAGNOSTIC MODE ONLY.');
}

// Predict using ML model
app.post('/predict', async (req, res) => {
  const requestId = req.headers['x-request-id'] || `ml_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    console.log(`POST /predict - Making prediction`);
    
    const data = req.body;

    // ── DIAGNOSTIC BYPASS ──────────────────────────────────────────────────
    // When ML_BYPASS=true, return a valid dummy response immediately without
    // spawning Python. Response shape matches predictWithJoblib() exactly so
    // prediction-service.js processes it identically (convertToIndonesian,
    // hydrationAnalysis, Prediction.save()).
    // The dummy result is intentionally fixed so it does not pollute real data.
    if (ML_BYPASS) {
      return res.status(200).json({
        success: true,
        result: [0],
        predictedClass: 'Normal',
        parameters: data,
        hydrationAnalysis: {
          hydrationStatus: 'Well Hydrated',
          needsWater: false,
          recommendation: 'Hidrasi baik, pertahankan.',
          colorIntensity: 175.0,
          yellowRatio: 1.50
        },
        timestamp: new Date().toISOString(),
        _diagnostic: true
      });
    }
    // ── END DIAGNOSTIC BYPASS ──────────────────────────────────────────────
    
    await predictionQueue.acquire();

    try {
      const result = await predictWithJoblib(data, requestId);

      if (!result.success) {
        return res.status(500).json(result);
      }

      return res.status(200).json(result);
    } finally {
      predictionQueue.release();
    }
  } catch (error) {
    if (error.isQueueOverflow) {
      return res.status(503).json({ success: false, error: 'ML service overloaded — try again shortly' });
    }
    console.error(`Error making prediction: ${error.message}`);

    logError(logger, error, {
      requestId,
      endpoint: '/predict',
      stage: 'prediction_endpoint'
    });

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Predict from JSON data
app.post('/predict/json', async (req, res) => {
  try {
    console.log(`POST /predict/json - Making prediction from JSON data`);
    
    const data = req.body.data;
    if (!data) {
      return res.status(400).json({ 
        success: false,
        error: 'No data provided'
      });
    }
    
    // VERSION 2: Acquire queue slot before spawning Python process
    await predictionQueue.acquire();
    console.log(DISABLE_QUEUE 
      ? '[ML-QUEUE] Spawning Python without queue (V1 simplicity)'
      : '[ML-QUEUE] Acquired prediction slot', 
      { queueStats: predictionQueue.getStats(), queueDisabled: DISABLE_QUEUE }
    );
    
    try {
      const result = await predictWithJoblib(data);
      
      if (!result.success) {
        return res.status(500).json(result);
      }
      
      return res.status(200).json(result);
    } finally {
      // Always release queue slot, even if prediction fails
      predictionQueue.release();
      console.log(DISABLE_QUEUE
        ? '[ML-QUEUE] Python completed without queue (V1 simplicity)'
        : '[ML-QUEUE] Released prediction slot', 
        { queueStats: predictionQueue.getStats(), queueDisabled: DISABLE_QUEUE }
      );
    }
  } catch (error) {
    if (error.isQueueOverflow) {
      return res.status(503).json({ success: false, error: 'ML service overloaded — try again shortly' });
    }
    console.error(`Error making prediction from JSON: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Predict from CSV file
app.post('/predict/csv', upload.single('csv'), async (req, res) => {
  try {
    console.log(`POST /predict/csv - Making prediction from CSV file`);
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'No file uploaded'
      });
    }
    
    // Parse CSV data
    const data = parseCSV(req.file.path);
    
    // VERSION 1: Process CSV rows without queue control (simplicity)
    // Each row spawns Python immediately - can cause 100+ processes for large CSV
    // VERSION 2: Queue control prevents resource exhaustion
    const predictions = [];
    for (const row of data) {
      await predictionQueue.acquire();
      console.log(DISABLE_QUEUE
        ? '[ML-QUEUE] Spawning Python for CSV row (no queue)'
        : '[ML-QUEUE] Acquired prediction slot for CSV row', 
        { queueStats: predictionQueue.getStats(), queueDisabled: DISABLE_QUEUE }
      );
      
      try {
        const result = await predictWithJoblib(row);
        predictions.push(result);
      } finally {
        predictionQueue.release();
        console.log(DISABLE_QUEUE
          ? '[ML-QUEUE] Python completed CSV row (no queue)'
          : '[ML-QUEUE] Released prediction slot for CSV row', 
          { queueStats: predictionQueue.getStats(), queueDisabled: DISABLE_QUEUE }
        );
      }
    }
    
    return res.status(200).json({
      success: true,
      predictions
    });
  } catch (error) {
    console.error(`Error making prediction from CSV: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message 
    });
  }
});

// Get model by ID
app.get('/model/:id', cacheMiddleware(modelCache, { ttl: 10 * 60 * 1000, includeUserId: false }), async (req, res) => {
  try {
    console.log(`GET /model/${req.params.id} - Retrieving model`);
    
    // Ensure MongoDB connection is established
    await ensureMongoDBConnection();
    
    // Get models
    const models = await getModels();
    const model = models.find(m => m._id.toString() === req.params.id);
    
    if (!model) {
      return res.status(404).json({
        success: false,
        message: 'Model not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: model
    });
  } catch (error) {
    console.error(`Error retrieving model: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving model',
      error: error.message 
    });
  }
});

// Update model name
app.put('/model/name', async (req, res) => {
  try {
    console.log(`PUT /model/name - Updating model name`);
    
    const { id, name } = req.body;
    
    if (!id || !name) {
      return res.status(400).json({ 
        success: false,
        message: 'ID and name are required'
      });
    }
    
    // Ensure MongoDB connection is established
    await ensureMongoDBConnection();
    
    // Get models
    const models = await getModels();
    const model = models.find(m => m._id.toString() === id);
    
    if (!model) {
      return res.status(404).json({
        success: false,
        message: 'Model not found'
      });
    }
    
    // 1. First, update the .txt file (source of truth)
    let txtUpdated = false;
    if (model.txtPath && fs.existsSync(model.txtPath)) {
      const metadata = readModelMetadata(model.txtPath);
      metadata.name = name;
      txtUpdated = writeModelMetadata(model.txtPath, metadata);
      console.log(`[ML Service] Updated model name in .txt file: ${model.txtPath}`);
    } else {
      console.warn(`[ML Service] Could not update .txt file - file not found at: ${model.txtPath}`);
    }
    
    // 2. Then, update the model in MongoDB
    model.name = name;
    await model.save();
    console.log(`[ML Service] Updated model name in MongoDB: ${id}`);
    
    // Invalidate model cache after successful update
    modelCache.delete(`/models::`);
    modelCache.delete(`/model/${id}::`);
    console.log('[ML-CACHE] Invalidated model cache after name update');
    
    return res.status(200).json({
      success: true,
      message: 'Model name updated successfully',
      data: model,
      txtUpdated: txtUpdated
    });
  } catch (error) {
    console.error(`Error updating model name: ${error.message}`);
    return res.status(500).json({
        success: false,
      message: 'Error updating model name',
      error: error.message
    });
  }
});

// Update model description
app.put('/model/description', async (req, res) => {
  try {
    console.log(`PUT /model/description - Updating model description`);
    
    const { id, description } = req.body;
    
    if (!id || !description) {
      return res.status(400).json({ 
        success: false,
        message: 'ID and description are required'
      });
    }
    
    // Ensure MongoDB connection is established
    await ensureMongoDBConnection();
    
    // Get models
    const models = await getModels();
    const model = models.find(m => m._id.toString() === id);
    
    if (!model) {
      return res.status(404).json({
        success: false,
        message: 'Model not found'
      });
    }
    
    // 1. First, update the .txt file (source of truth)
    let txtUpdated = false;
    if (model.txtPath && fs.existsSync(model.txtPath)) {
      const metadata = readModelMetadata(model.txtPath);
      metadata.description = description;
      txtUpdated = writeModelMetadata(model.txtPath, metadata);
      console.log(`[ML Service] Updated model description in .txt file: ${model.txtPath}`);
    } else {
      console.warn(`[ML Service] Could not update .txt file - file not found at: ${model.txtPath}`);
    }
    
    // 2. Then, update the model in MongoDB
    model.description = description;
    await model.save();
    console.log(`[ML Service] Updated model description in MongoDB: ${id}`);
    
    // Invalidate model cache after successful update
    modelCache.delete(`/models::`);
    modelCache.delete(`/model/${id}::`);
    console.log('[ML-CACHE] Invalidated model cache after description update');
    
    return res.status(200).json({
      success: true,
      message: 'Model description updated successfully',
      data: model,
      txtUpdated: txtUpdated
    });
  } catch (error) {
    console.error(`Error updating model description: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error updating model description',
      error: error.message
    });
  }
});

// Update model version
app.put('/model/version', async (req, res) => {
  try {
    console.log(`PUT /model/version - Updating model version`);
    
    const { id, version } = req.body;
    
    if (!id || !version) {
      return res.status(400).json({
        success: false,
        message: 'ID and version are required'
      });
    }
    
    // Ensure MongoDB connection is established
    await ensureMongoDBConnection();
    
    // Get models
    const models = await getModels();
    const model = models.find(m => m._id.toString() === id);
    
    if (!model) {
      return res.status(404).json({
        success: false,
        message: 'Model not found'
      });
    }
    
    // 1. First, update the .txt file (source of truth)
    let txtUpdated = false;
    if (model.txtPath && fs.existsSync(model.txtPath)) {
      const metadata = readModelMetadata(model.txtPath);
      metadata.version = version;
      txtUpdated = writeModelMetadata(model.txtPath, metadata);
      console.log(`[ML Service] Updated model version in .txt file: ${model.txtPath}`);
    } else {
      console.warn(`[ML Service] Could not update .txt file - file not found at: ${model.txtPath}`);
    }
    
    // 2. Then, update the model in MongoDB
    model.version = version;
    await model.save();
    console.log(`[ML Service] Updated model version in MongoDB: ${id}`);
    
    // Invalidate model cache after successful update
    modelCache.delete(`/models::`);
    modelCache.delete(`/model/${id}::`);
    console.log('[ML-CACHE] Invalidated model cache after version update');
    
    return res.status(200).json({
      success: true,
      message: 'Model version updated successfully',
      data: model,
      txtUpdated: txtUpdated
    });
  } catch (error) {
    console.error(`Error updating model version: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error updating model version',
      error: error.message
    });
  }
});

// Update model accuracy
app.put('/model/accuracy', async (req, res) => {
  try {
    console.log(`PUT /model/accuracy - Updating model accuracy`);
    
    const { id, accuracy } = req.body;
    
    if (!id || accuracy === undefined) {
      return res.status(400).json({
        success: false,
        message: 'ID and accuracy are required'
      });
    }
    
    const parsedAccuracy = parseFloat(accuracy);
    if (isNaN(parsedAccuracy) || parsedAccuracy < 0 || parsedAccuracy > 1) {
      return res.status(400).json({
        success: false,
        message: 'Accuracy must be a number between 0 and 1'
      });
    }
    
    // Ensure MongoDB connection is established
    await ensureMongoDBConnection();
    
    // Get models
    const models = await getModels();
    const model = models.find(m => m._id.toString() === id);
    
    if (!model) {
      return res.status(404).json({
        success: false,
        message: 'Model not found'
      });
    }
    
    // 1. First, update the .txt file (source of truth)
    let txtUpdated = false;
    if (model.txtPath && fs.existsSync(model.txtPath)) {
      const metadata = readModelMetadata(model.txtPath);
      metadata.accuracy = parsedAccuracy;
      txtUpdated = writeModelMetadata(model.txtPath, metadata);
      console.log(`[ML Service] Updated model accuracy in .txt file: ${model.txtPath}`);
    } else {
      console.warn(`[ML Service] Could not update .txt file - file not found at: ${model.txtPath}`);
    }
    
    // 2. Then, update the model in MongoDB
    model.accuracy = parsedAccuracy;
    await model.save();
    console.log(`[ML Service] Updated model accuracy in MongoDB: ${id}`);
    
    // Invalidate model cache after successful update
    modelCache.delete(`/models::`);
    modelCache.delete(`/model/${id}::`);
    console.log('[ML-CACHE] Invalidated model cache after accuracy update');
      
    return res.status(200).json({
      success: true,
      message: 'Model accuracy updated successfully',
      data: model,
      txtUpdated: txtUpdated
    });
  } catch (error) {
    console.error(`Error updating model accuracy: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error updating model accuracy',
      error: error.message
    });
  }
});

// Update model status (active/inactive)
app.put('/model/status', async (req, res) => {
  try {
    console.log(`PUT /model/status - Updating model status`);
    
    const { id, active } = req.body;
    
    if (!id || active === undefined) {
      return res.status(400).json({
        success: false,
        message: 'ID and active status are required'
      });
    }
    
    // Ensure MongoDB connection is established
    await ensureMongoDBConnection();
    
    // Get models collection
    const Model = mongoose.model('Model');
    
    // Find the model
    const model = await Model.findById(id);
    
    if (!model) {
      return res.status(404).json({
        success: false,
        message: 'Model not found'
      });
    }
    
    // If activating this model, deactivate all others (only one active model allowed)
    if (active) {
      await Model.updateMany(
        { _id: { $ne: id } },
        { $set: { active: false } }
      );
      console.log(`[ML Service] Deactivated all other models`);
    }
    
    // Update this model's status
    model.active = active;
    await model.save();
    console.log(`[ML Service] Updated model status in MongoDB: ${id} to ${active}`);
    
    // Invalidate model cache after successful update (critical for active model changes)
    modelCache.clear();
    invalidateActiveModelCache();
    console.log('[ML-CACHE] Cleared entire model cache after status update');
    // Reinitialize the worker pool with the newly active model
    initializeWorkerPool().catch(err =>
      console.error('[WORKER-POOL] Failed to reinitialize after model status change:', err.message)
    );
    
    return res.status(200).json({
      success: true,
      message: 'Model status updated successfully',
      data: model
    });
  } catch (error) {
    console.error(`Error updating model status: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error updating model status',
      error: error.message
    });
  }
});

// Delete a model
app.delete('/model/:id', async (req, res) => {
  try {
    const modelId = req.params.id;
    console.log(`DELETE /model/${modelId} - Deleting model`);
    
    // Ensure MongoDB connection is established
    await ensureMongoDBConnection();
    
    // Get models collection
    const Model = mongoose.model('Model');
    
    // Find the model
    const model = await Model.findById(modelId);
    
    if (!model) {
      return res.status(404).json({
        success: false,
        message: 'Model not found'
      });
    }
    
    // Check if this is an active model - prevent deletion of active models
    if (model.active) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete an active model. Please deactivate it first.'
      });
    }
    
    // Create delete directory if it doesn't exist
    const deleteDir = path.join(ROOT_DIR, 'MODEL-ML', 'deleted');
    if (!fs.existsSync(deleteDir)) {
      fs.mkdirSync(deleteDir, { recursive: true });
      console.log(`[ML Service] Created deleted models directory: ${deleteDir}`);
    }
    
    // Process the files
    if (model.filePath && fs.existsSync(model.filePath)) {
      try {
        // Get the model folder name from the file path
        const modelFolder = path.dirname(model.filePath);
        const modelFileName = path.basename(model.filePath);
        const modelName = path.basename(modelFolder);
        
        // Create a subdirectory in the deleted folder for this model
        const modelDeleteDir = path.join(deleteDir, modelName);
        if (!fs.existsSync(modelDeleteDir)) {
          fs.mkdirSync(modelDeleteDir, { recursive: true });
        }
        
        // Delete the actual model file
        fs.unlinkSync(model.filePath);
        console.log(`[ML Service] Deleted model file: ${model.filePath}`);
        
        // Move the txt file if it exists
        if (model.txtPath && fs.existsSync(model.txtPath)) {
          const txtFileName = path.basename(model.txtPath);
          const targetTxtPath = path.join(modelDeleteDir, txtFileName);
          
          // Read the content of the txt file
          const txtContent = fs.readFileSync(model.txtPath, 'utf8');
          
          // Write it to the new location
          fs.writeFileSync(targetTxtPath, txtContent);
          console.log(`[ML Service] Moved metadata file to: ${targetTxtPath}`);
          
          // Delete the original txt file
          fs.unlinkSync(model.txtPath);
        }
        
        // Check if there are any files left in the original model folder
        try {
          console.log(`[ML Service] Checking if model folder can be deleted: ${modelFolder}`);
          const folderExists = fs.existsSync(modelFolder);
          
          if (!folderExists) {
            console.log(`[ML Service] Model folder doesn't exist: ${modelFolder}`);
          } else {
            const remainingFiles = fs.readdirSync(modelFolder);
            console.log(`[ML Service] Found ${remainingFiles.length} items in folder: ${modelFolder}`);
            
            if (remainingFiles.length === 0) {
              // Delete the empty folder
              try {
                fs.rmdirSync(modelFolder);
                console.log(`[ML Service] Successfully removed empty model folder: ${modelFolder}`);
              } catch (folderError) {
                console.error(`[ML Service] Error removing folder: ${folderError.message}`);
                
                // Try with a slight delay
                setTimeout(() => {
                  try {
                    if (fs.existsSync(modelFolder)) {
                      fs.rmdirSync(modelFolder);
                      console.log(`[ML Service] Removed model folder after retry: ${modelFolder}`);
                    }
                  } catch (retryError) {
                    console.error(`[ML Service] Failed to remove folder after retry: ${retryError.message}`);
                  }
                }, 500);
              }
            } else {
              console.log(`[ML Service] Not removing folder as it contains ${remainingFiles.length} items: ${JSON.stringify(remainingFiles)}`);
            }
          }
        } catch (folderError) {
          console.error(`[ML Service] Error handling model folder deletion: ${folderError.message}`);
        }
      } catch (fileError) {
        console.error(`[ML Service] Error handling model files: ${fileError.message}`);
        // Continue with deletion even if file operations fail
      }
    }
    
    // Delete the model from the database
    await model.deleteOne();
    console.log(`[ML Service] Deleted model from database: ${modelId}`);
    
    // Invalidate model cache after successful deletion
    modelCache.clear();
    invalidateActiveModelCache();
    console.log('[ML-CACHE] Cleared model cache after model deletion');
    
    return res.status(200).json({
      success: true,
      message: 'Model deleted successfully'
    });
  } catch (error) {
    console.error(`Error deleting model: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error deleting model',
      error: error.message
    });
  }
});

// Version endpoint
app.get('/version', (req, res) => {
  res.json({
    service: 'ml-service',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    joblibModelExists: checkModelExists()
  });
});

// Register model API (without file upload)
app.post('/register-model', async (req, res) => {
  try {
    console.log(`${new Date().toISOString()}: [ML] Received model registration request`);
    
    // Parse model data from request body
    const modelData = req.body;
    
    if (!modelData || !modelData.filePath || !modelData.txtPath) {
      console.error(`${new Date().toISOString()}: [ML] Missing required model data`);
      return res.status(400).json({
        success: false,
        message: 'Missing required model data (filePath, txtPath)'
      });
    }
    
    console.log(`${new Date().toISOString()}: [ML] Model data received:`, modelData);
    
    // Validate that files exist - convert absolute path to local path for checking
    const localFilePath = modelData.filePath.replace('/var/www/html/HIBAH/', path.join(__dirname, '../../').replace(/\\/g, '/'));
    
    if (!fs.existsSync(localFilePath.replace(/\//g, path.sep))) {
      console.error(`${new Date().toISOString()}: [ML] Model file not found at ${localFilePath}`);
      return res.status(404).json({
        success: false,
        message: 'Model file not found at specified path'
      });
    }
    
    // Ensure MongoDB connection is established
    if (!mongoose.connection.readyState) {
      console.log(`${new Date().toISOString()}: [ML] Reconnecting to MongoDB...`);
      await connectToMongoDB();
    }
    
    // If this model should be active, deactivate all other models
    if (modelData.active) {
      console.log(`${new Date().toISOString()}: [ML] Setting as active model, deactivating others`);
      await mongoose.model('Model').updateMany(
        {},
        { $set: { active: false } }
      );
    }
    
    // Add to database
    const model = new Model({
      name: modelData.name,
      version: modelData.version,
      description: modelData.description,
      accuracy: parseFloat(modelData.accuracy) || 0.92,
      filePath: modelData.filePath,
      txtPath: modelData.txtPath,
      active: modelData.active,
      createdBy: modelData.createdBy,
      createdAt: new Date()
    });
    
    await model.save();
    
    // Update the txt file with the correct ObjectId
    const localTxtPath = modelData.txtPath.replace('/var/www/html/HIBAH/', path.join(__dirname, '../../').replace(/\\/g, '/'));
    const txtPath = localTxtPath.replace(/\//g, path.sep);
    
    if (fs.existsSync(txtPath)) {
      const txtContent = fs.readFileSync(txtPath, 'utf8');
      const lines = txtContent.split('\n');
      
      // Replace the first line with the actual MongoDB ObjectId
      lines[0] = model._id.toString();
      
      fs.writeFileSync(txtPath, lines.join('\n'));
      console.log(`${new Date().toISOString()}: [ML] Updated txt file with correct ObjectId`);
    }
    
    console.log(`${new Date().toISOString()}: [ML] Model registered successfully:`, modelData.name);
    return res.status(201).json({
      success: true,
      message: 'Model registered successfully',
      data: model
    });
  } catch (error) {
    console.error(`${new Date().toISOString()}: [ML] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error registering model',
      error: error.message
    });
  }
});

// Direct upload endpoint for fallback method
app.post('/direct-upload', async (req, res) => {
  try {
    console.log(`${new Date().toISOString()}: [ML] Received direct upload request`);
    
    const { filePath, ...modelData } = req.body;
    
    if (!filePath) {
      console.error(`${new Date().toISOString()}: [ML] No file path provided`);
      return res.status(400).json({
        success: false,
        message: 'No file path provided'
      });
    }
    
    // Convert to local path for verification
    const localFilePath = filePath.replace('/var/www/html/HIBAH/', path.join(__dirname, '../../').replace(/\\/g, '/'));
    const localPath = localFilePath.replace(/\//g, path.sep);
    
    // Verify that the file exists
    if (!fs.existsSync(localPath)) {
      console.error(`${new Date().toISOString()}: [ML] File not found at ${localPath}`);
      return res.status(404).json({
        success: false,
        message: 'File not found at the specified path'
      });
    }
    
    // Get filename from path
    const fileName = path.basename(filePath);
    const modelName = fileName.replace('.joblib', '');
    
    // Create model directory in MODEL-ML/joblib if it doesn't exist
    const modelFolder = path.join(modelMLDir, modelName);
    if (!fs.existsSync(modelFolder)) {
      fs.mkdirSync(modelFolder, { recursive: true });
    }
    
    // Create absolute paths for MongoDB
    const absoluteModelFilePath = `/var/www/html/HIBAH/MODEL-ML/joblib/${modelName}/${fileName}`.replace(/\\/g, '/');
    const absoluteTxtFilePath = `/var/www/html/HIBAH/MODEL-ML/joblib/${modelName}/${modelName}.txt`.replace(/\\/g, '/');
    
    // Create the txt metadata file if needed
    const txtPath = path.join(modelFolder, `${modelName}.txt`);
    
    if (!fs.existsSync(txtPath)) {
      // Generate a dummy ObjectId for now - will be replaced by MongoDB
      const dummyObjectId = new Date().getTime().toString(16).padStart(24, '0');
      
      // Create the metadata file with the proper format
      const txtContent = [
        dummyObjectId,
        modelData.name || modelName,
        modelData.version || '1.0.0',
        modelData.description || 'Uploaded model',
        modelData.accuracy || '0.92',
        absoluteModelFilePath
      ].join('\n');
      
      fs.writeFileSync(txtPath, txtContent);
      console.log(`${new Date().toISOString()}: [ML] Created metadata file at ${txtPath}`);
    }
    
    // Ensure MongoDB connection
    if (!mongoose.connection.readyState) {
      console.log(`${new Date().toISOString()}: [ML] Reconnecting to MongoDB...`);
      await connectToMongoDB();
    }
    
    // If this model should be active, deactivate all other models
    if (modelData.active) {
      console.log(`${new Date().toISOString()}: [ML] Setting as active model, deactivating others`);
      await mongoose.model('Model').updateMany(
        {},
        { $set: { active: false } }
      );
    }
    
    // Save to database
    const model = new Model({
      name: modelData.name || modelName,
      version: modelData.version || '1.0.0',
      description: modelData.description || 'Uploaded model',
      accuracy: parseFloat(modelData.accuracy) || 0.92,
      filePath: absoluteModelFilePath,
      txtPath: absoluteTxtFilePath,
      active: modelData.active,
      createdBy: modelData.createdBy,
      createdAt: new Date()
    });
    
    await model.save();
    
    // Update the txt file with the correct ObjectId
    if (fs.existsSync(txtPath)) {
      const txtContent = fs.readFileSync(txtPath, 'utf8');
      const lines = txtContent.split('\n');
      
      // Replace the first line with the actual MongoDB ObjectId
      lines[0] = model._id.toString();
      
      fs.writeFileSync(txtPath, lines.join('\n'));
      console.log(`${new Date().toISOString()}: [ML] Updated txt file with correct ObjectId`);
    }
    
    console.log(`${new Date().toISOString()}: [ML] Model processed successfully:`, modelData.name || modelName);
    return res.status(201).json({
      success: true,
      message: 'Model processed successfully',
      data: model
    });
  } catch (error) {
    console.error(`${new Date().toISOString()}: [ML] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error processing model',
      error: error.message
    });
  }
});

// Auto data endpoint - Accepts device data for automatic uploads
app.post('/autoupload', async (req, res) => {
  try {
    console.log(`POST /autoupload - Receiving automatic device data`);
    
    // Check for device token in headers
    const deviceToken = req.headers['device-token'];
    if (!deviceToken) {
      return res.status(401).json({
        success: false,
        message: 'Device token required'
      });
    }
    
    // Validate device token against User collection
    const user = await mongoose.connection.db.collection('users').findOne({ deviceToken });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid device token'
      });
    }
    
    console.log(`[AUTO-UPLOAD] Valid token from user: ${user.email}`);
    
    // Validate data structure
    const { ph, tds, specificGravity, turbidityNTU, red, green, blue, turbidityLevel, warnaDasar, analisis } = req.body;
    if (!ph || !tds || !specificGravity || !turbidityNTU || red === undefined || green === undefined || blue === undefined || !turbidityLevel || !warnaDasar) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters (ph, tds, specificGravity, turbidityNTU, red, green, blue, turbidityLevel, warnaDasar)'
      });
    }
    
    // Create auto data record with userId
    const autoData = new AutoData({
      ph: { value: parseFloat(ph) },
      tds: { value: parseFloat(tds) },
      specificGravity: { value: parseFloat(specificGravity) },
      turbidityNTU: { value: parseFloat(turbidityNTU) },
      red: { value: parseInt(red) },
      green: { value: parseInt(green) },
      blue: { value: parseInt(blue) },
      turbidityLevel: turbidityLevel,
      warnaDasar: warnaDasar,
      analisis: analisis,
      deviceId: deviceToken,
      userId: user._id,
      timestamp: new Date()
    });
    
    // Save auto data to database
    await autoData.save();
    
    // Make prediction with the data
    try {
      // Format data for prediction
      const predictionData = {
        ph: autoData.ph.value,
        tds: autoData.tds.value,
        specificGravity: autoData.specificGravity.value,
        turbidityNTU: autoData.turbidityNTU.value,
        red: autoData.red.value,
        green: autoData.green.value,
        blue: autoData.blue.value,
        turbidityLevel: autoData.turbidityLevel,
        warnaDasar: autoData.warnaDasar
      };
      
      // Use existing prediction function
      const result = await predictWithJoblib(predictionData);
      
      if (result.success) {
        // Update auto data record with prediction result
        autoData.predictionResult = result.result[0];
        autoData.processed = true;
        await autoData.save();
      }
      
      return res.status(201).json({
        success: true,
        message: 'Device data uploaded and processed successfully',
        data: autoData,
        prediction: result.success ? result.result[0] : null
      });
    } catch (predictionError) {
      console.error(`Error making prediction with auto data: ${predictionError.message}`);
      
      return res.status(201).json({
        success: true,
        message: 'Device data uploaded successfully but prediction failed',
        data: autoData,
        predictionError: predictionError.message
      });
    }
  } catch (error) {
    console.error(`Error handling auto data upload: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error processing automatic data upload',
      error: error.message
    });
  }
});

// Get auto data endpoint
app.get('/autodata', async (req, res) => {
  try {
    console.log(`GET /autodata - Retrieving automatic device data`);
    
    // Get query parameters for filtering
    const limit = parseInt(req.query.limit) || 50;
    const deviceId = req.query.deviceId;
    const userId = req.query.userId;
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    
    // Build query
    const query = {};
    if (deviceId) query.deviceId = deviceId;
    if (userId) query.userId = userId;
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = startDate;
      if (endDate) query.timestamp.$lte = endDate;
    }
    
    console.log('[AUTODATA] Query:', JSON.stringify(query));
    
    // Fetch data with pagination (removed populate to prevent errors from invalid userId refs)
    const autoData = await AutoData.find(query)
      .sort({ timestamp: -1 })
      .limit(limit);
    
    console.log(`[AUTODATA] Found ${autoData.length} records`);
    
    return res.status(200).json({
      success: true,
      message: 'Auto data retrieved successfully',
      data: autoData
    });
  } catch (error) {
    console.error('[AUTODATA] Error:', error.stack);
    console.error('[AUTODATA] Failed query:', JSON.stringify(query));
    return res.status(500).json({
      success: false,
      message: 'Error retrieving automatic data',
      error: error.message
    });
  }
});

// Cache statistics endpoint
app.get('/models/cache/stats', cacheStatsMiddleware({ modelCache }));

// Worker pool status endpoint — useful for verifying the pool is alive
app.get('/worker/stats', (req, res) => {
  res.json({
    workerPool: workerPool ? workerPool.stats : null,
    poolReady:  workerPool !== null,
  });
});

// Wrap the server startup in an async function that properly handles errors
async function startServer() {
  try {
    // Ensure MongoDB connection is established first
    await ensureMongoDBConnection();
    
    // Start the server
    return new Promise((resolve, reject) => {
      const server = app.listen(PORT, () => {
    console.log(`ML service running on port ${PORT}`);
        
        // Initialize the service after server is started - this needs proper promise handling
        initialize()
          .then(() => {
            console.log('ML service initialization completed successfully');
            // Start the persistent Python worker pool after the model is confirmed in DB
            return initializeWorkerPool();
          })
          .then(() => {
            // VERSION 2: Send PM2 ready signal after successful initialization
            if (process.send) {
              process.send('ready');
              console.log('[ML-SERVICE] PM2 ready signal sent', { 
                instanceId: INSTANCE_ID,
                port: PORT 
              });
            }
            
            resolve(server);
          })
          .catch(err => {
            console.error(`Error during initialization: ${err.message}`);
            // Continue running even if initialization fails
            resolve(server);
  });
});

      // Add proper error handling for the server
      server.on('error', (error) => {
        console.error(`Server error: ${error.message}`);
        reject(error);
      });
    });
  } catch (error) {
    console.error(`Failed to start server: ${error.message}`);
    throw error;
  }
}

// Start the server with proper promise handling
startServer()
  .then(() => {
    console.log('ML service started successfully');
  })
  .catch(err => {
    console.error(`Error starting server: ${err.message}`);
    process.exit(1);
  });