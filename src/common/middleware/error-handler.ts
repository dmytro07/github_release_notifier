import type { ErrorRequestHandler } from 'express';
import { AppError, GitHubRateLimitError } from '../errors/app-error.js';
import { logger } from '../../config/logger.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof GitHubRateLimitError) {
    res
      .status(503)
      .set('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)))
      .json({ error: err.message });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  logger.error(err, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
};
