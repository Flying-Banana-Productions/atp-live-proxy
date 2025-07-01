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
        const normalizedKey = this.normalizeKey(key);
        console.log(`[CACHE EXPIRED] key: ${normalizedKey}`);
      });
    }
  }

  /**
   * Normalize the cache key to always include '/api' prefix if not present
   * @param {string} key - The cache key
   * @returns {string} Normalized cache key
   */
  normalizeKey(key) {
    if (!key.startsWith('/api/')) {
      // If it starts with '/api', leave as is; otherwise, add '/api' prefix
      if (key.startsWith('/')) {
        return `/api${key}`;
      } else {
        return `/api/${key}`;
      }
    }
    return key;
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or undefined if not found
   */
  get(key) {
    const normalizedKey = this.normalizeKey(key);
    const value = this.cache.get(normalizedKey);
    if (config.server.nodeEnv === 'development') {
      console.log(`[CACHE GET] key: ${normalizedKey} | hit: ${value !== undefined}`);
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
    const normalizedKey = this.normalizeKey(key);
    const cacheTtl = ttl || config.cache.ttl;
    this.cache.set(normalizedKey, value, cacheTtl);
    if (config.server.nodeEnv === 'development') {
      console.log(`[CACHE SET] key: ${normalizedKey} | ttl: ${cacheTtl}`);
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
    // Always use the normalized endpoint for the cache key
    return this.normalizeKey(`${endpoint}${sortedParams ? `?${sortedParams}` : ''}`);
  }
}

module.exports = new CacheService(); 