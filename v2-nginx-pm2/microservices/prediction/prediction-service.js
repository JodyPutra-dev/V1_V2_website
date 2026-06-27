/**
 * PREDICTION SERVICE - Dedicated microservice for prediction operations
 * 
 * This service handles all prediction-related operations that were previously in gateway.js
 * It runs on its own port (3004 by default) and is called by the gateway via a proxy middleware
 */

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const { mongoose, connectToMongoDB } = require('../db/mongo-service');
const fetch = require('node-fetch');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Initialize Express app
const app = express();

// Environment variables
require('dotenv').config();
const PORT = process.env.PORT || process.env.PREDICTION_SERVICE_PORT || 3004;
const ML_SERVICE_PORT = process.env.ML_SERVICE_PORT || 3002;

// Instance ID for PM2 cluster mode
const INSTANCE_ID = process.env.INSTANCE_ID || process.env.NODE_APP_INSTANCE || '0';

// ===== ENCRYPTION UTILITIES =====
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'hibah-urine-disease-detection-app-key-32bytes'; // 32 bytes key
const ALGORITHM = 'aes-256-cbc';

// Ensure the encryption key is exactly 32 bytes
const getEncryptionKey = () => {
  let key = ENCRYPTION_KEY;
  if (key.length < 32) {
    key = key.padEnd(32, '0');
  } else if (key.length > 32) {
    key = key.substring(0, 32);
  }
  return key;
};

// Encrypt function
const encrypt = (text) => {
  try {
    if (!text) return '';
    
    const key = Buffer.from(getEncryptionKey(), 'utf8');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key.slice(0, 32), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return format: iv:encryptedData
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    console.error('[ENCRYPT] Error encrypting data:', error.message);
    return text; // Return original text if encryption fails
  }
};

// Decrypt function
const decrypt = (encryptedText) => {
  try {
    if (!encryptedText || !encryptedText.includes(':')) return encryptedText;
    
    const key = Buffer.from(getEncryptionKey(), 'utf8');
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedData = parts[1];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key.slice(0, 32), iv);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('[DECRYPT] Error decrypting data:', error.message);
    return encryptedText; // Return encrypted text if decryption fails
  }
};

// Convert prediction class to Indonesian
const convertToIndonesian = (predictedClass) => {
  switch (predictedClass) {
    case 'Normal':
      return 'Sehat';
    case 'Abnormal':
      return 'Batu Ginjal';
    default:
      return predictedClass;
  }
};

// Convert from Indonesian back to English for ML processing
const convertFromIndonesian = (penyakit) => {
  switch (penyakit) {
    case 'Sehat':
      return 'Normal';
    case 'Batu Ginjal':
      return 'Abnormal';
    default:
      return penyakit;
  }
};

// Create required directories
const uploadDir = path.join(__dirname, 'temp');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for CSV file uploads
const csvUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const tempDir = path.join(__dirname, 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      cb(null, tempDir);
    },
    filename: function (req, file, cb) {
      const filename = `${Date.now()}-${file.originalname}`;
      cb(null, filename);
    }
  }),
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
}).single('csv');

// Trust proxy headers
app.set('trust proxy', true);

// CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'user-id'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  credentials: true,
  maxAge: 86400
}));

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging — only in development; morgan('combined') is too verbose for production benchmarks
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('combined'));
}

// Request timestamp middleware
app.use((req, res, next) => {
  res.setHeader('X-Instance-ID', INSTANCE_ID);
  next();
});

// ===== DATABASE MODELS =====
// Prediction Schema
const predictionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  userSpecificId: {
    type: String,
    required: true,
    default: function() {
      return `${this.user}_${new mongoose.Types.ObjectId()}`
    }
  },
  result: {
    type: [Number],
    default: []
  },
  // Encrypted disease status in Indonesian
  penyakit: {
    type: String,
    required: true
  },
  parameters: {
    ph: Number,
    tds: Number,
    specificGravity: Number,
    turbidityNTU: Number,
    red: Number,
    green: Number,
    blue: Number,
    turbidityLevel: { type: String, enum: ['Jernih', 'Agak Keruh', 'Keruh'] },
    warnaDasar: { type: String, enum: ['BENING', 'KUNING', 'MERAH', 'COKLAT', 'ORANGE', 'HIJAU', 'BIRU'] },
    analisis: String,
    additional: mongoose.Schema.Types.Mixed
  },
  // RGB-based hydration analysis from ML service
  hydrationAnalysis: {
    hydrationStatus: String,
    needsWater: Boolean,
    recommendation: String,
    colorIntensity: Number,
    yellowRatio: Number
  },
  date: {
    type: Date,
    default: Date.now,
    required: true
  },
  notes: {
    type: String,
    default: ''
  },
  isPrivate: {
    type: Boolean,
    default: true
  }
}, { 
  timestamps: true,
  toJSON: { 
    transform: function(doc, ret) {
      delete ret.__v;
      ret.id = ret.userSpecificId;
      
      // Decrypt penyakit for frontend display
      if (ret.penyakit) {
        ret.penyakit = decrypt(ret.penyakit);
      }
      
      return ret;
    }
  }
});

