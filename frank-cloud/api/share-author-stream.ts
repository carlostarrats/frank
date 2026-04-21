import { redisClient } from '../lib/redis.js';
import { list } from '@vercel/blob';
import { tail, publish } from '../lib/pubsub.js';

export const config = { runtime: 'edge' };

const redis = redisClient();
const GRACE_MS = Number(process.env.FRANK_AUTHOR_GRACE_MS || 15_000);

function extractShareId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/share\/([a-zA-Z0-9_-]{8,20})\/author-stream\/?$/);
  return m ? m[1] : null;
}

function sseLine(id: number | string, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }
  const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (apiKey !== process.env.FRANK_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const shareId = extractShareId(url.pathname);
  if (!shareId) return Response.json({ error: 'Invalid share ID' }, { status: 400 });

  const metaBlob = await fetchBlob(`shares/${shareId}/meta.json`);
  if (!metaBlob) return Response.json({ error: 'not found' }, { status: 404 });
  const meta = JSON.parse(metaBlob);
  if (meta.revoked === true) return Response.json({ error: 'revoked' }, { status: 410 });
  if (new Date(meta.expiresAt) < new Date()) {
    return Response.json({ error: 'expired' }, { status: 410 });
  }

  await markAuthorOnline(shareId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('retry: 1000\n\n'));

      let alive = true;
      let lastEventId = 0;

      req.signal.addEventListener('abort', async () => {
        alive = false;
        try { await scheduleAuthorOffline(shareId); controller.close(); } catch { /* already closed */ }
      });

      while (alive) {
        const events = await tail(shareId, lastEventId, 8_000);
        if (!alive) break;
        for (const ev of events) {
          lastEventId = ev.id;
          if (ev.kind === 'comment' || ev.kind === 'presence' || ev.kind === 'share-ended') {
            controller.enqueue(encoder.encode(sseLine(ev.id, ev.kind, ev.data)));
          }
          if (ev.kind === 'share-ended') alive = false;
        }
        if (events.length === 0) controller.enqueue(encoder.encode(': keep-alive\n\n'));
        // Refresh online TTL while the connection is up.
        await redis.set(`share:${shareId}:author`, 'online', { ex: 60 });
      }
      try { controller.close(); } catch { /* already closed */ }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function fetchBlob(key: string): Promise<string | null> {
  try {
    const blobs = await list({ prefix: key });
    if (blobs.blobs.length === 0) return null;
    const res = await fetch(blobs.blobs[0].url);
    return await res.text();
  } catch {
    return null;
  }
}
