/**
 * Error Formatter Module - Standardizes error responses with proper HTTP status codes
 * and user-friendly messages
 */

// ===== ERROR CODE CONSTANTS =====
const ERROR_CODES = {
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  SERVICE_TIMEOUT: 'SERVICE_TIMEOUT',
  CIRCUIT_BREAKER_OPEN: 'CIRCUIT_BREAKER_OPEN',
  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  AUTHORIZATION_FAILED: 'AUTHORIZATION_FAILED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  ML_SERVICE_ERROR: 'ML_SERVICE_ERROR',
  ML_PREDICTION_FAILED: 'ML_PREDICTION_FAILED',
  PYTHON_PROCESS_ERROR: 'PYTHON_PROCESS_ERROR',
  PYTHON_MODULE_ERROR: 'PYTHON_MODULE_ERROR',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  MODEL_LOAD_ERROR: 'MODEL_LOAD_ERROR',
  CSV_PARSE_ERROR: 'CSV_PARSE_ERROR',
  CSV_VALIDATION_ERROR: 'CSV_VALIDATION_ERROR'
};

// ===== ERROR STATUS CODE MAPPING =====
function getStatusCode(error) {
  // Explicit status code from error
  if (error.statusCode) {
    return error.statusCode;
  }
  
  // Network errors
  if (error.code === 'ECONNREFUSED' || 
      error.code === 'ENOTFOUND' || 
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNRESET') {
    return 503;
  }
  
  // Custom error types
  if (error.name === 'TimeoutError') {
    return 504;
  }
  
  if (error.name === 'ServiceUnavailableError') {
    return 503;
  }
  
  if (error.name === 'RetryExhaustedError') {
    return 503;
  }
  
  if (error.name === 'NetworkError') {
    return 503;
  }
  
  // Parse errors
  if (error.name === 'SyntaxError' && error.message.includes('JSON')) {
    return 502;
  }
  
  // Authentication/Authorization
  if (error.message && error.message.toLowerCase().includes('unauthorized')) {
    return 401;
  }
  
  if (error.message && error.message.toLowerCase().includes('forbidden')) {
    return 403;
  }
  
  // Rate limiting
  if (error.message && error.message.toLowerCase().includes('rate limit')) {
    return 429;
  }
  
  // Default server error
  return 500;
}

// ===== USER-FRIENDLY MESSAGE GENERATOR =====
function getUserFriendlyMessage(error, serviceName) {
  // Network errors
  if (error.code === 'ECONNREFUSED') {
    return `${serviceName || 'The service'} is temporarily unavailable. Please try again later.`;
  }
  
  if (error.code === 'ENOTFOUND') {
    return `Unable to reach ${serviceName || 'the service'}. Please check your connection and try again.`;
  }
  
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
    return 'The request timed out. Please try again.';
  }
  
  // Custom error types
  if (error.name === 'TimeoutError') {
    return 'The request took too long to complete. Please try again.';
  }
  
  if (error.name === 'ServiceUnavailableError') {
    if (error.circuitBreakerState === 'OPEN') {
      return `${serviceName || 'The service'} is experiencing issues. Please try again in a few moments.`;
    }
    return `${serviceName || 'The service'} is temporarily unavailable. Please try again later.`;
  }
  
  if (error.name === 'RetryExhaustedError') {
    return 'Unable to complete your request after multiple attempts. Please try again later.';
  }
  
  // Parse errors
  if (error.name === 'SyntaxError' && error.message.includes('JSON')) {
    return 'Received an invalid response from the service. Please contact support if this persists.';
  }
  
  // Authentication/Authorization
  if (error.statusCode === 401) {
    return 'Authentication failed. Please log in again.';
  }
  
  if (error.statusCode === 403) {
    return 'You do not have permission to perform this action.';
  }
  
  // Rate limiting
  if (error.statusCode === 429) {
    return 'Too many requests. Please slow down and try again later.';
  }
  
  // Validation errors
  if (error.statusCode === 400) {
    return error.message || 'Invalid request. Please check your input and try again.';
  }
  
  // Not found
  if (error.statusCode === 404) {
    return error.message || 'The requested resource was not found.';
  }
  
  // Server errors
  if (error.statusCode >= 500) {
    return 'An unexpected error occurred. Please try again later.';
  }
  
  // Default message
  return error.message || 'An unexpected error occurred. Please try again.';
}