// Pre-save middleware to encrypt penyakit
predictionSchema.pre('save', function(next) {
  if (this.isModified('penyakit') && this.penyakit) {
    // Only encrypt if it's not already encrypted (doesn't contain ':')
    if (!this.penyakit.includes(':')) {
      this.penyakit = encrypt(this.penyakit);
    }
  }
  next();
});

// Create compound index for user and date for faster queries
predictionSchema.index({ user: 1, date: -1 });
predictionSchema.index({ date: -1 });
predictionSchema.index({ penyakit: 1, date: -1 });

// Indexes for categorical parameters (V2 optimized)
predictionSchema.index({ 'parameters.turbidityLevel': 1 });
predictionSchema.index({ 'parameters.warnaDasar': 1 });

// Add a static method to find predictions for a specific user only
predictionSchema.statics.findForUser = function(userId, query = {}) {
  return this.find({ 
    user: userId,
    ...query
  }).sort({ date: -1 });
};

// Register model
const Prediction = mongoose.model('Prediction', predictionSchema);

// AutoData Schema - For automatic device uploads (same schema as in ml-service.js)
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

// Register AutoData model (or get existing if already registered by ml-service)
const AutoData = mongoose.models.AutoData || mongoose.model('AutoData', autoDataSchema);

// ===== AUTH MIDDLEWARE =====
// Admin check middleware
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  
  return res.status(403).json({ 
    success: false, 
    message: 'Admin access required' 
  });
};

const authenticateToken = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    // Get user ID from headers
    const userIdHeader = req.headers['user-id'];
    
    
    // No token, reject request
    if (!token && !userIdHeader) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }
    
    // If we have token, verify it
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_jwt_secret');
        
        // Set user info on request
        req.user = {
          id: decoded.userId || decoded.id,
          email: decoded.email,
          role: decoded.role
        };
        
      } catch (tokenError) {
        console.error(`[Auth] Token verification failed:`, tokenError.message);
        return res.status(403).json({
          success: false,
          message: 'Invalid token',
          error: tokenError.message
        });
      }
    } 
    // If we have user-id header but no token, use that
    else if (userIdHeader && mongoose.Types.ObjectId.isValid(userIdHeader)) {
      // Set user info on request
      req.user = {
        id: userIdHeader
      };
      
    }
    
    next();
  } catch (error) {
    console.error(`[Auth] Error:`, error.message);
    return res.status(403).json({ 
      success: false, 
      message: 'Authentication failed', 
      error: error.message 
    });
  }
};

// ===== PREDICTION ROUTES =====
// Get all predictions for a user (requires authentication)
app.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    // Get predictions for this user
    const predictions = await Prediction.findForUser(userId);
    
    return res.status(200).json({
      success: true,
      message: 'User predictions retrieved',
      data: predictions
    });
  } catch (err) {
    console.error(`[PREDICT] Error:`, err.message);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving predictions',
      error: err.message
    });
  }
});

