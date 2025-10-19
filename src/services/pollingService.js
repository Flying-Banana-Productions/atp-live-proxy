const atpApi = require('./atpApi');
const cacheService = require('./cache');
const subscriptionService = require('./subscriptionService');
const { getEndpointTtl } = require('../middleware/cache');
const eventGenerator = require('./eventGenerator');
const apiLogger = require('./apiLogger');
const config = require('../config');

/**
 * Background polling service for WebSocket updates and event generation
 * Fetches data from ATP API at configured TTL intervals
 * and broadcasts updates to subscribed clients while generating events
 */
class PollingService {
  constructor() {
    this.pollingTimeouts = new Map(); // Changed from intervals to timeouts
    this.isRunning = false;
    // Track polling reasons for each endpoint: 'subscription', 'events', or both
    this.pollingReasons = new Map();
    // Track back-off state for each endpoint
    this.backoffStates = new Map();
  }

  /**
   * Start the polling service
   * @param {Object} io - Socket.io instance for broadcasting
   */
  start(io) {
    if (this.isRunning) {
      console.log('[POLLING] Service already running');
      return;
    }

    this.io = io;
    this.isRunning = true;
    console.log('[POLLING] Background polling service started');

    // Start polling for all subscribed endpoints
    this.startPollingForSubscribedEndpoints();
    
    // Start polling for event-monitored endpoints
    this.startEventPolling();
  }

  /**
   * Stop the polling service
   */
  stop() {
    this.isRunning = false;
    
    // Clear all polling timeouts
    for (const [endpoint, timeout] of this.pollingTimeouts) {
      clearTimeout(timeout);
      console.log(`[POLLING] Stopped polling for ${endpoint}`);
    }
    this.pollingTimeouts.clear();
    this.backoffStates.clear();
    
    console.log('[POLLING] Background polling service stopped');
  }

  /**
   * Start polling for all currently subscribed endpoints
   */
  startPollingForSubscribedEndpoints() {
    const stats = subscriptionService.getStats();
    
    for (const endpoint of stats.endpoints) {
      this.startPollingForEndpoint(endpoint, 'subscription');
    }
  }

  /**
   * Start polling for event-monitored endpoints
   */
  startEventPolling() {
    if (!config.events.enabled) {
      console.log('[POLLING] Event generation disabled, skipping event polling');
      return;
    }

    const eventEndpoints = config.events.endpoints;
    console.log(`[POLLING] Starting event polling for: ${eventEndpoints.join(', ')}`);
    
    for (const endpoint of eventEndpoints) {
      this.startPollingForEndpoint(endpoint, 'events');
    }
  }

  /**
   * Start polling for a specific endpoint
   * @param {string} endpoint - API endpoint path
   * @param {string} reason - Reason for polling: 'subscription', 'events', or existing
   */
  startPollingForEndpoint(endpoint, reason = 'subscription') {
    // Track the reason for polling
    const existingReasons = this.pollingReasons.get(endpoint) || new Set();
    existingReasons.add(reason);
    this.pollingReasons.set(endpoint, existingReasons);

    if (this.pollingTimeouts.has(endpoint)) {
      console.log(`[POLLING] Already polling for ${endpoint}, added reason: ${reason}`);
      return;
    }

    // Initialize back-off state for this endpoint
    const baseTtl = getEndpointTtl(endpoint);
    this.backoffStates.set(endpoint, {
      baseInterval: baseTtl * 1000, // Convert to milliseconds
      currentMultiplier: 1,
      consecutiveErrors: 0,
      isBackedOff: false
    });

    const reasonsStr = Array.from(existingReasons).join('+');
    console.log(`[POLLING] Starting to poll ${endpoint} every ${baseTtl} seconds (${reasonsStr})`);

    // Start the polling cycle
    this.scheduleNextPoll(endpoint);
  }

  /**
   * Stop polling for a specific endpoint for a specific reason
   * @param {string} endpoint - API endpoint path
   * @param {string} reason - Reason to stop: 'subscription' or 'events'
   */
  stopPollingForEndpoint(endpoint, reason = 'subscription') {
    const reasons = this.pollingReasons.get(endpoint);
    if (!reasons) {
      return; // Not polling this endpoint
    }

    // Remove this specific reason
    reasons.delete(reason);
    
    if (reasons.size === 0) {
      // No more reasons to poll, stop completely
      const timeout = this.pollingTimeouts.get(endpoint);
      if (timeout) {
        clearTimeout(timeout);
        this.pollingTimeouts.delete(endpoint);
        this.pollingReasons.delete(endpoint);
        this.backoffStates.delete(endpoint);
        console.log(`[POLLING] Stopped polling for ${endpoint} (no more reasons)`);
      }
    } else {
      // Still have other reasons to poll
      const reasonsStr = Array.from(reasons).join('+');
      console.log(`[POLLING] Removed ${reason} reason for ${endpoint}, still polling for: ${reasonsStr}`);
    }
  }

