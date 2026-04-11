import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { RepositoryService } from '../../../../src/modules/repository/repository.service.js';

const repoId = '550e8400-e29b-41d4-a716-446655440000';
const repoOwner = 'octocat';
const repoRepo = 'hello-world';

function makeRepoRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: repoId,
    owner: repoOwner,
    repo: repoRepo,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

const mockRepository = {
  upsert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
};

const prisma = { repository: mockRepository } as unknown as PrismaClient;

describe('RepositoryService', () => {
  let service: RepositoryService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new RepositoryService(prisma);
  });

  describe('findOrCreateRepo', () => {
    it('should return a parsed GetRepoDto when upsert succeeds', async () => {
      const record = makeRepoRecord();
      mockRepository.upsert.mockResolvedValue(record);

      const result = await service.findOrCreateRepo({ owner: repoOwner, repo: repoRepo });

      expect(result).toEqual(record);
    });

    it('should call upsert with correct arguments', async () => {
      mockRepository.upsert.mockResolvedValue(makeRepoRecord());

      await service.findOrCreateRepo({ owner: repoOwner, repo: repoRepo });

      expect(mockRepository.upsert).toHaveBeenCalledWith({
        where: { owner_repo: { owner: repoOwner, repo: repoRepo } },
        update: {},
        create: { owner: repoOwner, repo: repoRepo },
      });
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('DB connection lost');
      mockRepository.upsert.mockRejectedValue(error);

      await expect(service.findOrCreateRepo({ owner: repoOwner, repo: repoRepo })).rejects.toThrow(
        error,
      );
    });
  });

  describe('getReposThatHaveActiveSubscriptions', () => {
    const expectedWhere = { subscriptions: { some: { confirmed: true } } };

    it('should return a paginated response of parsed GetRepoDto objects', async () => {
      const records = [
        makeRepoRecord(),
        makeRepoRecord({
          id: '660e8400-e29b-41d4-a716-446655440000',
          owner: 'nodejs',
          repo: 'node',
        }),
      ];
      mockRepository.findMany.mockResolvedValue(records);
      mockRepository.count.mockResolvedValue(2);

      const result = await service.getReposThatHaveActiveSubscriptions(1, 10);

      expect(result).toEqual({
        data: records,
        total: 2,
        page: 1,
        pageSize: 10,
        hasMore: false,
      });
    });

    it('should indicate hasMore when more pages exist', async () => {
      mockRepository.findMany.mockResolvedValue([makeRepoRecord()]);
      mockRepository.count.mockResolvedValue(3);

      const result = await service.getReposThatHaveActiveSubscriptions(1, 1);

      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(3);
    });

    it('should return empty data when no repos match', async () => {
      mockRepository.findMany.mockResolvedValue([]);
      mockRepository.count.mockResolvedValue(0);

      const result = await service.getReposThatHaveActiveSubscriptions(1, 10);

      expect(result).toEqual({
        data: [],
        total: 0,
        page: 1,
        pageSize: 10,
        hasMore: false,
      });
    });

    it('should query with correct filter, skip, and take', async () => {
      mockRepository.findMany.mockResolvedValue([]);
      mockRepository.count.mockResolvedValue(0);

      await service.getReposThatHaveActiveSubscriptions(2, 5);

      expect(mockRepository.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        skip: 5,
        take: 5,
      });
      expect(mockRepository.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('DB connection lost');
      mockRepository.findMany.mockRejectedValue(error);

      await expect(service.getReposThatHaveActiveSubscriptions(1, 10)).rejects.toThrow(error);
    });
  });
});
