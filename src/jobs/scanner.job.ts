import type { PrismaClient } from '@prisma/client';
import type { GitHubClient } from '../integrations/github/github.client.js';
import type { EmailClient } from '../integrations/email/email.client.js';
import type { SubscriptionService } from '../modules/subscription/subscription.service.js';
import type { RepositoryService } from '../modules/repository/repository.service.js';
import { logger } from '../config/logger.js';

export class ScannerJob {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repositoryService: RepositoryService,
    private readonly github: GitHubClient,
    private readonly subscriptionService: SubscriptionService,
    private readonly email: EmailClient,
    private readonly intervalMs: number,
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

  private async run(): Promise<void> {
    try {
      const repositories = await this.repositoryService.getReposThatHaveActiveSubscriptions();

      for (const repo of repositories) {
        const fullName = `${repo.owner}/${repo.repo}`;
        try {
          const release = await this.github.getLatestRelease(repo.owner, repo.repo);
          if (!release || release.tagName === repo.lastSeenTag) {
            continue;
          }

          logger.info({ repo: fullName, tag: release.tagName }, 'New release detected');

          await this.repositoryService.updateRepo({
            id: repo.id,
            lastSeenTag: release.tagName,
          });

          const subscriptions = await this.prisma.subscription.findMany({
            where: { repositoryId: repo.id, confirmed: true },
          });

          for (const sub of subscriptions) {
            try {
              await this.email.send({
                to: sub.email,
                subject: `New release: ${fullName} ${release.tagName}`,
                html: `<p>A new release <strong>${release.tagName}</strong> is available for <strong>${fullName}</strong>.</p>
                       <p><a href="https://github.com/${fullName}/releases/tag/${release.tagName}">View release</a></p>`,
              });
            } catch (emailErr) {
              logger.error(
                { err: emailErr, email: sub.email, repo: fullName },
                'Failed to send notification email',
              );
            }
          }
        } catch (repoErr) {
          logger.error(
            { err: repoErr, repo: fullName },
            'Failed to check repository for new releases',
          );
        }
      }
    } catch (err) {
      logger.error(err, 'Scanner loop error');
    } finally {
      this.scheduleNext();
    }
  }
}
