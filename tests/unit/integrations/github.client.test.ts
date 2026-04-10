import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Octokit } from '@octokit/rest';
import { GitHubClient } from '../../../src/integrations/github/github.client.js';
import { GitHubRateLimitError } from '../../../src/common/errors/app-error.js';

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(),
}));

describe('GitHubClient', () => {
  let client: GitHubClient;
  let mockGet: Mock;
  let mockGetLatestRelease: Mock;

  beforeEach(() => {
    mockGet = vi.fn();
    mockGetLatestRelease = vi.fn();

    (Octokit as unknown as Mock).mockImplementation(function (this: unknown) {
      (this as Record<string, unknown>).repos = {
        get: mockGet,
        getLatestRelease: mockGetLatestRelease,
      };
    });

    client = new GitHubClient('fake-token');
  });

  describe('getRepo', () => {
    it('should return repo data on success', async () => {
      const fakeRepo = { id: 1, full_name: 'owner/repo' };
      mockGet.mockResolvedValue({ data: fakeRepo });

      const result = await client.getRepo('owner', 'repo');

      expect(result).toEqual(fakeRepo);
      expect(mockGet).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' });
    });

    it('should return null for a non-existent repository', async () => {
      mockGet.mockRejectedValue({ status: 404 });

      const result = await client.getRepo('owner', 'missing');

      expect(result).toBeNull();
    });

    it('should re-throw non-404 errors', async () => {
      const error = { status: 500 };
      mockGet.mockRejectedValue(error);

      await expect(client.getRepo('owner', 'repo')).rejects.toEqual(error);
    });
  });

  describe('getLatestRelease', () => {
    it('should return release data on success', async () => {
      const fakeRelease = { id: 42, tag_name: 'v1.0.0' };
      mockGetLatestRelease.mockResolvedValue({ data: fakeRelease });

      const result = await client.getLatestRelease('owner', 'repo');

      expect(result).toEqual(fakeRelease);
      expect(mockGetLatestRelease).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' });
    });

    it('should return null when no releases exist', async () => {
      mockGetLatestRelease.mockRejectedValue({ status: 404 });

      const result = await client.getLatestRelease('owner', 'repo');

      expect(result).toBeNull();
    });

    it('should re-throw non-404 errors', async () => {
      const error = { status: 500 };
      mockGetLatestRelease.mockRejectedValue(error);

      await expect(client.getLatestRelease('owner', 'repo')).rejects.toEqual(error);
    });
  });

  describe('rate limit handling', () => {
    const nowS = 1_700_000_000;

    beforeEach(() => {
      vi.spyOn(Date, 'now').mockReturnValue(nowS * 1000);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function rateLimitError(status: number, resetEpoch?: number) {
      return {
        status,
        ...(resetEpoch != null && {
          response: { headers: { 'x-ratelimit-reset': String(resetEpoch) } },
        }),
      };
    }

    it('should throw GitHubRateLimitError on 429 with computed retryAfterMs', async () => {
      const resetEpoch = nowS + 300;
      mockGet.mockRejectedValue(rateLimitError(429, resetEpoch));

      const err = await client.getRepo('owner', 'repo').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(GitHubRateLimitError);
      expect((err as GitHubRateLimitError).retryAfterMs).toBe(300_000);
    });

    it('should fall back to 60 000 ms when 429 has no reset header', async () => {
      mockGet.mockRejectedValue(rateLimitError(429));

      const err = await client.getRepo('owner', 'repo').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(GitHubRateLimitError);
      expect((err as GitHubRateLimitError).retryAfterMs).toBe(60_000);
    });

    it('should throw GitHubRateLimitError on 403 with reset header', async () => {
      const resetEpoch = nowS + 600;
      mockGetLatestRelease.mockRejectedValue(rateLimitError(403, resetEpoch));

      const err = await client.getLatestRelease('owner', 'repo').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(GitHubRateLimitError);
      expect((err as GitHubRateLimitError).retryAfterMs).toBe(600_000);
    });

    it('should clamp retryAfterMs to 0 when reset is in the past', async () => {
      const resetEpoch = nowS - 10;
      mockGet.mockRejectedValue(rateLimitError(429, resetEpoch));

      const err = await client.getRepo('owner', 'repo').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(GitHubRateLimitError);
      expect((err as GitHubRateLimitError).retryAfterMs).toBe(0);
    });

    it('should throw GitHubRateLimitError from getLatestRelease on 429', async () => {
      const resetEpoch = nowS + 120;
      mockGetLatestRelease.mockRejectedValue(rateLimitError(429, resetEpoch));

      const err = await client.getLatestRelease('owner', 'repo').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(GitHubRateLimitError);
      expect((err as GitHubRateLimitError).retryAfterMs).toBe(120_000);
    });
  });
});
