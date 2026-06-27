/**
 * ADMIN SERVICE - Dedicated microservice for admin operations
 * 
 * This service handles all admin-related operations that were previously in gateway.js
 * It runs on its own port (3003 by default) and is called by the gateway via a proxy middleware
 * 
 * All admin routes should be defined here, not in gateway.js
 */

// Admin Service - Handle admin-related operations
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const { mongoose, connectToMongoDB } = require('../db/mongo-service');
const nodemailer = require('nodemailer');

// Import cache modules
const { adminCache } = require('../cache/cache-service');
const { cacheMiddleware, cacheStatsMiddleware } = require('../cache/cache-middleware');

// Initialize Express app
const app = express();

// Environment variables
require('dotenv').config();
const PORT = process.env.ADMIN_SERVICE_PORT || 3003;

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
    console.error(`${new Date().toISOString()}: [ADMIN] SMTP configuration error:`, error);
  } else {
    console.log(`${new Date().toISOString()}: [ADMIN] SMTP server is ready to send messages`);
  }
});

// ===== MIDDLEWARE =====
// Security
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));

// CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'user-id'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  credentials: true,
  maxAge: 86400
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('combined'));

// Request timestamp middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()}: [ADMIN] ${req.method} ${req.url}`);
  next();
});

// ===== DATABASE MODELS =====
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
  predictedClass: {
    type: String,
    enum: ['Normal', 'Abnormal'],
    required: true
  },
  confidence: {
    type: Number,
    min: 0,
    max: 1,
    default: 0
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

// Add indexes for optimized queries
predictionSchema.index({ user: 1, date: -1 });
predictionSchema.index({ date: -1 });
predictionSchema.index({ penyakit: 1, date: -1 });

// Indexes for categorical parameters
predictionSchema.index({ 'parameters.turbidityLevel': 1 });
predictionSchema.index({ 'parameters.warnaDasar': 1 });

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

// Admin authorization middleware
const isAdmin = (req, res, next) => {
  console.log(`${new Date().toISOString()}: [Admin] Checking admin access for user:`, req.user);
  
  if (!req.user) {
    console.log(`${new Date().toISOString()}: [Admin] No user found in request`);
    return res.status(400).json({
      success: false,
      message: 'User information missing from request'
    });
  }
  
  if (req.user.role === 'admin') {
    console.log(`${new Date().toISOString()}: [Admin] Admin access granted for:`, req.user.email);
    return next();
  }
  
  console.log(`${new Date().toISOString()}: [Admin] Admin access denied for:`, req.user.email);
  return res.status(403).json({ 
    success: false, 
    message: 'Admin access required' 
  });
};

// ===== ADMIN ROUTES =====
// Get all users
app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const users = await User.find({})
      .select('-password')
      .sort({ createdAt: -1 });
    
    return res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    console.error(`${new Date().toISOString()}: [ADMIN] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching users',
      error: error.message
    });
  }
});

// Get a specific user by ID
app.get('/api/admin/users/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }
    
    const user = await User.findById(userId).select('-password');
    
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
    console.error(`${new Date().toISOString()}: [ADMIN] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error.message
    });
  }
});

// Get all predictions (admin only)
app.get('/api/admin/predictions', authenticateToken, isAdmin, async (req, res) => {
  try {
    const predictions = await Prediction.find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('user', 'name email');
    
    return res.status(200).json({
      success: true,
      count: predictions.length,
      data: predictions
    });
  } catch (error) {
    console.error(`${new Date().toISOString()}: [ADMIN] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching predictions',
      error: error.message
    });
  }
});

// Get admin statistics
app.get('/api/admin/stats', authenticateToken, isAdmin, cacheMiddleware(adminCache, { ttl: 2 * 60 * 1000, includeUserId: false }), async (req, res) => {
  try {
    // Count total users
    const totalUsers = await User.countDocuments({});
    
    // Count admin users
    const adminCount = await User.countDocuments({ role: 'admin' });
    
    // Get recent users (registered in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentUsers = await User.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });
    
    // Count active users (logged in last 24 hours)
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const activeUsers = await User.countDocuments({
      lastLogin: { $gte: oneDayAgo }
    });
    
    // Get list of users with creation dates (for chart)
    const userRegistrations = await User.find({}, 'createdAt name role')
      .sort({ createdAt: 1 })
      .limit(100); // Limit to last 100 registrations
    
    // Count predictions by type
    const totalPredictions = await Prediction.countDocuments({});
    const normalPredictions = await Prediction.countDocuments({ predictedClass: 'Normal' });
    const abnormalPredictions = await Prediction.countDocuments({ predictedClass: 'Abnormal' });
    
    // Get recent predictions
    const recentPredictions = await Prediction.find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('user', 'name email');
    
    // Calculate percentages
    const percentNormal = totalPredictions > 0 ? Math.round((normalPredictions / totalPredictions) * 100) : 0;
    const percentAbnormal = totalPredictions > 0 ? Math.round((abnormalPredictions / totalPredictions) * 100) : 0;
    
    return res.status(200).json({
      success: true,
      data: {
        users: {
          totalCount: totalUsers,
          adminCount: adminCount,
          recentUsers: recentUsers,
          activeUsers: activeUsers,
          registrations: userRegistrations
        },
        predictions: {
          totalCount: totalPredictions,
          normalCount: normalPredictions,
          abnormalCount: abnormalPredictions,
          percentNormal,
          percentAbnormal,
          recentPredictions
        }
      }
    });
  } catch (error) {
    console.error(`${new Date().toISOString()}: [ADMIN] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching admin statistics',
      error: error.message
    });
  }
});

