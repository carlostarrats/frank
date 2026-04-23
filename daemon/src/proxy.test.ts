import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { AddressInfo } from 'net';
import { validateProxyUrl, wrapThroughProxy, rewriteHtmlUrls, proxyRequest } from './proxy.js';

describe('validateProxyUrl', () => {
  it('accepts http URLs', () => {
    expect(validateProxyUrl('http://example.com')).toEqual({ valid: true });
  });

  it('accepts https URLs', () => {
    expect(validateProxyUrl('https://example.com/page?q=1')).toEqual({ valid: true });
  });

  it('accepts localhost URLs', () => {
    expect(validateProxyUrl('http://localhost:3000')).toEqual({ valid: true });
  });

  it('rejects ftp URLs', () => {
    const result = validateProxyUrl('ftp://files.example.com');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Only HTTP and HTTPS URLs are allowed');
  });

  it('rejects file URLs', () => {
    const result = validateProxyUrl('file:///etc/passwd');
    expect(result.valid).toBe(false);
  });

  it('rejects javascript URLs', () => {
    const result = validateProxyUrl('javascript:alert(1)');
    expect(result.valid).toBe(false);
  });

  it('rejects invalid URLs', () => {
    const result = validateProxyUrl('not-a-url');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid URL');
  });

  it('rejects empty string', () => {
    const result = validateProxyUrl('');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid URL');
  });
});

describe('wrapThroughProxy', () => {
  it('wraps same-origin URLs under /proxy/<slug>', () => {
    expect(wrapThroughProxy('http://localhost:3000/login', 'http://localhost:3000', 'abc')).toBe('/proxy/abc/login');
  });

  it('preserves query and hash', () => {
    expect(wrapThroughProxy('http://localhost:3000/page?x=1#top', 'http://localhost:3000', 'abc')).toBe('/proxy/abc/page?x=1#top');
  });

  it('leaves cross-origin URLs alone', () => {
    expect(wrapThroughProxy('https://cdn.example.com/logo.png', 'http://localhost:3000', 'abc')).toBe('https://cdn.example.com/logo.png');
  });

  it('treats different ports as cross-origin', () => {
    expect(wrapThroughProxy('http://localhost:4000/x', 'http://localhost:3000', 'abc')).toBe('http://localhost:4000/x');
  });

  it('returns input unchanged on malformed URLs', () => {
    expect(wrapThroughProxy('not a url', 'http://localhost:3000', 'abc')).toBe('not a url');
  });
});

describe('rewriteHtmlUrls', () => {
  const target = 'http://localhost:3000/login';
  const slug = 'abc';

  it('rewrites absolute-path href', () => {
    const out = rewriteHtmlUrls('<a href="/dashboard">Go</a>', target, slug);
    expect(out).toBe('<a href="/proxy/abc/dashboard">Go</a>');
  });

  it('rewrites absolute-URL src when same origin', () => {
    const out = rewriteHtmlUrls('<img src="http://localhost:3000/logo.png">', target, slug);
    expect(out).toBe('<img src="/proxy/abc/logo.png">');
  });

  it('rewrites form action', () => {
    const out = rewriteHtmlUrls('<form action="/api/login" method="post">', target, slug);
    expect(out).toBe('<form action="/proxy/abc/api/login" method="post">');
  });

  it('resolves relative paths against the page URL', () => {
    const out = rewriteHtmlUrls('<link href="styles.css">', target, slug);
    expect(out).toBe('<link href="/proxy/abc/styles.css">');
  });

  it('leaves cross-origin CDN asset URLs alone', () => {
    const html = '<img src="https://cdn.example.com/logo.png">';
    expect(rewriteHtmlUrls(html, target, slug)).toBe(html);
  });

  it('leaves data: URLs alone', () => {
    const html = '<img src="data:image/png;base64,iVBOR">';
    expect(rewriteHtmlUrls(html, target, slug)).toBe(html);
  });

  it('leaves javascript: URLs alone', () => {
    const html = '<a href="javascript:void(0)">';
    expect(rewriteHtmlUrls(html, target, slug)).toBe(html);
  });

  it('leaves mailto: URLs alone', () => {
    const html = '<a href="mailto:hi@example.com">';
    expect(rewriteHtmlUrls(html, target, slug)).toBe(html);
  });

  it('leaves fragment-only URLs alone', () => {
    const html = '<a href="#section-2">';
    expect(rewriteHtmlUrls(html, target, slug)).toBe(html);
  });

  it('handles single-quoted attributes', () => {
    const out = rewriteHtmlUrls("<a href='/foo'>", target, slug);
    expect(out).toBe("<a href='/proxy/abc/foo'>");
  });

  it('rewrites script src', () => {
    const out = rewriteHtmlUrls('<script src="/_next/static/chunks/main.js"></script>', target, slug);
    expect(out).toBe('<script src="/proxy/abc/_next/static/chunks/main.js"></script>');
  });
});

