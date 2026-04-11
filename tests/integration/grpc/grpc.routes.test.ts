import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import type { PrismaClient } from '@prisma/client';

vi.mock('../../../src/config/env.js', () => ({
  env: { NODE_ENV: 'test', CORS_ORIGIN: '*' },
}));

import { SubscriptionService } from '../../../src/modules/subscription/subscription.service.js';
import { RepositoryService } from '../../../src/modules/repository/repository.service.js';
import type { GitHubClient } from '../../../src/integrations/github/github.client.js';
import type { EmailClient } from '../../../src/integrations/email/email.client.js';
import { createGrpcServer, createReleaseNotifierHandler } from '../../../src/grpc/index.js';
import {
  ConfirmResponse,
  GetSubscriptionsResponse,
  HealthResponse,
  ReleaseNotifierServiceClient,
  SubscribeResponse,
  UnsubscribeResponse,
} from '../../../src/generated/release_notifier/v1/release_notifier.js';
import { GitHubRateLimitError } from '../../../src/common/errors/app-error.js';
import { getPrisma, disconnectPrisma } from '../../helpers/setup.js';
import { truncateAllTables } from '../../helpers/cleanup.js';

const baseUrl = 'https://releases-api.app';
const testEmail = 'grpc-user@example.com';
const testOwner = 'octocat';
const testRepoName = 'hello-world';
const testRepo = `${testOwner}/${testRepoName}`;

let client: ReleaseNotifierServiceClient;
let prisma: PrismaClient;
let github: { getRepo: ReturnType<typeof vi.fn>; getLatestRelease: ReturnType<typeof vi.fn> };
let emailClient: { send: ReturnType<typeof vi.fn> };

