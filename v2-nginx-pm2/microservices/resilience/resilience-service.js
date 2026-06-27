/**
 * Resilience Service - Centralized resilience patterns for inter-service communication
 * Provides: Circuit Breaker, Retry with Exponential Backoff, Request Queuing, Timeout Management
 */

const fetch = require('node-fetch');
const { AbortController } = require('abort-controller');

// ===== CIRCUIT BREAKER CLASS =====
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.timeout = options.timeout || 30000; // 30 seconds
    this.name = options.name || 'circuit-breaker';
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
  }
  
  recordSuccess() {
    this.failureCount = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      console.log(`[${this.name}] HALF_OPEN: Success ${this.successCount}/${this.successThreshold}`);
      
      if (this.successCount >= this.successThreshold) {
        this.setState('CLOSED');
        this.successCount = 0;
      }
    }
  }
  
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.state === 'HALF_OPEN') {
      this.setState('OPEN');
      this.nextAttempt = Date.now() + this.timeout;
      this.successCount = 0;
      console.log(`[${this.name}] HALF_OPEN test failed, returning to OPEN`);
    } else if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      this.setState('OPEN');
      this.nextAttempt = Date.now() + this.timeout;
      console.log(`[${this.name}] Threshold reached (${this.failureCount} failures), opening circuit`);
    }
  }
  
  canAttempt() {
    if (this.state === 'CLOSED') {
      return true;
    }
    
    if (this.state === 'OPEN') {
      if (Date.now() >= this.nextAttempt) {
        this.setState('HALF_OPEN');
        this.successCount = 0;
        console.log(`[${this.name}] Timeout expired, entering HALF_OPEN state`);
        return true;
      }
      return false;
    }
    
    // HALF_OPEN state
    return true;
  }
  
  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    console.log(`[${this.name}] Circuit breaker state changed: ${oldState} → ${newState}`);
  }
  
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      nextAttempt: this.state === 'OPEN' ? this.nextAttempt : null
    };
  }
  
  reset() {
    this.setState('CLOSED');
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    console.log(`[${this.name}] Circuit breaker manually reset`);
  }
}

// ===== REQUEST QUEUE CLASS =====
class RequestQueue {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 100;
    this.maxWaiting = options.maxWaiting !== undefined ? options.maxWaiting : Infinity;
    this.name = options.name || 'request-queue';
    this.currentCount = 0;
    this.waitingQueue = [];
  }

  async acquire() {
    if (this.currentCount < this.maxConcurrent) {
      this.currentCount++;
      return;
    }

    // Reject immediately if the wait queue is full — prevents unbounded backlog buildup
    if (this.waitingQueue.length >= this.maxWaiting) {
      const err = new Error(`[${this.name}] Prediction queue full (${this.currentCount} active, ${this.waitingQueue.length} waiting) — shedding load`);
      err.statusCode = 503;
      err.isQueueOverflow = true;
      throw err;
    }

    // Wait for available slot
    console.log(`[${this.name}] Queue full (${this.currentCount}/${this.maxConcurrent}), waiting (${this.waitingQueue.length + 1}/${this.maxWaiting})...`);

    return new Promise((resolve) => {
      this.waitingQueue.push(resolve);
    });
  }
  
  release() {
    this.currentCount--;
    
    if (this.waitingQueue.length > 0) {
      const next = this.waitingQueue.shift();
      this.currentCount++;
      next();
    }
  }
  
  getStats() {
    return {
      current: this.currentCount,
      max: this.maxConcurrent,
      waiting: this.waitingQueue.length
    };
  }
}

// ===== CUSTOM ERROR CLASSES =====
class TimeoutError extends Error {
  constructor(message, serviceName, timeoutMs) {
    super(message);
    this.name = 'TimeoutError';
    this.serviceName = serviceName;
    this.timeoutMs = timeoutMs;
    this.statusCode = 504;
    this.retryable = true;
  }
}

class ServiceUnavailableError extends Error {
  constructor(message, serviceName, circuitBreakerState) {
    super(message);
    this.name = 'ServiceUnavailableError';
    this.serviceName = serviceName;
    this.circuitBreakerState = circuitBreakerState;
    this.statusCode = 503;
    this.retryable = false;
  }
}

class RetryExhaustedError extends Error {
  constructor(message, serviceName, attempts, originalError) {
    super(message);
    this.name = 'RetryExhaustedError';
    this.serviceName = serviceName;
    this.attempts = attempts;
    this.originalError = originalError;
    this.statusCode = 503;
    this.retryable = false;
  }
}

class NetworkError extends Error {
  constructor(message, serviceName, originalError) {
    super(message);
    this.name = 'NetworkError';
    this.serviceName = serviceName;
    this.originalError = originalError;
    this.statusCode = 503;
    this.retryable = true;
  }
}

