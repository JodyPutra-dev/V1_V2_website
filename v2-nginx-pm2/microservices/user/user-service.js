// User Service - Handle user-related operations
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const zlib = require('zlib');
const { promisify } = require('util');
const { mongoose, connectToMongoDB } = require('../db/mongo-service');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Import cache modules
const { userCache } = require('../cache/cache-service');
const { cacheMiddleware, cacheStatsMiddleware } = require('../cache/cache-middleware');

// Initialize Express app
const app = express();

// Environment variables
require('dotenv').config();
const PORT = process.env.USER_SERVICE_PORT || 3001;

// Create required directories
const baseDir = path.join(__dirname, '..', '..');
const uploadsDir = path.join(baseDir, 'uploads');
const compressedDir = path.join(uploadsDir, 'compressed');
const tempDir = path.join(uploadsDir, 'temp');

// Ensure directories exist with proper permissions
[uploadsDir, compressedDir, tempDir].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      console.log(`[USER] Created directory: ${dir}`);
    }
    // Verify directory is writable
    fs.accessSync(dir, fs.constants.W_OK);
    console.log(`[USER] Directory ${dir} exists and is writable`);
  } catch (error) {
    console.error(`[USER] Error with directory ${dir}:`, error.message);
    // Create the directory with full permissions as a fallback
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o777 });
      console.log(`[USER] Created directory with full permissions: ${dir}`);
    } catch (fallbackError) {
      console.error(`[USER] Critical error: Failed to create directory ${dir}:`, fallbackError.message);
      // Don't throw - let the service start but log the error
    }
  }
});

// Also ensure the gateway temp directory exists
const gatewayTempDir = path.join(baseDir, 'microservices', 'gateway', 'temp');
try {
  if (!fs.existsSync(gatewayTempDir)) {
    fs.mkdirSync(gatewayTempDir, { recursive: true, mode: 0o755 });
    console.log(`[USER] Created gateway temp directory: ${gatewayTempDir}`);
  }
  fs.accessSync(gatewayTempDir, fs.constants.W_OK);
  console.log(`[USER] Gateway temp directory exists and is writable`);
} catch (error) {
  console.error(`[USER] Error with gateway temp directory:`, error.message);
  try {
    fs.mkdirSync(gatewayTempDir, { recursive: true, mode: 0o777 });
    console.log(`[USER] Created gateway temp directory with full permissions: ${gatewayTempDir}`);
  } catch (fallbackError) {
    console.error(`[USER] Critical error: Failed to create gateway temp directory:`, fallbackError.message);
  }
}

// Instance ID for PM2 cluster mode
const INSTANCE_ID = process.env.INSTANCE_ID || process.env.NODE_APP_INSTANCE || '0';

// Promisify zlib functions
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Utility functions for image processing
const processAndCompressImage = async (inputPath, userId) => {
  try {
    console.log(`[IMAGE] Processing image from: ${inputPath}`);
    
    // Verify input file exists
    if (!fs.existsSync(inputPath)) {
      throw new Error('Input file not found');
    }

    // Convert to WebP and resize if needed
    const webpBuffer = await sharp(inputPath)
      .resize(800, 800, { 
        fit: 'inside', 
        withoutEnlargement: true,
        background: { r: 255, g: 255, b: 255, alpha: 1 } 
      })
      .webp({ 
        quality: 80,
        effort: 4,
        lossless: false
      })
      .toBuffer();

    console.log(`[IMAGE] Converted to WebP, size: ${webpBuffer.length} bytes`);

    // Generate filenames
    const filename = `user_${userId}_${Date.now()}`;
    const webpPath = path.join(uploadsDir, `${filename}.webp`);

    // Ensure directory exists
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o755 });
    }

    // Save WebP file
    await fs.promises.writeFile(webpPath, webpBuffer);
    console.log(`[IMAGE] Saved WebP file to: ${webpPath}`);

    // Clean up input file after successful processing
    try {
      if (fs.existsSync(inputPath)) {
        fs.unlinkSync(inputPath);
        console.log(`[IMAGE] Cleaned up input file: ${inputPath}`);
      }
    } catch (cleanupError) {
      console.error('[IMAGE] Error cleaning up input file:', cleanupError);
      // Don't throw - continue with the operation
    }

    // Return the relative path for database storage
    const relativePath = path.relative(baseDir, webpPath).replace(/\\/g, '/');
    console.log(`[IMAGE] Returning relative path: ${relativePath}`);
    return relativePath;
  } catch (error) {
    // Clean up input file on error
    try {
      if (fs.existsSync(inputPath)) {
        fs.unlinkSync(inputPath);
        console.log(`[IMAGE] Cleaned up input file after error: ${inputPath}`);
      }
    } catch (cleanupError) {
      console.error('[IMAGE] Error cleaning up input file after error:', cleanupError);
    }
    console.error('[IMAGE] Error processing image:', error);
    throw error;
  }
};

