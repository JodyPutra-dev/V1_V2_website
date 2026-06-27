// CONSOLIDATED GATEWAY - All middleware, routes, controllers, models in one file
const express = require('express');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
const { mongoose, connectToMongoDB } = require('../db/mongo-service');
const https = require('https');
const http = require('http');
const nodemailer = require('nodemailer');

// Import cache modules
const { userCache, modelCache, adminCache } = require('../cache/cache-service');
const { cacheStatsMiddleware } = require('../cache/cache-middleware');

// Import production logger
const { createLogger, logRequest, logError } = require('../logger/production-logger');

// Instance ID must be defined before logger creation
const INSTANCE_ID_FOR_LOGGER = process.env.INSTANCE_ID || process.env.NODE_APP_INSTANCE || '0';
const logger = createLogger('gateway', { instanceId: INSTANCE_ID_FOR_LOGGER });

/**
 * ROUTING ARCHITECTURE:
 * - Most admin routes have been moved to a dedicated microservice (admin-service.js)
 * - The gateway forwards most requests to /api/admin/* to the admin service
 * - EXCEPTION: Model-related admin routes (/api/admin/models*) are forwarded to the ML service
 *   This allows ML functionality to stay in the ML services while preserving the admin URL structure
 * 
 * IMPORTANT: The app.use('/api/admin', ...) middleware has special handling for model-related
 * requests, routing them to the ML service instead of the admin service. This allows ML
 * functionality to remain in the ML services while maintaining consistent API routes.
 */

/**
 * CONSOLIDATED GATEWAY - Routing hub for all microservices
 * Routes are forwarded to their respective microservices:
 * - /api/auth/* → user-service (authentication)
 * - /api/users/* → user-service (user management)
 * - /api/admin/* → admin-service (admin operations)
 * - /api/predict/* → prediction-service (prediction operations)
 * - /api/ml/* → ml-service (machine learning operations)
 */

// Initialize Express app
const app = express();

// Environment variables
require('dotenv').config();
const PORT = process.env.PORT || 7764; // Main consolidated gateway port (HTTP)
const HTTPS_PORT = 7763; // HTTPS port
const ML_SERVICE_PORT = process.env.ML_SERVICE_PORT || 3002;
const USER_SERVICE_PORT = process.env.USER_SERVICE_PORT || 3001;
const ADMIN_SERVICE_PORT = process.env.ADMIN_SERVICE_PORT || 3003;
const PREDICTION_SERVICE_PORT = process.env.PREDICTION_SERVICE_PORT || 3004;

// Instance ID for PM2 cluster mode
const INSTANCE_ID = process.env.INSTANCE_ID || process.env.NODE_APP_INSTANCE || '0';
const DEPLOYMENT_VERSION = process.env.DEPLOYMENT_VERSION || 'V2-NGINX-PM2-OPTIMIZED';

// Setup nodemailer transporter
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: 'udetectupnvj@gmail.com',
    pass: 'kdptzimumelxtbmr'
  }
});

// Verify transporter configuration
transporter.verify(function(error, success) {
  if (error) {
    console.error(`${new Date().toISOString()}: [EMAIL] SMTP configuration error:`, error);
  } else {
    console.log(`${new Date().toISOString()}: [EMAIL] SMTP server is ready to send messages`);
  }
});

// ===== MIDDLEWARE =====
// Security
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));

// CORS configuration - More permissive for development
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: '*',  // Allow all headers to avoid CORS issues
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  credentials: false,   // Set to false when origin is '*' to avoid CORS issues
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 200
}));

// Trust proxy headers - important for NGINX proxying
app.set('trust proxy', true);

// Middleware to handle protocol and set X-Forwarded-Proto header correctly
app.use((req, res, next) => {
  // Check if request came through proxy with HTTPS
  if (req.headers['x-forwarded-proto'] === 'https') {
    req.secure = true;
  }
  
  // Add appropriate CORS headers for both HTTP and HTTPS
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');  // Allow all headers
  res.header('Access-Control-Max-Age', '86400');
  
  // Log protocol information for debugging
  console.log(`${new Date().toISOString()}: [Protocol] ${req.protocol}, secure: ${req.secure}, x-forwarded-proto: ${req.headers['x-forwarded-proto'] || 'none'}`);
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging - Only use morgan in development, Winston handles production
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('combined'));
}

// Request logging middleware for Winston
app.use((req, res, next) => {
  const startTime = Date.now();
  
  // Add X-Instance-ID header for debugging
  res.setHeader('X-Instance-ID', INSTANCE_ID);
  
  // Add Connection Keep-Alive headers for HTTP connection reuse
  // Reduces connection overhead by maintaining persistent connections
  // Note: NGINX also handles keep-alive, but adding here ensures it works in direct mode too
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Keep-Alive', 'timeout=60, max=100');
  
  // Log incoming request
  logger.info(`Incoming request: ${req.method} ${req.url}`, {
    method: req.method,
    url: req.url,
    ip: req.ip,
    instanceId: INSTANCE_ID,
    userAgent: req.headers['user-agent']
  });
  
  // Capture response
  const originalSend = res.send;
  res.send = function(data) {
    res.send = originalSend;
    const duration = Date.now() - startTime;
    logRequest(logger, req, res, duration);
    return res.send(data);
  };
  
  next();
});

// VERSION 2: All bottleneck middleware removed (sync logging, redundant JSON, duplicate parsing)
// Winston provides async logging (non-blocking)
// Middleware stack is efficient (no redundancy)
// Event loop remains responsive under load

// Create required directories
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
const modelDir = path.join(__dirname, '..', '..', 'models');
const profilesDir = path.join(uploadDir, 'profiles');

[uploadDir, modelDir, profilesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ===== DATABASE MODELS =====
// Connect to MongoDB using the mongo-service
logger.info('Connecting to MongoDB...');

// Implement a retry mechanism for MongoDB connection
const connectWithRetry = (retryCount = 0, maxRetries = 5) => {
  connectToMongoDB()
.then(() => {
      logger.info('Successfully connected to MongoDB');
})
.catch(err => {
      logError(logger, err, { context: 'MongoDB connection' });
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        logger.warn(`Retrying MongoDB connection in ${delay}ms`, { 
          attempt: retryCount + 1, 
          maxRetries 
        });
        setTimeout(() => connectWithRetry(retryCount + 1, maxRetries), delay);
      } else {
        logger.error(`Failed to connect to MongoDB after ${maxRetries} attempts`);
      }
    });
};

connectWithRetry();

// User Schema
const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  profileImage: {
    type: String,
    default: ''
  },
  lastLogin: {
    type: Date,
    default: null
  }
}, { timestamps: true });

// Add indexes for optimized queries
userSchema.index({ role: 1 });
userSchema.index({ createdAt: -1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare entered password with hashed password
userSchema.methods.comparePassword = async function(enteredPassword) {
  try {
    // Make sure both passwords are strings
    if (typeof enteredPassword !== 'string') {
      console.error(`${new Date().toISOString()}: [comparePassword] Entered password is not a string`);
      return false;
    }
    
    if (typeof this.password !== 'string') {
      console.error(`${new Date().toISOString()}: [comparePassword] Stored password is not a string:`, typeof this.password);
      return false;
    }
    
    // Log password attempt (no actual passwords)
    console.log(`${new Date().toISOString()}: [comparePassword] Comparing passwords for ${this.email}`);
    
  return await bcrypt.compare(enteredPassword, this.password);
  } catch (error) {
    console.error(`${new Date().toISOString()}: [comparePassword] Error comparing passwords:`, error);
    throw new Error(`Password comparison error: ${error.message}`);
  }
};

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
      return ret;
    }
  }
});

// Create compound index for user and date for faster queries
predictionSchema.index({ user: 1, date: -1 });
predictionSchema.index({ date: -1 });
predictionSchema.index({ penyakit: 1, date: -1 });

// Indexes for categorical parameters (V2 optimized queries)
predictionSchema.index({ 'parameters.turbidityLevel': 1 });
predictionSchema.index({ 'parameters.warnaDasar': 1 });

// Add a static method to find predictions for a specific user only
predictionSchema.statics.findForUser = function(userId, query = {}) {
  return this.find({ 
    user: userId,
    ...query
  }).sort({ date: -1 });
};

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

// Register models
const User = mongoose.model('User', userSchema);
const Prediction = mongoose.model('Prediction', predictionSchema);
const Model = mongoose.model('Model', modelSchema);

