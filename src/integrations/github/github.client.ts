import { logger } from '../../config/logger.js';

export interface GitHubRelease {
  tagName: string;
}

export class GitHubClient {
  constructor(private readonly token: string) {}

  async verifyRepoExists(_ownerRepo: string): Promise<boolean> {
    logger.debug('GitHubClient.verifyRepoExists not yet implemented');
    throw new Error('Not implemented');
  }

  async getLatestRelease(_ownerRepo: string): Promise<GitHubRelease | null> {
    logger.debug('GitHubClient.getLatestRelease not yet implemented');
    throw new Error('Not implemented');
  }
}
