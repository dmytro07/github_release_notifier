import type { Request, Response } from 'express';
import type { SubscriptionService } from './subscription.service.js';

export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  async subscribe(_req: Request, res: Response): Promise<void> {
    res.sendStatus(501);
  }

  async confirmSubscription(_req: Request, res: Response): Promise<void> {
    res.sendStatus(501);
  }

  async unsubscribe(_req: Request, res: Response): Promise<void> {
    res.sendStatus(501);
  }

  async getSubscriptions(_req: Request, res: Response): Promise<void> {
    res.sendStatus(501);
  }
}