function callAsync<Req, Res>(
  method: (req: Req, cb: (err: grpc.ServiceError | null, res: Res) => void) => grpc.ClientUnaryCall,
  request: Req,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    method.call(client, request, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

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

describe('gRPC Routes (integration)', () => {
  beforeAll(async () => {
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

    const handler = createReleaseNotifierHandler(subscriptionService);
    const server = createGrpcServer(handler, undefined);

    await new Promise<void>((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => {
        if (err) {
          reject(err);
          return;
        }
        client = new ReleaseNotifierServiceClient(
          `127.0.0.1:${port}`,
          grpc.credentials.createInsecure(),
        );
        resolve();
      });
    });
  });

  afterAll(async () => {
    client?.close();
    await disconnectPrisma();
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    await truncateAllTables(prisma);
  });

  describe('Health', () => {
    it('returns status ok', async () => {
      const res = (await callAsync(client.health.bind(client), {})) as HealthResponse;
      expect(res.status).toBe('ok');
    });
  });

  describe('Subscribe', () => {
    it('creates a subscription and sends confirmation email', async () => {
      github.getRepo.mockResolvedValue({ id: 1 });
      emailClient.send.mockResolvedValue(undefined);

      const res = (await callAsync(client.subscribe.bind(client), {
        email: testEmail,
        repo: testRepo,
      })) as SubscribeResponse;

      expect(res.message).toBeTruthy();
      expect(emailClient.send).toHaveBeenCalledOnce();

      const sub = await prisma.subscription.findFirst({
        where: { email: testEmail },
        include: { repository: true },
      });
      expect(sub).not.toBeNull();
      expect(sub!.repository.owner).toBe(testOwner);
      expect(sub!.confirmed).toBe(false);
    });

    it('returns ALREADY_EXISTS for duplicate subscription', async () => {
      github.getRepo.mockResolvedValue({ id: 1 });
      emailClient.send.mockResolvedValue(undefined);

      await callAsync(client.subscribe.bind(client), { email: testEmail, repo: testRepo });

      await expect(
        callAsync(client.subscribe.bind(client), { email: testEmail, repo: testRepo }),
      ).rejects.toMatchObject({ code: grpc.status.ALREADY_EXISTS });
    });

    it('returns NOT_FOUND when repo does not exist on GitHub', async () => {
      github.getRepo.mockResolvedValue(null);

      await expect(
        callAsync(client.subscribe.bind(client), { email: testEmail, repo: testRepo }),
      ).rejects.toMatchObject({ code: grpc.status.NOT_FOUND });
    });

    it('returns INVALID_ARGUMENT for bad email', async () => {
      await expect(
        callAsync(client.subscribe.bind(client), { email: 'bad', repo: testRepo }),
      ).rejects.toMatchObject({ code: grpc.status.INVALID_ARGUMENT });
    });

    it('returns UNAVAILABLE when GitHub rate limit is hit', async () => {
      github.getRepo.mockRejectedValue(new GitHubRateLimitError(60_000));
      const err = await callAsync(client.subscribe.bind(client), {
        email: testEmail,
        repo: testRepo,
      }).catch((e: grpc.ServiceError) => e);
      expect((err as grpc.ServiceError).code).toBe(grpc.status.UNAVAILABLE);
    });
  });

  describe('ConfirmSubscription', () => {
    it('confirms a pending subscription', async () => {
      const { confirmationToken } = await seedSubscription({ confirmed: false });

      const res = (await callAsync(client.confirmSubscription.bind(client), {
        token: confirmationToken,
      })) as ConfirmResponse;
      expect(res.message).toBeTruthy();

      const sub = await prisma.subscription.findFirst({ where: { confirmationToken } });
      expect(sub!.confirmed).toBe(true);
    });

    it('returns NOT_FOUND for unknown token', async () => {
      await expect(
        callAsync(client.confirmSubscription.bind(client), { token: crypto.randomUUID() }),
      ).rejects.toMatchObject({ code: grpc.status.NOT_FOUND });
    });

    it('returns INVALID_ARGUMENT for non-UUID token', async () => {
      await expect(
        callAsync(client.confirmSubscription.bind(client), { token: 'not-a-uuid' }),
      ).rejects.toMatchObject({ code: grpc.status.INVALID_ARGUMENT });
    });
  });

  describe('Unsubscribe', () => {
    it('removes an existing subscription', async () => {
      const { unsubscribeToken, subscription } = await seedSubscription({ confirmed: true });

      const res = (await callAsync(client.unsubscribe.bind(client), {
        token: unsubscribeToken,
      })) as UnsubscribeResponse;
      expect(res.message).toBeTruthy();

      const sub = await prisma.subscription.findUnique({ where: { id: subscription.id } });
      expect(sub).toBeNull();
    });

    it('returns NOT_FOUND for unknown unsubscribe token', async () => {
      await expect(
        callAsync(client.unsubscribe.bind(client), { token: crypto.randomUUID() }),
      ).rejects.toMatchObject({ code: grpc.status.NOT_FOUND });
    });
  });

  describe('GetSubscriptions', () => {
    it('returns subscriptions for a given email', async () => {
      await seedSubscription({ confirmed: true });

      const res = (await callAsync(client.getSubscriptions.bind(client), {
        email: testEmail,
      })) as GetSubscriptionsResponse;

      expect(res.subscriptions).toHaveLength(1);
      expect(res.subscriptions[0].email).toBe(testEmail);
      expect(res.subscriptions[0].repo).toBe(testRepo);
      expect(res.subscriptions[0].confirmed).toBe(true);
    });

    it('returns empty list for email with no subscriptions', async () => {
      const res = (await callAsync(client.getSubscriptions.bind(client), {
        email: 'nobody@example.com',
      })) as GetSubscriptionsResponse;
      expect(res.subscriptions).toHaveLength(0);
    });

    it('returns INVALID_ARGUMENT for invalid email', async () => {
      await expect(
        callAsync(client.getSubscriptions.bind(client), { email: 'not-an-email' }),
      ).rejects.toMatchObject({ code: grpc.status.INVALID_ARGUMENT });
    });
  });
});
