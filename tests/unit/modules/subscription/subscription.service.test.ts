import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { SubscriptionService } from '../../../../src/modules/subscription/subscription.service.js';
import type { GitHubClient } from '../../../../src/integrations/github/github.client.js';
import type { EmailClient } from '../../../../src/integrations/email/email.client.js';
import type { RepositoryService } from '../../../../src/modules/repository/repository.service.js';
import { ConflictError, NotFoundError } from '../../../../src/common/errors/app-error.js';

const testEmail = 'user@example.com';
const testOwner = 'octocat';
const testRepoName = 'hello-world';
const testRepo = `${testOwner}/${testRepoName}`;
const repoId = '550e8400-e29b-41d4-a716-446655440000';
const baseUrl = 'https://releases-api.app';

const repoRecord = {
  id: repoId,
  owner: testOwner,
  repo: testRepoName,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const mockSubscription = {
  findFirst: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

const prisma = { subscription: mockSubscription } as unknown as PrismaClient;

const github = {
  getRepo: vi.fn(),
} as unknown as GitHubClient;

const email = {
  send: vi.fn(),
} as unknown as EmailClient;

const repositoryService = {
  findOrCreateRepo: vi.fn(),
} as unknown as RepositoryService;

describe('SubscriptionService', () => {
  let service: SubscriptionService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new SubscriptionService(prisma, github, email, repositoryService, baseUrl);
  });

  describe('subscribe', () => {
    it('should create a subscription and send confirmation email', async () => {
      mockSubscription.findFirst.mockResolvedValue(null);
      (github.getRepo as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
      (repositoryService.findOrCreateRepo as ReturnType<typeof vi.fn>).mockResolvedValue(
        repoRecord,
      );
      mockSubscription.create.mockResolvedValue({});
      (email.send as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await service.subscribe(testEmail, testRepo);

      expect(mockSubscription.findFirst).toHaveBeenCalledWith({
        where: { email: testEmail, repository: { owner: testOwner, repo: testRepoName } },
      });

      expect(github.getRepo).toHaveBeenCalledWith(testOwner, testRepoName);

      expect(repositoryService.findOrCreateRepo).toHaveBeenCalledWith({
        owner: testOwner,
        repo: testRepoName,
      });

      expect(mockSubscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: testEmail,
          repositoryId: repoId,
          confirmationToken: expect.any(String),
          unsubscribeToken: expect.any(String),
        }),
      });

      expect(email.send).toHaveBeenCalledWith({
        to: testEmail,
        subject: `Confirm your subscription to ${testRepo}`,
        html: expect.stringContaining('/api/confirm/'),
      });
    });

    it('should throw 409 when email is already subscribed to the repo', async () => {
      mockSubscription.findFirst.mockResolvedValue({ id: 'existing-sub' });

      await expect(service.subscribe(testEmail, testRepo)).rejects.toThrow(ConflictError);
      await expect(service.subscribe(testEmail, testRepo)).rejects.toThrow(
        'Email already subscribed to this repository',
      );

      expect(github.getRepo).not.toHaveBeenCalled();
      expect(mockSubscription.create).not.toHaveBeenCalled();
    });

    it('should throw 404 when GitHub repo does not exist', async () => {
      mockSubscription.findFirst.mockResolvedValue(null);
      (github.getRepo as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.subscribe(testEmail, testRepo)).rejects.toThrow(NotFoundError);
      await expect(service.subscribe(testEmail, testRepo)).rejects.toThrow(
        'Repository not found on GitHub',
      );

      expect(repositoryService.findOrCreateRepo).not.toHaveBeenCalled();
      expect(mockSubscription.create).not.toHaveBeenCalled();
    });

    it('should throw 409 on unique constraint violation (race condition)', async () => {
      mockSubscription.findFirst.mockResolvedValue(null);
      (github.getRepo as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
      (repositoryService.findOrCreateRepo as ReturnType<typeof vi.fn>).mockResolvedValue(
        repoRecord,
      );

      const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.0.0',
      });
      mockSubscription.create.mockRejectedValue(p2002Error);

      await expect(service.subscribe(testEmail, testRepo)).rejects.toThrow(ConflictError);
      await expect(service.subscribe(testEmail, testRepo)).rejects.toThrow(
        'Email already subscribed to this repository',
      );
    });

    it('should propagate non-P2002 Prisma errors', async () => {
      mockSubscription.findFirst.mockResolvedValue(null);
      (github.getRepo as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
      (repositoryService.findOrCreateRepo as ReturnType<typeof vi.fn>).mockResolvedValue(
        repoRecord,
      );

      const dbError = new Error('DB connection lost');
      mockSubscription.create.mockRejectedValue(dbError);

      await expect(service.subscribe(testEmail, testRepo)).rejects.toThrow(dbError);
    });

    it('should build confirmation URLs using baseUrl', async () => {
      mockSubscription.findFirst.mockResolvedValue(null);
      (github.getRepo as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
      (repositoryService.findOrCreateRepo as ReturnType<typeof vi.fn>).mockResolvedValue(
        repoRecord,
      );
      mockSubscription.create.mockResolvedValue({});
      (email.send as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await service.subscribe(testEmail, testRepo);

      const sendCall = (email.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sendCall.html).toContain(`${baseUrl}/api/confirm/`);
      expect(sendCall.html).not.toContain('/api/unsubscribe/');
    });
  });

  describe('confirmSubscription', () => {
    const confirmationToken = '550e8400-e29b-41d4-a716-446655440001';

    it('should set confirmed to true', async () => {
      mockSubscription.update.mockResolvedValue({});

      await service.confirmSubscription(confirmationToken);

      expect(mockSubscription.update).toHaveBeenCalledWith({
        where: { confirmationToken },
        data: { confirmed: true },
      });
    });

    it('should throw NotFoundError when token not found', async () => {
      const p2025Error = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '6.0.0',
      });
      mockSubscription.update.mockRejectedValue(p2025Error);

      await expect(service.confirmSubscription(confirmationToken)).rejects.toThrow(NotFoundError);
      await expect(service.confirmSubscription(confirmationToken)).rejects.toThrow(
        'Token not found',
      );
    });

    it('should propagate non-P2025 errors', async () => {
      const dbError = new Error('DB connection lost');
      mockSubscription.update.mockRejectedValue(dbError);

      await expect(service.confirmSubscription(confirmationToken)).rejects.toThrow(dbError);
    });
  });

  describe('unsubscribe', () => {
    const unsubscribeToken = '550e8400-e29b-41d4-a716-446655440002';

    it('should delete subscription by unsubscribeToken', async () => {
      mockSubscription.delete.mockResolvedValue({});

      await service.unsubscribe(unsubscribeToken);

      expect(mockSubscription.delete).toHaveBeenCalledWith({
        where: { unsubscribeToken },
      });
    });

    it('should throw NotFoundError when token not found', async () => {
      const p2025Error = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '6.0.0',
      });
      mockSubscription.delete.mockRejectedValue(p2025Error);

      await expect(service.unsubscribe(unsubscribeToken)).rejects.toThrow(NotFoundError);
      await expect(service.unsubscribe(unsubscribeToken)).rejects.toThrow('Token not found');
    });

    it('should propagate non-P2025 errors', async () => {
      const dbError = new Error('DB connection lost');
      mockSubscription.delete.mockRejectedValue(dbError);

      await expect(service.unsubscribe(unsubscribeToken)).rejects.toThrow(dbError);
    });
  });

  describe('getSubscriptions', () => {
    it('should return confirmed subscriptions with lastSeenTag from subscription', async () => {
      mockSubscription.findMany.mockResolvedValue([
        {
          email: testEmail,
          confirmed: true,
          lastSeenTag: 'v1.0.0',
          repository: { owner: testOwner, repo: testRepoName },
        },
        {
          email: testEmail,
          confirmed: true,
          lastSeenTag: null,
          repository: { owner: 'facebook', repo: 'react' },
        },
      ]);

      const result = await service.getSubscriptions(testEmail);

      expect(mockSubscription.findMany).toHaveBeenCalledWith({
        where: { email: testEmail, confirmed: true },
        select: {
          email: true,
          confirmed: true,
          lastSeenTag: true,
          repository: { select: { owner: true, repo: true } },
        },
      });

      expect(result).toEqual([
        { email: testEmail, repo: `${testOwner}/${testRepoName}`, confirmed: true, last_seen_tag: 'v1.0.0' },
        { email: testEmail, repo: 'facebook/react', confirmed: true, last_seen_tag: null },
      ]);
    });

    it('should return empty array when no subscriptions exist', async () => {
      mockSubscription.findMany.mockResolvedValue([]);

      const result = await service.getSubscriptions(testEmail);

      expect(mockSubscription.findMany).toHaveBeenCalledWith({
        where: { email: testEmail, confirmed: true },
        select: {
          email: true,
          confirmed: true,
          lastSeenTag: true,
          repository: { select: { owner: true, repo: true } },
        },
      });

      expect(result).toEqual([]);
    });
  });

  describe('getSubscriptionsToNotify', () => {
    const subRecords = [
      { id: '660e8400-e29b-41d4-a716-446655440001', email: 'a@example.com', unsubscribeToken: 'token-a' },
      { id: '660e8400-e29b-41d4-a716-446655440002', email: 'b@example.com', unsubscribeToken: 'token-b' },
    ];

    it('should return a paginated response filtering out subscriptions already notified about the tag', async () => {
      mockSubscription.findMany.mockResolvedValue(subRecords);
      mockSubscription.count.mockResolvedValue(2);

      const result = await service.getSubscriptionsToNotify(repoId, 'v2.0.0', 1, 10);

      const expectedWhere = {
        repositoryId: repoId,
        confirmed: true,
        OR: [{ lastSeenTag: null }, { lastSeenTag: { not: 'v2.0.0' } }],
      };

      expect(mockSubscription.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        select: { id: true, email: true, unsubscribeToken: true },
        skip: 0,
        take: 10,
      });

      expect(mockSubscription.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });

      expect(result).toEqual({
        data: subRecords,
        total: 2,
        page: 1,
        pageSize: 10,
        hasMore: false,
      });
    });

    it('should indicate hasMore when more pages exist', async () => {
      mockSubscription.findMany.mockResolvedValue(subRecords);
      mockSubscription.count.mockResolvedValue(5);

      const result = await service.getSubscriptionsToNotify(repoId, 'v2.0.0', 1, 2);

      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(5);
    });

    it('should return empty data when no subscriptions exist', async () => {
      mockSubscription.findMany.mockResolvedValue([]);
      mockSubscription.count.mockResolvedValue(0);

      const result = await service.getSubscriptionsToNotify(repoId, 'v2.0.0', 1, 10);

      expect(result).toEqual({
        data: [],
        total: 0,
        page: 1,
        pageSize: 10,
        hasMore: false,
      });
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('DB connection lost');
      mockSubscription.findMany.mockRejectedValue(error);

      await expect(
        service.getSubscriptionsToNotify(repoId, 'v2.0.0', 1, 10),
      ).rejects.toThrow(error);
    });
  });

  describe('markSubscriptionNotified', () => {
    const subId = '550e8400-e29b-41d4-a716-446655440010';
    const tag = 'v3.0.0';

    it('should update lastSeenTag on the subscription', async () => {
      mockSubscription.update.mockResolvedValue({});

      await service.markSubscriptionNotified(subId, tag);

      expect(mockSubscription.update).toHaveBeenCalledWith({
        where: { id: subId },
        data: { lastSeenTag: tag },
      });
    });

    it('should return void on success', async () => {
      mockSubscription.update.mockResolvedValue({});

      const result = await service.markSubscriptionNotified(subId, tag);

      expect(result).toBeUndefined();
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('DB connection lost');
      mockSubscription.update.mockRejectedValue(error);

      await expect(service.markSubscriptionNotified(subId, tag)).rejects.toThrow(error);
    });
  });
});
