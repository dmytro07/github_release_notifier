import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScannerJob } from '../../../src/jobs/scanner.job.js';
import type { IRepositoryService } from '../../../src/modules/repository/repository.service.js';
import type { IGitHubClient } from '../../../src/integrations/github/github.client.js';
import type { ISubscriptionService } from '../../../src/modules/subscription/subscription.service.js';
import type { IEmailClient } from '../../../src/integrations/email/email.client.js';
import type { GetRepoDto } from '../../../src/modules/repository/repository.schema.js';
import type { PaginatedResponse } from '../../../src/common/types/paginated-response.js';
import { GitHubRateLimitError } from '../../../src/common/errors/app-error.js';

vi.mock('../../../src/config/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const intervalMs = 60_000;
const baseUrl = 'https://releases-api.app';

function makeRepo(overrides: Partial<GetRepoDto> = {}): GetRepoDto {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    owner: 'octocat',
    repo: 'hello-world',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function paginated<T>(data: T[], hasMore: boolean, page = 1, pageSize = 50): PaginatedResponse<T> {
  return { data, total: data.length, page, pageSize, hasMore };
}

const repositoryService: IRepositoryService = {
  findOrCreateRepo: vi.fn(),
  getReposThatHaveActiveSubscriptions: vi.fn(),
};

const github: IGitHubClient = {
  getLatestRelease: vi.fn(),
  getRepo: vi.fn(),
};

const subscriptionService: ISubscriptionService = {
  getSubscriptionsToNotify: vi.fn(),
  markSubscriptionNotified: vi.fn(),
  getSubscriptions: vi.fn(),
  subscribe: vi.fn(),
  confirmSubscription: vi.fn(),
  unsubscribe: vi.fn(),
};

const email: IEmailClient = {
  send: vi.fn(),
};

async function triggerRun(): Promise<void> {
  await vi.advanceTimersByTimeAsync(intervalMs);
}

describe('ScannerJob', () => {
  let job: ScannerJob;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    job = new ScannerJob(
      repositoryService,
      github,
      subscriptionService,
      email,
      intervalMs,
      baseUrl,
    );
  });

  afterEach(() => {
    job.stop();
    vi.useRealTimers();
  });

  describe('run -- core scanning loop', () => {
    it('should process all repos across multiple pages', async () => {
      const repoA = makeRepo();
      const repoB = makeRepo({ id: 'id-b', owner: 'nodejs', repo: 'node' });

      (repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(paginated([repoA], true))
        .mockResolvedValueOnce(paginated([repoB], false, 2));

      (github.getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      job.start();
      await triggerRun();

      expect(github.getLatestRelease).toHaveBeenCalledWith('octocat', 'hello-world');
      expect(github.getLatestRelease).toHaveBeenCalledWith('nodejs', 'node');
      expect(github.getLatestRelease).toHaveBeenCalledTimes(2);
    });

    it('should send notification emails for a new release and mark subscriptions notified', async () => {
      const repo = makeRepo();

      (
        repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(paginated([repo], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tag_name: 'v2.0.0',
      });

      const sub = { id: 'sub-id-1', email: 'user@example.com', unsubscribeToken: 'tok-1' };
      (
        subscriptionService.getSubscriptionsToNotify as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(paginated([sub], false));

      (email.send as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (subscriptionService.markSubscriptionNotified as ReturnType<typeof vi.fn>).mockResolvedValue(
        undefined,
      );

      job.start();
      await triggerRun();

      expect(subscriptionService.getSubscriptionsToNotify).toHaveBeenCalledWith(
        repo.id,
        'v2.0.0',
        1,
        50,
      );

      expect(email.send).toHaveBeenCalledWith({
        to: 'user@example.com',
        subject: 'New release: octocat/hello-world v2.0.0',
        html: expect.stringContaining('v2.0.0'),
      });
      expect((email.send as ReturnType<typeof vi.fn>).mock.calls[0][0].html).toContain(
        `${baseUrl}/api/unsubscribe/tok-1`,
      );

      expect(subscriptionService.markSubscriptionNotified).toHaveBeenCalledWith(
        'sub-id-1',
        'v2.0.0',
      );
    });

    it('should paginate subscribers and mark each notified', async () => {
      const repo = makeRepo();

      (
        repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(paginated([repo], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tag_name: 'v2.0.0',
      });

      const subA = { id: 'sub-id-a', email: 'a@example.com', unsubscribeToken: 'tok-a' };
      const subB = { id: 'sub-id-b', email: 'b@example.com', unsubscribeToken: 'tok-b' };

      (subscriptionService.getSubscriptionsToNotify as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(paginated([subA], true))
        .mockResolvedValueOnce(paginated([subB], false, 2));

      (email.send as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (subscriptionService.markSubscriptionNotified as ReturnType<typeof vi.fn>).mockResolvedValue(
        undefined,
      );

      job.start();
      await triggerRun();

      expect(email.send).toHaveBeenCalledTimes(2);
      expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@example.com' }));
      expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'b@example.com' }));
      expect(subscriptionService.markSubscriptionNotified).toHaveBeenCalledWith(
        'sub-id-a',
        'v2.0.0',
      );
      expect(subscriptionService.markSubscriptionNotified).toHaveBeenCalledWith(
        'sub-id-b',
        'v2.0.0',
      );
    });

    it('should skip repo when no release exists', async () => {
      const repo = makeRepo();

      (
        repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(paginated([repo], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      job.start();
      await triggerRun();

      expect(subscriptionService.getSubscriptionsToNotify).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
      expect(subscriptionService.markSubscriptionNotified).not.toHaveBeenCalled();
    });

    it('should not send emails when all subscriptions are already up to date', async () => {
      const repo = makeRepo();

      (
        repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(paginated([repo], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tag_name: 'v1.0.0',
      });

      (
        subscriptionService.getSubscriptionsToNotify as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(paginated([], false));

      job.start();
      await triggerRun();

      expect(email.send).not.toHaveBeenCalled();
      expect(subscriptionService.markSubscriptionNotified).not.toHaveBeenCalled();
    });

    it('should retry un-notified subscriptions on next run after crash recovery', async () => {
      const repo = makeRepo();

      (
        repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>
      ).mockResolvedValue(paginated([repo], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValue({
        tag_name: 'v2.0.0',
      });

      const sub = { id: 'sub-id-1', email: 'user@example.com', unsubscribeToken: 'tok-1' };

      // First run: one subscription returns (not yet notified), email fails
      (subscriptionService.getSubscriptionsToNotify as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(paginated([sub], false))
        // Second run: same subscription still un-notified (crash recovery)
        .mockResolvedValueOnce(paginated([sub], false));

      (email.send as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('SMTP down'))
        .mockResolvedValueOnce(undefined);

      (subscriptionService.markSubscriptionNotified as ReturnType<typeof vi.fn>).mockResolvedValue(
        undefined,
      );

      job.start();
      await triggerRun();

      // First run: email failed, markSubscriptionNotified not called
      expect(subscriptionService.markSubscriptionNotified).not.toHaveBeenCalled();

      // Second run: subscription is retried and succeeds
      await triggerRun();

      expect(email.send).toHaveBeenCalledTimes(2);
      expect(subscriptionService.markSubscriptionNotified).toHaveBeenCalledOnce();
      expect(subscriptionService.markSubscriptionNotified).toHaveBeenCalledWith(
        'sub-id-1',
        'v2.0.0',
      );
    });

    it('should not call markSubscriptionNotified when email fails', async () => {
      const repo = makeRepo();

      (
        repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(paginated([repo], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tag_name: 'v2.0.0',
      });

      const sub = { id: 'sub-id-1', email: 'user@example.com', unsubscribeToken: 'tok-1' };
      (
        subscriptionService.getSubscriptionsToNotify as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(paginated([sub], false));

      (email.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('SMTP down'));

      job.start();
      await triggerRun();

      expect(email.send).toHaveBeenCalledOnce();
      expect(subscriptionService.markSubscriptionNotified).not.toHaveBeenCalled();
    });

    it('should continue processing other repos if one fails', async () => {
      const repoA = makeRepo();
      const repoB = makeRepo({ id: 'id-b', owner: 'nodejs', repo: 'node' });

      (
        repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(paginated([repoA, repoB], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('GitHub API error'))
        .mockResolvedValueOnce({ tag_name: 'v22.0.0' });

      const sub = { id: 'sub-id-1', email: 'user@example.com', unsubscribeToken: 'tok-1' };
      (
        subscriptionService.getSubscriptionsToNotify as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(paginated([sub], false));

      (email.send as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (subscriptionService.markSubscriptionNotified as ReturnType<typeof vi.fn>).mockResolvedValue(
        undefined,
      );

      job.start();
      await triggerRun();

      expect(email.send).toHaveBeenCalledTimes(1);
      expect(subscriptionService.markSubscriptionNotified).toHaveBeenCalledWith(
        'sub-id-1',
        'v22.0.0',
      );
    });

    it('should continue sending emails if one fails', async () => {
      const repo = makeRepo();

      (
        repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(paginated([repo], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tag_name: 'v2.0.0',
      });

      const subA = { id: 'sub-id-a', email: 'a@example.com', unsubscribeToken: 'tok-a' };
      const subB = { id: 'sub-id-b', email: 'b@example.com', unsubscribeToken: 'tok-b' };

      (
        subscriptionService.getSubscriptionsToNotify as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(paginated([subA, subB], false));

      (email.send as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('SMTP down'))
        .mockResolvedValueOnce(undefined);
      (subscriptionService.markSubscriptionNotified as ReturnType<typeof vi.fn>).mockResolvedValue(
        undefined,
      );

      job.start();
      await triggerRun();

      expect(email.send).toHaveBeenCalledTimes(2);
      expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'b@example.com' }));
      // Only the successful send should mark as notified
      expect(subscriptionService.markSubscriptionNotified).toHaveBeenCalledOnce();
      expect(subscriptionService.markSubscriptionNotified).toHaveBeenCalledWith(
        'sub-id-b',
        'v2.0.0',
      );
    });

    it('should re-schedule after a top-level error', async () => {
      (repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('DB connection lost'))
        .mockResolvedValueOnce(paginated([], false));

      job.start();
      await triggerRun();

      // A second tick should still fire because scheduleNext ran in the finally block
      await triggerRun();

      expect(repositoryService.getReposThatHaveActiveSubscriptions).toHaveBeenCalledTimes(2);
    });
  });

  describe('run -- rate limit handling', () => {
    it('should pause and exit scan cycle when rate limit is hit', async () => {
      const repoA = makeRepo();
      const repoB = makeRepo({ id: 'id-b', owner: 'nodejs', repo: 'node' });

      (
        repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(paginated([repoA, repoB], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new GitHubRateLimitError(5_000),
      );

      job.start();
      await triggerRun();

      expect(github.getLatestRelease).toHaveBeenCalledTimes(1);
      expect(github.getLatestRelease).toHaveBeenCalledWith('octocat', 'hello-world');

      const { logger } = await import('../../../src/config/logger.js');
      expect(logger.warn).toHaveBeenCalledWith(
        { retryAfterMs: 5_000 },
        'GitHub rate limit hit, pausing scanner',
      );
    });

    it('should re-schedule after rate-limit pause completes', async () => {
      const repo = makeRepo();

      (repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(paginated([repo], false))
        .mockResolvedValueOnce(paginated([], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new GitHubRateLimitError(5_000))
        .mockResolvedValueOnce(null);

      job.start();

      await triggerRun();

      await vi.advanceTimersByTimeAsync(5_000);

      await vi.advanceTimersByTimeAsync(intervalMs);

      expect(repositoryService.getReposThatHaveActiveSubscriptions).toHaveBeenCalledTimes(2);
    });

    it('should not send emails for the rate-limited repo', async () => {
      const repo = makeRepo();

      (
        repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(paginated([repo], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new GitHubRateLimitError(5_000),
      );

      job.start();
      await triggerRun();

      expect(email.send).not.toHaveBeenCalled();
      expect(subscriptionService.markSubscriptionNotified).not.toHaveBeenCalled();
    });
  });

  describe('start / stop lifecycle', () => {
    it('should schedule first run on start()', () => {
      job.start();

      expect(vi.getTimerCount()).toBe(1);
    });

    it('should clear the pending timeout on stop()', async () => {
      (
        repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>
      ).mockResolvedValue(paginated([], false));

      job.start();
      job.stop();

      await vi.advanceTimersByTimeAsync(intervalMs * 2);

      expect(repositoryService.getReposThatHaveActiveSubscriptions).not.toHaveBeenCalled();
    });

    it('should not throw when stop() is called without start()', () => {
      expect(() => job.stop()).not.toThrow();
    });
  });
});
