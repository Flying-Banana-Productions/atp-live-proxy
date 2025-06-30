# ATP Live Proxy

A Node.js proxy server with Express for the ATP (Association of Tennis Professionals) live API that provides comprehensive tennis tournament data including draws, schedules, live matches, player statistics, and more.

## Features

- 🏆 **Complete ATP API Proxy**: Proxies all endpoints from the official ATP API with Bearer token authentication
- ⚡ **In-Memory Caching**: Endpoint-specific cache timeouts optimized for different data types
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
CACHE_TTL=30
CACHE_CHECK_PERIOD=60

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
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

## Response Format

All API responses include cache metadata:

```json
{
  "data": {
    // Actual API response data
  },
  "cached": false,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment mode |
| `ATP_API_BASE_URL` | https://api.protennislive.com/feeds | ATP API base URL |
| `ATP_BEARER_TOKEN` | - | Tournament-specific Bearer token |
| `CACHE_TTL` | 30 | Default cache time-to-live in seconds |
| `CACHE_CHECK_PERIOD` | 60 | Cache cleanup check period in seconds |
| `RATE_LIMIT_WINDOW_MS` | 900000 | Rate limit window in milliseconds |
| `RATE_LIMIT_MAX_REQUESTS` | 100 | Maximum requests per window |
| `LOG_LEVEL` | info | Logging level |

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

- **Automatic cleanup**: Every 60 seconds
- **Cache keys**: Generated from endpoint and query parameters
- **Cache statistics**: Available via `/api/cache/stats`
- **Cache configuration**: View current TTL values via `/api/cache/config`

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