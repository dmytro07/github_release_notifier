import crypto from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { IGitHubClient } from '../../integrations/github/github.client.js';
import type { IEmailClient } from '../../integrations/email/email.client.js';
import type { IRepositoryService } from '../repository/repository.service.js';
import type { PaginatedResponse } from '../../common/types/paginated-response.js';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import {
  getSubscriptionResponseDtoSchema,
  subscriptionNotificationDtoSchema,
  type GetSubscriptionResponseDto,
  type SubscriptionNotificationDto,
} from './subscription.schema.js';

export interface ISubscriptionService {
  subscribe(email: string, repo: string): Promise<void>;
  confirmSubscription(token: string): Promise<void>;
  unsubscribe(token: string): Promise<void>;
  getSubscriptions(email: string): Promise<GetSubscriptionResponseDto[]>;
  getSubscriptionsByRepositoryId(
    repositoryId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<SubscriptionNotificationDto>>;
}

export class SubscriptionService implements ISubscriptionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly github: IGitHubClient,
    private readonly email: IEmailClient,
    private readonly repositoryService: IRepositoryService,
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
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('Email already subscribed to this repository');
      }
      throw err;
    }

    await this.sendConfirmationEmail(email, repo, confirmationToken);
  }

  private async sendConfirmationEmail(
    email: string,
    repo: string,
    confirmationToken: string,
  ): Promise<void> {
    const confirmUrl = `${this.baseUrl}/api/confirm/${confirmationToken}`;

    await this.email.send({
      to: email,
      subject: `Confirm your subscription to ${repo}`,
      html: `<p>Please confirm your subscription to <b>${repo}</b> releases.</p>
             <p><a href="${confirmUrl}">Confirm subscription</a></p>`,
    });
  }

  async confirmSubscription(token: string): Promise<void> {
    try {
      await this.prisma.subscription.update({
        where: { confirmationToken: token },
        data: { confirmed: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
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
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundError('Token not found');
      }
      throw err;
    }
  }

  async getSubscriptions(email: string): Promise<GetSubscriptionResponseDto[]> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { email, confirmed: true },
      select: {
        email: true,
        confirmed: true,
        repository: { select: { owner: true, repo: true, lastSeenTag: true } },
      },
    });

    return subscriptions.map((s) => getSubscriptionResponseDtoSchema.parse(s));
  }

  async getSubscriptionsByRepositoryId(
    repositoryId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<SubscriptionNotificationDto>> {
    const where = { repositoryId, confirmed: true };
    const [records, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        select: { email: true, unsubscribeToken: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.subscription.count({ where }),
    ]);

    return {
      data: records.map((r) => subscriptionNotificationDtoSchema.parse(r)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }
}
