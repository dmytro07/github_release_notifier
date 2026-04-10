import type { PrismaClient } from '@prisma/client';
import {
  getRepoDtoSchema,
  type CreateRepoDto,
  type UpdateRepoDto,
  type GetRepoDto,
} from './repository.schema.js';

export class RepositoryService {
  constructor(private readonly prisma: PrismaClient) {}

  async findOrCreateRepo(dto: CreateRepoDto): Promise<GetRepoDto> {
    const record = await this.prisma.repository.upsert({
      where: { owner_repo: { owner: dto.owner, repo: dto.repo } },
      update: {},
      create: { owner: dto.owner, repo: dto.repo },
    });

    return getRepoDtoSchema.parse(record);
  }

  async updateRepo(id: string, dto: UpdateRepoDto): Promise<GetRepoDto> {
    const record = await this.prisma.repository.update({
      where: { id },
      data: dto,
    });

    return getRepoDtoSchema.parse(record);
  }

  async deleteRepo(id: string): Promise<void> {
    await this.prisma.repository.delete({ where: { id } });
  }

  async getReposThatHaveActiveSubscriptions(): Promise<GetRepoDto[]> {
    const records = await this.prisma.repository.findMany({
      where: { subscriptions: { some: {} } },
    });

    return records.map((r) => getRepoDtoSchema.parse(r));
  }
}
