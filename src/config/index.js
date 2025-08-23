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
      '/api/draws/live': 60, // 1 minute
      
      // Results - medium cache time
      '/api/results': 180, // 3 minutes
      '/api/draws': 180, // 3 minutes
      
      // Static data - long cache times
      '/api/player-list': 600, // 10 minutes
      '/api/schedules': 600, // 10 minutes
      '/api/team-cup-rankings': 600, // 10 minutes
      '/api/tournaments': 3600, // 1 hour (tournament info changes rarely)
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
  polling: {
    backoff: {
      enabled: process.env.POLLING_BACKOFF_ENABLED !== 'false', // Default to enabled
      multiplier: parseFloat(process.env.POLLING_BACKOFF_MULTIPLIER) || 1.5, // Double interval on each 404
      maxMultiplier: parseFloat(process.env.POLLING_BACKOFF_MAX_MULTIPLIER) || 30, // Cap at 30x base interval (e.g., 10s → 5min)
      resetOnSuccess: process.env.POLLING_BACKOFF_RESET_ON_SUCCESS !== 'false', // Reset back-off on successful response
    }
  },
  events: {
    enabled: process.env.EVENTS_ENABLED !== 'false', // Default to enabled, set to 'false' to disable
    endpoints: (process.env.EVENTS_ENDPOINTS || '/api/live-matches,/api/draws/live').split(','),
    consoleOutput: process.env.EVENTS_CONSOLE_OUTPUT !== 'false', // Default to enabled
    // Future webhook configuration
    webhookUrl: process.env.EVENTS_WEBHOOK_URL,
    webhookSecret: process.env.EVENTS_WEBHOOK_SECRET,
  },
  apiLogging: {
    enabled: process.env.ENABLE_API_LOGGING === 'true', // Disabled by default for security
    baseDir: process.env.API_LOG_DIR || './logs/api-responses',
    logAllEndpoints: process.env.LOG_ALL_ENDPOINTS === 'true', // vs just event endpoints
    retentionDays: parseInt(process.env.LOG_RETENTION_DAYS) || 7,
    minInterval: parseInt(process.env.API_LOG_MIN_INTERVAL) || 60, // seconds between writes per endpoint
  },
};

// Validate required configuration
if (!config.atpApi.bearerToken) {
  console.warn('Warning: ATP_BEARER_TOKEN is not set. Please set it in your .env file.');
}

module.exports = config; 