// Get prediction statistics for a user (requires authentication)
app.get('/stats', authenticateToken, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const userId = req.user.id;
    
    // Get all predictions for the user (CSV uploads, manual predictions)
    const predictions = await Prediction.findForUser(userId);
    
    // Get all AutoData records for the user (IoT device uploads)
    const autoDataRecords = await AutoData.find({ userId: mongoose.Types.ObjectId(userId) })
      .sort({ timestamp: -1 });
    
    console.log('[STATS] Prediction count:', predictions.length);
    console.log('[STATS] AutoData count:', autoDataRecords.length);
    
    // Calculate statistics from Prediction collection - decrypt penyakit for counting
    const predictionNormalCount = predictions.filter(p => {
      const decryptedPenyakit = decrypt(p.penyakit);
      return decryptedPenyakit === 'Sehat';
    }).length;
    const predictionAbnormalCount = predictions.filter(p => {
      const decryptedPenyakit = decrypt(p.penyakit);
      return decryptedPenyakit === 'Batu Ginjal';
    }).length;
    
    // Calculate statistics from AutoData collection (predictionResult: 0=Sehat, 1=Batu Ginjal)
    const autoDataNormalCount = autoDataRecords.filter(a => a.predictionResult === 0).length;
    const autoDataAbnormalCount = autoDataRecords.filter(a => a.predictionResult === 1).length;
    
    // Aggregate totals from both collections
    const totalCount = predictions.length + autoDataRecords.length;
    const normalCount = predictionNormalCount + autoDataNormalCount;
    const abnormalCount = predictionAbnormalCount + autoDataAbnormalCount;
    
    console.log('[STATS] Total combined count:', totalCount);
    console.log('[STATS] Normal (Sehat):', normalCount, '(Predictions:', predictionNormalCount, '+ AutoData:', autoDataNormalCount, ')');
    console.log('[STATS] Abnormal (Batu Ginjal):', abnormalCount, '(Predictions:', predictionAbnormalCount, '+ AutoData:', autoDataAbnormalCount, ')');
    
    // Convert AutoData to Prediction-like format for recent predictions list
    const convertedAutoData = autoDataRecords.map(autoData => ({
      parameters: {
        ph: autoData.ph?.value,
        tds: autoData.tds?.value,
        specificGravity: autoData.specificGravity?.value,
        turbidityNTU: autoData.turbidityNTU?.value,
        red: autoData.red?.value,
        green: autoData.green?.value,
        blue: autoData.blue?.value,
        turbidityLevel: autoData.turbidityLevel,
        warnaDasar: autoData.warnaDasar
      },
      penyakit: autoData.predictionResult === 0 ? 'Sehat' : 'Batu Ginjal',
      date: autoData.timestamp,
      source: 'IoT Device',
      _id: autoData._id
    }));
    
    // Merge and sort recent predictions from both sources
    const allRecentPredictions = [...predictions, ...convertedAutoData]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);
    
    const recentPredictions = allRecentPredictions;
    
    return res.status(200).json({
    success: true,
      data: {
        totalCount,
        normalCount,
        abnormalCount,
        percentNormal: totalCount > 0 ? Math.round((normalCount / totalCount) * 100) : 0,
        percentAbnormal: totalCount > 0 ? Math.round((abnormalCount / totalCount) * 100) : 0,
        recentPredictions,
        // Optional debug info
        autoDataCount: autoDataRecords.length,
        predictionCount: predictions.length
      }
    });
  } catch (err) {
    console.error(`[PREDICT] Error fetching statistics:`, err.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching prediction statistics',
      error: err.message
    });
  }
});

// Get prediction history for a user (requires authentication)
app.get('/history', authenticateToken, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const userId = req.user.id;
    
    // Extract pagination parameters
    const limit = parseInt(req.query.limit) || 20;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;
    
    // Strict security - only allow access to the user's own predictions
    // This ignores any query parameters that might try to override the user filter
    // Even admins cannot access other users' predictions through this endpoint
    const userFilter = { user: userId };
    
    // Get predictions for this user with pagination
    const predictions = await Prediction.find(userFilter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit);
    
    // Get total count for pagination info
    const totalCount = await Prediction.countDocuments(userFilter);
    
    // Add user isolation notice in response
    return res.status(200).json({
      success: true,
      message: 'User prediction history retrieved',
      securityNote: 'This data is isolated to your user account only',
      data: predictions,
      userId: userId, // Include user ID for verification
      pagination: {
        total: totalCount,
        page,
        limit,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (err) {
    console.error(`[PREDICT] Error fetching prediction history:`, err.message);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving prediction history',
      error: err.message
    });
  }
});

