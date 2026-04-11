import { z } from 'zod/v4';

export const createRepoDtoSchema = z.object({
  owner: z.string(),
  repo: z.string(),
});

export type CreateRepoDto = z.infer<typeof createRepoDtoSchema>;

export const getRepoDtoSchema = z.object({
  id: z.string().uuid(),
  owner: z.string(),
  repo: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type GetRepoDto = z.infer<typeof getRepoDtoSchema>;
