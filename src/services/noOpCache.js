const CacheProvider = require('./cacheProvider');

/**
 * No-operation cache implementation for when caching is disabled
 * All operations return immediately without storing or retrieving data
 */
class NoOpCache extends CacheProvider {
  constructor() {
    super();
    this.isInitialized = false;
  }

  /**
   * Initialize the no-op cache (no-op)
   */
  async initialize() {
    this.isInitialized = true;
    console.log('[NO-OP CACHE] Caching disabled - using no-op cache');
  }

  /**
   * Get a value from cache (always returns null)
   * @param {string} _key - Cache key
   * @returns {Promise<null>} Always null
   */
  async get(_key) {
    return null;
  }

  /**
   * Set a value in cache (no-op)
   * @param {string} _key - Cache key
   * @param {*} _value - Value to cache
   * @param {number} _ttl - Time to live in seconds
   * @returns {Promise<boolean>} Always true
   */
  async set(_key, _value, _ttl = null) {
    return true;
  }

  /**
   * Get the remaining TTL for a cached item (always returns null)
   * @param {string} _key - Cache key
   * @returns {Promise<null>} Always null
   */
  async getTtl(_key) {
    return null;
  }

  /**
   * Delete a value from cache (no-op)
   * @param {string} _key - Cache key
   * @returns {Promise<boolean>} Always true
   */
  async del(_key) {
    return true;
  }

  /**
   * Clear all cache (no-op)
   * @returns {Promise<boolean>} Always true
   */
  async flush() {
    return true;
  }

  /**
   * Get cache statistics
   * @returns {Promise<Object>} Cache stats indicating no-op
   */
  async getStats() {
    return {
      type: 'noop',
      available: false,
      enabled: false,
      keys: 0,
      message: 'Caching is disabled'
    };
  }

  /**
   * Check if cache is available (always false for no-op)
   * @returns {boolean} Always false
   */
  isAvailable() {
    return false;
  }

  /**
   * Cleanup (no-op)
   * @returns {Promise<void>}
   */
  async disconnect() {
    this.isInitialized = false;
    console.log('[NO-OP CACHE] Disconnected');
  }

  /**
   * Get the cache provider type
   * @returns {string} Provider type
   */
  getType() {
    return 'noop';
  }
}

module.exports = NoOpCache;