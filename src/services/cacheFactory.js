const config = require('../config');
const RedisCache = require('./redisCache');
const MemoryCache = require('./memoryCache');
const NoOpCache = require('./noOpCache');

/**
 * Cache factory that creates the appropriate cache provider based on configuration
 */
class CacheFactory {
  /**
   * Create and initialize the appropriate cache provider
   * @returns {Promise<CacheProvider>} Initialized cache provider
   */
  static async createCache() {
    const cacheEnabled = config.cache.enabled;
    const redisUrl = config.redis.url;

    // If caching is disabled, use no-op cache
    if (!cacheEnabled) {
      console.log('[CACHE FACTORY] Caching disabled, using no-op cache');
      const cache = new NoOpCache();
      await cache.initialize();
      return cache;
    }

    // If Redis URL is configured, use Redis cache
    if (redisUrl) {
      console.log('[CACHE FACTORY] Redis URL configured, initializing Redis cache');
      try {
        const cache = new RedisCache();
        await cache.initialize();
        console.log('[CACHE FACTORY] Redis cache initialized successfully');
        return cache;
      } catch (error) {
        console.error('[CACHE FACTORY] Redis initialization failed:', error.message);
        console.error('[CACHE FACTORY] This is a catastrophic failure - exiting process');
        process.exit(1);
      }
    }

    // Default to memory cache
    console.log('[CACHE FACTORY] No Redis URL configured, using in-memory cache');
    const cache = new MemoryCache();
    await cache.initialize();
    console.log('[CACHE FACTORY] Memory cache initialized successfully');
    return cache;
  }

  /**
   * Get cache strategy information without initializing
   * @returns {Object} Cache strategy info
   */
  static getCacheStrategy() {
    const cacheEnabled = config.cache.enabled;
    const redisUrl = config.redis.url;

    if (!cacheEnabled) {
      return {
        type: 'noop',
        enabled: false,
        description: 'Caching disabled'
      };
    }

    if (redisUrl) {
      return {
        type: 'redis',
        enabled: true,
        url: redisUrl,
        description: 'Redis cache with catastrophic failure on connection error'
      };
    }

    return {
      type: 'memory',
      enabled: true,
      description: 'In-memory cache using node-cache'
    };
  }
}

module.exports = CacheFactory;