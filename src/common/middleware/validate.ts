import type { RequestHandler, Request } from 'express';
import type { z } from 'zod/v4';
import { BadRequestError } from '../errors/app-error.js';

interface ValidationSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res, next) => {
    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        throw new BadRequestError(result.error.issues[0]?.message ?? 'Invalid path parameters');
      }
      Object.assign(req.params, result.data);
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        throw new BadRequestError(result.error.issues[0]?.message ?? 'Invalid query parameters');
      }
      Object.assign(req.query, result.data);
    }

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        throw new BadRequestError(result.error.issues[0]?.message ?? 'Invalid request body');
      }
      req.body = result.data;
    }

    next();
  };
}
