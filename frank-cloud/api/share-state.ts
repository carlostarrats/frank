import { put, list } from '@vercel/blob';
import { nextRevision, peekRevision } from '../lib/revisions.js';
import { appendDiff } from '../lib/diff-buffer.js';
import { publish } from '../lib/pubsub.js';

export const config = { runtime: 'edge' };

const MAX_PAYLOAD_BYTES = Number(process.env.FRANK_STATE_MAX_BYTES || 1_048_576); // 1 MB

function extractShareId(pathname: string): string | null {
  // Expect: /api/share/<id>/state
  const m = pathname.match(/^\/api\/share\/([a-zA-Z0-9_-]{8,20})\/state\/?$/);
  return m ? m[1] : null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (apiKey !== process.env.FRANK_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const shareId = extractShareId(url.pathname);
  if (!shareId) return Response.json({ error: 'Invalid share ID' }, { status: 400 });

  // Share must exist and not be expired/revoked.
  const metaBlob = await fetchBlob(`shares/${shareId}/meta.json`);
  if (!metaBlob) return Response.json({ error: 'not found' }, { status: 404 });
  const meta = JSON.parse(metaBlob);
  if (meta.revoked === true) return Response.json({ error: 'revoked' }, { status: 410 });
  if (new Date(meta.expiresAt) < new Date()) {
    return Response.json({ error: 'expired' }, { status: 410 });
  }

  let body: { revision?: number; type?: string; payload?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { revision: clientRevision, type, payload } = body;
  if (type !== 'state' && type !== 'diff') {
    return Response.json({ error: 'Invalid type' }, { status: 400 });
  }
  if (typeof clientRevision !== 'number' || !Number.isFinite(clientRevision)) {
    return Response.json({ error: 'Invalid revision' }, { status: 400 });
  }

  const encoded = JSON.stringify(payload);
  if (encoded.length > MAX_PAYLOAD_BYTES) {
    return Response.json({ error: 'payload-too-large', max: MAX_PAYLOAD_BYTES }, { status: 413 });
  }

  // Backend revision wins per the direction doc. If the client's revision is
  // BEHIND what we already stored, reject with the current so the daemon can
  // fast-forward. Otherwise allocate the next monotonic revision.
  const current = await peekRevision(shareId);
  if (clientRevision <= current) {
    return Response.json({ error: 'revision-behind', currentRevision: current }, { status: 409 });
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

  return Response.json({ acceptedRevision: assigned });
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
