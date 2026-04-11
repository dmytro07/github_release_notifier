import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('../../../src/config/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  },
}));

import type { IGitHubClient } from '../../../src/integrations/github/github.client.js';
import { CachedGitHubClient } from '../../../src/integrations/github/cached-github.client.js';
import { logger } from '../../../src/config/logger.js';

function createRedisMock() {
  return {
    get: vi.fn(),
    set: vi.fn(),
  };
}

describe('CachedGitHubClient', () => {
  let inner: IGitHubClient;
  let mockGet: Mock;
  let mockSet: Mock;
  let mockGetRepo: Mock;
  let mockGetLatestRelease: Mock;

  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
    mockGet = vi.fn();
    mockSet = vi.fn();
    mockGetRepo = vi.fn();
    mockGetLatestRelease = vi.fn();
    inner = {
      getRepo: mockGetRepo,
      getLatestRelease: mockGetLatestRelease,
    };
  });

  describe('getRepo', () => {
    it('on cache miss calls inner client, stores JSON in Redis, and returns data', async () => {
      mockGet.mockResolvedValue(null);
      mockSet.mockResolvedValue('OK');
      const fakeRepo = { id: 1, full_name: 'o/r' };
      mockGetRepo.mockResolvedValue(fakeRepo);

      const redis = createRedisMock();
      redis.get = mockGet;
      redis.set = mockSet;

      const client = new CachedGitHubClient(inner, redis as never);
      const result = await client.getRepo('o', 'r');

      expect(result).toEqual(fakeRepo);
      expect(mockGetRepo).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledWith(
        'github:repo:o/r',
        JSON.stringify(fakeRepo),
        'EX',
        600,
      );
    });

    it('on cache hit returns parsed data without calling inner client', async () => {
      const fakeRepo = { id: 2, full_name: 'a/b' };
      mockGet.mockResolvedValue(JSON.stringify(fakeRepo));
      const redis = createRedisMock();
      redis.get = mockGet;
      redis.set = mockSet;

      const client = new CachedGitHubClient(inner, redis as never);
      const result = await client.getRepo('a', 'b');

      expect(result).toEqual(fakeRepo);
      expect(mockGetRepo).not.toHaveBeenCalled();
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('caches null responses with sentinel and returns null on hit', async () => {
      mockGet
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('__null__');
      mockSet.mockResolvedValue('OK');
      mockGetRepo.mockResolvedValue(null);

      const redis = createRedisMock();
      redis.get = mockGet;
      redis.set = mockSet;

      const client = new CachedGitHubClient(inner, redis as never);
      await client.getRepo('x', 'y');
      expect(mockSet).toHaveBeenCalledWith('github:repo:x/y', '__null__', 'EX', 600);

      const second = await client.getRepo('x', 'y');
      expect(second).toBeNull();
      expect(mockGetRepo).toHaveBeenCalledTimes(1);
    });

    it('when Redis GET fails logs warning and falls through to inner client', async () => {
      mockGet.mockRejectedValue(new Error('redis down'));
      mockSet.mockResolvedValue('OK');
      const fakeRepo = { id: 3 };
      mockGetRepo.mockResolvedValue(fakeRepo);

      const redis = createRedisMock();
      redis.get = mockGet;
      redis.set = mockSet;

      const client = new CachedGitHubClient(inner, redis as never);
      const result = await client.getRepo('o', 'r');

      expect(result).toEqual(fakeRepo);
      expect(logger.warn).toHaveBeenCalled();
      expect(mockGetRepo).toHaveBeenCalledTimes(1);
    });

    it('when Redis SET fails logs warning and still returns inner data', async () => {
      mockGet.mockResolvedValue(null);
      mockSet.mockRejectedValue(new Error('write failed'));
      const fakeRepo = { id: 4 };
      mockGetRepo.mockResolvedValue(fakeRepo);

      const redis = createRedisMock();
      redis.get = mockGet;
      redis.set = mockSet;

      const client = new CachedGitHubClient(inner, redis as never);
      const result = await client.getRepo('o', 'r');

      expect(result).toEqual(fakeRepo);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('passes custom TTL to redis.set', async () => {
      mockGet.mockResolvedValue(null);
      mockSet.mockResolvedValue('OK');
      mockGetRepo.mockResolvedValue({ id: 5 });

      const redis = createRedisMock();
      redis.get = mockGet;
      redis.set = mockSet;

      const client = new CachedGitHubClient(inner, redis as never, 123);
      await client.getRepo('o', 'r');

      expect(mockSet).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 123);
    });
  });

  describe('getLatestRelease', () => {
    it('uses release cache key and delegates to inner getLatestRelease', async () => {
      mockGet.mockResolvedValue(null);
      mockSet.mockResolvedValue('OK');
      const release = { id: 10, tag_name: 'v1' };
      mockGetLatestRelease.mockResolvedValue(release);

      const redis = createRedisMock();
      redis.get = mockGet;
      redis.set = mockSet;

      const client = new CachedGitHubClient(inner, redis as never);
      const result = await client.getLatestRelease('owner', 'repo');

      expect(result).toEqual(release);
      expect(mockGetLatestRelease).toHaveBeenCalledWith('owner', 'repo');
      expect(mockSet).toHaveBeenCalledWith(
        'github:release:owner/repo',
        JSON.stringify(release),
        'EX',
        600,
      );
    });
  });
});