// ===== ML/PYTHON ERROR CODE MAPPER =====
function getMLErrorCode(error) {
  const errorMessage = error.message || '';
  
  // Python module errors
  if (errorMessage.includes('ModuleNotFoundError') || errorMessage.includes('No module named')) {
    return ERROR_CODES.PYTHON_MODULE_ERROR;
  }
  
  // Model file errors
  if (errorMessage.includes('Model file not found') || errorMessage.includes('FileNotFoundError')) {
    return ERROR_CODES.MODEL_NOT_FOUND;
  }
  
  if (errorMessage.includes('Failed to load') || errorMessage.includes('Model load error')) {
    return ERROR_CODES.MODEL_LOAD_ERROR;
  }
  
  // CSV errors
  if (errorMessage.includes('CSV') && (errorMessage.includes('parse') || errorMessage.includes('parsing'))) {
    return ERROR_CODES.CSV_PARSE_ERROR;
  }
  
  if (errorMessage.includes('CSV') && (errorMessage.includes('validation') || errorMessage.includes('Invalid'))) {
    return ERROR_CODES.CSV_VALIDATION_ERROR;
  }
  
  // Python process errors
  if (errorMessage.includes('Python process') || errorMessage.includes('process exited')) {
    return ERROR_CODES.PYTHON_PROCESS_ERROR;
  }
  
  // ML service errors
  if (errorMessage.includes('ML service')) {
    return ERROR_CODES.ML_SERVICE_ERROR;
  }
  
  // Prediction errors
  if (errorMessage.includes('prediction') || errorMessage.includes('Prediction')) {
    return ERROR_CODES.ML_PREDICTION_FAILED;
  }
  
  return ERROR_CODES.INTERNAL_ERROR;
}

// ===== ML ERROR RESPONSE BUILDER =====
function buildMLErrorResponse(error, context = {}) {
  const { 
    modelName, 
    modelVersion, 
    modelPath, 
    exitCode, 
    stderr, 
    csvRow, 
    csvField,
    requestId 
  } = context;
  
  const errorCode = getMLErrorCode(error);
  const statusCode = getStatusCode(error);
  const message = getUserFriendlyMessage(error);
  
  const response = {
    success: false,
    message,
    error: error.message || 'Unknown ML error',
    code: errorCode,
    statusCode,
    timestamp: new Date().toISOString(),
    requestId: requestId || generateRequestId()
  };
  
  // Add model context if available
  if (modelName) {
    response.model = {
      name: modelName,
      version: modelVersion,
      path: modelPath
    };
  }
  
  // Add Python process details if applicable
  if (exitCode !== undefined) {
    response.pythonProcess = {
      exitCode,
      stderr: stderr ? stderr.substring(0, 500) : undefined
    };
  }
  
  // Add CSV processing context if applicable
  if (csvRow !== undefined || csvField) {
    response.csvContext = {
      row: csvRow,
      field: csvField
    };
  }
  
  // Add debug information in non-production
  if (process.env.NODE_ENV !== 'production') {
    response.debug = {
      errorName: error.name,
      stack: error.stack,
      fullStderr: stderr
    };
  }
  
  return response;
}

