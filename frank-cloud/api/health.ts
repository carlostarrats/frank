export const config = { runtime: 'edge' };

export default function handler(req: Request): Response {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  // Verify API key
  const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '');
  const expectedKey = process.env.FRANK_API_KEY;

  if (!expectedKey) {
    return Response.json({ status: 'error', message: 'FRANK_API_KEY not configured' }, { status: 500 });
  }

  if (apiKey !== expectedKey) {
    return Response.json({ status: 'error', message: 'Invalid API key' }, { status: 401 });
  }

  return Response.json({ status: 'ok', version: '3' });
}
