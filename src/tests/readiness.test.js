const fs = require('fs');
const path = require('path');
const request = require('supertest');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.CACHE_ENABLED = 'true';
process.env.REDIS_URL = ''; // Force in-memory cache for tests

const { app } = require('../server');
const cacheService = require('../services/cache');

const SRC_DIR = path.join(__dirname, '..');
const ENV_EXAMPLE = path.join(__dirname, '..', '..', 'env.example');

/**
 * Load src/config with a controlled environment and without reading any
 * developer .env file.
 */
function loadConfigWithEnv(overrides) {
  const saved = { ...process.env };
  let loaded;
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    jest.isolateModules(() => {
      jest.doMock('dotenv', () => ({ config: () => ({}) }));
      loaded = {
        config: require('../config'),
        CacheFactory: require('../services/cacheFactory'),
      };
    });
  } finally {
    jest.dontMock('dotenv');
    for (const key of Object.keys(overrides)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
  return loaded;
}

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'tests' ? [] : listSourceFiles(full);
    }
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

describe('2026 readiness', () => {
  beforeAll(async () => {
    await cacheService.initialize();
  });

  describe('freeze mode defaults', () => {
    it('is off when FILESYSTEM_CACHE_DIR is unset (live data flows)', () => {
      const { config, CacheFactory } = loadConfigWithEnv({
        FILESYSTEM_CACHE_DIR: undefined,
        WEBSOCKET_ENABLED: undefined,
        EVENTS_ENABLED: undefined,
        CACHE_ENABLED: undefined,
        REDIS_URL: undefined,
      });

      expect(config.filesystem.cacheDir).toBeUndefined();
      expect(config.websocket.enabled).toBe(true);
      expect(config.events.enabled).toBe(true);
      expect(CacheFactory.getCacheStrategy().type).toBe('memory');
    });

    it('selects the filesystem (frozen) cache only when FILESYSTEM_CACHE_DIR is set', () => {
      const { CacheFactory } = loadConfigWithEnv({
        FILESYSTEM_CACHE_DIR: './freeze-cache',
        CACHE_ENABLED: undefined,
      });

      expect(CacheFactory.getCacheStrategy().type).toBe('filesystem');
    });

    it('defaults API log retention to 30 days, matching apiLogger.cleanup()', () => {
      const { config } = loadConfigWithEnv({ LOG_RETENTION_DAYS: undefined });
      expect(config.apiLogging.retentionDays).toBe(30);
    });
  });

  describe('health endpoints', () => {
    it('GET /health returns ok', async () => {
      const response = await request(app).get('/health').expect(200);
      expect(response.body).toMatchObject({ status: 'ok', service: 'atp-live-proxy' });
    });

    it('GET /api/health reports the cache provider and freezeMode=false by default', async () => {
      const response = await request(app).get('/api/health').expect(200);
      expect(response.body.freezeMode).toBe(false);
      expect(response.body.cache.provider).toBe('memory');
      expect(response.body.warnings.join(' ')).not.toMatch(/Freeze mode/);
    });

    it('GET /api/health flags freeze mode when the filesystem cache is active', async () => {
      const spy = jest.spyOn(cacheService, 'getProviderType').mockReturnValue('filesystem');
      try {
        const response = await request(app).get('/api/health').expect(200);
        expect(response.body.freezeMode).toBe(true);
        expect(response.body.cache.provider).toBe('filesystem');
        expect(response.body.status).not.toBe('healthy');
        expect(response.body.warnings).toEqual(
          expect.arrayContaining([expect.stringMatching(/Freeze mode active/)])
        );
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('env.example', () => {
    it('documents every environment variable read by src/', () => {
      const used = new Set();
      for (const file of listSourceFiles(SRC_DIR)) {
        const content = fs.readFileSync(file, 'utf8');
        for (const match of content.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
          used.add(match[1]);
        }
      }

      const documented = new Set(
        [...fs.readFileSync(ENV_EXAMPLE, 'utf8').matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map(m => m[1])
      );

      const missing = [...used].filter(name => !documented.has(name)).sort();
      expect(missing).toEqual([]);
    });
  });
});
