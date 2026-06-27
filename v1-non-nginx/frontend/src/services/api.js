import axios from 'axios';
import config from '../config';

// Use the API URL from config - this points to the gateway service (port 7764)
let API_BASE_URL = config.apiUrl;

// Create axios instance with default config
const createApiInstance = (baseUrl = API_BASE_URL) => {
  const instance = axios.create({
    baseURL: baseUrl,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 30000,
    // Don't use withCredentials as it causes CORS issues with different protocols
    withCredentials: false,
    // Consider all status codes valid to handle errors manually
    validateStatus: function (status) {
      return status < 500;
    }
  });
  
  // Remove any problematic default headers
  delete instance.defaults.headers.common;
  
  return instance;
};

let api = createApiInstance();

// Function to switch API base URL if needed
const switchToProtocol = (protocol) => {
  if (protocol === 'http') {
    API_BASE_URL = config.directApiUrl;
  } else {
    API_BASE_URL = config.apiUrl;
  }
  
  api = createApiInstance(API_BASE_URL);
  
  return API_BASE_URL;
};

// Attempt connection with both protocols to determine which works
const testConnections = async () => {
  // Try HTTPS first (current protocol)
  try {
    const response = await axios.get(`${config.apiUrl}/api/health`, {
      timeout: 5000,
      validateStatus: () => true
    });
    
    if (response.status >= 200 && response.status < 300) {
      // Make sure API is using correct URL that matches the current protocol
      if (API_BASE_URL !== config.apiUrl && config.protocol === 'https') {
        switchToProtocol('https');
      }
      return;
    }
  } catch (error) {
    // Error with current protocol
  }
  
  // If HTTPS failed, try HTTP
  try {
    const httpResponse = await axios.get(`${config.directApiUrl}/api/health`, {
      timeout: 5000,
      validateStatus: () => true
    });
    
    if (httpResponse.status >= 200 && httpResponse.status < 300) {
      switchToProtocol('http');
    }
  } catch (err) {
    // Both protocols failed. Using default and hoping for the best.
  }
};

// Test connections on startup
testConnections();

// Add request interceptor to add auth token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      // Make sure to use the exact format expected by the auth middleware
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    // Also include user-id header as backup authentication method
    const userData = JSON.parse(localStorage.getItem('user') || '{}');
    if (userData && userData.id) {
      config.headers['user-id'] = userData.id;
    }
    
    // Check if this is a file upload (FormData instance)
    if (config.data instanceof FormData) {
      // For file uploads, let axios automatically set Content-Type with boundary
      // Remove any manually set Content-Type to avoid overriding multipart/form-data
      delete config.headers['Content-Type'];
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor to handle auth errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Check if this is an auth endpoint
    const isAuthEndpoint = error.config.url.includes('/auth/') || 
                          error.config.url.includes('/login') ||
                          error.config.url.includes('/register');
    
    // Handle authentication errors
    if (error.response) {
      // Authentication errors - redirect to login only if not already on login page
      if ((error.response.status === 401 || error.response.status === 403) && !isAuthEndpoint) {
        const currentPath = window.location.pathname;
        
        // Don't redirect if already on login page or certain paths
        if (!currentPath.includes('/login') && 
            !currentPath.includes('/debug') && 
            !currentPath.includes('/test')) {
          
          // Clear auth data
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          
          // Dispatch storage event to notify components
          window.dispatchEvent(new Event('storage'));
          
          // Use window.location.replace to prevent back button from returning to protected page
          window.location.replace('/login');
        }
      }
    }
    
    return Promise.reject(error);
  }
);

