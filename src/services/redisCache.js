const redis = require('redis');
const CacheProvider = require('./cacheProvider');
const config = require('../config');

class RedisCache extends CacheProvider {
  constructor() {
    super();
    this.client = null;
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
  }

  /**
   * Initialize Redis connection
   * @returns {Promise<void>}
   */
  async initialize() {
    if (!config.redis.url) {
      throw new Error('Redis URL is required but not configured');
    }
    await this.connect();
  }

  async connect() {
    if (this.connectionAttempts >= this.maxRetries) {
      throw new Error('Redis connection failed after maximum retry attempts');
    }

    try {
      this.client = redis.createClient({
        url: config.redis.url,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > this.maxRetries) {
              console.log('[REDIS] Max reconnection attempts reached');
              return new Error('Max reconnection attempts reached');
            }
            return Math.min(retries * 1000, 5000); // Max 5 second delay
          }
        }
      });

      // Event handlers
      this.client.on('connect', () => {
        console.log('[REDIS] Connecting to Redis...');
      });

      this.client.on('ready', () => {
        console.log('[REDIS] Connected and ready');
        this.isConnected = true;
        this.connectionAttempts = 0;
      });

      this.client.on('error', (err) => {
        console.error('[REDIS] Connection error:', err.message);
        this.isConnected = false;
      });

      this.client.on('end', () => {
        console.log('[REDIS] Connection closed');
        this.isConnected = false;
      });

      await this.client.connect();
      console.log('[REDIS] Initialized successfully');
    } catch (error) {
      console.error('[REDIS] Failed to connect:', error.message);
      this.isConnected = false;
      this.connectionAttempts++;
      
      // For initialization, we throw the error instead of retrying
      throw new Error(`Redis connection failed: ${error.message}`);
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      try {
        await this.client.disconnect();
        console.log('[REDIS] Disconnected successfully');
      } catch (error) {
        console.error('[REDIS] Error during disconnect:', error.message);
      }
    }
  }

  /**
   * Get a value from Redis cache
   * @param {string} key - Cache key
   * @returns {Promise<*>} Cached value or null if not found or on error
   */
  async get(key) {
    if (!this.isConnected || !this.client) {
      return null;
    }

    try {
      const value = await this.client.get(key);
      if (value === null) return null;
      
      // Parse JSON if it's a valid JSON string
      try {
        return JSON.parse(value);
      } catch {
        return value; // Return as-is if not JSON
      }
    } catch (error) {
      console.error('[REDIS] Get error:', error.message);
      this.isConnected = false;
      return null;
    }
  }

  /**
   * Set a value in Redis cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<boolean>} Success status
   */
  async set(key, value, ttl = null) {
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      // Stringify non-string values
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      
      if (ttl && ttl > 0) {
        await this.client.setEx(key, ttl, stringValue);
      } else {
        await this.client.set(key, stringValue);
      }
      
      return true;
    } catch (error) {
      console.error('[REDIS] Set error:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Get the remaining TTL for a cached item
   * @param {string} key - Cache key
   * @returns {Promise<number|null>} Remaining TTL in seconds, or null if not found/error
   */
  async getTtl(key) {
    if (!this.isConnected || !this.client) {
      return null;
    }

    try {
      const ttl = await this.client.ttl(key);
      return ttl > 0 ? ttl : null;
    } catch (error) {
      console.error('[REDIS] TTL error:', error.message);
      this.isConnected = false;
      return null;
    }
  }

  /**
   * Delete a value from Redis cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} Success status
   */
  async del(key) {
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error('[REDIS] Delete error:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Clear all cache
   * @returns {Promise<boolean>} Success status
   */
  async flush() {
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      await this.client.flushDb();
      return true;
    } catch (error) {
      console.error('[REDIS] Flush error:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Get Redis cache statistics
   * @returns {Promise<Object>} Cache stats
   */
  async getStats() {
    if (!this.isConnected || !this.client) {
      return {
        type: 'redis',
        available: false,
        error: 'Not connected',
      };
    }

    try {
      const info = await this.client.info('memory');
      const keyspace = await this.client.info('keyspace');
      
      // Parse keyspace info to get key count
      let totalKeys = 0;
      const dbMatch = keyspace.match(/db\d+:keys=(\d+)/g);
      if (dbMatch) {
        dbMatch.forEach(match => {
          const keys = parseInt(match.split('keys=')[1]);
          totalKeys += keys;
        });
      }

      // Parse memory info
      const memoryMatch = info.match(/used_memory:(\d+)/);
      const memoryBytes = memoryMatch ? parseInt(memoryMatch[1]) : 0;
      const memoryMB = Math.round(memoryBytes / 1024 / 1024);

      return {
        type: 'redis',
        available: true,
        connected: true,
        keys: totalKeys,
        memoryUsedMB: memoryMB,
        connectionAttempts: this.connectionAttempts,
      };
    } catch (error) {
      console.error('[REDIS] Stats error:', error.message);
      this.isConnected = false;
      return {
        type: 'redis',
        available: false,
        error: error.message,
      };
    }
  }

  /**
   * Check if Redis is connected and available
   * @returns {boolean} Connection status
   */
  isAvailable() {
    return this.isConnected && !!this.client;
  }

  /**
   * Get the cache provider type
   * @returns {string} Provider type
   */
  getType() {
    return 'redis';
  }
}

module.exports = RedisCache;