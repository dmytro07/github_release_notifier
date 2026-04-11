import type { Redis } from 'ioredis';
import type { GitHubRelease, GitHubRepo, IGitHubClient } from './github.client.js';
import { logger } from '../../config/logger.js';

const NULL_SENTINEL = '__null__';

export class CachedGitHubClient implements IGitHubClient {
  constructor(
    private readonly inner: IGitHubClient,
    private readonly redis: Redis,
    private readonly ttlSeconds: number = 600,
  ) {}

  async getRepo(owner: string, repo: string): Promise<GitHubRepo | null> {
    const key = `github:repo:${owner}/${repo}`;
    return this.cached(key, () => this.inner.getRepo(owner, repo));
  }

  async getLatestRelease(owner: string, repo: string): Promise<GitHubRelease | null> {
    const key = `github:release:${owner}/${repo}`;
    return this.cached(key, () => this.inner.getLatestRelease(owner, repo));
  }

  private async cached<T>(key: string, fetch: () => Promise<T | null>): Promise<T | null> {
    try {
      const hit = await this.redis.get(key);
      if (hit !== null) {
        return hit === NULL_SENTINEL ? null : (JSON.parse(hit) as T);
      }
    } catch (err) {
      logger.warn({ err, key }, 'Redis GET failed, falling through to GitHub');
    }

    const data = await fetch();

    try {
      const value = data === null ? NULL_SENTINEL : JSON.stringify(data);
      await this.redis.set(key, value, 'EX', this.ttlSeconds);
    } catch (err) {
      logger.warn({ err, key }, 'Redis SET failed');
    }

    return data;
  }
}
