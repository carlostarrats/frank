// Using @upstash/redis directly rather than @vercel/kv — Vercel has moved
// KV to the Upstash Marketplace integration and @vercel/kv is deprecated.
// Same reasoning as the VIEWER_CAP comment in lib/limits.ts: anchor the
// choice in-code so nobody later "helpfully" swaps the wrapper back.
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// Per-share revision counter. INCR is atomic in Redis, which gives us the
// monotonic guarantee the direction doc requires.
export async function nextRevision(shareId: string): Promise<number> {
  const rev = await redis.incr(`share:${shareId}:revision`);
  return rev as number;
}

export async function peekRevision(shareId: string): Promise<number> {
  const rev = (await redis.get<number>(`share:${shareId}:revision`)) ?? 0;
  return rev;
}

// On revocation: wipe the counter along with everything else for the share.
export async function deleteRevision(shareId: string): Promise<void> {
  await redis.del(`share:${shareId}:revision`);
}
