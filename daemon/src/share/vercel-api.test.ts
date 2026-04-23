import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createDeployment,
  pollDeployment,
  deleteDeployment,
  disableDeploymentProtection,
  streamBuildLogs,
  verifyVercelToken,
  zoneForElapsed,
} from './vercel-api.js';

let tmp: string;

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(input, init));
  (globalThis as any).fetch = fn as unknown as typeof fetch;
  return fn;
}

function jsonRes(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-vercel-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('zoneForElapsed', () => {
  it('returns expected for elapsed < 90s', () => {
    expect(zoneForElapsed(0, 300_000)).toBe('expected');
    expect(zoneForElapsed(89_999, 300_000)).toBe('expected');
  });
  it('returns taking-longer for 90s..timeout', () => {
    expect(zoneForElapsed(90_000, 300_000)).toBe('taking-longer');
    expect(zoneForElapsed(200_000, 300_000)).toBe('taking-longer');
  });
  it('returns timeout at or past timeout', () => {
    expect(zoneForElapsed(300_000, 300_000)).toBe('timeout');
    expect(zoneForElapsed(999_999, 300_000)).toBe('timeout');
  });
});

describe('createDeployment', () => {
  it('POSTs to /v13/deployments with bearer auth, base64 files, and framework slug', async () => {
    // Write one file on disk so readFile works
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, '{"name":"demo"}');

    let captured: { url: string; init?: RequestInit } | null = null;
    mockFetch((input, init) => {
      captured = { url: String(input), init };
      return jsonRes({ id: 'dpl_123', url: 'dpl_123.vercel.app', readyState: 'QUEUED' });
    });

    const result = await createDeployment({
      token: 'tok_abc',
      projectName: 'myshare',
      framework: 'next-app',
      files: [{ relPath: 'package.json', absPath: pkgPath }],
      env: { NEXT_PUBLIC_FRANK_SHARE: '1' },
    });

    expect(result.id).toBe('dpl_123');
    expect(result.url).toBe('dpl_123.vercel.app');
    expect(captured?.url).toBe('https://api.vercel.com/v13/deployments');
    const headers = (captured?.init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok_abc');
    const body = JSON.parse(captured?.init?.body as string);
    expect(body.name).toBe('myshare');
    expect(body.target).toBe('preview');
    expect(body.projectSettings.framework).toBe('nextjs');
    expect(body.files).toHaveLength(1);
    expect(body.files[0].file).toBe('package.json');
    expect(body.files[0].encoding).toBe('base64');
    expect(Buffer.from(body.files[0].data, 'base64').toString('utf-8')).toBe('{"name":"demo"}');
    expect(body.env.NEXT_PUBLIC_FRANK_SHARE).toBe('1');
  });

  it('includes teamId query param when provided', async () => {
    const pkgPath = path.join(tmp, 'p.json');
    fs.writeFileSync(pkgPath, '{}');
    let capturedUrl = '';
    mockFetch((input) => {
      capturedUrl = String(input);
      return jsonRes({ id: 'd', url: 'd.vercel.app', readyState: 'QUEUED' });
    });
    await createDeployment({
      token: 't',
      projectName: 'p',
      framework: 'vite-react',
      files: [{ relPath: 'p.json', absPath: pkgPath }],
      teamId: 'team_xyz',
    });
    expect(capturedUrl).toContain('teamId=team_xyz');
  });

  it('maps framework ids to Vercel slugs', async () => {
    const pkgPath = path.join(tmp, 'p.json');
    fs.writeFileSync(pkgPath, '{}');
    const capturedBodies: any[] = [];
    mockFetch((_input, init) => {
      capturedBodies.push(JSON.parse(init!.body as string));
      return jsonRes({ id: 'd', url: 'd.vercel.app', readyState: 'QUEUED' });
    });

    const pairs: Array<[any, string]> = [
      ['next-pages', 'nextjs'],
      ['vite-svelte', 'vite'],
      ['sveltekit', 'sveltekit'],
      ['astro', 'astro'],
      ['remix', 'remix'],
    ];
    for (const [fw, expected] of pairs) {
      await createDeployment({
        token: 't',
        projectName: 'p',
        framework: fw,
        files: [{ relPath: 'p.json', absPath: pkgPath }],
      });
    }
    for (let i = 0; i < pairs.length; i++) {
      expect(capturedBodies[i].projectSettings.framework).toBe(pairs[i][1]);
    }
  });

  it('throws on non-OK response with status + body preview', async () => {
    const pkgPath = path.join(tmp, 'p.json');
    fs.writeFileSync(pkgPath, '{}');
    mockFetch(() => new Response('bad token', { status: 401 }));
    await expect(
      createDeployment({
        token: 'nope',
        projectName: 'p',
        framework: 'next-app',
        files: [{ relPath: 'p.json', absPath: pkgPath }],
      }),
    ).rejects.toThrow(/401/);
  });
});

describe('pollDeployment', () => {
  it('returns when readyState reaches READY', async () => {
    let call = 0;
    mockFetch(() => {
      call++;
      const readyState = call >= 3 ? 'READY' : 'BUILDING';
      return jsonRes({ id: 'd', url: 'd.vercel.app', readyState });
    });
    const progress: string[] = [];
    const result = await pollDeployment({
      token: 't',
      deploymentId: 'd',
      pollIntervalMs: 5,
      timeoutMs: 5000,
      onProgress: (i) => progress.push(i.readyState),
    });
    expect(result.readyState).toBe('READY');
    expect(progress.length).toBeGreaterThan(0);
  });

  it('returns ERROR state with error message', async () => {
    mockFetch(() => jsonRes({
      id: 'd', url: 'd.vercel.app', readyState: 'ERROR', errorMessage: 'Build crashed',
    }));
    const result = await pollDeployment({
      token: 't', deploymentId: 'd', pollIntervalMs: 5,
    });
    expect(result.readyState).toBe('ERROR');
    expect(result.error).toContain('Build crashed');
  });

  it('returns TIMEOUT when deadline exceeded', async () => {
    mockFetch(() => jsonRes({ id: 'd', url: 'd.vercel.app', readyState: 'BUILDING' }));
    const result = await pollDeployment({
      token: 't', deploymentId: 'd', pollIntervalMs: 5, timeoutMs: 20,
    });
    expect(result.readyState).toBe('TIMEOUT');
  });
});

describe('deleteDeployment', () => {
  it('sends DELETE with bearer auth', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    mockFetch((input, init) => {
      captured = { url: String(input), init };
      return new Response(null, { status: 204 });
    });
    await deleteDeployment({ token: 't', deploymentId: 'dpl_1' });
    expect(captured?.url).toContain('/v13/deployments/dpl_1');
    expect((captured?.init?.headers as any).Authorization).toBe('Bearer t');
    expect(captured?.init?.method).toBe('DELETE');
  });

  it('treats 404 as success (already deleted)', async () => {
    mockFetch(() => new Response('not found', { status: 404 }));
    await expect(deleteDeployment({ token: 't', deploymentId: 'dpl_1' })).resolves.toBeUndefined();
  });

  it('throws on 500', async () => {
    mockFetch(() => new Response('boom', { status: 500 }));
    await expect(deleteDeployment({ token: 't', deploymentId: 'dpl_1' })).rejects.toThrow(/500/);
  });
});

