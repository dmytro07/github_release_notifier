import type { PrismaClient } from '@prisma/client';
import type { GitHubClient } from '../../integrations/github/github.client.js';
import type { EmailClient } from '../../integrations/email/email.client.js';

export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly github: GitHubClient,
    private readonly email: EmailClient,
  ) {}

  async subscribe(_email: string, _repo: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async confirmSubscription(_token: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async unsubscribe(_token: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async getSubscriptions(
    _email: string,
  ): Promise<{ email: string; repo: string; confirmed: boolean; lastSeenTag: string | null }[]> {
    throw new Error('Not implemented');
  }
}