// Global error handler to make network errors more user-friendly
if (typeof window !== 'undefined') {
  // Create an ultra-aggressive error suppressor for auth requests
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  // Keep track of auth requests in progress
  window.__authRequestsInProgress = new Set();
  
  // Override console methods to filter out auth request errors
  console.error = function(...args) {
    // Check if this is a network error for auth endpoints
    const errorString = args.map(arg => String(arg)).join(' ');
    const isAuthError = (
      errorString.includes('/api/auth/login') || 
      errorString.includes('/api/direct-login') ||
      errorString.includes('401') || 
      errorString.includes('Unauthorized')
    );
    
    // Skip logging if it's an auth request error
    if (isAuthError && window.__authRequestsInProgress.size > 0) {
      return; // Don't log the error
    }
    
    // Otherwise, call the original method
    return originalConsoleError.apply(console, args);
  };
  
  console.warn = function(...args) {
    // Check if this is a warning for auth endpoints
    const warnString = args.map(arg => String(arg)).join(' ');
    const isAuthWarning = (
      warnString.includes('/api/auth/login') || 
      warnString.includes('/api/direct-login') ||
      warnString.includes('401') || 
      warnString.includes('Unauthorized')
    );
    
    // Skip logging if it's an auth request warning
    if (isAuthWarning && window.__authRequestsInProgress.size > 0) {
      return; // Don't log the warning
    }
    
    // Otherwise, call the original method
    return originalConsoleWarn.apply(console, args);
  };
  
  // Method to track that an auth request has started
  window.startAuthRequest = function(id) {
    window.__authRequestsInProgress.add(id || Date.now());
  };
  
  // Method to track that an auth request has ended
  window.endAuthRequest = function(id) {
    window.__authRequestsInProgress.delete(id);
  };
  
  // Install global error handler to catch unhandled fetch errors
  window.addEventListener('unhandledrejection', function(event) {
    // Check if this is related to a fetch/XHR auth error
    if (event.reason && 
        window.__authRequestsInProgress.size > 0 &&
        (String(event.reason).includes('fetch') || 
         String(event.reason).includes('api/auth'))) {
      // Prevent the default handling (which logs to console)
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  
  // Override the default fetch to make errors more friendly
  const originalFetch = window.fetch;
  window.fetch = function userFriendlyFetch(url, options) {
    // Handle authentication requests specially
    const isAuthRequest = url && 
      (url.includes('/api/auth/login') || 
       url.includes('/api/direct-login'));
    
    if (isAuthRequest) {
      // Generate a unique ID for this request
      const requestId = Date.now();
      
      // Start tracking this auth request
      window.startAuthRequest(requestId);
      
      // For auth endpoints, use a customized fetch that doesn't log errors
      return originalFetch(url, options)
        .then(response => {
          // Request is done, stop tracking
          window.endAuthRequest(requestId);
          return response;
        })
        .catch(error => {
          // Request is done, stop tracking
          window.endAuthRequest(requestId);
          
          // Return a fake "success" response with the actual error embedded
          // This prevents ugly network errors in the console
          return new Response(JSON.stringify({
            success: false,
            error: error.message,
            message: "Authentication failed. Please check your credentials."
          }), { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        });
    }
    
    // For non-auth endpoints, use normal fetch
    return originalFetch(url, options);
  };
  
  // Also intercept XHR requests to hide login errors
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    // Track if this is an auth URL
    this._isAuthRequest = url && 
      (url.includes('/api/auth/login') || 
       url.includes('/api/direct-login'));
    
    if (this._isAuthRequest) {
      // Generate a unique ID for this request
      this._authRequestId = Date.now();
      
      // Start tracking this auth request
      window.startAuthRequest(this._authRequestId);
    }
    
    // Call the original open method
    return originalXhrOpen.call(this, method, url, ...rest);
  };
  
  // Override send to catch errors
  const originalXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args) {
    if (this._isAuthRequest) {
      // Add event handlers for all possible completion events
      const events = ['error', 'abort', 'load', 'loadend', 'timeout'];
      
      const cleanupAuthRequest = () => {
        if (this._authRequestId) {
          window.endAuthRequest(this._authRequestId);
          this._authRequestId = null;
        }
      };
      
      // Add handlers for all events to clean up
      events.forEach(event => {
        this.addEventListener(event, cleanupAuthRequest, { once: true });
      });
      
      // Override status getter to hide 401 errors in console
      const originalStatusGetter = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'status').get;
      Object.defineProperty(this, 'status', {
        get: function() {
          const status = originalStatusGetter.call(this);
          // For auth requests with 401, pretend it's a 200 to avoid console error
          if (this._isAuthRequest && status === 401) {
            return 200;
          }
          return status;
        }
      });
      
      // Catch any errors specifically for auth requests
      this.addEventListener('error', function(e) {
        if (this._isAuthRequest) {
          // Completely silence the error
          e.stopImmediatePropagation();
          e.stopPropagation();
          e.preventDefault();
        }
      }, true);
    }
    
    // Call the original send method
    return originalXhrSend.apply(this, args);
  };
}

// Auth API calls
export const authAPI = {
  // Auth routes go through gateway which forwards to user service
  register: (userData) => api.post('/api/auth/register', userData),
  
  login: async (credentials) => {
    try {
      // First try with current protocol (from config)
      
      try {
        // Use a completely different approach without axios
        // to avoid browser logging network errors
        const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Only add specific headers we need, avoid axios internal headers
            ...(api.defaults.headers.Authorization && { 'Authorization': api.defaults.headers.Authorization }),
            ...(api.defaults.headers['user-id'] && { 'user-id': api.defaults.headers['user-id'] })
          },
          body: JSON.stringify(credentials)
        });
        
        const data = await response.json();
        
        // Check if the response status indicates an error
        if (!response.ok || !data.success) {
          // Transform into user-friendly error
          const friendlyError = new Error(data.message || 'Authentication failed');
          friendlyError.response = { 
            status: response.status,
            data: data
          };
          throw friendlyError;
        }
        
        // Store token and user data in localStorage
        if (data && data.token) {
          localStorage.setItem('token', data.token);
          localStorage.setItem('user', JSON.stringify(data.user || data));
        } else {
          throw new Error('Invalid response: Missing token');
        }
        
        return { data };
      } catch (initialError) {
        // If initial login fails with SSL or Mixed Content error, try the HTTP direct endpoint
        if (initialError.message && (
            initialError.message.includes('Mixed Content') ||
            initialError.message.includes('certificate') ||
            initialError.message.includes('SSL')
        )) {
          // Use the direct HTTP endpoint for login
          const directUrl = `${config.directApiUrl}/api/direct-login`;
          
          const directResponse = await fetch(directUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(credentials)
          });
          
          const directData = await directResponse.json();
          
          // Check if the direct login was successful
          if (!directResponse.ok || !directData.success) {
            // Transform into user-friendly error
            const friendlyError = new Error(directData.message || 'Direct authentication failed');
            friendlyError.response = {
              status: directResponse.status,
              data: directData
            };
            throw friendlyError;
          }
          
          if (directData && directData.token) {
            localStorage.setItem('token', directData.token);
            localStorage.setItem('user', JSON.stringify(directData.user || directData));
            
            // Switch API base URL to HTTP for future requests
            switchToProtocol('http');
            
            return { data: directData };
          }
        }
        
        // If we get here, both attempts failed
        throw initialError;
      }
    } catch (err) {
      throw err;
    }
  },
  
  // Rest of auth API methods...
  logout: () => {
    // Clear authentication data
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    // Dispatch a storage event to notify components
    window.dispatchEvent(new Event('storage'));
    
    // Redirect to login page
    window.location.href = '/login';
  },
  
  // Check if the user is logged in and has a valid token
  isAuthenticated: () => {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    return !!(token && user);
  },
  
  getProfile: () => api.get('/api/auth/me'),
  updateProfile: (data) => api.put('/api/auth/me', data),
  updateProfileWithImage: (formData) => api.put('/api/auth/me/image', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  }),
  changePassword: (data) => api.put('/api/users/password', data),
  resetPassword: (email) => api.post('/api/auth/reset-password', { email }),
  verifyResetToken: (token) => api.get(`/api/auth/reset-password/${token}`),
  setNewPassword: (token, password) => api.post(`/api/auth/reset-password/${token}`, { password }),
  regenerateDeviceToken: () => api.post('/api/users/regenerate-token'),
  
  // Direct HTTP login for debug purposes
  directLogin: async (credentials) => {
    try {
      const directUrl = `${config.directApiUrl}/api/direct-login`;
      
      const response = await axios({
        url: '/api/direct-login',
        method: 'post',
        data: credentials,
        baseURL: config.directApiUrl,
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
        // This will prevent the network error from being logged to console
        validateStatus: () => true
      });
      
      if (response.data && response.data.token) {
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user || response.data));
        
        // Switch API base URL to HTTP for future requests
        switchToProtocol('http');
      }
      
      return response;
    } catch (err) {
      throw err;
    }
  },
  
  // Create default admin if needed
  createDefaultAdmin: async () => {
    try {
      const url = `${config.directApiUrl}/api/debug/users?createAdmin=true`;
      return await axios.get(url);
    } catch (err) {
      throw err;
    }
  },
  
  // Get user status 
  getUserStatus: async () => {
    try {
      const url = `${config.directApiUrl}/api/debug/users`;
      return await axios.get(url);
    } catch (err) {
      throw err;
    }
  }
};