// ===== AUTH MIDDLEWARE =====
const authenticateToken = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    // Get user ID from headers
    const userIdHeader = req.headers['user-id'];
    
    console.log(`${new Date().toISOString()}: [Auth] Token received: ${token ? 'Yes' : 'No'}`);
    console.log(`${new Date().toISOString()}: [Auth] User-ID header: ${userIdHeader || 'None'}`);
    console.log(`${new Date().toISOString()}: [Auth] Request path: ${req.path}`);
    
    // Check if this is a public route that doesn't need authentication
    if (req.path === '/api/health' || 
        req.path === '/api/predict/health' ||
        req.path.startsWith('/api/auth/login') || 
        req.path.startsWith('/api/auth/register')) {
      return next();
    }
    
    // For development: Allow special dev tokens
    if (token === 'dev-admin-token') {
      console.log(`${new Date().toISOString()}: [Auth] Using development admin token`);
      // Create a mock admin user
      req.user = {
        id: 'admin-test-id',
        email: 'admin@example.com',
        name: 'Admin User',
        role: 'admin'
      };
      return next();
    }
    
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
        console.log(`${new Date().toISOString()}: [Auth] Token verified:`, decoded);
      
      // Find user in database
      const user = await User.findById(decoded.userId || decoded.id);
      if (!user) {
          console.log(`${new Date().toISOString()}: [Auth] User not found for ID:`, decoded.userId || decoded.id);
        return res.status(403).json({ 
          success: false, 
          message: 'User not found' 
        });
      }
      
      // Set user info on request
      req.user = {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role
      };
      
      console.log(`${new Date().toISOString()}: [Auth] User authenticated from token: ${user.email}`);
      } catch (tokenError) {
        console.error(`${new Date().toISOString()}: [Auth] Token verification failed:`, tokenError.message);
        return res.status(403).json({
          success: false,
          message: 'Invalid token',
          error: tokenError.message
        });
      }
    } 
    // If we have user-id header but no token, use that
    else if (userIdHeader && mongoose.Types.ObjectId.isValid(userIdHeader)) {
      const user = await User.findById(userIdHeader);
      if (!user) {
        return res.status(403).json({ 
          success: false, 
          message: 'User not found from header ID' 
        });
      }
      
      // Set user info on request
      req.user = {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role
      };
      
      console.log(`${new Date().toISOString()}: [Auth] User authenticated from header: ${user.email}`);
    }
    
    next();
  } catch (error) {
    console.error(`${new Date().toISOString()}: [Auth] Error:`, error.message);
    return res.status(403).json({ 
      success: false, 
      message: 'Authentication failed', 
      error: error.message 
    });
  }
};

// Define a simple admin check middleware for routes that still need it
// This is only used for routes that haven't been moved to admin-service yet
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  
  return res.status(403).json({ 
    success: false, 
    message: 'Admin access required' 
  });
};

// ===== ROUTES =====
// Health endpoint
app.get('/health', (req, res) => {
  res.json({ 
    success: true, 
    service: 'Consolidated Gateway',
    instanceId: INSTANCE_ID,
    version: DEPLOYMENT_VERSION,
    pid: process.pid,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Main API health check endpoint - returns basic system diagnostic info
app.get('/api/health', (req, res) => {
  const memoryUsage = process.memoryUsage();
  
  res.status(200).json({
    success: true, 
    status: 'Gateway service operational',
    version: DEPLOYMENT_VERSION,
    instanceId: INSTANCE_ID,
    pid: process.pid,
    timestamp: new Date().toISOString(),
    server: {
      nodejs: process.version,
      uptime: process.uptime(),
      memoryUsage: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`
      },
      port: PORT,
      environment: process.env.NODE_ENV || 'development'
    },
    request: {
      protocol: req.protocol,
      secure: req.secure,
      originalUrl: req.originalUrl,
      ip: req.ip,
      method: req.method,
      headers: {
        host: req.headers.host,
        'user-agent': req.headers['user-agent'],
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'x-forwarded-proto': req.headers['x-forwarded-proto']
      }
    },
    database: {
      connection: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      state: mongoose.connection.readyState
    },
    cache: {
      userCache: { size: userCache.size, hitRate: userCache.getStats().hitRateNumeric },
      modelCache: { size: modelCache.size, hitRate: modelCache.getStats().hitRateNumeric },
      adminCache: { size: adminCache.size, hitRate: adminCache.getStats().hitRateNumeric }
    },
    services: {
      ml: {
        url: `http://localhost:${ML_SERVICE_PORT}`
      },
      user: {
        url: `http://localhost:${USER_SERVICE_PORT}`
      }
    }
  });
});

// CACHE ARCHITECTURE:
// - userCache: User profile data (5 min TTL, 500 max entries)
// - modelCache: ML models list and details (10 min TTL, 100 max entries)
// - adminCache: Admin statistics (2 min TTL, 50 max entries)
// - Each microservice manages its own cache instance
// - Gateway provides consolidated monitoring endpoints
// - Cache invalidation happens in respective services after data updates

// Global cache statistics endpoint (admin only)
app.get('/api/cache/stats', authenticateToken, isAdmin, cacheStatsMiddleware({ userCache, modelCache, adminCache }));

// Cache clear endpoint (admin only, for debugging)
app.post('/api/cache/clear', authenticateToken, isAdmin, (req, res) => {
  try {
    const userSize = userCache.size;
    const modelSize = modelCache.size;
    const adminSize = adminCache.size;
    
    userCache.clear();
    modelCache.clear();
    adminCache.clear();
    
    res.json({
      success: true,
      message: 'All cache instances cleared',
      cleared: {
        userCache: userSize,
        modelCache: modelSize,
        adminCache: adminSize,
        total: userSize + modelSize + adminSize
      }
    });
  } catch (error) {
    console.error('[GATEWAY-CACHE] Error clearing caches:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error clearing caches',
      error: error.message
    });
  }
});

// Basic connectivity test endpoint
app.get('/api/test', (req, res) => {
  res.status(200).json({
    success: true, 
    message: 'API is operational',
    timestamp: new Date().toISOString(),
    protocol: req.protocol,
    hostname: req.hostname,
    originalUrl: req.originalUrl,
    method: req.method,
    headers: {
      host: req.headers.host,
      'user-agent': req.headers['user-agent'],
      'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'none'
    }
  });
});

// Detailed system info endpoint
app.get('/api/debug/system', (req, res) => {
  const memoryUsage = process.memoryUsage();
  
  res.status(200).json({
    success: true,
    timestamp: new Date().toISOString(),
    nodejs: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime(),
      memoryUsage: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`
      }
    },
    server: {
      ports: {
        http: PORT,
        https: HTTPS_PORT
      },
      environment: process.env.NODE_ENV || 'development'
    },
    connection: {
      protocol: req.protocol,
      secure: req.secure,
      hostname: req.hostname,
      ip: req.ip,
      headers: req.headers
    },
    database: {
      connectionState: mongoose.connection.readyState,
      status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    }
  });
});

// Connection test endpoint that responds with whatever protocol was used to access it
app.get('/api/debug/echo', (req, res) => {
  res.status(200).json({
    success: true,
    message: `Echo test successful using ${req.protocol.toUpperCase()}`,
    timestamp: new Date().toISOString(),
    request: {
      protocol: req.protocol,
      secure: req.secure,
      hostname: req.hostname,
      originalUrl: req.originalUrl,
      method: req.method,
      headers: req.headers
    }
  });
});

// Configure multer for profile image uploads
const profileImageUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const tempDir = path.join(__dirname, 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      console.log(`[GATEWAY] Profile image temp directory: ${tempDir}`);
      cb(null, tempDir);
    },
    filename: function (req, file, cb) {
      // Add .webp extension since user-service will convert it
      const filename = `${Date.now()}-${path.parse(file.originalname).name}.webp`;
      console.log(`[GATEWAY] Saving profile image as: ${filename}`);
      cb(null, filename);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: function (req, file, cb) {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
}).single('profileImage');

// Profile image upload route
app.put('/api/auth/me/image', authenticateToken, async (req, res) => {
  console.log('[GATEWAY] Profile image upload request received');
  
  profileImageUpload(req, res, async (err) => {
    if (err) {
      console.error('[GATEWAY] Profile image upload error:', err.message);
      return res.status(400).json({
        success: false,
        message: 'File upload error',
        error: err.message
      });
    }

    try {
      if (!req.file) {
        console.error('[GATEWAY] No profile image file in request');
        return res.status(400).json({
          success: false,
          message: 'No profile image uploaded'
        });
      }

      console.log('[GATEWAY] Profile image saved in temp:', {
        path: req.file.path,
        size: req.file.size,
        mimetype: req.file.mimetype,
        originalname: req.file.originalname
      });

      // Forward the file to user service using FormData
      const formData = new FormData();
      formData.append('profileImage', fs.createReadStream(req.file.path));
      
      // Add name if provided
      if (req.body.name) {
        formData.append('name', req.body.name);
      }

      // Forward to user service
      const userResponse = await fetch(`http://localhost:${USER_SERVICE_PORT}/api/auth/me/image`, {
        method: 'PUT',
        headers: {
          'Authorization': req.headers.authorization,
          'user-id': req.user.id
        },
        body: formData
      });

      const responseData = await userResponse.json();

      // Clean up temp file
      try {
        fs.unlinkSync(req.file.path);
        console.log('[GATEWAY] Cleaned up temp file:', req.file.path);
      } catch (cleanupError) {
        console.error('[GATEWAY] Error cleaning up temp file:', cleanupError);
      }

      // Forward the user service response
      return res.status(userResponse.status).json(responseData);

    } catch (error) {
      console.error('[GATEWAY] Error handling profile image upload:', error);
      
      // Clean up temp file on error
      if (req.file && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (cleanupError) {
          console.error('[GATEWAY] Error cleaning up temp file:', cleanupError);
        }
      }
      
      return res.status(500).json({
        success: false,
        message: 'Error uploading profile image',
        error: error.message
      });
    }
  });
});

