const fs = require('fs').promises;
const path = require('path');
const { diff } = require('json-diff-ts');
const config = require('../config');

/**
 * API Response Logger Service
 * Captures ATP API responses to disk for replay testing and debugging
 * Implements minimum interval buffering to reduce file writes
 */
class ApiLoggerService {
  constructor() {
    this.isEnabled = config.apiLogging?.enabled || false;
    this.baseDir = config.apiLogging?.baseDir || './logs/api-responses';
    this.minInterval = config.apiLogging?.minInterval || 60; // seconds
    
    // Track last write time per endpoint for interval management
    this.lastWriteTime = new Map();
    // Buffer latest data per endpoint (only keep most recent)
    this.bufferedData = new Map();
    // Track previous data to detect changes
    this.previousData = new Map();
    
    if (this.isEnabled) {
      console.log(`[API LOGGER] Enabled - logging to ${this.baseDir} with ${this.minInterval}s minimum interval`);
    }
  }

  /**
   * Log an API response to disk with minimum interval buffering and change detection
   * @param {string} endpoint - API endpoint path
   * @param {Object} data - Response data from ATP API
   * @param {Object} metadata - Additional metadata
   */
  async logResponse(endpoint, data, metadata = {}) {
    if (!this.isEnabled) return;

    // Check if data has changed from previous
    const previousData = this.previousData.get(endpoint);
    if (previousData) {
      const changes = diff(previousData, data);
      if (!changes || changes.length === 0) {
        // Data unchanged - skip logging
        console.log(`[API LOGGER] Skipping ${endpoint} - no changes detected`);
        return;
      }
    }

    const logEntry = {
      endpoint,
      data,
      metadata: {
        timestamp: new Date().toISOString(),
        server: 'atp-live-proxy',
        version: '1.0.0',
        ...metadata
      }
    };

    // Always update buffer with latest data (discards previous)
    this.bufferedData.set(endpoint, logEntry);

    // Check if minimum interval has elapsed since last write
    const now = Date.now();
    const lastWrite = this.lastWriteTime.get(endpoint) || 0;
    const intervalMs = this.minInterval * 1000;

    if (now - lastWrite >= intervalMs) {
      // Interval elapsed - write buffered data immediately
      await this.writeLogFile(logEntry);
      this.lastWriteTime.set(endpoint, now);
      this.bufferedData.delete(endpoint);
      // Update previous data after successful write
      this.previousData.set(endpoint, data);
      console.log(`[API LOGGER] Wrote ${endpoint} after ${Math.round((now - lastWrite) / 1000)}s interval (changes detected)`);
    } else {
      // Interval not elapsed - just buffer the data
      const nextWriteIn = Math.round((intervalMs - (now - lastWrite)) / 1000);
      console.log(`[API LOGGER] Buffered ${endpoint} - next write in ${nextWriteIn}s (changes detected)`);
    }
  }

  /**
   * Flush any remaining buffered data to disk (useful for cleanup)
   */
  async flushBufferedData() {
    if (!this.isEnabled || this.bufferedData.size === 0) return;
    
    console.log(`[API LOGGER] Flushing ${this.bufferedData.size} buffered endpoints`);
    
    for (const [endpoint, logEntry] of this.bufferedData.entries()) {
      try {
        await this.writeLogFile(logEntry);
        this.lastWriteTime.set(endpoint, Date.now());
        // Update previous data after successful flush
        this.previousData.set(endpoint, logEntry.data);
        console.log(`[API LOGGER] Flushed buffered data for ${endpoint}`);
      } catch (error) {
        console.error(`[API LOGGER] Error flushing ${endpoint}:`, error.message);
      }
    }
    
    this.bufferedData.clear();
  }

  /**
   * Write a single log entry to disk
   * @param {Object} logEntry - Log entry to write
   */
  async writeLogFile(logEntry) {
    try {
      const { endpoint, data, metadata } = logEntry;
      
      // Generate file path
      const endpointSlug = this.slugifyEndpoint(endpoint);
      const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const timestamp = this.generateTimestamp();
      
      const dirPath = path.join(this.baseDir, endpointSlug, date);
      const fileName = `${timestamp}_response.json`;
      const filePath = path.join(dirPath, fileName);
      
      // Ensure directory exists
      await fs.mkdir(dirPath, { recursive: true });
      
      // Prepare log content
      const logContent = {
        timestamp: metadata.timestamp,
        endpoint,
        data,
        metadata
      };
      
      // Write file
      await fs.writeFile(filePath, JSON.stringify(logContent, null, 2), 'utf8');
      
      console.log(`[API LOGGER] Logged response: ${filePath}`);
      
    } catch (error) {
      console.error('[API LOGGER] Failed to write log file:', error.message);
    }
  }

