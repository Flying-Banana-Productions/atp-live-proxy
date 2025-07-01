const request = require('supertest');

// Set test environment
process.env.NODE_ENV = 'test';

const { app } = require('../server');

describe('ATP Live Proxy Server', () => {
  describe('GET /', () => {
    it('should return server information', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'ATP Live Proxy API');
      expect(response.body).toHaveProperty('version', '1.0.0');
      expect(response.body).toHaveProperty('status', 'running');
      expect(response.body).toHaveProperty('endpoints');
    });
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(['healthy', 'warning', 'critical']).toContain(response.body.status);
      expect(response.body).toHaveProperty('version', '1.0.0');
      expect(response.body).toHaveProperty('cache');
      expect(response.body.cache).toHaveProperty('keys');
      expect(response.body.cache).toHaveProperty('memoryUsage');
    });
  });

  describe('GET /api/info', () => {
    it('should return API information', async () => {
      const response = await request(app)
        .get('/api/info')
        .expect(200);

      expect(response.body).toHaveProperty('name', 'ATP Live Proxy API');
      expect(response.body).toHaveProperty('version', '1.0.0');
      expect(response.body).toHaveProperty('endpoints');
      expect(response.body).toHaveProperty('documentation');
    });
  });

  describe('GET /api/cache/stats', () => {
    it('should return cache statistics', async () => {
      const response = await request(app)
        .get('/api/cache/stats')
        .expect(200);

      expect(response.body).toHaveProperty('stats');
      expect(response.body).toHaveProperty('timestamp');
    });
  });



  describe('404 handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const response = await request(app)
        .get('/api/nonexistent')
        .expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('message', 'Endpoint not found');
      expect(response.body.error).toHaveProperty('status', 404);
    });
  });
}); 