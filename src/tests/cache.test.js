const request = require('supertest');

// Set test environment
process.env.NODE_ENV = 'test';

const { app } = require('../server');
const { getEndpointTtl, cacheMiddleware } = require('../middleware/cache');
const cacheService = require('../services/cache');

describe('Cache Configuration', () => {
  describe('Endpoint-specific TTL', () => {
    it('should return correct TTL for live-matches endpoint', () => {
      const ttl = getEndpointTtl('/api/live-matches');
      expect(ttl).toBe(10);
    });

    it('should return correct TTL for match-stats endpoint', () => {
      const ttl = getEndpointTtl('/api/match-stats/12345');
      expect(ttl).toBe(10);
    });

    it('should return correct TTL for h2h/match endpoint', () => {
      const ttl = getEndpointTtl('/api/h2h/match/12345');
      expect(ttl).toBe(10);
    });

    it('should return correct TTL for h2h endpoint', () => {
      const ttl = getEndpointTtl('/api/h2h/12345/67890');
      expect(ttl).toBe(10);
    });

    it('should return correct TTL for results endpoint', () => {
      const ttl = getEndpointTtl('/api/results');
      expect(ttl).toBe(180);
    });

    it('should return correct TTL for player-list endpoint', () => {
      const ttl = getEndpointTtl('/api/player-list');
      expect(ttl).toBe(600);
    });

    it('should return correct TTL for draws endpoint', () => {
      const ttl = getEndpointTtl('/api/draws');
      expect(ttl).toBe(600);
    });

    it('should return correct TTL for draws/live endpoint', () => {
      const ttl = getEndpointTtl('/api/draws/live');
      expect(ttl).toBe(600);
    });

    it('should return correct TTL for schedules endpoint', () => {
      const ttl = getEndpointTtl('/api/schedules');
      expect(ttl).toBe(600);
    });

    it('should return correct TTL for team-cup-rankings endpoint', () => {
      const ttl = getEndpointTtl('/api/team-cup-rankings');
      expect(ttl).toBe(600);
    });

    it('should return default TTL for unknown endpoint', () => {
      const ttl = getEndpointTtl('/api/unknown');
      expect(ttl).toBe(30); // default TTL
    });
  });

  describe('GET /api/cache/config', () => {
    it('should return cache configuration', async () => {
      const response = await request(app)
        .get('/api/cache/config')
        .expect(200);

      expect(response.body).toHaveProperty('defaultTtl');
      expect(response.body).toHaveProperty('checkPeriod');
      expect(response.body).toHaveProperty('endpoints');
      expect(response.body).toHaveProperty('timestamp');
      
      // Verify specific endpoint TTL values
      expect(response.body.endpoints['/api/live-matches']).toBe(10);
      expect(response.body.endpoints['/api/match-stats']).toBe(10);
      expect(response.body.endpoints['/api/h2h/match']).toBe(10);
      expect(response.body.endpoints['/api/h2h']).toBe(10);
      expect(response.body.endpoints['/api/results']).toBe(180);
      expect(response.body.endpoints['/api/player-list']).toBe(600);
      expect(response.body.endpoints['/api/draws']).toBe(600);
      expect(response.body.endpoints['/api/draws/live']).toBe(600);
      expect(response.body.endpoints['/api/schedules']).toBe(600);
      expect(response.body.endpoints['/api/team-cup-rankings']).toBe(600);
    });
  });

  test('should include TTL in cached response', async () => {
    const cacheKey = 'test-key';
    const testData = { message: 'test data' };
    
    // Set data in cache
    cacheService.set(cacheKey, testData, 60);
    
    // Mock request and response
    const req = {
      method: 'GET',
      path: '/api/test',
      query: {}
    };
    
    const res = {
      statusCode: 200,
      json: jest.fn()
    };
    
    // Create middleware instance
    const middleware = cacheMiddleware();
    
    // Mock cacheService.get to return cached data
    const originalGet = cacheService.get;
    cacheService.get = jest.fn().mockReturnValue(testData);
    cacheService.getTtl = jest.fn().mockReturnValue(45); // Mock remaining TTL
    
    // Execute middleware
    await middleware(req, res, () => {});
    
    // Verify response includes TTL
    expect(res.json).toHaveBeenCalledWith({
      data: testData,
      cached: true,
      timestamp: expect.any(String),
      ttl: 45
    });
    
    // Restore original method
    cacheService.get = originalGet;
  });
}); 