/**
 * Compression Middleware - Intelligent compression for JSON responses
 * Uses gzip/deflate based on client Accept-Encoding headers
 */

const zlib = require('zlib');

// Compression statistics
const stats = {
  totalBytesBeforeCompression: 0,
  totalBytesAfterCompression: 0,
  compressedResponses: 0,
  skippedResponses: 0,
  startTime: Date.now()
};

/**
 * Check if response should be compressed
 */
function shouldCompress(req, res, threshold = 1024) {
  // Check if client supports compression
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.match(/\b(gzip|deflate)\b/)) {
    return false;
  }
  
  // Check if response already has Content-Encoding
  if (res.getHeader('Content-Encoding')) {
    return false;
  }
  
  // Check Content-Type (only compress text-based content)
  const contentType = res.getHeader('Content-Type') || '';
  const compressibleTypes = [
    'application/json',
    'text/',
    'application/javascript',
    'application/xml'
  ];
  
  const isCompressible = compressibleTypes.some(type => contentType.includes(type));
  if (!isCompressible) {
    return false;
  }
  
  return true;
}

/**
 * Get best compression encoding supported by client
 */
function getBestEncoding(acceptEncoding) {
  if (acceptEncoding.includes('gzip')) {
    return 'gzip';
  }
  if (acceptEncoding.includes('deflate')) {
    return 'deflate';
  }
  return null;
}

/**
 * Compress data using specified encoding
 */
function compressData(data, encoding, callback) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  
  if (encoding === 'gzip') {
    zlib.gzip(buffer, { level: 6 }, callback);
  } else if (encoding === 'deflate') {
    zlib.deflate(buffer, { level: 6 }, callback);
  } else {
    callback(new Error('Unsupported encoding'), null);
  }
}

/**
 * Create compression middleware
 */
function createCompressionMiddleware(options = {}) {
  const threshold = options.threshold || 1024; // 1KB minimum
  const level = options.level || 6; // Balanced compression
  
  return (req, res, next) => {
    // Store original methods
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    
    // Override res.json()
    res.json = function(data) {
      if (!shouldCompress(req, res, threshold)) {
        stats.skippedResponses++;
        return originalJson(data);
      }
      
      const jsonString = JSON.stringify(data);
      const originalSize = Buffer.byteLength(jsonString);
      
      // Skip compression if below threshold
      if (originalSize < threshold) {
        stats.skippedResponses++;
        return originalJson(data);
      }
      
      const acceptEncoding = req.headers['accept-encoding'] || '';
      const encoding = getBestEncoding(acceptEncoding);
      
      if (!encoding) {
        stats.skippedResponses++;
        return originalJson(data);
      }
      
      // Compress the data
      compressData(jsonString, encoding, (err, compressed) => {
        if (err) {
          console.error('[COMPRESSION] Error compressing response:', err.message);
          stats.skippedResponses++;
          return originalJson(data);
        }
        
        const compressedSize = compressed.length;
        
        // Update statistics
        stats.totalBytesBeforeCompression += originalSize;
        stats.totalBytesAfterCompression += compressedSize;
        stats.compressedResponses++;
        
        const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
        console.log(`[COMPRESSION] ${encoding}: ${originalSize}B → ${compressedSize}B (${ratio}% saved)`);
        
        // Set headers
        res.setHeader('Content-Encoding', encoding);
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Content-Length', compressedSize);
        
        // Send compressed response
        res.type('json');
        res.send(compressed);
      });
    };
    
    // Override res.send()
    res.send = function(data) {
      // Only compress if data looks like JSON or text
      if (typeof data === 'object' || (typeof data === 'string' && data.startsWith('{'))) {
        return res.json(typeof data === 'string' ? JSON.parse(data) : data);
      }
      
      return originalSend(data);
    };
    
    next();
  };
}

/**
 * Create streaming compression for large responses
 */
function createStreamingCompression(encoding) {
  if (encoding === 'gzip') {
    return zlib.createGzip({ level: 6, flush: zlib.Z_SYNC_FLUSH });
  } else if (encoding === 'deflate') {
    return zlib.createDeflate({ level: 6, flush: zlib.Z_SYNC_FLUSH });
  }
  return null;
}

/**
 * Get compression statistics
 */
function getCompressionStats() {
  const totalResponses = stats.compressedResponses + stats.skippedResponses;
  const compressionRatio = stats.totalBytesBeforeCompression > 0
    ? ((1 - stats.totalBytesAfterCompression / stats.totalBytesBeforeCompression) * 100).toFixed(2)
    : 0;
  
  const uptime = Date.now() - stats.startTime;
  
  return {
    compressedResponses: stats.compressedResponses,
    skippedResponses: stats.skippedResponses,
    totalResponses,
    compressionRate: `${((stats.compressedResponses / totalResponses) * 100).toFixed(2)}%`,
    totalBytesBeforeCompression: stats.totalBytesBeforeCompression,
    totalBytesAfterCompression: stats.totalBytesAfterCompression,
    bytesSaved: stats.totalBytesBeforeCompression - stats.totalBytesAfterCompression,
    compressionRatio: `${compressionRatio}%`,
    uptime: `${Math.floor(uptime / 1000)}s`
  };
}

/**
 * Reset compression statistics
 */
function resetCompressionStats() {
  stats.totalBytesBeforeCompression = 0;
  stats.totalBytesAfterCompression = 0;
  stats.compressedResponses = 0;
  stats.skippedResponses = 0;
  stats.startTime = Date.now();
  console.log('[COMPRESSION] Statistics reset');
}

// Export
module.exports = {
  compressionMiddleware: createCompressionMiddleware,
  createStreamingCompression,
  shouldCompress,
  getCompressionStats,
  resetCompressionStats
};
