import { put, list } from '@vercel/blob';
import crypto from 'crypto';

export const config = { runtime: 'nodejs', maxDuration: 30 };

function generateId(): string {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  // GET /api/share?id=xxx — public (reviewers)
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const shareId = url.searchParams.get('id');
    if (!shareId || !/^[a-zA-Z0-9_-]{8,20}$/.test(shareId)) {
      return Response.json({ error: 'Invalid share ID' }, { status: 400 });
    }

    try {
      // Fetch meta
      const metaBlob = await fetchBlob(`shares/${shareId}/meta.json`);
      if (!metaBlob) {
        return Response.json({ error: 'not found' }, { status: 404 });
      }
      const meta = JSON.parse(metaBlob);

      // Check expiry
      if (new Date(meta.expiresAt) < new Date()) {
        return Response.json({
          error: 'expired',
          message: 'This has been updated. Ask the owner for the new link.',
        }, { status: 410 });
      }

      // Fetch snapshot
      const snapshotBlob = await fetchBlob(`shares/${shareId}/snapshot.json`);
      const snapshot = snapshotBlob ? JSON.parse(snapshotBlob) : null;

      // Fetch comments
      const commentBlobs = await list({ prefix: `shares/${shareId}/comments/` });
      const comments = [];
      for (const blob of commentBlobs.blobs) {
        try {
          const res = await fetch(blob.url);
          comments.push(JSON.parse(await res.text()));
        } catch { /* skip corrupt */ }
      }

      // Log view
      meta.viewCount = (meta.viewCount || 0) + 1;
      meta.lastViewedAt = new Date().toISOString();
      await put(`shares/${shareId}/meta.json`, JSON.stringify(meta), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });

      return Response.json({
        snapshot,
        comments: comments.sort((a: any, b: any) => a.ts.localeCompare(b.ts)),
        coverNote: meta.coverNote || '',
        metadata: {
          createdAt: meta.createdAt,
          expiresAt: meta.expiresAt,
          viewCount: meta.viewCount,
          contentType: meta.contentType || 'url',
        },
      });
    } catch (e: any) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // POST /api/share — authenticated (daemon)
  if (req.method === 'POST') {
    const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (apiKey !== process.env.FRANK_API_KEY) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const body = await req.json();
      const { snapshot, coverNote, contentType, expiryDays, oldShareId, oldRevokeToken } = body;

      if (!snapshot) {
        return Response.json({ error: 'Missing snapshot' }, { status: 400 });
      }

      // Revoke old share if provided
      if (oldShareId && oldRevokeToken) {
        try {
          const oldMetaBlob = await fetchBlob(`shares/${oldShareId}/meta.json`);
          if (oldMetaBlob) {
            const oldMeta = JSON.parse(oldMetaBlob);
            if (oldMeta.revokeToken === oldRevokeToken) {
              oldMeta.expiresAt = new Date(0).toISOString(); // Expire immediately
              await put(`shares/${oldShareId}/meta.json`, JSON.stringify(oldMeta), {
                access: 'public',
                contentType: 'application/json',
                addRandomSuffix: false,
              });
            }
          }
        } catch { /* old share cleanup is best-effort */ }
      }

      const shareId = generateId();
      const revokeToken = generateId();
      const now = new Date();
      const days = expiryDays || 7;

      const meta = {
        shareId,
        revokeToken,
        coverNote: coverNote || '',
        contentType: contentType || 'url',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
        viewCount: 0,
      };

      // Upload meta
      await put(`shares/${shareId}/meta.json`, JSON.stringify(meta), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });

      // Upload snapshot
      await put(`shares/${shareId}/snapshot.json`, JSON.stringify(snapshot), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });

      return Response.json({
        shareId,
        revokeToken,
        url: `/s/${shareId}`,
      });
    } catch (e: any) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
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