// Update user role (admin only)
app.put('/api/admin/users/:id/role', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { role } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }
    
    if (!role || !['user', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role specified. Must be "user" or "admin"'
      });
    }
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    user.role = role;
    await user.save();
    
    // Invalidate admin stats cache after user role change
    adminCache.delete('/api/admin/stats::');
    console.log('[ADMIN-CACHE] Invalidated stats cache after user role update');
    
    return res.status(200).json({
      success: true,
      message: `User role updated to ${role}`,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error(`${new Date().toISOString()}: [ADMIN] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error updating user role',
      error: error.message
    });
  }
});

// Delete user (admin only)
app.delete('/api/admin/users/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    
    console.log(`${new Date().toISOString()}: [ADMIN] Delete user request received for ID: ${userId}`);
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.log(`${new Date().toISOString()}: [ADMIN] Invalid user ID format: ${userId}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }
    
    // Prevent deleting yourself
    if (userId === req.user.id.toString()) {
      console.log(`${new Date().toISOString()}: [ADMIN] Cannot delete own account: ${userId}`);
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }
    
    // First check if the user exists
    const user = await User.findById(userId);
    
    if (!user) {
      console.log(`${new Date().toISOString()}: [ADMIN] User not found for ID: ${userId}`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Get user's predictions for backup
    const userPredictions = await Prediction.find({ user: userId }).sort({ createdAt: -1 });
    console.log(`${new Date().toISOString()}: [ADMIN] Found ${userPredictions.length} predictions for backup`);
    
    // Create CSV backup of user data
    const csvContent = createUserCsv(user, userPredictions);
    const csvFileInfo = await saveUserCsvToDisk(userId, csvContent);
    console.log(`${new Date().toISOString()}: [ADMIN] Created CSV backup at ${csvFileInfo.filePath}`);
    
    // Create HTML email for account deletion notification
    const htmlEmail = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #333; text-align: center; border-bottom: 1px solid #eee; padding-bottom: 10px;">Account Deletion Notification</h2>
      <p>Hello ${user.name},</p>
      <p>This is to inform you that your account in the Kidney Stone Detection System has been deleted by an administrator.</p>
      <div style="background-color: #f8f8f8; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Account Details:</strong></p>
        <p style="margin: 5px 0;"><strong>Name:</strong> ${user.name}</p>
        <p style="margin: 5px 0;"><strong>Email:</strong> ${user.email}</p>
        <p style="margin: 5px 0;"><strong>Account created on:</strong> ${user.createdAt ? new Date(user.createdAt).toDateString() : 'Unknown'}</p>
      </div>
      <p>If you believe this was done in error, please contact the system administrator.</p>
      <p>A backup of your data has been created and will be available for 7 days.</p>
      <p style="margin-top: 30px; font-size: 12px; color: #777; text-align: center;">
        This is an automated message. Please do not reply to this email.
      </p>
    </div>
    `;
    
    // Configure email options
    const mailOptions = {
      from: '"Kidney Stone Detection System" <udetectupnvj@gmail.com>',
      to: user.email,
      subject: 'Account Deletion Notification',
      text: `Hello ${user.name}, your account in the Kidney Stone Detection System has been deleted by an administrator. If you believe this was done in error, please contact the system administrator.`,
      html: htmlEmail
    };
    
    console.log(`${new Date().toISOString()}: [ADMIN] Sending deletion notification email to: ${user.email}`);
    
    // Delete user's predictions
    console.log(`${new Date().toISOString()}: [ADMIN] Deleting user's predictions for user ID: ${userId}`);
    const predictionsResult = await Prediction.deleteMany({ user: userId });
    console.log(`${new Date().toISOString()}: [ADMIN] Deleted ${predictionsResult.deletedCount} predictions for user ID: ${userId}`);
    
    // Delete user
    console.log(`${new Date().toISOString()}: [ADMIN] Deleting user with ID: ${userId}`);
    const deleteResult = await User.findByIdAndDelete(userId);
    
    if (!deleteResult) {
      console.log(`${new Date().toISOString()}: [ADMIN] User deletion failed for ID: ${userId}`);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete user from database'
      });
    }
    
    console.log(`${new Date().toISOString()}: [ADMIN] User deleted successfully: ${userId}`);
    
    // Invalidate admin stats cache after user deletion
    adminCache.delete('/api/admin/stats::');
    console.log('[ADMIN-CACHE] Invalidated stats cache after user deletion');
    
    // Send the notification email after deletion
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error(`${new Date().toISOString()}: [EMAIL] Error sending deletion notification:`, error);
      } else {
        console.log(`${new Date().toISOString()}: [EMAIL] Deletion notification sent: ${info.response}`);
      }
    });
    
    return res.status(200).json({
      success: true,
      message: 'User and associated data deleted successfully',
      backup: {
        filename: csvFileInfo.filename,
        downloadUrl: csvFileInfo.downloadUrl,
        expiresIn: '7 days'
      }
    });
  } catch (error) {
    console.error(`${new Date().toISOString()}: [ADMIN] Error deleting user:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error deleting user',
      error: error.message
    });
  }
});

// Reset user password (admin only)
app.post('/api/admin/users/:id/reset-password', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    
    console.log(`${new Date().toISOString()}: [ADMIN] Password reset request for user ID: ${userId}`);
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.log(`${new Date().toISOString()}: [ADMIN] Invalid user ID format: ${userId}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }
    
    const user = await User.findById(userId);
    
    if (!user) {
      console.log(`${new Date().toISOString()}: [ADMIN] User not found for ID: ${userId}`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    console.log(`${new Date().toISOString()}: [ADMIN] Resetting password for user: ${user.email}`);
    
    // Generate a random 8-character password with letters, numbers, and special characters
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let tempPassword = '';
    // Ensure at least one character from each category
    tempPassword += chars.substring(0, 26).charAt(Math.floor(Math.random() * 26)); // Uppercase
    tempPassword += chars.substring(26, 52).charAt(Math.floor(Math.random() * 26)); // Lowercase
    tempPassword += chars.substring(52, 62).charAt(Math.floor(Math.random() * 10)); // Number
    tempPassword += chars.substring(62).charAt(Math.floor(Math.random() * 8)); // Special
    // Add 4 more random characters from any category
    for (let i = 0; i < 4; i++) {
      tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Shuffle the characters
    tempPassword = tempPassword.split('').sort(() => 0.5 - Math.random()).join('');
    
    // Log the plain text temporary password for debugging
    console.log(`${new Date().toISOString()}: [ADMIN] Generated temporary password: ${tempPassword}`);
    
    // Set the password directly (the pre-save hook will hash it)
    user.password = tempPassword;
    await user.save();
    
    console.log(`${new Date().toISOString()}: [ADMIN] Password updated in database for user: ${user.email}`);
    
    // Create HTML email template
    const htmlEmail = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #333; text-align: center; border-bottom: 1px solid #eee; padding-bottom: 10px;">Password Reset Notification</h2>
      <p>Hello ${user.name},</p>
      <p>Your password has been reset by an administrator.</p>
      <div style="background-color: #f8f8f8; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: center;">
        <p style="margin: 0; font-weight: bold;">Your temporary password is:</p>
        <h3 style="color: #007bff; margin: 10px 0;">${tempPassword}</h3>
      </div>
      <p>Please log in with this temporary password and change it immediately for security purposes.</p>
      <p>If you did not request this password reset, please contact the system administrator immediately.</p>
      <p style="margin-top: 30px; font-size: 12px; color: #777; text-align: center;">
        This is an automated message. Please do not reply to this email.
      </p>
    </div>
    `;
    
    // Configure email options
    const mailOptions = {
      from: '"Kidney Stone Detection App" <udetectupnvj@gmail.com>',
      to: user.email,
      subject: 'Your Password Has Been Reset',
      text: `Hello ${user.name}, your password has been reset. Your temporary password is: ${tempPassword}. Please log in and change it immediately.`,
      html: htmlEmail
    };
    
    console.log(`${new Date().toISOString()}: [ADMIN] Sending password reset email to: ${user.email}`);
    
    // Send the email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error(`${new Date().toISOString()}: [EMAIL] Error sending password reset email:`, error);
        return res.status(500).json({
          success: false,
          message: 'Error sending email',
          error: error.message
        });
      }
      
      console.log(`${new Date().toISOString()}: [EMAIL] Password reset email sent: ${info.response}`);
      return res.status(200).json({
        success: true,
        message: 'Password reset successful and email sent',
        tempPassword
      });
    });
  } catch (error) {
    console.error(`${new Date().toISOString()}: [ADMIN] Error processing password reset:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error resetting password',
      error: error.message
    });
  }
});

