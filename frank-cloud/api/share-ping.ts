import { readOrCreateSessionToken, touchSession, countViewers } from '../lib/session.js';
import { publish } from '../lib/pubsub.js';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/api\/share\/([a-zA-Z0-9_-]{8,20})\/ping\/?$/);
  if (!m) return Response.json({ error: 'Invalid share ID' }, { status: 400 });
  const shareId = m[1];

  const { token, setCookie } = readOrCreateSessionToken(req);
  const before = await countViewers(shareId);
  await touchSession(shareId, token);
  const after = await countViewers(shareId);
  if (after !== before) await publish(shareId, 'presence', { viewers: after });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  return new Response(JSON.stringify({ ok: true, viewers: after }), { status: 200, headers });
}
