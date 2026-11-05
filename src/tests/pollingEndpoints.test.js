process.env.NODE_ENV = 'test';
process.env.REDIS_URL = '';

const atpApi = require('../services/atpApi');
const pollingService = require('../services/pollingService');
const webSocketServer = require('../websocket');

describe('Polling endpoint map', () => {
  afterEach(() => jest.restoreAllMocks());

  it('polls /api/draws with atpApi.getDraw', async () => {
    const draw = { Tournament: { Name: 'Knoxville' } };
    const spy = jest.spyOn(atpApi, 'getDraw').mockResolvedValue(draw);

    const result = await pollingService.fetchEndpointData('/api/draws');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: draw, status: 200 });
  });

  it.each([
    ['/api/live-matches', 'getLiveMatches'],
    ['/api/draws/live', 'getLiveDraw'],
    ['/api/draws', 'getDraw'],
    ['/api/player-list', 'getPlayerList'],
    ['/api/results', 'getResults'],
    ['/api/schedules', 'getSchedule'],
    ['/api/team-cup-rankings', 'getTeamCupRankings'],
  ])('%s calls an atpApi method that exists (%s)', async (endpoint, method) => {
    expect(typeof atpApi[method]).toBe('function');
    const spy = jest.spyOn(atpApi, method).mockResolvedValue({ ok: true });

    const result = await pollingService.fetchEndpointData(endpoint);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: { ok: true }, status: 200 });
  });

  it.each(['/api/h2h', '/api/h2h/match', '/api/match-stats', 'constructor', '/api/unknown'])(
    'does not poll %s',
    async (endpoint) => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      expect(pollingService.isPollable(endpoint)).toBe(false);
      expect(await pollingService.fetchEndpointData(endpoint)).toBeNull();
    }
  );

  it('only accepts websocket subscriptions for pollable endpoints', () => {
    expect(webSocketServer.isValidEndpoint('/api/live-matches')).toBe(true);
    expect(webSocketServer.isValidEndpoint('/api/draws')).toBe(true);
    expect(webSocketServer.isValidEndpoint('/api/h2h')).toBe(false);
    expect(webSocketServer.isValidEndpoint('/api/match-stats')).toBe(false);
  });
});
