const express = require('express');
const request = require('supertest');
const { createCorsMiddleware, parseAllowedOrigins, DEFAULT_ALLOWED_ORIGINS } = require('../middleware/cors');
const { errorHandler } = require('../middleware/errorHandler');

function buildApp(options) {
  const app = express();
  app.use(createCorsMiddleware(options));
  app.get('/api/live-matches', (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('CORS middleware', () => {
  describe('in production', () => {
    const app = buildApp({ production: true, allowedOrigins: ['https://app.example.com'] });

    beforeEach(() => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    it('answers a disallowed origin with 403 and does not log an error', async () => {
      const response = await request(app)
        .get('/api/live-matches')
        .set('Origin', 'https://evil.example.com')
        .expect(403);

      expect(response.body.error).toMatchObject({ message: 'Origin not allowed', status: 403 });
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('rejects a disallowed preflight with 403', async () => {
      await request(app)
        .options('/api/live-matches')
        .set('Origin', 'https://evil.example.com')
        .set('Access-Control-Request-Method', 'GET')
        .expect(403);
    });

    it('allows a listed origin and reflects it', async () => {
      const response = await request(app)
        .get('/api/live-matches')
        .set('Origin', 'https://app.example.com')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe('https://app.example.com');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('allows requests with no Origin header', async () => {
      await request(app).get('/api/live-matches').expect(200);
    });
  });

  it('allows any origin outside production', async () => {
    const app = buildApp({ production: false });
    const response = await request(app)
      .get('/api/live-matches')
      .set('Origin', 'https://anything.example.com')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('https://anything.example.com');
  });

  it('parses ALLOWED_ORIGINS, falling back to the defaults', () => {
    expect(parseAllowedOrigins('https://a.com, https://b.com')).toEqual(['https://a.com', 'https://b.com']);
    expect(parseAllowedOrigins(undefined)).toBe(DEFAULT_ALLOWED_ORIGINS);
  });
});
