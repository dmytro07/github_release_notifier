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
    lastSeenTag: null,
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

  describe('updateRepo', () => {
    it('should return a parsed GetRepoDto when update succeeds', async () => {
      const record = makeRepoRecord({ lastSeenTag: 'v2.0.0' });
      mockRepository.update.mockResolvedValue(record);

      const result = await service.updateRepo(record.id, { lastSeenTag: 'v2.0.0' });

      expect(result).toEqual(record);
    });

    it('should call update with correct where and data arguments', async () => {
      const id = repoId;
      const dto = { lastSeenTag: 'v1.0.0' };
      mockRepository.update.mockResolvedValue(makeRepoRecord(dto));

      await service.updateRepo(id, dto);

      expect(mockRepository.update).toHaveBeenCalledWith({
        where: { id },
        data: dto,
      });
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('Record not found');
      mockRepository.update.mockRejectedValue(error);

      await expect(service.updateRepo('nonexistent-id', { lastSeenTag: 'v1.0.0' })).rejects.toThrow(
        error,
      );
    });
  });

  describe('deleteRepo', () => {
    it('should call delete with correct where argument', async () => {
      const id = repoId;
      mockRepository.delete.mockResolvedValue(makeRepoRecord());

      await service.deleteRepo(id);

      expect(mockRepository.delete).toHaveBeenCalledWith({ where: { id } });
    });

    it('should return void', async () => {
      mockRepository.delete.mockResolvedValue(makeRepoRecord());

      const result = await service.deleteRepo(repoId);

      expect(result).toBeUndefined();
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('Record not found');
      mockRepository.delete.mockRejectedValue(error);

      await expect(service.deleteRepo('nonexistent-id')).rejects.toThrow(error);
    });
  });

  describe('getReposThatHaveActiveSubscriptions', () => {
    it('should return an array of parsed GetRepoDto objects', async () => {
      const records = [
        makeRepoRecord(),
        makeRepoRecord({
          id: '660e8400-e29b-41d4-a716-446655440000',
          owner: 'nodejs',
          repo: 'node',
          lastSeenTag: 'v22.0.0',
        }),
      ];
      mockRepository.findMany.mockResolvedValue(records);

      const result = await service.getReposThatHaveActiveSubscriptions();

      expect(result).toEqual(records);
      expect(result).toHaveLength(2);
    });

    it('should return an empty array when no repos match', async () => {
      mockRepository.findMany.mockResolvedValue([]);

      const result = await service.getReposThatHaveActiveSubscriptions();

      expect(result).toEqual([]);
    });

    it('should query with the correct subscriptions filter', async () => {
      mockRepository.findMany.mockResolvedValue([]);

      await service.getReposThatHaveActiveSubscriptions();

      expect(mockRepository.findMany).toHaveBeenCalledWith({
        where: { subscriptions: { some: { confirmed: true } } },
      });
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('DB connection lost');
      mockRepository.findMany.mockRejectedValue(error);

      await expect(service.getReposThatHaveActiveSubscriptions()).rejects.toThrow(error);
    });
  });
});
