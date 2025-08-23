const { validateEvent } = require('../types/events');
const config = require('../config');
const webhookClient = require('./webhookClient');

/**
 * Event output service for handling generated events
 * Currently supports console output, designed for future webhook/notification extensions
 */
class EventOutputService {
  constructor() {
    this.isEnabled = config.events.enabled;
    this.outputHandlers = [];
    
    // Add console output handler if enabled
    if (config.events.consoleOutput) {
      this.outputHandlers.push(this.consoleOutput.bind(this));
    }

    // Add webhook output handler if enabled
    if (config.events.webhookUrl && config.events.webhookSecret) {
      this.outputHandlers.push(this.webhookOutput.bind(this));
      console.log('[EVENTS] Webhook output handler enabled');
    }
  }

  /**
   * Output events using all configured handlers
   * @param {Array|Object} events - Single event or array of events
   */
  output(events) {
    if (!this.isEnabled) {
      return;
    }

    const eventArray = Array.isArray(events) ? events : [events];
    
    // Validate all events
    const validEvents = eventArray.filter(event => {
      if (!validateEvent(event)) {
        console.warn('[EVENTS] Invalid event structure:', event);
        return false;
      }
      return true;
    });

    if (validEvents.length === 0) {
      return;
    }

    // Send to all output handlers
    this.outputHandlers.forEach(handler => {
      try {
        handler(validEvents);
      } catch (error) {
        console.error('[EVENTS] Error in output handler:', error.message);
      }
    });
  }

  /**
   * Console output handler - logs events to console with formatting
   * @param {Array} events - Array of valid events
   */
  consoleOutput(events) {
    const timestamp = new Date().toISOString();
    
    if (events.length === 1) {
      const event = events[0];
      console.log(`[${timestamp}] 🎾 ${event.event_type.toUpperCase()}: ${event.description}`);
      if (event.data && Object.keys(event.data).length > 0) {
        console.log('   ↳ Data:', JSON.stringify(event.data, null, 2));
      }
    } else {
      console.log(`[${timestamp}] 🎾 ${events.length} events generated:`);
      events.forEach(event => {
        console.log(`   ↳ ${event.event_type.toUpperCase()}: ${event.description}`);
      });
    }
  }

  /**
   * Webhook output handler - sends events to configured webhook endpoint
   * @param {Array} events - Array of valid events
   */
  webhookOutput(events) {
    try {
      // Queue events for batched sending via webhook client
      webhookClient.queueEvents(events);
    } catch (error) {
      console.error('[EVENTS] Error sending events to webhook:', error.message);
    }
  }

  /**
   * Add a new output handler
   * @param {Function} handler - Function that takes array of events
   */
  addOutputHandler(handler) {
    if (typeof handler === 'function') {
      this.outputHandlers.push(handler);
    }
  }

  /**
   * Enable/disable event output
   * @param {boolean} enabled - Whether to output events
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
  }

  /**
   * Get current configuration
   * @returns {Object} Current output service config
   */
  getConfig() {
    return {
      enabled: this.isEnabled,
      handlers: this.outputHandlers.length,
      webhookConfig: webhookClient.getConfig()
    };
  }
}

module.exports = new EventOutputService();