// ===== ERROR CODE GENERATOR =====
function getErrorCode(error) {
  if (error.name === 'TimeoutError') {
    return ERROR_CODES.SERVICE_TIMEOUT;
  }
  
  if (error.name === 'ServiceUnavailableError') {
    return ERROR_CODES.CIRCUIT_BREAKER_OPEN;
  }
  
  if (error.name === 'RetryExhaustedError') {
    return ERROR_CODES.RETRY_EXHAUSTED;
  }
  
  if (error.name === 'NetworkError' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return ERROR_CODES.NETWORK_ERROR;
  }
  
  if (error.name === 'SyntaxError' && error.message.includes('JSON')) {
    return ERROR_CODES.INVALID_RESPONSE;
  }
  
  if (error.statusCode === 401) {
    return ERROR_CODES.AUTHENTICATION_FAILED;
  }
  
  if (error.statusCode === 403) {
    return ERROR_CODES.AUTHORIZATION_FAILED;
  }
  
  if (error.statusCode === 400) {
    return ERROR_CODES.VALIDATION_ERROR;
  }
  
  if (error.statusCode === 429) {
    return ERROR_CODES.RATE_LIMIT_EXCEEDED;
  }
  
  if (error.statusCode === 503) {
    return ERROR_CODES.SERVICE_UNAVAILABLE;
  }
  
  return ERROR_CODES.INTERNAL_ERROR;
}

// ===== ERROR RESPONSE BUILDER =====
function buildErrorResponse(error, context = {}) {
  const { serviceName, endpoint, method } = context;
  
  const statusCode = getStatusCode(error);
  const message = getUserFriendlyMessage(error, serviceName);
  const code = getErrorCode(error);
  const requestId = context.requestId || generateRequestId();
  
  const response = {
    success: false,
    message,
    error: error.message || 'Unknown error',
    code,
    statusCode,
    timestamp: new Date().toISOString(),
    requestId
  };
  
  // Add service context if available
  if (serviceName) {
    response.serviceName = serviceName;
  }
  
  if (endpoint) {
    response.endpoint = endpoint;
  }
  
  // Add additional error details in development
  if (process.env.NODE_ENV !== 'production') {
    response.debug = {
      errorName: error.name,
      errorCode: error.code,
      stack: error.stack,
      originalError: error.originalError?.message
    };
  }
  
  return response;
}

// ===== GRACEFUL DEGRADATION HELPER =====
function shouldUseCachedFallback(error, endpoint, method = 'GET') {
  // Only use cache for GET requests
  if (method !== 'GET') {
    return false;
  }
  
  // Don't use cache for prediction endpoints (user-specific, real-time)
  if (endpoint && endpoint.includes('/api/predict')) {
    return false;
  }
  
  // Don't use cache for authentication endpoints
  if (endpoint && (endpoint.includes('/login') || endpoint.includes('/register'))) {
    return false;
  }
  
  // Use cache if circuit breaker is open
  if (error.name === 'ServiceUnavailableError' && error.circuitBreakerState === 'OPEN') {
    return true;
  }
  
  // Use cache if retry exhausted
  if (error.name === 'RetryExhaustedError') {
    return true;
  }
  
  // Use cache for network errors on cacheable endpoints
  if (error.name === 'NetworkError' || error.code === 'ECONNREFUSED') {
    return true;
  }
  
  return false;
}

// ===== EXPRESS MIDDLEWARE =====
function errorHandlerMiddleware() {
  return (error, req, res, next) => {
    // Skip if headers already sent
    if (res.headersSent) {
      return next(error);
    }
    
    // Build error response
    const context = {
      serviceName: req.serviceName || 'gateway',
      endpoint: req.originalUrl || req.url,
      method: req.method,
      requestId: req.id || generateRequestId()
    };
    
    const errorResponse = buildErrorResponse(error, context);
    
    // Log error
    console.error(`[ERROR-HANDLER] ${errorResponse.code}:`, {
      requestId: errorResponse.requestId,
      endpoint: context.endpoint,
      message: error.message,
      statusCode: errorResponse.statusCode
    });
    
    // Send response
    res.status(errorResponse.statusCode).json(errorResponse);
  };
}

// ===== UTILITY FUNCTIONS =====
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ===== EXPORTS =====
module.exports = {
  buildErrorResponse,
  buildMLErrorResponse,
  getMLErrorCode,
  getUserFriendlyMessage,
  getStatusCode,
  getErrorCode,
  shouldUseCachedFallback,
  errorHandlerMiddleware,
  ERROR_CODES
};
