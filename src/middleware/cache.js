const cacheService = require('../services/cache');
const config = require('../config');

/**
 * Get the appropriate TTL for a given endpoint
 * @param {string} path - Request path
 * @param {number} defaultTtl - Default TTL to use if no endpoint-specific TTL is found
 * @returns {number} TTL in seconds
 */
function getEndpointTtl(path, defaultTtl = null) {
  const defaultCacheTtl = defaultTtl || config.cache.ttl;
  
  // Try exact path match first
  if (config.cache.endpoints[path]) {
    return config.cache.endpoints[path];
  }
  
  // Try with /api prefix if path doesn't start with /api
  const pathWithApi = path.startsWith('/api/') ? path : `/api${path}`;
  if (config.cache.endpoints[pathWithApi]) {
    return config.cache.endpoints[pathWithApi];
  }
  
  // Check for path prefix matches (for endpoints with parameters)
  for (const [endpointPath, ttl] of Object.entries(config.cache.endpoints)) {
    if (path.startsWith(endpointPath) || pathWithApi.startsWith(endpointPath)) {
      return ttl;
    }
  }
  
  return defaultCacheTtl;
}

/**
 * Cache middleware for Express
 * @param {number} ttl - Time to live in seconds (optional, overrides endpoint-specific TTL)
 * @returns {Function} Express middleware function
 */
function cacheMiddleware(ttl = null) {
  return async (req, res, next) => {
    if (req.method !== 'GET') return next();

    const cacheKey = cacheService.generateKey(req.path, req.query);
    const cachedData = cacheService.get(cacheKey);

    if (cachedData) {
      if (config.server.nodeEnv === 'development') {
        console.log(`[CACHE HIT] Returning cached data for: ${cacheKey}`);
      }
      return res.json({
        data: cachedData,
        cached: true,
        timestamp: new Date().toISOString(),
      });
    }

    const originalJson = res.json;
    res.json = function (data) {
      // Only wrap and cache for 2xx responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Get endpoint-specific TTL, or use provided TTL, or fall back to default
        const endpointTtl = ttl !== null ? ttl : getEndpointTtl(req.path);
        cacheService.set(cacheKey, data, endpointTtl);
        
        return originalJson.call(this, {
          data,
          cached: false,
          timestamp: new Date().toISOString(),
        });
      } else {
        // For errors, just send the original response
        return originalJson.call(this, data);
      }
    };

    next();
  };
}



/**
 * Get cache stats middleware
 * @returns {Function} Express middleware function
 */
function cacheStatsMiddleware() {
  return (req, res, next) => {
    if (req.method === 'GET' && req.path === '/api/cache/stats') {
      const stats = cacheService.getStats();
      return res.json({
        stats,
        timestamp: new Date().toISOString(),
      });
    }
    next();
  };
}

module.exports = {
  cacheMiddleware,
  cacheStatsMiddleware,
  getEndpointTtl, // Export for testing and debugging
}; 