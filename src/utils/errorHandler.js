const logger = require('./logger');

// Central error handler middleware for Express
const errorHandler = (err, req, res, next) => {
  // Log the error
  logger.error('Unhandled error:', err);
  
  // Determine status code (default to 500)
  const statusCode = err.statusCode || 500;
  
  // Prepare error response
  const errorResponse = {
    status: 'error',
    message: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message
  };
  
  // Include stack trace in development
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.stack = err.stack;
  }
  
  // Send error response
  res.status(statusCode).json(errorResponse);
};

module.exports = errorHandler;