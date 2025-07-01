const subscriptionService = require('../services/subscriptionService');

describe('WebSocket Subscription Service', () => {
  beforeEach(() => {
    // Clear all subscriptions before each test
    subscriptionService.clear();
  });

  describe('Subscription Management', () => {
    test('should subscribe a socket to an endpoint', () => {
      const socketId = 'socket-123';
      const endpoint = '/api/live-matches';

      subscriptionService.subscribe(socketId, endpoint);

      const subscribers = subscriptionService.getSubscribers(endpoint);
      const socketSubscriptions = subscriptionService.getSocketSubscriptions(socketId);

      expect(subscribers.has(socketId)).toBe(true);
      expect(socketSubscriptions.has(endpoint)).toBe(true);
    });

    test('should unsubscribe a socket from an endpoint', () => {
      const socketId = 'socket-123';
      const endpoint = '/api/live-matches';

      // Subscribe first
      subscriptionService.subscribe(socketId, endpoint);
      expect(subscriptionService.getSubscribers(endpoint).has(socketId)).toBe(true);

      // Unsubscribe
      subscriptionService.unsubscribe(socketId, endpoint);
      expect(subscriptionService.getSubscribers(endpoint).has(socketId)).toBe(false);
      expect(subscriptionService.getSocketSubscriptions(socketId).has(endpoint)).toBe(false);
    });

    test('should remove all subscriptions when socket disconnects', () => {
      const socketId = 'socket-123';
      const endpoint1 = '/api/live-matches';
      const endpoint2 = '/api/draws';

      // Subscribe to multiple endpoints
      subscriptionService.subscribe(socketId, endpoint1);
      subscriptionService.subscribe(socketId, endpoint2);

      expect(subscriptionService.getSubscribers(endpoint1).has(socketId)).toBe(true);
      expect(subscriptionService.getSubscribers(endpoint2).has(socketId)).toBe(true);

      // Remove socket
      subscriptionService.removeSocket(socketId);

      expect(subscriptionService.getSubscribers(endpoint1).has(socketId)).toBe(false);
      expect(subscriptionService.getSubscribers(endpoint2).has(socketId)).toBe(false);
      expect(subscriptionService.getSocketSubscriptions(socketId).size).toBe(0);
    });

    test('should handle multiple sockets subscribing to same endpoint', () => {
      const socket1 = 'socket-1';
      const socket2 = 'socket-2';
      const endpoint = '/api/live-matches';

      subscriptionService.subscribe(socket1, endpoint);
      subscriptionService.subscribe(socket2, endpoint);

      const subscribers = subscriptionService.getSubscribers(endpoint);
      expect(subscribers.has(socket1)).toBe(true);
      expect(subscribers.has(socket2)).toBe(true);
      expect(subscribers.size).toBe(2);
    });

    test('should clean up empty endpoint subscriptions', () => {
      const socketId = 'socket-123';
      const endpoint = '/api/live-matches';

      subscriptionService.subscribe(socketId, endpoint);
      expect(subscriptionService.getSubscribers(endpoint).size).toBe(1);

      subscriptionService.unsubscribe(socketId, endpoint);
      expect(subscriptionService.getSubscribers(endpoint).size).toBe(0);
      
      // The endpoint should be removed from the subscriptions map
      const stats = subscriptionService.getStats();
      expect(stats.endpoints).not.toContain(endpoint);
    });
  });

  describe('Statistics', () => {
    test('should return correct subscription statistics', () => {
      const socket1 = 'socket-1';
      const socket2 = 'socket-2';
      const endpoint1 = '/api/live-matches';
      const endpoint2 = '/api/draws';

      // Subscribe socket1 to both endpoints
      subscriptionService.subscribe(socket1, endpoint1);
      subscriptionService.subscribe(socket1, endpoint2);

      // Subscribe socket2 to one endpoint
      subscriptionService.subscribe(socket2, endpoint1);

      const stats = subscriptionService.getStats();

      expect(stats.totalEndpoints).toBe(2);
      expect(stats.totalSockets).toBe(2);
      expect(stats.totalSubscriptions).toBe(3); // socket1 has 2, socket2 has 1
      expect(stats.endpoints).toContain(endpoint1);
      expect(stats.endpoints).toContain(endpoint2);
    });

    test('should return empty statistics when no subscriptions', () => {
      const stats = subscriptionService.getStats();

      expect(stats.totalEndpoints).toBe(0);
      expect(stats.totalSockets).toBe(0);
      expect(stats.totalSubscriptions).toBe(0);
      expect(stats.endpoints).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    test('should handle unsubscribing from non-existent subscription', () => {
      const socketId = 'socket-123';
      const endpoint = '/api/live-matches';

      // Try to unsubscribe without subscribing first
      expect(() => {
        subscriptionService.unsubscribe(socketId, endpoint);
      }).not.toThrow();

      expect(subscriptionService.getSubscribers(endpoint).has(socketId)).toBe(false);
    });

    test('should handle removing non-existent socket', () => {
      const socketId = 'socket-123';

      // Try to remove socket that doesn't exist
      expect(() => {
        subscriptionService.removeSocket(socketId);
      }).not.toThrow();
    });

    test('should handle duplicate subscriptions gracefully', () => {
      const socketId = 'socket-123';
      const endpoint = '/api/live-matches';

      // Subscribe twice
      subscriptionService.subscribe(socketId, endpoint);
      subscriptionService.subscribe(socketId, endpoint);

      const subscribers = subscriptionService.getSubscribers(endpoint);
      const socketSubscriptions = subscriptionService.getSocketSubscriptions(socketId);

      expect(subscribers.has(socketId)).toBe(true);
      expect(socketSubscriptions.has(endpoint)).toBe(true);
      expect(subscribers.size).toBe(1); // Should only be subscribed once
    });
  });
}); 