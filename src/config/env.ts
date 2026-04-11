import 'dotenv/config';
import { z } from 'zod/v4';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  BASE_URL: z.string().url(),
  GITHUB_TOKEN: z.string().optional(),
  REDIS_URL: z.string().url().optional(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  FROM_EMAIL: z.string().email(),
  SCANNER_INTERVAL_MS: z.coerce.number().default(300_000),
  CORS_ORIGIN: z.string().optional(),
  API_SECRET_KEY: z.string().optional(),
  GRPC_PORT: z.coerce.number().default(50051),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
