// Upstash Redis supports PUBLISH but not long-lived SUBSCRIBE
// from inside a serverless function. For broadcast we use a "polling" tail:
// listeners long-poll a list + its last-id offset. This is simpler and
// avoids needing a Redis connection kept open outside the function lifetime.
//
// Producers call `publish(shareId, event)`. Listeners call `tail(shareId, lastId)`
// which returns any events newer than lastId and blocks up to `timeoutMs` for
// at least one new event.
//
// Using @upstash/redis directly rather than @vercel/kv — Vercel has moved
// KV to the Upstash Marketplace integration and @vercel/kv is deprecated.
// Same reasoning as the VIEWER_CAP comment in lib/limits.ts: anchor the
// choice in-code so nobody later "helpfully" swaps the wrapper back.
import { redisClient } from './redis.js';

const redis = redisClient();

export interface ChannelEvent {
  id: number;
  kind: 'state' | 'diff' | 'comment' | 'presence' | 'author-status' | 'share-ended';
  data: unknown;
}

function listKey(shareId: string): string {
  return `share:${shareId}:events`;
}
function counterKey(shareId: string): string {
  return `share:${shareId}:eventCounter`;
}

const EVENT_TTL_SEC = 120; // events are transient; we only care about recent ones

// Hard cap on the list's length. At 15 events/sec sustained the 60s rolling
// window is ~900 entries; 2000 gives headroom for bursts + occasional slow
// consumers without letting storage grow unbounded on very long sessions.
const EVENT_LIST_MAX = Number(process.env.FRANK_EVENT_LIST_MAX || 2000);

export async function publish(shareId: string, kind: ChannelEvent['kind'], data: unknown): Promise<number> {
  const id = (await redis.incr(counterKey(shareId))) as number;
  const ev: ChannelEvent = { id, kind, data };
  await redis.rpush(listKey(shareId), JSON.stringify(ev));
  // Keep only the trailing EVENT_LIST_MAX entries. LTRIM is O(N) but N is
  // bounded by the cap itself, so this is cheap in steady state.
  await redis.ltrim(listKey(shareId), -EVENT_LIST_MAX, -1);
  await redis.expire(listKey(shareId), EVENT_TTL_SEC);
  await redis.expire(counterKey(shareId), EVENT_TTL_SEC);
  return id;
}

// Long-poll: return any events with id > lastId. If none, wait in 500ms
// increments up to timeoutMs. Returns whatever landed (possibly empty).
export async function tail(
  shareId: string,
  lastId: number,
  timeoutMs = 8000,
): Promise<ChannelEvent[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = (await redis.lrange<string>(listKey(shareId), 0, -1)) as string[];
    const parsed: ChannelEvent[] = [];
    for (const s of raw) {
      try {
        const ev = JSON.parse(s) as ChannelEvent;
        if (ev.id > lastId) parsed.push(ev);
      } catch { /* skip */ }
    }
    if (parsed.length > 0) {
      parsed.sort((a, b) => a.id - b.id);
      return parsed;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return [];
}

export async function deleteChannel(shareId: string): Promise<void> {
  await redis.del(listKey(shareId));
  await redis.del(counterKey(shareId));
}
