import { Octokit, RestEndpointMethodTypes } from '@octokit/rest';
import { GitHubRateLimitError } from '../../common/errors/app-error.js';

export type GitHubRepo = RestEndpointMethodTypes['repos']['get']['response']['data'];

export type GitHubRelease =
  RestEndpointMethodTypes['repos']['getLatestRelease']['response']['data'];

export interface IGitHubClient {
  getRepo(owner: string, repo: string): Promise<GitHubRepo | null>;
  getLatestRelease(owner: string, repo: string): Promise<GitHubRelease | null>;
}

export class GitHubClient implements IGitHubClient {
  private readonly octokit: Octokit;

  constructor(token?: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async getRepo(owner: string, repo: string): Promise<GitHubRepo | null> {
    try {
      const { data } = await this.octokit.repos.get({ owner, repo });
      return data;
    } catch (err: unknown) {
      this.throwIfRateLimited(err);
      if (this.isOctokitError(err) && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  async getLatestRelease(owner: string, repo: string): Promise<GitHubRelease | null> {
    try {
      const { data } = await this.octokit.repos.getLatestRelease({ owner, repo });
      return data;
    } catch (err: unknown) {
      this.throwIfRateLimited(err);
      if (this.isOctokitError(err) && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  private throwIfRateLimited(err: unknown): void {
    if (!this.isOctokitError(err) || (err.status !== 429 && err.status !== 403)) {
      return;
    }

    const resetHeader = this.getResponseHeader(err, 'x-ratelimit-reset');
    const resetEpochS = resetHeader ? Number(resetHeader) : NaN;
    const retryAfterMs = Number.isFinite(resetEpochS)
      ? Math.max((resetEpochS - Math.floor(Date.now() / 1000)) * 1000, 0)
      : 60_000;

    throw new GitHubRateLimitError(retryAfterMs);
  }

  private getResponseHeader(err: unknown, header: string): string | undefined {
    const resp = (err as Record<string, unknown>).response;
    if (typeof resp !== 'object' || resp === null) return undefined;
    const headers = (resp as Record<string, unknown>).headers;
    if (typeof headers !== 'object' || headers === null) return undefined;
    const value = (headers as Record<string, unknown>)[header];
    return typeof value === 'string' ? value : undefined;
  }

  private isOctokitError(err: unknown): err is { status: number } {
    return typeof err === 'object' && err !== null && 'status' in err;
  }
}
