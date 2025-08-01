const express = require('express');
const atpApi = require('../services/atpApi');
const cacheService = require('../services/cache');
const { cacheMiddleware } = require('../middleware/cache');
const config = require('../config');

const router = express.Router();

// ===== DRAWS ENDPOINTS =====

/**
 * @swagger
 * /api/draws/live:
 *   get:
 *     summary: Get live draw
 *     description: Get a draw that was saved to the DB, includes results if they have not yet been published. Requires Tournament Claims.
 *     tags: [Draws]
 *     responses:
 *       200:
 *         description: Live draw retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CacheResponse'
 *       401:
 *         description: Not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Access forbidden (missing claims)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: No draw found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/draws/live', cacheMiddleware(), async (req, res, next) => {
  try {
    const data = await atpApi.getLiveDraw(req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/draws:
 *   get:
 *     summary: Get draw
 *     description: Get a draw that was saved to the DB. Requires Tournament Claims.
 *     tags: [Draws]
 *     responses:
 *       200:
 *         description: Draw retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CacheResponse'
 *       401:
 *         description: Not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Access forbidden (missing claims)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: No draw found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/draws', cacheMiddleware(), async (req, res, next) => {
  try {
    const data = await atpApi.getDraw(req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// ===== H2H (HEAD-TO-HEAD) ENDPOINTS =====

/**
 * @swagger
 * /api/h2h/match/{matchId}:
 *   get:
 *     summary: Get H2H by match ID
 *     description: Get player bios and H2H by player Ids. Requires Tournament Token.
 *     tags: [H2H]
 *     parameters:
 *       - in: path
 *         name: matchId
 *         required: true
 *         schema:
 *           type: string
 *         description: MatchId for which to retrieve H2H
 *     responses:
 *       200:
 *         description: H2H data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CacheResponse'
 *       401:
 *         description: Not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: No player detail found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/h2h/match/:matchId', cacheMiddleware(), async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const data = await atpApi.getH2HByMatch(matchId, req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/h2h/{playerId}/{opponentId}:
 *   get:
 *     summary: Get H2H by player IDs
 *     description: Get player details and H2H by player Ids
 *     tags: [H2H]
 *     parameters:
 *       - in: path
 *         name: playerId
 *         required: true
 *         schema:
 *           type: string
 *         description: Id of the player being retrieved
 *       - in: path
 *         name: opponentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Id of the opponent being retrieved
 *     responses:
 *       200:
 *         description: H2H data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CacheResponse'
 *       401:
 *         description: Not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: No player detail found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/h2h/:playerId/:opponentId', cacheMiddleware(), async (req, res, next) => {
  try {
    const { playerId, opponentId } = req.params;
    const data = await atpApi.getH2HByPlayers(playerId, opponentId, req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// ===== LIVE MATCHES ENDPOINTS =====

/**
 * @swagger
 * /api/live-matches:
 *   get:
 *     summary: Get live matches
 *     description: Get currently live matches and their scores. Requires Tournament Claims.
 *     tags: [LiveMatches]
 *     responses:
 *       200:
 *         description: Live matches retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CacheResponse'
 *       401:
 *         description: Not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: No live matches found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/live-matches', cacheMiddleware(), async (req, res, next) => {
  try {
    const data = await atpApi.getLiveMatches(req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// ===== MATCH STATS ENDPOINTS =====

/**
 * @swagger
 * /api/match-stats/{matchId}:
 *   get:
 *     summary: Get match statistics
 *     description: Get the Match Stats data for a specific match. Will try LS first, and data warehouse second. Requires Tournament Claims.
 *     tags: [MatchStats]
 *     parameters:
 *       - in: path
 *         name: matchId
 *         required: true
 *         schema:
 *           type: string
 *         description: Id of the Match
 *     responses:
 *       200:
 *         description: Match stats retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CacheResponse'
 *       401:
 *         description: Not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Access forbidden (missing claims)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: No match status found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/match-stats/:matchId', cacheMiddleware(), async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const data = await atpApi.getMatchStats(matchId, req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// ===== PLAYER LIST ENDPOINTS =====

/**
 * @swagger
 * /api/player-list:
 *   get:
 *     summary: Get tournament player list
 *     description: Retrieves the tournament player list
 *     tags: [PlayerList]
 *     responses:
 *       200:
 *         description: Player list retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CacheResponse'
 *       401:
 *         description: Not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Access forbidden (missing claims)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: No player list found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/player-list', cacheMiddleware(), async (req, res, next) => {
  try {
    const data = await atpApi.getPlayerList(req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// ===== RESULTS ENDPOINTS =====

/**
 * @swagger
 * /api/results:
 *   get:
 *     summary: Get match results
 *     description: Get completed match results for the tournament specified. Requires Tournament Claims.
 *     tags: [Results]
 *     responses:
 *       200:
 *         description: Match results retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CacheResponse'
 *       401:
 *         description: Not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Access forbidden (missing claims)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: No match results found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/results', cacheMiddleware(), async (req, res, next) => {
  try {
    const data = await atpApi.getResults(req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// ===== SCHEDULES ENDPOINTS =====

/**
 * @swagger
 * /api/schedules:
 *   get:
 *     summary: Get tournament schedule
 *     description: Get a Schedule that was saved to the DB. Requires Tournament Claims.
 *     tags: [Schedules]
 *     responses:
 *       200:
 *         description: Schedule retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CacheResponse'
 *       401:
 *         description: Not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Access forbidden (missing claims)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: No schedule found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/schedules', cacheMiddleware(), async (req, res, next) => {
  try {
    const data = await atpApi.getSchedule(req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// ===== TEAM CUP RANKINGS ENDPOINTS =====

/**
 * @swagger
 * /api/team-cup-rankings:
 *   get:
 *     summary: Get ATP Cup team rankings
 *     description: Get the ATP Cup team rankings
 *     tags: [TeamCupRankings]
 *     parameters:
 *       - in: query
 *         name: rankDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: The desired ranking date. If null, the latest ranking date will be used.
 *     responses:
 *       200:
 *         description: Team cup rankings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CacheResponse'
 */
