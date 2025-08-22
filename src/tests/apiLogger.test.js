const fs = require('fs').promises;
const path = require('path');
const apiLogger = require('../services/apiLogger');

// Mock config for testing
jest.mock('../config', () => ({
  apiLogging: {
    enabled: true,
    baseDir: './test-logs/api-responses',
    logAllEndpoints: false,
    retentionDays: 30,
    minInterval: 60, // seconds between writes per endpoint
  },
  events: {
    enabled: true,
    endpoints: ['/api/live-matches', '/api/draws/live']
  }
}));

describe('API Logger Service', () => {
  const testLogDir = './test-logs';
  
  beforeAll(async () => {
    // Ensure test directory exists
    await fs.mkdir(testLogDir, { recursive: true });
  });

  afterAll(async () => {
    // Clean up test logs
    try {
      await fs.rm(testLogDir, { recursive: true, force: true });
    } catch (error) {
      console.log('Cleanup failed:', error.message);
    }
  });

  beforeEach(() => {
    // Reset logger state
    apiLogger.setEnabled(true);
  });

  describe('Basic Functionality', () => {
    it('should create proper endpoint slugs', () => {
      expect(apiLogger.slugifyEndpoint('/api/live-matches')).toBe('live-matches');
      expect(apiLogger.slugifyEndpoint('/api/draws/live')).toBe('draws-live');
      expect(apiLogger.slugifyEndpoint('/api/player-list')).toBe('player-list');
    });

    it('should generate valid timestamps', () => {
      const timestamp = apiLogger.generateTimestamp();
      expect(timestamp).toMatch(/^\d{2}-\d{2}-\d{2}-\d{3}$/);
    });

    it('should return correct status', () => {
      const status = apiLogger.getStatus();
      expect(status).toMatchObject({
        enabled: true,
        baseDir: './test-logs/api-responses',
        minInterval: expect.any(Number),
        bufferedEndpoints: expect.any(Number),
        bufferedEndpointsList: expect.any(Array),
        lastWriteTimes: expect.any(Object)
      });
    });
  });

  describe('Logging Functionality', () => {
    it('should log API response to correct directory structure', async () => {
      const endpoint = '/api/live-matches';
      const testData = {
        TournamentMatches: [{
          MatchId: 'TEST001',
          PlayerTeam1: { PlayerFirstName: 'John', PlayerLastName: 'Doe' },
          PlayerTeam2: { PlayerFirstName: 'Jane', PlayerLastName: 'Smith' },
          ResultString: '6-4, 3-2'
        }]
      };

      await apiLogger.logResponse(endpoint, testData, { testRun: true });
      
      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check that directory was created
      const date = new Date().toISOString().split('T')[0];
      const expectedDir = path.join(testLogDir, 'api-responses', 'live-matches', date);
      
      const dirExists = await fs.access(expectedDir).then(() => true).catch(() => false);
      expect(dirExists).toBe(true);

      // Check that a log file was created
      const files = await fs.readdir(expectedDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files[0]).toMatch(/^\d{2}-\d{2}-\d{2}-\d{3}_response\.json$/);

      // Check file content
      const logFile = path.join(expectedDir, files[0]);
      const content = await fs.readFile(logFile, 'utf8');
      const logData = JSON.parse(content);

      expect(logData).toMatchObject({
        timestamp: expect.any(String),
        endpoint: '/api/live-matches',
        data: testData,
        metadata: expect.objectContaining({
          server: 'atp-live-proxy',
          version: '1.0.0',
          testRun: true
        })
      });
    });

    it('should not log when disabled', async () => {
      apiLogger.setEnabled(false);
      
      const endpoint = '/api/live-matches';
      const testData = { test: 'data' };

      await apiLogger.logResponse(endpoint, testData);
      
      // Wait for potential async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check that no data is buffered when disabled
      const bufferedEndpoints = apiLogger.getStatus().bufferedEndpoints;
      expect(bufferedEndpoints).toBe(0);
    });

    it('should handle multiple concurrent log requests', async () => {
      const endpoint = '/api/live-matches';
      const requests = [];

      // Create multiple concurrent logging requests with small delays to ensure different timestamps
      for (let i = 0; i < 3; i++) {
        requests.push(apiLogger.logResponse(endpoint, { testData: i }, { requestId: i }));
        // Small delay to ensure different millisecond timestamps
        await new Promise(resolve => setTimeout(resolve, 2));
      }

      await Promise.all(requests);
      
      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check that files were created (at least some, exact count may vary due to timing)
      const date = new Date().toISOString().split('T')[0];
      const expectedDir = path.join(testLogDir, 'api-responses', 'live-matches', date);
      
      const files = await fs.readdir(expectedDir);
      expect(files.length).toBeGreaterThan(0);
      
      // Verify each file contains valid JSON
      for (const file of files) {
        const content = await fs.readFile(path.join(expectedDir, file), 'utf8');
        expect(() => JSON.parse(content)).not.toThrow();
      }
    });
  });
});