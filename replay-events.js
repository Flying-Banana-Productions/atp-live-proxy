#!/usr/bin/env node

/**
 * Event Log Replay Script
 * 
 * Replays saved API response logs through the event generator to reconstruct
 * and display the events that would have been generated during live operation.
 * 
 * Usage: node replay-events.js [options]
 */

const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const crypto = require('crypto');

// Console override for suppressing service module logs
let originalConsole = null;
let logsSupressed = false;

// Check CLI arguments early to determine if log suppression is needed
// This needs to happen before importing services
const shouldSuppressLogs = !process.argv.includes('--show-service-logs');

/**
 * Suppress logs from service modules to keep replay output clean
 * Filters out logs with service prefixes while preserving errors
 */
function suppressServiceLogs() {
  if (logsSupressed) return;
  
  originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info
  };

  // Service log prefixes to suppress
  const suppressPrefixes = [
    '[EVENTS]',
    '[WEBHOOK]',
    '[CACHE]',
    '[API]',
    '[POLLING]',
    '[DEBUG]'
  ];

  // Override console.log - suppress service logs
  console.log = function(message, ...args) {
    // Convert first argument to string for prefix checking
    const messageStr = String(message);
    
    // Check if message starts with any suppress prefix
    if (suppressPrefixes.some(prefix => messageStr.startsWith(prefix))) {
      return; // Suppress this log
    }
    
    // Allow non-service logs through
    originalConsole.log(message, ...args);
  };

  // Override console.warn - suppress service warnings but keep critical ones
  console.warn = function(message, ...args) {
    const messageStr = String(message);
    
    // Keep warnings that don't start with service prefixes
    if (!suppressPrefixes.some(prefix => messageStr.startsWith(prefix))) {
      originalConsole.warn(message, ...args);
    }
  };

  // Override console.info - suppress service info
  console.info = function(message, ...args) {
    const messageStr = String(message);
    
    if (!suppressPrefixes.some(prefix => messageStr.startsWith(prefix))) {
      originalConsole.info(message, ...args);
    }
  };

  // Keep console.error mostly intact but filter service debug errors
  console.error = function(message, ...args) {
    const messageStr = String(message);
    
    // Suppress only debug/verbose service errors, keep real errors
    if (messageStr.startsWith('[DEBUG]') || 
        (messageStr.includes('Error') && suppressPrefixes.some(prefix => messageStr.startsWith(prefix)))) {
      return;
    }
    
    originalConsole.error(message, ...args);
  };

  logsSupressed = true;
}

// Apply suppression immediately if needed
if (shouldSuppressLogs) {
  suppressServiceLogs();
}

/**
 * Restore original console methods
 */
function restoreServiceLogs() {
  if (!logsSupressed || !originalConsole) return;
  
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.info = originalConsole.info;
  
  logsSupressed = false;
}

/**
 * Standalone webhook client for replay events
 * Simplified version that doesn't depend on service modules
 */
class ReplayWebhookClient {
  constructor(webhookUrl, webhookSecret) {
    this.webhookUrl = webhookUrl;
    this.webhookSecret = webhookSecret;
    this.timeout = 10000; // 10 seconds
    this.retries = 3;
  }

