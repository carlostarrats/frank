import { Redis } from '@upstash/redis';

/**
 * Return a Redis client reading config from either naming scheme.
 *
 * Precedence: KV_REST_API_* first because Vercel's Upstash Marketplace
 * integration sets those names automatically when a store is linked to
 * a project. UPSTASH_REDIS_REST_* is the fallback for non-Vercel
 * deployments or direct-from-Upstash setups (what the @upstash/redis
 * docs show). Both should point to the same store; the precedence
 * only matters if a user has both set during a migration.
 */
export function redisClient(): Redis {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      'Missing Redis env vars — set KV_REST_API_URL+KV_REST_API_TOKEN (Vercel Marketplace) or UPSTASH_REDIS_REST_URL+UPSTASH_REDIS_REST_TOKEN (direct Upstash).',
    );
  }
  return new Redis({ url, token });
}
