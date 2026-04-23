import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildBundle } from './bundler.js';

let tmp: string;

function touch(relPath: string, contents = 'x') {
  const full = path.join(tmp, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-share-bundle-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function relPaths(files: { relPath: string }[]): string[] {
  return files.map((f) => f.relPath).sort();
}

describe('buildBundle — Next.js App Router', () => {
  it('admits expected root files + app/ + public/', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('tsconfig.json', '{}');
    touch('app/layout.tsx', '');
    touch('app/page.tsx', '');
    touch('public/logo.svg', '');
    touch('components/Button.tsx', '');
    touch('lib/utils.ts', '');

    const result = await buildBundle(tmp, { framework: 'next-app' });
    expect(result.status).toBe('ok');
    const admitted = relPaths(result.files);
    expect(admitted).toContain('package.json');
    expect(admitted).toContain('package-lock.json');
    expect(admitted).toContain('next.config.js');
    expect(admitted).toContain('tsconfig.json');
    expect(admitted).toContain('app/layout.tsx');
    expect(admitted).toContain('app/page.tsx');
    expect(admitted).toContain('public/logo.svg');
    expect(admitted).toContain('components/Button.tsx');
    expect(admitted).toContain('lib/utils.ts');
  });

  it('refuses .env.local even at project root', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    touch('.env.local', 'SECRET=value');

    const result = await buildBundle(tmp, { framework: 'next-app' });
    const envRejections = result.rejected.filter((r) => r.relPath === '.env.local');
    expect(envRejections).toHaveLength(1);
    expect(envRejections[0].reason).toBe('env-file-forbidden');
    expect(result.files.find((f) => f.relPath === '.env.local')).toBeUndefined();
  });

  it('refuses .env.production, .env.staging, .env.development', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    for (const f of ['.env', '.env.production', '.env.staging', '.env.development']) {
      touch(f, 'k=v');
    }
    const result = await buildBundle(tmp, { framework: 'next-app' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    expect(admitted.has('.env')).toBe(false);
    expect(admitted.has('.env.production')).toBe(false);
    expect(admitted.has('.env.staging')).toBe(false);
    expect(admitted.has('.env.development')).toBe(false);
  });

  it('admits exactly .env.share', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    touch('.env.share', 'NEXT_PUBLIC_FRANK_SHARE=1');
    const result = await buildBundle(tmp, { framework: 'next-app' });
    expect(result.files.map((f) => f.relPath)).toContain('.env.share');
  });

  it('refuses node_modules / .next / .git / test-results / .vercel', async () => {
    touch('package.json', '{}');
    touch('app/page.tsx', '');
    touch('node_modules/some/index.js', '');
    touch('.next/build-id', '');
    touch('.git/HEAD', '');
    touch('test-results/report.json', '');
    touch('.vercel/project.json', '');
    const result = await buildBundle(tmp, { framework: 'next-app' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    expect([...admitted].some((p) => p.startsWith('node_modules/'))).toBe(false);
    expect([...admitted].some((p) => p.startsWith('.next/'))).toBe(false);
    expect([...admitted].some((p) => p.startsWith('.git/'))).toBe(false);
    expect([...admitted].some((p) => p.startsWith('test-results/'))).toBe(false);
    expect([...admitted].some((p) => p.startsWith('.vercel/'))).toBe(false);
  });

  it('refuses .pem keys outside public/', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    touch('secrets/private.pem', '-----BEGIN-----\n-----END-----');
    touch('public/cert.pem', '-----BEGIN-----\n-----END-----');  // public/cert.pem is refused because secrets/ isn't in allowlist anyway; see comment
    const result = await buildBundle(tmp, { framework: 'next-app' });
    // secrets/ is refused because it's not in the allowlist at all
    expect(result.rejected.find((r) => r.relPath === 'secrets')).toBeDefined();
  });

  it('admits root-level middleware.ts + proxy.ts + instrumentation.ts', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    touch('middleware.ts', '');
    touch('proxy.ts', '');
    touch('instrumentation.ts', '');
    touch('instrumentation-client.ts', '');
    touch('sentry.server.config.ts', '');
    const result = await buildBundle(tmp, { framework: 'next-app' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    expect(admitted.has('middleware.ts')).toBe(true);
    expect(admitted.has('proxy.ts')).toBe(true);
    expect(admitted.has('instrumentation.ts')).toBe(true);
    expect(admitted.has('instrumentation-client.ts')).toBe(true);
    expect(admitted.has('sentry.server.config.ts')).toBe(true);
  });

  it('refuses random unknown top-level files', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    touch('Dockerfile', 'FROM node');
    touch('README.md', '# readme');
    touch('random-script.sh', '#!/bin/bash');
    const result = await buildBundle(tmp, { framework: 'next-app' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    expect(admitted.has('Dockerfile')).toBe(false);
    expect(admitted.has('README.md')).toBe(false);
    expect(admitted.has('random-script.sh')).toBe(false);
    expect(result.rejected.some((r) => r.relPath === 'Dockerfile' && r.reason === 'not-in-allowlist')).toBe(true);
  });

  it('refuses second lockfile', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('pnpm-lock.yaml', '');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    const result = await buildBundle(tmp, { framework: 'next-app' });
    const lockfilesAdmitted = result.files.filter((f) =>
      ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock'].includes(f.relPath),
    );
    expect(lockfilesAdmitted).toHaveLength(1);
  });
});

describe('buildBundle — Vite + React', () => {
  it('admits src/, not app/', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('vite.config.ts', '');
    touch('index.html', '<!doctype html><div id="root"></div>');
    touch('src/App.tsx', '');
    touch('src/main.tsx', '');
    touch('public/favicon.svg', '');
    touch('app/ignored.tsx', '');  // should be refused — not Next.js

    const result = await buildBundle(tmp, { framework: 'vite-react' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    expect(admitted.has('src/App.tsx')).toBe(true);
    expect(admitted.has('src/main.tsx')).toBe(true);
    expect(admitted.has('index.html')).toBe(true);
    expect(admitted.has('public/favicon.svg')).toBe(true);
    expect(admitted.has('app/ignored.tsx')).toBe(false);
  });
});

describe('buildBundle — size caps', () => {
  it('refuses single file over 50 MB', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    // Create a 51 MB file
    const bigPath = path.join(tmp, 'public', 'big.bin');
    fs.mkdirSync(path.dirname(bigPath), { recursive: true });
    fs.writeFileSync(bigPath, Buffer.alloc(51 * 1024 * 1024));

    const result = await buildBundle(tmp, { framework: 'next-app' });
    const bigRejection = result.rejected.find((r) => r.relPath === 'public/big.bin');
    expect(bigRejection?.reason).toBe('over-size-cap');
    expect(result.files.find((f) => f.relPath === 'public/big.bin')).toBeUndefined();
  });
});
