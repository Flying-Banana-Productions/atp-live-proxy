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
const LogReplay = require('./src/utils/logReplay');
const { formatTable, formatJson, formatSummary, formatDuplicates } = require('./src/utils/outputFormatters');

// CLI Configuration
program
  .name('replay-events')
  .description('Replay ATP API logs through the event generator')
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
  .option('--dry-run', 'Show files that would be processed without running replay')
  .option('--detect-duplicates', 'Detect log files with identical data')
  .option('--prune', 'Delete redundant duplicate log files (keeps earliest)')
  .option('--prune-dry-run', 'Show what files would be deleted without actually deleting');

program.parse();
const options = program.opts();

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

    // Dry run mode - just show files
    if (options.dryRun && !options.detectDuplicates) {
      console.log('Dry run mode - files that would be processed:');
      files.forEach((file, index) => {
        const timestamp = replayer.extractTimestamp(file);
        console.log(`  ${index + 1}. ${timestamp} - ${path.basename(file)}`);
      });
      return;
    }

    // Skip replay if we only wanted duplicate detection (this is handled above now)

    // Process logs and generate events
    if (options.verbose) {
      console.log('Processing logs through event generator...');
    }

    const results = await replayer.replayLogs(files);

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
  process.exit(0);
});

// Run the script
main();