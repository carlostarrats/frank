import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list } from '@vercel/blob';
import { readOrCreateSessionToken, touchSession, countViewers } from '../lib/session.js';
import { publish } from '../lib/pubsub.js';

export const config = { runtime: 'nodejs' };

async function fetchMeta(shareId: string): Promise<{ revoked?: boolean; expiresAt: string } | null> {
  const blobs = await list({ prefix: `shares/${shareId}/meta.json` });
  if (blobs.blobs.length === 0) return null;
  const res = await fetch(blobs.blobs[0].url);
  return JSON.parse(await res.text());
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  // req.url is a path + query on Vercel's Node runtime; anchor it so URL parses.
  const url = new URL(req.url || '', 'http://x');
  const m = url.pathname.match(/^\/api\/share\/([a-zA-Z0-9_-]{8,64})\/ping\/?$/);
  if (!m) {
    res.status(400).json({ error: 'Invalid share ID' });
    return;
  }
  const shareId = m[1];

  // Reject pings for non-existent or revoked shares so Redis doesn't
  // track sessions for garbage ids. Mirrors share-stream.ts guards.
  const meta = await fetchMeta(shareId);
  if (!meta) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (meta.revoked === true) {
    res.status(410).json({ error: 'revoked' });
    return;
  }
  if (new Date(meta.expiresAt) < new Date()) {
    res.status(410).json({ error: 'expired' });
    return;
  }

  const { token, setCookie } = readOrCreateSessionToken(
    headerString(req.headers['x-frank-session']),
    headerString(req.headers['cookie']),
  );
  const before = await countViewers(shareId);
  await touchSession(shareId, token);
  const after = await countViewers(shareId);
  if (after !== before) await publish(shareId, 'presence', { viewers: after });

  if (setCookie) res.setHeader('Set-Cookie', setCookie);
  res.status(200).json({ ok: true, viewers: after });
}
