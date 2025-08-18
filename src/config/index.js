require('dotenv').config();

const config = {
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  atpApi: {
    baseUrl: process.env.ATP_API_BASE_URL || 'https://api.protennislive.com/feeds',
    bearerToken: process.env.ATP_BEARER_TOKEN,
  },
  cache: {
    enabled: process.env.CACHE_ENABLED !== 'false', // Default to enabled, set to 'false' to disable
    ttl: parseInt(process.env.CACHE_TTL) || 30, // seconds - default fallback
    checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD) || 60, // seconds
    // Endpoint-specific TTL values (in seconds)
    endpoints: {
      // Live data - short cache times
      '/api/live-matches': 10,
      '/api/match-stats': 10,
      '/api/h2h/match': 10,
      '/api/h2h': 10, // H2H by player IDs
      
      // Results - medium cache time
      '/api/results': 180, // 3 minutes
      
      // Static data - long cache times
      '/api/player-list': 600, // 10 minutes
      '/api/draws': 600, // 10 minutes
      '/api/draws/live': 600, // 10 minutes
      '/api/schedules': 600, // 10 minutes
      '/api/team-cup-rankings': 600, // 10 minutes
    },
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  redis: {
    url: process.env.REDIS_URL,
    flushOnStartup: process.env.REDIS_FLUSH_ON_STARTUP !== 'false', // Default to true, set to 'false' to disable
  },
};

// Validate required configuration
if (!config.atpApi.bearerToken) {
  console.warn('Warning: ATP_BEARER_TOKEN is not set. Please set it in your .env file.');
}

module.exports = config; 