// Create a new prediction (requires authentication)
app.post('/', authenticateToken, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const userId = req.user.id;
    const { parameters, notes } = req.body;
    
    // Validate parameters
    if (!parameters || !parameters.ph || !parameters.tds) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters'
      });
    }
    
    // Forward the request to ML service
    try {
      const mlAbortController = new AbortController();
      const mlTimeout = setTimeout(() => mlAbortController.abort(), 30000);
      let mlResponse;
      try {
        mlResponse = await fetch(`http://localhost:${ML_SERVICE_PORT}/predict`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'user-id': userId.toString()
          },
          body: JSON.stringify(parameters),
          signal: mlAbortController.signal
        });
      } finally {
        clearTimeout(mlTimeout);
      }
      
      const mlData = await mlResponse.json();

      // Direct early return for ML service errors — avoids throw + stack trace
      // allocation on the overload path (V2-specific: triggered by bounded ML queue 503s)
      if (!mlResponse.ok || !mlData.success) {
        return res.status(mlResponse.status >= 400 ? mlResponse.status : 503).json({
          success: false,
          message: 'ML service unavailable, unable to process prediction',
          error: mlData.error || mlData.message || 'ML Service error'
        });
      }

      // Create new prediction using the ML service response
      // Convert English prediction to Indonesian and prepare for encryption
      const indonesianResult = convertToIndonesian(mlData.predictedClass);

      const prediction = new Prediction({
        user: userId,
        parameters,
        result: mlData.result || [],
        penyakit: indonesianResult, // This will be encrypted by the pre-save middleware
        hydrationAnalysis: mlData.hydrationAnalysis || null,
        notes: notes || '',
        date: new Date()
      });

      // Save to database
      await prediction.save();

      return res.status(201).json({
        success: true,
        message: 'Prediction created successfully',
        data: prediction
      });
    } catch (mlError) {
      // Handles: AbortController timeout, response.json() parse failure, prediction.save() failure
      console.error(`[ML] Error:`, mlError.message);
      return res.status(503).json({
        success: false,
        message: 'ML service unavailable, unable to process prediction',
        error: mlError.message
      });
    }
  } catch (err) {
    console.error(`[PREDICT] Error creating prediction:`, err.message);
    return res.status(500).json({
      success: false,
      message: 'Error creating prediction',
      error: err.message
    });
  }
});


// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    success: true, 
    service: 'Prediction Service',
    instanceId: INSTANCE_ID,
    pid: process.pid,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Get prediction by ID (requires authentication)
app.get('/:id', authenticateToken, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const userId = req.user.id;
    const predictionId = req.params.id;
    
    // Find prediction by ID and ensure it belongs to the user
    const prediction = await Prediction.findOne({
      _id: predictionId,
      user: userId
    });
    
    if (!prediction) {
      return res.status(404).json({
        success: false,
        message: 'Prediction not found or access denied'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: prediction
    });
  } catch (err) {
    console.error(`[PREDICT] Error fetching prediction:`, err.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching prediction',
      error: err.message
    });
  }
});

// ===== ADMIN ROUTES =====
// Admin: Get all predictions from all users
app.get('/admin/predictions', authenticateToken, isAdmin, async (req, res) => {
  try {
    console.log(`[ADMIN] Admin ${req.user.email} requesting all predictions`);
    
    // Extract pagination parameters
    const limit = parseInt(req.query.limit) || 50;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;
    
    // Admin can see all predictions
    const predictions = await Prediction.find({})
      .populate('user', 'email name')
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit);
    
    // Get total count for pagination info
    const totalCount = await Prediction.countDocuments({});
    
    return res.status(200).json({
      success: true,
      message: 'All predictions retrieved (admin access)',
      data: predictions,
      adminAccess: true,
      pagination: {
        total: totalCount,
        page,
        limit,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (err) {
    console.error(`[ADMIN] Error fetching all predictions:`, err.message);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving all predictions',
      error: err.message
    });
  }
});

// Admin: Get predictions by specific user ID
app.get('/admin/predictions/user/:userId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    console.log(`[ADMIN] Admin ${req.user.email} requesting predictions for user ${targetUserId}`);
    
    // Extract pagination parameters
    const limit = parseInt(req.query.limit) || 20;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;
    
    // Admin can see any user's predictions
    const predictions = await Prediction.find({ user: targetUserId })
      .populate('user', 'email name')
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit);
    
    // Get total count for pagination info
    const totalCount = await Prediction.countDocuments({ user: targetUserId });
    
    return res.status(200).json({
      success: true,
      message: `User predictions retrieved (admin access)`,
      data: predictions,
      targetUserId: targetUserId,
      adminAccess: true,
      pagination: {
        total: totalCount,
        page,
        limit,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (err) {
    console.error(`[ADMIN] Error fetching user predictions:`, err.message);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving user predictions',
      error: err.message
    });
  }
});

