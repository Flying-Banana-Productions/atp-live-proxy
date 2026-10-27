const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ATP Live Proxy API',
      version: '1.0.0',
      description: 'A proxy server for ATP tennis live API with caching capabilities',
      contact: {
        name: 'API Support',
        url: 'https://api.protennislive.com/feeds/swagger/index.html',
      },
      license: {
        name: 'Apache 2.0',
        url: 'https://opensource.org/licenses/Apache-2.0',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  description: 'Error message',
                },
                status: {
                  type: 'integer',
                  description: 'HTTP status code',
                },
                timestamp: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Error timestamp',
                },
              },
            },
          },
        },
        CacheResponse: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              description: 'The actual API response data',
            },
            cached: {
              type: 'boolean',
              description: 'Whether the response was served from cache',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Response timestamp',
            },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['healthy', 'warning', 'critical'],
              example: 'healthy',
            },
            version: {
              type: 'string',
              example: '1.0.0',
            },
            realtime: {
              type: 'object',
              description: 'Realtime pipeline switches; any false value adds a warning',
              properties: {
                websocket: { type: 'boolean', description: 'WEBSOCKET_ENABLED (background polling runs only when true)' },
                events: { type: 'boolean', description: 'EVENTS_ENABLED' },
                webhookConfigured: { type: 'boolean', description: 'EVENTS_WEBHOOK_URL and EVENTS_WEBHOOK_SECRET both set' },
              },
            },
            freezeMode: {
              type: 'boolean',
              description: 'True when the write-once filesystem cache (FILESYSTEM_CACHE_DIR) is active and live data will not update',
            },
            cache: {
              type: 'object',
              properties: {
                provider: {
                  type: 'string',
                  description: 'Active cache provider (memory, redis, filesystem, noop)',
                },
                ttl: {
                  type: 'integer',
                  description: 'Cache time-to-live in seconds',
                },
                checkPeriod: {
                  type: 'integer',
                  description: 'Cache cleanup check period in seconds',
                },
              },
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        CacheStats: {
          type: 'object',
          properties: {
            stats: {
              type: 'object',
              properties: {
                keys: {
                  type: 'integer',
                  description: 'Number of cached keys',
                },
                hits: {
                  type: 'integer',
                  description: 'Number of cache hits',
                },
                misses: {
                  type: 'integer',
                  description: 'Number of cache misses',
                },
                ksize: {
                  type: 'integer',
                  description: 'Cache key size',
                },
                vsize: {
                  type: 'integer',
                  description: 'Cache value size',
                },
              },
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        H2HCacheResponse: {
          type: 'object',
          description: 'Cache envelope whose data is an H2H summary',
          properties: {
            data: {
              $ref: '#/components/schemas/H2HSummary',
            },
            cached: {
              type: 'boolean',
              description: 'Whether the response was served from cache',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Response timestamp',
            },
            ttl: {
              type: 'integer',
              description: 'Cache time-to-live in seconds (remaining TTL when served from cache)',
            },
          },
        },
        // ATP API specific schemas
        H2HSummary: {
          type: 'object',
          description: 'Head-to-head summary between players. By match ID, Player/Partner is team 1 and Opponent/OpponentPartner is team 2, in draw order',
          properties: {
            Player: { $ref: '#/components/schemas/H2HPlayer' },
            Partner: {
              allOf: [{ $ref: '#/components/schemas/H2HPlayer' }],
              nullable: true,
              description: 'Doubles partner of Player; null for singles',
            },
            Opponent: { $ref: '#/components/schemas/H2HPlayer' },
            OpponentPartner: {
              allOf: [{ $ref: '#/components/schemas/H2HPlayer' }],
              nullable: true,
              description: 'Doubles partner of Opponent; null for singles',
            },
            CountableTournaments: {
              type: 'array',
              description: 'Tour-level meetings (ATP and Grand Slam), newest year first',
              items: { $ref: '#/components/schemas/H2HMeeting' },
            },
            NonCountableTournaments: {
              type: 'array',
              description: 'Other meetings (Challenger, ITF and other), newest year first',
              items: { $ref: '#/components/schemas/H2HMeeting' },
            },
          },
        },
        H2HPlayer: {
          type: 'object',
          description: 'Player bio and record. Career and YTD W-L and titles are tour-level',
          properties: {
            PlayerId: { type: 'string', example: 'H0F1' },
            FirstName: { type: 'string' },
            LastName: { type: 'string' },
            PlayerHeadshotUrl: { type: 'string' },
            NatlId: { type: 'string', example: 'USA' },
            Nationality: { type: 'string' },
            Coach: { type: 'string', nullable: true },
            Age: { type: 'integer' },
            BirthDate: { type: 'string', example: '2001-05-14T00:00:00' },
            BirthCity: { type: 'string' },
            Residence: { type: 'string', nullable: true },
            HeightFt: { type: 'string', example: '6\'2"' },
            HeightCm: { type: 'integer' },
            WeightLb: { type: 'integer' },
            WeightKg: { type: 'integer' },
            PlayHand: { type: 'string', enum: ['R', 'L'] },
            BackHand: { type: 'string', enum: ['1', '2'], description: 'One- or two-handed backhand' },
            ProYear: { type: 'integer', nullable: true },
            SglRank: { type: 'integer', description: '0 = unranked' },
            DblRank: { type: 'integer', description: '0 = unranked' },
            SglHiRank: { type: 'integer' },
            SglHiRankDate: { type: 'string', example: '2026-08-03T00:00:00' },
            DblHiRank: { type: 'integer' },
            DblHiRankDate: { type: 'string', example: '2026-10-26T00:00:00' },
            SglCareerTitles: { type: 'integer' },
            DblCareerTitles: { type: 'integer' },
            SglCareerWon: { type: 'integer' },
            SglCareerLost: { type: 'integer' },
            DblCareerWon: { type: 'integer' },
            DblCareerLost: { type: 'integer' },
            SglYtdTitles: { type: 'integer' },
            DblYtdTitles: { type: 'integer' },
            SglYtdWon: { type: 'integer' },
            SglYtdLost: { type: 'integer' },
            DblYtdWon: { type: 'integer' },
            DblYtdLost: { type: 'integer' },
            YtdPrize: { type: 'integer' },
            CareerPrize: { type: 'integer' },
            H2HWins: { type: 'integer', description: 'Wins in countable (tour-level) meetings only' },
            H2HWinsPercentage: { type: 'number' },
          },
        },
        H2HMeeting: {
          type: 'object',
          description: 'A previous meeting. Doubles meetings are team vs team',
          properties: {
            TournamentYear: { type: 'integer', example: 2026 },
            TournamentName: { type: 'string', example: 'Fort Worth' },
            TournamentId: { type: 'string', example: '3187', description: 'A string here; the live, results and schedule feeds use a number' },
            TournamentTitle: { type: 'string', nullable: true, description: 'Can be the sponsor\'s all-caps name' },
            TournamentCity: { type: 'string' },
            TournamentLocation: { type: 'string' },
            MatchId: { type: 'string', example: 'MS001', description: 'Unique only together with TournamentId and TournamentYear' },
            Surface: { type: 'string', example: 'Hard' },
            RoundName: { type: 'string', example: 'SF' },
            WinningPlayerId: { type: 'string', description: 'For doubles, the winning team\'s first-listed player' },
            WinningFirstName: { type: 'string' },
            WinningLastName: { type: 'string' },
            ResultString: {
              type: 'string',
              example: '64 76(5)',
              description: 'Winner first, loser\'s tiebreak points in parentheses; empty for a walkover',
            },
          },
        },
        LiveMatchesScores: {
          type: 'object',
          description: 'Live matches and their scores',
        },
        MatchStats: {
          type: 'object',
          description: 'Match statistics data',
        },
        TournamentPlayerList: {
          type: 'object',
          description: 'Tournament player list',
        },
        TournamentMatchResults: {
          type: 'object',
          description: 'Tournament match results',
        },
        TournamentMatch: {
          type: 'object',
          description: 'Individual tournament match',
        },
        MatchPlayerTeam: {
          type: 'object',
          description: 'Player team in a match',
        },
        TournamentPlayerListItem: {
          type: 'object',
          description: 'Tournament player list item',
        },
        PlayerListItem: {
          type: 'object',
          description: 'Individual player list item',
        },
      },
      responses: {
        NotFound: {
          description: 'Endpoint not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        ServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        Unauthorized: {
          description: 'Not authorized',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        Forbidden: {
          description: 'Access forbidden (missing claims)',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.js'], // Path to the API routes
};

const specs = swaggerJsdoc(options);

module.exports = specs; 