const serveImage = async (imagePath, res) => {
  try {
    console.log(`[IMAGE] Attempting to serve image from: ${imagePath}`);
    
    // Verify source file exists
    if (!fs.existsSync(imagePath)) {
      console.error(`[IMAGE] File not found: ${imagePath}`);
      return res.status(404).json({
        success: false,
        message: 'Profile image file not found'
      });
    }

    // Read the WebP file
    const webpBuffer = await fs.promises.readFile(imagePath);
    console.log(`[IMAGE] Read WebP file, size: ${webpBuffer.length} bytes`);
    
    // Verify it's a valid WebP image
    try {
      const metadata = await sharp(webpBuffer).metadata();
      if (metadata.format !== 'webp') {
        throw new Error('Invalid image format');
      }
      console.log(`[IMAGE] Verified WebP format: ${metadata.width}x${metadata.height}`);
    } catch (validationError) {
      console.error(`[IMAGE] Image validation failed:`, validationError);
      return res.status(500).json({
        success: false,
        message: 'Invalid image data',
        error: validationError.message
      });
    }
    
    // Set headers for WebP image
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Length', webpBuffer.length);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Last-Modified', new Date().toUTCString());
    
    // Send the WebP buffer directly
    res.send(webpBuffer);
    console.log(`[IMAGE] Image sent successfully`);
  } catch (error) {
    console.error(`[IMAGE] Error serving image:`, error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Error serving image',
        error: error.message
      });
    }
  }
};

// Configure multer for profile image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const userId = req.user ? req.user.id : 'unknown';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const filename = `temp_${userId}_${timestamp}${ext}`;
    cb(null, filename);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

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

// Add timestamps to console logs
const originalConsoleLog = console.log;
console.log = function() {
  const args = Array.from(arguments);
  const timestamp = new Date().toISOString();
  originalConsoleLog.apply(console, [`${timestamp}:`].concat(args));
};

// Trust proxy headers - important for NGINX proxying
app.set('trust proxy', true);

// CORS configuration - enhanced to be more permissive for development
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'user-id'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  credentials: true,
  maxAge: 86400
}));

// Add CORS headers to all responses
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, user-id');
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Security middleware - relaxed for development
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
app.use(morgan('combined'));

// Request timestamp middleware
app.use((req, res, next) => {
  // Add X-Instance-ID header for debugging
  res.setHeader('X-Instance-ID', INSTANCE_ID);
  
  console.log(`[USER-SERVICE] ${req.method} ${req.url} [Instance: ${INSTANCE_ID}] from ${req.ip}`);
  console.log(`[USER-SERVICE] Headers:`, JSON.stringify(req.headers));
  next();
});

// Connect to MongoDB using the mongo-service with retry logic
console.log('Connecting to MongoDB...');
let retryCount = 0;
const MAX_RETRIES = 5;

