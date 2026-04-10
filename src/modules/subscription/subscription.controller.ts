import type { Request, Response } from 'express';
import type { SubscriptionService } from './subscription.service.js';
import type { SubscribeRequest, TokenParams } from './subscription.schema.js';

export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  async subscribe(req: Request, res: Response): Promise<void> {
    const { email, repo } = req.body as SubscribeRequest;
    await this.service.subscribe(email, repo);
    res.sendStatus(200);
  }

  async confirmSubscription(req: Request, res: Response): Promise<void> {
    const { token } = req.params as TokenParams;
    await this.service.confirmSubscription(token);
    res.sendStatus(200);
  }

  async unsubscribe(_req: Request, res: Response): Promise<void> {
    res.sendStatus(501);
  }

  async getSubscriptions(_req: Request, res: Response): Promise<void> {
    res.sendStatus(501);
  }
}
