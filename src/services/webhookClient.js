const axios = require('axios');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const config = require('../config');

/**
 * Webhook client service for sending ATP Live events to configured webhooks
 * Handles authentication, retries, and batching
 */
class WebhookClientService {
  constructor() {
    this.webhookUrl = config.events.webhookUrl;
    this.webhookSecret = config.events.webhookSecret;
    this.isEnabled = !!(this.webhookUrl && this.webhookSecret);
    this.timeout = config.events.webhookTimeout || 5000;
    this.retries = config.events.webhookRetries || 3;
    this.batchSize = config.events.webhookBatchSize || 10;
    this.eventQueue = [];
    this.batchTimer = null;
    this.batchInterval = config.events.webhookBatchInterval || 2000; // 2 seconds

    if (this.isEnabled) {
      console.log(`[WEBHOOK] Webhook client enabled, target: ${this.webhookUrl}`);
    } else {
      console.log('[WEBHOOK] Webhook client disabled - missing webhookUrl or webhookSecret');
    }
  }

  /**
   * Generate HMAC SHA-256 signature for webhook payload
   * @param {string} payload - JSON payload as string
   * @param {string} timestamp - ISO timestamp
   * @returns {string} Signature in format "sha256=<hex>"
   */
  generateSignature(payload, timestamp) {
    if (!this.webhookSecret) {
      throw new Error('Webhook secret not configured');
    }

    const signature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload + timestamp)
      .digest('hex');

    return `sha256=${signature}`;
  }

  /**
   * Send events to webhook endpoint
   * @param {Array} events - Array of events to send
   * @returns {Promise<boolean>} Success status
   */
  async sendEvents(events) {
    if (!this.isEnabled || !events || events.length === 0) {
      return false;
    }

    const timestamp = new Date().toISOString();
    
    // Create payload based on whether it's a single event or batch
    let payload;
    if (events.length === 1) {
      // Single event - send directly
      payload = {
        ...events[0],
        timestamp
      };
    } else {
      // Multiple events - send as batch
      payload = {
        batch_id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp,
        events: events.map(event => ({ ...event, timestamp: event.timestamp || timestamp }))
      };
    }

    const payloadString = JSON.stringify(payload);
    const signature = this.generateSignature(payloadString, timestamp);

    const headers = {
      'Content-Type': 'application/json',
      'X-ATP-Live-Signature': signature,
      'User-Agent': 'ATP-Live-Proxy/1.0'
    };

    let lastError;
    
    // Retry logic with exponential backoff
    for (let attempt = 0; attempt < this.retries; attempt++) {
      try {
        const delay = attempt > 0 ? Math.min(1000 * Math.pow(2, attempt - 1), 10000) : 0;
        if (delay > 0) {
          console.log(`[WEBHOOK] Retrying in ${delay}ms (attempt ${attempt + 1}/${this.retries})`);
          await this.sleep(delay);
        }

        const response = await axios.post(this.webhookUrl, payload, {
          headers,
          timeout: this.timeout,
          validateStatus: (status) => status >= 200 && status < 300,
          // Disable keep-alive to prevent connection pooling (especially in tests)
          httpAgent: new http.Agent({ keepAlive: false }),
          httpsAgent: new https.Agent({ keepAlive: false })
        });

        console.log(`[WEBHOOK] Successfully sent ${events.length} event(s) to ${this.webhookUrl} (${response.status})`);
        return true;

      } catch (error) {
        lastError = error;
        const isLastAttempt = attempt === this.retries - 1;
        
        if (error.response) {
          // HTTP error response
          console.error(`[WEBHOOK] HTTP error ${error.response.status}: ${error.response.data?.message || error.message}`);
          
          // Don't retry on 4xx errors (except 429 - rate limit)
          if (error.response.status >= 400 && error.response.status < 500 && error.response.status !== 429) {
            console.error(`[WEBHOOK] Not retrying due to client error ${error.response.status}`);
            break;
          }
        } else if (error.request) {
          // Network error
          console.error(`[WEBHOOK] Network error: ${error.message}`);
        } else {
          // Other error
          console.error(`[WEBHOOK] Error: ${error.message}`);
        }

        if (!isLastAttempt) {
          console.log(`[WEBHOOK] Will retry (attempt ${attempt + 1}/${this.retries})`);
        }
      }
    }

    console.error(`[WEBHOOK] Failed to send events after ${this.retries} attempts:`, lastError?.message);
    return false;
  }

  /**
   * Add events to the queue for batched sending
   * @param {Array|Object} events - Single event or array of events
   */
  queueEvents(events) {
    if (!this.isEnabled) {
      return;
    }

    const eventArray = Array.isArray(events) ? events : [events];
    this.eventQueue.push(...eventArray);

    // In test environment, flush immediately to avoid timers
    if (process.env.NODE_ENV === 'test') {
      this.flushQueue();
      return;
    }

    // If we've reached the batch size, send immediately
    if (this.eventQueue.length >= this.batchSize) {
      this.flushQueue();
    } else {
      // Otherwise, set a timer to send after the interval
      this.resetBatchTimer();
    }
  }

  /**
   * Send all queued events immediately
   */
  async flushQueue() {
    if (this.eventQueue.length === 0) {
      return;
    }

    this.clearBatchTimer();
    
    const eventsToSend = this.eventQueue.splice(0);
    console.log(`[WEBHOOK] Flushing queue with ${eventsToSend.length} event(s)`);
    
    try {
      await this.sendEvents(eventsToSend);
    } catch (error) {
      console.error('[WEBHOOK] Error flushing queue:', error.message);
    }
  }

  /**
   * Reset the batch timer
   */
  resetBatchTimer() {
    this.clearBatchTimer();
    this.batchTimer = setTimeout(() => {
      this.flushQueue();
    }, this.batchInterval);
  }

  /**
   * Clear the batch timer
   */
  clearBatchTimer() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * Utility function to sleep for a given number of milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} Promise that resolves after the delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get configuration info
   * @returns {Object} Current webhook client configuration
   */
  getConfig() {
    return {
      enabled: this.isEnabled,
      webhookUrl: this.webhookUrl,
      hasSecret: !!this.webhookSecret,
      timeout: this.timeout,
      retries: this.retries,
      batchSize: this.batchSize,
      batchInterval: this.batchInterval,
      queueSize: this.eventQueue.length
    };
  }

  /**
   * Get statistics about webhook delivery
   * @returns {Object} Webhook client statistics
   */
  getStats() {
    return {
      enabled: this.isEnabled,
      queueSize: this.eventQueue.length,
      batchTimerActive: !!this.batchTimer
    };
  }

  /**
   * Shutdown the webhook client gracefully
   */
  async shutdown() {
    console.log('[WEBHOOK] Shutting down webhook client...');
    this.clearBatchTimer();
    
    if (this.eventQueue.length > 0) {
      console.log(`[WEBHOOK] Flushing ${this.eventQueue.length} remaining events...`);
      await this.flushQueue();
    }
    
    console.log('[WEBHOOK] Webhook client shutdown complete');
  }
}

module.exports = new WebhookClientService();