const connectWithRetry = () => {
  connectToMongoDB()
    .then(() => {
      console.log(`[USER-SERVICE] Connected to MongoDB`);
      retryCount = 0; // Reset retry count on successful connection
    })
    .catch(err => {
      console.error(`[USER-SERVICE] MongoDB connection error:`, err.message);
      retryCount++;
      if (retryCount <= MAX_RETRIES) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        console.log(`[USER-SERVICE] Retrying MongoDB connection in ${delay}ms (attempt ${retryCount}/${MAX_RETRIES})...`);
        setTimeout(connectWithRetry, delay);
      } else {
        console.error(`[USER-SERVICE] Failed to connect to MongoDB after ${MAX_RETRIES} attempts`);
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
    // Ensure strings for comparison
    if (typeof enteredPassword !== 'string') {
      console.error(`[USER-SERVICE] comparePassword: Entered password is not a string`);
      return false;
    }
    
    if (typeof this.password !== 'string') {
      console.error(`[USER-SERVICE] comparePassword: Stored password is not a string`);
      return false;
    }
    
    return await bcrypt.compare(enteredPassword, this.password);
  } catch (error) {
    console.error(`[USER-SERVICE] Password comparison error:`, error);
    throw new Error(`Password comparison error: ${error.message}`);
  }
};

// Register User model
const User = mongoose.model('User', userSchema);

// Authentication middleware - enhanced to handle both token and user-id header
const authenticateToken = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    // Get user ID from headers as backup authentication method
    const userIdHeader = req.headers['user-id'];
    
    console.log(`[USER-SERVICE Auth] Token received: ${token ? 'Yes' : 'No'}`);
    console.log(`[USER-SERVICE Auth] User-ID header: ${userIdHeader || 'None'}`);
    
    // If token is available, use it
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_jwt_secret');
        
        // Find user
        const user = await User.findById(decoded.userId || decoded.id);
        if (!user) {
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
        
        return next();
      } catch (tokenError) {
        console.error(`[USER-SERVICE Auth] Token verification failed:`, tokenError.message);
        
        // Try using user-id header as fallback if token verification fails
        if (!userIdHeader) {
          return res.status(403).json({
            success: false,
            message: 'Invalid token',
            error: tokenError.message
          });
        }
      }
    }
    
    // If we got here with a user-id header, use it as fallback authentication method
    if (userIdHeader && mongoose.Types.ObjectId.isValid(userIdHeader)) {
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
      
      console.log(`[USER-SERVICE Auth] User authenticated from header: ${user.email}`);
      return next();
    }
    
    // If we reach here, no valid authentication was provided
    return res.status(401).json({ 
      success: false, 
      message: 'Authentication required' 
    });
  } catch (error) {
    console.error(`[USER-SERVICE Auth] Error:`, error.message);
    return res.status(403).json({ 
      success: false, 
      message: 'Authentication failed', 
      error: error.message 
    });
  }
};

// Admin middleware
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
// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    success: true, 
    service: 'User Service',
    instanceId: INSTANCE_ID,
    pid: process.pid,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    headers: {
      'x-forwarded-for': req.headers['x-forwarded-for'] || 'none',
      'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'none'
    }
  });
});

app.get('/api/users/health', (req, res) => {
  res.json({ 
    success: true, 
    service: 'User Service API',
    instanceId: INSTANCE_ID,
    pid: process.pid,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    headers: {
      'x-forwarded-for': req.headers['x-forwarded-for'] || 'none',
      'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'none'
    }
  });
});

// ===== AUTH ROUTES =====
// Register new user route (moved from gateway.js)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email and password'
      });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }
    
    // Create new user
    const user = new User({
      name,
      email,
      password,
      role: 'user'
    });
    
    await user.save();
    
    // Generate token
    const token = jwt.sign(
      { id: user._id, userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'default_jwt_secret',
      { expiresIn: '30d' }
    );
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error(`[Register] Error:`, error.message);
    res.status(500).json({
      success: false,
      message: 'Error registering user',
      error: error.message
    });
  }
});

// Authentication health check endpoint (moved from gateway.js)
app.get('/api/auth/healthcheck', (req, res) => {
  const mongoStatus = mongoose.connection.readyState;
  const mongoStatusText = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  }[mongoStatus] || 'unknown';

  res.status(200).json({
    success: true,
    message: 'Authentication service is running',
    timestamp: new Date().toISOString(),
    protocol: req.protocol,
    secure: req.secure,
    server: {
      port: PORT,
      nodeVersion: process.version,
      uptime: process.uptime()
    },
    database: {
      status: mongoStatusText,
      readyState: mongoStatus
    },
    headers: {
      host: req.headers.host,
      'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'none',
      'x-forwarded-for': req.headers['x-forwarded-for'] || 'none',
      'user-agent': req.headers['user-agent']
    }
  });
});