// End-to-end: spin up a target HTTP server that mimics the localhost:3000
// failure mode the user hit (redirect + HTML with absolute paths + CDN
// asset), then a proxy frontend server that calls proxyRequest, and assert
// the proxy output from a real fetch.
describe('proxyRequest (integration)', () => {
  let target: http.Server;
  let targetPort: number;
  let proxy: http.Server;
  let proxyPort: number;
  const slug = 'testslug';

  beforeAll(async () => {
    target = http.createServer((req, res) => {
      if (req.url === '/') {
        // Next.js-style: redirect root to /login with XFO: DENY
        res.writeHead(307, {
          'Location': '/login',
          'X-Frame-Options': 'DENY',
          'Content-Type': 'text/html',
        });
        res.end();
        return;
      }
      if (req.url === '/login') {
        const html = `<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="/styles.css">
  <script src="https://cdn.example.com/analytics.js"></script>
</head>
<body>
  <img src="/logo.png">
  <form action="/api/auth" method="post">
    <input name="u"><input name="p"><button>Sign in</button>
  </form>
  <a href="#top">top</a>
</body>
</html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (req.url === '/styles.css') {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end('body { color: red; }');
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('target 404');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    targetPort = (target.address() as AddressInfo).port;

    proxy = http.createServer((req, res) => {
      const path = req.url === '/' ? '' : req.url || '';
      proxyRequest(`http://127.0.0.1:${targetPort}${path}`, slug, req, res);
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    proxyPort = (proxy.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => target.close(() => resolve()));
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  });

  it('rewrites redirect Location to stay inside the proxy', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/`, { redirect: 'manual' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`/proxy/${slug}/login`);
  });

  it('strips X-Frame-Options from redirect response', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/`, { redirect: 'manual' });
    expect(res.headers.get('x-frame-options')).toBeNull();
  });

  it('rewrites HTML href/src/action to route through /proxy/<slug>', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/login`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`href="/proxy/${slug}/styles.css"`);
    expect(body).toContain(`src="/proxy/${slug}/logo.png"`);
    expect(body).toContain(`action="/proxy/${slug}/api/auth"`);
  });

  it('leaves cross-origin CDN script URLs untouched in HTML', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/login`);
    const body = await res.text();
    expect(body).toContain('src="https://cdn.example.com/analytics.js"');
  });

  it('leaves fragment-only anchors alone', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/login`);
    const body = await res.text();
    expect(body).toContain('href="#top"');
  });

  it('streams non-HTML responses unchanged', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/styles.css`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe('body { color: red; }');
  });

  it('returns 502 when target is unreachable', async () => {
    // Use a port that's almost certainly closed
    const badProxy = http.createServer((req, res) => {
      proxyRequest('http://127.0.0.1:1/', slug, req, res);
    });
    await new Promise<void>((resolve) => badProxy.listen(0, '127.0.0.1', resolve));
    const port = (badProxy.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(502);
    await new Promise<void>((resolve) => badProxy.close(() => resolve()));
  });

  it('returns 400 for invalid target URL', async () => {
    const badProxy = http.createServer((req, res) => {
      proxyRequest('not-a-valid-url', slug, req, res);
    });
    await new Promise<void>((resolve) => badProxy.listen(0, '127.0.0.1', resolve));
    const port = (badProxy.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(400);
    await new Promise<void>((resolve) => badProxy.close(() => resolve()));
  });
});
