import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put, list } from '@vercel/blob';

export const config = { runtime: 'nodejs' };

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
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

  try {
    // Vercel auto-parses application/json bodies; fall back to raw text if needed.
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { shareId, screenId, anchor, author, text } = body;

    // Validate inputs
    if (!shareId || !/^[a-zA-Z0-9_-]{8,20}$/.test(shareId)) {
      res.status(400).json({ error: 'Invalid share ID' });
      return;
    }
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Missing comment text' });
      return;
    }
    if (text.length > 2000) {
      res.status(400).json({ error: 'Comment too long (max 2000 chars)' });
      return;
    }
    if (!author || typeof author !== 'string' || author.length > 100) {
      res.status(400).json({ error: 'Invalid author' });
      return;
    }

    // Verify share exists and isn't expired
    const metaBlobs = await list({ prefix: `shares/${shareId}/meta.json` });
    if (metaBlobs.blobs.length === 0) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }
    const metaRes = await fetch(metaBlobs.blobs[0].url);
    const meta = JSON.parse(await metaRes.text());

    // Check revocation first — parity with GET /api/share's ordering,
    // so callers get the accurate error code when a share was revoked.
    if (meta.revoked === true) {
      res.status(410).json({ error: 'revoked' });
      return;
    }

    if (new Date(meta.expiresAt) < new Date()) {
      res.status(410).json({ error: 'Share expired' });
      return;
    }

    // Check comment count (max 100)
    const existingComments = await list({ prefix: `shares/${shareId}/comments/` });
    if (existingComments.blobs.length >= 100) {
      res.status(429).json({ error: 'Max comments reached (100)' });
      return;
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

    res.status(200).json({ comment });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
