import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScannerJob } from '../../../src/jobs/scanner.job.js';
import type { RepositoryService } from '../../../src/modules/repository/repository.service.js';
import type { GitHubClient } from '../../../src/integrations/github/github.client.js';
import type { SubscriptionService } from '../../../src/modules/subscription/subscription.service.js';
import type { EmailClient } from '../../../src/integrations/email/email.client.js';
import type { GetRepoDto } from '../../../src/modules/repository/repository.schema.js';
import type { PaginatedResponse } from '../../../src/common/types/paginated-response.js';

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
    lastSeenTag: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function paginated<T>(
  data: T[],
  hasMore: boolean,
  page = 1,
  pageSize = 50,
): PaginatedResponse<T> {
  return { data, total: data.length, page, pageSize, hasMore };
}

const repositoryService = {
  getReposThatHaveActiveSubscriptions: vi.fn(),
  updateRepo: vi.fn(),
} as unknown as RepositoryService;

const github = {
  getLatestRelease: vi.fn(),
} as unknown as GitHubClient;

const subscriptionService = {
  getSubscriptionsByRepositoryId: vi.fn(),
} as unknown as SubscriptionService;

const email = {
  send: vi.fn(),
} as unknown as EmailClient;

async function triggerRun(): Promise<void> {
  await vi.advanceTimersByTimeAsync(intervalMs);
}

describe('ScannerJob', () => {
  let job: ScannerJob;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    job = new ScannerJob(repositoryService, github, subscriptionService, email, intervalMs, baseUrl);
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

    it('should send notification emails for a new release', async () => {
      const repo = makeRepo({ lastSeenTag: 'v1.0.0' });

      (repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(paginated([repo], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ tag_name: 'v2.0.0' });

      (repositoryService.updateRepo as ReturnType<typeof vi.fn>).mockResolvedValue(repo);

      const sub = { email: 'user@example.com', unsubscribeToken: 'tok-1' };
      (subscriptionService.getSubscriptionsByRepositoryId as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(paginated([sub], false));

      (email.send as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      job.start();
      await triggerRun();

      expect(repositoryService.updateRepo).toHaveBeenCalledWith(repo.id, { lastSeenTag: 'v2.0.0' });

      expect(email.send).toHaveBeenCalledWith({
        to: 'user@example.com',
        subject: 'New release: octocat/hello-world v2.0.0',
        html: expect.stringContaining('v2.0.0'),
      });
      expect((email.send as ReturnType<typeof vi.fn>).mock.calls[0][0].html)
        .toContain(`${baseUrl}/api/unsubscribe/tok-1`);
    });

    it('should paginate subscribers', async () => {
      const repo = makeRepo({ lastSeenTag: 'v1.0.0' });

      (repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(paginated([repo], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ tag_name: 'v2.0.0' });

      (repositoryService.updateRepo as ReturnType<typeof vi.fn>).mockResolvedValue(repo);

      const subA = { email: 'a@example.com', unsubscribeToken: 'tok-a' };
      const subB = { email: 'b@example.com', unsubscribeToken: 'tok-b' };

      (subscriptionService.getSubscriptionsByRepositoryId as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(paginated([subA], true))
        .mockResolvedValueOnce(paginated([subB], false, 2));

      (email.send as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      job.start();
      await triggerRun();

      expect(email.send).toHaveBeenCalledTimes(2);
      expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@example.com' }));
      expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'b@example.com' }));
    });

    it('should skip repo when no release exists', async () => {
      const repo = makeRepo();

      (repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(paginated([repo], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      job.start();
      await triggerRun();

      expect(repositoryService.updateRepo).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('should skip repo when tag is unchanged', async () => {
      const repo = makeRepo({ lastSeenTag: 'v1.0.0' });

      (repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(paginated([repo], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ tag_name: 'v1.0.0' });

      job.start();
      await triggerRun();

      expect(repositoryService.updateRepo).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('should continue processing other repos if one fails', async () => {
      const repoA = makeRepo();
      const repoB = makeRepo({ id: 'id-b', owner: 'nodejs', repo: 'node' });

      (repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(paginated([repoA, repoB], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('GitHub API error'))
        .mockResolvedValueOnce({ tag_name: 'v22.0.0' });

      (repositoryService.updateRepo as ReturnType<typeof vi.fn>).mockResolvedValue(repoB);

      const sub = { email: 'user@example.com', unsubscribeToken: 'tok-1' };
      (subscriptionService.getSubscriptionsByRepositoryId as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(paginated([sub], false));

      (email.send as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      job.start();
      await triggerRun();

      expect(repositoryService.updateRepo).toHaveBeenCalledWith('id-b', { lastSeenTag: 'v22.0.0' });
      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it('should continue sending emails if one fails', async () => {
      const repo = makeRepo({ lastSeenTag: 'v1.0.0' });

      (repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(paginated([repo], false));

      (github.getLatestRelease as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ tag_name: 'v2.0.0' });

      (repositoryService.updateRepo as ReturnType<typeof vi.fn>).mockResolvedValue(repo);

      const subA = { email: 'a@example.com', unsubscribeToken: 'tok-a' };
      const subB = { email: 'b@example.com', unsubscribeToken: 'tok-b' };

      (subscriptionService.getSubscriptionsByRepositoryId as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(paginated([subA, subB], false));

      (email.send as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('SMTP down'))
        .mockResolvedValueOnce(undefined);

      job.start();
      await triggerRun();

      expect(email.send).toHaveBeenCalledTimes(2);
      expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'b@example.com' }));
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

  describe('start / stop lifecycle', () => {
    it('should schedule first run on start()', () => {
      job.start();

      expect(vi.getTimerCount()).toBe(1);
    });

    it('should clear the pending timeout on stop()', async () => {
      (repositoryService.getReposThatHaveActiveSubscriptions as ReturnType<typeof vi.fn>)
        .mockResolvedValue(paginated([], false));

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