// Admin: Create a new user
app.post('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    
    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email and password'
      });
    }
    
    // Check if role is valid
    if (role && !['user', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role specified. Must be "user" or "admin"'
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
    
    // Store original plaintext password for email (before it's hashed)
    const originalPassword = password;
    
    // Create new user
    const user = new User({
      name,
      email,
      password,
      role: role || 'user'
    });
    
    await user.save();
    console.log(`${new Date().toISOString()}: [ADMIN] User created successfully: ${user._id}`);
    
    // Create HTML welcome email with password
    const htmlEmail = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #333; text-align: center; border-bottom: 1px solid #eee; padding-bottom: 10px;">Welcome to Kidney Stone Detection System</h2>
      <p>Hello ${name},</p>
      <p>An account has been created for you by an administrator.</p>
      <div style="background-color: #f8f8f8; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Email:</strong> ${email}</p>
        <p style="margin: 10px 0;"><strong>Password:</strong> ${originalPassword}</p>
        <p style="margin: 0;"><strong>Role:</strong> ${role || 'user'}</p>
      </div>
      <p>You can log in to the system using these credentials. For security purposes, please change your password after logging in.</p>
      <p style="margin-top: 30px; font-size: 12px; color: #777; text-align: center;">
        This is an automated message. Please do not reply to this email.
      </p>
    </div>
    `;
    
    // Configure email options
    const mailOptions = {
      from: '"Kidney Stone Detection System" <udetectupnvj@gmail.com>',
      to: email,
      subject: 'Your New Account',
      text: `Hello ${name}, an account has been created for you. Your login details are: Email: ${email}, Password: ${originalPassword}, Role: ${role || 'user'}. Please change your password after logging in.`,
      html: htmlEmail
    };
    
    console.log(`${new Date().toISOString()}: [ADMIN] Sending welcome email to: ${email}`);
    
    // Send the email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error(`${new Date().toISOString()}: [EMAIL] Error sending welcome email:`, error);
        // Continue despite email error - user is still created
      } else {
        console.log(`${new Date().toISOString()}: [EMAIL] Welcome email sent: ${info.response}`);
      }
      
      // Return success response regardless of email status
      return res.status(201).json({
        success: true,
        message: 'User created successfully' + (error ? ' (email notification failed)' : ' and welcome email sent'),
        data: {
          _id: user._id,
          id: user._id, // For compatibility
          name: user.name,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt
        }
      });
    });
  } catch (error) {
    console.error(`${new Date().toISOString()}: [ADMIN] Error:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error creating user',
      error: error.message
    });
  }
});

