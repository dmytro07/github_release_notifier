import crypto from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { GitHubClient } from '../../integrations/github/github.client.js';
import type { EmailClient } from '../../integrations/email/email.client.js';
import type { RepositoryService } from '../repository/repository.service.js';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { getSubscriptionDtoSchema, type GetSubscriptionDto } from './subscription.schema.js';

export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly github: GitHubClient,
    private readonly email: EmailClient,
    private readonly repositoryService: RepositoryService,
    private readonly baseUrl: string,
  ) {}

  async subscribe(email: string, repo: string): Promise<void> {
    const [owner, repoName] = repo.split('/');

    const existing = await this.prisma.subscription.findFirst({
      where: { email, repository: { owner, repo: repoName } },
    });

    if (existing) {
      throw new ConflictError('Email already subscribed to this repository');
    }

    const ghRepo = await this.github.getRepo(owner, repoName);

    if (!ghRepo) {
      throw new NotFoundError('Repository not found on GitHub');
    }

    const repoRecord = await this.repositoryService.findOrCreateRepo({
      owner,
      repo: repoName,
    });

    const confirmationToken = crypto.randomUUID();
    const unsubscribeToken = crypto.randomUUID();

    try {
      await this.prisma.subscription.create({
        data: {
          email,
          confirmationToken,
          unsubscribeToken,
          repositoryId: repoRecord.id,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictError('Email already subscribed to this repository');
      }
      throw err;
    }

    await this.sendConfirmationEmail(
      email,
      repo,
      confirmationToken,
      unsubscribeToken,
    );
  }

  private async sendConfirmationEmail(
    email: string,
    repo: string,
    confirmationToken: string,
    unsubscribeToken: string,
  ): Promise<void> {
    const confirmUrl = `${this.baseUrl}/api/confirm/${confirmationToken}`;
    const unsubscribeUrl = `${this.baseUrl}/api/unsubscribe/${unsubscribeToken}`;

    await this.email.send({
      to: email,
      subject: `Confirm your subscription to ${repo}`,
      html: `<p>Please confirm your subscription to <b>${repo}</b> releases.</p>
             <p><a href="${confirmUrl}">Confirm subscription</a></p>
             <p><a href="${unsubscribeUrl}">Unsubscribe</a></p>`,
    });
  }

  async confirmSubscription(token: string): Promise<void> {
    try {
      await this.prisma.subscription.update({
        where: { confirmationToken: token },
        data: { confirmed: true },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundError('Token not found');
      }
      throw err;
    }
  }

  async unsubscribe(token: string): Promise<void> {
    try {
      await this.prisma.subscription.delete({
        where: { unsubscribeToken: token },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundError('Token not found');
      }
      throw err;
    }
  }

  async getSubscriptions(email: string): Promise<GetSubscriptionDto[]> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { email, confirmed: true },
      select: {
        email: true,
        confirmed: true,
        repository: { select: { owner: true, repo: true, lastSeenTag: true } },
      },
    });

    return subscriptions.map((s) => getSubscriptionDtoSchema.parse(s));
  }
}