// Admin: Get prediction statistics for all users
app.get('/admin/stats', authenticateToken, isAdmin, async (req, res) => {
  try {
    console.log(`[ADMIN] Admin ${req.user.email} requesting global statistics`);
    
    // Get all predictions
    const allPredictions = await Prediction.find({});
    
    // Calculate global statistics - decrypt penyakit for counting
    const totalCount = allPredictions.length;
    const normalCount = allPredictions.filter(p => {
      const decryptedPenyakit = decrypt(p.penyakit);
      return decryptedPenyakit === 'Sehat';
    }).length;
    const abnormalCount = allPredictions.filter(p => {
      const decryptedPenyakit = decrypt(p.penyakit);
      return decryptedPenyakit === 'Batu Ginjal';
    }).length;
    
    // Get user statistics
    const userCount = await Prediction.distinct('user').length;
    
    // Get recent predictions
    const recentPredictions = await Prediction.find({})
      .populate('user', 'email name')
      .sort({ date: -1 })
      .limit(10);
    
    return res.status(200).json({
      success: true,
      message: 'Global prediction statistics retrieved (admin access)',
      data: {
        totalPredictions: totalCount,
        normalCount,
        abnormalCount,
        percentNormal: totalCount > 0 ? Math.round((normalCount / totalCount) * 100) : 0,
        percentAbnormal: totalCount > 0 ? Math.round((abnormalCount / totalCount) * 100) : 0,
        totalUsers: userCount,
        recentPredictions,
        adminAccess: true
      }
    });
  } catch (err) {
    console.error(`[ADMIN] Error fetching global statistics:`, err.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching global statistics',
      error: err.message
    });
  }
});

