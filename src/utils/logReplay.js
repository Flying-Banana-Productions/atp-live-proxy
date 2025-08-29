const fs = require('fs');
const path = require('path');
const { diff } = require('json-diff-ts');
const { ensureUniqueTimestamps } = require('./eventTimestampUtils');
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
    
    // Handle both single endpoint (legacy) and multiple endpoints (new)
    if (options.endpoints && Array.isArray(options.endpoints)) {
      this.endpoints = options.endpoints;
    } else if (options.endpoint) {
      this.endpoints = [options.endpoint];
    } else {
      this.endpoints = ['live-matches'];
    }
    
    // Tournament ID filter (convert to string for consistent comparison)
    this.tournamentId = options.tournamentId ? String(options.tournamentId) : null;
    
    // Event type exclusion filter (exact match required)
    if (options.excludeEventTypes && Array.isArray(options.excludeEventTypes)) {
      this.excludeEventTypes = new Set(options.excludeEventTypes);
    } else {
      this.excludeEventTypes = null;
    }
    
    this.verbose = options.verbose || false;
    this.colors = options.colors !== false; // Default to true unless explicitly disabled
    
    // Use the singleton event generator instance
    this.eventGenerator = eventGeneratorInstance;
  }

  /**
   * Discover log files matching the specified criteria
   * @param {Object} filters - Filtering options
   * @returns {Array} Sorted array of file information objects
   */
  async discoverLogFiles(filters = {}) {
    const { date, dateStart, dateEnd, startTime, endTime } = filters;
    
    const allFiles = [];
    
    // Process each endpoint
    for (const endpoint of this.endpoints) {
      const endpointDir = path.join(this.logDir, endpoint);
      
      if (!fs.existsSync(endpointDir)) {
        if (this.verbose) {
          console.warn(`Endpoint directory not found: ${endpointDir}`);
        }
        continue;
      }
      
      // Determine which dates to process
      let datesToProcess = [];
      
      if (date) {
        // Single date specified
        datesToProcess = [date];
      } else if (dateStart || dateEnd) {
        // Date range specified
        datesToProcess = this.getDateRange(endpointDir, dateStart, dateEnd);
      } else {
        // No date specified, use all available dates
        datesToProcess = this.getAvailableDates(endpointDir);
      }
      
      // Collect files from each date
      for (const dateStr of datesToProcess) {
        const dateDir = path.join(endpointDir, dateStr);
        if (!fs.existsSync(dateDir)) {
          if (this.verbose) {
            console.warn(`Date directory not found: ${dateDir}`);
          }
          continue;
        }
        
        const dateFiles = fs.readdirSync(dateDir)
          .filter(file => file.endsWith('_response.json'))
          .map(file => {
            const fullPath = path.join(dateDir, file);
            return {
              path: fullPath,
              endpoint,
              date: dateStr,
              timestamp: this.extractTimestamp(file),
              fullDatetime: this.extractFullDatetime(fullPath)
            };
          })
          .filter(file => file.timestamp && file.fullDatetime) // Only include files with valid timestamps
          .filter(file => this.matchesTimeFilter(file.timestamp, startTime, endTime));
        
        allFiles.push(...dateFiles);
      }
    }
    
    // Sort all files chronologically across all endpoints
    allFiles.sort((a, b) => a.fullDatetime.localeCompare(b.fullDatetime));
    
    if (this.verbose) {
      // Generate summary information
      let dateRangeStr = 'No dates processed';
      if (allFiles.length > 0) {
        const dates = [...new Set(allFiles.map(f => f.date))].sort();
        if (dates.length === 1) {
          dateRangeStr = dates[0];
        } else {
          dateRangeStr = `${dates[0]} to ${dates[dates.length - 1]}`;
        }
      }
      
      const endpointCounts = this.endpoints.map(endpoint => {
        const count = allFiles.filter(f => f.endpoint === endpoint).length;
        return `${endpoint}: ${count}`;
      }).join(', ');
      
      console.log(`Found ${allFiles.length} matching log files for ${dateRangeStr}`);
      console.log(`Endpoints: ${endpointCounts}`);
      if (startTime || endTime) {
        console.log(`Time filter: ${startTime || 'start'} - ${endTime || 'end'}`);
      }
    }
    
    return allFiles;
  }

  /**
   * Recursively reads a directory and its subdirectories, returning a list of all file paths.
   * @param {string} dirPath The path to the directory to start reading from.
   * @returns {string[]} An array of absolute file paths.
   */
  recursiveReadDirSync(dirPath) {
    let fileList = [];
    const files = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const file of files) {
      const fullPath = path.join(dirPath, file.name);
      if (file.isDirectory()) {
        // If it's a directory, recursively call the function and concatenate the results
        fileList = fileList.concat(this.recursiveReadDirSync(fullPath));
      } else {
        // If it's a file, add its path to the list
        fileList.push(fullPath);
      }
    }
    return fileList;
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
   * Extract full datetime from log file path including date directory
   * Expected path format: .../YYYY-MM-DD/HH-MM-SS-mmm_response.json
   * @param {string} filePath - Full path to log file
   * @returns {string|null} ISO datetime string for sorting, or null if invalid
   */
  extractFullDatetime(filePath) {
    // Extract date from path (second-to-last path component)
    const pathParts = filePath.split(path.sep);
    const dateMatch = pathParts[pathParts.length - 2]?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    
    if (!dateMatch) {
      return null;
    }
    
    // Extract time from filename
    const timeStr = this.extractTimestamp(filePath);
    if (!timeStr) {
      return null;
    }
    
    const [year, month, day] = dateMatch.slice(1);
    // Convert HH:MM:SS to ISO datetime string for proper sorting
    return `${year}-${month}-${day}T${timeStr}`;
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
    // Disable EventOutputService to prevent automatic webhook delivery during replay
    // The replay script handles its own event output with proper timing control
    const eventOutput = require('../services/eventOutput');
    eventOutput.setEnabled(false);

    const results = {
      replayInfo: {
        startTime: null,
        endTime: null,
        filesProcessed: logFiles.length,
        eventsGenerated: 0,
        endpoints: this.endpoints, // Support multiple endpoints
        endpointCounts: {},
        tournamentFilter: this.tournamentId, // Include tournament filter if set
        excludedEventTypes: this.excludeEventTypes ? Array.from(this.excludeEventTypes) : null
      },
      events: [],
      errors: []
    };

    // Initialize endpoint counts
    this.endpoints.forEach(endpoint => {
      results.replayInfo.endpointCounts[endpoint] = 0;
    });

    // Clear any existing state in the event generator
    this.eventGenerator.clearStates();

    for (let i = 0; i < logFiles.length; i++) {
      // Handle both old format (string paths) and new format (file objects)
      const fileInfo = typeof logFiles[i] === 'string' ? { path: logFiles[i], endpoint: this.endpoints[0] } : logFiles[i];
      const filePath = fileInfo.path;
      const fileEndpoint = fileInfo.endpoint;
      
      try {
        // Read and parse log file
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const logData = JSON.parse(fileContent);

        // Extract timestamp and API data
        const fileTimestamp = logData.timestamp;
        const apiData = logData.data;

        // Determine base timestamp for events
        let baseEventTimestamp = fileTimestamp;
        
        // For draws-live endpoint, prefer ATP's ReleaseDateTimeUTC if available
        if (fileEndpoint === 'draws-live' && apiData && apiData.ReleaseDateTimeUTC) {
          baseEventTimestamp = apiData.ReleaseDateTimeUTC;
          if (this.verbose) {
            console.log(`[DEBUG] Using ATP ReleaseDateTimeUTC: ${baseEventTimestamp} (log timestamp was: ${fileTimestamp})`);
          }
        }

        // Set timing metadata
        if (i === 0) {
          results.replayInfo.startTime = fileTimestamp;
        }
        if (i === logFiles.length - 1) {
          results.replayInfo.endTime = fileTimestamp;
        }

        // Update endpoint count
        results.replayInfo.endpointCounts[fileEndpoint]++;

        if (this.verbose && i % 10 === 0) {
          console.log(`Processing file ${i + 1}/${logFiles.length}: ${path.basename(filePath)} [${fileEndpoint}]`);
        }

        // Process through event generator
        // Map endpoint names to actual API paths
        const endpointMapping = {
          'live-matches': '/api/live-matches',
          'draws-live': '/api/draws/live'
        };
        const apiEndpoint = endpointMapping[fileEndpoint] || `/api/${fileEndpoint}`;
        
        if (this.verbose) {
          console.log(`\n[DEBUG] File ${i + 1}: ${path.basename(filePath)} [${fileEndpoint}]`);
          
          // Debug: Show what data we're extracting based on endpoint type
          if (apiEndpoint === '/api/live-matches') {
            const currentMatches = this.eventGenerator.extractMatches(apiData);
            console.log(`[DEBUG] Extracted ${currentMatches.length} matches:`, 
              currentMatches.map(m => `${m.MatchId} (${m.Status})`).join(', '));
              
            // Debug: Show previous state if it exists
            const previousState = this.eventGenerator.previousStates.get(apiEndpoint);
            if (previousState) {
              const previousMatches = this.eventGenerator.extractMatches(previousState);
              console.log(`[DEBUG] Previous state had ${previousMatches.length} matches:`, 
                previousMatches.map(m => `${m.MatchId} (${m.Status})`).join(', '));
            } else {
              console.log('[DEBUG] No previous state found');
            }
          } else if (apiEndpoint === '/api/draws/live') {
            const currentFixtures = this.eventGenerator.extractDrawFixtures(apiData);
            console.log(`[DEBUG] Extracted ${currentFixtures.length} draw fixtures`);
            
            // Debug: Show previous state if it exists  
            const previousState = this.eventGenerator.previousStates.get(apiEndpoint);
            if (previousState) {
              const previousFixtures = this.eventGenerator.extractDrawFixtures(previousState);
              console.log(`[DEBUG] Previous state had ${previousFixtures.length} fixtures`);
            } else {
              console.log('[DEBUG] No previous state found');
            }
          } else {
            console.log(`[DEBUG] Unknown endpoint type: ${apiEndpoint}`);
          }
        }

        // Convert baseEventTimestamp to ISO format for events
        const isoTimestamp = new Date(baseEventTimestamp).toISOString();
        const events = this.eventGenerator.processData(apiEndpoint, apiData, isoTimestamp);
        
        // Apply filters in sequence
        let filteredEvents = events;
        
        // Filter by tournament ID if specified
        if (this.tournamentId) {
          filteredEvents = filteredEvents.filter(event => event.tournament_id === this.tournamentId);
        }
        
        // Exclude specified event types (exact match)
        if (this.excludeEventTypes && this.excludeEventTypes.size > 0) {
          filteredEvents = filteredEvents.filter(event => !this.excludeEventTypes.has(event.event_type));
        }

        // Verbose logging
        if (this.verbose && (this.tournamentId || this.excludeEventTypes)) {
          const filters = [];
          if (this.tournamentId) filters.push(`tournament ${this.tournamentId}`);
          if (this.excludeEventTypes) filters.push(`excluding ${this.excludeEventTypes.size} event types`);
          
          if (events.length !== filteredEvents.length) {
            console.log(`[DEBUG] Generated ${events.length} events, filtered to ${filteredEvents.length} (${filters.join(', ')})\n`);
          } else {
            console.log(`[DEBUG] Generated ${filteredEvents.length} events from this file\n`);
          }
        } else if (this.verbose) {
          console.log(`[DEBUG] Generated ${filteredEvents.length} events from this file\n`);
        }

        // Use shared utility for timestamp uniqueness and logical ordering
        const processedEvents = ensureUniqueTimestamps(filteredEvents, true);

        // Add events to results with file context
        processedEvents.forEach(event => {
          results.events.push({
            ...event,
            logFile: path.basename(filePath),
            logTimestamp: fileTimestamp,
            logEndpoint: fileEndpoint // Include endpoint information in events
          });
        });

      } catch (error) {
        const errorInfo = {
          file: path.basename(filePath),
          endpoint: fileEndpoint,
          error: error.message,
          index: i
        };
        
        results.errors.push(errorInfo);
        
        if (this.verbose) {
          console.warn(`Warning: Failed to process ${path.basename(filePath)} [${fileEndpoint}]: ${error.message}`);
        }
      }
    }

    results.replayInfo.eventsGenerated = results.events.length;

    if (this.verbose) {
      const endpointSummary = Object.entries(results.replayInfo.endpointCounts)
        .map(([endpoint, count]) => `${endpoint}: ${count} files`)
        .join(', ');
      console.log(`Replay complete: ${results.events.length} events generated from ${results.replayInfo.filesProcessed} files`);
      console.log(`File breakdown: ${endpointSummary}`);
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

  /**
   * Detect duplicate log files with identical data
   * @param {Array} logFiles - Array of log file paths (must be sorted chronologically)
   * @returns {Array} Array of duplicate file information
   */
  async detectDuplicates(logFiles) {
    const duplicates = [];
    let previousData = null;
    let previousFile = null;
    
    for (let i = 0; i < logFiles.length; i++) {
      const fileInfo = logFiles[i];
      const file = typeof fileInfo === 'string' ? fileInfo : fileInfo.path;
      
      try {
        // Read and parse log file
        const content = JSON.parse(fs.readFileSync(file, 'utf8'));
        const currentData = content.data;
        
        // Compare with previous file's data
        if (previousData) {
          const changes = diff(previousData, currentData);
          if (!changes || changes.length === 0) {
            // Found a duplicate
            const stats = fs.statSync(file);
            duplicates.push({
              original: previousFile,
              originalIndex: i - 1,
              duplicate: file,
              duplicateIndex: i,
              timestamp: content.timestamp,
              size: stats.size,
              sizeKB: (stats.size / 1024).toFixed(2)
            });
            
            if (this.verbose) {
              console.log(`[DUPLICATE] ${path.basename(file)} is identical to ${path.basename(previousFile)}`);
            }
          }
        }
        
        // Update previous for next iteration
        previousData = currentData;
        previousFile = file;
        
      } catch (error) {
        console.error(`Error reading file ${path.basename(file)}: ${error.message}`);
      }
    }
    
    return duplicates;
  }

  /**
   * Prune duplicate log files
   * @param {Array} duplicates - Array of duplicate information from detectDuplicates
   * @param {boolean} dryRun - If true, only simulate deletion
   * @returns {Object} Pruning results
   */
  async pruneDuplicates(duplicates, dryRun = false) {
    const results = {
      deleted: [],
      errors: [],
      bytesFreed: 0,
      filesDeleted: 0,
      dryRun
    };
    
    for (const dup of duplicates) {
      try {
        const filePath = dup.duplicate;
        const fileName = path.basename(filePath);
        const stats = fs.statSync(filePath);
        const size = stats.size;
        
        if (!dryRun) {
          // Actually delete the file
          fs.unlinkSync(filePath);
        }
        
        results.deleted.push({
          file: fileName,
          fullPath: filePath,
          size,
          sizeKB: (size / 1024).toFixed(2),
          originalFile: path.basename(dup.original),
          timestamp: dup.timestamp
        });
        
        results.bytesFreed += size;
        results.filesDeleted++;
        
        if (this.verbose) {
          const action = dryRun ? '[DRY RUN] Would delete' : '[DELETED]';
          console.log(`${action} ${fileName} (${(size / 1024).toFixed(2)} KB)`);
        }
        
      } catch (error) {
        results.errors.push({
          file: path.basename(dup.duplicate),
          error: error.message
        });
        
        if (this.verbose) {
          console.error(`Error processing ${path.basename(dup.duplicate)}: ${error.message}`);
        }
      }
    }
    
    return results;
  }

  /**
   * Get available dates in the specified endpoint directory within a date range
   * @param {string} endpointDir - The endpoint directory path
   * @param {string} dateStart - Start date in YYYY-MM-DD format (optional)
   * @param {string} dateEnd - End date in YYYY-MM-DD format (optional)
   * @returns {string[]} Array of date strings that exist and fall within the range
   */
  getDateRange(endpointDir, dateStart, dateEnd) {
    if (!fs.existsSync(endpointDir)) {
      return [];
    }
    
    const availableDates = fs.readdirSync(endpointDir)
      .filter(item => {
        const itemPath = path.join(endpointDir, item);
        return fs.statSync(itemPath).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(item);
      })
      .sort();
    
    return availableDates.filter(dateStr => {
      if (dateStart && dateStr < dateStart) return false;
      if (dateEnd && dateStr > dateEnd) return false;
      return true;
    });
  }

  /**
   * Get all available dates in the specified endpoint directory
   * @param {string} endpointDir - The endpoint directory path
   * @returns {string[]} Array of all date strings that exist
   */
  getAvailableDates(endpointDir) {
    if (!fs.existsSync(endpointDir)) {
      return [];
    }
    
    return fs.readdirSync(endpointDir)
      .filter(item => {
        const itemPath = path.join(endpointDir, item);
        return fs.statSync(itemPath).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(item);
      })
      .sort();
  }

  /**
   * Get summary statistics for duplicate detection
   * @param {Array} duplicates - Array of duplicate information
   * @returns {Object} Summary statistics
   */
  getDuplicateStats(duplicates) {
    const totalSize = duplicates.reduce((sum, dup) => sum + dup.size, 0);
    const uniqueOriginals = new Set(duplicates.map(d => d.original));
    
    return {
      totalDuplicates: duplicates.length,
      totalSizeBytes: totalSize,
      totalSizeKB: (totalSize / 1024).toFixed(2),
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      uniqueOriginals: uniqueOriginals.size,
      averageSizeKB: duplicates.length > 0 ? (totalSize / duplicates.length / 1024).toFixed(2) : 0
    };
  }
}

module.exports = LogReplay;
