import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createApp } from './app.js';
import type { IGitHubClient } from './integrations/github/github.client.js';
import { GitHubClient } from './integrations/github/github.client.js';
import { CachedGitHubClient } from './integrations/github/cached-github.client.js';
import { createRedisClient } from './integrations/redis/index.js';
import { EmailClient } from './integrations/email/email.client.js';
import { SubscriptionService } from './modules/subscription/subscription.service.js';
import { SubscriptionController } from './modules/subscription/subscription.controller.js';
import { RepositoryService } from './modules/repository/index.js';
import { ScannerJob } from './jobs/scanner.job.js';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const rawGithub = new GitHubClient(env.GITHUB_TOKEN);
const redis = env.REDIS_URL ? createRedisClient(env.REDIS_URL) : undefined;
const github: IGitHubClient = redis ? new CachedGitHubClient(rawGithub, redis) : rawGithub;
const email = new EmailClient(
  env.SMTP_HOST,
  env.SMTP_PORT,
  env.SMTP_USER,
  env.SMTP_PASS,
  env.FROM_EMAIL,
);
const repositoryService = new RepositoryService(prisma);
const subscriptionService = new SubscriptionService(prisma, github, email, repositoryService, env.BASE_URL);
const controller = new SubscriptionController(subscriptionService);
const scanner = new ScannerJob(repositoryService, github, subscriptionService, email, env.SCANNER_INTERVAL_MS, env.BASE_URL);

const app = createApp(controller);

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'Server started');
  scanner.start();
});

async function shutdown(): Promise<void> {
  logger.info('Shutting down...');
  scanner.stop();
  server.close();
  await prisma.$disconnect();
  await redis?.quit();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
