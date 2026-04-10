import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { UnauthorizedError, ForbiddenError } from '../errors/app-error.js';

export const makePublic: RequestHandler = (req, _res, next) => {
  req.isPublic = true;
  next();
};

export const authenticate: RequestHandler = (req, _res, next) => {
  if (req.isPublic) {
    next();
    return;
  }

  if (!env.API_SECRET_KEY) {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'];

  if (!apiKey || typeof apiKey !== 'string') {
    throw new UnauthorizedError();
  }

  const expected = Buffer.from(env.API_SECRET_KEY);
  const received = Buffer.from(apiKey);

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new ForbiddenError();
  }

  next();
};