// Forward auth and user requests to user-service
app.use(['/api/auth', '/api/users', '/api/direct-login'], async (req, res) => {
  try {
    console.log(`${new Date().toISOString()}: [USER-PROXY] Forwarding request: ${req.method} ${req.url}`);
    
    // Get authorization header
    const authHeader = req.headers.authorization;
    console.log(`${new Date().toISOString()}: [USER-PROXY] Auth header:`, authHeader ? 'Present' : 'Not present');
    
    // Check if this is a profile image request
    if (req.path.startsWith('/api/auth/profile-image/')) {
      const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
      console.log(`[USER-PROXY] [${requestId}] Profile image request: ${req.method} ${req.path}`);
      
      try {
        // Forward the request to user service
        const userResponse = await fetch(`http://localhost:${USER_SERVICE_PORT}/api/auth${req.path}${req._parsedUrl.search || ''}`, {
          method: req.method,
          headers: {
            'Authorization': authHeader,
            'Accept': 'image/webp,*/*'
          }
        });

        // Handle errors
        if (!userResponse.ok) {
          console.error(`[USER-PROXY] [${requestId}] User service error: ${userResponse.status}`);
          
          // Try to parse error response as JSON
          try {
            const errorData = await userResponse.json();
            return res.status(userResponse.status).json(errorData);
          } catch (parseError) {
          return res.status(userResponse.status).json({
            success: false,
            message: 'Error fetching profile image',
              error: userResponse.statusText
          });
          }
        }

        // Get content type from response
        const contentType = userResponse.headers.get('content-type');
        
        // If response is JSON (error message), forward it
        if (contentType && contentType.includes('application/json')) {
          const jsonData = await userResponse.json();
          return res.status(userResponse.status).json(jsonData);
        }
        
        // For image response, stream it directly
        res.set('Content-Type', 'image/webp');
        res.set('Cache-Control', userResponse.headers.get('cache-control') || 'no-cache');
        
        console.log(`[USER-PROXY] [${requestId}] Streaming WebP image response`);
        userResponse.body.pipe(res);

        return;
      } catch (error) {
        console.error(`[USER-PROXY] [${requestId}] Error:`, error);
        return res.status(500).json({
          success: false,
          message: 'Error processing profile image request',
          error: error.message
        });
      }
    }
    
    // For non-image requests, prepare headers
    const headers = {
      ...req.headers,
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    };
    delete headers.host;
    
    const url = `http://localhost:${USER_SERVICE_PORT}${req.originalUrl}`;
    
    const options = {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
    };
    
    console.log(`${new Date().toISOString()}: [USER-PROXY] Forwarding request to: ${url}`);
    
    try {
      const userResponse = await fetch(url, options);
    
      // Check if this is a profile image response
      const contentType = userResponse.headers.get('content-type');
      if (contentType && contentType.includes('image/')) {
        // For image responses, stream directly
        res.set('Content-Type', contentType);
        res.set('Cache-Control', userResponse.headers.get('cache-control') || 'no-cache');
        userResponse.body.pipe(res);
        return;
      }
      
      // For non-image requests, expect JSON
        const data = await userResponse.json();
        return res.status(userResponse.status).json(data);
    } catch (error) {
      console.error(`${new Date().toISOString()}: [USER-PROXY] Error:`, error);
      return res.status(500).json({
        success: false,
        message: 'Error forwarding request to user service',
        error: error.message
    });
  }
  } catch (error) {
    console.error(`${new Date().toISOString()}: [USER-PROXY] Error:`, error);
    return res.status(500).json({
      success: false,
      message: 'Error in proxy middleware',
      error: error.message
    });
  }
});

