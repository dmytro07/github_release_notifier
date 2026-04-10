import type { PrismaClient } from '@prisma/client';
import type { GitHubClient } from '../integrations/github/github.client.js';
import type { EmailClient } from '../integrations/email/email.client.js';
import type { SubscriptionService } from '../modules/subscription/subscription.service.js';
import { logger } from '../config/logger.js';

export class ScannerJob {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
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
      const repositories = await this.prisma.repository.findMany();

      for (const repo of repositories) {
        try {
          const [owner, repoName] = repo.ownerRepo.split('/');
          const release = await this.github.getLatestRelease(owner, repoName);
          if (!release || release.tagName === repo.lastSeenTag) {
            continue;
          }

          logger.info(
            { repo: repo.ownerRepo, tag: release.tagName },
            'New release detected',
          );

          await this.prisma.repository.update({
            where: { id: repo.id },
            data: { lastSeenTag: release.tagName },
          });

          const subscriptions = await this.prisma.subscription.findMany({
            where: { repositoryId: repo.id, confirmed: true },
          });

          for (const sub of subscriptions) {
            try {
              await this.email.send({
                to: sub.email,
                subject: `New release: ${repo.ownerRepo} ${release.tagName}`,
                html: `<p>A new release <strong>${release.tagName}</strong> is available for <strong>${repo.ownerRepo}</strong>.</p>
                       <p><a href="https://github.com/${repo.ownerRepo}/releases/tag/${release.tagName}">View release</a></p>`,
              });
            } catch (emailErr) {
              logger.error(
                { err: emailErr, email: sub.email, repo: repo.ownerRepo },
                'Failed to send notification email',
              );
            }
          }
        } catch (repoErr) {
          logger.error(
            { err: repoErr, repo: repo.ownerRepo },
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
