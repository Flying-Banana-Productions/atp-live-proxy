# Use Node.js LTS Alpine image for smaller size and security
FROM node:22-alpine

# Upgrade NPM
RUN npm install -g npm@11.6.0

# Set working directory
WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install dependencies (including dev dependencies for nodemon)
RUN npm ci

# Copy source code
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeapp -u 1001 -G nodejs

# Change ownership of the app directory
RUN chown -R nodeapp:nodejs /app
USER nodeapp

# Expose the port the app runs on
EXPOSE 3000

# Add health check endpoint support (create simple health route)
RUN echo 'const express = require("express"); const app = express(); app.get("/health", (req, res) => res.status(200).json({status: "ok", service: "atp-live-proxy"})); module.exports = app;' > health.js

# Use nodemon for development hot reloading
CMD ["npm", "run", "dev"]
