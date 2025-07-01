const atpApi = require('./atpApi');
const cacheService = require('./cache');
const subscriptionService = require('./subscriptionService');
const { getEndpointTtl } = require('../middleware/cache');

/**
 * Background polling service for WebSocket updates
 * Fetches data from ATP API at configured TTL intervals
 * and broadcasts updates to subscribed clients
 */
class PollingService {
  constructor() {
    this.pollingIntervals = new Map();
    this.isRunning = false;
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
      this.startPollingForEndpoint(endpoint);
    }
  }

  /**
   * Start polling for a specific endpoint
   * @param {string} endpoint - API endpoint path
   */
  startPollingForEndpoint(endpoint) {
    if (this.pollingIntervals.has(endpoint)) {
      console.log(`[POLLING] Already polling for ${endpoint}`);
      return;
    }

    const ttl = getEndpointTtl(endpoint);
    const intervalMs = ttl * 1000; // Convert to milliseconds

    console.log(`[POLLING] Starting to poll ${endpoint} every ${ttl} seconds`);

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
   * Stop polling for a specific endpoint
   * @param {string} endpoint - API endpoint path
   */
  stopPollingForEndpoint(endpoint) {
    const interval = this.pollingIntervals.get(endpoint);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(endpoint);
      console.log(`[POLLING] Stopped polling for ${endpoint}`);
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
        this.broadcastUpdate(endpoint, response);
        
        console.log(`[POLLING] Broadcasted update for ${endpoint} to ${subscriptionService.getSubscribers(endpoint).size} subscribers`);
      }
    } catch (error) {
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
    if (!this.pollingIntervals.has(endpoint)) {
      this.startPollingForEndpoint(endpoint);
    }
  }

  /**
   * Handle subscription removal - stop polling if no more subscribers
   * @param {string} endpoint - API endpoint path
   */
  onSubscriptionRemoved(endpoint) {
    const subscribers = subscriptionService.getSubscribers(endpoint);
    if (subscribers.size === 0) {
      this.stopPollingForEndpoint(endpoint);
    }
  }

  /**
   * Get polling service statistics
   * @returns {Object} Polling stats
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      activeEndpoints: Array.from(this.pollingIntervals.keys()),
      totalActiveEndpoints: this.pollingIntervals.size,
    };
  }
}

module.exports = new PollingService(); 