// Update user (admin only)
app.put('/api/admin/users/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    console.log(`${new Date().toISOString()}: [ADMIN] Update user request for ID: ${userId}`);
    
    // Check if the user ID is valid
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.log(`${new Date().toISOString()}: [ADMIN] Invalid user ID format: ${userId}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }
    
    // Find the user
    const user = await User.findById(userId);
    
    if (!user) {
      console.log(`${new Date().toISOString()}: [ADMIN] User not found for ID: ${userId}`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const { name, email, role } = req.body;
    console.log(`${new Date().toISOString()}: [ADMIN] Updating user:`, { name, email, role });
    
    // Update only the fields that are provided
    if (name) user.name = name;
    if (email) user.email = email;
    if (role && ['user', 'admin'].includes(role)) user.role = role;
    
    // Save the updated user
    await user.save();
    console.log(`${new Date().toISOString()}: [ADMIN] User updated successfully: ${userId}`);
    
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
    console.error(`${new Date().toISOString()}: [ADMIN] Error updating user:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error updating user',
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    success: true, 
    service: 'Admin Service',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  console.error(`${new Date().toISOString()}: [ERROR] Status: ${statusCode}, Message:`, err.message);
  
  // Never return 200 status for errors
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Server error' : err.message,
    error: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// Catch-all for unmatched routes
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    error: `No endpoint exists for ${req.method} ${req.url}`
  });
});

