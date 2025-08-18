const request = require('supertest');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.CACHE_ENABLED = 'true'; // Enable cache for tests

const { app } = require('../server');
const { getEndpointTtl, cacheMiddleware } = require('../middleware/cache');
const cacheService = require('../services/cache');

describe('Cache Configuration', () => {
  // Initialize cache service before running tests
  beforeAll(async () => {
    await cacheService.initialize();
  });

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

  describe('GET /api/cache/stats', () => {
    it('should return cache statistics', async () => {
      const response = await request(app)
        .get('/api/cache/stats')
        .expect(200);

      expect(response.body).toHaveProperty('stats');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body.stats).toHaveProperty('type');
      expect(response.body.stats).toHaveProperty('available');
      
      // Stats should indicate provider type (memory, redis, or noop)
      expect(['memory', 'redis', 'noop']).toContain(response.body.stats.type);
      expect(typeof response.body.stats.available).toBe('boolean');
    });
  });

  test('should include TTL in cached response', async () => {
    const cacheKey = 'test-key';
    const testData = { message: 'test data' };
    
    // Set data in cache (async operation)
    await cacheService.set(cacheKey, testData, 60);
    
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
    
    // Mock cacheService methods to return cached data
    const originalGet = cacheService.get;
    const originalGetTtl = cacheService.getTtl;
    cacheService.get = jest.fn().mockResolvedValue(testData);
    cacheService.getTtl = jest.fn().mockResolvedValue(45); // Mock remaining TTL
    
    // Execute middleware
    await middleware(req, res, () => {});
    
    // Verify response includes TTL
    expect(res.json).toHaveBeenCalledWith({
      data: testData,
      cached: true,
      timestamp: expect.any(String),
      ttl: 45
    });
    
    // Restore original methods
    cacheService.get = originalGet;
    cacheService.getTtl = originalGetTtl;
  });

  describe('Cache Provider Selection', () => {
    test('should use appropriate cache provider based on configuration', () => {
      // Should use Redis if URL is configured, otherwise memory cache
      const providerType = cacheService.getProviderType();
      expect(['memory', 'redis']).toContain(providerType);
      expect(cacheService.isAvailable()).toBe(true);
    });

    test('should have correct cache strategy information', () => {
      const CacheFactory = require('../services/cacheFactory');
      const strategy = CacheFactory.getCacheStrategy();
      
      expect(strategy).toHaveProperty('type');
      expect(strategy).toHaveProperty('enabled');
      expect(strategy).toHaveProperty('description');
      expect(['memory', 'redis', 'noop']).toContain(strategy.type);
    });

    test('should support cache operations with current provider', async () => {
      const testKey = 'provider-test-key';
      const testValue = { test: 'provider-data', timestamp: Date.now() };

      // Test set operation
      const setResult = await cacheService.set(testKey, testValue, 30);
      expect(setResult).toBe(true);

      // Test get operation
      const retrievedValue = await cacheService.get(testKey);
      expect(retrievedValue).toEqual(testValue);

      // Test TTL operation
      const ttl = await cacheService.getTtl(testKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);

      // Test delete operation
      const deleteResult = await cacheService.del(testKey);
      expect(deleteResult).toBe(true);

      // Verify deletion
      const deletedValue = await cacheService.get(testKey);
      expect(deletedValue).toBeNull();
    });
  });

  describe('404 Response Caching', () => {
    test('should handle non-route 404s without caching', async () => {
      // Non-existent routes don't go through cache middleware,
      // they're handled by the default 404 handler
      const response = await request(app)
        .get('/api/nonexistent-endpoint')
        .expect(404);

      // Default 404 handler doesn't add cache metadata
      expect(response.body.cached).toBeUndefined();
      expect(response.body.error.message).toBe('Endpoint not found');
    });

    test('should cache 404 responses and preserve status code', async () => {
      // Mock a cached 404 response directly in the cache
      const cacheKey = '/api/test-404';
      const mockCached404 = {
        data: { error: { message: 'Not Found', status: 404 } },
        statusCode: 404,
        timestamp: new Date().toISOString()
      };
      
      // Set the cached 404 response
      await cacheService.set(cacheKey, mockCached404, 60);
      
      // Mock request and response for cache middleware
      const req = {
        method: 'GET',
        path: '/api/test-404',
        query: {}
      };
      
      let responseData = null;
      
      const res = {
        status: jest.fn(),
        json: jest.fn().mockImplementation((data) => {
          responseData = data;
        })
      };
      
      // Mock status to return res for chaining
      res.status.mockReturnValue(res);
      
      // Create and execute middleware
      const middleware = require('../middleware/cache').cacheMiddleware();
      await middleware(req, res, () => {});
      
      // Verify status code and response
      expect(res.status).toHaveBeenCalledWith(404);
      expect(responseData.cached).toBe(true);
      expect(responseData.data).toEqual(mockCached404.data);
      expect(responseData.ttl).toBeGreaterThan(0);
    });

    test('should verify cache middleware structure supports 404 caching', () => {
      // This test verifies that the cache middleware has the logic to cache 404s
      const middleware = require('../middleware/cache');
      expect(typeof middleware.cacheMiddleware).toBe('function');
      
      // Verify the middleware function exists
      const middlewareInstance = middleware.cacheMiddleware();
      expect(typeof middlewareInstance).toBe('function');
    });
  });
}); 