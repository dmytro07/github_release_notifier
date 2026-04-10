import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { inject } from 'vitest';

let prisma: PrismaClient;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    const databaseUrl = inject('databaseUrl');
    const adapter = new PrismaPg({ connectionString: databaseUrl });
    prisma = new PrismaClient({ adapter });
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma?.$disconnect();
}
