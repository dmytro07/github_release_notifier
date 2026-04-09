import { PrismaClient } from '@prisma/client';
import { inject } from 'vitest';

let prisma: PrismaClient;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    const databaseUrl = inject('databaseUrl');
    prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma?.$disconnect();
}
