/**
 * Base cache provider interface
 * All cache implementations should extend this class
 */
class CacheProvider {
  /**
   * Get a value from cache
   * @param {string} _key - Cache key
   * @returns {Promise<*>} Cached value or null if not found
   */
  async get(_key) {
    throw new Error('get() method must be implemented');
  }

  /**
   * Set a value in cache
   * @param {string} _key - Cache key
   * @param {*} _value - Value to cache
   * @param {number} _ttl - Time to live in seconds
   * @returns {Promise<boolean>} Success status
   */
  async set(_key, _value, _ttl = null) {
    throw new Error('set() method must be implemented');
  }

  /**
   * Get the remaining TTL for a cached item
   * @param {string} _key - Cache key
   * @returns {Promise<number|null>} Remaining TTL in seconds, or null if not found
   */
  async getTtl(_key) {
    throw new Error('getTtl() method must be implemented');
  }

  /**
   * Delete a value from cache
   * @param {string} _key - Cache key
   * @returns {Promise<boolean>} Success status
   */
  async del(_key) {
    throw new Error('del() method must be implemented');
  }

  /**
   * Clear all cache
   * @returns {Promise<boolean>} Success status
   */
  async flush() {
    throw new Error('flush() method must be implemented');
  }

  /**
   * Get cache statistics
   * @returns {Promise<Object>} Cache stats
   */
  async getStats() {
    throw new Error('getStats() method must be implemented');
  }

  /**
   * Check if cache is available and ready
   * @returns {boolean} Availability status
   */
  isAvailable() {
    throw new Error('isAvailable() method must be implemented');
  }

  /**
   * Initialize the cache provider
   * @returns {Promise<void>}
   */
  async initialize() {
    // Default implementation - override if needed
  }

  /**
   * Cleanup/disconnect the cache provider
   * @returns {Promise<void>}
   */
  async disconnect() {
    // Default implementation - override if needed
  }

  /**
   * Get the cache provider type
   * @returns {string} Provider type (redis, memory, noop)
   */
  getType() {
    throw new Error('getType() method must be implemented');
  }
}

module.exports = CacheProvider;