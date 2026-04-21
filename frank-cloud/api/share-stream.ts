import { list } from '@vercel/blob';
import { redisClient } from '../lib/redis.js';
import { tail, publish } from '../lib/pubsub.js';
import { diffsSince } from '../lib/diff-buffer.js';
import { peekRevision } from '../lib/revisions.js';
import { readOrCreateSessionToken, touchSession, countViewers, removeSession } from '../lib/session.js';
import { allowConnectFromIp, VIEWER_CAP } from '../lib/limits.js';

export const config = { runtime: 'edge' };

const redis = redisClient();

// Inline check: has the author's grace window elapsed without a reconnect?
// When a viewer connects or the long-poll loop ticks, we sweep the single
// deadline key for this share — no cron latency. Cron stays as backstop
// for shares with no viewer activity at all.
async function maybeFireAuthorOffline(shareId: string): Promise<void> {
  const deadline = await redis.get<number>(`share:${shareId}:authorOfflineAt`);
  if (deadline && deadline <= Date.now()) {
    const deleted = await redis.del(`share:${shareId}:authorOfflineAt`);
    if (deleted) {
      // Only one concurrent connection wins the DEL; that one broadcasts.
      await redis.del(`share:${shareId}:author`);
      await publish(shareId, 'author-status', { status: 'offline' });
    }
  }
}

function extractShareId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/share\/([a-zA-Z0-9_-]{8,20})\/stream\/?$/);
  return m ? m[1] : null;
}

function sseLine(id: number | string, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const url = new URL(req.url);
  const shareId = extractShareId(url.pathname);
  if (!shareId) return Response.json({ error: 'Invalid share ID' }, { status: 400 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  if (!(await allowConnectFromIp(ip))) {
    return new Response('Rate limit exceeded', { status: 429 });
  }

  // Session dedup + viewer cap.
  const { token, setCookie } = readOrCreateSessionToken(req);
  const viewersBefore = await countViewers(shareId);
  if (viewersBefore >= VIEWER_CAP) {
    return new Response(
      JSON.stringify({ error: 'viewer-cap', cap: VIEWER_CAP }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Share must exist and be live.
  const snapshotRaw = await fetchBlob(`shares/${shareId}/snapshot.json`);
  const metaRaw = await fetchBlob(`shares/${shareId}/meta.json`);
  if (!metaRaw) return Response.json({ error: 'not found' }, { status: 404 });
  const meta = JSON.parse(metaRaw);
  if (meta.revoked === true) return Response.json({ error: 'revoked' }, { status: 410 });
  if (new Date(meta.expiresAt) < new Date()) {
    return Response.json({ error: 'expired' }, { status: 410 });
  }

  const lastEventIdHeader = req.headers.get('last-event-id');
  const lastAppliedRevision = lastEventIdHeader ? Number(lastEventIdHeader) : -1;

  // Build the opening event(s) before we start streaming.
  const currentRevision = await peekRevision(shareId);
  const openingEvents: string[] = [];

  if (lastAppliedRevision < 0) {
    // Cold open — send full state.
    if (snapshotRaw) {
      const snap = JSON.parse(snapshotRaw);
      openingEvents.push(sseLine(snap.revision, 'state', {
        revision: snap.revision,
        contentType: snap.contentType || meta.contentType,
        payload: snap.payload,
      }));
    }
  } else if (lastAppliedRevision === currentRevision) {
    openingEvents.push(sseLine(currentRevision, 'author-status', { status: 'online' }));
  } else {
    const replay = await diffsSince(shareId, lastAppliedRevision);
    if (replay === 'buffer-miss' && snapshotRaw) {
      const snap = JSON.parse(snapshotRaw);
      openingEvents.push(sseLine(snap.revision, 'state', {
        revision: snap.revision,
        contentType: snap.contentType || meta.contentType,
        payload: snap.payload,
      }));
    } else if (Array.isArray(replay)) {
      for (const d of replay) {
        openingEvents.push(sseLine(d.revision, d.type, {
          revision: d.revision,
          payload: d.payload,
        }));
      }
    }
  }

  // Mark session + broadcast presence change (if new).
  await touchSession(shareId, token);
  const viewersAfter = await countViewers(shareId);
  if (viewersAfter !== viewersBefore) {
    await publish(shareId, 'presence', { viewers: viewersAfter });
  }

  // Inline author-offline sweep: piggyback on connect so Hobby users see
  // offline status within ~15s of the author leaving, not 15s + cron tick.
  await maybeFireAuthorOffline(shareId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      for (const line of openingEvents) controller.enqueue(encoder.encode(line));

      // Tell the browser to retry after 1s on disconnect.
      controller.enqueue(encoder.encode('retry: 1000\n\n'));

      let lastEventId = 0;
      let alive = true;

      req.signal.addEventListener('abort', async () => {
        alive = false;
        try {
          await removeSession(shareId, token);
          const viewersNow = await countViewers(shareId);
          await publish(shareId, 'presence', { viewers: viewersNow });
        } catch { /* best effort */ }
        try { controller.close(); } catch { /* already closed */ }
      });

      // Long-poll loop.
      while (alive) {
        const events = await tail(shareId, lastEventId, 8_000);
        if (!alive) break;
        for (const ev of events) {
          lastEventId = ev.id;
          const revision = (ev.data as { revision?: number })?.revision;
          const idHeader = revision ?? ev.id;
          controller.enqueue(encoder.encode(sseLine(idHeader, ev.kind, ev.data)));
          if (ev.kind === 'share-ended') {
            alive = false;
          }
        }
        if (events.length === 0) controller.enqueue(encoder.encode(': keep-alive\n\n'));
        // Refresh the session TTL while the connection stays up + sweep
        // the author-offline deadline opportunistically.
        await touchSession(shareId, token);
        await maybeFireAuthorOffline(shareId);
      }
      try { controller.close(); } catch { /* already closed */ }
    },
  });

  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
  if (setCookie) headers['Set-Cookie'] = setCookie;

  return new Response(stream, { status: 200, headers });
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
