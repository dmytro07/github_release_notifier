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
  lastSeenTag: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const mockSubscription = {
  findFirst: vi.fn(),
  create: vi.fn(),
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

    it('should include unsubscribe link in confirmation email', async () => {
      mockSubscription.findFirst.mockResolvedValue(null);
      (github.getRepo as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
      (repositoryService.findOrCreateRepo as ReturnType<typeof vi.fn>).mockResolvedValue(
        repoRecord,
      );
      mockSubscription.create.mockResolvedValue({});
      (email.send as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await service.subscribe(testEmail, testRepo);

      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('/api/unsubscribe/'),
        }),
      );
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
      expect(sendCall.html).toContain(`${baseUrl}/api/unsubscribe/`);
    });
  });
});
