const request = require('supertest');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.CACHE_ENABLED = 'true'; // Enable cache for tests
process.env.REDIS_URL = ''; // Force in-memory cache for tests

// Mock ATP API to avoid real API calls
jest.mock('../services/atpApi', () => ({
  getSchedule: jest.fn(),
}));

const { app } = require('../server');
const atpApi = require('../services/atpApi');
const cacheService = require('../services/cache');

describe('Schedules API', () => {
  // Initialize cache service before running tests
  beforeAll(async () => {
    await cacheService.initialize();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Flush cache between tests to ensure isolation
    if (cacheService.isInitialized) {
      await cacheService.flush();
    }
  });

  afterAll(async () => {
    // Ensure webhook client is cleaned up
    const webhookClient = require('../services/webhookClient');
    await webhookClient.shutdown();
  });

  describe('GET /api/schedules', () => {
    it('should return full schedule data', async () => {
      const mockScheduleData = {
        DailySchedule: [
          {
            IsoDate: '2025-10-29T00:00:00',
            Matches: [{ matchId: '1' }]
          },
          {
            IsoDate: '2025-10-30T00:00:00',
            Matches: [{ matchId: '2' }]
          }
        ]
      };

      atpApi.getSchedule.mockResolvedValue(mockScheduleData);

      const response = await request(app)
        .get('/api/schedules')
        .expect(200);

      expect(response.body.data).toEqual(mockScheduleData);
      expect(atpApi.getSchedule).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /api/schedules/date/:date', () => {
    const mockScheduleData = {
      TournamentName: 'Test Tournament',
      DailySchedule: [
        {
          IsoDate: '2025-10-29T00:00:00',
          DayOfWeek: 'Tuesday',
          Matches: [
            { matchId: '1', players: ['Player A', 'Player B'] }
          ]
        },
        {
          IsoDate: '2025-10-30T00:00:00.000Z',
          DayOfWeek: 'Wednesday',
          Matches: [
            { matchId: '2', players: ['Player C', 'Player D'] },
            { matchId: '3', players: ['Player E', 'Player F'] }
          ]
        },
        {
          IsoDate: '2025-10-31T00:00:00',
          DayOfWeek: 'Thursday',
          Matches: [
            { matchId: '4', players: ['Player G', 'Player H'] }
          ]
        }
      ]
    };

    beforeEach(() => {
      atpApi.getSchedule.mockResolvedValue(mockScheduleData);
    });

    it('should filter schedule by date when ISO datetime has no timezone', async () => {
      const response = await request(app)
        .get('/api/schedules/date/2025-10-29')
        .expect(200);

      expect(response.body.data.TournamentName).toBe('Test Tournament');
      expect(response.body.data.DailySchedule).toHaveLength(1);
      expect(response.body.data.DailySchedule[0].IsoDate).toBe('2025-10-29T00:00:00');
      expect(response.body.data.DailySchedule[0].Matches).toHaveLength(1);
    });

    it('should filter schedule by date when ISO datetime has timezone', async () => {
      const response = await request(app)
        .get('/api/schedules/date/2025-10-30')
        .expect(200);

      expect(response.body.data.DailySchedule).toHaveLength(1);
      expect(response.body.data.DailySchedule[0].IsoDate).toBe('2025-10-30T00:00:00.000Z');
      expect(response.body.data.DailySchedule[0].Matches).toHaveLength(2);
    });

    it('should return empty array when no matches for date', async () => {
      const response = await request(app)
        .get('/api/schedules/date/2025-11-01')
        .expect(200);

      expect(response.body.data.DailySchedule).toHaveLength(0);
    });

    it('should return 400 for invalid date format', async () => {
      const response = await request(app)
        .get('/api/schedules/date/not-a-date')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid date format');
    });

    it('should return 400 for incomplete date', async () => {
      const response = await request(app)
        .get('/api/schedules/date/2025-10')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid date format');
    });

    it('should return 400 for malformed date', async () => {
      const response = await request(app)
        .get('/api/schedules/date/2025-13-45')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should handle API returning null IsoDate gracefully', async () => {
      const mockDataWithNull = {
        DailySchedule: [
          {
            IsoDate: null,
            Matches: [{ matchId: '1' }]
          },
          {
            IsoDate: '2025-10-30T00:00:00',
            Matches: [{ matchId: '2' }]
          }
        ]
      };

      atpApi.getSchedule.mockResolvedValue(mockDataWithNull);

      const response = await request(app)
        .get('/api/schedules/date/2025-10-30')
        .expect(200);

      expect(response.body.data.DailySchedule).toHaveLength(1);
      expect(response.body.data.DailySchedule[0].IsoDate).toBe('2025-10-30T00:00:00');
    });

    it('should handle API returning undefined DailySchedule', async () => {
      atpApi.getSchedule.mockResolvedValue({ TournamentName: 'Test' });

      const response = await request(app)
        .get('/api/schedules/date/2025-10-30')
        .expect(200);

      expect(response.body.data).toEqual({ TournamentName: 'Test' });
    });

    it('should handle API returning non-array DailySchedule', async () => {
      atpApi.getSchedule.mockResolvedValue({ DailySchedule: 'not-an-array' });

      const response = await request(app)
        .get('/api/schedules/date/2025-10-30')
        .expect(200);

      expect(response.body.data).toEqual({ DailySchedule: 'not-an-array' });
    });

    it('should pass query parameters to ATP API', async () => {
      await request(app)
        .get('/api/schedules/date/2025-10-30?tournamentId=123&round=QF')
        .expect(200);

      expect(atpApi.getSchedule).toHaveBeenCalledWith({
        tournamentId: '123',
        round: 'QF'
      });
    });
  });
});
