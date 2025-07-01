/**
 * Subscription Service for WebSocket connections
 * Manages endpoint subscriptions with in-memory storage
 * Designed to be easily replaceable with Redis implementation
 */
class SubscriptionService {
  constructor() {
    // endpoint -> Set of socketIds
    this.subscriptions = new Map();
    // socketId -> Set of endpoints
    this.socketSubscriptions = new Map();
  }

  /**
   * Subscribe a socket to an endpoint
   * @param {string} socketId - Socket ID
   * @param {string} endpoint - API endpoint path
   */
  subscribe(socketId, endpoint) {
    // Add socket to endpoint subscribers
    if (!this.subscriptions.has(endpoint)) {
      this.subscriptions.set(endpoint, new Set());
    }
    this.subscriptions.get(endpoint).add(socketId);

    // Add endpoint to socket's subscriptions
    if (!this.socketSubscriptions.has(socketId)) {
      this.socketSubscriptions.set(socketId, new Set());
    }
    this.socketSubscriptions.get(socketId).add(endpoint);

    console.log(`[SUBSCRIPTION] Socket ${socketId} subscribed to ${endpoint}`);
  }

  /**
   * Unsubscribe a socket from an endpoint
   * @param {string} socketId - Socket ID
   * @param {string} endpoint - API endpoint path
   */
  unsubscribe(socketId, endpoint) {
    // Remove socket from endpoint subscribers
    const endpointSubscribers = this.subscriptions.get(endpoint);
    if (endpointSubscribers) {
      endpointSubscribers.delete(socketId);
      if (endpointSubscribers.size === 0) {
        this.subscriptions.delete(endpoint);
      }
    }

    // Remove endpoint from socket's subscriptions
    const socketEndpoints = this.socketSubscriptions.get(socketId);
    if (socketEndpoints) {
      socketEndpoints.delete(endpoint);
      if (socketEndpoints.size === 0) {
        this.socketSubscriptions.delete(socketId);
      }
    }

    console.log(`[SUBSCRIPTION] Socket ${socketId} unsubscribed from ${endpoint}`);
  }

  /**
   * Get all socket IDs subscribed to an endpoint
   * @param {string} endpoint - API endpoint path
   * @returns {Set<string>} Set of socket IDs
   */
  getSubscribers(endpoint) {
    return this.subscriptions.get(endpoint) || new Set();
  }

  /**
   * Get all endpoints a socket is subscribed to
   * @param {string} socketId - Socket ID
   * @returns {Set<string>} Set of endpoint paths
   */
  getSocketSubscriptions(socketId) {
    return this.socketSubscriptions.get(socketId) || new Set();
  }

  /**
   * Remove all subscriptions for a socket (on disconnect)
   * @param {string} socketId - Socket ID
   */
  removeSocket(socketId) {
    const socketEndpoints = this.socketSubscriptions.get(socketId);
    if (socketEndpoints) {
      // Remove socket from all its subscribed endpoints
      for (const endpoint of socketEndpoints) {
        const endpointSubscribers = this.subscriptions.get(endpoint);
        if (endpointSubscribers) {
          endpointSubscribers.delete(socketId);
          if (endpointSubscribers.size === 0) {
            this.subscriptions.delete(endpoint);
          }
        }
      }
      this.socketSubscriptions.delete(socketId);
    }

    console.log(`[SUBSCRIPTION] Removed all subscriptions for socket ${socketId}`);
  }

  /**
   * Get subscription statistics
   * @returns {Object} Subscription stats
   */
  getStats() {
    const totalSubscriptions = Array.from(this.subscriptions.values())
      .reduce((total, subscribers) => total + subscribers.size, 0);
    
    return {
      totalEndpoints: this.subscriptions.size,
      totalSockets: this.socketSubscriptions.size,
      totalSubscriptions,
      endpoints: Array.from(this.subscriptions.keys()),
    };
  }

  /**
   * Clear all subscriptions (for testing/debugging)
   */
  clear() {
    this.subscriptions.clear();
    this.socketSubscriptions.clear();
    console.log('[SUBSCRIPTION] Cleared all subscriptions');
  }
}

module.exports = new SubscriptionService(); 