// Forward prediction requests to prediction-service
app.use('/api/predict', async (req, res) => {
  try {
    console.log(`${new Date().toISOString()}: [PREDICTION-PROXY] Forwarding request: ${req.method} ${req.url}`);
    
    const headers = { ...req.headers };
    delete headers.host;
    
    // Strip /api/predict prefix from the URL - use originalUrl and strip the prefix
    const strippedUrl = req.originalUrl.replace('/api/predict', '');
    const url = `http://localhost:${PREDICTION_SERVICE_PORT}${strippedUrl}`;
    
    // Special handling for multipart/form-data requests
    if (headers['content-type']?.includes('multipart/form-data')) {
      console.log(`${new Date().toISOString()}: [PREDICTION-PROXY] Handling multipart/form-data request`);
      
      // Create multer upload middleware for CSV files
      const upload = multer({ 
        storage: multer.diskStorage({
          destination: function (req, file, cb) {
            const tempDir = path.join(__dirname, 'temp');
            if (!fs.existsSync(tempDir)) {
              fs.mkdirSync(tempDir, { recursive: true });
            }
            console.log(`${new Date().toISOString()}: [PREDICTION-PROXY] Temp directory: ${tempDir}`);
            cb(null, tempDir);
          },
          filename: function (req, file, cb) {
            const filename = Date.now() + '-' + file.originalname;
            console.log(`${new Date().toISOString()}: [PREDICTION-PROXY] Saving file as: ${filename}`);
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
        limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
      }).single('csv');

      // Handle the file upload
      upload(req, res, async (err) => {
        if (err) {
          console.error(`${new Date().toISOString()}: [PREDICTION-PROXY] File upload error:`, err.message);
          return res.status(400).json({
            success: false,
            message: 'File upload error',
            error: err.message
          });
        }

        try {
          if (!req.file) {
            console.error(`${new Date().toISOString()}: [PREDICTION-PROXY] No file in request`);
            return res.status(400).json({
              success: false,
              message: 'No CSV file uploaded'
            });
          }

          console.log(`${new Date().toISOString()}: [PREDICTION-PROXY] File saved in temp:`, {
            path: req.file.path,
            size: req.file.size,
            mimetype: req.file.mimetype,
            originalname: req.file.originalname
          });

          // Create form data for forwarding
          const form = new FormData();
          
          // Read the file into a buffer instead of streaming
          const fileBuffer = fs.readFileSync(req.file.path);
          form.append('csv', fileBuffer, {
            filename: req.file.originalname,
            contentType: 'text/csv'
          });
          
          console.log(`${new Date().toISOString()}: [PREDICTION-PROXY] Created FormData with file buffer`);
          console.log(`${new Date().toISOString()}: [PREDICTION-PROXY] File exists at path: ${fs.existsSync(req.file.path)}`);
          console.log(`${new Date().toISOString()}: [PREDICTION-PROXY] File size: ${req.file.size} bytes`);
          console.log(`${new Date().toISOString()}: [PREDICTION-PROXY] Buffer size: ${fileBuffer.length} bytes`);
          
          // Add all other form fields from req.body
          for (const [key, value] of Object.entries(req.body)) {
            form.append(key, value);
            console.log(`${new Date().toISOString()}: [PREDICTION-PROXY] Added form field: ${key} = ${value}`);
          }

          // Forward to prediction service with proper headers
          // Don't set content-type for FormData - let fetch set it with boundary
          const forwardHeaders = {
            'Authorization': headers.authorization || headers['authorization'],
            'user-id': headers['user-id'] || req.user?.id?.toString()
          };
          
          console.log(`${new Date().toISOString()}: [PREDICTION-PROXY] Forwarding with headers:`, forwardHeaders);
          
          console.log(`${new Date().toISOString()}: [PREDICTION-PROXY] Forwarding CSV to URL: ${url}`);
          
          const predictionResponse = await fetch(url, {
            method: 'POST',
            headers: forwardHeaders,
            body: form
          });

          // Get the response data before cleaning up
          const responseData = await predictionResponse.json();
          
          // Clean up temp file only after getting response
          try {
            fs.unlinkSync(req.file.path);
            console.log(`${new Date().toISOString()}: [PREDICTION-PROXY] Cleaned up temp file: ${req.file.path}`);
          } catch (cleanupError) {
            console.error(`${new Date().toISOString()}: [PREDICTION-PROXY] Error cleaning up temp file:`, cleanupError);
            // Don't fail the request if cleanup fails
          }
          
          // Return the prediction service response
          return res.status(predictionResponse.status).json(responseData);
        } catch (error) {
          // Clean up temp file on error
          if (req.file && fs.existsSync(req.file.path)) {
            try {
              fs.unlinkSync(req.file.path);
              console.log(`${new Date().toISOString()}: [PREDICTION-PROXY] Cleaned up temp file on error: ${req.file.path}`);
            } catch (cleanupError) {
              console.error(`${new Date().toISOString()}: [PREDICTION-PROXY] Error cleaning up temp file:`, cleanupError);
            }
          }
          
          console.error(`${new Date().toISOString()}: [PREDICTION-PROXY] Error:`, error.message);
          return res.status(500).json({
            success: false,
            message: 'Error processing file upload',
            error: error.message
          });
        }
      });
      return;
    }
    
    // For non-multipart requests, use the existing logic
    const options = {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
    };
    
    try {
      // Add timeout to the request
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const predictionResponse = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeout);

      // Parse response directly as JSON
      let responseData;
      try {
        responseData = await predictionResponse.json();
      } catch (parseError) {
        return res.status(502).json({
          success: false,
          message: 'Invalid response from prediction service',
          error: `Parse error: ${parseError.message}`
        });
      }

      // Check if the response is OK
      if (!predictionResponse.ok) {
        return res.status(predictionResponse.status).json({
          success: false,
          error: responseData?.error || responseData?.message || predictionResponse.statusText
        });
      }

      // Return successful response
      return res.status(predictionResponse.status).json(responseData);
      
    } catch (fetchError) {
      console.error(`${new Date().toISOString()}: [PREDICTION-PROXY] Fetch error:`, fetchError.message);
      console.error(`${new Date().toISOString()}: [PREDICTION-PROXY] Error stack:`, fetchError.stack);
      
      // Handle different types of errors
      let errorMessage = 'Prediction service unavailable';
      let statusCode = 503;
      
      if (fetchError.name === 'AbortError') {
        errorMessage = 'Prediction service request timed out';
        statusCode = 504;
      } else if (fetchError.code === 'ECONNREFUSED') {
        errorMessage = 'Prediction service is not running';
        statusCode = 503;
      } else if (fetchError.code === 'ENOTFOUND') {
        errorMessage = 'Prediction service host not found';
        statusCode = 502;
      }
      
      return res.status(statusCode).json({
        success: false,
        message: errorMessage,
        error: fetchError.message,
        code: fetchError.code || 'UNKNOWN_ERROR'
      });
    }
  } catch (error) {
    console.error(`${new Date().toISOString()}: [PREDICTION-PROXY] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error connecting to prediction service',
      error: error.message
    });
  }
});

// ML SERVICE PROXY ROUTES
// Forward ML service requests
app.use('/api/ml', async (req, res) => {
  try {
    // Log the ML service request for debugging
    console.log(`${new Date().toISOString()}: [ML-PROXY] Forwarding request: ${req.method} ${req.url}`);
    
    // Special case for models endpoint - just forward directly without special handling
    if (req.method === 'GET' && (req.url === '/models' || req.url === 'models')) {
      console.log(`${new Date().toISOString()}: [ML-PROXY] Forwarding models request directly to ML service`);
      // Let it fall through to the general forwarding logic below
    }
    
    // Special case for model status update
    if (req.method === 'PUT' && (req.url === '/model/status' || req.url === 'model/status')) {
      console.log(`${new Date().toISOString()}: [ML-STATUS] Handling model status update`);
      
      try {
        const { id, active } = req.body;
        
        if (id === undefined || active === undefined) {
          return res.status(400).json({
            success: false,
            message: 'Missing required parameters: id and active'
          });
        }
        
        console.log(`${new Date().toISOString()}: [ML-STATUS] Updating model ${id} status to: ${active}`);
        
        // Forward request to ML service
        const mlUrl = `http://localhost:${ML_SERVICE_PORT}/model/status`;
        const mlResponse = await fetch(mlUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...req.headers
          },
          body: JSON.stringify({ id, active })
        });
        
        if (!mlResponse.ok) {
          const errorData = await mlResponse.json();
          return res.status(mlResponse.status).json({
            success: false,
            message: 'Error updating model status',
            error: errorData.message || mlResponse.statusText
          });
        }
        
        const data = await mlResponse.json();
        return res.status(200).json(data);
      } catch (error) {
        console.error(`${new Date().toISOString()}: [ML-STATUS] Error updating model status:`, error);
        return res.status(500).json({
          success: false,
          message: 'Error updating model status',
          error: error.message
        });
      }
    }
    
    // Special case for model accuracy update
    if (req.method === 'PUT' && (req.url === '/model/accuracy' || req.url === 'model/accuracy')) {
      console.log(`${new Date().toISOString()}: [ML-ACCURACY] Handling model accuracy update`);
      console.log(`${new Date().toISOString()}: [ML-ACCURACY] Request body:`, JSON.stringify(req.body));
      
      try {
        const { id, accuracy } = req.body;
        
        // Debug the types and values
        console.log(`${new Date().toISOString()}: [ML-ACCURACY] ID: ${id}, type: ${typeof id}`);
        console.log(`${new Date().toISOString()}: [ML-ACCURACY] Accuracy: ${accuracy}, type: ${typeof accuracy}`);
        
        if (!id || accuracy === undefined) {
          console.log(`${new Date().toISOString()}: [ML-ACCURACY] Missing required parameters`);
          return res.status(400).json({
            success: false,
            message: 'Missing required parameters: id and accuracy'
          });
        }
        
        // Try to parse the accuracy to ensure it's a valid number
        const parsedAccuracy = parseFloat(accuracy);
        if (isNaN(parsedAccuracy)) {
          console.log(`${new Date().toISOString()}: [ML-ACCURACY] Invalid accuracy format: Not a number`);
          return res.status(400).json({
            success: false,
            message: 'Accuracy must be a valid number'
          });
        }
        
        // Check accuracy range
        if (parsedAccuracy < 0 || parsedAccuracy > 1) {
          console.log(`${new Date().toISOString()}: [ML-ACCURACY] Invalid accuracy range: ${parsedAccuracy} (must be between 0-1)`);
          return res.status(400).json({
            success: false,
            message: 'Accuracy must be a number between 0 and 1'
          });
        }
        
        console.log(`${new Date().toISOString()}: [ML-ACCURACY] Updating model ${id} accuracy to: ${parsedAccuracy}`);
        
        // Forward request to ML service with the parsed accuracy for consistency
        const mlUrl = `http://localhost:${ML_SERVICE_PORT}/model/accuracy`;
        const mlResponse = await fetch(mlUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...req.headers
          },
          body: JSON.stringify({ id, accuracy: parsedAccuracy })
        });
        
        if (!mlResponse.ok) {
          const errorData = await mlResponse.json();
          console.error(`${new Date().toISOString()}: [ML-PROXY] ML service error:`, errorData);
          return res.status(mlResponse.status).json({
            success: false,
            message: 'Error updating model accuracy',
            error: errorData.message || mlResponse.statusText
          });
        }
        
        const data = await mlResponse.json();
        return res.status(200).json(data);
      } catch (error) {
        console.error(`${new Date().toISOString()}: [ML-PROXY] Error forwarding model accuracy:`, error.message);
        return res.status(500).json({
          success: false,
          message: 'Error updating model accuracy',
          error: error.message
        });
      }
    }
    
    // Special case for model version update
    if (req.method === 'PUT' && (req.url === '/model/version' || req.url === 'model/version')) {
      console.log(`${new Date().toISOString()}: [ML-VERSION] Handling model version update`);
      
      try {
        const { id, version } = req.body;
        
        if (!id || !version) {
          return res.status(400).json({
            success: false,
            message: 'Missing required parameters: id and version'
          });
        }
        
        console.log(`${new Date().toISOString()}: [ML-VERSION] Updating model ${id} version to: ${version}`);
        
        // Forward request to ML service
        const mlUrl = `http://localhost:${ML_SERVICE_PORT}/model/version`;
        const mlResponse = await fetch(mlUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...req.headers
          },
          body: JSON.stringify({ id, version })
        });
        
        if (!mlResponse.ok) {
          const errorData = await mlResponse.json();
          return res.status(mlResponse.status).json({
            success: false,
            message: 'Error updating model version',
            error: errorData.message || mlResponse.statusText
          });
        }
        
        const data = await mlResponse.json();
        return res.status(200).json(data);
      } catch (error) {
        console.error(`${new Date().toISOString()}: [ML-VERSION] Error updating model version:`, error);
        return res.status(500).json({
          success: false,
          message: 'Error updating model version',
          error: error.message
        });
      }
    }
    
    // Special case for model name update
    if (req.method === 'PUT' && (req.url === '/model/name' || req.url === 'model/name')) {
      console.log(`${new Date().toISOString()}: [ML-NAME] Handling model name update`);
      
      try {
        const { id, name } = req.body;
        
        if (!id || !name) {
          return res.status(400).json({
            success: false,
            message: 'Missing required parameters: id and name'
          });
        }
        
        console.log(`${new Date().toISOString()}: [ML-NAME] Updating model ${id} name to: ${name}`);
        
        // Forward request to ML service
        const mlUrl = `http://localhost:${ML_SERVICE_PORT}/model/name`;
        const mlResponse = await fetch(mlUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...req.headers
          },
          body: JSON.stringify({ id, name })
        });
        
        if (!mlResponse.ok) {
          const errorData = await mlResponse.json();
          return res.status(mlResponse.status).json({
            success: false,
            message: 'Error updating model name',
            error: errorData.message || mlResponse.statusText
          });
        }
        
        const data = await mlResponse.json();
        return res.status(200).json(data);
      } catch (error) {
        console.error(`${new Date().toISOString()}: [ML-NAME] Error updating model name:`, error);
        return res.status(500).json({
          success: false,
          message: 'Error updating model name',
          error: error.message
        });
      }
    }
    
    // Special case for model description update
    if (req.method === 'PUT' && (req.url === '/model/description' || req.url === 'model/description')) {
      console.log(`${new Date().toISOString()}: [ML-DESCRIPTION] Handling model description update`);
      
      try {
        const { id, description } = req.body;
        
        if (!id || !description) {
          return res.status(400).json({
            success: false,
            message: 'Missing required parameters: id and description'
          });
        }
        
        console.log(`${new Date().toISOString()}: [ML-DESCRIPTION] Updating model ${id} description`);
        
        // Forward request to ML service
        const mlUrl = `http://localhost:${ML_SERVICE_PORT}/model/description`;
        const mlResponse = await fetch(mlUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...req.headers
          },
          body: JSON.stringify({ id, description })
        });
        
        if (!mlResponse.ok) {
          const errorData = await mlResponse.json();
          return res.status(mlResponse.status).json({
            success: false,
            message: 'Error updating model description',
            error: errorData.message || mlResponse.statusText
          });
        }
        
        const data = await mlResponse.json();
        return res.status(200).json(data);
      } catch (error) {
        console.error(`${new Date().toISOString()}: [ML-DESCRIPTION] Error updating model description:`, error);
        return res.status(500).json({
          success: false,
          message: 'Error updating model description',
          error: error.message
        });
      }
    }
    
    // Special case for model deletion
    if (req.method === 'DELETE' && req.url.startsWith('/model/')) {
      console.log(`${new Date().toISOString()}: [ML-DELETE] Handling model deletion`);
      
      try {
        // Extract model ID from URL
        const modelId = req.url.split('/').pop();
        
        if (!modelId) {
          return res.status(400).json({
            success: false,
            message: 'Missing model ID'
          });
        }
        
        console.log(`${new Date().toISOString()}: [ML-DELETE] Deleting model ${modelId}`);
        
        // Forward request to ML service
        const mlUrl = `http://localhost:${ML_SERVICE_PORT}/model/${modelId}`;
        const mlResponse = await fetch(mlUrl, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...req.headers
          }
        });
        
        if (!mlResponse.ok) {
          const errorData = await mlResponse.json();
          return res.status(mlResponse.status).json({
            success: false,
            message: 'Error deleting model',
            error: errorData.message || mlResponse.statusText
          });
        }
        
        const data = await mlResponse.json();
        return res.status(200).json(data);
      } catch (error) {
        console.error(`${new Date().toISOString()}: [ML-DELETE] Error deleting model:`, error);
        return res.status(500).json({
          success: false,
          message: 'Error deleting model',
          error: error.message
        });
      }
    }
    
    // Continue with the rest of the code...
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      // Only include auth headers if present
      ...(req.headers.authorization && { 'Authorization': req.headers.authorization }),
      ...(req.headers['user-id'] && { 'user-id': req.headers['user-id'] })
    };
    
    const url = `http://localhost:${ML_SERVICE_PORT}${req.url}`;
    
    const options = {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
    };
    
    console.log(`${new Date().toISOString()}: [ML-PROXY] Forwarding request to: ${url}`);
    
    // Retry logic for service initialization issues
    const maxRetries = 3;
    const baseDelay = 200; // Start with 200ms
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`${new Date().toISOString()}: [ML-PROXY] Attempt ${attempt}/${maxRetries} for ${url}`);
        
        // Add timeout to fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout per attempt
        
        const mlResponse = await fetch(url, {
          ...options,
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
      
        console.log(`${new Date().toISOString()}: [ML-PROXY] ML service response status: ${mlResponse.status}`);
        console.log(`${new Date().toISOString()}: [ML-PROXY] ML service response headers:`, [...mlResponse.headers.entries()]);
        
        // Check if the response is OK
        if (!mlResponse.ok) {
          console.error(`${new Date().toISOString()}: [ML-PROXY] ML service returned error status: ${mlResponse.status}`);
          
          // For non-200 responses, don't retry - return immediately
          try {
            const errorData = await mlResponse.json();
            return res.status(mlResponse.status).json({
              success: false,
              message: `ML service returned error: ${mlResponse.status}`,
              error: errorData.message || mlResponse.statusText
            });
          } catch (parseError) {
            return res.status(mlResponse.status).json({
              success: false,
              message: `ML service returned error: ${mlResponse.status}`,
              error: mlResponse.statusText
            });
          }
        }
        
        // Get response as text first, then parse
        const responseText = await mlResponse.text();
        console.log(`${new Date().toISOString()}: [ML-PROXY] Response length: ${responseText.length}`);
        console.log(`${new Date().toISOString()}: [ML-PROXY] Response preview: ${responseText.substring(0, 100)}${responseText.length > 100 ? '...' : ''}`);
        
        if (!responseText.trim()) {
          console.error(`${new Date().toISOString()}: [ML-PROXY] Empty response from ML service on attempt ${attempt}`);
          
          // If this is the last attempt, return error
          if (attempt === maxRetries) {
            return res.status(502).json({
              success: false,
              message: 'ML service returned empty response after all retries',
              error: 'Service may be initializing or experiencing issues'
            });
          }
          
          // Otherwise, continue to retry logic
          throw new Error('Empty response - retry needed');
        }
        
        // Try to parse as JSON
        try {
          const data = JSON.parse(responseText);
          console.log(`${new Date().toISOString()}: [ML-PROXY] Successfully parsed JSON response on attempt ${attempt}`);
          return res.status(mlResponse.status).json(data);
        } catch (parseError) {
          console.error(`${new Date().toISOString()}: [ML-PROXY] JSON parse error on attempt ${attempt}:`, parseError.message);
          console.error(`${new Date().toISOString()}: [ML-PROXY] Response text:`, responseText.substring(0, 500));
          
          // Check if it's the "Unexpected end of JSON input" error (service initializing)
          if (parseError.message.includes('Unexpected end of JSON input') || 
              parseError.message.includes('Unexpected token') ||
              !responseText.trim()) {
            
            console.log(`${new Date().toISOString()}: [ML-PROXY] Service appears to be initializing, attempt ${attempt}/${maxRetries}`);
            
            // If this is the last attempt, return error
            if (attempt === maxRetries) {
              return res.status(503).json({
                success: false,
                message: 'ML service still initializing after all retries',
                error: `JSON parse error: ${parseError.message}`,
                responsePreview: responseText.substring(0, 200)
              });
            }
            
            // Otherwise, continue to retry logic
            throw new Error(`Service initializing - retry needed: ${parseError.message}`);
          }
          
          // For other JSON errors, check if it looks like HTML (error page)
          if (responseText.trim().startsWith('<')) {
            return res.status(502).json({
              success: false,
              message: 'ML service returned HTML instead of JSON',
              error: 'Service may be down or misconfigured'
            });
          }
          
          // For other parse errors, return immediately (don't retry)
          return res.status(502).json({
            success: false,
            message: 'Invalid JSON response from ML service',
            error: parseError.message,
            responsePreview: responseText.substring(0, 200)
          });
        }
        
      } catch (attemptError) {
        console.error(`${new Date().toISOString()}: [ML-PROXY] Attempt ${attempt} error:`, attemptError.message);
        
        // Handle timeout
        if (attemptError.name === 'AbortError') {
          console.log(`${new Date().toISOString()}: [ML-PROXY] Timeout on attempt ${attempt}/${maxRetries}`);
          
          if (attempt === maxRetries) {
            return res.status(504).json({
              success: false,
              message: 'ML service timeout after all retries',
              error: 'Request to ML service timed out'
            });
          }
        }
        
        // Handle connection errors
        if (attemptError.code === 'ECONNREFUSED' || attemptError.message.includes('ECONNREFUSED')) {
          console.log(`${new Date().toISOString()}: [ML-PROXY] Connection refused on attempt ${attempt}/${maxRetries}`);
          
          if (attempt === maxRetries) {
            return res.status(503).json({
              success: false,
              message: 'ML service unavailable after all retries',
              error: 'Connection refused - service may be down'
            });
          }
        }
        
        // For other errors, if it's the last attempt, return error
        if (attempt === maxRetries) {
          return res.status(503).json({
            success: false,
            message: 'ML service unavailable after all retries',
            error: attemptError.message
          });
        }
        
        // Wait before retrying with exponential backoff
        const delay = baseDelay * Math.pow(2, attempt - 1); // 200ms, 400ms, 800ms
        console.log(`${new Date().toISOString()}: [ML-PROXY] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // This should never be reached, but just in case
    return res.status(503).json({
      success: false,
      message: 'ML service unavailable',
      error: 'All retry attempts exhausted'
    });
  } catch (error) {
    console.error(`${new Date().toISOString()}: [ML-PROXY] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error connecting to ML service',
      error: error.message
    });
  }
});