  /**
   * Convert endpoint path to filesystem-safe slug
   * @param {string} endpoint - API endpoint path
   * @returns {string} Filesystem-safe slug
   */
  slugifyEndpoint(endpoint) {
    return endpoint
      .replace(/^\/api\//, '') // Remove /api/ prefix
      .replace(/\//g, '-')     // Replace slashes with hyphens
      .replace(/[^a-zA-Z0-9-]/g, '') // Remove special characters
      .toLowerCase();
  }

  /**
   * Generate timestamp for filename (HH-MM-SS-mmm)
   * @returns {string} Timestamp string
   */
  generateTimestamp() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    
    return `${hours}-${minutes}-${seconds}-${milliseconds}`;
  }

  /**
   * Enable or disable logging at runtime
   * @param {boolean} enabled - Whether to enable logging
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    console.log(`[API LOGGER] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * Get logging status
   * @returns {Object} Current logging status
   */
  getStatus() {
    return {
      enabled: this.isEnabled,
      baseDir: this.baseDir,
      minInterval: this.minInterval,
      bufferedEndpoints: this.bufferedData.size,
      bufferedEndpointsList: Array.from(this.bufferedData.keys()),
      lastWriteTimes: Object.fromEntries(this.lastWriteTime)
    };
  }

  /**
   * Clean up old log files
   * @param {number} retentionDays - Number of days to retain
   */
  async cleanup(retentionDays = 30) {
    if (!this.isEnabled) {
      console.log('[API LOGGER] Cleanup skipped - logging disabled');
      return;
    }

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0]; // YYYY-MM-DD
      
      console.log(`[API LOGGER] Starting cleanup of logs older than ${cutoffDateStr}`);

      // Check if base directory exists
      let baseExists = false;
      try {
        await fs.access(this.baseDir);
        baseExists = true;
      } catch {
        console.log(`[API LOGGER] Base directory ${this.baseDir} does not exist - nothing to clean`);
        return;
      }

      if (!baseExists) return;

      let deletedDirs = 0;
      let deletedFiles = 0;
      let errors = 0;

      // Read all endpoint directories
      const endpointDirs = await fs.readdir(this.baseDir);
      
      for (const endpointDir of endpointDirs) {
        const endpointPath = path.join(this.baseDir, endpointDir);
        
        try {
          const stat = await fs.stat(endpointPath);
          if (!stat.isDirectory()) continue;

          // Read date directories within endpoint
          const dateDirs = await fs.readdir(endpointPath);
          let endpointHasRemainingDirs = false;

          for (const dateDir of dateDirs) {
            // Check if directory name matches YYYY-MM-DD format
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) {
              endpointHasRemainingDirs = true;
              continue;
            }

            const dirDate = new Date(dateDir + 'T00:00:00.000Z');
            if (isNaN(dirDate.getTime())) {
              console.warn(`[API LOGGER] Invalid date directory: ${dateDir}`);
              endpointHasRemainingDirs = true;
              continue;
            }

            if (dirDate < cutoffDate) {
              // Directory is old enough to delete
              const dateDirPath = path.join(endpointPath, dateDir);
              try {
                // Count files before deletion
                const files = await fs.readdir(dateDirPath);
                const fileCount = files.length;
                
                await fs.rm(dateDirPath, { recursive: true, force: true });
                deletedDirs++;
                deletedFiles += fileCount;
                console.log(`[API LOGGER] Deleted ${dateDirPath} (${fileCount} files)`);
              } catch (error) {
                console.error(`[API LOGGER] Failed to delete ${dateDirPath}:`, error.message);
                errors++;
                endpointHasRemainingDirs = true;
              }
            } else {
              endpointHasRemainingDirs = true;
            }
          }

          // Remove endpoint directory if it's now empty
          if (!endpointHasRemainingDirs) {
            try {
              const remainingContents = await fs.readdir(endpointPath);
              if (remainingContents.length === 0) {
                await fs.rmdir(endpointPath);
                console.log(`[API LOGGER] Removed empty endpoint directory: ${endpointPath}`);
              }
            } catch (error) {
              console.error(`[API LOGGER] Failed to remove empty endpoint directory ${endpointPath}:`, error.message);
              errors++;
            }
          }

        } catch (error) {
          console.error(`[API LOGGER] Error processing endpoint directory ${endpointDir}:`, error.message);
          errors++;
        }
      }

      console.log(`[API LOGGER] Cleanup completed: ${deletedDirs} directories, ${deletedFiles} files deleted, ${errors} errors`);
      
    } catch (error) {
      console.error('[API LOGGER] Cleanup failed:', error.message);
    }
  }
}

module.exports = new ApiLoggerService();