// CSV upload endpoint
app.post('/csv', authenticateToken, (req, res) => {
  console.log('[CSV] Starting CSV upload request');
  console.log('[CSV] Request headers:', JSON.stringify(req.headers, null, 2));
  console.log('[CSV] Content-Type:', req.headers['content-type']);
  console.log('[CSV] Request body keys:', Object.keys(req.body || {}));
  console.log('[CSV] Request files:', req.files ? 'Present' : 'Not present');
  console.log('[CSV] Request file:', req.file ? 'Present' : 'Not present');
  
  // Use the configured csvUpload middleware
  csvUpload(req, res, async (err) => {
    let tempFilePath = null;
    
    try {
      if (err instanceof multer.MulterError) {
        console.error('[CSV] Multer error:', err);
        console.error('[CSV] Multer error details:', {
          code: err.code,
          field: err.field,
          storageErrors: err.storageErrors
        });
        return res.status(400).json({
          success: false,
          message: 'File upload error',
          error: err.message
        });
      } else if (err) {
        console.error('[CSV] Upload error:', err);
        return res.status(400).json({
          success: false,
          message: 'Error uploading file',
          error: err.message
        });
      }

      // Check if file exists in request
      if (!req.file) {
        console.error('[CSV] No file in request');
        console.error('[CSV] Request body after multer:', Object.keys(req.body || {}));
        console.error('[CSV] Request files after multer:', req.files ? 'Present' : 'Not present');
        return res.status(400).json({
          success: false,
          message: 'No CSV file uploaded'
        });
      }

      console.log(`[CSV] File received: ${req.file.originalname}, size: ${req.file.size} bytes`);
      console.log(`[CSV] File details:`, {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        encoding: req.file.encoding,
        mimetype: req.file.mimetype,
        destination: req.file.destination,
        filename: req.file.filename,
        path: req.file.path,
        size: req.file.size
      });
      tempFilePath = req.file.path;

      // First validate CSV structure
      const fileContent = await fs.promises.readFile(tempFilePath, 'utf8');
      const lines = fileContent.trim().split('\n');
      
      if (lines.length < 2) {
        throw new Error('CSV file must contain a header row and at least one data row');
      }

      // Convert to lowercase for case-insensitive CSV header matching
      const header = lines[0].toLowerCase().trim();
      const expectedHeaders = ['ph', 'tds', 'specificgravity', 'turbidityntu', 'red', 'green', 'blue', 'turbiditylevel', 'warnadasar'];
      const actualHeaders = header.split(',').map(h => h.trim());

      // Validate headers
      const missingHeaders = expectedHeaders.filter(h => !actualHeaders.includes(h));
      if (missingHeaders.length > 0) {
        throw new Error(`Invalid CSV format. Missing required columns: ${missingHeaders.join(', ')}`);
      }

      // Process the CSV file
      const results = [];
      const errors = [];

      // Parse CSV file
      console.log('[CSV] Starting CSV parsing');
      const rows = await new Promise((resolve, reject) => {
        const parsedRows = [];
        fs.createReadStream(tempFilePath)
          .pipe(csv({
            mapHeaders: ({ header }) => header.toLowerCase().trim(),
            mapValues: ({ value }) => value.trim()
          }))
          .on('data', (row) => {
            parsedRows.push(row);
          })
          .on('end', () => resolve(parsedRows))
          .on('error', reject);
      });

      // Process each row
      for (const row of rows) {
        try {
          // Validate and convert values - handle mixed numeric and categorical parameters
          const parameters = {};
          const numericFields = ['ph', 'tds', 'specificgravity', 'turbidityntu', 'red', 'green', 'blue'];
          const categoricalFields = {
            turbiditylevel: ['Jernih', 'Agak Keruh', 'Keruh'],
            warnadasar: ['BENING', 'KUNING', 'MERAH', 'COKLAT', 'ORANGE', 'HIJAU', 'BIRU']
          };
          
          for (const header of expectedHeaders) {
            if (numericFields.includes(header)) {
              // Parse numeric fields
              const value = parseFloat(row[header]);
              if (isNaN(value)) {
                throw new Error(`Invalid ${header}: must be a valid number, got '${row[header]}'`);
              }
              parameters[header] = value;
            } else if (categoricalFields[header]) {
              // Validate categorical fields
              const value = row[header];
              if (!categoricalFields[header].includes(value)) {
                throw new Error(`Invalid ${header}: must be one of [${categoricalFields[header].join(', ')}], got '${value}'`);
              }
              parameters[header] = value;
            } else {
              parameters[header] = row[header];
            }
          }

          // Normalize lowercase keys to camelCase for schema consistency
          // CSV headers are lowercased for case-insensitive parsing, but schema expects camelCase
          const keyNormalizationMap = {
            'specificgravity': 'specificGravity',
            'turbidityntu': 'turbidityNTU',
            'turbiditylevel': 'turbidityLevel',
            'warnadasar': 'warnaDasar'
          };

          const normalizedParameters = { ...parameters };
          for (const [lowercaseKey, camelCaseKey] of Object.entries(keyNormalizationMap)) {
            if (normalizedParameters[lowercaseKey] !== undefined) {
              normalizedParameters[camelCaseKey] = normalizedParameters[lowercaseKey];
              delete normalizedParameters[lowercaseKey];
            }
          }

          // Call ML service for prediction
          try {
            const mlAbortController2 = new AbortController();
            const mlTimeout2 = setTimeout(() => mlAbortController2.abort(), 30000);
            let mlResponse;
            try {
              mlResponse = await fetch(`http://localhost:${ML_SERVICE_PORT}/predict`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'user-id': req.user.id
                },
                body: JSON.stringify(normalizedParameters),
                signal: mlAbortController2.signal
              });
            } finally {
              clearTimeout(mlTimeout2);
            }

            if (!mlResponse.ok) {
              throw new Error(`ML service returned error: ${mlResponse.status}`);
            }

            const mlData = await mlResponse.json();
            
            // Create prediction record with encrypted penyakit
            const indonesianResult = convertToIndonesian(mlData.predictedClass);
            
            const prediction = new Prediction({
              user: req.user.id,
              parameters: normalizedParameters,
              result: mlData.result || [],
              penyakit: indonesianResult, // This will be encrypted by the pre-save middleware
              hydrationAnalysis: mlData.hydrationAnalysis || null,
              date: new Date()
            });

            // Save prediction
            await prediction.save();

            results.push({
              row: normalizedParameters,
              prediction: indonesianResult, // Return Indonesian result
              id: prediction.userSpecificId,
              hydrationAnalysis: mlData.hydrationAnalysis || null,
              penyakit: indonesianResult
            });
          } catch (mlError) {
            errors.push({
              row: parameters,
              error: `ML service error: ${mlError.message}`
            });
          }
        } catch (rowError) {
          errors.push({
            row: row,
            error: rowError.message
          });
        }
      }

      // Clean up temp file
      try {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
          console.log('[CSV] Cleaned up temp file:', tempFilePath);
        }
      } catch (cleanupError) {
        console.error('[CSV] Error cleaning up temp file:', cleanupError);
      }

      // Return results
      return res.status(200).json({
        success: true,
        message: 'CSV processed successfully',
        data: {
          total: rows.length,
          processed: results.length,
          failed: errors.length,
          results: results,
          errors: errors
        }
      });

    } catch (error) {
      console.error('[CSV] Error processing CSV:', error);
      
      // Clean up temp file on error
      try {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
          console.log('[CSV] Cleaned up temp file on error:', tempFilePath);
        }
      } catch (cleanupError) {
        console.error('[CSV] Error cleaning up temp file:', cleanupError);
      }

      return res.status(400).json({
        success: false,
        message: 'Error processing CSV file',
        error: error.message
      });
    }
  });
});


