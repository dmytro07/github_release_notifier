import { z } from 'zod/v4';

export const subscribeRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
  repo: z
    .string()
    .regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/, 'Repo must be in owner/repo format'),
});

export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;

export const tokenParamsSchema = z.object({
  token: z.string().uuid('Invalid token'),
});

export type TokenParams = z.infer<typeof tokenParamsSchema>;

export const emailQuerySchema = z.object({
  email: z.string().email('Invalid email address'),
});

export type EmailQuery = z.infer<typeof emailQuerySchema>;

export interface SubscriptionResponse {
  email: string;
  repo: string;
  confirmed: boolean;
  last_seen_tag: string | null;
}
