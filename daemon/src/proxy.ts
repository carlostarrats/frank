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

// Given an absolute URL plus the origin of whatever the proxy target is,
// either wrap the URL to stay inside the proxy (same-origin) or leave it
// alone (cross-origin — let the browser load it directly so a CDN asset
// doesn't pointlessly route through our daemon).
export function wrapThroughProxy(absoluteUrl: string, targetOrigin: string, slug: string): string {
  try {
    const abs = new URL(absoluteUrl);
    const base = new URL(targetOrigin);
    if (abs.origin !== base.origin) return absoluteUrl;
    return `/proxy/${slug}${abs.pathname}${abs.search}${abs.hash}`;
  } catch {
    return absoluteUrl;
  }
}

// Rewrite href/src/action attributes in HTML so same-origin references
// route back through the proxy. Relative URLs resolve against the page's
// own URL; absolute URLs get origin-checked. Fragments, data:, mailto:,
// and cross-origin URLs are left alone.
export function rewriteHtmlUrls(html: string, targetUrl: string, slug: string): string {
  let origin: string;
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    return html;
  }
  return html.replace(
    /\b(href|src|action)\s*=\s*(["'])([^"']*)\2/gi,
    (match, attr, quote, value) => {
      if (!value) return match;
      if (/^(data|javascript|mailto|tel|blob):/i.test(value)) return match;
      if (value.startsWith('#')) return match;
      let absolute: string;
      try {
        absolute = new URL(value, targetUrl).toString();
      } catch {
        return match;
      }
      return `${attr}=${quote}${wrapThroughProxy(absolute, origin, slug)}${quote}`;
    }
  );
}

// Fetches a URL and returns the response with iframe-restrictive headers
// stripped. On redirects, rewrites Location so the iframe stays inside the
// proxy. On HTML responses, rewrites href/src/action URLs for the same
// reason. Non-HTML responses (images, CSS, JS) stream through unchanged.
export function proxyRequest(
  targetUrl: string,
  slug: string,
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
  const targetOrigin = parsedUrl.origin;
  const client = parsedUrl.protocol === 'https:' ? https : http;

  // Strip accept-encoding: we may need to text-rewrite HTML, and it's not
  // worth maintaining a gzip/brotli decoder for localhost dev traffic.
  const forwardHeaders: http.OutgoingHttpHeaders = { ...req.headers, host: parsedUrl.host };
  delete forwardHeaders['accept-encoding'];

  const proxyReq = client.request(
    targetUrl,
    {
      method: req.method || 'GET',
      headers: forwardHeaders,
    },
    (proxyRes) => {
      const statusCode = proxyRes.statusCode || 200;
      const headers: Record<string, string | string[]> = {};

      const incomingHeaders: http.IncomingHttpHeaders = proxyRes.headers;
      for (const key of Object.keys(incomingHeaders)) {
        const value = incomingHeaders[key];
        if (!value) continue;
        const lowerKey = key.toLowerCase();

        if (lowerKey === 'x-frame-options') continue;
        if (lowerKey === 'content-security-policy') {
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

      const isRedirect = statusCode >= 300 && statusCode < 400;
      if (isRedirect && incomingHeaders.location) {
        const locValue = Array.isArray(incomingHeaders.location)
          ? incomingHeaders.location[0]
          : incomingHeaders.location;
        try {
          const absoluteLocation = new URL(locValue, targetUrl).toString();
          headers['location'] = wrapThroughProxy(absoluteLocation, targetOrigin, slug);
        } catch {
          // malformed Location — pass through unchanged
        }
      }

      const contentType = String(incomingHeaders['content-type'] || '').toLowerCase();
      const isHtml = contentType.includes('text/html');
      if (isHtml && !isRedirect) {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          const rewritten = rewriteHtmlUrls(body, targetUrl, slug);
          delete headers['content-length'];
          delete headers['transfer-encoding'];
          res.writeHead(statusCode, headers);
          res.end(rewritten);
        });
        proxyRes.on('error', () => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
          }
          res.end(JSON.stringify({ error: 'Proxy response error' }));
        });
        return;
      }

      res.writeHead(statusCode, headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
  });

  req.pipe(proxyReq);
}
