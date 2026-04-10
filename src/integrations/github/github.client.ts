import { Octokit, RestEndpointMethodTypes } from '@octokit/rest';

export type GitHubRepo = RestEndpointMethodTypes['repos']['get']['response']['data'];

export type GitHubRelease =
  RestEndpointMethodTypes['repos']['getLatestRelease']['response']['data'];

export class GitHubClient {
  private readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async getRepo(owner: string, repo: string): Promise<GitHubRepo | null> {
    try {
      const { data } = await this.octokit.repos.get({ owner, repo });
      return data;
    } catch (err: unknown) {
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
      if (this.isOctokitError(err) && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  private isOctokitError(err: unknown): err is { status: number } {
    return typeof err === 'object' && err !== null && 'status' in err;
  }
}
