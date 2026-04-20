// Using @upstash/redis directly rather than @vercel/kv — Vercel has moved
// KV to the Upstash Marketplace integration and @vercel/kv is deprecated.
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// Intentional override of v3 direction doc's 50-default to keep Upstash Redis
// free-tier cost bounded for small users. Env-overridable via FRANK_VIEWER_CAP.
// Future-you will thank present-you.
export const VIEWER_CAP = Number(process.env.FRANK_VIEWER_CAP || 10);
const IP_BUCKET_WINDOW_SEC = 60;
const IP_BUCKET_MAX = Number(process.env.FRANK_IP_RATE_PER_MIN || 120);

export async function allowConnectFromIp(ip: string): Promise<boolean> {
  const k = `ip:${ip}:connect`;
  const hits = (await redis.incr(k)) as number;
  if (hits === 1) await redis.expire(k, IP_BUCKET_WINDOW_SEC);
  return hits <= IP_BUCKET_MAX;
}
