const cors = require('cors');

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:8080',
];

const CORS_OPTIONS = {
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

/**
 * Parse a comma-separated ALLOWED_ORIGINS value, falling back to the defaults
 * @param {string|undefined} value
 * @returns {string[]}
 */
function parseAllowedOrigins(value) {
  return value
    ? value.split(',').map(origin => origin.trim())
    : DEFAULT_ALLOWED_ORIGINS;
}

/**
 * Build the CORS middleware.
 *
 * In development every origin is allowed. In production, requests from an origin
 * that isn't on the allow list are answered 403 here, rather than handing an Error
 * to the error handler (which would answer 500 and log a stack trace for each one).
 * Requests with no Origin header (native apps, curl) are allowed.
 *
 * @param {Object} options
 * @param {boolean} options.production - Whether to enforce the allow list
 * @param {string[]} [options.allowedOrigins] - Origins allowed in production
 * @returns {Function} Express middleware
 */
function createCorsMiddleware({ production, allowedOrigins = DEFAULT_ALLOWED_ORIGINS }) {
  if (!production) {
    return cors({ ...CORS_OPTIONS, origin: true });
  }

  const corsHandler = cors({ ...CORS_OPTIONS, origin: allowedOrigins });

  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      console.log(`CORS blocked origin: ${origin}`);
      return res.status(403).json({
        error: {
          message: 'Origin not allowed',
          status: 403,
          timestamp: new Date().toISOString(),
        },
      });
    }
    return corsHandler(req, res, next);
  };
}

module.exports = {
  createCorsMiddleware,
  parseAllowedOrigins,
  DEFAULT_ALLOWED_ORIGINS,
};