// Prediction API calls
// Prediction endpoints support new 9-parameter urine analysis:
// ph, tds, specificGravity, turbidityNTU, red, green, blue, turbidityLevel, warnaDasar
// Backend validates ranges and converts to 5 ML features for V2 model
export const predictionAPI = {
  getAllPredictions: () => api.get('/api/predict'),
  getPrediction: (id) => api.get(`/api/predict/${id}`),
  getStats: () => api.get('/api/predict/stats'),
  
  // Get user prediction history
  getHistory: () => api.get('/api/predict/history'),
    
  // Admin-only endpoints
  admin: {
    getAllPredictions: (page = 1, limit = 50) => api.get(`/api/admin/predictions?page=${page}&limit=${limit}`),
    getUserPredictions: (userId, page = 1, limit = 20) => api.get(`/api/admin/predictions/user/${userId}?page=${page}&limit=${limit}`),
    getGlobalStats: () => api.get('/api/admin/stats')
  },
    
  // Fallback direct history method 
  getHistoryDirect: () => {
    const directUrl = config.directApiUrl || config.apiUrl;
    return axios.get(`${directUrl}/api/predict/history`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json',
        'user-id': JSON.parse(localStorage.getItem('user') || '{}').id
      }
    });
  },
  
  // Submit values for prediction
  submitValues: async (data) => {
    try {
      return await api.post('/api/predict', data);
    } catch (err) {
      throw err;
    }
  },

  // Submit CSV for prediction
  submitCSV: async (formData, onUploadProgress) => {
    try {
      // Configuration for CSV file upload with extended timeout
      const config = {
        timeout: 60000, // 60 seconds timeout for large files
        // Let axios automatically set Content-Type with correct boundary parameter
        // The request interceptor will remove any manual Content-Type header for FormData
      };
      
      // Add upload progress callback if provided
      if (onUploadProgress && typeof onUploadProgress === 'function') {
        config.onUploadProgress = onUploadProgress;
      }
      
      return await api.post('/api/predict/csv', formData, config);
    } catch (err) {
      // Enhanced error handling for common CSV upload errors
      if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
        // Timeout error
        const timeoutError = new Error('Upload timed out. The file may be too large or the server is not responding.');
        timeoutError.response = { status: 408, data: { message: timeoutError.message } };
        throw timeoutError;
      } else if (err.response) {
        // HTTP error response from server
        const status = err.response.status;
        const data = err.response.data;
        
        // Add structured error information
        const structuredError = new Error(data.message || err.message);
        structuredError.response = err.response;
        structuredError.status = status;
        structuredError.validationErrors = data.errors || [];
        
        throw structuredError;
      } else if (err.request) {
        // Network error (request made but no response)
        const networkError = new Error('Network error. Please check your internet connection and try again.');
        networkError.isNetworkError = true;
        throw networkError;
      }
      
      throw err;
    }
  },
  
  // Validate CSV file before upload (client-side validation)
  validateCSVFormat: (file) => {
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const ALLOWED_EXTENSIONS = ['.csv'];
    const ALLOWED_MIME_TYPES = ['text/csv', 'application/vnd.ms-excel', 'text/plain'];
    
    // Check if file exists
    if (!file) {
      return { 
        valid: false, 
        error: 'No file provided' 
      };
    }
    
    // Check file extension
    const fileName = file.name.toLowerCase();
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext));
    if (!hasValidExtension) {
      return { 
        valid: false, 
        error: 'Invalid file extension. Only .csv files are allowed' 
      };
    }
    
    // Check MIME type if available
    if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
      return { 
        valid: false, 
        error: `Invalid MIME type: ${file.type}. Expected text/csv or application/vnd.ms-excel` 
      };
    }
    
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      const maxSizeMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
      return { 
        valid: false, 
        error: `File size (${sizeMB}MB) exceeds maximum allowed size of ${maxSizeMB}MB` 
      };
    }
    
    // Check if file is empty
    if (file.size === 0) {
      return { 
        valid: false, 
        error: 'File is empty' 
      };
    }
    
    // All validations passed
    return { 
      valid: true, 
      error: null,
      fileInfo: {
        name: file.name,
        size: file.size,
        type: file.type || 'unknown',
        sizeMB: (file.size / (1024 * 1024)).toFixed(2)
      }
    };
  },
  
  // Submit parameters for prediction
  submitParameters: async (data) => {
    try {
      return await api.post('/api/predict', { parameters: data });
    } catch (err) {
      throw err;
    }
  },
  
  // Test connection to API endpoint
  testConnection: async () => {
    const results = { timestamp: new Date().toISOString(), services: {} };
    
    // Try HTTP first, then HTTPS
    try {
      const httpUrl = config.directApiUrl;
      const response = await axios.get(`${httpUrl}/api/health`);
      results.services.http = {
        status: response.status,
        data: response.data
      };
    } catch (err) {
      results.services.http = { error: err.message };
    }
    
    // Try HTTPS
    try {
      const httpsUrl = config.apiUrl;
      const response = await axios.get(`${httpsUrl}/api/health`, { 
        validateStatus: () => true 
      });
      results.services.https = {
            status: response.status,
            data: response.data
      };
    } catch (err) {
      results.services.https = { error: err.message };
    }
    
    // Return the results
    return results;
        }
};

