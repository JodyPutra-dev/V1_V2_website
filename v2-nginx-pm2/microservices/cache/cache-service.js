/**
 * In-Memory LRU Cache Service
 * Provides caching functionality for microservices with TTL-based expiration
 * and Least Recently Used (LRU) eviction policy.
 */

class LRUCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTTL = options.defaultTTL || 5 * 60 * 1000; // 5 minutes default
    this.name = options.name || 'cache';
    
    // Main storage: key -> { value, expiry, createdAt, accessCount }
    this.cache = new Map();
    
    // Access order tracking: key -> timestamp (for LRU)
    this.accessOrder = new Map();
    
    // Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      createdAt: Date.now()
    };
    
    // Start background cleanup for expired entries
    this.startCleanupInterval();
    
    console.log(`[${this.name}] Cache initialized: maxSize=${this.maxSize}, defaultTTL=${this.defaultTTL}ms`);
  }
  
  /**
   * Store a value in cache with optional TTL
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - Time to live in milliseconds (optional)
   */
  set(key, value, ttl = this.defaultTTL) {
    // Check if we need to evict least recently used item
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }
    
    const expiry = Date.now() + ttl;
    const entry = {
      value,
      expiry,
      createdAt: Date.now(),
      accessCount: 0
    };
    
    this.cache.set(key, entry);
    this.accessOrder.set(key, Date.now());
    
    console.log(`[${this.name}] SET: ${key} (TTL: ${ttl}ms, Size: ${this.cache.size}/${this.maxSize})`);
  }
  
  /**
   * Retrieve a value from cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or undefined if not found/expired
   */
  get(key) {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      console.log(`[${this.name}] MISS: ${key} (not found)`);
      return undefined;
    }
    
    // Check if expired
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.accessOrder.delete(key);
      this.stats.misses++;
      console.log(`[${this.name}] MISS: ${key} (expired)`);
      return undefined;
    }
    
    // Update access time for LRU
    this.accessOrder.set(key, Date.now());
    entry.accessCount++;
    this.stats.hits++;
    
    console.log(`[${this.name}] HIT: ${key} (age: ${Date.now() - entry.createdAt}ms, accesses: ${entry.accessCount})`);
    return entry.value;
  }
  
  /**
   * Check if key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.accessOrder.delete(key);
      return false;
    }
    
    return true;
  }
  
  /**
   * Delete a specific cache entry
   * @param {string} key - Cache key
   * @returns {boolean} True if deleted, false if not found
   */
  delete(key) {
    const deleted = this.cache.delete(key);
    this.accessOrder.delete(key);
    
    if (deleted) {
      console.log(`[${this.name}] DELETE: ${key} (Size: ${this.cache.size}/${this.maxSize})`);
    }
    
    return deleted;
  }
  
  /**
   * Clear all cache entries
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.accessOrder.clear();
    console.log(`[${this.name}] CLEAR: Removed ${size} entries`);
  }
  
  /**
   * Invalidate entries matching a pattern
   * @param {RegExp} pattern - Regular expression to match keys
   * @returns {number} Number of entries invalidated
   */
  invalidatePattern(pattern) {
    let count = 0;
    
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.delete(key);
        count++;
      }
    }
    
    console.log(`[${this.name}] INVALIDATE_PATTERN: ${pattern} removed ${count} entries`);
    return count;
  }
  
  /**
   * Evict least recently used item
   */
  evictLRU() {
    // Find oldest accessed key
    let oldestKey = null;
    let oldestTime = Infinity;
    
    for (const [key, time] of this.accessOrder.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.accessOrder.delete(oldestKey);
      this.stats.evictions++;
      console.log(`[${this.name}] EVICT_LRU: ${oldestKey} (age: ${Date.now() - oldestTime}ms)`);
    }
  }
  
  /**
   * Get cache statistics
   * @returns {object} Statistics object
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests * 100).toFixed(2) : 0;
    const uptime = Date.now() - this.stats.createdAt;
    
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: `${hitRate}%`,
      hitRateNumeric: parseFloat(hitRate),
      size: this.cache.size,
      maxSize: this.maxSize,
      evictions: this.stats.evictions,
      uptime: `${Math.floor(uptime / 1000)}s`,
      uptimeMs: uptime
    };
  }
  
  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      createdAt: Date.now()
    };
    console.log(`[${this.name}] Statistics reset`);
  }
  
  /**
   * Get current cache size
   */
  get size() {
    return this.cache.size;
  }
  
  /**
   * Start background cleanup interval for expired entries
   */
  startCleanupInterval() {
    this.cleanupInterval = setInterval(() => {
      let cleaned = 0;
      const now = Date.now();
      
      for (const [key, entry] of this.cache.entries()) {
        if (now > entry.expiry) {
          this.cache.delete(key);
          this.accessOrder.delete(key);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        console.log(`[${this.name}] CLEANUP: Removed ${cleaned} expired entries (Size: ${this.cache.size}/${this.maxSize})`);
      }
    }, 60000); // Run every 60 seconds
    
    // Prevent interval from keeping process alive
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }
  
  /**
   * Stop background cleanup interval
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

/**
 * Generate cache key from request components
 * @param {string} path - Request path
 * @param {string} userId - User ID (optional)
 * @param {object} queryParams - Query parameters (optional)
 * @returns {string} Cache key
 */
function generateKey(path, userId = '', queryParams = {}) {
  // Sort query params for consistent keys
  const sortedQuery = Object.keys(queryParams)
    .sort()
    .map(key => `${key}=${queryParams[key]}`)
    .join('&');
  
  const query = sortedQuery ? `?${sortedQuery}` : '';
  return `${path}:${userId}:${query}`;
}

// Create cache instances for different data types
const userCache = new LRUCache({
  name: 'USER_CACHE',
  maxSize: 500,
  defaultTTL: 5 * 60 * 1000 // 5 minutes
});

const modelCache = new LRUCache({
  name: 'MODEL_CACHE',
  maxSize: 100,
  defaultTTL: 10 * 60 * 1000 // 10 minutes
});

const adminCache = new LRUCache({
  name: 'ADMIN_CACHE',
  maxSize: 50,
  defaultTTL: 2 * 60 * 1000 // 2 minutes
});

// Export cache instances and utilities
module.exports = {
  LRUCache,
  userCache,
  modelCache,
  adminCache,
  generateKey
};
