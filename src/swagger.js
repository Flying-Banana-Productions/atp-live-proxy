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
              example: 'healthy',
            },
            version: {
              type: 'string',
              example: '1.0.0',
            },
            cache: {
              type: 'object',
              properties: {
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
        // ATP API specific schemas
        H2HSummary: {
          type: 'object',
          description: 'Head-to-head summary between players',
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