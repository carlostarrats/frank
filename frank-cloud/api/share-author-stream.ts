import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redisClient } from '../lib/redis.js';
import { list } from '@vercel/blob';
import { tail, publish } from '../lib/pubsub.js';

export const config = { runtime: 'nodejs', maxDuration: 300 };

const redis = redisClient();
const GRACE_MS = Number(process.env.FRANK_AUTHOR_GRACE_MS || 15_000);

function extractShareId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/share\/([a-zA-Z0-9_-]{8,64})\/author-stream\/?$/);
  return m ? m[1] : null;
}

function sseLine(id: number | string, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

async function markAuthorOnline(shareId: string): Promise<void> {
  const was = await redis.get<string>(`share:${shareId}:author`);
  await redis.set(`share:${shareId}:author`, 'online', { ex: 60 });
  if (was !== 'online') {
    await publish(shareId, 'author-status', { status: 'online' });
  }
  // Cancel any pending offline timer.
  await redis.del(`share:${shareId}:authorOfflineAt`);
}

async function scheduleAuthorOffline(shareId: string): Promise<void> {
  // Write an "offline-at" timestamp in the future. The inline sweep in
  // share-stream.ts fires the broadcast when a viewer sees it's elapsed;
  // tick.ts is the cron backstop for empty shares.
  await redis.set(
    `share:${shareId}:authorOfflineAt`,
    Date.now() + GRACE_MS,
    { ex: 300 },
  );
}

async function fetchBlob(key: string): Promise<string | null> {
  try {
    const blobs = await list({ prefix: key });
    if (blobs.blobs.length === 0) return null;
    const r = await fetch(blobs.blobs[0].url);
    return await r.text();
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const apiKey = headerString(req.headers['authorization'])?.replace('Bearer ', '');
  if (apiKey !== process.env.FRANK_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const url = new URL(req.url || '', 'http://x');
  const shareId = extractShareId(url.pathname);
  if (!shareId) {
    res.status(400).json({ error: 'Invalid share ID' });
    return;
  }

  const metaBlob = await fetchBlob(`shares/${shareId}/meta.json`);
  if (!metaBlob) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const meta = JSON.parse(metaBlob);
  if (meta.revoked === true) {
    res.status(410).json({ error: 'revoked' });
    return;
  }
  if (new Date(meta.expiresAt) < new Date()) {
    res.status(410).json({ error: 'expired' });
    return;
  }

  await markAuthorOnline(shareId);

  // SSE headers — flushed immediately so clients know the stream opened.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1000\n\n');

  let alive = true;
  let lastEventId = 0;

  // Client disconnect handling — Node's http close event fires when the
  // socket goes away (browser tab closed, network drop, etc.).
  req.on('close', () => {
    alive = false;
    // Best-effort: schedule offline deadline. We can't await here because
    // the request is already done; fire-and-forget.
    scheduleAuthorOffline(shareId).catch(() => { /* swallow */ });
  });

  try {
    while (alive) {
      const events = await tail(shareId, lastEventId, 8_000);
      if (!alive) break;
      for (const ev of events) {
        lastEventId = ev.id;
        if (ev.kind === 'comment' || ev.kind === 'presence' || ev.kind === 'share-ended') {
          res.write(sseLine(ev.id, ev.kind, ev.data));
        }
        if (ev.kind === 'share-ended') alive = false;
      }
      if (events.length === 0) res.write(': keep-alive\n\n');
      // Refresh online TTL while the connection is up.
      await redis.set(`share:${shareId}:author`, 'online', { ex: 60 });
    }
  } finally {
    try { res.end(); } catch { /* already ended */ }
  }
}
