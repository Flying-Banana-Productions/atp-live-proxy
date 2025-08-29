const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const cron = require('node-cron');

const config = require('./config');
const apiRoutes = require('./routes/api');
const cacheRoutes = require('./routes/cache');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const webSocketServer = require('./websocket');

// Import Swagger specs
const swaggerSpecs = require('./swagger');

const app = express();

// Health check endpoint (before other middleware)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'atp-live-proxy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Security middleware
app.use(helmet());

// CORS middleware
const corsOptions = {
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

if (process.env.NODE_ENV === 'production') {
  // Allow specific origins in production
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:8080'
    ];
  
  corsOptions.origin = function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  };
} else {
  // Allow all origins in development
  corsOptions.origin = true;
}

app.use(cors(corsOptions));

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

// Root endpoint - must be before static middleware to avoid index.html conflict
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
      swaggerJson: '/api-docs/swagger.json',
      test: '/test',
    },
    documentation: 'https://api.protennislive.com/feeds/swagger/index.html',
  });
});

// Static file serving
app.use(express.static('public')); // Serve files from public directory

// Swagger JSON endpoint
app.get('/api-docs/swagger.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpecs);
});

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'ATP Live Proxy API Documentation',
  customfavIcon: '/favicon.ico',
  swaggerOptions: {
    docExpansion: 'list',
    filter: true,
    showRequestHeaders: true,
    url: '/api-docs/swagger.json',
  },
}));

// API routes (cache middleware will be applied at route level)
app.use('/api', apiRoutes);

// Cache management routes (no cache middleware)
app.use('/api', cacheRoutes);

// Test deployment page route
app.get('/test', (req, res) => {
  res.sendFile('test-deployment.html', { root: 'public' });
});

// 404 handler
app.use(notFoundHandler);

// Error handling middleware (must be last)
app.use(errorHandler);

// Initialize cache service and start server
async function startServer() {
  const cacheService = require('./services/cache');
  
  try {
    // Initialize cache service first
    console.log('🔄 Initializing cache service...');
    await cacheService.initialize();
    
    const PORT = config.server.port;
    server = app.listen(PORT, () => {
      console.log(`🚀 ATP Live Proxy Server running on port ${PORT}`);
      console.log(`📊 Environment: ${config.server.nodeEnv}`);
      console.log(`🔗 API Base URL: ${config.atpApi.baseUrl}`);
      console.log(`🗄️  Cache Strategy: ${cacheService.getProviderType()}`);
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
    
    // Run initial API logger cleanup
    try {
      const apiLogger = require('./services/apiLogger');
      const retentionDays = process.env.LOG_RETENTION_DAYS ? parseInt(process.env.LOG_RETENTION_DAYS) : 30;
      await apiLogger.cleanup(retentionDays);
    } catch (error) {
      console.error('⚠️ API logger startup cleanup failed:', error.message);
    }
    
    // Schedule daily API logger cleanup at 2 AM
    cron.schedule('0 2 * * *', async () => {
      try {
        const apiLogger = require('./services/apiLogger');
        const retentionDays = process.env.LOG_RETENTION_DAYS ? parseInt(process.env.LOG_RETENTION_DAYS) : 30;
        console.log('🧹 Starting scheduled API logger cleanup...');
        await apiLogger.cleanup(retentionDays);
      } catch (error) {
        console.error('⚠️ Scheduled API logger cleanup failed:', error.message);
      }
    }, {
      scheduled: true,
      timezone: 'UTC'
    });
  } catch (error) {
    console.error('❌ Failed to initialize cache service:', error.message);
    console.error('🛑 Server startup aborted');
    process.exit(1);
  }
}

// Start server only if not in test environment
let server;
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down gracefully...');
  
  // Stop WebSocket server
  webSocketServer.stop();
  
  // Flush any buffered API logger data
  try {
    const apiLogger = require('./services/apiLogger');
    await apiLogger.flushBufferedData();
  } catch (error) {
    console.error('Error flushing API logger data:', error.message);
  }
  
  // Disconnect cache service
  try {
    const cacheService = require('./services/cache');
    await cacheService.disconnect();
  } catch (error) {
    console.error('Error disconnecting cache service:', error.message);
  }
  
  // Close HTTP server
  if (server) {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  shutdown();
});

module.exports = { app, server }; 