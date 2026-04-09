import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import type { GlobalSetupContext } from 'vitest/node';

let container: StartedPostgreSqlContainer;

export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();

  const databaseUrl = container.getConnectionUri();

  execSync(`DATABASE_URL="${databaseUrl}" npx prisma migrate deploy`, {
    stdio: 'inherit',
  });

  provide('databaseUrl', databaseUrl);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