// Login route (moved from gateway.js)
app.post('/api/auth/login', async (req, res) => {
  try {
    console.log(`[Login] Request received from ${req.ip}, protocol: ${req.protocol}`);
    console.log(`[Login] Headers:`, req.headers);
    
    // Check MongoDB connection first
    if (mongoose.connection.readyState !== 1) {
      console.error(`[Login] Error: MongoDB not connected (state: ${mongoose.connection.readyState})`);
      return res.status(503).json({
        success: false,
        message: 'Database unavailable',
        error: 'MongoDB connection error'
      });
    }
    
    const { email, password } = req.body;
    console.log(`[Login] Attempting login for email: ${email}`);
    
    // Validate input
    if (!email || !password) {
      console.error(`[Login] Error: Missing email or password`);
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      console.error(`[Login] Error: User not found for email: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        details: 'User not found'
      });
    }
    
    // Check password
    try {
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        console.error(`[Login] Error: Password mismatch for email: ${email}`);
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials',
          details: 'Password incorrect'
        });
      }
    } catch (passwordError) {
      console.error(`[Login] Error checking password:`, passwordError);
      return res.status(500).json({
        success: false,
        message: 'Error verifying password',
        error: passwordError.message
      });
    }
    
    console.log(`[Login] Password verified for: ${email}`);
    
    // Update last login time
    user.lastLogin = new Date();
    await user.save();
    
    // Generate token
    const token = jwt.sign(
      { id: user._id, userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'default_jwt_secret',
      { expiresIn: '30d' }
    );
    
    console.log(`[Login] Login successful for: ${email}`);
    
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error(`[Login] Error:`, error);
    console.error(`[Login] Stack trace:`, error.stack);
    return res.status(500).json({
      success: false,
      message: 'Error logging in',
      error: error.message,
      stack: process.env.NODE_ENV === 'production' ? null : error.stack
    });
  }
});

// Direct HTTP login endpoint for debugging (moved from gateway.js)
app.post('/api/direct-login', async (req, res) => {
  try {
    console.log(`[Direct-Login] Request received from ${req.ip}`);
    console.log(`[Direct-Login] Body:`, req.body);
    
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      console.error(`[Direct-Login] Missing email or password`);
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }
    
    // Always try to create admin user if it doesn't exist
    let user = await User.findOne({ email });
    
    // If user doesn't exist and it's the admin email, create it
    if (!user && email === 'admin@example.com') {
      console.log(`[Direct-Login] Creating default admin user`);
      try {
        user = new User({
          name: 'Admin User',
          email: 'admin@example.com',
          password: 'admin123',
          role: 'admin'
        });
        
        await user.save();
        console.log(`[Direct-Login] Default admin user created`);
      } catch (createError) {
        console.error(`[Direct-Login] Error creating admin:`, createError);
        return res.status(500).json({
          success: false,
          message: 'Error creating admin user',
          error: createError.message
        });
      }
    } else if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        details: 'User not found'
      });
    }
    
    // Check password - simplified for direct login
    try {
      // For admin@example.com, also accept admin123 regardless of what's in DB
      let isMatch = false;
      if (email === 'admin@example.com' && password === 'admin123') {
        isMatch = true;
      } else {
        isMatch = await user.comparePassword(password);
      }
      
      if (!isMatch) {
        console.error(`[Direct-Login] Password mismatch for email: ${email}`);
        return res.status(401).json({
          success: false, 
          message: 'Invalid credentials',
          details: 'Password incorrect'
        });
      }
    } catch (passwordError) {
      console.error(`[Direct-Login] Error checking password:`, passwordError);
      return res.status(500).json({
        success: false,
        message: 'Error verifying password',
        error: passwordError.message
      });
    }
    
    // Update last login time
    user.lastLogin = new Date();
    await user.save();
    
    // Generate token
    const token = jwt.sign(
      { id: user._id, userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'default_jwt_secret',
      { expiresIn: '30d' }
    );
    
    console.log(`[Direct-Login] Login successful for: ${email}`);
    
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error(`[Direct-Login] Error:`, error);
    console.error(`[Direct-Login] Stack trace:`, error.stack);
    return res.status(500).json({
      success: false,
      message: 'Error processing login',
      error: error.message
    });
  }
});

// User lookup endpoint for debugging authentication issues (moved from gateway.js)
app.get('/api/debug/users', async (req, res) => {
  try {
    // Only for development use - don't expose this in production
    if (process.env.NODE_ENV === 'production' && !req.query.secret) {
      return res.status(403).json({
        success: false,
        message: 'This endpoint is only available in development mode'
      });
    }
    
    // Check if we should create a default admin user if none exists
    const createAdmin = req.query.createAdmin === 'true';
    
    // Get just the count of users first
    const userCount = await User.countDocuments();
    
    // Check if we should create an admin when none exists
    if (createAdmin && userCount === 0) {
      // Create a default admin user if no users exist
      const adminPassword = 'admin123'; // This is the default password
      
      try {
        const admin = new User({
          name: 'Admin User',
          email: 'admin@example.com',
          password: adminPassword,
          role: 'admin'
        });
        
        await admin.save();
        
        return res.status(201).json({
          success: true,
          message: 'Default admin user created successfully',
          userCount: 1,
          defaultCredentials: {
            email: 'admin@example.com',
            password: adminPassword
          }
        });
      } catch (adminError) {
        return res.status(500).json({
          success: false,
          message: 'Failed to create default admin user',
          error: adminError.message
        });
      }
    }
    
    // Just return the count and basic info - don't expose passwords
    return res.status(200).json({
      success: true,
      message: 'User count retrieved successfully',
      userCount,
      hint: userCount === 0 ? 'No users found. Add createAdmin=true to query params to create a default admin user.' : undefined
    });
  } catch (error) {
    console.error(`[DEBUG] Error:`, error);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving users',
      error: error.message
    });
  }
});

// Register new user
app.post('/api/users/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email and password'
      });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }
    
    // Create new user
    const user = new User({
      name,
      email,
      password,
      role: 'user'
    });
    
    await user.save();
    
    // Generate token
    const token = jwt.sign(
      { id: user._id, userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'default_jwt_secret',
      { expiresIn: '30d' }
    );
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error(`[Register] Error:`, error.message);
    res.status(500).json({
      success: false,
      message: 'Error registering user',
      error: error.message
    });
  }
});

// Login user
app.post('/api/users/login', async (req, res) => {
  try {
    // Check MongoDB connection first
    if (mongoose.connection.readyState !== 1) {
      console.error(`[Login] Error: MongoDB not connected (state: ${mongoose.connection.readyState})`);
      return res.status(503).json({
        success: false,
        message: 'Database unavailable',
        error: 'MongoDB connection error'
      });
    }
    
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Update last login time
    user.lastLogin = new Date();
    await user.save();
    
    // Generate token
    const token = jwt.sign(
      { id: user._id, userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'default_jwt_secret',
      { expiresIn: '30d' }
    );
    
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error(`[Login] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error logging in',
      error: error.message
    });
  }
});

