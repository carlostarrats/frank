import { put, list } from '@vercel/blob';
import crypto from 'crypto';

export const config = { runtime: 'nodejs' };

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

    if (new Date(meta.expiresAt) < new Date()) {
      return Response.json({ error: 'Share expired' }, { status: 410 });
    }

    // Check comment count (max 100)
    const existingComments = await list({ prefix: `shares/${shareId}/comments/` });
    if (existingComments.blobs.length >= 100) {
      return Response.json({ error: 'Max comments reached (100)' }, { status: 429 });
    }

    // Create comment
    const commentId = 'c-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
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
      addRandomSuffix: false,
    });

    return Response.json({ comment });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