  /**
   * Schedule the next poll for an endpoint
   * @param {string} endpoint - API endpoint path
   */
  scheduleNextPoll(endpoint) {
    if (!this.isRunning || !this.pollingReasons.has(endpoint)) {
      return;
    }

    // Perform the fetch
    this.fetchAndBroadcast(endpoint).then(() => {
      // Schedule next poll after fetch completes
      const backoffState = this.backoffStates.get(endpoint);
      if (backoffState) {
        const nextInterval = backoffState.baseInterval * backoffState.currentMultiplier;
        const timeout = setTimeout(() => {
          this.scheduleNextPoll(endpoint);
        }, nextInterval);
        this.pollingTimeouts.set(endpoint, timeout);
      }
    });
  }

  /**
   * Apply back-off to an endpoint's polling interval
   * @param {string} endpoint - API endpoint path
   */
  applyBackoff(endpoint) {
    const backoffState = this.backoffStates.get(endpoint);
    if (!backoffState || !config.polling.backoff.enabled) {
      return;
    }

    const previousMultiplier = backoffState.currentMultiplier;
    backoffState.currentMultiplier = Math.min(config.polling.backoff.maxMultiplier, previousMultiplier * config.polling.backoff.multiplier);
    backoffState.consecutiveErrors++;
    backoffState.isBackedOff = true;

    // Stop logging changes to the polling backoff after we've hit the limit
    if(previousMultiplier < config.polling.backoff.maxMultiplier) {
      const previousIntervalSeconds = Math.round((previousMultiplier * backoffState.baseInterval) / 1000);
      const newIntervalSeconds = Math.round((backoffState.baseInterval * backoffState.currentMultiplier) / 1000);

      console.log(`[POLLING BACKOFF] ${endpoint}: Backing off from ${previousIntervalSeconds}s to ${newIntervalSeconds}s (${backoffState.consecutiveErrors} consecutive 404s)`);
    }
  }

  /**
   * Reset back-off for an endpoint
   * @param {string} endpoint - API endpoint path
   */
  resetBackoff(endpoint) {
    const backoffState = this.backoffStates.get(endpoint);
    if (!backoffState || !config.polling.backoff.resetOnSuccess) {
      return;
    }

    if (backoffState.isBackedOff) {
      const previousInterval = (backoffState.baseInterval * backoffState.currentMultiplier) / 1000;
      const baseInterval = backoffState.baseInterval / 1000;
      console.log(`[POLLING BACKOFF] ${endpoint}: Resetting back-off from ${previousInterval}s to ${baseInterval}s (data available again)`);
    }

    backoffState.currentMultiplier = 1;
    backoffState.consecutiveErrors = 0;
    backoffState.isBackedOff = false;
  }

  /**
   * Fetch data for an endpoint and broadcast to subscribers
   * @param {string} endpoint - API endpoint path
   */
  async fetchAndBroadcast(endpoint) {
    try {
      console.log(`[POLLING] Fetching data for ${endpoint}`);
      
      // Fetch fresh data from ATP API
      const result = await this.fetchEndpointData(endpoint);
      
      if (result && result.status === 404) {
        // Apply back-off for 404 responses
        this.applyBackoff(endpoint);
        return; // Don't broadcast or cache 404s
      }
      
      if (result && result.data) {
        // Reset back-off on successful response
        this.resetBackoff(endpoint);
        
        const data = result.data;
        
        // Log API response if logging is enabled and this is an event-monitored endpoint
        if (config.apiLogging.enabled && this.shouldLogEndpoint(endpoint)) {
          await apiLogger.logResponse(endpoint, data, {
            source: 'polling-service',
            poll_cycle: Date.now()
          });
        }
        
        // Generate events before caching (events need to compare with previous state)
        eventGenerator.processData(endpoint, data);

        
        // Update cache
        const ttl = getEndpointTtl(endpoint);
        const cacheKey = cacheService.generateKey(endpoint);
        cacheService.set(cacheKey, data, ttl);
        
        // Prepare response in same format as REST API
        const response = {
          data,
          cached: false,
          timestamp: new Date().toISOString(),
          ttl,
        };

        // Broadcast to all subscribed clients
        const numSubs = subscriptionService.getSubscribers(endpoint).size;
        if(numSubs > 0) {
          this.broadcastUpdate(endpoint, response);
          console.log(`[POLLING] Broadcasted update for ${endpoint} to ${numSubs} subscribers`);
        }
      }
    } catch (error) {
      if(Object.keys(error).length == 0) return;
      console.error(`[POLLING] Error fetching data for ${endpoint}:`, error.message);
    }
  }