// Error handling middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  console.error(`[ERROR] Status: ${statusCode}, Message:`, err.message);
  
  // Never return 200 status for errors
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Server error' : err.message,
    error: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// Catch-all for unmatched routes
app.use((req, res) => {
  console.log(`[404] No route matched:`, req.method, req.url);
  return res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    error: `No endpoint exists for ${req.method} ${req.url}`
  });
});

// Connect to MongoDB with retry mechanism
const connectWithRetry = (retryCount = 0, maxRetries = 5) => {
  connectToMongoDB()
    .then(() => {
      console.log(`[PREDICTION SERVICE] Connected to MongoDB`);
    })
    .catch(err => {
      console.error(`[PREDICTION SERVICE] MongoDB connection error:`, err.message);
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        console.log(`[PREDICTION SERVICE] Retrying MongoDB connection in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})...`);
        setTimeout(() => connectWithRetry(retryCount + 1, maxRetries), delay);
      } else {
        console.error(`[PREDICTION SERVICE] Failed to connect to MongoDB after ${maxRetries} attempts`);
      }
    });
};

connectWithRetry();

// Start server - ensure MongoDB is connected first
if (mongoose.connection.readyState === 1) {
  const server = app.listen(PORT, () => {
    console.log(`[PREDICTION-SERVICE] Instance starting`, { instanceId: INSTANCE_ID, port: PORT, pid: process.pid });
    console.log(`Prediction service running on port ${PORT}`);
    
    if (process.send) {
      process.send('ready');
      console.log('[PREDICTION-SERVICE] PM2 ready signal sent', { instanceId: INSTANCE_ID });
    }
  });
} else {
  console.log(`Waiting for MongoDB connection before starting server...`);
  mongoose.connection.once('connected', () => {
    const server = app.listen(PORT, () => {
      console.log(`[PREDICTION-SERVICE] Instance starting`, { instanceId: INSTANCE_ID, port: PORT, pid: process.pid });
      console.log(`Prediction service running on port ${PORT}`);
      
      if (process.send) {
        process.send('ready');
        console.log('[PREDICTION-SERVICE] PM2 ready signal sent', { instanceId: INSTANCE_ID });
      }
    });
  });
}

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  console.log('[PREDICTION-SERVICE] Shutdown signal received', { signal: 'SIGTERM', instanceId: INSTANCE_ID, pid: process.pid });
  
  setTimeout(async () => {
    try {
      await mongoose.connection.close();
      console.log('[PREDICTION-SERVICE] MongoDB connection closed');
      process.exit(0);
    } catch (error) {
      console.error('[PREDICTION-SERVICE] Error during shutdown:', error.message);
      process.exit(1);
    }
  }, 30000);
});

process.on('SIGINT', async () => {
  console.log('[PREDICTION-SERVICE] Shutdown signal received', { signal: 'SIGINT', instanceId: INSTANCE_ID, pid: process.pid });
  
  try {
    await mongoose.connection.close();
    console.log('[PREDICTION-SERVICE] MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    console.error('[PREDICTION-SERVICE] Error during shutdown:', error.message);
    process.exit(1);
  }
});

module.exports = app; 