// Admin API calls
export const adminAPI = {
  // User management
  getAllUsers: () => api.get('/api/admin/users'),
  getUsers: () => api.get('/api/admin/users'),
  getUser: (id) => api.get(`/api/admin/users/${id}`),
  createUser: (userData) => api.post('/api/admin/users', userData),
  updateUser: (id, userData) => api.put(`/api/admin/users/${id}`, userData),
  updateUserRole: (id, role) => api.put(`/api/admin/users/${id}/role`, { role }),
  deleteUser: async (id) => {
    try {
      // Make sure the id is properly formatted
      if (!id) {
        throw new Error('User ID is required for deletion');
      }
      
      // Send the delete request
      const response = await api.delete(`/api/admin/users/${id}`);
      return response;
    } catch (error) {
      throw error;
    }
  },
  resetPassword: (id) => api.post(`/api/admin/users/${id}/reset-password`),
  
  // Statistics
  getStats: () => api.get('/api/admin/stats'),
  
  // ML Models management
  getModels: () => api.get('/api/admin/models'),
  getModel: (id) => api.get(`/api/admin/models/${id}`),
  createModel: (formData) => {
    // Create a new axios instance with the correct headers for file upload
    const uploadApi = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 30000,
      withCredentials: false,
    });

    // Add auth token if available
    const token = localStorage.getItem('token');
    if (token) {
      uploadApi.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }

    // Add user-id header if available
    const userData = JSON.parse(localStorage.getItem('user') || '{}');
    if (userData && userData.id) {
      uploadApi.defaults.headers.common['user-id'] = userData.id;
    }

    return uploadApi.post('/api/admin/models', formData);
  },
  updateModelStatus: (modelId, active) => api.put(`/api/admin/models/${modelId}/status`, { active }),
  updateModelAccuracy: (modelId, accuracy) => api.put(`/api/admin/models/${modelId}/accuracy`, { accuracy }),
  updateModelName: (modelId, name) => api.put(`/api/admin/models/${modelId}/name`, { name }),
  updateModelVersion: (modelId, version) => api.put(`/api/admin/models/${modelId}/version`, { version }),
  updateModelDescription: (modelId, description) => api.put(`/api/admin/models/${modelId}/description`, { description })
};