// Admin middleware - forwarding to admin service
app.use('/api/admin', async (req, res) => {
  try {
    // Special case for prediction-related admin endpoints - forward to prediction service
    if (req.originalUrl.startsWith('/api/admin/predictions')) {
      console.log(`${new Date().toISOString()}: [ADMIN-PREDICTION-PROXY] Forwarding prediction admin request: ${req.method} ${req.originalUrl}`);
      
      const headers = { ...req.headers };
      delete headers.host;
      
      // Forward to prediction service with admin path
      const predictionPath = req.originalUrl.replace('/api/admin', '/admin');
      const url = `http://localhost:${PREDICTION_SERVICE_PORT}${predictionPath}`;
      
      console.log(`${new Date().toISOString()}: [ADMIN-PREDICTION-PROXY] Forwarding to prediction service: ${url}`);
      
      // Retry logic for prediction service initialization issues
      const maxRetries = 3;
      const baseDelay = 150; // Start with 150ms
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`${new Date().toISOString()}: [ADMIN-PREDICTION-PROXY] Attempt ${attempt}/${maxRetries} for ${url}`);
          
          const predictionResponse = await fetch(url, {
            method: req.method,
            headers: {
              ...headers,
              'Content-Type': headers['content-type'] || 'application/json',
              // Ensure auth headers are properly forwarded
              ...(req.headers.authorization && { 'Authorization': req.headers.authorization }),
              ...(req.headers['user-id'] && { 'user-id': req.headers['user-id'] })
            },
            body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
          });
          
          console.log(`${new Date().toISOString()}: [ADMIN-PREDICTION-PROXY] Prediction service response status: ${predictionResponse.status}`);
          
          if (!predictionResponse.ok) {
            const errorData = await predictionResponse.json();
            console.error(`${new Date().toISOString()}: [ADMIN-PREDICTION-PROXY] Prediction service error:`, errorData);
            
            // Don't retry for authentication errors (401/403) or client errors (4xx)
            if (predictionResponse.status >= 400 && predictionResponse.status < 500) {
              return res.status(predictionResponse.status).json({
                success: false,
                message: 'Error from prediction service',
                error: errorData.message || predictionResponse.statusText
              });
            }
            
            // For server errors (5xx), retry if not the last attempt
            if (attempt === maxRetries) {
              return res.status(predictionResponse.status).json({
                success: false,
                message: 'Error from prediction service after all retries',
                error: errorData.message || predictionResponse.statusText
              });
            }
            
            throw new Error(`Server error ${predictionResponse.status} - retry needed`);
          }
          
          const responseText = await predictionResponse.text();
          console.log(`${new Date().toISOString()}: [ADMIN-PREDICTION-PROXY] Response length: ${responseText.length}`);
          
          if (!responseText.trim()) {
            console.error(`${new Date().toISOString()}: [ADMIN-PREDICTION-PROXY] Empty response on attempt ${attempt}`);
            
            if (attempt === maxRetries) {
              return res.status(502).json({
                success: false,
                message: 'Prediction service returned empty response after all retries',
                error: 'Service may be initializing'
              });
            }
            
            throw new Error('Empty response - retry needed');
          }
          
          try {
            const data = JSON.parse(responseText);
            console.log(`${new Date().toISOString()}: [ADMIN-PREDICTION-PROXY] Successfully parsed JSON response on attempt ${attempt}`);
            return res.json(data);
          } catch (parseError) {
            console.error(`${new Date().toISOString()}: [ADMIN-PREDICTION-PROXY] JSON parse error on attempt ${attempt}:`, parseError.message);
            
            // Check if it's a service initialization issue
            if (parseError.message.includes('Unexpected end of JSON input') || 
                parseError.message.includes('Unexpected token')) {
              
              console.log(`${new Date().toISOString()}: [ADMIN-PREDICTION-PROXY] Service appears to be initializing, attempt ${attempt}/${maxRetries}`);
              
              if (attempt === maxRetries) {
                return res.status(503).json({
                  success: false,
                  message: 'Prediction service still initializing after all retries',
                  error: `JSON parse error: ${parseError.message}`
                });
              }
              
              throw new Error(`Service initializing - retry needed: ${parseError.message}`);
            }
            
            // For other parse errors, return immediately
            return res.status(502).json({
              success: false,
              message: 'Invalid JSON response from prediction service',
              error: parseError.message
            });
          }
          
        } catch (attemptError) {
          console.error(`${new Date().toISOString()}: [ADMIN-PREDICTION-PROXY] Attempt ${attempt} error:`, attemptError.message);
          
          // If this is the last attempt, return error
          if (attempt === maxRetries) {
            return res.status(503).json({
              success: false,
              message: 'Prediction service unavailable after all retries',
              error: attemptError.message
            });
          }
          
          // Wait before retrying with exponential backoff
          const delay = baseDelay * Math.pow(2, attempt - 1); // 150ms, 300ms, 600ms
          console.log(`${new Date().toISOString()}: [ADMIN-PREDICTION-PROXY] Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // Special case for stats endpoint - forward to admin service with retry logic
    if (req.originalUrl.startsWith('/api/admin/stats')) {
      console.log(`${new Date().toISOString()}: [ADMIN-STATS-PROXY] Forwarding stats request: ${req.method} ${req.originalUrl}`);
      
      const headers = { ...req.headers };
      delete headers.host;
      
      const url = `http://localhost:${ADMIN_SERVICE_PORT}${req.originalUrl}`;
      console.log(`${new Date().toISOString()}: [ADMIN-STATS-PROXY] Forwarding to admin service: ${url}`);
      
      // Retry logic for admin service initialization issues
      const maxRetries = 3;
      const baseDelay = 150; // Start with 150ms
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`${new Date().toISOString()}: [ADMIN-STATS-PROXY] Attempt ${attempt}/${maxRetries} for ${url}`);
          
          const adminResponse = await fetch(url, {
            method: req.method,
            headers: {
              ...headers,
              'Content-Type': headers['content-type'] || 'application/json',
              // Ensure auth headers are properly forwarded
              ...(req.headers.authorization && { 'Authorization': req.headers.authorization }),
              ...(req.headers['user-id'] && { 'user-id': req.headers['user-id'] })
            },
            body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
          });
          
          console.log(`${new Date().toISOString()}: [ADMIN-STATS-PROXY] Admin service response status: ${adminResponse.status}`);
          
          if (!adminResponse.ok) {
            const errorData = await adminResponse.json();
            console.error(`${new Date().toISOString()}: [ADMIN-STATS-PROXY] Admin service error:`, errorData);
            
            // Don't retry for authentication errors (401/403) or client errors (4xx)
            if (adminResponse.status >= 400 && adminResponse.status < 500) {
              return res.status(adminResponse.status).json({
                success: false,
                message: 'Error from admin service',
                error: errorData.message || adminResponse.statusText
              });
            }
            
            // For server errors (5xx), retry if not the last attempt
            if (attempt === maxRetries) {
              return res.status(adminResponse.status).json({
                success: false,
                message: 'Error from admin service after all retries',
                error: errorData.message || adminResponse.statusText
              });
            }
            
            throw new Error(`Server error ${adminResponse.status} - retry needed`);
          }
          
          const responseText = await adminResponse.text();
          console.log(`${new Date().toISOString()}: [ADMIN-STATS-PROXY] Response length: ${responseText.length}`);
          
          if (!responseText.trim()) {
            console.error(`${new Date().toISOString()}: [ADMIN-STATS-PROXY] Empty response on attempt ${attempt}`);
            
            if (attempt === maxRetries) {
              return res.status(502).json({
                success: false,
                message: 'Admin service returned empty response after all retries',
                error: 'Service may be initializing'
              });
            }
            
            throw new Error('Empty response - retry needed');
          }
          
          try {
            const data = JSON.parse(responseText);
            console.log(`${new Date().toISOString()}: [ADMIN-STATS-PROXY] Successfully parsed JSON response on attempt ${attempt}`);
            return res.json(data);
          } catch (parseError) {
            console.error(`${new Date().toISOString()}: [ADMIN-STATS-PROXY] JSON parse error on attempt ${attempt}:`, parseError.message);
            
            // Check if it's a service initialization issue
            if (parseError.message.includes('Unexpected end of JSON input') || 
                parseError.message.includes('Unexpected token')) {
              
              console.log(`${new Date().toISOString()}: [ADMIN-STATS-PROXY] Service appears to be initializing, attempt ${attempt}/${maxRetries}`);
              
              if (attempt === maxRetries) {
                return res.status(503).json({
                  success: false,
                  message: 'Admin service still initializing after all retries',
                  error: `JSON parse error: ${parseError.message}`
                });
              }
              
              throw new Error(`Service initializing - retry needed: ${parseError.message}`);
            }
            
            // For other parse errors, return immediately
            return res.status(502).json({
              success: false,
              message: 'Invalid JSON response from admin service',
              error: parseError.message
            });
          }
          
        } catch (attemptError) {
          console.error(`${new Date().toISOString()}: [ADMIN-STATS-PROXY] Attempt ${attempt} error:`, attemptError.message);
          
          // If this is the last attempt, return error
          if (attempt === maxRetries) {
            return res.status(503).json({
              success: false,
              message: 'Admin service unavailable after all retries',
              error: attemptError.message
            });
          }
          
          // Wait before retrying with exponential backoff
          const delay = baseDelay * Math.pow(2, attempt - 1); // 150ms, 300ms, 600ms
          console.log(`${new Date().toISOString()}: [ADMIN-STATS-PROXY] Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // Special case for model-related endpoints - forward to ML service
    if (req.originalUrl.startsWith('/api/admin/models')) {
      console.log(`${new Date().toISOString()}: [ADMIN-ML-PROXY] Forwarding model request: ${req.method} ${req.originalUrl}`);
      
      const headers = { ...req.headers };
      delete headers.host;
      
      // For model uploads, forward to the ML service's upload-model endpoint
      // Strip the '/api/admin' prefix to make it '/models'
      const mlPath = req.originalUrl.replace('/api/admin', '');
      const url = `http://localhost:${ML_SERVICE_PORT}${mlPath}`;
      
      console.log(`${new Date().toISOString()}: [ADMIN-ML-PROXY] Forwarding to ML service: ${url}`);
      
      // For file uploads (POST with multipart/form-data)
      if (req.method === 'POST' && req.headers['content-type']?.includes('multipart/form-data')) {
    // Create multer upload middleware
    const upload = multer({ 
      storage: multer.diskStorage({
        destination: function (req, file, cb) {
          const tempDir = path.join(__dirname, 'temp');
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }
              console.log(`${new Date().toISOString()}: [ADMIN-ML-PROXY] Temp directory: ${tempDir}`);
          cb(null, tempDir);
        },
        filename: function (req, file, cb) {
          const filename = Date.now() + '-' + file.originalname;
              console.log(`${new Date().toISOString()}: [ADMIN-ML-PROXY] Saving file as: ${filename}`);
          cb(null, filename);
        }
      }),
      limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
    }).single('model');

        // Handle the file upload
    upload(req, res, async (err) => {
      if (err) {
            console.error(`${new Date().toISOString()}: [ADMIN-ML-PROXY] File upload error:`, err.message);
        return res.status(400).json({
          success: false,
          message: 'File upload error',
          error: err.message
        });
      }

      try {
        if (!req.file) {
              console.error(`${new Date().toISOString()}: [ADMIN-ML-PROXY] No file in request`);
          return res.status(400).json({
            success: false,
            message: 'No model file uploaded'
          });
        }

            console.log(`${new Date().toISOString()}: [ADMIN-ML-PROXY] File saved in temp:`, {
          path: req.file.path,
          size: req.file.size,
          mimetype: req.file.mimetype,
          originalname: req.file.originalname
        });

        // Forward the file to ML service using fetch and FormData
        const formData = new FormData();
        formData.append('model', fs.createReadStream(req.file.path));
        
        // Add all other form fields from req.body
        for (const [key, value] of Object.entries(req.body)) {
          formData.append(key, value);
        }
        
        // Add user ID if available
        if (req.user?.id) {
          formData.append('userId', req.user.id);
        }
        
        // Send to ML service
        const mlResponse = await fetch(`http://localhost:${ML_SERVICE_PORT}/upload-model`, {
          method: 'POST',
          body: formData
        });
        
        // Clean up temp file
        try {
          fs.unlinkSync(req.file.path);
          console.log(`${new Date().toISOString()}: [ADMIN-ML-PROXY] Cleaned up temp file: ${req.file.path}`);
        } catch (cleanupError) {
          console.error(`${new Date().toISOString()}: [ADMIN-ML-PROXY] Error cleaning up temp file:`, cleanupError);
        }
        
        if (!mlResponse.ok) {
          const errorData = await mlResponse.json();
          console.error(`${new Date().toISOString()}: [ADMIN-ML-PROXY] ML service error:`, errorData);
          return res.status(mlResponse.status).json({
            success: false,
            message: 'Error from ML service',
            error: errorData.message || mlResponse.statusText
          });
        }
        
        const result = await mlResponse.json();
        return res.status(201).json({
          success: true,
          message: 'Model uploaded successfully',
          data: result
        });
      } catch (error) {
            console.error(`${new Date().toISOString()}: [ADMIN-ML-PROXY] Error:`, error.message);
        return res.status(500).json({
          success: false,
          message: 'Error uploading model',
          error: error.message
        });
      }
    });
        return; // Important: return here to end the middleware chain
      } else {
        // For non-file uploads, forward the request to ML service
        try {
          const mlResponse = await fetch(url, {
            method: req.method,
            headers: {
              ...headers,
              'Content-Type': headers['content-type'] || 'application/json'
            },
            body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
          });
          
          if (!mlResponse.ok) {
            const errorData = await mlResponse.json();
            console.error(`${new Date().toISOString()}: [ADMIN-ML-PROXY] ML service error:`, errorData);
            return res.status(mlResponse.status).json({
      success: false,
              message: 'Error from ML service',
              error: errorData.message || mlResponse.statusText
            });
          }
          
          const data = await mlResponse.json();
          return res.json(data);
        } catch (mlError) {
          console.error(`${new Date().toISOString()}: [ADMIN-ML-PROXY] Error forwarding to ML service:`, mlError.message);
          return res.status(503).json({
            success: false,
            message: 'ML service unavailable',
            error: mlError.message
          });
        }
      }
    }
    
    // For all other admin routes, forward to the admin service
    console.log(`${new Date().toISOString()}: [ADMIN-PROXY] Forwarding request: ${req.method} ${req.originalUrl}`);
    
    const headers = { ...req.headers };
    delete headers.host;
    
    // Make sure we're using the full originalUrl to preserve the complete path
    const url = `http://localhost:${ADMIN_SERVICE_PORT}${req.originalUrl}`;
    
    const options = {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
    };
    
    console.log(`${new Date().toISOString()}: [ADMIN-PROXY] Forwarding request to: ${url}`);
    
    try {
      const adminResponse = await fetch(url, options);
      
      // Check if the response is OK
      if (!adminResponse.ok) {
        console.error(`${new Date().toISOString()}: [ADMIN-PROXY] Admin service returned error status: ${adminResponse.status}`);
        
        // Try to parse error response
        try {
          const errorData = await adminResponse.json();
          return res.status(adminResponse.status).json({
            success: false,
            message: errorData.message || `Admin service returned error: ${adminResponse.status}`,
            error: errorData.error || adminResponse.statusText
          });
        } catch (parseError) {
          // If we can't parse the response, return a generic error
          return res.status(adminResponse.status).json({
            success: false,
            message: `Admin service returned error: ${adminResponse.status}`,
            error: adminResponse.statusText
          });
        }
      }
      
      // Try to parse the response as JSON
      const contentType = adminResponse.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await adminResponse.json();
        
        // Return the data from the admin service as-is
        return res.status(adminResponse.status).json(data);
      } else {
        // Handle non-JSON responses
        const text = await adminResponse.text();
        console.error(`${new Date().toISOString()}: [ADMIN-PROXY] Non-JSON response from admin service:`, text);
        return res.status(500).json({
        success: false,
          message: 'Admin service returned non-JSON response',
          error: 'Invalid response format'
        });
      }
    } catch (fetchError) {
      console.error(`${new Date().toISOString()}: [ADMIN-PROXY] Fetch error:`, fetchError.message);
      
      return res.status(503).json({
        success: false,
        message: 'Admin service unavailable',
        error: fetchError.message
      });
    }
  } catch (error) {
    console.error(`${new Date().toISOString()}: [ADMIN-PROXY] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error connecting to admin service',
      error: error.message
    });
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, '..', '..', 'frontend/build')));

// Serve temporary export files
app.use('/temp-exports', authenticateToken, isAdmin, async (req, res, next) => {
  try {
    const filename = req.path.replace(/^\//, ''); // Remove leading slash
    if (!filename) return next(); // No filename, move to next middleware
    
    console.log(`${new Date().toISOString()}: [GATEWAY] Forwarding temp-exports request to admin service: ${filename}`);
    
    // Forward to admin service
    const url = `http://localhost:${ADMIN_SERVICE_PORT}/temp-exports/${filename}`;
    const headers = { ...req.headers };
    delete headers.host;
    
    const response = await fetch(url, {
      method: 'GET',
      headers
    });
    
    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const errorData = await response.json();
        return res.status(response.status).json(errorData);
      } else {
        return res.status(response.status).send(await response.text());
      }
    }
    
    // Set headers from response
    for (const [key, value] of response.headers.entries()) {
      res.setHeader(key, value);
    }
    
    // Pipe the response through
    response.body.pipe(res);
    
  } catch (error) {
    console.error(`${new Date().toISOString()}: [GATEWAY] Error serving export file:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error serving file',
      error: error.message
    });
  }
});

// Catch-all for unmatched routes
app.use((req, res, next) => {
  if (req.url.startsWith('/api/')) {
    console.log(`${new Date().toISOString()}: [404] No route matched:`, req.method, req.url);
    return res.status(404).json({
      success: false,
      message: 'API endpoint not found',
      error: `No endpoint exists for ${req.method} ${req.url}`,
      availableEndpoints: [
        '/api/auth/*',
        '/api/users/*',
        '/api/predict/*',
        '/api/admin/*',
        '/api/ml/*',
        '/api/health'
      ]
    });
  }
  
  // Serve React app for any other routes in production
  if (process.env.NODE_ENV === 'production') {
    res.sendFile(path.resolve(__dirname, '..', '..', 'frontend', 'build', 'index.html'));
  } else {
    next();
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  
  // Check if this is a binary data error (like image data)
  if (err instanceof Buffer || 
      (err.body && err.body instanceof Buffer) || 
      (err.message && err.message instanceof Buffer) ||
      (err.stack && err.stack instanceof Buffer)) {
    console.error(`[ERROR] [${requestId}] Binary data error detected - Path: ${req.path}`);
    return res.status(statusCode).json({
      success: false,
      message: 'Error processing binary data',
      error: 'Binary data handling error',
      path: req.path,
      requestId
    });
  }
  
  // For non-binary errors, log the message
  const errorMsg = err.message && typeof err.message === 'string' 
    ? err.message 
    : 'Unknown error';
  
  console.error(`[ERROR] [${requestId}] Status: ${statusCode}, Path: ${req.path}, Message: ${errorMsg}`);
  
  // Never return 200 status for errors
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Server error' : errorMsg,
    error: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : errorMsg,
    path: req.path,
    requestId
  });
});

// Start server - ensure MongoDB is connected first
// We've already attempted connection earlier, so this just verifies it's connected before starting
const startServers = () => {
  // Log services being proxied
  logger.info('Gateway forwarding configuration:', {
    userService: `http://localhost:${USER_SERVICE_PORT}`,
    adminService: `http://localhost:${ADMIN_SERVICE_PORT}`,
    mlService: `http://localhost:${ML_SERVICE_PORT}`,
    predictionService: `http://localhost:${PREDICTION_SERVICE_PORT}`
  });

  // Create HTTP server
  const httpServer = http.createServer(app);
  httpServer.listen(PORT, () => {
    logger.info(`Gateway HTTP server running on port ${PORT}`, {
      port: PORT,
      instanceId: INSTANCE_ID,
      pid: process.pid,
      nodeEnv: process.env.NODE_ENV,
      memoryLimit: process.env.NODE_OPTIONS
    });
    logger.info('Gateway instance starting', { 
      instanceId: INSTANCE_ID, 
      port: PORT, 
      pid: process.pid 
    });
});
  
  // Check if HTTPS should be disabled
  if (process.env.DISABLE_HTTPS === 'true') {
    logger.info('HTTPS server disabled by configuration');
    return;
  }
  
  // Create HTTPS server with self-signed certificate
  try {
    // Try multiple possible certificate paths
    let sslOptions = null;
    const certPaths = [
      // Default Ubuntu self-signed cert paths
      {
        key: '/etc/ssl/private/ssl-cert-snakeoil.key',
        cert: '/etc/ssl/certs/ssl-cert-snakeoil.pem'
      },
      // Alternative paths
      {
        key: '/etc/nginx/ssl/private.key',
        cert: '/etc/nginx/ssl/certificate.crt'
      },
      // Local development paths
      {
        key: path.join(__dirname, '..', '..', 'ssl', 'localhost.key'),
        cert: path.join(__dirname, '..', '..', 'ssl', 'localhost.crt')
      }
    ];
    
    // Try each path until we find one that works
    for (const certPath of certPaths) {
      try {
        if (fs.existsSync(certPath.key) && fs.existsSync(certPath.cert)) {
          sslOptions = {
            key: fs.readFileSync(certPath.key),
            cert: fs.readFileSync(certPath.cert)
          };
          logger.info('Using SSL certificates', { certPath });
          break;
        }
      } catch (err) {
        logger.debug('Could not use certificates', { certPath });
      }
    }
    
    // If we found valid certificates, start HTTPS server
    if (sslOptions) {
      const httpsServer = https.createServer(sslOptions, app);
      httpsServer.listen(HTTPS_PORT, () => {
        logger.info(`Gateway HTTPS server running on port ${HTTPS_PORT}`, { port: HTTPS_PORT });
      });
    } else {
      throw new Error('No valid SSL certificates found in any of the checked paths');
    }
  } catch (error) {
    logger.error('HTTPS server setup failed', { error: error.message });
    logger.info('Running in HTTP-only mode');
  }
};