  /**
   * Generate HMAC SHA-256 signature for webhook payload
   */
  generateSignature(payload, timestamp) {
    const signature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload + timestamp)
      .digest('hex');
    return `sha256=${signature}`;
  }

  /**
   * Send a single event to the webhook endpoint
   */
  async sendEvent(event) {
    const timestamp = new Date().toISOString();
    
    // Create payload with current timestamp
    const payload = {
      ...event,
      timestamp
    };

    const payloadString = JSON.stringify(payload);
    const signature = this.generateSignature(payloadString, timestamp);

    const headers = {
      'Content-Type': 'application/json',
      'X-ATP-Live-Signature': signature,
      'User-Agent': 'ATP-Live-Replay/1.0'
    };

    let lastError;
    
    // Retry logic with exponential backoff
    for (let attempt = 0; attempt < this.retries; attempt++) {
      try {
        const delay = attempt > 0 ? Math.min(1000 * Math.pow(2, attempt - 1), 5000) : 0;
        if (delay > 0) {
          await this.sleep(delay);
        }

        // Use dynamic import for axios to avoid dependency issues
        const axios = require('axios');
        const response = await axios.post(this.webhookUrl, payload, {
          headers,
          timeout: this.timeout,
          validateStatus: (status) => status >= 200 && status < 300
        });

        return { success: true, status: response.status };

      } catch (error) {
        lastError = error;
        
        if (error.response) {
          // Don't retry on 4xx errors (except 429 - rate limit)
          if (error.response.status >= 400 && error.response.status < 500 && error.response.status !== 429) {
            break;
          }
        }
      }
    }

    return { 
      success: false, 
      error: lastError?.response?.status || lastError?.code || lastError?.message || 'Unknown error' 
    };
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Deliver events in real-time with original timing intervals
 */
async function deliverEventsRealtime(events, options) {
  if (!events || events.length === 0) {
    console.log('No events to deliver');
    return { delivered: 0, failed: 0 };
  }

  const isSimulation = options.webhookDryRun;
  let webhookClient = null;
  
  if (!isSimulation) {
    webhookClient = new ReplayWebhookClient(options.webhookUrl, options.webhookSecret);
  }
  
  // Sort events chronologically by logTimestamp
  const sortedEvents = events.sort((a, b) => 
    new Date(a.logTimestamp) - new Date(b.logTimestamp));

  if (isSimulation) {
    console.log(`\n🔍 Starting webhook delivery dry-run (no http calls)...`);
  } else {
    console.log(`\nStarting real-time webhook delivery to ${options.webhookUrl}...`);
  }
  console.log(`Delivery settings: speed=${options.webhookSpeed}x, max-interval=${options.webhookMaxInterval}s`);
  console.log('Press Ctrl+C to interrupt delivery\n');

  let delivered = 0;
  let failed = 0;
  let previousTime = null;
  let interrupted = false;

  // Handle interruption
  const interruptHandler = () => {
    interrupted = true;
    console.log('\n⚠️  Delivery interrupted by user');
  };
  
  process.on('SIGINT', interruptHandler);

  try {
    for (let i = 0; i < sortedEvents.length && !interrupted; i++) {
      const event = sortedEvents[i];
      const currentTime = new Date(event.logTimestamp);
      
      // Calculate and apply timing delay
      if (previousTime) {
        const intervalMs = currentTime - previousTime;
        const cappedInterval = Math.min(intervalMs, options.webhookMaxInterval * 1000);
        const adjustedInterval = cappedInterval / options.webhookSpeed;
        
        if (adjustedInterval > 0) {
          const waitSeconds = Math.round(adjustedInterval / 1000);
          if (waitSeconds >= 1) {
            process.stdout.write(`⏳ Waiting ${waitSeconds}s...`);
            
            // Break waiting into smaller chunks to allow interruption
            const chunkSize = 500; // 500ms chunks
            for (let waited = 0; waited < adjustedInterval && !interrupted; waited += chunkSize) {
              await new Promise(resolve => setTimeout(resolve, Math.min(chunkSize, adjustedInterval - waited)));
            }
            
            if (interrupted) break;
            
            // Clear the waiting message
            process.stdout.write('\r' + ' '.repeat(20) + '\r');
          } else if (adjustedInterval > 10) {
            // Small delay but still noticeable
            await new Promise(resolve => setTimeout(resolve, adjustedInterval));
          }
        }
      }

      if (interrupted) break;

      // Format timestamp for display
      const timeStr = currentTime.toISOString().substr(11, 8); // HH:MM:SS format
      
      // Send the event (or simulate it)
      process.stdout.write(`[${i + 1}/${sortedEvents.length}] ${timeStr} - ${event.event_type.toUpperCase()}: ${event.description.substring(0, 60)}${event.description.length > 60 ? '...' : ''}`);
      
      if (isSimulation) {
        // Simulate successful delivery
        delivered++;
        console.log(' ✅ (dry-run)');
      } else {
        const result = await webhookClient.sendEvent(event);
        
        if (result.success) {
          delivered++;
          console.log(' ✅');
        } else {
          failed++;
          console.log(` ❌ (${result.error})`);
        }
      }

      previousTime = currentTime;
    }
  } finally {
    process.removeListener('SIGINT', interruptHandler);
  }

  // Summary
  const totalTime = sortedEvents.length > 0 ? 
    Math.round((new Date(sortedEvents[sortedEvents.length - 1].logTimestamp) - new Date(sortedEvents[0].logTimestamp)) / 1000) : 0;
  const duration = totalTime > 0 ? 
    `${Math.floor(totalTime / 60)}m ${totalTime % 60}s` : '0s';

  if (isSimulation) {
    console.log(`\n📊 Webhook delivery dry-run ${interrupted ? 'interrupted' : 'complete'}:`);
    console.log(`   ✅ ${delivered} events simulated successfully`);
    console.log(`   ⏱️  Original timespan: ${duration} (${sortedEvents.length} events)`);
    console.log(`   🔍 All webhook calls were dry-run - no actual HTTP requests sent`);
  } else {
    console.log(`\n📊 Real-time delivery ${interrupted ? 'interrupted' : 'complete'}:`);
    console.log(`   ✅ ${delivered} events delivered successfully`);
    if (failed > 0) {
      console.log(`   ❌ ${failed} events failed`);
    }
    console.log(`   ⏱️  Original timespan: ${duration} (${sortedEvents.length} events)`);
  }

  return { delivered, failed, interrupted };
}

// Import services AFTER setting up console override (if needed)
const LogReplay = require('./src/utils/logReplay');
const { formatTable, formatJson, formatSummary, formatDuplicates } = require('./src/utils/outputFormatters');

// CLI Configuration
program
  .name('replay-events')
  .description('Replay ATP API logs through the event generator\nNote: Service module logs are suppressed by default for cleaner output')
  .version('1.0.0')
  .option('-d, --log-dir <path>', 'Path to log directory', './logs/api-responses')
  .option('-e, --endpoint <name>', 'Filter by endpoint')
  .option('--date <YYYY-MM-DD>', 'Filter by specific date (default: latest)')
  .option('--start <HH:MM>', 'Start time filter')
  .option('--end <HH:MM>', 'End time filter')
  .option('-f, --format <type>', 'Output format: json, table, summary', 'table')
  .option('-o, --output <file>', 'Save results to file (optional)')
  .option('--no-colors', 'Disable colored output')
  .option('-v, --verbose', 'Show detailed logging information')
  .option('--detect-duplicates', 'Detect log files with identical data')
  .option('--prune', 'Delete redundant duplicate log files (keeps earliest)')
  .option('--prune-dry-run', 'Show what files would be deleted without actually deleting')
  .option('--show-service-logs', 'Show service module logs (webhook, events, cache, etc.)')
  .option('--webhook-url <url>', 'Webhook endpoint URL for real-time event delivery')
  .option('--webhook-secret <secret>', 'HMAC secret for webhook authentication')
  .option('--webhook-realtime', 'Enable real-time webhook delivery with original timing')
  .option('--webhook-dry-run', 'Simulate webhook delivery with full timing but skip HTTP calls')
  .option('--webhook-max-interval <seconds>', 'Maximum interval between events in seconds (default: 60)', '60')
  .option('--webhook-speed <multiplier>', 'Speed multiplier for event delivery (e.g., 2.0 = 2x speed)', '1.0');

program.parse();
const options = program.opts();

// Log suppression already applied early if needed

// Track if format was explicitly set by user (not just the default)
const formatExplicitlySet = process.argv.some(arg => arg.startsWith('--format') || arg === '-f');

// Validate format option
const validFormats = ['json', 'table', 'summary'];
if (!validFormats.includes(options.format)) {
  console.error(`Error: Invalid format '${options.format}'. Must be one of: ${validFormats.join(', ')}`);
  process.exit(1);
}

// Validate that --endpoint is specified when using --detect-duplicates
if (options.detectDuplicates && !options.endpoint) {
  console.error('Error: --endpoint <name> is required when using --detect-duplicates');
  console.error('Usage: node replay-events.js --detect-duplicates --endpoint <endpoint>');
  console.error('Available endpoints: live-matches, draws-live, etc.');
  process.exit(1);
}

// Validate webhook options (except for webhook dry run mode)
if (options.webhookRealtime && !options.webhookDryRun && (!options.webhookUrl || !options.webhookSecret)) {
  console.error('Error: --webhook-url and --webhook-secret are required when using --webhook-realtime');
  console.error('Usage: node replay-events.js --webhook-realtime --webhook-url <url> --webhook-secret <secret>');
  console.error('Note: URL and secret are optional when using --webhook-dry-run');
  process.exit(1);
}

// Parse numeric options
if (options.webhookMaxInterval) {
  const interval = parseFloat(options.webhookMaxInterval);
  if (isNaN(interval) || interval <= 0) {
    console.error('Error: --webhook-max-interval must be a positive number');
    process.exit(1);
  }
  options.webhookMaxInterval = interval;
}

if (options.webhookSpeed) {
  const speed = parseFloat(options.webhookSpeed);
  if (isNaN(speed) || speed <= 0) {
    console.error('Error: --webhook-speed must be a positive number');
    process.exit(1);
  }
  options.webhookSpeed = speed;
}

// Validate log directory exists
if (!fs.existsSync(options.logDir)) {
  console.error(`Error: Log directory '${options.logDir}' does not exist`);
  process.exit(1);
}

// Main execution
async function main() {
  try {
    // Initialize replay service
    const replayer = new LogReplay({
      logDir: options.logDir,
      endpoint: options.endpoint,
      verbose: options.verbose,
      colors: options.colors
    });

    // Discover log files
    const files = await replayer.discoverLogFiles({
      date: options.date,
      startTime: options.start,
      endTime: options.end
    });

    if (files.length === 0) {
      console.log('No log files found matching the specified criteria.');
      return;
    }

    if (options.verbose) {
      console.log(`Found ${files.length} log files to process`);
    }

    // Duplicate detection mode
    if (options.detectDuplicates) {
      if (options.verbose) {
        console.log('Detecting duplicate files...');
      }
      
      const duplicates = await replayer.detectDuplicates(files);
      let pruneResults = null;
      
      // Handle pruning if requested
      if (options.prune || options.pruneDryRun) {
        const dryRun = options.pruneDryRun || false;
        if (options.verbose) {
          const action = dryRun ? 'Simulating pruning' : 'Pruning duplicates';
          console.log(`${action}...`);
        }
        pruneResults = await replayer.pruneDuplicates(duplicates, dryRun);
      }
      
      // Format and display duplicate results
      const output = formatDuplicates(duplicates, pruneResults, options.colors);
      
      if (options.output) {
        fs.writeFileSync(options.output, output);
        console.log(`Results saved to ${options.output}`);
      } else {
        console.log(output);
      }
      
      // If only detecting duplicates (not continuing with replay), exit here  
      // Continue with replay only if user explicitly specified a format for replay output
      const shouldContinueWithReplay = formatExplicitlySet;
      if (!shouldContinueWithReplay) {
        return;
      }
    }

    // Process logs and generate events
    if (options.verbose) {
      console.log('Processing logs through event generator...');
    }

    const results = await replayer.replayLogs(files);

    // Webhook real-time delivery if enabled
    if (options.webhookRealtime) {
      const deliveryResult = await deliverEventsRealtime(results.events, options);
      
      // Don't show regular output if delivery was interrupted
      if (deliveryResult.interrupted) {
        return;
      }
    }

    // Format output
    let output;
    switch (options.format) {
      case 'json':
        output = formatJson(results);
        break;
      case 'summary':
        output = formatSummary(results, options.colors);
        break;
      case 'table':
      default:
        output = formatTable(results, options.colors);
        break;
    }

    // Save to file or print to console
    if (options.output) {
      fs.writeFileSync(options.output, output);
      console.log(`Results saved to ${options.output}`);
    } else {
      console.log(output);
    }

  } catch (error) {
    console.error('Error during replay:', error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Handle SIGINT gracefully
process.on('SIGINT', () => {
  console.log('\nReplay interrupted by user');
  restoreServiceLogs();
  process.exit(0);
});

// Restore logs on normal exit
process.on('exit', () => {
  restoreServiceLogs();
});

// Run the script
main();
