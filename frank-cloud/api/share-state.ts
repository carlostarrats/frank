import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put, list } from '@vercel/blob';
import { nextRevision, peekRevision } from '../lib/revisions.js';
import { appendDiff } from '../lib/diff-buffer.js';
import { publish } from '../lib/pubsub.js';

export const config = { runtime: 'nodejs' };

const MAX_PAYLOAD_BYTES = Number(process.env.FRANK_STATE_MAX_BYTES || 1_048_576); // 1 MB

function extractShareId(pathname: string): string | null {
  // Expect: /api/share/<id>/state
  const m = pathname.match(/^\/api\/share\/([a-zA-Z0-9_-]{8,64})\/state\/?$/);
  return m ? m[1] : null;
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
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

  // Share must exist and not be expired/revoked.
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

  let body: { revision?: number; type?: string; payload?: unknown };
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  const { revision: clientRevision, type, payload } = body;
  if (type !== 'state' && type !== 'diff') {
    res.status(400).json({ error: 'Invalid type' });
    return;
  }
  if (typeof clientRevision !== 'number' || !Number.isFinite(clientRevision)) {
    res.status(400).json({ error: 'Invalid revision' });
    return;
  }

  const encoded = JSON.stringify(payload);
  if (encoded.length > MAX_PAYLOAD_BYTES) {
    res.status(413).json({ error: 'payload-too-large', max: MAX_PAYLOAD_BYTES });
    return;
  }

  // Backend revision wins per the direction doc. If the client's revision is
  // BEHIND what we already stored, reject with the current so the daemon can
  // fast-forward. Otherwise allocate the next monotonic revision.
  const current = await peekRevision(shareId);
  if (clientRevision <= current) {
    res.status(409).json({ error: 'revision-behind', currentRevision: current });
    return;
  }

  const assigned = await nextRevision(shareId);

  // For `state` events, replace the stored snapshot. For `diff`, leave the
  // snapshot alone and just buffer. The store-then-buffer-then-publish order
  // matters: viewers connecting during this call must never see a revision
  // that's only in the broadcast but not in the snapshot/buffer.
  if (type === 'state') {
    await put(
      `shares/${shareId}/snapshot.json`,
      JSON.stringify({ revision: assigned, contentType: meta.contentType, payload }),
      { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true },
    );
  }

  await appendDiff(shareId, {
    revision: assigned,
    type,
    payload,
    ts: Date.now(),
  });

  await publish(shareId, type, { revision: assigned, contentType: meta.contentType, payload });

  res.status(200).json({ acceptedRevision: assigned });
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
