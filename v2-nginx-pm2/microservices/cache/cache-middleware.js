/**
 * Express Middleware for Cache Integration
 * Provides reusable middleware functions for caching HTTP responses
 */

const { generateKey } = require('./cache-service');

/**
 * Extract user ID from request
 * @param {object} req - Express request object
 * @returns {string} User ID or empty string
 */
function extractUserId(req) {
  return req.user?.id || req.user?._id?.toString() || req.headers['user-id'] || '';
}

/**
 * Generate cache key from request
 * @param {object} req - Express request object
 * @param {boolean} includeUserId - Whether to include user ID
 * @param {boolean} includeQuery - Whether to include query params
 * @returns {string} Cache key
 */
function generateCacheKey(req, includeUserId = true, includeQuery = true) {
  const path = req.path || req.url;
  const userId = includeUserId ? extractUserId(req) : '';
  const queryParams = includeQuery ? req.query : {};
  
  return generateKey(path, userId, queryParams);
}

/**
 * Check if response should be cached
 * @param {object} res - Express response object
 * @returns {boolean}
 */
function shouldCacheResponse(res) {
  const status = res.statusCode;
  return status >= 200 && status < 300;
}

/**
 * Cache Middleware Factory
 * Creates middleware that caches GET request responses
 * 
 * @param {object} cacheInstance - Cache instance to use
 * @param {object} options - Configuration options
 * @param {number} options.ttl - Time to live in milliseconds
 * @param {function} options.keyGenerator - Custom key generator function
 * @param {function} options.shouldCache - Custom function to determine if response should be cached
 * @param {boolean} options.includeQuery - Whether to include query params in cache key (default: true)
 * @param {boolean} options.includeUserId - Whether to include user ID in cache key (default: true)
 * @returns {function} Express middleware
 */
function cacheMiddleware(cacheInstance, options = {}) {
  const {
    ttl = cacheInstance.defaultTTL,
    keyGenerator = generateCacheKey,
    shouldCache = shouldCacheResponse,
    includeQuery = true,
    includeUserId = true
  } = options;
  
  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }
    
    try {
      // Generate cache key
      const cacheKey = keyGenerator(req, includeUserId, includeQuery);
      
      // Check cache for existing response
      const cachedData = cacheInstance.get(cacheKey);
      
      if (cachedData !== undefined) {
        // Cache hit - return cached response
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Key', cacheKey);
        return res.json(cachedData);
      }
      
      // Cache miss - intercept response to cache it
      const originalJson = res.json.bind(res);
      
      res.json = function(data) {
        // Check if response should be cached
        if (shouldCache(res)) {
          try {
            cacheInstance.set(cacheKey, data, ttl);
            res.setHeader('X-Cache', 'MISS');
            res.setHeader('X-Cache-Key', cacheKey);
          } catch (error) {
            console.error(`[CACHE-MIDDLEWARE] Error caching response:`, error.message);
          }
        } else {
          res.setHeader('X-Cache', 'SKIP');
        }
        
        return originalJson(data);
      };
      
      next();
    } catch (error) {
      console.error(`[CACHE-MIDDLEWARE] Error in cache middleware:`, error.message);
      // Graceful degradation - continue without caching
      next();
    }
  };
}

/**
 * Cache Invalidation Middleware
 * Invalidates cache entries after successful operations
 * 
 * @param {object} cacheInstance - Cache instance to invalidate
 * @param {object} options - Configuration options
 * @param {array} options.keys - Specific keys to invalidate
 * @param {RegExp} options.pattern - Pattern to match keys for bulk invalidation
 * @param {function} options.keyGenerator - Function to generate keys from request
 * @returns {function} Express middleware
 */
function invalidateCacheMiddleware(cacheInstance, options = {}) {
  const {
    keys = [],
    pattern = null,
    keyGenerator = null
  } = options;
  
  return (req, res, next) => {
    // Hook into response finish event
    res.on('finish', () => {
      // Only invalidate on successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          // Invalidate specific keys
          if (keys.length > 0) {
            keys.forEach(key => {
              cacheInstance.delete(key);
            });
          }
          
          // Invalidate by pattern
          if (pattern) {
            cacheInstance.invalidatePattern(pattern);
          }
          
          // Invalidate using key generator
          if (keyGenerator && typeof keyGenerator === 'function') {
            const keysToInvalidate = keyGenerator(req);
            if (Array.isArray(keysToInvalidate)) {
              keysToInvalidate.forEach(key => {
                cacheInstance.delete(key);
              });
            } else if (typeof keysToInvalidate === 'string') {
              cacheInstance.delete(keysToInvalidate);
            }
          }
        } catch (error) {
          console.error(`[CACHE-INVALIDATION] Error invalidating cache:`, error.message);
        }
      }
    });
    
    next();
  };
}

/**
 * Cache Statistics Middleware
 * Returns statistics for one or more cache instances
 * 
 * @param {object} cacheInstances - Object with cache instances { cacheName: cacheInstance }
 * @returns {function} Express middleware
 */
function cacheStatsMiddleware(cacheInstances) {
  return (req, res) => {
    try {
      const timestamp = new Date().toISOString();
      const stats = {};
      
      let totalHits = 0;
      let totalMisses = 0;
      let totalSize = 0;
      
      // Collect stats from each cache instance
      for (const [name, cache] of Object.entries(cacheInstances)) {
        const cacheStats = cache.getStats();
        stats[name] = cacheStats;
        
        totalHits += cacheStats.hits;
        totalMisses += cacheStats.misses;
        totalSize += cacheStats.size;
      }
      
      // Calculate overall statistics
      const totalRequests = totalHits + totalMisses;
      const overallHitRate = totalRequests > 0 
        ? ((totalHits / totalRequests) * 100).toFixed(2) 
        : 0;
      
      const response = {
        success: true,
        timestamp,
        caches: stats,
        overall: {
          totalHits,
          totalMisses,
          totalRequests,
          overallHitRate: `${overallHitRate}%`,
          totalSize
        }
      };
      
      res.json(response);
    } catch (error) {
      console.error(`[CACHE-STATS] Error generating statistics:`, error.message);
      res.status(500).json({
        success: false,
        message: 'Error generating cache statistics',
        error: error.message
      });
    }
  };
}

module.exports = {
  cacheMiddleware,
  invalidateCacheMiddleware,
  cacheStatsMiddleware,
  generateCacheKey,
  shouldCacheResponse,
  extractUserId
};
