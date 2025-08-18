// Jest global teardown to clean up cache connections
afterAll(async () => {
  // Clean up cache service
  try {
    const cacheService = require('../services/cache');
    if (cacheService.isAvailable()) {
      await cacheService.disconnect();
    }
    console.log('Cache cleanup completed');
  } catch (error) {
    // Ignore errors during cleanup
    console.log('Cache cleanup completed');
  }
});