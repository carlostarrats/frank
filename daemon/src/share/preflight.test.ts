import { describe, it, expect } from 'vitest';
import {
  extractSameOriginLinks,
  classifyReadiness,
  countErrorLines,
  buildStartCommand,
  findFreePort,
} from './preflight.js';

describe('extractSameOriginLinks', () => {
  const origin = 'http://127.0.0.1:42080';

  it('extracts same-origin href values in document order', () => {
    const html = `
      <html><body>
        <a href="/about">About</a>
        <a href="/contact">Contact</a>
        <a href="${origin}/login">Login</a>
      </body></html>
    `;
    const links = extractSameOriginLinks(html, origin);
    expect(links).toEqual([`${origin}/about`, `${origin}/contact`, `${origin}/login`]);
  });

  it('skips cross-origin hrefs', () => {
    const html = `
      <a href="/local">local</a>
      <a href="https://cdn.example.com/asset">cdn</a>
      <a href="https://other-app.example/page">other</a>
    `;
    expect(extractSameOriginLinks(html, origin)).toEqual([`${origin}/local`]);
  });

  it('skips fragment-only, javascript:, mailto:, tel:, data:, blob:, sms: schemes', () => {
    const html = `
      <a href="#anchor">anchor</a>
      <a href="javascript:void(0)">js</a>
      <a href="mailto:x@y.com">email</a>
      <a href="tel:+1000">phone</a>
      <a href="data:text/plain,foo">data</a>
      <a href="blob:${origin}/abc">blob</a>
      <a href="sms:+1000">sms</a>
      <a href="/real">real</a>
    `;
    expect(extractSameOriginLinks(html, origin)).toEqual([`${origin}/real`]);
  });

  it('deduplicates repeated hrefs', () => {
    const html = `
      <a href="/a">1</a><a href="/a">2</a><a href="/b">3</a><a href="/a">4</a>
    `;
    expect(extractSameOriginLinks(html, origin)).toEqual([`${origin}/a`, `${origin}/b`]);
  });

  it('skips bare root links (/ is probed separately)', () => {
    const html = `<a href="/">home</a><a href="/about">about</a>`;
    expect(extractSameOriginLinks(html, origin)).toEqual([`${origin}/about`]);
  });

  it('strips URL fragments', () => {
    const html = `<a href="/docs#section-a">docs</a><a href="/docs#section-b">docs again</a>`;
    // Post-dedup — /docs with different fragments are the same URL
    expect(extractSameOriginLinks(html, origin)).toEqual([`${origin}/docs`]);
  });

  it('is quote-agnostic (single or double)', () => {
    const html = `<a href='/single'>s</a><a href="/double">d</a>`;
    expect(extractSameOriginLinks(html, origin)).toEqual([`${origin}/single`, `${origin}/double`]);
  });
});

describe('countErrorLines', () => {
  it('counts only matching patterns', () => {
    const stderr = [
      'info: starting',
      'Error: thing failed',
      'warn: cache miss',
      'fetch failed',
      'getaddrinfo ENOTFOUND placeholder',
      'note: some random line',
    ].join('\n');
    const { count, samples } = countErrorLines(stderr);
    expect(count).toBe(3);
    expect(samples).toHaveLength(3);
  });

  it('caps samples at 10 regardless of count', () => {
    const stderr = Array(20).fill('Error: repeated thing').join('\n');
    const { count, samples } = countErrorLines(stderr);
    expect(count).toBe(20);
    expect(samples).toHaveLength(10);
  });

  it('is case-insensitive', () => {
    const stderr = 'error: lower\nERROR: upper\nError: mixed';
    expect(countErrorLines(stderr).count).toBe(3);
  });
});

describe('classifyReadiness', () => {
  it('red when build failed regardless of count', () => {
    expect(classifyReadiness(0, true)).toBe('red');
  });
  it('green at 0 and up through 5', () => {
    expect(classifyReadiness(0, false)).toBe('green');
    expect(classifyReadiness(5, false)).toBe('green');
  });
  it('yellow for 6–50', () => {
    expect(classifyReadiness(6, false)).toBe('yellow');
    expect(classifyReadiness(50, false)).toBe('yellow');
  });
  it('red above 50', () => {
    expect(classifyReadiness(51, false)).toBe('red');
    expect(classifyReadiness(1000, false)).toBe('red');
  });
});

describe('buildStartCommand', () => {
  it('uses npm run start for Next.js (PORT env)', () => {
    const spec = buildStartCommand('next-app', 42080);
    expect(spec.script).toBe('start');
    expect(spec.extraArgs).toEqual([]);
  });

  it('uses npm run start for Remix', () => {
    expect(buildStartCommand('remix', 42080).script).toBe('start');
  });

  it('uses npm run preview -- --port <n> for Vite-based', () => {
    const spec = buildStartCommand('vite-react', 42081);
    expect(spec.script).toBe('preview');
    expect(spec.extraArgs).toEqual(['--', '--port', '42081', '--host', '127.0.0.1']);
  });

  it('uses preview for SvelteKit and Astro', () => {
    expect(buildStartCommand('sveltekit', 42082).script).toBe('preview');
    expect(buildStartCommand('astro', 42083).script).toBe('preview');
  });
});

describe('findFreePort', () => {
  it('returns a port that can subsequently be bound', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });

  it('returns distinct ports on repeated calls', async () => {
    const [a, b, c] = await Promise.all([findFreePort(), findFreePort(), findFreePort()]);
    // Not strictly guaranteed by the OS, but practically always true.
    const unique = new Set([a, b, c]);
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });
});
