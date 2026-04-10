import { Router } from 'express';
import type { ISubscriptionController } from './subscription.controller.js';
import { validate } from '../../common/middleware/validate.js';
import { makePublic } from '../../common/middleware/auth.js';
import {
  subscribeRequestSchema,
  tokenParamsSchema,
  emailQuerySchema,
} from './subscription.schema.js';

export function createSubscriptionRouter(controller: ISubscriptionController): Router {
  const router = Router();

  router.post('/subscribe', validate({ body: subscribeRequestSchema }), (req, res) =>
    controller.subscribe(req, res),
  );

  router.get('/confirm/:token', makePublic, validate({ params: tokenParamsSchema }), (req, res) =>
    controller.confirmSubscription(req, res),
  );

  router.get(
    '/unsubscribe/:token',
    makePublic,
    validate({ params: tokenParamsSchema }),
    (req, res) => controller.unsubscribe(req, res),
  );

  router.get('/subscriptions', validate({ query: emailQuerySchema }), (req, res) =>
    controller.getSubscriptions(req, res),
  );

  return router;
}
