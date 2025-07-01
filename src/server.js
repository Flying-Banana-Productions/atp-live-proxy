const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const apiRoutes = require('./routes/api');
const cacheRoutes = require('./routes/cache');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const webSocketServer = require('./websocket');

// Import Swagger specs
const swaggerSpecs = require('./swagger');

const app = express();

// Security middleware
app.use(helmet());

// CORS middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : true,
  credentials: true,
}));

// Compression middleware
app.use(compression());

// Logging middleware
if (config.server.nodeEnv === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    error: {
      message: 'Too many requests from this IP, please try again later.',
      status: 429,
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'ATP Live Proxy API Documentation',
  customfavIcon: '/favicon.ico',
  swaggerOptions: {
    docExpansion: 'list',
    filter: true,
    showRequestHeaders: true,
  },
}));

// API routes (cache middleware will be applied at route level)
app.use('/api', apiRoutes);

// Cache management routes (no cache middleware)
app.use('/api', cacheRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'ATP Live Proxy API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      api: '/api',
      health: '/api/health',
      info: '/api/info',
      cacheStats: '/api/cache/stats',
      cacheConfig: '/api/cache/config',
      swagger: '/api-docs',
    },
    documentation: 'https://api.protennislive.com/feeds/swagger/index.html',
  });
});

// 404 handler
app.use(notFoundHandler);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server only if not in test environment
let server;
if (process.env.NODE_ENV !== 'test') {
  const PORT = config.server.port;
  server = app.listen(PORT, () => {
    console.log(`🚀 ATP Live Proxy Server running on port ${PORT}`);
    console.log(`📊 Environment: ${config.server.nodeEnv}`);
    console.log(`🔗 API Base URL: ${config.atpApi.baseUrl}`);
    console.log(`⏱️  Cache TTL: ${config.cache.ttl} seconds (default)`);
    console.log(`📈 Rate Limit: ${config.rateLimit.maxRequests} requests per ${config.rateLimit.windowMs / 1000 / 60} minutes`);
    console.log(`🌐 Server URL: http://localhost:${PORT}`);
    console.log(`📋 API Info: http://localhost:${PORT}/api/info`);
    console.log(`💚 Health Check: http://localhost:${PORT}/api/health`);
    console.log(`📖 Swagger Docs: http://localhost:${PORT}/api-docs`);
    console.log(`⚙️  Cache Config: http://localhost:${PORT}/api/cache/config`);
    console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  });

  // Initialize WebSocket server
  webSocketServer.initialize(server);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  webSocketServer.stop();
  if (server) {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  webSocketServer.stop();
  if (server) {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

module.exports = { app, server }; 