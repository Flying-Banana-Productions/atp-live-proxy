# ATP Live Proxy

A Node.js proxy server with Express for the ATP (Association of Tennis Professionals) live API that provides comprehensive tennis tournament data including draws, schedules, live matches, player statistics, and more.

## Features

- 🏆 **Complete ATP API Proxy**: Proxies all endpoints from the official ATP API with Bearer token authentication
- ⚡ **Flexible Caching System**: Redis, in-memory, or disabled caching with endpoint-specific TTL optimization
- 🔌 **Real-time WebSocket Updates**: Optional WebSocket support for real-time data streaming
- 🔒 **Security**: Helmet.js security headers, CORS, and rate limiting
- 📊 **Monitoring**: Health checks, cache statistics, and comprehensive logging
- 🚀 **Performance**: Response compression and optimized request handling
- 🛠️ **Development Ready**: Hot reloading with nodemon and comprehensive error handling
- 📖 **Interactive Documentation**: Swagger UI for testing API endpoints directly from the browser

> **Note:**
> 
> **Legacy endpoints are no longer supported.**
> Please update any applications using this proxy to use the new, modern endpoints listed below. See the [API Documentation](#api-endpoints) for details.

## Prerequisites

- Node.js 16.0.0 or higher
- npm or yarn package manager
- ATP API Bearer token (unique for each tournament)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd atp-live-proxy
```

2. Install dependencies:
```bash
npm install
```

3. Create environment configuration:
```bash
cp env.example .env
```

4. Configure your environment variables in `.env`:
```env
# Server Configuration
PORT=3000
NODE_ENV=development

# ATP API Configuration
ATP_API_BASE_URL=https://api.protennislive.com/feeds
ATP_BEARER_TOKEN=your_tournament_bearer_token_here

# Cache Configuration
CACHE_ENABLED=true
CACHE_TTL=30
CACHE_CHECK_PERIOD=60

# Redis Configuration (optional)
# If REDIS_URL is set and CACHE_ENABLED=true, Redis will be used as primary cache
# If Redis connection fails during startup, the server will exit with an error
# If REDIS_URL is not set, in-memory cache will be used
# REDIS_URL=redis://localhost:6379

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info

# CORS Configuration (for production)
# Comma-separated list of allowed origins
# Example: ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
ALLOWED_ORIGINS=
```

## Usage

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### Available Scripts
- `npm start` - Start the production server
- `npm run dev` - Start development server with hot reloading
- `npm test` - Run tests
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues

## API Documentation

### Interactive Swagger UI
Visit `http://localhost:3000/api-docs` in your browser to access the interactive API documentation. This allows you to:
- Browse all available endpoints organized by category
- Test API calls directly from the browser
- View request/response schemas
- See example requests and responses

### API Endpoints

#### Draws Endpoints

| Endpoint | Method | Description | Cache TTL |
|----------|--------|-------------|-----------|
| `/api/draws/live` | GET | Get live draw with unpublished results | 10 minutes |
| `/api/draws` | GET | Get tournament draw | 10 minutes |

#### Head-to-Head (H2H) Endpoints

| Endpoint | Method | Description | Cache TTL |
|----------|--------|-------------|-----------|
| `/api/h2h/match/:matchId` | GET | Get H2H data by match ID | 10 seconds |
| `/api/h2h/:playerId/:opponentId` | GET | Get H2H data by player IDs | 10 seconds |

#### Live Matches Endpoints

| Endpoint | Method | Description | Cache TTL |
|----------|--------|-------------|-----------|
| `/api/live-matches` | GET | Get currently live matches and scores | 10 seconds |

#### Match Statistics Endpoints

| Endpoint | Method | Description | Cache TTL |
|----------|--------|-------------|-----------|
| `/api/match-stats/:matchId` | GET | Get detailed match statistics | 10 seconds |

#### Player List Endpoints

| Endpoint | Method | Description | Cache TTL |
|----------|--------|-------------|-----------|
| `/api/player-list` | GET | Get tournament player list | 10 minutes |

#### Results Endpoints

| Endpoint | Method | Description | Cache TTL |
|----------|--------|-------------|-----------|
| `/api/results` | GET | Get completed match results | 3 minutes |

#### Schedules Endpoints

| Endpoint | Method | Description | Cache TTL |
|----------|--------|-------------|-----------|
| `/api/schedules` | GET | Get tournament schedule | 10 minutes |

#### Team Cup Rankings Endpoints

| Endpoint | Method | Description | Cache TTL |
|----------|--------|-------------|-----------|
| `/api/team-cup-rankings` | GET | Get ATP Cup team rankings | 10 minutes |

#### System Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server information and available endpoints |
| `/api/health` | GET | Health check endpoint |
| `/api/info` | GET | API information and documentation |
| `/api/cache/stats` | GET | Cache statistics |
| `/api/cache/config` | GET | Cache configuration (including TTL values) |
| `/api/cache/websocket` | GET | WebSocket statistics |
| `/api/cache` | DELETE | Clear all cache |
| `/api-docs` | GET | Interactive Swagger documentation |

## Example Usage

### Get Tournament Draw
```bash
curl http://localhost:3000/api/draws
```

### Get Live Draw
```bash
curl http://localhost:3000/api/draws/live
```

### Get Head-to-Head Data
```bash
curl http://localhost:3000/api/h2h/12345/67890
```

### Get Live Matches
```bash
curl http://localhost:3000/api/live-matches
```

### Get Match Statistics
```bash
curl http://localhost:3000/api/match-stats/12345
```

### Get Player List
```bash
curl http://localhost:3000/api/player-list
```

### Get Match Results
```bash
curl http://localhost:3000/api/results
```

### Get Tournament Schedule
```bash
curl http://localhost:3000/api/schedules
```

### Get Team Cup Rankings
```bash
curl http://localhost:3000/api/team-cup-rankings
```

### Check Cache Statistics
```bash
curl http://localhost:3000/api/cache/stats
```

### View Cache Configuration
```bash
curl http://localhost:3000/api/cache/config
```

### Access Swagger Documentation
Open your browser and navigate to:
```
http://localhost:3000/api-docs
```

### Test WebSocket Functionality
Open the test client in your browser:
```
http://localhost:3000/websocket-test.html
```

### Test Deployment
Open the deployment test page in your browser:
```
http://localhost:3000/test-deployment.html
```

### Access All Test Files
Visit the test files index page:
```
http://localhost:3000/
```

## WebSocket API

The proxy supports real-time data streaming via WebSocket connections. Clients can subscribe to specific endpoints and receive automatic updates when data changes.

### Connection
```javascript
const socket = io('http://localhost:3000');
```

### Events

#### Client to Server
- `subscribe` - Subscribe to endpoint(s)
  ```javascript
  socket.emit('subscribe', '/api/live-matches');
  socket.emit('subscribe', ['/api/live-matches', '/api/draws/live']);
  ```

- `unsubscribe` - Unsubscribe from endpoint(s)
  ```javascript
  socket.emit('unsubscribe', '/api/live-matches');
  socket.emit('unsubscribe', ['/api/live-matches', '/api/draws/live']);
  ```

- `get-subscriptions` - Get current subscriptions
  ```javascript
  socket.emit('get-subscriptions');
  ```

- `get-data` - Request immediate data for an endpoint
  ```javascript
  socket.emit('get-data', '/api/live-matches');
  ```

#### Server to Client
- `connected` - Connection established
  ```javascript
  {
    message: 'Connected to ATP Live Proxy WebSocket',
    socketId: 'socket-id',
    timestamp: '2024-01-15T10:30:00.000Z',
    availableEndpoints: ['/api/live-matches', '/api/draws/live', ...]
  }
  ```

- `subscribed` - Successfully subscribed to endpoint
  ```javascript
  {
    endpoint: '/api/live-matches',
    message: 'Subscribed to /api/live-matches',
    timestamp: '2024-01-15T10:30:00.000Z'
  }
  ```

- `unsubscribed` - Successfully unsubscribed from endpoint
  ```javascript
  {
    endpoint: '/api/live-matches',
    message: 'Unsubscribed from /api/live-matches',
    timestamp: '2024-01-15T10:30:00.000Z'
  }
  ```

- `subscriptions` - Current subscription list
  ```javascript
  {
    subscriptions: ['/api/live-matches', '/api/draws/live'],
    timestamp: '2024-01-15T10:30:00.000Z'
  }
  ```

- `data-update` - Real-time data update
  ```javascript
  {
    endpoint: '/api/live-matches',
    data: { /* API response data */ },
    cached: false,
    timestamp: '2024-01-15T10:30:00.000Z',
    ttl: 10
  }
  ```

- `error` - Error message
  ```javascript
  {
    message: 'Invalid endpoint: /api/invalid',
    timestamp: '2024-01-15T10:30:00.000Z'
  }
  ```

### WebSocket Features

- **Real-time Updates**: Server polls ATP API at configured TTL intervals and broadcasts updates
- **Same Response Format**: WebSocket messages match REST API response structure
- **Automatic Reconnection**: Socket.io handles connection drops and reconnection
- **Subscription Management**: Subscribe/unsubscribe to specific endpoints
- **Immediate Data**: Request cached data immediately upon subscription
- **Connection Statistics**: Monitor WebSocket connections via `/api/cache/websocket`

### Supported Endpoints for WebSocket

- `/api/live-matches` - Live matches and scores (10s TTL)
- `/api/draws/live` - Live draw with unpublished results (10m TTL)
- `/api/draws` - Tournament draw (10m TTL)
- `/api/player-list` - Tournament player list (10m TTL)
- `/api/results` - Completed match results (3m TTL)
- `/api/schedules` - Tournament schedule (10m TTL)
- `/api/team-cup-rankings` - ATP Cup team rankings (10m TTL)

## Response Format

All API responses include cache metadata with TTL information:

```json
{
  "data": {
    // Actual API response data
  },
  "cached": false,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "ttl": 600
}
```

### Response Fields

- **`data`**: The actual API response data from the ATP API
- **`cached`**: Boolean indicating if the response was served from cache (`true`) or fetched fresh (`false`)
- **`timestamp`**: ISO timestamp of when the response was generated
- **`ttl`**: Time-to-live in seconds:
  - For cached responses: Remaining time until cache expires
  - For non-cached responses: Full TTL duration applied to the cache

### TTL Usage

Clients can use the `ttl` field to optimize their polling strategy:
- Wait until `ttl` reaches 0 before making a new request for updated data
- For live data (10-second TTL), poll more frequently
- For static data (10-minute TTL), poll less frequently

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment mode |
| `ATP_API_BASE_URL` | https://api.protennislive.com/feeds | ATP API base URL |
| `ATP_BEARER_TOKEN` | - | Tournament-specific Bearer token |
| `CACHE_ENABLED` | true | Enable/disable caching (true/false) |
| `CACHE_TTL` | 30 | Default cache time-to-live in seconds |
| `CACHE_CHECK_PERIOD` | 60 | Cache cleanup check period in seconds |
| `REDIS_URL` | - | Optional Redis connection URL (enables Redis caching) |
| `RATE_LIMIT_WINDOW_MS` | 900000 | Rate limit window in milliseconds |
| `RATE_LIMIT_MAX_REQUESTS` | 100 | Maximum requests per window |
| `LOG_LEVEL` | info | Logging level |

### Cache Strategy Configuration

The application uses a **single cache provider architecture** determined at startup for optimal performance and predictable behavior. The cache provider is selected automatically based on your configuration:

#### **Cache Provider Selection**

1. **Disabled Caching** (`CACHE_ENABLED=false`)
   - Uses no-op cache (all operations ignored)
   - Best for development/testing when caching interferes with debugging

2. **Redis Caching** (`CACHE_ENABLED=true` + `REDIS_URL` set)
   - Primary choice for production deployments
   - Supports clustering and persistence
   - **Fail-fast behavior**: Server exits immediately if Redis connection fails at startup
   - No fallback to other providers during operation
   - Redis URL formats:
     - Local: `redis://localhost:6379`
     - With auth: `redis://user:password@host:port/database`
     - Redis Cloud: Use the provided connection URL from your service

3. **In-Memory Caching** (`CACHE_ENABLED=true` + no `REDIS_URL`)
   - Default fallback when Redis is not configured
   - Uses node-cache for fast in-memory storage
   - Data lost on server restart
   - Perfect for single-instance deployments

#### **Benefits of Single Provider Architecture**

- **Predictable Performance**: Always know which cache system is active
- **No Hybrid Complexity**: No confusing fallback logic during requests
- **Clear Failure Modes**: Redis failures are caught at startup, not during user requests
- **Simplified Operations**: Each deployment has one clear caching strategy

### Smart Cache Configuration

The proxy uses intelligent caching with endpoint-specific TTL values:

#### **Live Data (10 seconds)**
- Live matches, match statistics, and head-to-head data
- These change frequently during matches

#### **Results (3 minutes)**
- Completed match results
- Updates periodically as matches finish

#### **Static Data (10 minutes)**
- Player lists, draws, schedules, and team rankings
- These change infrequently during tournaments

#### **Default Fallback (30 seconds)**
- Any endpoint not specifically configured
- Configurable via `CACHE_TTL` environment variable

### Cache Features

- **Single provider architecture**: Redis OR in-memory OR disabled (no hybrid complexity)
- **Automatic cleanup**: Every 60 seconds (in-memory cache only)
- **Cache persistence**: Redis survives restarts, in-memory does not
- **Cache keys**: Generated from endpoint and query parameters
- **Cache statistics**: Available via `/api/cache/stats`
- **Cache configuration**: View current TTL values and active provider via `/api/cache/config`
- **Fail-fast Redis**: Server exits immediately on Redis connection failure (no silent degradation)

## Security Features

- **Helmet.js**: Security headers
- **CORS**: Cross-origin resource sharing configuration
- **Rate Limiting**: Configurable request rate limiting
- **Input Validation**: Request parameter validation
- **Error Handling**: Comprehensive error handling and logging

## Error Handling

The proxy provides consistent error responses:

```json
{
  "error": {
    "message": "Error description",
    "status": 400,
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

## Development

### Project Structure
```
atp-live-proxy/
├── src/
│   ├── config/          # Configuration management
│   ├── middleware/      # Express middleware
│   ├── routes/          # API routes
│   ├── services/        # Business logic services
│   ├── tests/           # Test files
│   ├── swagger.js       # Swagger configuration
│   └── server.js        # Main server file
├── public/              # Static files (test pages, etc.)
│   ├── index.html       # Test files index page
│   ├── test-deployment.html  # Deployment test page
│   └── websocket-test.html   # WebSocket test client
├── .env                 # Environment variables
├── env.example          # Environment template
├── package.json         # Dependencies and scripts
└── README.md           # Documentation
```

### Adding New Endpoints

1. Add the endpoint method to `src/services/atpApi.js`
2. Create a route in `src/routes/api.js` with JSDoc comments for Swagger
3. Configure appropriate cache TTL in `src/config/index.js`
4. The caching middleware will automatically apply the correct TTL

### Testing

```bash
npm test
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Configure production environment variables
3. Use a process manager like PM2:
```bash
npm install -g pm2
pm2 start src/server.js --name atp-proxy
```

### Cloud Deployment (Railway, Heroku, etc.)

When deploying to cloud platforms, make sure to set these environment variables:

```env
NODE_ENV=production
ATP_BEARER_TOKEN=your_tournament_bearer_token_here
ATP_API_BASE_URL=https://api.protennislive.com/feeds
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

### Troubleshooting Deployment Issues

#### CORS Errors
If you're getting "Cross-Origin Request Blocked" errors:

1. **Check CORS Configuration**: Ensure `ALLOWED_ORIGINS` includes your domain
2. **Test with Health Check**: Visit `https://your-domain.com/api/health` to verify the server is running
3. **Use the Test Page**: Open `https://your-domain.com/test-deployment.html` in your browser to test all endpoints

#### Authentication Errors (401)
If you're getting 401 "Not authorized" errors:

1. **Check Bearer Token**: Verify `ATP_BEARER_TOKEN` is set correctly in your environment
2. **Token Validity**: Ensure your ATP Bearer token is valid and not expired
3. **Health Check**: The `/api/health` endpoint will show if authentication is configured

#### Common Issues

| Issue | Solution |
|-------|----------|
| CORS blocked | Set `ALLOWED_ORIGINS` environment variable |
| 401 Unauthorized | Check `ATP_BEARER_TOKEN` is set |
| 404 Not Found | Verify the endpoint URL is correct |
| 500 Server Error | Check server logs for detailed error messages |
| Server exits on startup | Check Redis connection if `REDIS_URL` is configured |

#### Redis-Specific Troubleshooting

If you're using Redis caching and experiencing startup issues:

1. **Server Exits Immediately**: Redis connection failed during startup
   - Verify Redis is running: `redis-cli ping`
   - Check Redis URL format: `redis://host:port` or `redis://user:pass@host:port/db`
   - For local development: `redis://localhost:6379`
   - For Redis Cloud/managed services: Use the exact URL provided

2. **Connection Refused Errors**:
   ```bash
   # Start local Redis server
   redis-server
   
   # Or with Docker
   docker run -p 6379:6379 redis:alpine
   ```

3. **Authentication Errors**: Include credentials in Redis URL
   ```env
   REDIS_URL=redis://username:password@hostname:port/database
   ```

4. **Switch to In-Memory Cache**: Remove or comment out `REDIS_URL`
   ```env
   # REDIS_URL=redis://localhost:6379
   ```

5. **Disable Caching Entirely**: Set `CACHE_ENABLED=false`
   ```env
   CACHE_ENABLED=false
   ```

#### Testing Your Deployment

1. **Health Check**: `GET /api/health` - Should return 200 with authentication status
2. **API Info**: `GET /api/info` - Should return 200 with endpoint information
3. **Test Page**: Use `https://your-domain.com/test-deployment.html` to test all endpoints from your browser

#### Environment Variables Checklist

- ✅ `NODE_ENV=production`
- ✅ `ATP_BEARER_TOKEN=your_valid_token`
- ✅ `ATP_API_BASE_URL=https://api.protennislive.com/feeds`
- ✅ `ALLOWED_ORIGINS=https://yourdomain.com` (comma-separated if multiple)
- ✅ `PORT` (usually auto-set by cloud platform)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

Apache License 2.0 - see LICENSE file for details

## API Documentation

For detailed API documentation, visit: [ATP API Swagger](https://api.protennislive.com/feeds/swagger/index.html)

## Support

For issues and questions, please create an issue in the repository.