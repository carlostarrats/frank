// Using @upstash/redis directly rather than @vercel/kv — Vercel has moved
// KV to the Upstash Marketplace integration and @vercel/kv is deprecated.
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// A viewer session is counted once, even across tabs. We track it by an
// opaque token placed in a cookie (or supplied as X-Frank-Session). Each
// unique token contributes one "seat". Heartbeats refresh the TTL; when the
// TTL expires the viewer is considered gone.
const SESSION_TTL_SEC = Number(process.env.FRANK_SESSION_TTL || 90);

export function readOrCreateSessionToken(req: Request): { token: string; setCookie: string | null } {
  const hdr = req.headers.get('x-frank-session');
  if (hdr && /^[a-zA-Z0-9_-]{16,64}$/.test(hdr)) return { token: hdr, setCookie: null };
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/frank_session=([a-zA-Z0-9_-]{16,64})/);
  if (m) return { token: m[1], setCookie: null };
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let str = '';
  for (const b of buf) str += String.fromCharCode(b);
  const token = btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const setCookie = `frank_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC * 10}`;
  return { token, setCookie };
}

function key(shareId: string): string { return `share:${shareId}:sessions`; }

export async function touchSession(shareId: string, token: string): Promise<void> {
  // Store token in a sorted set scored by expiry timestamp. Pruning on read.
  const expireAt = Date.now() + SESSION_TTL_SEC * 1000;
  await redis.zadd(key(shareId), { score: expireAt, member: token });
  await redis.expire(key(shareId), SESSION_TTL_SEC * 4);
}

export async function removeSession(shareId: string, token: string): Promise<void> {
  await redis.zrem(key(shareId), token);
}

export async function countViewers(shareId: string): Promise<number> {
  const now = Date.now();
  await redis.zremrangebyscore(key(shareId), 0, now);
  const count = (await redis.zcard(key(shareId))) as number;
  return count ?? 0;
}