// Initialize servers based on MongoDB connection state
if (mongoose.connection.readyState === 1) {
  startServers();
  // Send PM2 ready signal
  if (process.send) {
    process.send('ready');
    logger.info('PM2 ready signal sent', { instanceId: INSTANCE_ID });
  }
} else {
  logger.info('Waiting for MongoDB connection before starting server...');
  mongoose.connection.once('connected', () => {
    startServers();
    // Send PM2 ready signal
    if (process.send) {
      process.send('ready');
      logger.info('PM2 ready signal sent', { instanceId: INSTANCE_ID });
    }
  });
}

// Graceful shutdown handler
const { closeLogger } = require('../logger/production-logger');

process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received, shutting down gracefully', {
    signal: 'SIGTERM',
    instanceId: INSTANCE_ID,
    pid: process.pid
  });
  
  // Close HTTP/HTTPS servers (if they exist)
  // Give active connections time to finish
  setTimeout(async () => {
    try {
      // Close MongoDB connection
      await mongoose.connection.close();
      logger.info('MongoDB connection closed');
      
      // Flush and close logger
      await closeLogger(logger);
      
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  }, 30000); // 30 second grace period
});

process.on('SIGINT', async () => {
  logger.info('SIGINT signal received, shutting down gracefully', {
    signal: 'SIGINT',
    instanceId: INSTANCE_ID,
    pid: process.pid
  });
  
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
    await closeLogger(logger);
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
});

module.exports = app; 