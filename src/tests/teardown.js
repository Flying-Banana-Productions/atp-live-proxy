// Jest global teardown to clean up cache connections
afterAll(async () => {
  // Clean up webhook client timers and queue
  try {
    const webhookClient = require('../services/webhookClient');
    await webhookClient.shutdown();
  } catch (error) {
    // Ignore errors during cleanup
  }

  // Clean up cache service
  try {
    const cacheService = require('../services/cache');
    if (cacheService.isAvailable()) {
      await cacheService.disconnect();
    }
  } catch (error) {
    // Ignore errors during cleanup
  }
});