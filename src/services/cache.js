const NodeCache = require('node-cache');
const config = require('../config');

class CacheService {
  constructor() {
    this.cache = new NodeCache({
      stdTTL: config.cache.ttl,
      checkperiod: config.cache.checkPeriod,
      useClones: false,
    });

    // Log cache events in development
    if (config.server.nodeEnv === 'development') {
      this.cache.on('expired', (key, _value) => {
        console.log(`[CACHE EXPIRED] key: ${key}`);
      });
    }
  }



  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or undefined if not found
   */
  get(key) {
    const value = this.cache.get(key);
    if (config.server.nodeEnv === 'development') {
      console.log(`[CACHE GET] key: ${key} | hit: ${value !== undefined}`);
    }
    return value;
  }

  /**
   * Set a value in cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - Time to live in seconds (optional, uses default if not provided)
   */
  set(key, value, ttl = null) {
    const cacheTtl = ttl || config.cache.ttl;
    this.cache.set(key, value, cacheTtl);
    if (config.server.nodeEnv === 'development') {
      console.log(`[CACHE SET] key: ${key} | ttl: ${cacheTtl}`);
    }
  }

  /**
   * Delete a value from cache
   * @param {string} key - Cache key
   */
  del(key) {
    this.cache.del(key);
  }

  /**
   * Clear all cache
   */
  flush() {
    this.cache.flushAll();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    return this.cache.getStats();
  }

  /**
   * Generate a cache key from request parameters
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Query parameters
   * @returns {string} Generated cache key
   */
  generateKey(endpoint, params = {}) {
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('&');
    return `${endpoint}${sortedParams ? `?${sortedParams}` : ''}`;
  }
}

module.exports = new CacheService(); 