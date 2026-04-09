import type { PrismaClient } from '@prisma/client';

export async function truncateAllTables(prisma: PrismaClient): Promise<void> {
  await prisma.subscription.deleteMany();
  await prisma.repository.deleteMany();
}
