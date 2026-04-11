import type { IGitHubClient } from '../integrations/github/github.client.js';
import type { IEmailClient } from '../integrations/email/email.client.js';
import type { ISubscriptionService } from '../modules/subscription/subscription.service.js';
import type { IRepositoryService } from '../modules/repository/repository.service.js';
import type { GetRepoDto } from '../modules/repository/repository.schema.js';
import { logger } from '../config/logger.js';
import { GitHubRateLimitError } from '../common/errors/app-error.js';

const REPO_PAGE_SIZE = 50;
const SUB_PAGE_SIZE = 50;

export class ScannerJob {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly repositoryService: IRepositoryService,
    private readonly github: IGitHubClient,
    private readonly subscriptionService: ISubscriptionService,
    private readonly email: IEmailClient,
    private readonly intervalMs: number,
    private readonly baseUrl: string,
  ) {}

  start(): void {
    logger.info({ intervalMs: this.intervalMs }, 'Scanner job started');
    this.scheduleNext();
  }

  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
      logger.info('Scanner job stopped');
    }
  }

  private scheduleNext(): void {
    this.timeoutId = setTimeout(() => void this.run(), this.intervalMs);
  }

  private sleep(ms: number): Promise<void> {
    const capped = Math.min(ms, 3_600_000);
    return new Promise((resolve) => setTimeout(resolve, capped));
  }

  private async run(): Promise<void> {
    try {
      let repoPage = 1;
      let hasMoreRepos = true;

      while (hasMoreRepos) {
        const reposResult = await this.repositoryService.getReposThatHaveActiveSubscriptions(
          repoPage,
          REPO_PAGE_SIZE,
        );

        for (const repo of reposResult.data) {
          try {
            await this.processRepo(repo);
          } catch (err) {
            if (err instanceof GitHubRateLimitError) {
              logger.warn(
                { retryAfterMs: err.retryAfterMs },
                'GitHub rate limit hit, pausing scanner',
              );
              await this.sleep(err.retryAfterMs);
              return;
            } else {
              logger.error({ err, repo: `${repo.owner}/${repo.repo}` }, 'Failed to process repo');
            }
          }
        }

        hasMoreRepos = reposResult.hasMore;
        repoPage++;
      }
    } catch (err) {
      logger.error(err, 'Scanner loop error');
    } finally {
      this.scheduleNext();
    }
  }

  private async processRepo(repo: GetRepoDto): Promise<void> {
    const fullName = `${repo.owner}/${repo.repo}`;
    try {
      const release = await this.github.getLatestRelease(repo.owner, repo.repo);
      if (!release) {
        return;
      }

      logger.info({ repo: fullName, tag: release.tag_name }, 'New release detected');

      let subPage = 1;
      let hasMoreSubs = true;

      while (hasMoreSubs) {
        const subsResult = await this.subscriptionService.getSubscriptionsToNotify(
          repo.id,
          release.tag_name,
          subPage,
          SUB_PAGE_SIZE,
        );

        for (const sub of subsResult.data) {
          try {
            await this.email.send({
              to: sub.email,
              subject: `New release: ${fullName} ${release.tag_name}`,
              html: `<p>A new release <strong>${release.tag_name}</strong> is available for <strong>${fullName}</strong>.</p>
                     <p><a href="https://github.com/${fullName}/releases/tag/${release.tag_name}">View release</a></p>
                     <p><a href="${this.baseUrl}/api/unsubscribe/${sub.unsubscribeToken}">Unsubscribe</a></p>`,
            });
            await this.subscriptionService.markSubscriptionNotified(sub.id, release.tag_name);
          } catch (emailErr) {
            logger.error(
              { err: emailErr, email: sub.email, repo: fullName },
              'Failed to send notification email',
            );
          }
        }

        hasMoreSubs = subsResult.hasMore;
        subPage++;
      }
    } catch (repoErr) {
      if (repoErr instanceof GitHubRateLimitError) throw repoErr;
      logger.error({ err: repoErr, repo: fullName }, 'Failed to check repository for new releases');
    }
  }
}
