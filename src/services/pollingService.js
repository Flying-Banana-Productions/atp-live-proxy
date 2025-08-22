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
    this.pollingIntervals = new Map();
    this.isRunning = false;
    // Track polling reasons for each endpoint: 'subscription', 'events', or both
    this.pollingReasons = new Map();
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
    
    // Clear all polling intervals
    for (const [endpoint, interval] of this.pollingIntervals) {
      clearInterval(interval);
      console.log(`[POLLING] Stopped polling for ${endpoint}`);
    }
    this.pollingIntervals.clear();
    
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

    if (this.pollingIntervals.has(endpoint)) {
      console.log(`[POLLING] Already polling for ${endpoint}, added reason: ${reason}`);
      return;
    }

    const ttl = getEndpointTtl(endpoint);
    const intervalMs = ttl * 1000; // Convert to milliseconds

    const reasonsStr = Array.from(existingReasons).join('+');
    console.log(`[POLLING] Starting to poll ${endpoint} every ${ttl} seconds (${reasonsStr})`);

    // Initial fetch
    this.fetchAndBroadcast(endpoint);

    // Set up interval
    const interval = setInterval(() => {
      if (this.isRunning) {
        this.fetchAndBroadcast(endpoint);
      }
    }, intervalMs);

    this.pollingIntervals.set(endpoint, interval);
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
      const interval = this.pollingIntervals.get(endpoint);
      if (interval) {
        clearInterval(interval);
        this.pollingIntervals.delete(endpoint);
        this.pollingReasons.delete(endpoint);
        console.log(`[POLLING] Stopped polling for ${endpoint} (no more reasons)`);
      }
    } else {
      // Still have other reasons to poll
      const reasonsStr = Array.from(reasons).join('+');
      console.log(`[POLLING] Removed ${reason} reason for ${endpoint}, still polling for: ${reasonsStr}`);
    }
  }

  /**
   * Fetch data for an endpoint and broadcast to subscribers
   * @param {string} endpoint - API endpoint path
   */
  async fetchAndBroadcast(endpoint) {
    try {
      console.log(`[POLLING] Fetching data for ${endpoint}`);
      
      // Fetch fresh data from ATP API
      const data = await this.fetchEndpointData(endpoint);
      
      if (data) {
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
   * @returns {Object} API response data
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
      '/api/schedules': () => atpApi.getSchedules(),
      '/api/team-cup-rankings': () => atpApi.getTeamCupRankings(),
    };

    const apiMethod = endpointMap[endpoint];
    if (!apiMethod) {
      console.warn(`[POLLING] No API method found for endpoint: ${endpoint}`);
      return null;
    }

    try {
      return await apiMethod();
    } catch (error) {
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

    return {
      isRunning: this.isRunning,
      activeEndpoints: Array.from(this.pollingIntervals.keys()),
      totalActiveEndpoints: this.pollingIntervals.size,
      pollingReasons: endpointReasons,
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
