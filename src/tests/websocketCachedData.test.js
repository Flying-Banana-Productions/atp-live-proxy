process.env.NODE_ENV = 'test';
process.env.REDIS_URL = '';

jest.mock('../services/cache', () => ({
  generateKey: jest.fn((endpoint) => endpoint),
  get: jest.fn(),
  getTtl: jest.fn(),
  set: jest.fn(),
}));

const cacheService = require('../services/cache');
const webSocketServer = require('../websocket');

describe('WebSocketServer.sendCachedData', () => {
  let socket;

  beforeEach(() => {
    jest.clearAllMocks();
    socket = { emit: jest.fn() };
  });

  it('sends the resolved cached data and remaining TTL', async () => {
    const liveMatches = { TournamentMatches: [{ MatchId: 'MS001' }] };
    cacheService.get.mockResolvedValue(liveMatches);
    cacheService.getTtl.mockResolvedValue(7);

    await webSocketServer.sendCachedData(socket, '/api/live-matches');

    expect(cacheService.get).toHaveBeenCalledWith('/api/live-matches');
    expect(socket.emit).toHaveBeenCalledWith('data-update', expect.objectContaining({
      endpoint: '/api/live-matches',
      data: liveMatches,
      cached: true,
      ttl: 7,
    }));
  });

  it('reports a miss when nothing is cached', async () => {
    cacheService.get.mockResolvedValue(null);

    await webSocketServer.sendCachedData(socket, '/api/live-matches');

    expect(cacheService.getTtl).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('data-update', expect.objectContaining({
      endpoint: '/api/live-matches',
      data: null,
      cached: false,
      message: 'No cached data available',
    }));
  });

  it('treats a cache error as a miss instead of rejecting', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    cacheService.get.mockRejectedValue(new Error('redis down'));

    await expect(webSocketServer.sendCachedData(socket, '/api/live-matches')).resolves.toBeUndefined();

    expect(socket.emit).toHaveBeenCalledWith('data-update', expect.objectContaining({
      data: null,
      cached: false,
    }));
    console.error.mockRestore();
  });
});
