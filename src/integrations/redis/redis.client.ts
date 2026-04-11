import { Redis } from 'ioredis';

/**
 * Creates an ioredis client with lazy connect and bounded reconnect backoff.
 */
export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    retryStrategy(times: number): number {
      return Math.min(times * 50, 2000);
    },
  });
}
