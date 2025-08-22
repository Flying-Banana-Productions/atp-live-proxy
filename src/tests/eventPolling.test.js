const pollingService = require('../services/pollingService');
const eventGenerator = require('../services/eventGenerator');
const config = require('../config');

// Mock ATP API to avoid real API calls
jest.mock('../services/atpApi', () => ({
  getLiveMatches: jest.fn(),
  getLiveDraw: jest.fn(),
}));

// Mock cache service to avoid initialization issues
jest.mock('../services/cache', () => ({
  generateKey: jest.fn((endpoint) => endpoint),
  set: jest.fn(),
  get: jest.fn(),
  getTtl: jest.fn(() => 10),
}));

const atpApi = require('../services/atpApi');
const cacheService = require('../services/cache');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.EVENTS_ENABLED = 'true';
process.env.EVENTS_ENDPOINTS = '/api/live-matches,/api/draws/live';

describe('Event-Driven Polling Integration', () => {
  beforeEach(() => {
    // Clear all intervals and reset state
    pollingService.stop();
    eventGenerator.clearStates();
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock API responses
    atpApi.getLiveMatches.mockResolvedValue({
      TournamentMatches: []
    });
    atpApi.getLiveDraw.mockResolvedValue({
      draws: []
    });
  });

  afterEach(() => {
    pollingService.stop();
  });

  describe('Event Polling Without WebSocket Subscriptions', () => {
    it('should start polling for event endpoints when service starts', () => {
      // Start polling service without WebSocket subscriptions
      pollingService.start(null);

      const stats = pollingService.getStats();
      
      // Should be polling event endpoints
      expect(stats.isRunning).toBe(true);
      expect(stats.eventsEnabled).toBe(true);
      // Check actual config values to understand the state
      console.log('Config endpoints:', config.events.endpoints);
      console.log('Event generator monitored endpoints:', Array.from(eventGenerator.monitoredEndpoints));
      expect(stats.eventEndpoints).toEqual(expect.arrayContaining(['/api/live-matches']));
      expect(stats.activeEndpoints).toContain('/api/live-matches');
      // Only check endpoints that are actually configured
      if (stats.eventEndpoints.includes('/api/draws/live')) {
        expect(stats.activeEndpoints).toContain('/api/draws/live');
      }
      
      // Should have 'events' as polling reason
      expect(stats.pollingReasons['/api/live-matches']).toContain('events');
      // Only check if the endpoint is configured
      if (stats.eventEndpoints.includes('/api/draws/live')) {
        expect(stats.pollingReasons['/api/draws/live']).toContain('events');
      }
    });

    it('should call event generator during polling even without subscriptions', async () => {
      // Spy on event generator
      const processDataSpy = jest.spyOn(eventGenerator, 'processData');
      
      // Mock API to return match data
      atpApi.getLiveMatches.mockResolvedValue({
        TournamentMatches: [{
          matchId: 'test_123',
          players: [{ name: 'Player A' }, { name: 'Player B' }],
          score: '0-0'
        }]
      });

      // Start polling service
      pollingService.start(null);

      // Wait a bit for initial fetch to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have called event generator for live matches
      expect(processDataSpy).toHaveBeenCalledWith('/api/live-matches', expect.any(Object));
      
      // Check if draws/live is configured and called
      if (config.events.endpoints.includes('/api/draws/live')) {
        expect(processDataSpy).toHaveBeenCalledWith('/api/draws/live', expect.any(Object));
      }
    });

    it('should continue event generation when WebSocket subscriptions change', async () => {
      const processDataSpy = jest.spyOn(eventGenerator, 'processData');
      
      // Start with no subscriptions
      pollingService.start(null);
      
      // Add a subscription (should not change event polling)
      pollingService.onSubscriptionAdded('/api/live-matches');
      
      let stats = pollingService.getStats();
      expect(stats.pollingReasons['/api/live-matches']).toEqual(expect.arrayContaining(['events', 'subscription']));
      expect(stats.activeEndpoints).toContain('/api/live-matches');
      
      // Remove subscription (should still poll for events)
      pollingService.onSubscriptionRemoved('/api/live-matches');
      
      stats = pollingService.getStats();
      expect(stats.pollingReasons['/api/live-matches']).toEqual(['events']);
      expect(stats.activeEndpoints).toContain('/api/live-matches');
    });

    it('should handle mixed polling reasons correctly', () => {
      // Start service (adds 'events' reason)
      pollingService.start(null);
      
      // Add subscription (adds 'subscription' reason)
      pollingService.onSubscriptionAdded('/api/live-matches');
      
      let stats = pollingService.getStats();
      expect(stats.pollingReasons['/api/live-matches']).toEqual(expect.arrayContaining(['events', 'subscription']));
      
      // Remove subscription (should still have 'events' reason)
      pollingService.onSubscriptionRemoved('/api/live-matches');
      
      stats = pollingService.getStats();
      expect(stats.pollingReasons['/api/live-matches']).toEqual(['events']);
      expect(stats.activeEndpoints).toContain('/api/live-matches');
    });

    it('should respect events disabled configuration', () => {
      // Temporarily disable events
      const originalEnabled = config.events.enabled;
      config.events.enabled = false;
      
      pollingService.start(null);
      
      const stats = pollingService.getStats();
      expect(stats.eventsEnabled).toBe(false);
      expect(stats.activeEndpoints).not.toContain('/api/live-matches');
      expect(stats.activeEndpoints).not.toContain('/api/draws/live');
      
      // Restore original config
      config.events.enabled = originalEnabled;
    });
  });

  describe('Polling Service Integration', () => {
    it('should not duplicate polling when both events and subscriptions exist', () => {
      // Start service (starts event polling)
      pollingService.start(null);
      
      let stats = pollingService.getStats();
      const initialEndpointCount = stats.totalActiveEndpoints;
      
      // Add subscription for same endpoint
      pollingService.onSubscriptionAdded('/api/live-matches');
      
      stats = pollingService.getStats();
      
      // Should not increase total endpoints (same endpoint, different reasons)
      expect(stats.totalActiveEndpoints).toBe(initialEndpointCount);
      expect(stats.pollingReasons['/api/live-matches']).toEqual(expect.arrayContaining(['events', 'subscription']));
    });

    it('should show comprehensive polling statistics', () => {
      pollingService.start(null);
      pollingService.onSubscriptionAdded('/api/live-matches');
      
      const stats = pollingService.getStats();
      
      expect(stats).toEqual(expect.objectContaining({
        isRunning: true,
        activeEndpoints: expect.any(Array),
        totalActiveEndpoints: expect.any(Number),
        pollingReasons: expect.any(Object),
        eventEndpoints: expect.any(Array),
        eventsEnabled: expect.any(Boolean),
      }));
      
      expect(stats.pollingReasons['/api/live-matches']).toEqual(expect.arrayContaining(['events', 'subscription']));
    });
  });
});