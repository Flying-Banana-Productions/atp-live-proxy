const { Server } = require('socket.io');
const subscriptionService = require('./services/subscriptionService');
const pollingService = require('./services/pollingService');
const cacheService = require('./services/cache');
const { getEndpointTtl } = require('./middleware/cache');

/**
 * WebSocket server setup and event handling
 */
class WebSocketServer {
  constructor() {
    this.io = null;
  }

  /**
   * Initialize WebSocket server
   * @param {Object} httpServer - HTTP server instance
   */
  initialize(httpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: '*', // Allow all origins for now
        methods: ['GET', 'POST']
      }
    });

    this.setupEventHandlers();
    
    // Start the polling service
    pollingService.start(this.io);
    
    console.log('🔌 WebSocket server initialized');
  }

  /**
   * Setup WebSocket event handlers
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`[WEBSOCKET] Client connected: ${socket.id}`);

      // Handle subscription requests
      socket.on('subscribe', (endpoints) => {
        this.handleSubscribe(socket, endpoints);
      });

      // Handle unsubscription requests
      socket.on('unsubscribe', (endpoints) => {
        this.handleUnsubscribe(socket, endpoints);
      });

      // Handle subscription list request
      socket.on('get-subscriptions', () => {
        this.handleGetSubscriptions(socket);
      });

      // Handle immediate data request
      socket.on('get-data', (endpoint) => {
        this.handleGetData(socket, endpoint);
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });

      // Send welcome message
      socket.emit('connected', {
        message: 'Connected to ATP Live Proxy WebSocket',
        socketId: socket.id,
        timestamp: new Date().toISOString(),
        availableEndpoints: [
          '/api/live-matches',
          '/api/draws/live',
          '/api/draws',
          '/api/player-list',
          '/api/results',
          '/api/schedules',
          '/api/team-cup-rankings'
        ]
      });
    });
  }

  /**
   * Handle subscription request
   * @param {Object} socket - Socket instance
   * @param {string|Array} endpoints - Endpoint(s) to subscribe to
   */
  handleSubscribe(socket, endpoints) {
    const endpointList = Array.isArray(endpoints) ? endpoints : [endpoints];
    
    for (const endpoint of endpointList) {
      if (this.isValidEndpoint(endpoint)) {
        subscriptionService.subscribe(socket.id, endpoint);
        pollingService.onSubscriptionAdded(endpoint);
        
        // Send confirmation
        socket.emit('subscribed', {
          endpoint,
          message: `Subscribed to ${endpoint}`,
          timestamp: new Date().toISOString()
        });

        // Send current cached data immediately
        this.sendCachedData(socket, endpoint);
      } else {
        socket.emit('error', {
          message: `Invalid endpoint: ${endpoint}`,
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  /**
   * Handle unsubscription request
   * @param {Object} socket - Socket instance
   * @param {string|Array} endpoints - Endpoint(s) to unsubscribe from
   */
  handleUnsubscribe(socket, endpoints) {
    const endpointList = Array.isArray(endpoints) ? endpoints : [endpoints];
    
    for (const endpoint of endpointList) {
      subscriptionService.unsubscribe(socket.id, endpoint);
      pollingService.onSubscriptionRemoved(endpoint);
      
      socket.emit('unsubscribed', {
        endpoint,
        message: `Unsubscribed from ${endpoint}`,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle get subscriptions request
   * @param {Object} socket - Socket instance
   */
  handleGetSubscriptions(socket) {
    const subscriptions = subscriptionService.getSocketSubscriptions(socket.id);
    
    socket.emit('subscriptions', {
      subscriptions: Array.from(subscriptions),
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle immediate data request
   * @param {Object} socket - Socket instance
   * @param {string} endpoint - Endpoint to get data for
   */
  handleGetData(socket, endpoint) {
    if (this.isValidEndpoint(endpoint)) {
      this.sendCachedData(socket, endpoint);
    } else {
      socket.emit('error', {
        message: `Invalid endpoint: ${endpoint}`,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle client disconnect
   * @param {Object} socket - Socket instance
   */
  handleDisconnect(socket) {
    console.log(`[WEBSOCKET] Client disconnected: ${socket.id}`);
    subscriptionService.removeSocket(socket.id);
  }

  /**
   * Send cached data to a specific socket
   * @param {Object} socket - Socket instance
   * @param {string} endpoint - Endpoint path
   */
  sendCachedData(socket, endpoint) {
    const cacheKey = cacheService.generateKey(endpoint);
    const cachedData = cacheService.get(cacheKey);
    
    if (cachedData) {
      const remainingTtl = cacheService.getTtl(cacheKey);
      const response = {
        data: cachedData,
        cached: true,
        timestamp: new Date().toISOString(),
        ttl: remainingTtl,
      };
      
      socket.emit('data-update', {
        endpoint,
        ...response
      });
    } else {
      // No cached data available
      socket.emit('data-update', {
        endpoint,
        data: null,
        cached: false,
        timestamp: new Date().toISOString(),
        ttl: getEndpointTtl(endpoint),
        message: 'No cached data available'
      });
    }
  }

  /**
   * Check if an endpoint is valid
   * @param {string} endpoint - Endpoint path
   * @returns {boolean} True if valid
   */
  isValidEndpoint(endpoint) {
    const validEndpoints = [
      '/api/live-matches',
      '/api/draws/live',
      '/api/draws',
      '/api/player-list',
      '/api/results',
      '/api/schedules',
      '/api/team-cup-rankings'
    ];
    
    return validEndpoints.includes(endpoint);
  }

  /**
   * Get WebSocket server statistics
   * @returns {Object} WebSocket stats
   */
  getStats() {
    if (!this.io) {
      return { connected: false };
    }

    const connectedSockets = this.io.sockets.sockets.size;
    const subscriptionStats = subscriptionService.getStats();
    const pollingStats = pollingService.getStats();

    return {
      connected: true,
      connectedSockets,
      subscriptions: subscriptionStats,
      polling: pollingStats
    };
  }

  /**
   * Stop the WebSocket server
   */
  stop() {
    if (this.io) {
      this.io.close();
      pollingService.stop();
      console.log('🔌 WebSocket server stopped');
    }
  }
}

module.exports = new WebSocketServer(); 