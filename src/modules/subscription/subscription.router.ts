import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { ISubscriptionController } from './subscription.controller.js';
import { validate } from '../../common/middleware/validate.js';
import {
  subscribeRequestSchema,
  tokenParamsSchema,
  emailQuerySchema,
} from './subscription.schema.js';

const subscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many subscription requests, please try again later' },
});

export function createSubscriptionRouter(controller: ISubscriptionController): Router {
  const router = Router();

  router.post(
    '/subscribe',
    subscribeLimiter,
    validate({ body: subscribeRequestSchema }),
    (req, res) => controller.subscribe(req, res),
  );

  router.get('/confirm/:token', validate({ params: tokenParamsSchema }), (req, res) =>
    controller.confirmSubscription(req, res),
  );

  router.get('/unsubscribe/:token', validate({ params: tokenParamsSchema }), (req, res) =>
    controller.unsubscribe(req, res),
  );

  router.get('/subscriptions', validate({ query: emailQuerySchema }), (req, res) =>
    controller.getSubscriptions(req, res),
  );

  return router;
}