  /**
   * Fetch data for a specific endpoint
   * @param {string} endpoint - API endpoint path
   * @returns {Object} API response with status { data, status }
   */
  async fetchEndpointData(endpoint) {
    // Map endpoint paths to ATP API methods
    const endpointMap = {
      '/api/live-matches': () => atpApi.getLiveMatches(),
      '/api/draws/live': () => atpApi.getLiveDraw(),
      '/api/draws': () => atpApi.getDraws(),
      '/api/h2h/match': () => atpApi.getH2HByMatch(), // This needs matchId parameter
      '/api/h2h': () => atpApi.getH2H(), // This needs playerId and opponentId parameters
      '/api/match-stats': () => atpApi.getMatchStats(), // This needs matchId parameter
      '/api/player-list': () => atpApi.getPlayerList(),
      '/api/results': () => atpApi.getResults(),
      '/api/schedules': () => atpApi.getSchedule(),
      '/api/team-cup-rankings': () => atpApi.getTeamCupRankings(),
    };

    const apiMethod = endpointMap[endpoint];
    if (!apiMethod) {
      console.warn(`[POLLING] No API method found for endpoint: ${endpoint}`);
      return null;
    }

    try {
      const data = await apiMethod();
      return { data, status: 200 };
    } catch (error) {
      // Check if it's a 404 error
      if (error && error.status === 404) {
        console.log(`[POLLING] 404 response for ${endpoint} - no data available`);
        return { data: null, status: 404 };
      }
      console.error(`[POLLING] Error calling API method for ${endpoint}:`, error.message);
      return null;
    }
  }

  /**
   * Broadcast update to all subscribers of an endpoint
   * @param {string} endpoint - API endpoint path
   * @param {Object} response - Response data to broadcast
   */
  broadcastUpdate(endpoint, response) {
    if (!this.io) {
      console.warn('[POLLING] Socket.io instance not available for broadcasting');
      return;
    }

    const subscribers = subscriptionService.getSubscribers(endpoint);
    
    for (const socketId of subscribers) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket && socket.connected) {
        socket.emit('data-update', {
          endpoint,
          ...response
        });
      } else {
        // Remove disconnected socket
        subscriptionService.removeSocket(socketId);
      }
    }
  }

  /**
   * Handle new subscription - start polling if not already polling
   * @param {string} endpoint - API endpoint path
   */
  onSubscriptionAdded(endpoint) {
    this.startPollingForEndpoint(endpoint, 'subscription');
  }

  /**
   * Handle subscription removal - stop polling if no more subscribers
   * @param {string} endpoint - API endpoint path
   */
  onSubscriptionRemoved(endpoint) {
    const subscribers = subscriptionService.getSubscribers(endpoint);
    if (subscribers.size === 0) {
      this.stopPollingForEndpoint(endpoint, 'subscription');
    }
  }

  /**
   * Get polling service statistics
   * @returns {Object} Polling stats
   */
  getStats() {
    const endpointReasons = {};
    for (const [endpoint, reasons] of this.pollingReasons) {
      endpointReasons[endpoint] = Array.from(reasons);
    }

    // Collect back-off states
    const backoffInfo = {};
    for (const [endpoint, state] of this.backoffStates) {
      if (state.isBackedOff) {
        backoffInfo[endpoint] = {
          currentInterval: (state.baseInterval * state.currentMultiplier) / 1000,
          baseInterval: state.baseInterval / 1000,
          multiplier: state.currentMultiplier,
          consecutiveErrors: state.consecutiveErrors,
          isBackedOff: state.isBackedOff
        };
      }
    }

    return {
      isRunning: this.isRunning,
      activeEndpoints: Array.from(this.pollingTimeouts.keys()),
      totalActiveEndpoints: this.pollingTimeouts.size,
      pollingReasons: endpointReasons,
      backoffStates: backoffInfo,
      backoffConfig: config.polling.backoff,
      eventEndpoints: config.events.enabled ? config.events.endpoints : [],
      eventsEnabled: config.events.enabled,
    };
  }

  /**
   * Determine if an endpoint should be logged
   * @param {string} endpoint - API endpoint path
   * @returns {boolean} Whether to log this endpoint
   */
  shouldLogEndpoint(endpoint) {
    if (config.apiLogging.logAllEndpoints) {
      return true;
    }
    
    // Log only event-monitored endpoints
    return config.events.enabled && config.events.endpoints.includes(endpoint);
  }
}

module.exports = new PollingService(); 
