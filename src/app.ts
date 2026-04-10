import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import yaml from 'js-yaml';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import type { ISubscriptionController } from './modules/subscription/subscription.controller.js';
import { createSubscriptionRouter } from './modules/subscription/index.js';
import { notFound } from './common/middleware/not-found.js';
import { errorHandler } from './common/middleware/error-handler.js';

const swaggerDoc = yaml.load(
  readFileSync(join(process.cwd(), 'swagger.yaml'), 'utf8'),
) as Record<string, unknown>;

export function createApp(controller: ISubscriptionController): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerDoc));

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN ?? '*' }));
  app.use(express.json({ limit: '100kb' }));

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests, please try again later' },
    }),
  );

  app.use(pinoHttp({ logger }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', createSubscriptionRouter(controller));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
