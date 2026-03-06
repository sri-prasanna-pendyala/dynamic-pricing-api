const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

const errorHandler = (err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
  }

  // Postgres unique violation
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      error: 'A record with that value already exists',
      detail: err.detail,
    });
  }

  // Postgres check constraint violation
  if (err.code === '23514') {
    return res.status(400).json({
      success: false,
      error: 'Constraint violation: ' + (err.constraint || err.message),
    });
  }

  logger.error('Unhandled error', { err, path: req.path, method: req.method });

  return res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
};

module.exports = errorHandler;
