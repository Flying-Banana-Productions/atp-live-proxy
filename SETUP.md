# Quick Setup Guide

## Prerequisites

1. **Install Node.js** (version 16.0.0 or higher)
   - Download from: https://nodejs.org/
   - Choose the LTS version for stability

2. **Get ATP API Bearer Token**
   - Contact ATP or visit their API documentation
   - Each tournament has a unique Bearer token

## Quick Start

### Option 1: Using Batch Files (Windows)

1. **Copy environment template:**
   ```bash
   copy env.example .env
   ```

2. **Edit `.env` file:**
   - Set your `ATP_BEARER_TOKEN`
   - Adjust other settings as needed

3. **Start the server:**
   - For production: Double-click `start.bat`
   - For development: Double-click `dev.bat`

### Option 2: Using Command Line

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Setup environment:**
   ```bash
   copy env.example .env
   # Edit .env with your Bearer token
   ```

3. **Start the server:**
   ```bash
   # Production mode
   npm start
   
   # Development mode (with hot reload)
   npm run dev
   ```

## Verify Installation

1. **Check server status:**
   ```bash
   curl http://localhost:3000/api/health
   ```

2. **View API information:**
   ```bash
   curl http://localhost:3000/api/info
   ```

3. **Test an endpoint:**
   ```bash
   curl http://localhost:3000/api/schedule
   ```

## Troubleshooting

### Node.js not found
- Install Node.js from https://nodejs.org/
- Restart your terminal after installation

### Missing dependencies
- Run `npm install` to install all required packages

### API errors
- Check your Bearer token in `.env`
- Verify the token is valid for the current tournament

### Port already in use
- Change the `PORT` in `.env` file
- Or stop other services using port 3000

## Next Steps

1. **Configure your application** to use the proxy endpoints
2. **Monitor cache performance** via `/api/cache/stats`
3. **Add authentication** if needed for production use
4. **Deploy to production** using PM2 or similar process manager

## Support

- Check the main README.md for detailed documentation
- Visit the ATP API documentation: https://api.protennislive.com/feeds/swagger/index.html
- Create an issue in the repository for bugs or questions 