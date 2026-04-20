import http from 'http';
import { AddressInfo } from 'net';

interface Fake {
  url: string;
  stop: () => Promise<void>;
  // Hooks the test can inspect.
  getPosts: () => Array<{ shareId: string; revision: number; type: string; payload: unknown }>;
  broadcastComment: (shareId: string, comment: unknown) => void;
  broadcastShareEnded: (shareId: string, reason: 'revoked' | 'expired') => void;
}

export async function startFakeCloud(apiKey: string): Promise<Fake> {
  const posts: Array<{ shareId: string; revision: number; type: string; payload: unknown }> = [];
  const authorClients = new Map<string, http.ServerResponse[]>();

  const server = http.createServer(async (req, res) => {
    const authOk = req.headers.authorization === `Bearer ${apiKey}`;
    const u = new URL(req.url || '', 'http://localhost');

    const stateM = u.pathname.match(/^\/api\/share\/([^/]+)\/state$/);
    const authorM = u.pathname.match(/^\/api\/share\/([^/]+)\/author-stream$/);

    if (req.method === 'POST' && stateM) {
      if (!authOk) { res.writeHead(401); return res.end(); }
      const shareId = stateM[1];
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      posts.push({ shareId, revision: body.revision, type: body.type, payload: body.payload });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ acceptedRevision: body.revision }));
    }

    if (req.method === 'GET' && authorM) {
      if (!authOk) { res.writeHead(401); return res.end(); }
      const shareId = authorM[1];
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': hello\n\n');
      const list = authorClients.get(shareId) || [];
      list.push(res);
      authorClients.set(shareId, list);
      req.on('close', () => {
        const cur = authorClients.get(shareId) || [];
        authorClients.set(shareId, cur.filter((r) => r !== res));
      });
      return;
    }

    res.writeHead(404); res.end();
  });

  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;

  function broadcast(shareId: string, event: string, data: unknown) {
    const list = authorClients.get(shareId) || [];
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of list) res.write(frame);
  }

  return {
    url,
    stop: () => new Promise<void>((r) => server.close(() => r())),
    getPosts: () => posts.slice(),
    broadcastComment: (shareId, comment) => broadcast(shareId, 'comment', comment),
    broadcastShareEnded: (shareId, reason) => broadcast(shareId, 'share-ended', { reason }),
  };
}