// Get current user
app.get('/api/users/me', cacheMiddleware(userCache, { ttl: 5 * 60 * 1000 }), authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error(`[Get User] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error getting user',
      error: error.message
    });
  }
});

// Update user
app.put('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const { name, email } = req.body;
    
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Update fields if provided
    if (name) user.name = name;
    if (email && email !== user.email) {
      // Check if email is already taken
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use'
        });
      }
      user.email = email;
    }
    
    await user.save();
    
    // Invalidate user cache after successful update
    const userId = req.user.id;
    userCache.delete(`/api/users/me:${userId}:`);
    userCache.delete(`/api/auth/me:${userId}:`);
    console.log(`[USER-CACHE] Invalidated cache for user ${userId} after profile update`);
    
    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error(`[Update User] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error updating user',
      error: error.message
    });
  }
});

// Change password
app.put('/api/users/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current password and new password'
      });
    }
    
    // Find user with password
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }
    
    // Update password
    user.password = newPassword;
    await user.save();
    
    return res.status(200).json({
      success: true,
      message: 'Password updated successfully'
    });
  } catch (error) {
    console.error(`[Password Change] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error changing password',
      error: error.message
    });
  }
});

// Admin: Get all users
app.get('/api/users/admin/all', authenticateToken, isAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort('-createdAt');
    
    return res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    console.error(`[Admin - Get Users] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error getting users',
      error: error.message
    });
  }
});

