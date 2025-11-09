const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const CacheProvider = require('./cacheProvider');
const config = require('../config');

/**
 * Write-once filesystem cache implementation
 * Writes cache files on first miss, then serves them with infinite TTL
 */
class FilesystemCache extends CacheProvider {
  constructor() {
    super();
    this.cacheDir = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the filesystem cache
   */
  async initialize() {
    if (!config.filesystem?.cacheDir) {
      throw new Error('FILESYSTEM_CACHE_DIR not configured');
    }

    this.cacheDir = path.resolve(config.filesystem.cacheDir);

    // Create cache directory if it doesn't exist, verify writable
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.access(this.cacheDir, fs.constants.R_OK | fs.constants.W_OK);
      this.isInitialized = true;
      console.log(`[FILESYSTEM CACHE] Initialized successfully (write-once): ${this.cacheDir}`);
    } catch (error) {
      throw new Error(`Filesystem cache directory not accessible: ${this.cacheDir} - ${error.message}`);
    }
  }

  /**
   * Get a value from filesystem cache
   * @param {string} key - Cache key (e.g., /api/live-matches?tournament=123)
   * @returns {Promise<*>} Cached value or null if not found
   */
  async get(key) {
    if (!this.isInitialized) {
      return null;
    }

    try {
      const filePath = this.getFilePath(key);
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);

      if (config.server.nodeEnv === 'development') {
        console.log(`[FILESYSTEM CACHE GET] key: ${key} | hit: true | file: ${filePath}`);
      }

      // Return the data portion (unwrap from cache format)
      return parsed.data !== undefined ? parsed.data : parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`[FILESYSTEM CACHE GET ERROR] key: ${key} | error: ${error.message}`);
      } else if (config.server.nodeEnv === 'development') {
        console.log(`[FILESYSTEM CACHE GET] key: ${key} | hit: false`);
      }
      return null;
    }
  }

  /**
   * Write-once set: writes file only if it doesn't exist
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} _ttl - Time to live in seconds (ignored, always infinite)
   * @returns {Promise<boolean>} Success status
   */
  async set(key, value, _ttl = null) {
    if (!this.isInitialized) {
      return false;
    }

    try {
      const { dirPath, filePath } = this.getFilePathParts(key);

      // Check if file already exists (write-once: skip if exists)
      try {
        await fs.access(filePath, fs.constants.F_OK);
        // File exists, skip write
        if (config.server.nodeEnv === 'development') {
          console.log(`[FILESYSTEM CACHE SET] key: ${key} | skipped (already exists)`);
        }
        return true; // Return true to indicate "success" (data is cached)
      } catch {
        // File doesn't exist, proceed with write
      }

      // Create directory structure
      await fs.mkdir(dirPath, { recursive: true });

      // Prepare cache data in same format as snapshot tool
      const cacheData = {
        data: value,
        statusCode: 200,
        timestamp: new Date().toISOString(),
        cached: true,
      };

      // Write atomically: write to temp file, then rename
      const tempPath = `${filePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(cacheData, null, 2), 'utf8');
      await fs.rename(tempPath, filePath);

      console.log(`[FILESYSTEM CACHE SET] key: ${key} | written: ${filePath}`);
      return true;
    } catch (error) {
      console.error(`[FILESYSTEM CACHE SET ERROR] key: ${key} | error: ${error.message}`);
      return false;
    }
  }

  /**
   * Get the remaining TTL for a cached item (always infinite)
   * @param {string} _key - Cache key
   * @returns {Promise<number|null>} Always returns null (infinite TTL)
   */
  async getTtl(_key) {
    // Filesystem cache has infinite TTL
    return null;
  }

  /**
   * Delete is a no-op for read-only filesystem cache
   * @param {string} _key - Cache key
   * @returns {Promise<boolean>} Always returns false (read-only)
   */
  async del(_key) {
    return false;
  }

  /**
   * Flush is a no-op for read-only filesystem cache
   * @returns {Promise<boolean>} Always returns false (read-only)
   */
  async flush() {
    return false;
  }

  /**
   * Get filesystem cache statistics
   * @returns {Promise<Object>} Cache stats
   */
  async getStats() {
    if (!this.isInitialized) {
      return {
        type: 'filesystem',
        available: false,
        error: 'Cache not initialized'
      };
    }

    try {
      const fileCount = await this.countCacheFiles();
      const dirSize = await this.getCacheDirSize();

      return {
        type: 'filesystem',
        available: true,
        writeOnce: true,
        cacheDir: this.cacheDir,
        fileCount,
        sizeBytes: dirSize,
        sizeMB: Math.round(dirSize / 1024 / 1024),
      };
    } catch (error) {
      return {
        type: 'filesystem',
        available: false,
        error: error.message
      };
    }
  }

  /**
   * Check if filesystem cache is available
   * @returns {boolean} Availability status
   */
  isAvailable() {
    return this.isInitialized;
  }

  /**
   * Cleanup filesystem cache (no-op)
   * @returns {Promise<void>}
   */
  async disconnect() {
    this.isInitialized = false;
    console.log('[FILESYSTEM CACHE] Disconnected');
  }

  /**
   * Get the cache provider type
   * @returns {string} Provider type
   */
  getType() {
    return 'filesystem';
  }

  /**
   * Generate filesystem path for cache key
   * @param {string} key - Cache key
   * @returns {string} File path
   * @private
   */
  getFilePath(key) {
    const { filePath } = this.getFilePathParts(key);
    return filePath;
  }

  /**
   * Generate filesystem path parts for cache key
   * @param {string} key - Cache key
   * @returns {{dirPath: string, filePath: string}} Directory and file paths
   * @private
   */
  getFilePathParts(key) {
    // Hash the full key for filename safety
    const hash = crypto.createHash('md5').update(key).digest('hex').substring(0, 16);

    // Extract path components from key
    // Example: /api/live-matches?tournament=123 -> api/live-matches
    const [pathPart] = key.split('?');
    const segments = pathPart.split('/').filter(Boolean);

    // Build directory path: {cacheDir}/{segment1}/{segment2}/...
    const dirPath = path.join(this.cacheDir, ...segments);

    // Build file path: {dirPath}/{hash}.json
    const filePath = path.join(dirPath, `${hash}.json`);

    return { dirPath, filePath };
  }

  /**
   * Count total cache files recursively
   * @returns {Promise<number>} File count
   * @private
   */
  async countCacheFiles() {
    let count = 0;

    async function traverse(dir) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await traverse(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.json')) {
            count++;
          }
        }
      } catch (error) {
        // Silently skip unreadable directories
      }
    }

    await traverse(this.cacheDir);
    return count;
  }

  /**
   * Calculate total cache directory size
   * @returns {Promise<number>} Size in bytes
   * @private
   */
  async getCacheDirSize() {
    let totalSize = 0;

    async function traverse(dir) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await traverse(fullPath);
          } else if (entry.isFile()) {
            const stats = await fs.stat(fullPath);
            totalSize += stats.size;
          }
        }
      } catch (error) {
        // Silently skip unreadable directories
      }
    }

    await traverse(this.cacheDir);
    return totalSize;
  }
}

module.exports = FilesystemCache;
