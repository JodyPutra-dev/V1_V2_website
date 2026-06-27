/**
 * Production Logger Module
 * Centralized structured logging with daily rotation using Winston
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Log directory
const LOG_DIR = path.join(__dirname, '..', '..', 'logs');

// Create log directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Custom format to redact sensitive data
 */
const redactSensitiveData = winston.format((info) => {
  const sensitiveFields = ['password', 'token', 'authorization', 'jwt', 'secret', 'apikey'];
  
  const redactObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    
    const redacted = Array.isArray(obj) ? [...obj] : { ...obj };
    
    for (const key in redacted) {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        redacted[key] = '[REDACTED]';
      } else if (typeof redacted[key] === 'object') {
        redacted[key] = redactObject(redacted[key]);
      }
    }
    
    return redacted;
  };
  
  return redactObject(info);
});

/**
 * Custom log format
 */
const customFormat = winston.format.printf(({ timestamp, level, message, serviceName, ...meta }) => {
  const service = serviceName ? `[${serviceName}]` : '';
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  const stack = meta.stack ? `\n${meta.stack}` : '';
  
  return `${timestamp} [${level.toUpperCase()}] ${service} ${message}${metaStr}${stack}`;
});

/**
 * Create logger instance for a service
 * @param {string} serviceName - Name of the service (e.g., 'gateway', 'user-service')
 * @param {object} options - Optional configuration overrides
 * @returns {winston.Logger} Configured Winston logger
 */
function createLogger(serviceName, options = {}) {
  const logLevel = options.level || process.env.LOG_LEVEL || 'info';
  const logDir = options.logDir || LOG_DIR;
  
  // Console transport for development/debugging
  const consoleTransport = new winston.transports.Console({
    level: logLevel,
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss Z' }),
      customFormat
    )
  });
  
  // Daily rotate file transport for all logs
  const fileTransport = new DailyRotateFile({
    filename: path.join(logDir, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    zippedArchive: true,
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss Z' }),
      redactSensitiveData(),
      customFormat
    )
  });
  
  // Daily rotate file transport for errors only
  const errorFileTransport = new DailyRotateFile({
    filename: path.join(logDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    zippedArchive: true,
    level: 'error',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss Z' }),
      winston.format.errors({ stack: true }),
      redactSensitiveData(),
      customFormat
    )
  });
  
  // Create logger with transports
  const transports = [fileTransport, errorFileTransport];
  
  // Add console transport in development or if DEBUG is enabled
  if (process.env.NODE_ENV !== 'production' || process.env.DEBUG === 'true') {
    transports.push(consoleTransport);
  }
  
  const logger = winston.createLogger({
    level: logLevel,
    defaultMeta: { serviceName },
    transports,
    exitOnError: false
  });
  
  // Handle transport errors
  fileTransport.on('error', (error) => {
    console.error('[LOGGER] File transport error:', error.message);
  });
  
  errorFileTransport.on('error', (error) => {
    console.error('[LOGGER] Error file transport error:', error.message);
  });
  
  return logger;
}

/**
 * Log HTTP request
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {number} duration - Request duration in milliseconds
 */
function logRequest(logger, req, res, duration) {
  const { method, originalUrl, ip } = req;
  const { statusCode } = res;
  
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  
  logger[level]('HTTP Request', {
    method,
    url: originalUrl,
    statusCode,
    duration: `${duration}ms`,
    ip,
    userAgent: req.headers['user-agent']
  });
}

/**
 * Log error with context
 * @param {object} logger - Winston logger instance
 * @param {Error} error - Error object
 * @param {object} context - Additional context
 */
function logError(logger, error, context = {}) {
  logger.error(error.message, {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code
    },
    ...context
  });
}

/**
 * Log performance metric
 * @param {object} logger - Winston logger instance
 * @param {string} name - Metric name
 * @param {number} value - Metric value
 * @param {object} tags - Additional tags
 */
function logMetric(logger, name, value, tags = {}) {
  logger.info('Performance Metric', {
    metric: name,
    value,
    ...tags
  });
}

/**
 * Close logger and flush pending logs
 * @param {object} logger - Winston logger instance
 * @returns {Promise} Promise that resolves when logger is closed
 */
function closeLogger(logger) {
  return new Promise((resolve) => {
    if (logger && typeof logger.close === 'function') {
      logger.close(() => {
        console.log('[LOGGER] Logger closed');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// Export
module.exports = {
  createLogger,
  logRequest,
  logError,
  logMetric,
  closeLogger
};
