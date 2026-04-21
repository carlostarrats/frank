import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list } from '@vercel/blob';
import { redisClient } from '../lib/redis.js';
import { tail, publish } from '../lib/pubsub.js';
import { diffsSince } from '../lib/diff-buffer.js';
import { peekRevision } from '../lib/revisions.js';
import { readOrCreateSessionToken, touchSession, countViewers, removeSession } from '../lib/session.js';
import { allowConnectFromIp, VIEWER_CAP } from '../lib/limits.js';

export const config = { runtime: 'nodejs', maxDuration: 300 };

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

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
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

  const url = new URL(req.url || '', 'http://x');
  const shareId = extractShareId(url.pathname);
  if (!shareId) {
    res.status(400).json({ error: 'Invalid share ID' });
    return;
  }

  const ip = headerString(req.headers['x-forwarded-for'])?.split(',')[0].trim() || 'unknown';
  if (!(await allowConnectFromIp(ip))) {
    res.status(429).send('Rate limit exceeded');
    return;
  }

  // Session dedup + viewer cap.
  const { token, setCookie } = readOrCreateSessionToken(
    headerString(req.headers['x-frank-session']),
    headerString(req.headers['cookie']),
  );
  const viewersBefore = await countViewers(shareId);
  if (viewersBefore >= VIEWER_CAP) {
    res.status(429).json({ error: 'viewer-cap', cap: VIEWER_CAP });
    return;
  }

  // Share must exist and be live.
  const snapshotRaw = await fetchBlob(`shares/${shareId}/snapshot.json`);
  const metaRaw = await fetchBlob(`shares/${shareId}/meta.json`);
  if (!metaRaw) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const meta = JSON.parse(metaRaw);
  if (meta.revoked === true) {
    res.status(410).json({ error: 'revoked' });
    return;
  }
  if (new Date(meta.expiresAt) < new Date()) {
    res.status(410).json({ error: 'expired' });
    return;
  }

  const lastEventIdHeader = headerString(req.headers['last-event-id']);
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

  // SSE response headers. Write the opening events + retry hint.
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  res.writeHead(200, headers);

  for (const line of openingEvents) res.write(line);
  res.write('retry: 1000\n\n');

  let lastEventId = 0;
  let alive = true;

  // Client disconnect: remove session, broadcast presence decrement.
  // Fire-and-forget because the request is already finishing.
  req.on('close', () => {
    alive = false;
    (async () => {
      try {
        await removeSession(shareId, token);
        const viewersNow = await countViewers(shareId);
        await publish(shareId, 'presence', { viewers: viewersNow });
      } catch { /* best effort */ }
    })();
  });

  try {
    while (alive) {
      const events = await tail(shareId, lastEventId, 8_000);
      if (!alive) break;
      for (const ev of events) {
        lastEventId = ev.id;
        const revision = (ev.data as { revision?: number })?.revision;
        const idHeader = revision ?? ev.id;
        res.write(sseLine(idHeader, ev.kind, ev.data));
        if (ev.kind === 'share-ended') {
          alive = false;
        }
      }
      if (events.length === 0) res.write(': keep-alive\n\n');
      // Refresh the session TTL while the connection stays up + sweep
      // the author-offline deadline opportunistically.
      await touchSession(shareId, token);
      await maybeFireAuthorOffline(shareId);
    }
  } finally {
    try { res.end(); } catch { /* already ended */ }
  }
}
