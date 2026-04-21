import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put, list } from '@vercel/blob';

export const config = { runtime: 'nodejs' };

function generateId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 12);
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

  // GET /api/share?id=xxx — public (reviewers)
  if (req.method === 'GET') {
    const shareId = typeof req.query.id === 'string' ? req.query.id : undefined;
    if (!shareId || !/^[a-zA-Z0-9_-]{8,20}$/.test(shareId)) {
      res.status(400).json({ error: 'Invalid share ID' });
      return;
    }

    try {
      // Fetch meta
      const metaBlob = await fetchBlob(`shares/${shareId}/meta.json`);
      if (!metaBlob) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      const meta = JSON.parse(metaBlob);

      // Check revocation first — DELETE sets both revoked:true AND
      // expiresAt=epoch, so without this the expiry branch fires with
      // the misleading 'expired' error message.
      if (meta.revoked === true) {
        res.status(410).json({ error: 'revoked' });
        return;
      }

      // Check expiry
      if (new Date(meta.expiresAt) < new Date()) {
        res.status(410).json({
          error: 'expired',
          message: 'This has been updated. Ask the owner for the new link.',
        });
        return;
      }

      // Fetch snapshot
      const snapshotBlob = await fetchBlob(`shares/${shareId}/snapshot.json`);
      const snapshot = snapshotBlob ? JSON.parse(snapshotBlob) : null;

      // Fetch comments
      const commentBlobs = await list({ prefix: `shares/${shareId}/comments/` });
      const comments: unknown[] = [];
      for (const blob of commentBlobs.blobs) {
        try {
          const r = await fetch(blob.url);
          comments.push(JSON.parse(await r.text()));
        } catch { /* skip corrupt */ }
      }

      // Log view
      meta.viewCount = (meta.viewCount || 0) + 1;
      meta.lastViewedAt = new Date().toISOString();
      await put(`shares/${shareId}/meta.json`, JSON.stringify(meta), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false, allowOverwrite: true,
      });

      res.status(200).json({
        snapshot,
        comments: (comments as { ts: string }[]).sort((a, b) => a.ts.localeCompare(b.ts)),
        coverNote: meta.coverNote || '',
        metadata: {
          createdAt: meta.createdAt,
          expiresAt: meta.expiresAt,
          viewCount: meta.viewCount,
          contentType: meta.contentType || 'url',
        },
      });
      return;
    } catch (e: any) {
      res.status(500).json({ error: e.message });
      return;
    }
  }

  // POST /api/share — authenticated (daemon)
  if (req.method === 'POST') {
    const apiKey = headerString(req.headers['authorization'])?.replace('Bearer ', '');
    if (apiKey !== process.env.FRANK_API_KEY) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const { snapshot, coverNote, contentType, expiryDays, oldShareId, oldRevokeToken } = body;

      if (!snapshot) {
        res.status(400).json({ error: 'Missing snapshot' });
        return;
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
                addRandomSuffix: false, allowOverwrite: true,
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
        addRandomSuffix: false, allowOverwrite: true,
      });

      // Upload snapshot
      await put(`shares/${shareId}/snapshot.json`, JSON.stringify(snapshot), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false, allowOverwrite: true,
      });

      res.status(200).json({
        shareId,
        revokeToken,
        url: `/s/${shareId}`,
      });
      return;
    } catch (e: any) {
      res.status(500).json({ error: e.message });
      return;
    }
  }

  // DELETE /api/share?id=xxx — authenticated, revokes + tears down.
  if (req.method === 'DELETE') {
    const apiKey = headerString(req.headers['authorization'])?.replace('Bearer ', '');
    if (apiKey !== process.env.FRANK_API_KEY) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const shareId = typeof req.query.id === 'string' ? req.query.id : undefined;
    if (!shareId || !/^[a-zA-Z0-9_-]{8,20}$/.test(shareId)) {
      res.status(400).json({ error: 'Invalid share ID' });
      return;
    }
    const revokeToken = headerString(req.headers['x-frank-revoke-token']) || '';

    try {
      const metaBlob = await fetchBlob(`shares/${shareId}/meta.json`);
      if (!metaBlob) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      const meta = JSON.parse(metaBlob);
      if (meta.revokeToken !== revokeToken) {
        res.status(403).json({ error: 'Invalid revoke token' });
        return;
      }

      // 1. Invalidate — flip the meta flag + expire so new requests see 410.
      meta.revoked = true;
      meta.expiresAt = new Date(0).toISOString();
      await put(`shares/${shareId}/meta.json`, JSON.stringify(meta), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false, allowOverwrite: true,
      });

      // 2. Close streams via broadcast.
      const { publish, deleteChannel } = await import('../lib/pubsub.js');
      await publish(shareId, 'share-ended', { reason: 'revoked' });
      // Give streams a moment to flush.
      await new Promise((r) => setTimeout(r, 500));
      await deleteChannel(shareId);

      // 3. Delete stored artifacts.
      const { deleteRevision } = await import('../lib/revisions.js');
      const { deleteBuffer } = await import('../lib/diff-buffer.js');
      await deleteRevision(shareId);
      await deleteBuffer(shareId);
      // Blob cleanup: prefix-delete everything EXCEPT meta.json. The meta
      // blob stays as the revocation tombstone so GET / comment / ping
      // can return 410 with error:'revoked' — deleting it would collapse
      // that path to a 404 and clients can't distinguish "never existed"
      // from "was revoked."
      try {
        const { del } = await import('@vercel/blob');
        const listed = await list({ prefix: `shares/${shareId}/` });
        for (const b of listed.blobs) {
          if (b.pathname === `shares/${shareId}/meta.json`) continue;
          await del(b.url);
        }
      } catch { /* best effort */ }

      res.status(200).json({ ok: true });
      return;
    } catch (e: any) {
      res.status(500).json({ error: e.message });
      return;
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
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
