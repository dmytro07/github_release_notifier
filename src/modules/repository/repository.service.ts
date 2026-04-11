import type { PrismaClient } from '@prisma/client';
import type { PaginatedResponse } from '../../common/types/paginated-response.js';
import { getRepoDtoSchema, type CreateRepoDto, type GetRepoDto } from './repository.schema.js';

export interface IRepositoryService {
  findOrCreateRepo(dto: CreateRepoDto): Promise<GetRepoDto>;
  getReposThatHaveActiveSubscriptions(
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<GetRepoDto>>;
}

export class RepositoryService implements IRepositoryService {
  constructor(private readonly prisma: PrismaClient) {}

  async findOrCreateRepo(dto: CreateRepoDto): Promise<GetRepoDto> {
    const record = await this.prisma.repository.upsert({
      where: { owner_repo: { owner: dto.owner, repo: dto.repo } },
      update: {},
      create: { owner: dto.owner, repo: dto.repo },
    });

    return getRepoDtoSchema.parse(record);
  }

  async getReposThatHaveActiveSubscriptions(
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<GetRepoDto>> {
    const where = { subscriptions: { some: { confirmed: true } } };
    const [records, total] = await Promise.all([
      this.prisma.repository.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.repository.count({ where }),
    ]);

    return {
      data: records.map((r) => getRepoDtoSchema.parse(r)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }
}