// Admin: Update user role
app.put('/api/users/admin/:id/role', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!role || !['user', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid role (user or admin)'
      });
    }
    
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    user.role = role;
    await user.save();
    
    return res.status(200).json({
      success: true,
      message: 'User role updated successfully',
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error(`[Admin - Update Role] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error updating user role',
      error: error.message
    });
  }
});

// Get user profile endpoint
app.get('/api/auth/me', cacheMiddleware(userCache, { ttl: 5 * 60 * 1000 }), authenticateToken, async (req, res) => {
  try {
    // Get user ID from authenticated request
    const userId = req.user.id;
    
    // Find user in database (excluding password)
    const user = await User.findById(userId)
      .select('-password')
      .lean(); // Use lean() for better performance
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Return user data
    return res.status(200).json({
      success: true,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        deviceToken: user.deviceToken,
        profileImage: user.profileImage,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching user profile',
      error: error.message
    });
  }
});

// Update user profile endpoint
app.put('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update allowed fields
    if (name) user.name = name;

    await user.save();

    // Invalidate user cache after successful update
    const userId = req.user.id;
    userCache.delete(`/api/users/me:${userId}:`);
    userCache.delete(`/api/auth/me:${userId}:`);
    console.log(`[USER-CACHE] Invalidated cache for user ${userId} after auth profile update`);

    // Return updated user without password
    const updatedUser = await User.findById(user._id).select('-password');

    return res.status(200).json({
      success: true,
      data: updatedUser
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating user profile',
      error: error.message
    });
  }
});

// Update user profile with image endpoint
app.put('/api/auth/me/image', authenticateToken, upload.single('profileImage'), async (req, res) => {
  let tempFilePath = null;
  let newCompressedPath = null;
  
  try {
    console.log('[USER] Profile update request received:', {
      body: req.body,
      file: req.file ? {
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
        path: req.file.path
      } : 'No file'
    });

    const { name } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      // Clean up uploaded file if user not found
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update name if provided
    if (name) {
      user.name = name;
    }

    // Update profile image if file was uploaded
    if (req.file) {
      try {
        tempFilePath = req.file.path;
        
        // Process and compress the new image first
        newCompressedPath = await processAndCompressImage(tempFilePath, user.id);
        console.log('[USER] New compressed image created at:', newCompressedPath);
        
        // Only delete the old image after successful compression
        if (user.profileImage) {
          const oldImagePath = path.join(baseDir, user.profileImage);
          if (fs.existsSync(oldImagePath)) {
            fs.unlinkSync(oldImagePath);
            console.log('[USER] Deleted old profile image:', oldImagePath);
          }
        }
        
        // Update the user profile with new image path
        user.profileImage = newCompressedPath;
        console.log('[USER] Updated user profile with new image path');
        
        // Clean up the temporary upload file
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
          tempFilePath = null;
        }
      } catch (fileError) {
        console.error('[USER] Error handling profile image:', fileError);
        
        // Clean up any temporary files
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
        if (newCompressedPath && fs.existsSync(newCompressedPath)) {
          fs.unlinkSync(newCompressedPath);
        }
        
        return res.status(500).json({
          success: false,
          message: 'Error processing profile image',
          error: fileError.message
        });
      }
    }

    await user.save();
    console.log('[USER] User profile updated successfully');

    // Invalidate user cache after successful image update
    const userId = req.user.id;
    userCache.delete(`/api/users/me:${userId}:`);
    userCache.delete(`/api/auth/me:${userId}:`);
    console.log(`[USER-CACHE] Invalidated cache for user ${userId} after image update`);

    // Return updated user without password
    const updatedUser = await User.findById(user._id).select('-password');

    // Check if token is about to expire (within 24 hours)
    const token = req.headers.authorization?.split(' ')[1];
    let shouldRefreshToken = false;
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_jwt_secret');
        const timeUntilExpiry = decoded.exp * 1000 - Date.now();
        shouldRefreshToken = timeUntilExpiry < 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        
        console.log('[USER] Token expiry check:', {
          timeUntilExpiry: Math.round(timeUntilExpiry / (60 * 60 * 1000)) + ' hours',
          shouldRefresh: shouldRefreshToken
        });
      } catch (tokenError) {
        // If token verification fails, we should issue a new one
        shouldRefreshToken = true;
        console.log('[USER] Token verification failed, will refresh:', tokenError.message);
      }
    }

    // Only generate a new token if necessary
    const response = {
      success: true,
      message: 'Profile updated successfully',
      data: updatedUser
    };

    if (shouldRefreshToken) {
      response.token = jwt.sign(
        { id: user._id, userId: user._id, email: user.email, role: user.role },
        process.env.JWT_SECRET || 'default_jwt_secret',
        { expiresIn: '30d' }
      );
      console.log('[USER] Generated new token due to approaching expiry');
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('[USER] Error updating profile with image:', error);
    
    // Clean up any temporary files
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    if (newCompressedPath && fs.existsSync(newCompressedPath)) {
      fs.unlinkSync(newCompressedPath);
    }
    
    return res.status(500).json({
      success: false,
      message: 'Error updating profile',
      error: error.message
    });
  }
});

// Serve profile image endpoint
app.get('/api/auth/profile-image/:userId', authenticateToken, async (req, res) => {
  try {
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    console.log(`[IMAGE] [${requestId}] Profile image request for user: ${req.params.userId}`);
    
    // Validate user ID
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      console.log(`[IMAGE] [${requestId}] Invalid user ID format`);
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }
    
    // Find user
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      console.log(`[IMAGE] [${requestId}] User not found: ${req.params.userId}`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    if (!user.profileImage) {
      console.log(`[IMAGE] [${requestId}] No profile image set for user: ${req.params.userId}`);
      return res.status(404).json({
        success: false,
        message: 'No profile image set'
      });
    }

    console.log(`[IMAGE] [${requestId}] Found profile image path: ${user.profileImage}`);
    
    // Construct absolute path
    const imagePath = path.join(baseDir, user.profileImage);
    console.log(`[IMAGE] [${requestId}] Full image path: ${imagePath}`);
    
    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      console.error(`[IMAGE] [${requestId}] Image file not found at: ${imagePath}`);
      
      // Clear the profile image field since file is missing
      user.profileImage = '';
      await user.save();
      
      return res.status(404).json({
        success: false,
        message: 'Profile image file not found',
        details: 'Image record cleared due to missing file'
      });
    }

    // Serve the image
    await serveImage(imagePath, res);
    console.log(`[IMAGE] [${requestId}] Image serving completed`);
  } catch (error) {
    console.error(`[IMAGE] Error serving profile image:`, error);
    // Only send error response if headers haven't been sent
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Error serving profile image',
        error: error.message
      });
    }
  }
});

// Error handler
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
  if (req.url.startsWith('/api/')) {
    console.log(`[404] No route matched:`, req.method, req.url);
    return res.status(404).json({
      success: false,
      message: 'API endpoint not found',
      error: `No endpoint exists for ${req.method} ${req.url}`
    });
  }
  
  return res.status(404).json({
    success: false,
    message: 'Not found',
    error: 'Resource not found'
  });
});

// Cache statistics endpoint (admin only)
app.get('/api/users/cache/stats', authenticateToken, isAdmin, cacheStatsMiddleware({ userCache }));

// Start server - ensure MongoDB is connected first
// We've already attempted connection earlier, so this just verifies it's connected before starting
if (mongoose.connection.readyState === 1) {
  const server = app.listen(PORT, () => {
    console.log(`[USER-SERVICE] Instance starting`, { 
      instanceId: INSTANCE_ID, 
      port: PORT, 
      pid: process.pid 
    });
    console.log(`User service running on port ${PORT}`);
    
    // Send PM2 ready signal
    if (process.send) {
      process.send('ready');
      console.log('[USER-SERVICE] PM2 ready signal sent', { instanceId: INSTANCE_ID });
    }
  });
} else {
  console.log('Waiting for MongoDB connection before starting server...');
  mongoose.connection.once('connected', () => {
    const server = app.listen(PORT, () => {
      console.log(`[USER-SERVICE] Instance starting`, { 
        instanceId: INSTANCE_ID, 
        port: PORT, 
        pid: process.pid 
      });
      console.log(`User service running on port ${PORT}`);
      
      // Send PM2 ready signal
      if (process.send) {
        process.send('ready');
        console.log('[USER-SERVICE] PM2 ready signal sent', { instanceId: INSTANCE_ID });
      }
    });
  });
}

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  console.log('[USER-SERVICE] SIGTERM signal received, shutting down gracefully', {
    signal: 'SIGTERM',
    instanceId: INSTANCE_ID,
    pid: process.pid
  });
  
  setTimeout(async () => {
    try {
      // Close MongoDB connection
      await mongoose.connection.close();
      console.log('[USER-SERVICE] MongoDB connection closed');
      
      process.exit(0);
    } catch (error) {
      console.error('[USER-SERVICE] Error during shutdown:', error.message);
      process.exit(1);
    }
  }, 30000); // 30 second grace period
});

process.on('SIGINT', async () => {
  console.log('[USER-SERVICE] SIGINT signal received, shutting down gracefully', {
    signal: 'SIGINT',
    instanceId: INSTANCE_ID,
    pid: process.pid
  });
  
  try {
    await mongoose.connection.close();
    console.log('[USER-SERVICE] MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    console.error('[USER-SERVICE] Error during shutdown:', error.message);
    process.exit(1);
  }
});

module.exports = app; 