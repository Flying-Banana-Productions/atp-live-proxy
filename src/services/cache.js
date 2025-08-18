const CacheFactory = require('./cacheFactory');

/**
 * Main cache service that delegates to the appropriate cache provider
 * Determined by configuration and initialized at startup
 */
class CacheService {
  constructor() {
    this.provider = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the cache service with the appropriate provider
   * This should be called at application startup
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    this.provider = await CacheFactory.createCache();
    this.isInitialized = true;
    
    console.log(`[CACHE SERVICE] Initialized with provider: ${this.provider.getType()}`);
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {Promise<*>} Cached value or null if not found
   */
  async get(key) {
    if (!this.isInitialized || !this.provider) {
      throw new Error('Cache service not initialized');
    }
    return await this.provider.get(key);
  }

  /**
   * Set a value in cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<boolean>} Success status
   */
  async set(key, value, ttl = null) {
    if (!this.isInitialized || !this.provider) {
      throw new Error('Cache service not initialized');
    }
    return await this.provider.set(key, value, ttl);
  }

  /**
   * Get the remaining TTL for a cached item
   * @param {string} key - Cache key
   * @returns {Promise<number|null>} Remaining TTL in seconds, or null if not found
   */
  async getTtl(key) {
    if (!this.isInitialized || !this.provider) {
      throw new Error('Cache service not initialized');
    }
    return await this.provider.getTtl(key);
  }

  /**
   * Delete a value from cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} Success status
   */
  async del(key) {
    if (!this.isInitialized || !this.provider) {
      throw new Error('Cache service not initialized');
    }
    return await this.provider.del(key);
  }

  /**
   * Clear all cache
   * @returns {Promise<boolean>} Success status
   */
  async flush() {
    if (!this.isInitialized || !this.provider) {
      throw new Error('Cache service not initialized');
    }
    return await this.provider.flush();
  }

  /**
   * Get cache statistics
   * @returns {Promise<Object>} Cache stats
   */
  async getStats() {
    if (!this.isInitialized || !this.provider) {
      return {
        type: 'uninitialized',
        available: false,
        error: 'Cache service not initialized'
      };
    }
    return await this.provider.getStats();
  }

  /**
   * Check if cache is available
   * @returns {boolean} Availability status
   */
  isAvailable() {
    return this.isInitialized && this.provider && this.provider.isAvailable();
  }

  /**
   * Get the current cache provider type
   * @returns {string|null} Provider type or null if not initialized
   */
  getProviderType() {
    return this.provider ? this.provider.getType() : null;
  }

  /**
   * Cleanup and disconnect the cache provider
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.provider) {
      await this.provider.disconnect();
      this.provider = null;
      this.isInitialized = false;
      console.log('[CACHE SERVICE] Disconnected');
    }
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

// Export a singleton instance
const cacheService = new CacheService();
module.exports = cacheService;