const fs = require('fs');
const path = require('path');
const request = require('supertest');

// Never load a developer .env in this suite: results must not depend on local
// freeze/realtime settings. (jest.mock is hoisted above the requires below.)
jest.mock('dotenv', () => ({ config: () => ({}) }));

// Set test environment
process.env.NODE_ENV = 'test';
process.env.CACHE_ENABLED = 'true';
process.env.REDIS_URL = ''; // Force in-memory cache for tests
process.env.FILESYSTEM_CACHE_DIR = ''; // Freeze mode off regardless of the shell

const { app } = require('../server');
const config = require('../config');
const cacheService = require('../services/cache');
const { getRealtimeStatus } = require('../utils/realtimeStatus');

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
      loaded = {
        config: require('../config'),
        CacheFactory: require('../services/cacheFactory'),
      };
    });
  } finally {
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

    it.each([
      ['0', 0],
      ['14', 14],
      ['abc', 30],
      ['-3', 30],
    ])('parses LOG_RETENTION_DAYS=%s as %d (explicit 0 honoured)', (value, expected) => {
      const { config } = loadConfigWithEnv({ LOG_RETENTION_DAYS: value });
      expect(config.apiLogging.retentionDays).toBe(expected);
    });
  });

  describe('realtime pipeline status', () => {
    const base = {
      websocket: { enabled: true },
      events: { enabled: true, webhookUrl: 'http://maple/webhook', webhookSecret: 's3cret' },
    };
    const withOverrides = ({ websocket = {}, events = {} }) => ({
      websocket: { ...base.websocket, ...websocket },
      events: { ...base.events, ...events },
    });

    it('reports no warnings when polling, events and webhook are all on', () => {
      expect(getRealtimeStatus(base)).toEqual({
        websocket: true,
        events: true,
        webhookConfigured: true,
        warnings: [],
      });
    });

    it('warns when WEBSOCKET_ENABLED=false (poller never starts)', () => {
      const status = getRealtimeStatus(withOverrides({ websocket: { enabled: false } }));
      expect(status.websocket).toBe(false);
      expect(status.warnings).toEqual([expect.stringMatching(/WEBSOCKET_ENABLED=false/)]);
    });

    it('warns when EVENTS_ENABLED=false', () => {
      const status = getRealtimeStatus(withOverrides({ events: { enabled: false } }));
      expect(status.events).toBe(false);
      expect(status.warnings).toEqual([expect.stringMatching(/EVENTS_ENABLED=false/)]);
    });

    it.each([
      ['URL', { webhookUrl: undefined }],
      ['secret', { webhookSecret: '' }],
    ])('warns when events are on but the webhook %s is missing', (_label, events) => {
      const status = getRealtimeStatus(withOverrides({ events }));
      expect(status.webhookConfigured).toBe(false);
      expect(status.warnings).toEqual([expect.stringMatching(/EVENTS_WEBHOOK_URL/)]);
    });

    it('does not report a webhook warning when events are disabled anyway', () => {
      const status = getRealtimeStatus(withOverrides({ events: { enabled: false, webhookUrl: '' } }));
      expect(status.warnings).toHaveLength(1);
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

    describe('realtime switches', () => {
      let saved;
      beforeEach(() => {
        saved = {
          websocket: config.websocket.enabled,
          events: config.events.enabled,
          webhookUrl: config.events.webhookUrl,
          webhookSecret: config.events.webhookSecret,
          bearerToken: config.atpApi.bearerToken,
        };
        // Fully configured baseline so each test toggles exactly one switch
        config.websocket.enabled = true;
        config.events.enabled = true;
        config.events.webhookUrl = 'http://localhost:3001/api/webhooks/atp-live/event';
        config.events.webhookSecret = 'test-secret';
        config.atpApi.bearerToken = 'test-token';
      });
      afterEach(() => {
        config.websocket.enabled = saved.websocket;
        config.events.enabled = saved.events;
        config.events.webhookUrl = saved.webhookUrl;
        config.events.webhookSecret = saved.webhookSecret;
        config.atpApi.bearerToken = saved.bearerToken;
      });

      it('reports realtime all-on with no realtime warnings', async () => {
        const response = await request(app).get('/api/health').expect(200);
        expect(response.body.realtime).toEqual({ websocket: true, events: true, webhookConfigured: true });
        expect(response.body.warnings.join(' ')).not.toMatch(/WEBSOCKET_ENABLED|EVENTS_ENABLED|EVENTS_WEBHOOK/);
      });

      it.each([
        ['WEBSOCKET_ENABLED=false', () => { config.websocket.enabled = false; }, 'websocket', /WEBSOCKET_ENABLED=false/],
        ['EVENTS_ENABLED=false', () => { config.events.enabled = false; }, 'events', /EVENTS_ENABLED=false/],
        ['missing webhook URL', () => { config.events.webhookUrl = undefined; }, 'webhookConfigured', /EVENTS_WEBHOOK_URL/],
        ['missing webhook secret', () => { config.events.webhookSecret = ''; }, 'webhookConfigured', /EVENTS_WEBHOOK_SECRET/],
      ])('flags %s with a field, a warning and non-healthy status', async (_label, apply, field, pattern) => {
        apply();
        const response = await request(app).get('/api/health').expect(200);
        expect(response.body.realtime[field]).toBe(false);
        expect(response.body.status).not.toBe('healthy');
        expect(response.body.warnings).toEqual(expect.arrayContaining([expect.stringMatching(pattern)]));
      });
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
        for (const match of content.matchAll(/process\.env(?:\.([A-Z0-9_]+)|\[\s*['"]([A-Z0-9_]+)['"]\s*\])/g)) {
          used.add(match[1] || match[2]);
        }
      }

      const documented = new Set(
        [...fs.readFileSync(ENV_EXAMPLE, 'utf8').matchAll(/^#?[ \t]*([A-Z][A-Z0-9_]+)=/gm)].map(m => m[1])
      );

      const missing = [...used].filter(name => !documented.has(name)).sort();
      expect(missing).toEqual([]);
    });
  });
});
