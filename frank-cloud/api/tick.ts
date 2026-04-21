import { redisClient } from '../lib/redis.js';
import { publish } from '../lib/pubsub.js';

export const config = { runtime: 'edge' };

const redis = redisClient();

export default async function handler(req: Request): Promise<Response> {
  // Vercel Cron sends a specific user-agent + bearer; in open-deployment setups
  // you can harden this with the CRON_SECRET env var.
  if (process.env.CRON_SECRET) {
    const expected = `Bearer ${process.env.CRON_SECRET}`;
    if (req.headers.get('Authorization') !== expected) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const now = Date.now();

  // Scan all shares with a pending offline deadline.
  // In KV-as-Redis, `scan` is the idiomatic approach; `keys` is ok at small scale.
  const offlineKeys = await redis.keys('share:*:authorOfflineAt');
  let swept = 0;
  for (const key of offlineKeys) {
    const shareId = key.split(':')[1];
    const ts = (await redis.get<number>(key)) ?? 0;
    if (ts && ts <= now) {
      // Race-safe: DEL returns 1 only for the winner; skip the broadcast if another
      // caller (the inline sweep in share-stream.ts) already fired it.
      const deleted = await redis.del(key);
      if (deleted) {
        await redis.del(`share:${shareId}:author`);
        await publish(shareId, 'author-status', { status: 'offline' });
        swept++;
      }
    }
  }

  return Response.json({ ok: true, swept });
}