// ===== RETRY WITH EXPONENTIAL BACKOFF =====
async function retryWithBackoff(fn, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const baseDelay = options.baseDelay || 200;
  const maxDelay = options.maxDelay || 5000;
  const serviceName = options.serviceName || 'unknown-service';
  
  let lastError = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      
      if (attempt > 0) {
        console.log(`[RETRY] ${serviceName}: Succeeded on attempt ${attempt + 1}`);
      }
      
      return result;
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      const isRetryable = isErrorRetryable(error);
      
      if (!isRetryable || attempt === maxRetries) {
        if (attempt === maxRetries) {
          console.log(`[RETRY] ${serviceName}: Max retries (${maxRetries}) exhausted`);
          throw new RetryExhaustedError(
            `Failed after ${maxRetries + 1} attempts`,
            serviceName,
            maxRetries + 1,
            error
          );
        }
        throw error;
      }
      
      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = Math.random() * 200; // 0-200ms jitter
      const delay = exponentialDelay + jitter;
      
      console.log(`[RETRY] ${serviceName}: Attempt ${attempt + 1} failed (${error.message}), retrying in ${Math.round(delay)}ms...`);
      
      await sleep(delay);
    }
  }
  
  throw lastError;
}

function isErrorRetryable(error) {
  // Network errors
  if (error.code === 'ECONNREFUSED' || 
      error.code === 'ETIMEDOUT' || 
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNRESET') {
    return true;
  }
  
  // Timeout errors
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return true;
  }
  
  // HTTP status codes
  if (error.statusCode) {
    // Retry on 5xx server errors
    if (error.statusCode >= 500 && error.statusCode < 600) {
      return true;
    }
    
    // Retry on 408 (Request Timeout) and 429 (Too Many Requests)
    if (error.statusCode === 408 || error.statusCode === 429) {
      return true;
    }
    
    // Don't retry 4xx client errors (except 408, 429)
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return false;
    }
  }
  
  // Empty response (service initializing)
  if (error.message && error.message.includes('empty response')) {
    return true;
  }
  
  // Default: retry
  return true;
}

// ===== TIMEOUT WRAPPER =====
async function withTimeout(fn, timeoutMs, serviceName) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const result = await fn(controller.signal);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new TimeoutError(
        `Request timed out after ${timeoutMs}ms`,
        serviceName,
        timeoutMs
      );
    }
    
    throw error;
  }
}

// ===== SERVICE CALL WITH RESILIENCE =====
async function callServiceWithResilience(config) {
  const {
    url,
    method = 'GET',
    headers = {},
    body = null,
    serviceName,
    timeout = 5000,
    maxRetries = 3,
    circuitBreaker,
    queue
  } = config;
  
  // Check circuit breaker
  if (circuitBreaker && !circuitBreaker.canAttempt()) {
    const state = circuitBreaker.getState();
    throw new ServiceUnavailableError(
      `Service circuit breaker is ${state.state}`,
      serviceName,
      state.state
    );
  }
  
  // Acquire queue slot
  if (queue) {
    await queue.acquire();
  }
  
  try {
    // Make request with retry and timeout
    const result = await retryWithBackoff(
      async () => {
        return await withTimeout(
          async (signal) => {
            const response = await fetch(url, {
              method,
              headers,
              body,
              signal
            });
            
            // Check for error status codes
            if (!response.ok) {
              const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
              error.statusCode = response.status;
              error.response = response;
              throw error;
            }
            
            return response;
          },
          timeout,
          serviceName
        );
      },
      { maxRetries, serviceName }
    );
    
    // Record success
    if (circuitBreaker) {
      circuitBreaker.recordSuccess();
    }
    
    return result;
  } catch (error) {
    // Record failure
    if (circuitBreaker) {
      circuitBreaker.recordFailure();
    }
    
    throw error;
  } finally {
    // Release queue slot
    if (queue) {
      queue.release();
    }
  }
}

// ===== SERVICE REGISTRY =====
const serviceRegistry = {
  services: {},
  
  getService(name) {
    if (!this.services[name]) {
      // Create service configuration
      const timeouts = {
        'user-service': 5000,
        'prediction-service': 30000,
        'ml-service': 10000,
        'admin-service': 10000
      };
      
      this.services[name] = {
        circuitBreaker: new CircuitBreaker({ name: `${name}-cb` }),
        queue: new RequestQueue({ name: `${name}-queue`, maxConcurrent: 100 }),
        timeout: timeouts[name] || 5000
      };
      
      console.log(`[SERVICE-REGISTRY] Created service configuration for ${name}`);
    }
    
    return this.services[name];
  },
  
  getStats() {
    const stats = {};
    
    for (const [name, service] of Object.entries(this.services)) {
      stats[name] = {
        circuitBreaker: service.circuitBreaker.getState(),
        queue: service.queue.getStats(),
        timeout: service.timeout
      };
    }
    
    return stats;
  },
  
  resetService(name) {
    const service = this.services[name];
    if (service) {
      service.circuitBreaker.reset();
      console.log(`[SERVICE-REGISTRY] Reset circuit breaker for ${name}`);
      return true;
    }
    return false;
  },
  
  resetAll() {
    for (const [name, service] of Object.entries(this.services)) {
      service.circuitBreaker.reset();
    }
    console.log(`[SERVICE-REGISTRY] Reset all circuit breakers`);
  }
};

// ===== UTILITY FUNCTIONS =====
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== EXPORTS =====
module.exports = {
  callServiceWithResilience,
  CircuitBreaker,
  RequestQueue,
  retryWithBackoff,
  withTimeout,
  serviceRegistry,
  // Error classes
  TimeoutError,
  ServiceUnavailableError,
  RetryExhaustedError,
  NetworkError
};
