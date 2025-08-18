const NodeCache = require('node-cache');
const CacheProvider = require('./cacheProvider');
const config = require('../config');

/**
 * In-memory cache implementation using node-cache
 */
class MemoryCache extends CacheProvider {
  constructor() {
    super();
    this.cache = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the memory cache
   */
  async initialize() {
    this.cache = new NodeCache({
      stdTTL: config.cache.ttl,
      checkperiod: config.cache.checkPeriod,
      useClones: false,
    });

    // Log cache events in development
    if (config.server.nodeEnv === 'development') {
      this.cache.on('expired', (key, _value) => {
        console.log(`[MEMORY CACHE EXPIRED] key: ${key}`);
      });
    }

    this.isInitialized = true;
    console.log('[MEMORY CACHE] Initialized successfully');
  }

  /**
   * Get a value from memory cache
   * @param {string} key - Cache key
   * @returns {Promise<*>} Cached value or null if not found
   */
  async get(key) {
    if (!this.isInitialized || !this.cache) {
      return null;
    }

    const value = this.cache.get(key);
    if (config.server.nodeEnv === 'development') {
      console.log(`[MEMORY CACHE GET] key: ${key} | hit: ${value !== undefined}`);
    }
    return value !== undefined ? value : null;
  }

  /**
   * Set a value in memory cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<boolean>} Success status
   */
  async set(key, value, ttl = null) {
    if (!this.isInitialized || !this.cache) {
      return false;
    }

    try {
      const cacheTtl = ttl || config.cache.ttl;
      const success = this.cache.set(key, value, cacheTtl);
      
      if (config.server.nodeEnv === 'development') {
        console.log(`[MEMORY CACHE SET] key: ${key} | ttl: ${cacheTtl} | success: ${success}`);
      }
      
      return success;
    } catch (error) {
      console.error(`[MEMORY CACHE SET ERROR] key: ${key} | error: ${error.message}`);
      return false;
    }
  }

  /**
   * Get the remaining TTL for a cached item
   * @param {string} key - Cache key
   * @returns {Promise<number|null>} Remaining TTL in seconds, or null if not found
   */
  async getTtl(key) {
    if (!this.isInitialized || !this.cache) {
      return null;
    }

    try {
      const ttl = this.cache.getTtl(key);
      if (ttl) {
        // Convert from milliseconds to seconds and round to nearest second
        return Math.round((ttl - Date.now()) / 1000);
      }
      return null;
    } catch (error) {
      console.error(`[MEMORY CACHE TTL ERROR] key: ${key} | error: ${error.message}`);
      return null;
    }
  }

  /**
   * Delete a value from memory cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} Success status
   */
  async del(key) {
    if (!this.isInitialized || !this.cache) {
      return false;
    }

    try {
      const result = this.cache.del(key);
      if (config.server.nodeEnv === 'development') {
        console.log(`[MEMORY CACHE DEL] key: ${key} | deleted: ${result > 0}`);
      }
      return result > 0;
    } catch (error) {
      console.error(`[MEMORY CACHE DEL ERROR] key: ${key} | error: ${error.message}`);
      return false;
    }
  }

  /**
   * Clear all memory cache
   * @returns {Promise<boolean>} Success status
   */
  async flush() {
    if (!this.isInitialized || !this.cache) {
      return false;
    }

    try {
      this.cache.flushAll();
      if (config.server.nodeEnv === 'development') {
        console.log('[MEMORY CACHE FLUSH] All cache cleared');
      }
      return true;
    } catch (error) {
      console.error(`[MEMORY CACHE FLUSH ERROR] error: ${error.message}`);
      return false;
    }
  }

  /**
   * Get memory cache statistics
   * @returns {Promise<Object>} Cache stats
   */
  async getStats() {
    if (!this.isInitialized || !this.cache) {
      return {
        type: 'memory',
        available: false,
        error: 'Cache not initialized'
      };
    }

    try {
      const stats = this.cache.getStats();
      const memUsage = process.memoryUsage();
      
      return {
        type: 'memory',
        available: true,
        ...stats,
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        heapUsedPercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
        external: Math.round(memUsage.external / 1024 / 1024), // MB
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        performance: {
          hitRatio: stats.hits + stats.misses > 0 
            ? Math.round((stats.hits / (stats.hits + stats.misses)) * 100)
            : 0,
          avgKeySize: stats.ksize > 0 ? Math.round(stats.ksize / stats.keys) : 0,
          avgValueSize: stats.vsize > 0 ? Math.round(stats.vsize / stats.keys) : 0,
        }
      };
    } catch (error) {
      return {
        type: 'memory',
        available: false,
        error: error.message
      };
    }
  }

  /**
   * Check if memory cache is available
   * @returns {boolean} Availability status
   */
  isAvailable() {
    return this.isInitialized && this.cache !== null;
  }

  /**
   * Cleanup memory cache
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.cache) {
      this.cache.close();
      this.cache = null;
      this.isInitialized = false;
      console.log('[MEMORY CACHE] Disconnected successfully');
    }
  }

  /**
   * Get the cache provider type
   * @returns {string} Provider type
   */
  getType() {
    return 'memory';
  }
}

module.exports = MemoryCache;