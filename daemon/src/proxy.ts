import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

// Validates that a URL is safe to proxy
export function validateProxyUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { valid: false, error: 'Only HTTP and HTTPS URLs are allowed' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL' };
  }
}

// Fetches a URL and returns the response with iframe-restrictive headers stripped
export function proxyRequest(
  targetUrl: string,
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  const validation = validateProxyUrl(targetUrl);
  if (!validation.valid) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: validation.error }));
    return;
  }

  const parsedUrl = new URL(targetUrl);
  const client = parsedUrl.protocol === 'https:' ? https : http;

  const proxyReq = client.request(
    targetUrl,
    {
      method: req.method || 'GET',
      headers: {
        ...req.headers,
        host: parsedUrl.host,
      },
    },
    (proxyRes) => {
      const headers: Record<string, string | string[]> = {};

      // Copy response headers, stripping iframe-restrictive ones
      const incomingHeaders: http.IncomingHttpHeaders = proxyRes.headers;
      for (const key of Object.keys(incomingHeaders)) {
        const value = incomingHeaders[key];
        if (!value) continue;
        const lowerKey = key.toLowerCase();

        // Strip iframe-restrictive headers
        if (lowerKey === 'x-frame-options') continue;
        if (lowerKey === 'content-security-policy') {
          // Remove frame-ancestors directive but keep the rest
          const cspValue = Array.isArray(value) ? value.join(', ') : value;
          const cleaned = cspValue
            .split(';')
            .filter(d => !d.trim().toLowerCase().startsWith('frame-ancestors'))
            .join(';')
            .trim();
          if (cleaned) headers[key] = cleaned;
          continue;
        }

        headers[key] = value;
      }

      res.writeHead(proxyRes.statusCode || 200, headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
  });

  // Forward request body for POST/PUT
  req.pipe(proxyReq);
}
