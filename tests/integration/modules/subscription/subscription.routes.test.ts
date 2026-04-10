import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { Express } from 'express';

vi.mock('../../../../src/config/env.js', () => ({
  env: { NODE_ENV: 'test', CORS_ORIGIN: '*' },
}));

import { createApp } from '../../../../src/app.js';
import { SubscriptionController } from '../../../../src/modules/subscription/subscription.controller.js';
import { SubscriptionService } from '../../../../src/modules/subscription/subscription.service.js';
import { RepositoryService } from '../../../../src/modules/repository/repository.service.js';
import type { GitHubClient } from '../../../../src/integrations/github/github.client.js';
import type { EmailClient } from '../../../../src/integrations/email/email.client.js';
import { GitHubRateLimitError } from '../../../../src/common/errors/app-error.js';
import { getPrisma, disconnectPrisma } from '../../../helpers/setup.js';
import { truncateAllTables } from '../../../helpers/cleanup.js';

const baseUrl = 'https://releases-api.app';
const testEmail = 'user@example.com';
const testOwner = 'octocat';
const testRepoName = 'hello-world';
const testRepo = `${testOwner}/${testRepoName}`;

let app: Express;
let prisma: PrismaClient;
let github: { getRepo: ReturnType<typeof vi.fn>; getLatestRelease: ReturnType<typeof vi.fn> };
let emailClient: { send: ReturnType<typeof vi.fn> };

async function seedSubscription(
  opts: {
    email?: string;
    owner?: string;
    repo?: string;
    confirmed?: boolean;
  } = {},
) {
  const repository = await prisma.repository.upsert({
    where: { owner_repo: { owner: opts.owner ?? testOwner, repo: opts.repo ?? testRepoName } },
    update: {},
    create: { owner: opts.owner ?? testOwner, repo: opts.repo ?? testRepoName },
  });

  const confirmationToken = crypto.randomUUID();
  const unsubscribeToken = crypto.randomUUID();

  const subscription = await prisma.subscription.create({
    data: {
      email: opts.email ?? testEmail,
      confirmed: opts.confirmed ?? false,
      confirmationToken,
      unsubscribeToken,
      repositoryId: repository.id,
    },
  });

  return { repository, subscription, confirmationToken, unsubscribeToken };
}

describe('Subscription Routes (integration)', () => {
  beforeAll(() => {
    prisma = getPrisma();

    github = { getRepo: vi.fn(), getLatestRelease: vi.fn() };
    emailClient = { send: vi.fn() };

    const repositoryService = new RepositoryService(prisma);
    const subscriptionService = new SubscriptionService(
      prisma,
      github as unknown as GitHubClient,
      emailClient as unknown as EmailClient,
      repositoryService,
      baseUrl,
    );
    const controller = new SubscriptionController(subscriptionService);
    app = createApp(controller);
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    github.getRepo.mockReset();
    emailClient.send.mockReset();
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  describe('POST /api/subscribe', () => {
    it('should create subscription and send confirmation email', async () => {
      github.getRepo.mockResolvedValue({ id: 1, full_name: testRepo });
      emailClient.send.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/subscribe')
        .send({ email: testEmail, repo: testRepo });

      expect(res.status).toBe(200);

      expect(emailClient.send).toHaveBeenCalledOnce();
      expect(emailClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: testEmail,
          subject: expect.stringContaining(testRepo),
          html: expect.stringContaining(`${baseUrl}/api/confirm/`),
        }),
      );

      const sub = await prisma.subscription.findFirst({
        where: { email: testEmail },
        include: { repository: true },
      });
      expect(sub).not.toBeNull();
      expect(sub!.repository.owner).toBe(testOwner);
      expect(sub!.repository.repo).toBe(testRepoName);
      expect(sub!.confirmed).toBe(false);
    });

    it('should return 400 for invalid input', async () => {
      const res = await request(app)
        .post('/api/subscribe')
        .send({ email: 'not-an-email', repo: testRepo });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should return 409 for duplicate subscription', async () => {
      await seedSubscription();
      github.getRepo.mockResolvedValue({ id: 1 });

      const res = await request(app)
        .post('/api/subscribe')
        .send({ email: testEmail, repo: testRepo });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already subscribed/i);
    });

    it('should return 404 when GitHub repo not found', async () => {
      github.getRepo.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/subscribe')
        .send({ email: testEmail, repo: testRepo });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('should return 503 with Retry-After when GitHub rate-limited', async () => {
      github.getRepo.mockRejectedValue(new GitHubRateLimitError(120_000));

      const res = await request(app)
        .post('/api/subscribe')
        .send({ email: testEmail, repo: testRepo });

      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBe('120');
      expect(res.body.error).toBe('Service temporarily unavailable, please try again later');
    });
  });

  describe('GET /api/confirm/:token', () => {
    it('should confirm subscription', async () => {
      const { confirmationToken } = await seedSubscription();

      const res = await request(app).get(`/api/confirm/${confirmationToken}`);

      expect(res.status).toBe(200);

      const sub = await prisma.subscription.findUnique({
        where: { confirmationToken },
      });
      expect(sub!.confirmed).toBe(true);
    });

    it('should return 404 for unknown token', async () => {
      const res = await request(app).get(`/api/confirm/${crypto.randomUUID()}`);

      expect(res.status).toBe(404);
    });

    it('should return 400 for non-UUID token', async () => {
      const res = await request(app).get('/api/confirm/not-a-uuid');

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/unsubscribe/:token', () => {
    it('should remove subscription', async () => {
      const { unsubscribeToken, subscription } = await seedSubscription({ confirmed: true });

      const res = await request(app).get(`/api/unsubscribe/${unsubscribeToken}`);

      expect(res.status).toBe(200);

      const deleted = await prisma.subscription.findUnique({
        where: { id: subscription.id },
      });
      expect(deleted).toBeNull();
    });
  });

  describe('GET /api/subscriptions', () => {
    it('should return confirmed subscriptions for email', async () => {
      await seedSubscription({ confirmed: true, owner: 'octocat', repo: 'hello-world' });
      await seedSubscription({ confirmed: true, owner: 'facebook', repo: 'react' });
      await seedSubscription({ confirmed: false, owner: 'google', repo: 'angular' });

      const res = await request(app).get('/api/subscriptions').query({ email: testEmail });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            email: testEmail,
            repo: 'octocat/hello-world',
            confirmed: true,
            last_seen_tag: null,
          }),
          expect.objectContaining({
            email: testEmail,
            repo: 'facebook/react',
            confirmed: true,
            last_seen_tag: null,
          }),
        ]),
      );
    });

    it('should return 400 for invalid email', async () => {
      const res = await request(app).get('/api/subscriptions').query({ email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/health', () => {
    it('should return 200 with status ok', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });
});