// Add route to serve temporary export files
app.get('/temp-exports/:filename', authenticateToken, isAdmin, (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(tempExportDir, filename);
    
    console.log(`${new Date().toISOString()}: [ADMIN] Requested temp file: ${filename}`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log(`${new Date().toISOString()}: [ADMIN] File not found: ${filePath}`);
      return res.status(404).json({
        success: false,
        message: 'File not found',
        error: 'The requested export file does not exist or has expired'
      });
    }
    
    // Check file age - files older than 7 days get deleted
    const stats = fs.statSync(filePath);
    const fileAge = Date.now() - stats.mtimeMs;
    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
    
    if (fileAge > sevenDaysInMs) {
      console.log(`${new Date().toISOString()}: [ADMIN] File expired, deleting: ${filePath}`);
      fs.unlinkSync(filePath);
      return res.status(404).json({
        success: false,
        message: 'File expired',
        error: 'The requested export file has expired and been deleted'
      });
    }
    
    // Serve the file
    console.log(`${new Date().toISOString()}: [ADMIN] Serving file: ${filePath}`);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(filePath).pipe(res);
    
  } catch (error) {
    console.error(`${new Date().toISOString()}: [ADMIN] Error serving export file:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Error serving file',
      error: error.message
    });
  }
});

// Connect to MongoDB with retry mechanism
const connectWithRetry = (retryCount = 0, maxRetries = 5) => {
  connectToMongoDB()
    .then(() => {
      console.log(`${new Date().toISOString()}: [ADMIN SERVICE] Connected to MongoDB`);
    })
    .catch(err => {
      console.error(`${new Date().toISOString()}: [ADMIN SERVICE] MongoDB connection error:`, err.message);
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        console.log(`${new Date().toISOString()}: [ADMIN SERVICE] Retrying MongoDB connection in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})...`);
        setTimeout(() => connectWithRetry(retryCount + 1, maxRetries), delay);
      } else {
        console.error(`${new Date().toISOString()}: [ADMIN SERVICE] Failed to connect to MongoDB after ${maxRetries} attempts`);
      }
    });
};

connectWithRetry();

// Cache statistics endpoint (admin only)
app.get('/api/admin/cache/stats', authenticateToken, isAdmin, cacheStatsMiddleware({ adminCache }));

// Start server - ensure MongoDB is connected first
if (mongoose.connection.readyState === 1) {
  app.listen(PORT, () => {
    console.log(`${new Date().toISOString()}: Admin service running on port ${PORT}`);
  });
} else {
  console.log(`${new Date().toISOString()}: Waiting for MongoDB connection before starting server...`);
  mongoose.connection.once('connected', () => {
    app.listen(PORT, () => {
      console.log(`${new Date().toISOString()}: Admin service running on port ${PORT}`);
    });
  });
}

// Create directory for temporary data export files if it doesn't exist
const tempExportDir = path.join(__dirname, '..', '..', 'temp-exports');
if (!fs.existsSync(tempExportDir)) {
  fs.mkdirSync(tempExportDir, { recursive: true });
  console.log(`${new Date().toISOString()}: [ADMIN] Created temp exports directory at ${tempExportDir}`);
}

// Helper function to create CSV data from user data
const createUserCsv = (user, predictions = []) => {
  // Basic user info excluding password
  const userFields = [
    'id', 'name', 'email', 'role', 'createdAt', 'lastLogin'
  ];
  
  // Format user data for CSV
  const userData = {
    id: user._id.toString(),
    name: user.name || '',
    email: user.email || '',
    role: user.role || 'user',
    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : '',
    lastLogin: user.lastLogin ? new Date(user.lastLogin).toISOString() : ''
  };
  
  // Create CSV header row
  let csvContent = userFields.join(',') + '\n';
  
  // Create CSV data row
  csvContent += userFields.map(field => {
    // Escape commas and quotes
    const value = userData[field] !== null && userData[field] !== undefined ? userData[field].toString() : '';
    return `"${value.replace(/"/g, '""')}"`;
  }).join(',') + '\n\n';
  
  // If predictions are provided, add them to the CSV
  if (predictions.length > 0) {
    // V2 CSV export with new parameters
    const predictionFields = [
      'id', 'date', 'predictedClass', 'confidence', 'ph', 'tds', 'specificGravity', 'turbidityNTU', 
      'red', 'green', 'blue', 'turbidityLevel', 'warnaDasar', 'analisis', 'notes'
    ];
    
    // Add predictions header
    csvContent += '\nPrediction History\n';
    csvContent += predictionFields.join(',') + '\n';
    
    // Add each prediction as a row
    predictions.forEach(prediction => {
      const predData = {
        id: prediction._id.toString(),
        date: prediction.date ? new Date(prediction.date).toISOString() : '',
        predictedClass: prediction.predictedClass || '',
        confidence: prediction.confidence || 0,
        ph: prediction.parameters?.ph || '',
        tds: prediction.parameters?.tds || '',
        specificGravity: prediction.parameters?.specificGravity || '',
        turbidityNTU: prediction.parameters?.turbidityNTU || '',
        red: prediction.parameters?.red || '',
        green: prediction.parameters?.green || '',
        blue: prediction.parameters?.blue || '',
        turbidityLevel: prediction.parameters?.turbidityLevel || '',
        warnaDasar: prediction.parameters?.warnaDasar || '',
        analisis: prediction.parameters?.analisis || '',
        notes: prediction.notes || ''
      };
      
      csvContent += predictionFields.map(field => {
        const value = predData[field] !== null && predData[field] !== undefined ? predData[field].toString() : '';
        return `"${value.replace(/"/g, '""')}"`;
      }).join(',') + '\n';
    });
  }
  
  return csvContent;
};

