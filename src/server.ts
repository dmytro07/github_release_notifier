import { PrismaClient } from '@prisma/client';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createApp } from './app.js';
import { GitHubClient } from './integrations/github/github.client.js';
import { EmailClient } from './integrations/email/email.client.js';
import { SubscriptionService } from './modules/subscription/subscription.service.js';
import { SubscriptionController } from './modules/subscription/subscription.controller.js';
import { ScannerJob } from './jobs/scanner.job.js';

const prisma = new PrismaClient();
const github = new GitHubClient(env.GITHUB_TOKEN);
const email = new EmailClient(
  env.SMTP_HOST,
  env.SMTP_PORT,
  env.SMTP_USER,
  env.SMTP_PASS,
  env.FROM_EMAIL,
);
const subscriptionService = new SubscriptionService(prisma, github, email);
const controller = new SubscriptionController(subscriptionService);
const scanner = new ScannerJob(prisma, github, subscriptionService, email, env.SCANNER_INTERVAL_MS);

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
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
