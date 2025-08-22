const fs = require('fs');
const path = require('path');
const eventGeneratorInstance = require('../services/eventGenerator');

/**
 * Log Replay Service
 * 
 * Handles discovery, filtering, and replay of saved API response logs
 * through the event generator to reconstruct events from historical data.
 */
class LogReplay {
  constructor(options = {}) {
    this.logDir = options.logDir || './logs/api-responses';
    this.endpoint = options.endpoint || 'live-matches';
    this.verbose = options.verbose || false;
    this.colors = options.colors !== false; // Default to true unless explicitly disabled
    
    // Use the singleton event generator instance
    this.eventGenerator = eventGeneratorInstance;
  }

  /**
   * Discover log files matching the specified criteria
   * @param {Object} filters - Filtering options
   * @returns {Array} Sorted array of log file paths
   */
  async discoverLogFiles(filters = {}) {
    const { date, startTime, endTime } = filters;
    
    // Build endpoint directory path
    const endpointDir = path.join(this.logDir, this.endpoint);
    
    if (!fs.existsSync(endpointDir)) {
      throw new Error(`Endpoint directory not found: ${endpointDir}`);
    }

    // If no date specified, find the most recent date
    let targetDate = date;
    if (!targetDate) {
      targetDate = this.findLatestDate(endpointDir);
      if (this.verbose) {
        console.log(`No date specified, using latest: ${targetDate}`);
      }
    }

    // Build date directory path
    const dateDir = path.join(endpointDir, targetDate);
    if (!fs.existsSync(dateDir)) {
      throw new Error(`Date directory not found: ${dateDir}`);
    }

    // Get all JSON files in the date directory
    const files = fs.readdirSync(dateDir)
      .filter(file => file.endsWith('_response.json'))
      .map(file => ({
        path: path.join(dateDir, file),
        timestamp: this.extractTimestamp(file)
      }))
      .filter(file => file.timestamp) // Only include files with valid timestamps
      .filter(file => this.matchesTimeFilter(file.timestamp, startTime, endTime))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp)) // Sort chronologically
      .map(file => file.path);

    if (this.verbose) {
      console.log(`Found ${files.length} matching log files for ${targetDate}`);
      if (startTime || endTime) {
        console.log(`Time filter: ${startTime || 'start'} - ${endTime || 'end'}`);
      }
    }

    return files;
  }

  /**
   * Find the latest date directory in the endpoint folder
   * @param {string} endpointDir - Path to endpoint directory
   * @returns {string} Latest date in YYYY-MM-DD format
   */
  findLatestDate(endpointDir) {
    const dateDirs = fs.readdirSync(endpointDir)
      .filter(dir => {
        const stat = fs.statSync(path.join(endpointDir, dir));
        return stat.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(dir);
      })
      .sort()
      .reverse(); // Most recent first

    if (dateDirs.length === 0) {
      throw new Error(`No date directories found in ${endpointDir}`);
    }

    return dateDirs[0];
  }

  /**
   * Extract timestamp from log filename
   * Expected format: HH-MM-SS-mmm_response.json
   * @param {string} filename - Log filename or full path
   * @returns {string|null} Timestamp in HH:MM:SS format, or null if invalid
   */
  extractTimestamp(filename) {
    const basename = path.basename(filename);
    const match = basename.match(/^(\d{2})-(\d{2})-(\d{2})-(\d{3})_response\.json$/);
    
    if (!match) {
      return null;
    }

    const [, hours, minutes, seconds] = match;
    return `${hours}:${minutes}:${seconds}`;
  }

  /**
   * Check if a timestamp matches the time filter criteria
   * @param {string} timestamp - Timestamp in HH:MM:SS format
   * @param {string} startTime - Start time filter in HH:MM format (optional)
   * @param {string} endTime - End time filter in HH:MM format (optional)
   * @returns {boolean} True if timestamp matches filter
   */
  matchesTimeFilter(timestamp, startTime, endTime) {
    if (!startTime && !endTime) {
      return true;
    }

    const timeMinutes = this.timeToMinutes(timestamp.substring(0, 5)); // HH:MM

    if (startTime) {
      const startMinutes = this.timeToMinutes(startTime);
      if (timeMinutes < startMinutes) {
        return false;
      }
    }

    if (endTime) {
      const endMinutes = this.timeToMinutes(endTime);
      if (timeMinutes > endMinutes) {
        return false;
      }
    }

    return true;
  }

  /**
   * Convert time string to minutes since midnight
   * @param {string} timeStr - Time in HH:MM format
   * @returns {number} Minutes since midnight
   */
  timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Replay log files through the event generator
   * @param {Array} logFiles - Array of log file paths
   * @returns {Object} Replay results with events and metadata
   */
  async replayLogs(logFiles) {
    const results = {
      replayInfo: {
        startTime: null,
        endTime: null,
        filesProcessed: logFiles.length,
        eventsGenerated: 0,
        endpoint: this.endpoint
      },
      events: [],
      errors: []
    };

    // Clear any existing state in the event generator
    this.eventGenerator.clearStates();

    for (let i = 0; i < logFiles.length; i++) {
      const filePath = logFiles[i];
      
      try {
        // Read and parse log file
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const logData = JSON.parse(fileContent);

        // Extract timestamp and API data
        const fileTimestamp = logData.timestamp;
        const apiData = logData.data;

        // Set timing metadata
        if (i === 0) {
          results.replayInfo.startTime = fileTimestamp;
        }
        if (i === logFiles.length - 1) {
          results.replayInfo.endTime = fileTimestamp;
        }

        if (this.verbose && i % 10 === 0) {
          console.log(`Processing file ${i + 1}/${logFiles.length}: ${path.basename(filePath)}`);
        }

        // Process through event generator
        const endpoint = `/api/${this.endpoint}`;
        
        if (this.verbose) {
          // Debug: Show what matches we're extracting from this file
          const currentMatches = this.eventGenerator.extractMatches(apiData);
          console.log(`\n[DEBUG] File ${i + 1}: ${path.basename(filePath)}`);
          console.log(`[DEBUG] Extracted ${currentMatches.length} matches:`, 
            currentMatches.map(m => `${m.MatchId} (${m.Status})`).join(', '));
          
          // Debug: Show previous state if it exists
          const previousState = this.eventGenerator.previousStates.get(endpoint);
          if (previousState) {
            const previousMatches = this.eventGenerator.extractMatches(previousState);
            console.log(`[DEBUG] Previous state had ${previousMatches.length} matches:`, 
              previousMatches.map(m => `${m.MatchId} (${m.Status})`).join(', '));
          } else {
            console.log('[DEBUG] No previous state found');
          }
        }

        const events = this.eventGenerator.processData(endpoint, apiData);

        if (this.verbose) {
          console.log(`[DEBUG] Generated ${events.length} events from this file\n`);
        }

        // Add events to results with file context
        events.forEach(event => {
          results.events.push({
            ...event,
            logFile: path.basename(filePath),
            logTimestamp: fileTimestamp
          });
        });

      } catch (error) {
        const errorInfo = {
          file: path.basename(filePath),
          error: error.message,
          index: i
        };
        
        results.errors.push(errorInfo);
        
        if (this.verbose) {
          console.warn(`Warning: Failed to process ${path.basename(filePath)}: ${error.message}`);
        }
      }
    }

    results.replayInfo.eventsGenerated = results.events.length;

    if (this.verbose) {
      console.log(`Replay complete: ${results.events.length} events generated from ${results.replayInfo.filesProcessed} files`);
      if (results.errors.length > 0) {
        console.log(`Warnings: ${results.errors.length} files had processing errors`);
      }
    }

    return results;
  }

  /**
   * Get event type statistics from results
   * @param {Object} results - Replay results
   * @returns {Object} Event type counts
   */
  getEventStats(results) {
    const stats = {};
    
    results.events.forEach(event => {
      stats[event.event_type] = (stats[event.event_type] || 0) + 1;
    });

    return stats;
  }
}

module.exports = LogReplay;