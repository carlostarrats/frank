// Using @upstash/redis directly rather than @vercel/kv — Vercel has moved
// KV to the Upstash Marketplace integration and @vercel/kv is deprecated.
// Same reasoning as the VIEWER_CAP comment in lib/limits.ts: anchor the
// choice in-code so nobody later "helpfully" swaps the wrapper back.
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export interface BufferedDiff {
  revision: number;
  type: 'state' | 'diff';
  payload: unknown;
  ts: number;           // Date.now() when the event was appended
}

const BUFFER_WINDOW_MS = Number(process.env.FRANK_DIFF_BUFFER_MS || 60_000);

// The buffer is a Redis list; each entry is a JSON-encoded BufferedDiff.
// `prune` drops entries older than the window before every append or read.
function key(shareId: string): string {
  return `share:${shareId}:diffs`;
}

async function prune(shareId: string): Promise<void> {
  const entries = (await redis.lrange<string>(key(shareId), 0, -1)) as string[];
  if (entries.length === 0) return;
  const cutoff = Date.now() - BUFFER_WINDOW_MS;
  const kept: string[] = [];
  for (const raw of entries) {
    try {
      const parsed = JSON.parse(raw) as BufferedDiff;
      if (parsed.ts >= cutoff) kept.push(raw);
    } catch { /* drop corrupt */ }
  }
  if (kept.length === entries.length) return;
  await redis.del(key(shareId));
  if (kept.length > 0) {
    await redis.rpush(key(shareId), ...kept);
  }
}

export async function appendDiff(shareId: string, entry: BufferedDiff): Promise<void> {
  await prune(shareId);
  await redis.rpush(key(shareId), JSON.stringify(entry));
  // One-hour TTL safety net in case of a share that goes cold.
  await redis.expire(key(shareId), 3600);
}

// Returns all diffs with revision > sinceRevision, in order. Empty if
// the requested revision is older than the oldest buffered entry.
export async function diffsSince(shareId: string, sinceRevision: number): Promise<BufferedDiff[] | 'buffer-miss'> {
  await prune(shareId);
  const entries = (await redis.lrange<string>(key(shareId), 0, -1)) as string[];
  if (entries.length === 0) return 'buffer-miss';
  const parsed: BufferedDiff[] = [];
  for (const raw of entries) {
    try { parsed.push(JSON.parse(raw) as BufferedDiff); } catch { /* skip */ }
  }
  parsed.sort((a, b) => a.revision - b.revision);
  if (parsed[0].revision > sinceRevision + 1) return 'buffer-miss';
  return parsed.filter((d) => d.revision > sinceRevision);
}

export async function deleteBuffer(shareId: string): Promise<void> {
  await redis.del(key(shareId));
}
