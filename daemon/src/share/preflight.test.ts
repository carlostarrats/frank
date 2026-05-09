import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import {
  extractSameOriginLinks,
  classifyReadiness,
  countErrorLines,
  buildBuildCommand,
  buildPythonBuildCommands,
  buildStartCommand,
  formatSpawnError,
  findFreePort,
  runPreflight,
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
    expect(spec.cmd).toBe('npm');
    expect(spec.args).toEqual(['run', 'start']);
  });

  it('uses npm run start for Remix', () => {
    const spec = buildStartCommand('remix', 42080);
    expect(spec.cmd).toBe('npm');
    expect(spec.args).toEqual(['run', 'start']);
  });

  it('uses npm run preview -- --port <n> for Vite-based', () => {
    const spec = buildStartCommand('vite-react', 42081);
    expect(spec.cmd).toBe('npm');
    expect(spec.args).toEqual(['run', 'preview', '--', '--port', '42081', '--host', '127.0.0.1']);
  });

  it('uses preview for SvelteKit and Astro', () => {
    expect(buildStartCommand('sveltekit', 42082).args[1]).toBe('preview');
    expect(buildStartCommand('astro', 42083).args[1]).toBe('preview');
  });

  it('uses uvicorn for fastapi-jinja', () => {
    const spec = buildStartCommand('fastapi-jinja', 42084);
    expect(spec.cmd).toBe('python3');
    expect(spec.args).toEqual([
      '-m',
      'uvicorn',
      'app.main:app',
      '--host',
      '127.0.0.1',
      '--port',
      '42084',
    ]);
  });

  it('uses an isolated python interpreter when provided for fastapi-jinja', () => {
    const spec = buildStartCommand('fastapi-jinja', 42084, '/tmp/frank-preflight/venv/bin/python');
    expect(spec.cmd).toBe('/tmp/frank-preflight/venv/bin/python');
    expect(spec.args).toEqual([
      '-m',
      'uvicorn',
      'app.main:app',
      '--host',
      '127.0.0.1',
      '--port',
      '42084',
    ]);
  });
});

describe('buildBuildCommand', () => {
  it('uses npm run build for JS frameworks', () => {
    const spec = buildBuildCommand('next-app');
    expect(spec.cmd).toBe('npm');
    expect(spec.args).toEqual(['run', 'build']);
  });
});

describe('buildPythonBuildCommands', () => {
  it('creates an isolated venv and installs requirements for fastapi-jinja', () => {
    const commands = buildPythonBuildCommands('/tmp/project', '/tmp/frank-preflight/venv', true);
    expect(commands).toEqual([
      { cmd: 'python3', args: ['-m', 'venv', '/tmp/frank-preflight/venv'] },
      {
        cmd: '/tmp/frank-preflight/venv/bin/python',
        args: ['-m', 'pip', 'install', '-r', 'requirements.txt'],
      },
    ]);
  });

  it('falls back to editable pyproject install when requirements.txt is absent', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-preflight-test-'));
    try {
      fs.writeFileSync(path.join(tmp, 'pyproject.toml'), '[project]\nname = "loca"\nversion = "0.1.0"\n');
      const commands = buildPythonBuildCommands(tmp, '/tmp/frank-preflight/venv');
      expect(commands).toEqual([
        { cmd: 'python3', args: ['-m', 'venv', '/tmp/frank-preflight/venv'] },
        {
          cmd: '/tmp/frank-preflight/venv/bin/python',
          args: ['-m', 'pip', 'install', '.'],
        },
      ]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('formatSpawnError', () => {
  it('includes the full start command in spawn failure output', () => {
    const err = new Error('spawn /tmp/frank-preflight/venv/bin/python ENOENT');
    expect(
      formatSpawnError(
        { cmd: '/tmp/frank-preflight/venv/bin/python', args: ['-m', 'uvicorn', 'app.main:app'] },
        err,
      ),
    ).toContain('/tmp/frank-preflight/venv/bin/python -m uvicorn app.main:app');
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

describe('runPreflight — static-html skip', () => {
  it('returns a trivially-passing result without spawning a build', async () => {
    // projectDir doesn't even need to exist — static-html bypasses fs entirely.
    const result = await runPreflight({
      projectDir: '/definitely/does/not/exist',
      framework: 'static-html',
    });
    expect(result.status).toBe('pass');
    expect(result.build.status).toBe('pass');
    expect(result.build.durationMs).toBe(0);
    expect(result.smoke?.status).toBe('skipped');
    expect(result.smoke?.readiness).toBe('green');
    expect(result.failures).toEqual([]);
  });
});
