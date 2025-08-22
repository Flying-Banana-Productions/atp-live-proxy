/**
 * Error handling middleware for Express
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function errorHandler(err, req, res, next) {

  // No verbose error logging for 404 (not found) responses; typically this is the same as an empty set
  if(err.status !== 404) {
    console.error('Error:', {
      message: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString(),
    });
  }

  // If response has already been sent, delegate to default error handler
  if (res.headersSent) {
    return next(err);
  }

  // Handle ATP API errors
  if (err.status) {
    return res.status(err.status).json({
      error: {
        message: err.message,
        status: err.status,
        statusText: err.statusText,
        timestamp: new Date().toISOString(),
      },
    });
  }

  // Handle validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: {
        message: 'Validation Error',
        details: err.message,
        timestamp: new Date().toISOString(),
      },
    });
  }

  // Handle generic errors
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: {
      message: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : message,
      status: statusCode,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * 404 handler middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      status: 404,
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString(),
    },
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
}; 
