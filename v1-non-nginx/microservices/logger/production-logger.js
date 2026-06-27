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
 * Log ML service request
 * @param {object} logger - Winston logger instance
 * @param {object} requestData - Request details
 */
function logMLRequest(logger, requestData) {
  const { requestId, model, parameters, endpoint } = requestData;
  
  logger.info('ML Service Request', {
    requestId,
    model: model || 'kidney_stone_model',
    endpoint: endpoint || '/predict',
    parameterCount: parameters ? Object.keys(parameters).length : 0,
    parameters: parameters || {}
  });
}

/**
 * Log ML service response
 * @param {object} logger - Winston logger instance
 * @param {object} responseData - Response details
 */
function logMLResponse(logger, responseData) {
  const { requestId, status, duration, result, error, fullBody } = responseData;
  
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  
  const logData = {
    requestId,
    status,
    duration: duration ? `${duration}ms` : undefined,
    success: status >= 200 && status < 300
  };
  
  if (result) {
    logData.result = typeof result === 'object' ? JSON.stringify(result).substring(0, 200) : result;
  }
  
  if (error) {
    logData.error = error;
  }
  
  // Log full response body for errors
  if (status >= 400 && fullBody) {
    logData.fullResponseBody = typeof fullBody === 'object' ? fullBody : fullBody.substring(0, 1000);
  }
  
  logger[level]('ML Service Response', logData);
}

/**
 * Log Python process execution
 * @param {object} logger - Winston logger instance
 * @param {object} executionData - Execution details
 */
function logPythonExecution(logger, executionData) {
  const { 
    requestId, 
    command, 
    args, 
    modelPath, 
    modelSize,
    inputPath, 
    outputPath,
    inputSummary 
  } = executionData;
  
  logger.info('Python Process Execution', {
    requestId,
    command: command || 'python3',
    script: args ? args[0] : 'python_bridge.py',
    modelPath,
    modelSize: modelSize ? `${(modelSize / 1024).toFixed(2)} KB` : undefined,
    inputPath,
    outputPath,
    inputSummary
  });
}

/**
 * Log Python process error
 * @param {object} logger - Winston logger instance
 * @param {object} errorData - Error details
 */
function logPythonError(logger, errorData) {
  const { requestId, stderr, exitCode, command, context } = errorData;
  
  logger.error('Python Process Error', {
    requestId,
    exitCode,
    command,
    stderr: stderr || 'No stderr output',
    context
  });
}

/**
 * Log CSV processing
 * @param {object} logger - Winston logger instance
 * @param {object} processingData - Processing details
 */
function logCSVProcessing(logger, processingData) {
  const { 
    requestId, 
    stage, 
    filename, 
    fileSize,
    rowCount, 
    validRows,
    invalidRows,
    errors,
    successCount,
    failureCount,
    duration
  } = processingData;
  
  const level = errors && errors.length > 0 ? 'warn' : 'info';
  
  const logData = {
    requestId,
    stage,
    filename,
    fileSize: fileSize ? `${(fileSize / 1024).toFixed(2)} KB` : undefined,
    rowCount,
    validRows,
    invalidRows,
    successCount,
    failureCount,
    duration: duration ? `${duration}ms` : undefined
  };
  
  if (errors && errors.length > 0) {
    logData.errors = errors.slice(0, 5); // First 5 errors
    logData.totalErrors = errors.length;
  }
  
  logger[level](`CSV Processing - ${stage}`, logData);
}

/**
 * Create logger instance for a service
 * @param {string} serviceName - Name of the service (e.g., 'gateway', 'user-service')
 * @param {object} options - Optional configuration overrides
 * @returns {winston.Logger} Configured Winston logger
 */
function createLoggerWithPython(serviceName, options = {}) {
  const logLevel = options.level || process.env.LOG_LEVEL || 'info';
  const logDir = options.logDir || LOG_DIR;
  const enablePythonLogging = options.enablePythonLogging || false;
  
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
  
  // Add Python error transport if enabled
  if (enablePythonLogging) {
    const pythonErrorTransport = new DailyRotateFile({
      filename: path.join(logDir, 'python_errors-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true,
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss Z' }),
        winston.format.errors({ stack: true }),
        redactSensitiveData(),
        customFormat
      )
    });
    transports.push(pythonErrorTransport);
  }
  
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
  createLogger: createLoggerWithPython,
  logRequest,
  logError,
  logMetric,
  logMLRequest,
  logMLResponse,
  logPythonExecution,
  logPythonError,
  logCSVProcessing,
  closeLogger
};