// Helper function to save CSV to disk
const saveUserCsvToDisk = (userId, csvContent) => {
  const timestamp = Date.now();
  const filename = `user_${userId}_export_${timestamp}.csv`;
  const filePath = path.join(tempExportDir, filename);
  
  return new Promise((resolve, reject) => {
    fs.writeFile(filePath, csvContent, 'utf8', (err) => {
      if (err) {
        console.error(`${new Date().toISOString()}: [ADMIN] Error saving CSV:`, err);
        reject(err);
      } else {
        console.log(`${new Date().toISOString()}: [ADMIN] CSV saved to ${filePath}`);
        resolve({ 
          filename,
          filePath,
          // Use relative path for download URL
          downloadUrl: `/temp-exports/${filename}`
        });
      }
    });
  });
};

// Function to clean up expired export files (older than 7 days)
const cleanupExpiredFiles = () => {
  try {
    console.log(`${new Date().toISOString()}: [ADMIN] Running scheduled cleanup of expired export files`);
    
    if (!fs.existsSync(tempExportDir)) {
      console.log(`${new Date().toISOString()}: [ADMIN] Temp export directory does not exist, skipping cleanup`);
      return;
    }
    
    const files = fs.readdirSync(tempExportDir);
    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
    let deletedCount = 0;
    
    files.forEach(file => {
      const filePath = path.join(tempExportDir, file);
      const stats = fs.statSync(filePath);
      const fileAge = Date.now() - stats.mtimeMs;
      
      if (fileAge > sevenDaysInMs) {
        try {
          fs.unlinkSync(filePath);
          deletedCount++;
          console.log(`${new Date().toISOString()}: [ADMIN] Deleted expired file: ${file} (${Math.round(fileAge / 86400000)} days old)`);
        } catch (deleteError) {
          console.error(`${new Date().toISOString()}: [ADMIN] Error deleting file ${file}:`, deleteError.message);
        }
      }
    });
    
    console.log(`${new Date().toISOString()}: [ADMIN] Cleanup complete. Deleted ${deletedCount} expired files`);
  } catch (error) {
    console.error(`${new Date().toISOString()}: [ADMIN] Error during file cleanup:`, error.message);
  }
};

// Schedule daily cleanup
setInterval(cleanupExpiredFiles, 24 * 60 * 60 * 1000); // Run cleanup every 24 hours
console.log(`${new Date().toISOString()}: [ADMIN] Scheduled daily cleanup of expired export files`);

// Run cleanup at startup as well
cleanupExpiredFiles();

module.exports = app; 