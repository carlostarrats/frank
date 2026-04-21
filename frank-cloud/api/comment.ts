import { put, list } from '@vercel/blob';

export const config = { runtime: 'edge' };

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { shareId, screenId, anchor, author, text } = body;

    // Validate inputs
    if (!shareId || !/^[a-zA-Z0-9_-]{8,20}$/.test(shareId)) {
      return Response.json({ error: 'Invalid share ID' }, { status: 400 });
    }
    if (!text || typeof text !== 'string') {
      return Response.json({ error: 'Missing comment text' }, { status: 400 });
    }
    if (text.length > 2000) {
      return Response.json({ error: 'Comment too long (max 2000 chars)' }, { status: 400 });
    }
    if (!author || typeof author !== 'string' || author.length > 100) {
      return Response.json({ error: 'Invalid author' }, { status: 400 });
    }

    // Verify share exists and isn't expired
    const metaBlobs = await list({ prefix: `shares/${shareId}/meta.json` });
    if (metaBlobs.blobs.length === 0) {
      return Response.json({ error: 'Share not found' }, { status: 404 });
    }
    const metaRes = await fetch(metaBlobs.blobs[0].url);
    const meta = JSON.parse(await metaRes.text());

    // Check revocation first — parity with GET /api/share's ordering,
    // so callers get the accurate error code when a share was revoked.
    if (meta.revoked === true) {
      return Response.json({ error: 'revoked' }, { status: 410 });
    }

    if (new Date(meta.expiresAt) < new Date()) {
      return Response.json({ error: 'Share expired' }, { status: 410 });
    }

    // Check comment count (max 100)
    const existingComments = await list({ prefix: `shares/${shareId}/comments/` });
    if (existingComments.blobs.length >= 100) {
      return Response.json({ error: 'Max comments reached (100)' }, { status: 429 });
    }

    // Create comment
    const commentId = 'c-' + Date.now() + '-' + randomHex(3);
    const comment = {
      id: commentId,
      shareId,
      screenId: screenId || 'default',
      anchor: anchor || { type: 'pin', x: 50, y: 50 },
      author: author.slice(0, 100),
      text: text.slice(0, 2000),
      ts: new Date().toISOString(),
    };

    await put(`shares/${shareId}/comments/${commentId}.json`, JSON.stringify(comment), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false, allowOverwrite: true,
    });

    // v3: also broadcast to all open streams for this share.
    try {
      const { publish } = await import('../lib/pubsub.js');
      await publish(shareId, 'comment', comment);
    } catch { /* broadcast is best-effort; persistence is what matters */ }

    return Response.json({ comment });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
