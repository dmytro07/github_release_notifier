import { z } from 'zod/v4';

const OWNER_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;

export const subscribeRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
  repo: z
    .string()
    .refine((v) => {
      const parts = v.split('/');
      return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
    }, 'Repo must be in owner/repo format')
    .transform((v) => {
      const [owner, repo] = v.split('/');
      return { owner, repo };
    })
    .refine(({ owner }) => OWNER_RE.test(owner), 'Invalid GitHub owner name')
    .refine(
      ({ repo }) =>
        REPO_RE.test(repo) && repo !== '.' && repo !== '..' && !repo.endsWith('.git'),
      'Invalid GitHub repository name',
    )
    .transform(({ owner, repo }) => `${owner}/${repo}`),
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