router.get('/team-cup-rankings', cacheMiddleware(), async (req, res, next) => {
  try {
    const data = await atpApi.getTeamCupRankings(req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// ===== SYSTEM ENDPOINTS =====

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check
 *     description: Check the health status of the API
 *     tags: [System]
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
router.get('/health', (req, res) => {
  const cacheStats = cacheService.getStats();
  const memUsage = process.memoryUsage();
  const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  
  // Determine health status based on memory pressure
  let status = 'healthy';
  const warnings = [];
  
  if (heapUsedPercent > 85) {
    status = 'critical';
    warnings.push('High memory usage detected');
  } else if (heapUsedPercent > 70) {
    status = 'warning';
    warnings.push('Elevated memory usage');
  }
  
  if (cacheStats.keys > 10000) {
    warnings.push('Large number of cache keys');
  }
  
  // Check authentication configuration
  const hasBearerToken = !!config.atpApi.bearerToken;
  if (!hasBearerToken) {
    status = 'critical';
    warnings.push('ATP_BEARER_TOKEN is not configured');
  }
  
  res.json({
    status,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: config.server.nodeEnv,
    authentication: {
      configured: hasBearerToken,
      baseUrl: config.atpApi.baseUrl,
    },
    cache: {
      ttl: config.cache.ttl,
      checkPeriod: config.cache.checkPeriod,
      keys: cacheStats.keys,
      memoryUsage: `${Math.round(heapUsedPercent)}%`,
    },
    warnings,
  });
});

/**
 * @swagger
 * /api/info:
 *   get:
 *     summary: API information
 *     description: Get information about the API and available endpoints
 *     tags: [System]
 *     responses:
 *       200:
 *         description: API information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                   example: "ATP Live Proxy API"
 *                 version:
 *                   type: string
 *                   example: "1.0.0"
 *                 description:
 *                   type: string
 *                 baseUrl:
 *                   type: string
 *                 endpoints:
 *                   type: object
 *                 documentation:
 *                   type: string
 */
router.get('/info', (req, res) => {
  res.json({
    name: 'ATP Live Proxy API',
    version: '1.0.0',
    description: 'A proxy server for ATP tennis live API with caching capabilities',
    baseUrl: config.atpApi.baseUrl,
    endpoints: {
      draws: '/api/draws',
      drawsLive: '/api/draws/live',
      h2hByMatch: '/api/h2h/match/:matchId',
      h2hByPlayers: '/api/h2h/:playerId/:opponentId',
      liveMatches: '/api/live-matches',
      matchStats: '/api/match-stats/:matchId',
      playerList: '/api/player-list',
      results: '/api/results',
      schedules: '/api/schedules',
      teamCupRankings: '/api/team-cup-rankings',
      health: '/api/health',
      cacheStats: '/api/cache/stats',
      cacheConfig: '/api/cache/config',
    },
    documentation: 'https://api.protennislive.com/feeds/swagger/index.html',
  });
});

module.exports = router; 