describe('verifyVercelToken', () => {
  it('returns ok:true on 200', async () => {
    mockFetch(() => jsonRes({ user: { id: 'u' } }));
    const result = await verifyVercelToken('t');
    expect(result.ok).toBe(true);
  });

  it('returns ok:false with message on 401', async () => {
    mockFetch(() => new Response('nope', { status: 401 }));
    const result = await verifyVercelToken('t');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('401');
  });

  it('returns ok:false on network error', async () => {
    mockFetch(() => { throw new Error('econnrefused'); });
    const result = await verifyVercelToken('t');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('econnrefused');
  });
});

describe('disableDeploymentProtection', () => {
  it('PATCHes the project with ssoProtection:null and passwordProtection:null', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    mockFetch((input, init) => {
      captured = { url: String(input), init };
      return jsonRes({ id: 'prj_123', name: 'my-project' });
    });
    const r = await disableDeploymentProtection({
      token: 'tok',
      projectIdOrName: 'frank-share-abc123',
    });
    expect(r.ok).toBe(true);
    expect(captured!.url).toContain('/v9/projects/frank-share-abc123');
    expect(captured!.init?.method).toBe('PATCH');
    const body = JSON.parse(String(captured!.init?.body));
    expect(body).toEqual({ ssoProtection: null, passwordProtection: null });
    expect((captured!.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('appends teamId query when provided', async () => {
    let captured: string = '';
    mockFetch((input) => {
      captured = String(input);
      return jsonRes({ id: 'prj' });
    });
    await disableDeploymentProtection({
      token: 't',
      projectIdOrName: 'my-project',
      teamId: 'team_xyz',
    });
    expect(captured).toContain('teamId=team_xyz');
  });

  it('returns ok:false with message on non-2xx', async () => {
    mockFetch(() => new Response('forbidden', { status: 403 }));
    const r = await disableDeploymentProtection({ token: 't', projectIdOrName: 'p' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('403');
    expect(r.message).toContain('forbidden');
  });

  it('returns ok:false with the thrown error on fetch failure', async () => {
    mockFetch(() => { throw new Error('enotfound'); });
    const r = await disableDeploymentProtection({ token: 't', projectIdOrName: 'p' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('enotfound');
  });
});

describe('streamBuildLogs', () => {
  // Build a Response whose body is a ReadableStream of Uint8Array chunks,
  // mimicking Vercel's newline-delimited JSON stream.
  function streamingResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    });
  }

  it('parses whole newline-delimited JSON lines and fires onLine per event', async () => {
    mockFetch(() =>
      streamingResponse([
        '{"type":"stdout","text":"Installing dependencies...","created":1}\n',
        '{"type":"stdout","text":"Building","created":2}\n',
        '{"type":"deployment-state","text":"READY","created":3}\n',
      ]),
    );
    const events: Array<{ type: string; text?: string }> = [];
    await streamBuildLogs({
      token: 't',
      deploymentId: 'dpl',
      onLine: (evt) => events.push({ type: evt.type, text: evt.text }),
    });
    expect(events).toEqual([
      { type: 'stdout', text: 'Installing dependencies...' },
      { type: 'stdout', text: 'Building' },
      { type: 'deployment-state', text: 'READY' },
    ]);
  });

  it('splits lines that arrive across chunk boundaries', async () => {
    mockFetch(() =>
      streamingResponse([
        '{"type":"stdout","text":"Line ',
        'one"}\n{"type":"stdout","te',
        'xt":"Line two"}\n',
      ]),
    );
    const events: string[] = [];
    await streamBuildLogs({
      token: 't',
      deploymentId: 'dpl',
      onLine: (evt) => { if (evt.text) events.push(evt.text); },
    });
    expect(events).toEqual(['Line one', 'Line two']);
  });

  it('skips malformed JSON lines without aborting the stream', async () => {
    mockFetch(() =>
      streamingResponse([
        '{"type":"stdout","text":"first"}\n',
        'not valid json\n',
        '{"type":"stdout","text":"third"}\n',
      ]),
    );
    const events: string[] = [];
    await streamBuildLogs({
      token: 't',
      deploymentId: 'dpl',
      onLine: (evt) => { if (evt.text) events.push(evt.text); },
    });
    expect(events).toEqual(['first', 'third']);
  });

  it('returns quietly on non-2xx response (no throw, no events)', async () => {
    mockFetch(() => new Response('forbidden', { status: 403 }));
    const events: unknown[] = [];
    await expect(streamBuildLogs({
      token: 't',
      deploymentId: 'dpl',
      onLine: (evt) => events.push(evt),
    })).resolves.toBeUndefined();
    expect(events).toEqual([]);
  });

  it('swallows onLine exceptions so one bad consumer can\'t kill the stream', async () => {
    mockFetch(() =>
      streamingResponse([
        '{"type":"stdout","text":"a"}\n',
        '{"type":"stdout","text":"b"}\n',
      ]),
    );
    const events: string[] = [];
    await streamBuildLogs({
      token: 't',
      deploymentId: 'dpl',
      onLine: (evt) => {
        events.push(evt.text ?? '');
        if (evt.text === 'a') throw new Error('consumer exploded');
      },
    });
    // Both events still delivered despite the first throwing.
    expect(events).toEqual(['a', 'b']);
  });

  it('appends teamId to the events URL when provided', async () => {
    let capturedUrl = '';
    mockFetch((input) => {
      capturedUrl = String(input);
      return streamingResponse([]);
    });
    await streamBuildLogs({
      token: 't',
      deploymentId: 'dpl_abc',
      teamId: 'team_xyz',
      onLine: () => {},
    });
    expect(capturedUrl).toContain('/v3/deployments/dpl_abc/events');
    expect(capturedUrl).toContain('follow=1');
    expect(capturedUrl).toContain('teamId=team_xyz');
  });

  it('honours an external AbortSignal — stream resolves without reading more', async () => {
    const ctrl = new AbortController();
    mockFetch((_, init) => {
      // Simulate an abort-aware fetch: if the signal is aborted, the fetch
      // rejects. That rejection is caught inside streamBuildLogs.
      if (init?.signal?.aborted) throw new Error('aborted');
      return streamingResponse([]);
    });
    ctrl.abort();
    await expect(streamBuildLogs({
      token: 't',
      deploymentId: 'dpl',
      signal: ctrl.signal,
      onLine: () => {},
    })).resolves.toBeUndefined();
  });
});
