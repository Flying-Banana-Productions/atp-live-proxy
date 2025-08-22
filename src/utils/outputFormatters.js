/**
 * Output Formatters for Event Replay Results
 * 
 * Provides different formatting options for displaying replay results:
 * - Table format: Human-readable table with colors
 * - JSON format: Machine-readable structured data  
 * - Summary format: Compact overview with statistics
 */

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  
  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m'
};

/**
 * Event type color mapping for better readability
 */
const eventTypeColors = {
  match_started: colors.green,
  match_finished: colors.red,
  score_updated: colors.blue,
  set_completed: colors.magenta,
  match_suspended: colors.yellow,
  match_resumed: colors.cyan,
  toilet_break: colors.dim,
  medical_timeout: colors.yellow,
  challenge_in_progress: colors.blue,
  correction_mode: colors.dim,
  umpire_on_court: colors.cyan,
  warmup_started: colors.green
};

/**
 * Apply color to text if colors are enabled
 * @param {string} text - Text to colorize
 * @param {string} color - ANSI color code
 * @param {boolean} enabled - Whether colors are enabled
 * @returns {string} Colored or plain text
 */
function colorize(text, color, enabled = true) {
  return enabled ? `${color}${text}${colors.reset}` : text;
}

/**
 * Format results as a readable table
 * @param {Object} results - Replay results object
 * @param {boolean} colorsEnabled - Whether to use colors
 * @returns {string} Formatted table output
 */
function formatTable(results, colorsEnabled = true) {
  const { replayInfo, events, errors } = results;
  
  const output = [];
  
  // Header
  const dateStr = replayInfo.startTime ? new Date(replayInfo.startTime).toISOString().split('T')[0] : 'Unknown';
  const header = `Event Replay Results - ${dateStr} (${replayInfo.filesProcessed} log files processed)`;
  output.push(colorize(header, colors.bright + colors.cyan, colorsEnabled));
  output.push(colorize('='.repeat(header.length), colors.dim, colorsEnabled));
  output.push('');

  if (events.length === 0) {
    output.push('No events generated from the log files.');
    if (errors.length > 0) {
      output.push('');
      output.push(colorize(`Errors encountered: ${errors.length} files could not be processed`, colors.red, colorsEnabled));
    }
    return output.join('\n');
  }

  // Table header
  const tableHeader = 'Time     | Event Type      | Match ID | Description';
  const tableSeparator = '---------|-----------------|----------|---------------------------';
  
  output.push(colorize(tableHeader, colors.bright, colorsEnabled));
  output.push(colorize(tableSeparator, colors.dim, colorsEnabled));

  // Table rows
  events.forEach(event => {
    const time = event.logTimestamp ? 
      new Date(event.logTimestamp).toTimeString().substring(0, 8) : 
      'Unknown';
    
    const eventType = event.event_type.padEnd(15);
    const matchId = (event.match_id || 'N/A').padEnd(8);
    const description = event.description || 'No description';

    // Apply color to event type
    const coloredEventType = colorize(
      eventType, 
      eventTypeColors[event.event_type] || colors.white, 
      colorsEnabled
    );

    const row = `${time} | ${coloredEventType} | ${matchId} | ${description}`;
    output.push(row);
  });

  // Summary
  output.push('');
  const eventStats = getEventTypeStats(events);
  const statsText = Object.entries(eventStats)
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');
  
  const summary = `Summary: ${events.length} events generated (${statsText})`;
  output.push(colorize(summary, colors.bright + colors.green, colorsEnabled));

  // Warnings about errors
  if (errors.length > 0) {
    output.push('');
    output.push(colorize(`Warnings: ${errors.length} files had processing errors`, colors.yellow, colorsEnabled));
  }

  return output.join('\n');
}

/**
 * Format results as JSON
 * @param {Object} results - Replay results object
 * @returns {string} Formatted JSON output
 */
function formatJson(results) {
  // Create a clean copy without internal fields
  const cleanResults = {
    replay_info: {
      ...results.replayInfo,
      events_generated: results.events.length,
      errors_count: results.errors.length
    },
    events: results.events.map(event => {
      // Remove internal fields added during replay
      const { logFile, logTimestamp, ...cleanEvent } = event;
      return {
        ...cleanEvent,
        replay_metadata: {
          log_file: logFile,
          log_timestamp: logTimestamp
        }
      };
    }),
    errors: results.errors
  };

  return JSON.stringify(cleanResults, null, 2);
}

/**
 * Format results as a compact summary
 * @param {Object} results - Replay results object
 * @param {boolean} colorsEnabled - Whether to use colors
 * @returns {string} Formatted summary output
 */
function formatSummary(results, colorsEnabled = true) {
  const { replayInfo, events, errors } = results;
  
  const output = [];
  
  // Header
  const dateStr = replayInfo.startTime ? new Date(replayInfo.startTime).toISOString().split('T')[0] : 'Unknown';
  const header = `Event Replay Summary for ${dateStr}`;
  output.push(colorize(header, colors.bright + colors.cyan, colorsEnabled));
  output.push(colorize('='.repeat(header.length), colors.dim, colorsEnabled));
  
  // Basic stats
  output.push(`Files processed: ${colorize(replayInfo.filesProcessed, colors.bright, colorsEnabled)} logs`);
  
  if (replayInfo.startTime && replayInfo.endTime) {
    const startTime = new Date(replayInfo.startTime).toTimeString().substring(0, 8);
    const endTime = new Date(replayInfo.endTime).toTimeString().substring(0, 8);
    output.push(`Time range: ${startTime} - ${endTime}`);
  }
  
  output.push(`Total events: ${colorize(events.length, colors.bright + colors.green, colorsEnabled)}`);
  output.push('');

  if (events.length > 0) {
    // Event breakdown
    output.push('Event breakdown:');
    const eventStats = getEventTypeStats(events);
    
    Object.entries(eventStats)
      .sort((a, b) => b[1] - a[1]) // Sort by count, descending
      .forEach(([type, count]) => {
        const bullet = colorize('•', eventTypeColors[type] || colors.white, colorsEnabled);
        output.push(`  ${bullet} ${type}: ${colorize(count, colors.bright, colorsEnabled)} events`);
      });

    // Match tracking
    const uniqueMatches = [...new Set(events.map(e => e.match_id).filter(Boolean))];
    if (uniqueMatches.length > 0) {
      output.push('');
      output.push(`Matches tracked: ${uniqueMatches.join(', ')}`);
    }
  }

  // Warnings
  if (errors.length > 0) {
    output.push('');
    output.push(colorize(`⚠️ Warnings: ${errors.length} files had processing errors`, colors.yellow, colorsEnabled));
  }

  return output.join('\n');
}

/**
 * Get event type statistics from events array
 * @param {Array} events - Array of events
 * @returns {Object} Event type counts
 */
function getEventTypeStats(events) {
  const stats = {};
  events.forEach(event => {
    stats[event.event_type] = (stats[event.event_type] || 0) + 1;
  });
  return stats;
}


module.exports = {
  formatTable,
  formatJson, 
  formatSummary,
  colors,
  colorize
};