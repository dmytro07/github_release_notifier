import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { Octokit } from '@octokit/rest';
import { GitHubClient } from '../../../src/integrations/github/github.client.js';

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
});