// Debug API calls
export const debugAPI = {
  // System information
  getSystemInfo: () => api.get('/api/debug/system'),
  testEcho: () => api.get('/api/debug/echo'),
  
  // Test connections with different protocols
  testHttps: async () => {
    try {
      return await axios.get(`${config.apiUrl}/api/health`, { 
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 5000,
        validateStatus: () => true 
      });
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },
  
  testHttp: async () => {
    try {
      return await axios.get(`${config.directApiUrl}/api/health`, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 5000,
        validateStatus: () => true
      });
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },
  
  // Switch protocol for the API
  switchProtocol: (protocol) => {
    return switchToProtocol(protocol);
  }
};

// ML API calls
export const mlAPI = {
  // Get models from ML service - retrieves models directly from MongoDB
  getModels: () => api.get('/api/ml/models'),
  
  // Get specific model information - retrieves from MongoDB
  getModel: (modelId) => api.get(`/api/ml/model/${modelId}`),
  
  // Get model metrics/performance data
  getModelMetrics: (modelId) => api.get(`/api/ml/models/${modelId}/metrics`),
  
  // Train or retrain a model (admin only)
  trainModel: (trainingData) => api.post('/api/ml/train', trainingData),
  
  // Get prediction history for current user
  getPredictionHistory: () => api.get('/api/ml/history'),
  
  // Update model name
  updateModelName: (modelId, name) => api.put('/api/ml/model/name', { id: modelId, name: name }),
  
  // Update model description
  updateModelDescription: (modelId, description) => api.put('/api/ml/model/description', { id: modelId, description: description }),
  
  // Update model accuracy
  updateModelAccuracy: (modelId, accuracy) => {
    // Ensure accuracy is a number and between 0-1
    const parsedAccuracy = parseFloat(accuracy);
    if (!isNaN(parsedAccuracy)) {
      // If value is > 1, assume it's a percentage and convert to decimal
      const validAccuracy = parsedAccuracy > 1 ? parsedAccuracy / 100 : parsedAccuracy;
      return api.put('/api/ml/model/accuracy', { id: modelId, accuracy: validAccuracy });
    }
    return api.put('/api/ml/model/accuracy', { id: modelId, accuracy: accuracy });
  },
  
  // Update model version
  updateModelVersion: (modelId, version) => api.put('/api/ml/model/version', { id: modelId, version: version }),
  
  // Update model status
  updateModelStatus: (modelId, active) => api.put('/api/ml/model/status', { id: modelId, active: active }),
  
  // Delete a model
  deleteModel: (modelId) => api.delete(`/api/ml/model/${modelId}`),
  
  // Get auto-uploaded data from devices
  getAutoData: (params = {}) => api.get('/api/ml/autodata', { params }),
  
  // Send auto data from a device (requires device token)
  sendAutoData: (data, deviceToken) => api.post('/api/ml/autoupload', data, {
    headers: {
      'device-token': deviceToken
    }
  }),
  
  // Get specific auto data entry
  getAutoDataEntry: (id) => api.get(`/api/ml/autodata/${id}`)
};

// Run a connection test on startup to determine which protocol works best
// Only run in the browser environment
if (typeof window !== 'undefined') {
  testConnections().catch(err => {
    // Connection test failed
  });
}

export default api;