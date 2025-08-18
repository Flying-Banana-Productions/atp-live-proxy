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
    const cachedData = await cacheService.get(cacheKey);

    if (cachedData) {
      if (config.server.nodeEnv === 'development') {
        console.log(`[CACHE HIT] Returning cached data for: ${cacheKey}`);
      }
      const remainingTtl = await cacheService.getTtl(cacheKey);
      
      // Check if cached data includes status code (for error responses)
      if (cachedData.statusCode && cachedData.data) {
        // Restore original status code for cached error responses
        return res.status(cachedData.statusCode).json({
          data: cachedData.data,
          cached: true,
          timestamp: new Date().toISOString(),
          ttl: remainingTtl,
        });
      }
      
      // For regular cached responses (backward compatibility)
      return res.json({
        data: cachedData,
        cached: true,
        timestamp: new Date().toISOString(),
        ttl: remainingTtl,
      });
    }

    const originalJson = res.json;
    res.json = function (data) {
      // Cache successful responses (2xx) with endpoint-specific TTL
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Get endpoint-specific TTL, or use provided TTL, or fall back to default
        const endpointTtl = ttl !== null ? ttl : getEndpointTtl(req.path);
        
        // Cache asynchronously (don't wait for it)
        cacheService.set(cacheKey, data, endpointTtl).catch(error => {
          console.error(`[CACHE SET ERROR] key: ${cacheKey} | error: ${error.message}`);
        });
        
        return originalJson.call(this, {
          data,
          cached: false,
          timestamp: new Date().toISOString(),
          ttl: endpointTtl,
        });
      } 
      // Cache 404 responses with short TTL to avoid repeated API calls
      else if (res.statusCode === 404) {
        const shortTtl = 60; // 1 minute TTL for 404s
        
        // Cache 404 response with status code
        const cachedResponse = {
          data,
          statusCode: res.statusCode,
          timestamp: new Date().toISOString()
        };
        
        cacheService.set(cacheKey, cachedResponse, shortTtl).catch(error => {
          console.error(`[CACHE SET ERROR] key: ${cacheKey} | error: ${error.message}`);
        });
        
        if (config.server.nodeEnv === 'development') {
          console.log(`[CACHE SET 404] key: ${cacheKey} | ttl: ${shortTtl}`);
        }
        
        return originalJson.call(this, data);
      } 
      else {
        // For other errors, just send the original response without caching
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
  return async (req, res, next) => {
    if (req.method === 'GET' && req.path === '/api/cache/stats') {
      const stats = await cacheService.getStats();
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