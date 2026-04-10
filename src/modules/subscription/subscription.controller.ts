import type { Request, Response } from 'express';
import type { ISubscriptionService } from './subscription.service.js';
import type { SubscribeRequest, TokenParams, EmailQuery } from './subscription.schema.js';

export interface ISubscriptionController {
  subscribe(req: Request, res: Response): Promise<void>;
  confirmSubscription(req: Request, res: Response): Promise<void>;
  unsubscribe(req: Request, res: Response): Promise<void>;
  getSubscriptions(req: Request, res: Response): Promise<void>;
}

export class SubscriptionController implements ISubscriptionController {
  constructor(private readonly service: ISubscriptionService) {}

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

  async unsubscribe(req: Request, res: Response): Promise<void> {
    const { token } = req.params as TokenParams;
    await this.service.unsubscribe(token);
    res.sendStatus(200);
  }

  async getSubscriptions(req: Request, res: Response): Promise<void> {
    const { email } = req.query as EmailQuery;
    const subscriptions = await this.service.getSubscriptions(email);
    res.json(subscriptions);
  }
}
